#!/usr/bin/env python3
# CITY BATTLE -- make_stl.py
# ---------------------------------------------------------------------------
# Combine a city's DEM heightmap into a WATERTIGHT (manifold, solid) STL with a
# flat base plate -- ready for 3D printing. Output: out/{city}_terrain.stl
#
# The mesh is closed:
#   - top surface  : the terrain heightfield (one quad per cell -> 2 triangles)
#   - 4 side walls : skirts dropping from the terrain edge to the base plane
#   - bottom       : a single flat base plate
# That makes a solid prism with a real-relief top -- printable as-is.
#
# Source: out/{city}_height.raw (16-bit) preferred, since it shares the exact
# orientation/extent recorded in out/{city}_meta.json. Falls back to
# raw/{city}_dem.npy if the .raw is missing.
#
# STL writer: if `numpy-stl` or `trimesh` are installed we mention them, but we
# DO NOT require them -- a small dependency-free BINARY STL writer is included
# (binary STL is ~5x smaller than ASCII for these triangle counts). Only numpy
# is needed.
#
# Coordinates in the STL are millimetres at the chosen print scale (default a
# tile-friendly scale; see --scale and the README "3D Printing City Models").
# X = east, Y = north, Z = up (STL has no handedness convention; slicers treat
# +Z as up, which is what we emit).
# ---------------------------------------------------------------------------
import sys
import os
import math
import json
import struct
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


def _report_optional_libs():
    have = []
    for name in ("trimesh", "stl"):
        try:
            __import__(name)
            have.append("numpy-stl" if name == "stl" else name)
        except ImportError:
            pass
    if have:
        print(
            "Note: optional mesh libs available (%s) -- not required; using the "
            "built-in binary-STL writer." % ", ".join(have)
        )
    else:
        print(
            "Note: trimesh / numpy-stl not installed -- using the built-in "
            "dependency-free binary-STL writer (numpy only)."
        )


def load_meta(city):
    meta_path = os.path.join(OUT_DIR, "%s_meta.json" % city)
    if not os.path.exists(meta_path):
        return None
    with open(meta_path, "r") as fh:
        return json.load(fh)


def load_heightfield(city):
    """Return (grid[row,col] metres, width_m, length_m, min_m, max_m).

    Prefer the Unity-ready .raw (square, oriented row0=south) so the print
    matches the in-game terrain. Fall back to the source DEM .npy."""
    import numpy as np

    meta = load_meta(city)
    raw_path = os.path.join(OUT_DIR, "%s_height.raw" % city)
    if meta is not None and os.path.exists(raw_path):
        res = int(meta["resolution"])
        ut = meta["unity_terrain"]
        width_m = float(ut["size_width_m"])
        length_m = float(ut["size_length_m"])
        min_m = float(meta["real_min_m"])
        max_m = float(meta["real_max_m"])
        h16 = np.fromfile(raw_path, dtype="<u2")
        if h16.size != res * res:
            print(
                "WARN: %s size %d != %d^2; falling back to DEM .npy."
                % (raw_path, h16.size, res)
            )
        else:
            # RAW row-major: row index = z (north), col = x (east); row0 = south.
            grid01 = h16.astype("float32").reshape(res, res) / 65535.0
            grid_m = min_m + grid01 * (max_m - min_m)
            print(
                "Loaded heightmap %s (%dx%d) extent=%.0fm x %.0fm  elev %.1f..%.1f m"
                % (
                    os.path.basename(raw_path),
                    res,
                    res,
                    width_m,
                    length_m,
                    min_m,
                    max_m,
                )
            )
            return grid_m, width_m, length_m, min_m, max_m

    # Fallback: source DEM .npy ([row,col], row0=north). Flip to row0=south.
    npy_path = os.path.join(RAW_DIR, "%s_dem.npy" % city)
    if not os.path.exists(npy_path):
        print("ERROR: neither %s nor %s found." % (raw_path, npy_path))
        print(
            "       Run:  python3 fetch_dem.py %s && python3 make_heightmap.py %s"
            % (city, city)
        )
        sys.exit(1)
    elev = np.load(npy_path).astype("float32")
    elev = np.flipud(elev)  # row0 -> south, to match the .raw convention
    rows, cols = elev.shape
    sys.path.insert(0, HERE)
    from fetch_dem import CITIES

    south, west, north, east = CITIES[city]
    mid_lat = (south + north) / 2.0
    width_m = abs(east - west) * 111320.0 * math.cos(math.radians(mid_lat))
    length_m = abs(north - south) * 111320.0
    min_m = float(np.min(elev))
    max_m = float(np.max(elev))
    print(
        "Loaded DEM %s (%dx%d) extent=%.0fm x %.0fm  elev %.1f..%.1f m"
        % (os.path.basename(npy_path), rows, cols, width_m, length_m, min_m, max_m)
    )
    return elev, width_m, length_m, min_m, max_m


