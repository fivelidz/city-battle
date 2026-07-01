#!/usr/bin/env python3
"""CITY BATTLE - fetch OSM suburb/locality BOUNDARY POLYGONS for a city bbox via Overpass.

No API key. Caches raw. Outputs cache/<city>_suburbs_raw.json: a list of
{ "name": str, "rings": [[[lon,lat],...], ...] }  (outer ring(s) of each suburb boundary).

We pull administrative suburb boundaries (admin_level 9/10 in AU = suburb/locality) AND
place=suburb boundary relations, then stitch each relation's outer ways into closed rings.
These become the NEON BORDER outlines on the tactical map (replacing centroid rings).

Usage: python3 fetch_suburbs.py sydney
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


def query(bbox):
    west, south, east, north = bbox
    bb = f"{south},{west},{north},{east}"
    # AU suburbs are admin_level 9 (locality) / 10 (suburb). Grab boundary relations that carry
    # a name and are suburb/locality; include their ways + nodes so we can stitch rings.
    return (
        f"[out:json][timeout:180];"
        f"("
        f'  relation["boundary"="administrative"]["admin_level"~"^(9|10)$"]({bb});'
        f'  relation["place"~"^(suburb|neighbourhood|locality)$"]["type"="boundary"]({bb});'
        f");"
        f"out body;>;out skel qt;"
    )


def fetch_raw(city, bbox):
    raw_fn = os.path.join(CACHE, f"{city}_suburbs_osm.json")
    if os.path.exists(raw_fn) and os.path.getsize(raw_fn) > 100:
        print(f"[fetch_suburbs] using cached {raw_fn}")
        return json.load(open(raw_fn))
    q = query(bbox)
    for ep in ENDPOINTS:
        try:
            print(f"[fetch_suburbs] querying {ep} ...")
            r = requests.post(
                ep,
                data={"data": q},
                timeout=200,
                headers={"User-Agent": "city-battle/1.0"},
            )
            if r.status_code == 200:
                data = r.json()
                json.dump(data, open(raw_fn, "w"))
                print(f"[fetch_suburbs] cached {raw_fn} ({len(r.content) // 1024} KB)")
                return data
            print(f"  HTTP {r.status_code}")
        except Exception as e:
            print(f"  failed: {e}")
        time.sleep(2)
    raise SystemExit("[fetch_suburbs] all Overpass endpoints failed; try again later.")


def stitch_rings(way_ids, ways):
    """Stitch a list of way ids (each a list of (lon,lat)) into closed ring(s)."""
    segs = [list(ways[w]) for w in way_ids if w in ways and len(ways[w]) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed and segs:
            changed = False
            for i, s in enumerate(segs):
                if ring[-1] == s[0]:
                    ring += s[1:]
                    segs.pop(i)
                    changed = True
                    break
                if ring[-1] == s[-1]:
                    ring += list(reversed(s))[1:]
                    segs.pop(i)
                    changed = True
                    break
                if ring[0] == s[-1]:
                    ring = s[:-1] + ring
                    segs.pop(i)
                    changed = True
                    break
                if ring[0] == s[0]:
                    ring = list(reversed(s))[:-1] + ring
                    segs.pop(i)
                    changed = True
                    break
        rings.append(ring)
    # keep rings with enough points; simplify very dense ones
    out = []
    for r in rings:
        if len(r) >= 4:
            out.append(
                simplify(r, 6)
            )  # drop points closer than ~ a few metres of lon/lat
    return out


def simplify(ring, keep_every):
    if len(ring) <= 8:
        return ring
    out = ring[:: max(1, len(ring) // 200)]  # cap ~200 pts per ring
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def parse(data):
    nodes = {}
    ways = {}
    rels = []
    for el in data.get("elements", []):
        t = el["type"]
        if t == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif t == "way":
            ways[el["id"]] = el.get("nodes", [])
        elif t == "relation":
            rels.append(el)
    # resolve way node-id lists to coord lists
    way_coords = {}
    for wid, nids in ways.items():
        cs = [nodes[n] for n in nids if n in nodes]
        if len(cs) >= 2:
            way_coords[wid] = cs
    out = []
    for rel in rels:
        tags = rel.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        outer = [
            m["ref"]
            for m in rel.get("members", [])
            if m.get("type") == "way" and m.get("role") in ("outer", "")
        ]
        if not outer:
            continue
        rings = stitch_rings(outer, way_coords)
        rings = [r for r in rings if len(r) >= 4]
        if rings:
            out.append({"name": name, "rings": rings})
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 fetch_suburbs.py <city>")
    city = sys.argv[1]
    info = get(city)
    data = fetch_raw(city, info["bbox"])
    subs = parse(data)
    out_fn = os.path.join(CACHE, f"{city}_suburbs_raw.json")
    json.dump(subs, open(out_fn, "w"))
    npts = sum(len(r) for s in subs for r in s["rings"])
    print(f"[fetch_suburbs] {len(subs)} suburbs, {npts} boundary points -> {out_fn}")
    for s in subs[:8]:
        print(f"  - {s['name']}: {len(s['rings'])} ring(s)")


if __name__ == "__main__":
    main()
