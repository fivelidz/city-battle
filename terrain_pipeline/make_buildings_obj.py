#!/usr/bin/env python3
# CITY BATTLE -- make_buildings_obj.py
# ---------------------------------------------------------------------------
# Read out/{city}_buildings.json (footprints in local metres + height) and the
# city's DEM, and EXTRUDE each footprint into a 3D box mesh sitting on the
# terrain:
#   - base Y  = terrain height under the footprint centroid (from the DEM)
#   - top  Y  = base + height_m
#
# Writes a single combined Wavefront .OBJ to out/{city}_buildings.obj
# (vertices + faces only -- no materials). Suitable for Unity import OR 3D
# printing (combine with the terrain STL -- see README "3D Printing City Models").
#
# Coordinate frame matches the rest of the pipeline:
#   x = east  (Unity +X),  z = north (Unity +Z),  y = up (metres).
# In the OBJ we emit (x, y, z) directly; Unity's importer treats OBJ as a
# right-handed mesh -- the building footprints already share the heightmap's
# local-metre origin (bbox SW corner), so they line up with the terrain.
#
# DEM sampling: the DEM .npy is [row, col] with row0 = NORTH, col0 = WEST
# (per fetch_dem.py). We map a local-metre (x, z) to fractional (col, row) and
# bilinearly sample. If the .npy is missing we fall back to a flat base at 0 m
# and warn.
#
# Dependency-light: numpy + json only.
# ---------------------------------------------------------------------------
import sys
import os
import math
import json
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
RAW_DIR = os.path.join(HERE, "raw")


def _require_deps():
    try:
        import numpy  # noqa: F401
    except ImportError:
        print("ERROR: missing Python package: numpy")
        print("Install it with:")
        print("    pip install --user numpy")
        sys.exit(2)


def _load_cities():
    sys.path.insert(0, HERE)
    try:
        from fetch_dem import CITIES
    except Exception as exc:  # pragma: no cover
        print("ERROR: could not import CITIES from fetch_dem.py: %s" % exc)
        sys.exit(1)
    return CITIES


class TerrainSampler:
    """Bilinear DEM sampler in LOCAL METRES (x=east, z=north), SW-corner origin.

    The DEM array is [row, col], row0=north, col0=west. We have the bbox and the
    real-world extent (metres), so local-metre -> fractional array index is a
    straight linear map, then bilinear interpolate."""

    def __init__(self, elev, width_m, length_m):
        import numpy as np

        self.elev = elev
        self.rows, self.cols = elev.shape  # rows=N-S, cols=W-E
        self.width_m = width_m  # east-west extent (x)
        self.length_m = length_m  # north-south extent (z)
        self.min = float(np.min(elev))
        self.max = float(np.max(elev))

    def height_at(self, x_m, z_m):
        # x in [0, width] maps to col in [0, cols-1]
        # z in [0, length] maps to row, but row0 = NORTH = z_max, so flip.
        if self.width_m <= 0 or self.length_m <= 0:
            return 0.0
        fc = (x_m / self.width_m) * (self.cols - 1)
        fr = (1.0 - (z_m / self.length_m)) * (self.rows - 1)  # north-up flip
        # clamp into the grid
        fc = min(max(fc, 0.0), self.cols - 1)
        fr = min(max(fr, 0.0), self.rows - 1)
        c0 = int(math.floor(fc))
        c1 = min(c0 + 1, self.cols - 1)
        r0 = int(math.floor(fr))
        r1 = min(r0 + 1, self.rows - 1)
        tc = fc - c0
        tr = fr - r0
        e = self.elev
        h00 = e[r0, c0]
        h01 = e[r0, c1]
        h10 = e[r1, c0]
        h11 = e[r1, c1]
        h0 = h00 * (1 - tc) + h01 * tc
        h1 = h10 * (1 - tc) + h11 * tc
        return float(h0 * (1 - tr) + h1 * tr)


class FlatSampler:
    min = 0.0
    max = 0.0

    def height_at(self, x_m, z_m):
        return 0.0


def load_sampler(city, cities):
    """Build a TerrainSampler from raw/{city}_dem.npy, else a flat fallback."""
    import numpy as np

    npy_path = os.path.join(RAW_DIR, "%s_dem.npy" % city)
    if not os.path.exists(npy_path):
        print("WARN: %s not found -- buildings will sit on a flat 0 m base." % npy_path)
        print("      Run:  python3 fetch_dem.py %s   for real terrain bases." % city)
        return FlatSampler(), 0.0, 0.0

    elev = np.load(npy_path).astype("float32")
    bbox = cities[city]
    south, west, north, east = bbox
    mid_lat = (south + north) / 2.0
    width_m = abs(east - west) * 111320.0 * math.cos(math.radians(mid_lat))
    length_m = abs(north - south) * 111320.0
    print(
        "Loaded DEM %s shape=%s  extent=%.0fm x %.0fm  elev %.1f..%.1f m"
        % (
            os.path.basename(npy_path),
            elev.shape,
            width_m,
            length_m,
            float(np.min(elev)),
            float(np.max(elev)),
        )
    )
    return TerrainSampler(elev, width_m, length_m), width_m, length_m


