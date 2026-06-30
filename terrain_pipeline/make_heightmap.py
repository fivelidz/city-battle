#!/usr/bin/env python3
"""
CITY BATTLE -- make_heightmap.py
Turn a stitched DEM (terrain_pipeline/raw/{city}_dem.npy, metres) into Unity-ready
heightmaps:

  out/{city}_height.png   16-bit grayscale PNG  (import as Texture2D / Unity heightmap)
  out/{city}_height.raw   16-bit little-endian RAW (Unity Terrain -> Import Raw)
  out/{city}_meta.json    bbox, resolution, real-world extents, recommended Unity size

Dependencies: numpy, pillow   (install: pip install --user numpy pillow)
rasterio is NOT required.

Usage:
  python3 make_heightmap.py san_francisco
  python3 make_heightmap.py san_francisco --resolution 1025 --exaggeration 1.5
"""

import sys
import os
import math
import json
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "raw")
OUT_DIR = os.path.join(HERE, "out")

# Bounding boxes live with the fetcher; import them so meta.json is accurate.
try:
    from fetch_dem import CITIES
except Exception:
    CITIES = {}


def _require_deps():
    missing = []
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        missing.append("pillow")
    if missing:
        print("ERROR: missing Python packages: " + ", ".join(missing))
        print("Install them with:")
        print("    pip install --user " + " ".join(missing))
        print("(rasterio is NOT required.)")
        sys.exit(2)


def resample_square(arr, size):
    """Resample a 2-D float array to (size x size) via PIL bilinear (float path)."""
    from PIL import Image
    import numpy as np

    # PIL 'F' mode = 32-bit float, supports bilinear resize cleanly.
    # Use the modern Resampling enum; fall back to the legacy constant on old Pillow.
    # Modern Pillow exposes Image.Resampling.BILINEAR; older Pillow used Image.BILINEAR.
    # Resolve dynamically so static analysers don't flag the legacy fallback.
    _resampling = getattr(Image, "Resampling", None)
    bilinear = getattr(_resampling, "BILINEAR", None) if _resampling else None
    if bilinear is None:
        bilinear = getattr(Image, "BILINEAR", 2)  # 2 == BILINEAR constant value
    img = Image.fromarray(arr.astype("float32"), mode="F")
    img = img.resize((size, size), bilinear)
    return np.asarray(img, dtype="float32")


