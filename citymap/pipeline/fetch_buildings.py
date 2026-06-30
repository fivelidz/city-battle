#!/usr/bin/env python3
"""CITY BATTLE - fetch OSM building footprints + heights for a city bbox via Overpass.

No API key. Caches raw response. Outputs cache/<city>_buildings_raw.json with a simple list of
{ "footprint": [[lon,lat],...], "height_m": float, "levels": int, "name": str, "type": str }.

Usage: python3 fetch_buildings.py sydney_harbour
"""

import sys, os, json, time

try:
    import requests
except ImportError:
    raise SystemExit("Need 'requests': pip install --user requests")

from cities import get

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "cache")
os.makedirs(CACHE, exist_ok=True)

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
LEVEL_M = 3.1  # metres per building level when only levels are tagged
DEFAULT_M = 8.0  # fallback height


def query(bbox):
    west, south, east, north = bbox
    # Overpass bbox order is (south,west,north,east)
    bb = f"{south},{west},{north},{east}"
    # ways tagged building, then recurse down to their nodes, output both.
    return f'[out:json][timeout:90];(way["building"]({bb}););out body;>;out body;'


def fetch_raw(city, bbox):
    raw_fn = os.path.join(CACHE, f"{city}_osm.json")
    if os.path.exists(raw_fn) and os.path.getsize(raw_fn) > 100:
        print(f"[fetch_buildings] using cached {raw_fn}")
        return json.load(open(raw_fn))
    q = query(bbox)
    for ep in ENDPOINTS:
        try:
            print(f"[fetch_buildings] querying {ep} ...")
            r = requests.post(
                ep,
                data={"data": q},
                timeout=120,
                headers={"User-Agent": "city-battle/1.0"},
            )
            if r.status_code == 200:
                data = r.json()
                json.dump(data, open(raw_fn, "w"))
                print(
                    f"[fetch_buildings] cached {raw_fn} ({len(r.content) // 1024} KB)"
                )
                return data
            print(f"  HTTP {r.status_code}")
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(2)
    raise SystemExit(
        "[fetch_buildings] all Overpass endpoints failed; try again later."
    )


def parse(data):
    nodes = {}
    ways = []
    for el in data.get("elements", []):
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif el["type"] == "way" and "nodes" in el:
            ways.append(el)
    out = []
    for w in ways:
        tags = w.get("tags", {})
        if "building" not in tags:
            continue
        coords = [nodes[n] for n in w["nodes"] if n in nodes]
        if len(coords) < 3:
            continue
        # height
        h = None
        if "height" in tags:
            try:
                h = float(str(tags["height"]).replace("m", "").strip())
            except:
                pass
        if h is None and "building:levels" in tags:
            try:
                h = float(tags["building:levels"]) * LEVEL_M
            except:
                pass
        if h is None:
            h = DEFAULT_M
        lv = 0
        try:
            lv = int(float(tags.get("building:levels", 0)))
        except (ValueError, TypeError):
            lv = 0
        out.append(
            {
                "footprint": coords,
                "height_m": round(h, 1),
                "levels": lv,
                "name": tags.get("name", ""),
                "type": tags.get("building", "yes"),
            }
        )
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 fetch_buildings.py <city>")
    city = sys.argv[1]
    info = get(city)
    # Use the inner urban core for buildings if defined (large maps would have too many).
    bbox = info.get("buildings_bbox", info["bbox"])
    data = fetch_raw(city, bbox)
    buildings = parse(data)
    out_fn = os.path.join(CACHE, f"{city}_buildings_raw.json")
    json.dump(buildings, open(out_fn, "w"))
    heights = [b["height_m"] for b in buildings] or [0]
    print(f"[fetch_buildings] {len(buildings)} buildings -> {out_fn}")
    print(f"[fetch_buildings] height {min(heights):.0f}..{max(heights):.0f} m")


if __name__ == "__main__":
    main()
