#!/usr/bin/env python3
"""CITY BATTLE - fetch ACCURATE elevation (DEM) for a city bbox.

Source: Copernicus DEM GLO-30 (GLO-30m) Cloud-Optimised GeoTIFFs on AWS open data, no API key.
  https://copernicus-dem-30m.s3.amazonaws.com/  (one 1-degree tile per file, float32 metres)
Cleaner + more accurate than the AWS Terrarium PNG tiles used by fetch_dem.py (which suffer
8-bit-ish quantisation noise and deep-ocean nodata spikes). Copernicus is a proper float DEM
with ocean ~0 and far less noise.

Tile URL pattern (SW corner = floor(lat),floor(lon)):
  .../Copernicus_DSM_COG_10_{NS}{LAT:02d}_00_{EW}{LON:03d}_00_DEM/...DEM.tif
e.g. Sydney (-33.87,151.21) -> S34 E151.

Reads the COG GeoTIFF with `tifffile` (pure-ish python, handles DEFLATE/LZW float32 via
imagecodecs). NO rasterio/gdal needed. Crops the covering tiles to the city bbox and saves a
north-up float32 grid to cache/<city>_dem.npy  -- the SAME filename/format build_map.py expects.

Run with a python that has tifffile installed, e.g.:
  python3.11 fetch_dem_cop.py sydney
(If `python3` lacks tifffile this script prints exactly that and exits without touching the
existing Terrarium cache, so fetch_dem.py remains a working fallback.)
"""

import sys, os, math
import numpy as np

try:
    import requests
except ImportError:
    raise SystemExit("Need 'requests': pip install --user requests numpy")

try:
    import tifffile
except ImportError:
    raise SystemExit(
        "[fetch_dem_cop] MISSING DEPENDENCY 'tifffile'.\n"
        "  Copernicus COG GeoTIFFs need tifffile (+imagecodecs for DEFLATE/LZW float32).\n"
        "  Install:  pip install --user --break-system-packages tifffile imagecodecs\n"
        "  Then run with the interpreter that has it (e.g. python3.11 fetch_dem_cop.py sydney).\n"
        "  The coarse Terrarium fetch_dem.py is left intact as a fallback."
    )

from cities import get

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "cache")
os.makedirs(CACHE, exist_ok=True)

# Copernicus DEM GLO-30 on AWS open data (no key).
S3_BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
PIX = 1.0 / 3600.0  # degrees per pixel (~30 m); each 1-deg tile is 3600x3600 float32.


def tile_name(lat_sw, lon_sw):
    """SW-corner tile id, e.g. (-34,151) -> Copernicus_DSM_COG_10_S34_00_E151_00_DEM."""
    ns = "N" if lat_sw >= 0 else "S"
    ew = "E" if lon_sw >= 0 else "W"
    return (
        f"Copernicus_DSM_COG_10_{ns}{abs(lat_sw):02d}_00_{ew}{abs(lon_sw):03d}_00_DEM"
    )


def tile_url(lat_sw, lon_sw):
    name = tile_name(lat_sw, lon_sw)
    return f"{S3_BASE}/{name}/{name}.tif"