def build(city, resolution=513, exaggeration=1.0):
    _require_deps()
    import numpy as np
    from PIL import Image

    os.makedirs(OUT_DIR, exist_ok=True)

    npy_path = os.path.join(RAW_DIR, "%s_dem.npy" % city)
    if not os.path.exists(npy_path):
        print("ERROR: %s not found. Run:  python3 fetch_dem.py %s" % (npy_path, city))
        sys.exit(1)

    elev = np.load(npy_path).astype("float32")  # row 0 = north, col 0 = west
    src_rows, src_cols = elev.shape
    print("Loaded %s  shape=%s" % (npy_path, str(elev.shape)))

    real_min = float(np.min(elev))
    real_max = float(np.max(elev))
    print("Source elevation min/max: %.1f m / %.1f m" % (real_min, real_max))

    # Resample to the Unity-friendly power-of-two-plus-one square.
    grid = resample_square(elev, resolution)

    # --- Coordinate convention -------------------------------------------------
    # Source array is [row, col] with row0=north, col0=west.
    # Unity Terrain heightmaps and our TerrainField use [x, z] with x=east (col)
    # and z=north (row). Unity's terrain origin is the SW corner with +Z = north,
    # so we flip rows vertically so that increasing index = increasing north.
    grid = np.flipud(grid)  # now row index increases northward (z), col = east (x)

    # --- Normalise to 16-bit ---------------------------------------------------
    span = real_max - real_min
    if span < 1e-6:
        span = 1.0  # perfectly flat -> avoid divide-by-zero
    norm = (grid - real_min) / span  # 0..1 over the real elevation range
    norm = np.clip(norm * exaggeration, 0.0, 1.0)
    h16 = np.round(norm * 65535.0).astype("uint16")

    # --- Real-world extents (equirectangular approximation) -------------------
    bbox = CITIES.get(city)
    if bbox is None:
        print("WARN: no bbox for '%s' in fetch_dem.CITIES; extents will be 0." % city)
        south = west = north = east = 0.0
    else:
        south, west, north, east = bbox
    mid_lat = (south + north) / 2.0
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(mid_lat))
    real_width_m = abs(east - west) * m_per_deg_lon  # X / east-west extent
    real_height_m = abs(north - south) * m_per_deg_lat  # Z / north-south extent

    # Recommended Unity Terrain size (metres). Width=X, Length=Z, Height=Y vertical.
    # Apply the same exaggeration to the vertical so the imported terrain matches.
    unity_width = round(real_width_m, 1)
    unity_length = round(real_height_m, 1)
    unity_height = round(span * exaggeration, 1)
    if unity_height < 1.0:
        unity_height = 1.0

    # --- Write PNG (16-bit grayscale) -----------------------------------------
    # Unity expects (and TerrainData uses) heightmap[y, x] row-major; for the PNG
    # we write rows top-to-bottom. We keep row0 = south (matches Unity SW origin),
    # i.e. as produced above. Unity's Import Raw + this PNG share orientation.
    png_path = os.path.join(OUT_DIR, "%s_height.png" % city)
    # Build a 16-bit grayscale image without the deprecated dtype-coercing 'mode='
    # argument: frombytes on an 'I;16' image takes raw little-endian 16-bit data.
    png_img = Image.frombytes(
        "I;16",
        (resolution, resolution),
        np.ascontiguousarray(h16).astype("<u2").tobytes(),
    )
    png_img.save(png_path)

    # --- Write RAW (16-bit little-endian) -------------------------------------
    # Unity "Import Raw" reads row-major 16-bit. Little-endian == byte order Windows.
    raw_path = os.path.join(OUT_DIR, "%s_height.raw" % city)
    h16.astype("<u2").tofile(raw_path)

    # --- Write meta.json -------------------------------------------------------
    meta = {
        "city": city,
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "source_shape": [src_rows, src_cols],
        "resolution": resolution,
        "real_min_m": round(real_min, 2),
        "real_max_m": round(real_max, 2),
        "real_width_m": round(real_width_m, 2),
        "real_height_m": round(real_height_m, 2),
        "vertical_exaggeration": exaggeration,
        "unity_terrain": {
            "heightmap_resolution": resolution,
            "size_width_m": unity_width,  # X axis (east-west)
            "size_length_m": unity_length,  # Z axis (north-south)
            "size_height_m": unity_height,  # Y axis (vertical, real span * exaggeration)
            "import_raw": {
                "bit_depth": 16,
                "byte_order": "little-endian (Windows)",
                "resolution": "%dx%d" % (resolution, resolution),
                "flip_vertically": False,
            },
        },
        "data_source": "AWS Terrain Tiles (Mapzen/Terrarium). Attribution required -- see README.md.",
        "encoding": "elevation_m = (R*256 + G + B/256) - 32768",
    }
    meta_path = os.path.join(OUT_DIR, "%s_meta.json" % city)
    with open(meta_path, "w") as fh:
        json.dump(meta, fh, indent=2)

    print("Wrote:")
    print("  %s" % png_path)
    print("  %s" % raw_path)
    print("  %s" % meta_path)
    print(
        "Resolution: %dx%d  exaggeration: %.2f" % (resolution, resolution, exaggeration)
    )
    print(
        "Real extents: %.0f m (W) x %.0f m (L), vertical span %.1f m"
        % (real_width_m, real_height_m, span)
    )
    print(
        "Recommended Unity Terrain size: W=%.1f L=%.1f H=%.1f (metres)"
        % (unity_width, unity_length, unity_height)
    )
    return meta


def main():
    ap = argparse.ArgumentParser(description="Build Unity heightmaps from a DEM .npy")
    ap.add_argument("city", help="city key (must match a fetched {city}_dem.npy)")
    ap.add_argument(
        "--resolution",
        type=int,
        default=513,
        help="output square size, Unity wants 2^n+1 (513,1025,2049). Default 513.",
    )
    ap.add_argument(
        "--exaggeration",
        type=float,
        default=1.0,
        help="vertical exaggeration for game drama (e.g. 1.5). Default 1.0.",
    )
    args = ap.parse_args()

    res = args.resolution
    if (res - 1) & (res - 2) != 0 or res < 33:
        # Not strictly fatal, but warn -- Unity terrain prefers 2^n + 1.
        print(
            "WARN: resolution %d is not 2^n+1 (e.g. 513,1025,2049). Continuing anyway."
            % res
        )

    build(args.city, resolution=res, exaggeration=args.exaggeration)


if __name__ == "__main__":
    main()