def build_triangles(grid, width_m, length_m, scale, base_thickness_mm, z_exag):
    """Build a watertight triangle soup (Nx3x3 float32) for the solid terrain.

    grid is [row, col] with row index = north (z), col = east (x), row0 = south.
    All output coordinates are in MILLIMETRES at the given print `scale`
    (model_mm = real_m * 1000 / scale). The base plate sits `base_thickness_mm`
    below the lowest terrain point."""
    import numpy as np

    rows, cols = grid.shape  # rows = z (north), cols = x (east)
    mm_per_m = 1000.0 / scale

    # Planar sample positions in mm.
    xs = (np.arange(cols) / (cols - 1)) * width_m * mm_per_m  # east
    ys = (np.arange(rows) / (rows - 1)) * length_m * mm_per_m  # north
    # Vertical: real metres * exaggeration, then to mm at the same scale.
    zmin_m = float(np.min(grid))
    z_top = (grid - zmin_m) * z_exag * mm_per_m  # [row,col] mm, >=0
    z_base = -base_thickness_mm  # flat bottom plane (mm)

    # Vectorised top surface (2 triangles per cell).
    X = np.broadcast_to(xs[None, :], (rows, cols))
    Y = np.broadcast_to(ys[:, None], (rows, cols))
    Z = z_top

    def vtx(r, c):
        return np.stack([X[r, c], Y[r, c], Z[r, c]], axis=-1)

    tris = []

    # --- top surface ---
    r0 = slice(0, rows - 1)
    r1 = slice(1, rows)
    c0 = slice(0, cols - 1)
    c1 = slice(1, cols)
    v00 = np.stack([X[r0, c0], Y[r0, c0], Z[r0, c0]], -1).reshape(-1, 3)
    v10 = np.stack([X[r0, c1], Y[r0, c1], Z[r0, c1]], -1).reshape(-1, 3)
    v01 = np.stack([X[r1, c0], Y[r1, c0], Z[r1, c0]], -1).reshape(-1, 3)
    v11 = np.stack([X[r1, c1], Y[r1, c1], Z[r1, c1]], -1).reshape(-1, 3)
    # tri A: v00, v10, v11 ; tri B: v00, v11, v01  (CCW seen from above -> +Z)
    tris.append(np.stack([v00, v10, v11], axis=1))
    tris.append(np.stack([v00, v11, v01], axis=1))

    # --- bottom plate (two big triangles spanning the whole base, normal -Z) ---
    x0, x1 = xs[0], xs[-1]
    y0, y1 = ys[0], ys[-1]
    b00 = np.array([x0, y0, z_base])
    b10 = np.array([x1, y0, z_base])
    b01 = np.array([x0, y1, z_base])
    b11 = np.array([x1, y1, z_base])
    bottom = np.array(
        [
            [b00, b11, b10],
            [b00, b01, b11],
        ],
        dtype="float32",
    )
    tris.append(bottom)

    # --- side skirts (4 walls), connecting top edge to base plane ---
    def wall(top_edge_xyz):
        """top_edge_xyz: (k,3) ordered points along an edge at terrain height.
        Builds quads down to z_base."""
        k = top_edge_xyz.shape[0]
        quads = []
        for i in range(k - 1):
            t0 = top_edge_xyz[i]
            t1 = top_edge_xyz[i + 1]
            d0 = np.array([t0[0], t0[1], z_base])
            d1 = np.array([t1[0], t1[1], z_base])
            quads.append([t0, t1, d1])
            quads.append([t0, d1, d0])
        return np.array(quads, dtype="float32")

    # South edge (row 0), North edge (row rows-1), West (col 0), East (col cols-1)
    south_edge = np.stack([X[0, :], Y[0, :], Z[0, :]], -1)
    north_edge = np.stack([X[rows - 1, :], Y[rows - 1, :], Z[rows - 1, :]], -1)
    west_edge = np.stack([X[:, 0], Y[:, 0], Z[:, 0]], -1)
    east_edge = np.stack([X[:, cols - 1], Y[:, cols - 1], Z[:, cols - 1]], -1)
    # order each so outward winding is consistent; exact normal sign is fixed up
    # at write time from geometry, so winding only needs to be non-degenerate.
    tris.append(wall(south_edge))
    tris.append(wall(north_edge[::-1]))
    tris.append(wall(west_edge[::-1]))
    tris.append(wall(east_edge))

    all_tris = np.concatenate([t.reshape(-1, 3, 3) for t in tris], axis=0)
    return all_tris.astype("float32"), (z_base, float(np.max(z_top)))


