#!/usr/bin/env python3
# CITY BATTLE -- fetch_buildings.py
# ---------------------------------------------------------------------------
# Fetch OpenStreetMap building footprints + heights for a city bounding box via
# the Overpass API (https://overpass-api.de/api/interpreter -- no API key).
#
# For each `way["building"]` inside the bbox we extract:
#   - footprint polygon (lat/lon node ring)
#   - height in metres: from the `height` tag, else `building:levels` * 3.0 m,
#     else a default of 8 m.
#
# Output: out/{city}_buildings.json -- a list of
#     { "polygon": [[x_m, z_m], ...], "height_m": <float> }
# where x_m / z_m are LOCAL METRES relative to the SAME bbox origin used by
# make_heightmap.py (equirectangular):
#     x = (lon - west) * 111320 * cos(lat_mid)
#     z = (lat - south) * 111320
# i.e. x = east (matches Unity +X), z = north (matches Unity +Z). Origin = bbox
# SW corner, identical to the heightmap's local-metre frame.
#
# Robustness:
#   - 60 s HTTP timeout, clear messages when Overpass is slow / rate-limited / down.
#   - Raw Overpass JSON is cached to out/{city}_osm_raw.json so re-runs skip the
#     download (use --force to refetch).
#   - Empty / missing results are handled gracefully (writes an empty list).
#
# Bounding boxes come straight from fetch_dem.CITIES, so buildings line up with
# the DEM exactly.
#
# Dependencies: numpy is NOT needed here; only `requests` (and the stdlib). The
# script degrades gracefully with a clear install line if `requests` is missing.
# ---------------------------------------------------------------------------
import sys
import os
import math
import json
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")

# Public Overpass endpoint. No key required. Be a good citizen: one request,
# small bbox, generous timeout, cached results.
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# A couple of mirrors to try if the primary is overloaded.
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

DEFAULT_HEIGHT_M = 8.0  # buildings with no height info
LEVEL_HEIGHT_M = 3.0  # metres per floor when only building:levels is known
HTTP_TIMEOUT_S = 60  # Overpass can be slow; give it room


def _require_deps():
    try:
        import requests  # noqa: F401
    except ImportError:
        print("ERROR: missing Python package: requests")
        print("Install it with:")
        print("    pip install --user requests")
        sys.exit(2)


def _load_cities():
    """Bring in the SAME bounding boxes used by the DEM pipeline."""
    sys.path.insert(0, HERE)
    try:
        from fetch_dem import CITIES
    except Exception as exc:  # pragma: no cover - defensive
        print("ERROR: could not import CITIES from fetch_dem.py: %s" % exc)
        sys.exit(1)
    return CITIES


def parse_height(tags):
    """Best-effort building height in metres from OSM tags."""
    # 1) explicit height tag (may be "12", "12 m", "12.5m", or even "40'")
    h = tags.get("height")
    if h is not None:
        val = _parse_length_m(h)
        if val is not None and val > 0:
            return val
    # 2) building:levels * per-floor height (+ roof levels if present)
    levels = tags.get("building:levels")
    if levels is not None:
        lv = _parse_float(levels)
        if lv is not None and lv > 0:
            roof = _parse_float(tags.get("roof:levels", "0")) or 0.0
            return (lv + roof) * LEVEL_HEIGHT_M
    # 3) default
    return DEFAULT_HEIGHT_M


def _parse_float(s):
    try:
        return float(str(s).strip())
    except (TypeError, ValueError):
        return None


def _parse_length_m(s):
    """Parse an OSM length string into metres. Handles 'm', feet (') and bare nums."""
    if s is None:
        return None
    t = str(s).strip().lower()
    if not t:
        return None
    try:
        if t.endswith("m"):
            return float(t[:-1].strip())
        if t.endswith("ft") or t.endswith("'"):
            ft = t.rstrip("ft'").strip()
            return float(ft) * 0.3048
        return float(t)
    except ValueError:
        # take leading numeric prefix if any (e.g. "12 m above ground")
        num = ""
        for ch in t:
            if ch.isdigit() or ch in ".-":
                num += ch
            else:
                break
        try:
            return float(num) if num else None
        except ValueError:
            return None


def build_query(bbox):
    """Overpass QL: all building ways in the bbox, with node geometry inlined."""
    south, west, north, east = bbox
    # `out geom;` returns each way's node coordinates inline -- no second pass.
    return (
        '[out:json][timeout:%d];\n(way["building"](%f,%f,%f,%f););\nout geom tags;\n'
    ) % (HTTP_TIMEOUT_S, south, west, north, east)