def fetch_tile(lat_sw, lon_sw, sess):
    """Download (cached) one 1-degree Copernicus tile and return (array, lon0, lat0).
    array is north-up float32 [3600,3600]; lon0/lat0 = lon/lat of pixel (row=0,col=0) = NW corner.
    Returns (None, ...) if the tile is missing (e.g. all-ocean cells have no tile)."""
    name = tile_name(lat_sw, lon_sw)
    fn = os.path.join(CACHE, f"{name}.tif")
    if not (os.path.exists(fn) and os.path.getsize(fn) > 1000):
        url = tile_url(lat_sw, lon_sw)
        print(f"[fetch_dem_cop] downloading {name} ...")
        try:
            r = sess.get(url, timeout=120)
        except Exception as e:
            print(f"  download failed: {e}")
            return None, None, None, None
        if r.status_code != 200:
            print(
                f"  HTTP {r.status_code} for {url} (tile may be all-ocean / nonexistent)"
            )
            return None, None, None, None
        if r.status_code != 200:
            print(
                f"  HTTP {r.status_code} for {url} (tile may be all-ocean / nonexistent)"
            )
            return None, None, None
        open(fn, "wb").write(r.content)
        print(f"  saved {fn} ({len(r.content) // 1024 // 1024} MB)")
    else:
        print(f"[fetch_dem_cop] using cached {name}")
    try:
        tf = tifffile.TiffFile(fn)
        page = tf.pages[0]
        arr = page.asarray().astype(np.float32)
        # Geo: ModelTiepointTag maps pixel(0,0)->(lon,lat) at the NW corner; PixelScale = 1/3600.
        tie = page.tags.get("ModelTiepointTag")
        scale = page.tags.get("ModelPixelScaleTag")
        if tie is not None and scale is not None:
            v = tie.value
            lon0, lat0 = float(v[3]), float(v[4])  # NW corner (row 0, col 0)
            sx = float(scale.value[0])
            # use file's own geo (robust) -- but it matches the SW-corner convention.
            return arr, lon0, lat0, sx
        # Fallback to the naming convention (SW corner) if tags missing.
        return arr, float(lon_sw), float(lat_sw + 1), PIX
    except Exception as e:
        print(f"  tifffile read failed for {fn}: {e}")
    return None, None, None, None


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3.11 fetch_dem_cop.py <city>")
    city = sys.argv[1]
    info = get(city)
    west, south, east, north = info["bbox"]
    print(f"[fetch_dem_cop] {city}  bbox={info['bbox']}  source=Copernicus DEM GLO-30")

    # Which 1-degree SW-corner tiles cover the bbox.
    lon_tiles = range(int(math.floor(west)), int(math.floor(east)) + 1)
    lat_tiles = range(int(math.floor(south)), int(math.floor(north)) + 1)
    print(
        f"[fetch_dem_cop] tiles: "
        + ", ".join(tile_name(la, lo) for la in lat_tiles for lo in lon_tiles)
    )

    sess = requests.Session()
    sess.headers.update({"User-Agent": "city-battle-dem-cop/1.0"})

    # Build the output grid by sampling each output pixel from the covering tile.
    # Output is north-up: row 0 = north edge. Step = native Copernicus pixel (1/3600 deg).
    out_h = int(round((north - south) / PIX))
    out_w = int(round((east - west) / PIX))
    if out_h < 2 or out_w < 2:
        raise SystemExit("[fetch_dem_cop] bbox too small")
    print(f"[fetch_dem_cop] output grid {out_h} x {out_w} (north-up, ~30 m/px)")

    out = np.zeros((out_h, out_w), dtype=np.float32)

    # Cache tiles in memory once.
    tiles = {}
    for la in lat_tiles:
        for lo in lon_tiles:
            arr, lon0, lat0, sx = fetch_tile(la, lo, sess)
            if arr is not None:
                tiles[(la, lo)] = (arr, lon0, lat0, sx)

    if not tiles:
        raise SystemExit(
            "[fetch_dem_cop] no Copernicus tiles available for this bbox. "
            "Leaving existing Terrarium cache untouched."
        )

    missing = 0
    # For each output cell, find lon/lat (cell centre), pick its tile, nearest-sample.
    lats = north - (np.arange(out_h) + 0.5) * PIX  # north-up
    lons = west + (np.arange(out_w) + 0.5) * PIX
    for ri in range(out_h):
        lat = lats[ri]
        la_t = int(math.floor(lat))
        for ci in range(out_w):
            lon = lons[ci]
            lo_t = int(math.floor(lon))
            t = tiles.get((la_t, lo_t))
            if t is None:
                missing += 1
                out[ri, ci] = 0.0  # ocean / no tile -> sea level
                continue
            arr, lon0, lat0, sx = t
            col = int(round((lon - lon0) / sx))
            row = int(round((lat0 - lat) / sx))
            col = max(0, min(arr.shape[1] - 1, col))
            row = max(0, min(arr.shape[0] - 1, row))
            out[ri, ci] = arr[row, col]

    if missing:
        print(f"[fetch_dem_cop] {missing} cells had no tile (treated as 0 m / ocean)")

    out_fn = os.path.join(CACHE, f"{city}_dem.npy")
    np.save(out_fn, out)
    print(
        f"[fetch_dem_cop] saved {out_fn}  shape={out.shape}  "
        f"elev {out.min():.1f}..{out.max():.1f} m  mean {out.mean():.1f} m"
    )

    # --- sanity / accuracy report at known Sydney points ---
    def sample(lat, lon):
        if not (south <= lat <= north and west <= lon <= east):
            return None
        ri = int(round((north - lat) / PIX))
        ci = int(round((lon - west) / PIX))
        ri = max(0, min(out_h - 1, ri))
        ci = max(0, min(out_w - 1, ci))
        return float(out[ri, ci])

    checks = [
        ("Sydney CBD (Town Hall) ~20-40m", -33.8731, 151.2069),
        ("Sydney Opera House ~0-5m", -33.8568, 151.2153),
        ("North Head cliffs ~80-100m", -33.8237, 151.2920),
        ("Dover Heights cliffs ~70-90m", -33.8760, 151.2800),
        ("Harbour mid-water ~0m", -33.8520, 151.2300),
        ("Bondi Beach ~0-10m", -33.8908, 151.2743),
    ]
    print("[fetch_dem_cop] sample elevations (Copernicus):")
    for label, la, lo in checks:
        v = sample(la, lo)
        print(f"    {label:42s}  {('%.1f m' % v) if v is not None else 'outside bbox'}")


if __name__ == "__main__":
    main()