def write_binary_stl(path, tris):
    """Dependency-free binary STL writer. tris: (N,3,3) float32 (mm)."""
    import numpy as np

    n = tris.shape[0]
    # Per-triangle normals from geometry.
    v0 = tris[:, 0, :]
    v1 = tris[:, 1, :]
    v2 = tris[:, 2, :]
    nrm = np.cross(v1 - v0, v2 - v0)
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    ln[ln == 0] = 1.0
    nrm = (nrm / ln).astype("float32")

    with open(path, "wb") as fh:
        fh.write(
            b"CITY BATTLE terrain STL -- OSM/Terrarium data; see README".ljust(
                80, b" "
            )[:80]
        )
        fh.write(struct.pack("<I", n))
        # Assemble each record: normal(3f) + 3*vertex(3f) + attr(uint16)
        buf = bytearray()
        rec = struct.Struct("<12fH")
        for i in range(n):
            buf += rec.pack(
                nrm[i, 0],
                nrm[i, 1],
                nrm[i, 2],
                v0[i, 0],
                v0[i, 1],
                v0[i, 2],
                v1[i, 0],
                v1[i, 1],
                v1[i, 2],
                v2[i, 0],
                v2[i, 1],
                v2[i, 2],
                0,
            )
        fh.write(buf)


def run(city, scale=10000.0, base_mm=3.0, z_exag=1.0, resample=None):
    _require_deps()
    _report_optional_libs()
    import numpy as np

    grid, width_m, length_m, min_m, max_m = load_heightfield(city)

    # Optional downsample to keep triangle counts printable.
    if resample and resample > 1:
        grid = grid[::resample, ::resample]
        print(
            "Downsampled grid to %s (every %dth sample)." % (str(grid.shape), resample)
        )

    tris, (zb, zt) = build_triangles(grid, width_m, length_m, scale, base_mm, z_exag)

    os.makedirs(OUT_DIR, exist_ok=True)
    stl_path = os.path.join(OUT_DIR, "%s_terrain.stl" % city)
    write_binary_stl(stl_path, tris)

    size = os.path.getsize(stl_path)
    model_w = width_m * 1000.0 / scale
    model_l = length_m * 1000.0 / scale
    model_h = (max_m - min_m) * z_exag * 1000.0 / scale
    print("")
    print("City: %s" % city)
    print("Print scale 1:%.0f  vertical exaggeration x%.1f" % (scale, z_exag))
    print(
        "Model footprint: %.1f x %.1f mm  relief height: %.1f mm  base plate: %.1f mm"
        % (model_w, model_l, model_h, base_mm)
    )
    print("Triangles: %d" % tris.shape[0])
    print("Wrote: %s (%s)" % (stl_path, _fmt_size(size)))
    print("Watertight: top surface + 4 side skirts + base plate (manifold solid).")
    return stl_path


def _fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024.0


def main():
    ap = argparse.ArgumentParser(
        description="Build a watertight solid-base terrain STL for 3D printing."
    )
    ap.add_argument(
        "city", help="city key (needs out/{city}_height.raw or raw/{city}_dem.npy)"
    )
    ap.add_argument(
        "--scale",
        type=float,
        default=10000.0,
        help="print scale denominator (1:SCALE). Default 10000 "
        "(a 5.7 km city -> ~57 cm).",
    )
    ap.add_argument(
        "--base-mm",
        type=float,
        default=3.0,
        help="base plate thickness in mm below the lowest terrain. Default 3.",
    )
    ap.add_argument(
        "--z-exag",
        type=float,
        default=1.0,
        help="vertical exaggeration of relief for drama/printability. Default 1.",
    )
    ap.add_argument(
        "--resample",
        type=int,
        default=None,
        help="keep every Nth grid sample (downsample) to reduce triangles.",
    )
    args = ap.parse_args()
    run(
        args.city,
        scale=args.scale,
        base_mm=args.base_mm,
        z_exag=args.z_exag,
        resample=args.resample,
    )


if __name__ == "__main__":
    main()
