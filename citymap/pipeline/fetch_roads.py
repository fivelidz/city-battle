#!/usr/bin/env python3
"""CITY BATTLE - fetch OSM roads (highways) for a city bbox via Overpass.

No API key. Caches raw. Outputs cache/<city>_roads_raw.json: a list of
{ "path": [[lon,lat],...], "kind": "<highway class>", "name": str }.
Road kind drives width/importance when rendered (motorway/primary/secondary/residential...).

Usage: python3 fetch_roads.py sydney
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

# Which highway classes to keep (skip footways/paths/service to keep it tactical).
KEEP = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "residential",
    "unclassified",
    "living_street",
}


def query(bbox):
    west, south, east, north = bbox
    bb = f"{south},{west},{north},{east}"
    return f'[out:json][timeout:120];(way["highway"]({bb}););out body;>;out body;'


def fetch_raw(city, bbox):
    raw_fn = os.path.join(CACHE, f"{city}_roads_osm.json")
    if os.path.exists(raw_fn) and os.path.getsize(raw_fn) > 100:
        print(f"[fetch_roads] using cached {raw_fn}")
        return json.load(open(raw_fn))
    q = query(bbox)
    for ep in ENDPOINTS:
        try:
            print(f"[fetch_roads] querying {ep} ...")
            r = requests.post(
                ep,
                data={"data": q},
                timeout=150,
                headers={"User-Agent": "city-battle/1.0"},
            )
            if r.status_code == 200:
                data = r.json()
                json.dump(data, open(raw_fn, "w"))
                print(f"[fetch_roads] cached {raw_fn} ({len(r.content) // 1024} KB)")
                return data
            print(f"  HTTP {r.status_code}")
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(2)
    raise SystemExit("[fetch_roads] all Overpass endpoints failed; try again later.")


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
        kind = tags.get("highway", "")
        if kind not in KEEP:
            continue
        coords = [nodes[n] for n in w["nodes"] if n in nodes]
        if len(coords) < 2:
            continue
        out.append({"path": coords, "kind": kind, "name": tags.get("name", "")})
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 fetch_roads.py <city>")
    city = sys.argv[1]
    info = get(city)
    bbox = info["bbox"]  # whole map
    data = fetch_raw(city, bbox)
    roads = parse(data)
    out_fn = os.path.join(CACHE, f"{city}_roads_raw.json")
    json.dump(roads, open(out_fn, "w"))
    kinds = {}
    for r in roads:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"[fetch_roads] {len(roads)} roads -> {out_fn}")
    print(f"[fetch_roads] by kind: {dict(sorted(kinds.items(), key=lambda x: -x[1]))}")


if __name__ == "__main__":
    main()