def centroid(poly):
    sx = sum(p[0] for p in poly)
    sz = sum(p[1] for p in poly)
    n = len(poly)
    return sx / n, sz / n


def signed_area(poly):
    """Shoelace signed area in the x-z plane (>0 = CCW)."""
    a = 0.0
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        a += x0 * z1 - x1 * z0
    return a * 0.5


def build_obj(city, buildings, sampler, base_min=None):
    """Extrude every footprint into a prism; return (obj_lines, n_verts, n_faces).

    Each building becomes:
      - a bottom ring at base Y and a top ring at base+height
      - quad side walls (2 triangles each)
      - a flat top cap (fan triangulation -- fine for convex-ish footprints,
        acceptable for printing/occlusion on concave ones)
    We skip the bottom cap (buildings sit on the terrain; the base is hidden),
    which halves the cap triangles. For a watertight print, Blender's "make
    manifold" closes any gaps after merging with the terrain (see README)."""
    lines = [
        "# CITY BATTLE buildings -- %s" % city,
        "# Extruded OSM footprints on DEM terrain. Units: metres.",
        "# x=east, y=up, z=north. OSM data (c) OpenStreetMap contributors (ODbL).",
        "o %s_buildings" % city,
    ]
    vbuf = []  # vertex lines
    fbuf = []  # face lines
    vcount = 0
    n_faces = 0
    n_buildings = 0

    for b in buildings:
        poly = b.get("polygon")
        if not poly or len(poly) < 3:
            continue
        h = float(b.get("height_m", 8.0))
        if h <= 0.0:
            h = 8.0  # guard zero/negative tagged heights

        # Ensure consistent winding (CCW) so top-cap normals point up.
        if signed_area(poly) < 0:
            poly = list(reversed(poly))

        cx, cz = centroid(poly)
        base = sampler.height_at(cx, cz)
        top = base + h
        m = len(poly)

        # Emit bottom ring then top ring. OBJ indices are 1-based.
        base_idx = vcount + 1
        for x, z in poly:
            vbuf.append("v %.3f %.3f %.3f" % (x, base, z))
        for x, z in poly:
            vbuf.append("v %.3f %.3f %.3f" % (x, top, z))
        vcount += 2 * m

        bot = base_idx  # bottom ring start
        topr = base_idx + m  # top ring start

        # Side walls: for edge i->i+1, quad (bot_i, bot_i1, top_i1, top_i).
        for i in range(m):
            j = (i + 1) % m
            b0 = bot + i
            b1 = bot + j
            t0 = topr + i
            t1 = topr + j
            # two triangles, outward-facing (CCW from outside)
            fbuf.append("f %d %d %d" % (b0, b1, t1))
            fbuf.append("f %d %d %d" % (b0, t1, t0))
            n_faces += 2

        # Top cap: fan from first top vertex.
        for i in range(1, m - 1):
            fbuf.append("f %d %d %d" % (topr, topr + i, topr + i + 1))
            n_faces += 1

        n_buildings += 1

    lines.extend(vbuf)
    lines.extend(fbuf)
    return lines, vcount, n_faces, n_buildings


def run(city, force=False):
    _require_deps()
    cities = _load_cities()
    if city not in cities:
        print("Unknown city: %s" % city)
        print("Available: " + ", ".join(sorted(cities)))
        sys.exit(1)

    json_path = os.path.join(OUT_DIR, "%s_buildings.json" % city)
    if not os.path.exists(json_path):
        print(
            "ERROR: %s not found. Run:  python3 fetch_buildings.py %s"
            % (json_path, city)
        )
        sys.exit(1)

    with open(json_path, "r") as fh:
        buildings = json.load(fh)
    print("Loaded %d building footprints from %s" % (len(buildings), json_path))

    sampler, width_m, length_m = load_sampler(city, cities)

    lines, n_verts, n_faces, n_built = build_obj(city, buildings, sampler)

    os.makedirs(OUT_DIR, exist_ok=True)
    obj_path = os.path.join(OUT_DIR, "%s_buildings.obj" % city)
    with open(obj_path, "w") as fh:
        fh.write("\n".join(lines))
        fh.write("\n")

    size = os.path.getsize(obj_path)
    print("")
    print(
        "Extruded %d buildings (skipped %d empty)."
        % (n_built, len(buildings) - n_built)
    )
    print("Vertices: %d   Faces (triangles): %d" % (n_verts, n_faces))
    print("Wrote: %s (%s)" % (obj_path, _fmt_size(size)))
    return obj_path


def _fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0


def main():
    ap = argparse.ArgumentParser(
        description="Extrude OSM building footprints onto the DEM into a combined OBJ."
    )
    ap.add_argument("city", help="city key (needs out/{city}_buildings.json)")
    args = ap.parse_args()
    run(args.city)


if __name__ == "__main__":
    main()