def fetch_raw(city, bbox, force=False):
    """Return Overpass JSON dict, using the on-disk cache unless force=True."""
    import requests

    os.makedirs(OUT_DIR, exist_ok=True)
    cache_path = os.path.join(OUT_DIR, "%s_osm_raw.json" % city)
    if os.path.exists(cache_path) and not force:
        print("Using cached Overpass response: %s" % cache_path)
        try:
            with open(cache_path, "r") as fh:
                return json.load(fh)
        except (ValueError, OSError) as exc:
            print("WARN: cache unreadable (%s); refetching." % exc)

    query = build_query(bbox)
    print("Querying Overpass for '%s' bbox=%s ..." % (city, bbox))
    last_err = None
    for url in OVERPASS_MIRRORS:
        try:
            print("  -> %s" % url)
            resp = requests.post(
                url,
                data={"data": query},
                timeout=HTTP_TIMEOUT_S,
                headers={"User-Agent": "CityBattle-terrain-pipeline/1.0"},
            )
            if resp.status_code == 429:
                print("     rate-limited (HTTP 429); trying next mirror...")
                last_err = "HTTP 429 rate-limited"
                continue
            if resp.status_code in (503, 504):
                print(
                    "     server busy (HTTP %d); trying next mirror..."
                    % resp.status_code
                )
                last_err = "HTTP %d" % resp.status_code
                continue
            resp.raise_for_status()
            data = resp.json()
            with open(cache_path, "w") as fh:
                json.dump(data, fh)
            print("Cached raw Overpass response -> %s" % cache_path)
            return data
        except requests.exceptions.Timeout:
            last_err = "timeout after %ds" % HTTP_TIMEOUT_S
            print("     timed out; trying next mirror...")
        except requests.exceptions.RequestException as exc:
            last_err = str(exc)
            print("     request failed: %s" % exc)
        except ValueError as exc:
            last_err = "bad JSON: %s" % exc
            print("     bad JSON response: %s" % exc)

    print("ERROR: Overpass unreachable on all mirrors (last error: %s)." % last_err)
    print("       Try again later, or run with --force once the API is reachable.")
    print("       The script is safe to re-run; it caches results.")
    return None


def latlon_to_local(lat, lon, south, west, lat_mid):
    """Equirectangular lat/lon -> local metres (x=east, z=north), SW-corner origin."""
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat_mid))
    x = (lon - west) * m_per_deg_lon
    z = (lat - south) * m_per_deg_lat
    return x, z


def convert(city, data, bbox):
    """Turn raw Overpass JSON into the {polygon, height_m} list in local metres."""
    south, west, north, east = bbox
    lat_mid = (south + north) / 2.0

    buildings = []
    n_skipped = 0
    elements = (data or {}).get("elements", [])
    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom or len(geom) < 3:
            n_skipped += 1
            continue
        tags = el.get("tags", {}) or {}
        # Drop the closing duplicate node if present (OSM closed ways repeat node 0).
        ring = geom
        if len(ring) >= 2 and ring[0] == ring[-1]:
            ring = ring[:-1]
        poly = []
        for nd in ring:
            lat = nd.get("lat")
            lon = nd.get("lon")
            if lat is None or lon is None:
                continue
            x, z = latlon_to_local(lat, lon, south, west, lat_mid)
            poly.append([round(x, 3), round(z, 3)])
        if len(poly) < 3:
            n_skipped += 1
            continue
        height_m = round(parse_height(tags), 2)
        buildings.append({"polygon": poly, "height_m": height_m})

    if n_skipped:
        print("Skipped %d degenerate/way-without-geometry elements." % n_skipped)
    return buildings


def run(city, force=False):
    _require_deps()
    cities = _load_cities()
    if city not in cities:
        print("Unknown city: %s" % city)
        print("Available: " + ", ".join(sorted(cities)))
        sys.exit(1)
    bbox = cities[city]

    data = fetch_raw(city, bbox, force=force)
    if data is None:
        # Network failure: do NOT clobber any existing good output. Exit non-zero.
        sys.exit(3)

    buildings = convert(city, data, bbox)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "%s_buildings.json" % city)
    with open(out_path, "w") as fh:
        json.dump(buildings, fh)

    # Report.
    print("")
    print("City: %s" % city)
    print("Buildings fetched: %d" % len(buildings))
    if buildings:
        heights = [b["height_m"] for b in buildings]
        verts = sum(len(b["polygon"]) for b in buildings)
        print(
            "Height m  min/mean/max: %.1f / %.1f / %.1f"
            % (min(heights), sum(heights) / len(heights), max(heights))
        )
        print("Total footprint vertices: %d" % verts)
    else:
        print("No buildings found in bbox (empty result written -- this is valid).")
    size = os.path.getsize(out_path)
    print("Wrote: %s (%s)" % (out_path, _fmt_size(size)))
    return buildings


def _fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0


def main():
    ap = argparse.ArgumentParser(
        description="Fetch OSM building footprints+heights for a city (Overpass API)."
    )
    ap.add_argument("city", help="city key (must match fetch_dem.CITIES)")
    ap.add_argument(
        "--force",
        action="store_true",
        help="ignore the cached Overpass response and refetch",
    )
    ap.add_argument(
        "--list", action="store_true", help="list available cities and exit"
    )
    args = ap.parse_args()

    if args.list:
        cities = _load_cities()
        for name in sorted(cities):
            print("%-16s %s" % (name, cities[name]))
        return

    run(args.city, force=args.force)


if __name__ == "__main__":
    main()
