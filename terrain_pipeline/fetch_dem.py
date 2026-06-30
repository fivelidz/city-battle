#!/usr/bin/env python3
"""
CITY BATTLE -- fetch_dem.py
Download real-world elevation for a city's bounding box and stitch it into a
metres-elevation numpy array, saved as terrain_pipeline/raw/{city}_dem.npy.

DATA SOURCE: AWS Terrain Tiles (Mapzen / Terrarium), a FREE, open, NO-API-KEY dataset.
  PNG tiles at: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
  Terrarium encoding:  elevation_m = (R * 256 + G + B / 256) - 32768
  Underlying data: SRTM / various open DEMs, contributed via OpenStreetMap / Mapzen.
  Attribution required -- see README.md.

This intentionally does NOT use rasterio or any heavy GIS stack. It needs only:
  numpy, requests, pillow  (install: pip install --user numpy requests pillow)

Usage:
  python3 fetch_dem.py san_francisco
  python3 fetch_dem.py sydney --zoom 12
  python3 fetch_dem.py --list
"""

import sys
import os
import math
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "cache")
RAW_DIR = os.path.join(HERE, "raw")

# Tile server (Terrarium-encoded PNGs). No API key needed.
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE_SIZE = 256  # px per side


# ---------------------------------------------------------------------------
# Dependency check -- degrade gracefully with clear instructions.
# ---------------------------------------------------------------------------
def _require_deps():
    missing = []
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    try:
        import requests  # noqa: F401
    except ImportError:
        missing.append("requests")
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        missing.append("pillow")
    if missing:
        print("ERROR: missing Python packages: " + ", ".join(missing))
        print("Install them with:")
        print("    pip install --user " + " ".join(missing))
        print(
            "(Note: rasterio is NOT required -- this pipeline uses the tile approach.)"
        )
        sys.exit(2)


# ---------------------------------------------------------------------------
# Built-in bounding boxes. Each is (south_lat, west_lon, north_lat, east_lon),
# roughly 5-8 km on a side, centred on each city's most dramatic terrain.
# ---------------------------------------------------------------------------
CITIES = {
    # SF: capture Twin Peaks / the hilly central spine.
    "san_francisco": (37.730, -122.470, 37.800, -122.405),
    # NYC: Manhattan + a slice of the Palisades cliffs across the Hudson.
    "new_york": (40.745, -74.020, 40.800, -73.960),
    # Sydney: harbour + the eastern ridgelines.
    "sydney": (-33.890, 151.190, -33.835, 151.260),
    # London: the Thames valley up to Hampstead Heath's high ground.
    "london": (51.500, -0.180, 51.560, -0.090),
    # Tokyo: bay flats rising toward the western hills.
    "tokyo": (35.640, 139.690, 35.700, 139.760),
    # Hong Kong: Victoria Peak and the steep harbour walls.
    "hong_kong": (22.250, 114.130, 22.300, 114.195),
    # Tehran: the dramatic rise into the Alborz foothills to the north.
    "tehran": (35.760, 51.380, 35.830, 51.460),
    # Shenzhen: coastal plain meeting the inland hills.
    "shenzhen": (22.520, 114.030, 22.580, 114.110),
    # Gaza: the coastal strip and low dune ridges.
    "gaza": (31.480, 34.420, 31.540, 34.490),
}


# ---------------------------------------------------------------------------
# Web-mercator tile maths.
# ---------------------------------------------------------------------------
def lonlat_to_tile_frac(lon, lat, z):
    """Return fractional tile coords (x, y) for a lon/lat at zoom z."""
    lat_rad = math.radians(lat)
    n = 2.0**z
    x = (lon + 180.0) / 360.0 * n
    y = (
        (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi)
        / 2.0
        * n
    )
    return x, y


def fetch(city, zoom=12, force=False):
    _require_deps()
    import numpy as np
    import requests
    from PIL import Image
    import io

    if city not in CITIES:
        print("Unknown city: %s" % city)
        print("Available: " + ", ".join(sorted(CITIES)))
        sys.exit(1)

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(RAW_DIR, exist_ok=True)

    south, west, north, east = CITIES[city]
    print("City: %s" % city)
    print("BBox (S,W,N,E): %.5f, %.5f, %.5f, %.5f" % (south, west, north, east))
    print("Zoom: %d" % zoom)

    # Fractional tile coords for the bbox corners.
    # NW corner = (west, north); SE corner = (east, south).
    fx_w, fy_n = lonlat_to_tile_frac(west, north, zoom)
    fx_e, fy_s = lonlat_to_tile_frac(east, south, zoom)

    x_min = int(math.floor(fx_w))
    x_max = int(math.floor(fx_e))
    y_min = int(math.floor(fy_n))
    y_max = int(math.floor(fy_s))

    nx = x_max - x_min + 1
    ny = y_max - y_min + 1
    print(
        "Tile range: x[%d..%d] y[%d..%d]  (%d x %d = %d tiles)"
        % (x_min, x_max, y_min, y_max, nx, ny, nx * ny)
    )

    # Allocate the stitched RGB mosaic.
    mosaic = np.zeros((ny * TILE_SIZE, nx * TILE_SIZE, 3), dtype=np.float64)

    session = requests.Session()
    session.headers.update({"User-Agent": "CityBattle-terrain-pipeline/1.0"})

    n_downloaded = 0
    n_cached = 0
    n_missing = 0
    for ty in range(y_min, y_max + 1):
        for tx in range(x_min, x_max + 1):
            cache_path = os.path.join(CACHE_DIR, "%d_%d_%d.png" % (zoom, tx, ty))
            img = None
            if os.path.exists(cache_path) and not force:
                try:
                    img = Image.open(cache_path).convert("RGB")
                    n_cached += 1
                except Exception:
                    img = None  # corrupt cache -> re-download
            if img is None:
                url = TILE_URL.format(z=zoom, x=tx, y=ty)
                try:
                    r = session.get(url, timeout=30)
                    if r.status_code == 200 and r.content:
                        with open(cache_path, "wb") as fh:
                            fh.write(r.content)
                        img = Image.open(io.BytesIO(r.content)).convert("RGB")
                        n_downloaded += 1
                    else:
                        # Missing tile (e.g. open ocean) -> treat as sea level.
                        n_missing += 1
                except requests.RequestException as exc:
                    print("  WARN: tile %d/%d/%d failed: %s" % (zoom, tx, ty, exc))
                    n_missing += 1

            ox = (tx - x_min) * TILE_SIZE
            oy = (ty - y_min) * TILE_SIZE
            if img is not None:
                arr = np.asarray(img, dtype=np.float64)
                mosaic[oy : oy + TILE_SIZE, ox : ox + TILE_SIZE, :] = arr
            else:
                # Terrarium value for 0 m is (R=128,G=0,B=0): (128*256)-32768 = 0.
                mosaic[oy : oy + TILE_SIZE, ox : ox + TILE_SIZE, 0] = 128.0

    print(
        "Tiles: %d downloaded, %d from cache, %d missing(->sea level)"
        % (n_downloaded, n_cached, n_missing)
    )

    if n_downloaded == 0 and n_cached == 0:
        print("ERROR: no tiles could be fetched (network down?). Aborting.")
        sys.exit(3)

    # Terrarium decode -> metres.
    R = mosaic[:, :, 0]
    G = mosaic[:, :, 1]
    B = mosaic[:, :, 2]
    elev = (R * 256.0 + G + B / 256.0) - 32768.0

    # Crop the full-tile mosaic to the exact bbox (sub-pixel -> nearest pixel).
    px_w = (fx_w - x_min) * TILE_SIZE
    px_e = (fx_e - x_min) * TILE_SIZE
    px_n = (fy_n - y_min) * TILE_SIZE
    px_s = (fy_s - y_min) * TILE_SIZE

    col0 = max(0, int(round(px_w)))
    col1 = min(elev.shape[1], int(round(px_e)))
    row0 = max(0, int(round(px_n)))
    row1 = min(elev.shape[0], int(round(px_s)))
    if col1 <= col0:
        col1 = col0 + 1
    if row1 <= row0:
        row1 = row0 + 1

    elev = elev[row0:row1, col0:col1]
    # Store oriented so that row 0 = north. (We keep this convention; make_heightmap
    # documents and handles the flip into Unity's coordinate system.)
    elev = elev.astype(np.float32)

    out_path = os.path.join(RAW_DIR, "%s_dem.npy" % city)
    np.save(out_path, elev)

    print("Saved: %s  shape=%s" % (out_path, str(elev.shape)))
    print("Elevation min/max: %.1f m / %.1f m" % (float(elev.min()), float(elev.max())))
    return out_path


def main():
    ap = argparse.ArgumentParser(
        description="Fetch DEM tiles and stitch to a metres array."
    )
    ap.add_argument("city", nargs="?", help="city key (see --list)")
    ap.add_argument("--zoom", type=int, default=12, help="tile zoom level (default 12)")
    ap.add_argument("--force", action="store_true", help="ignore cache, re-download")
    ap.add_argument("--list", action="store_true", help="list available cities")
    args = ap.parse_args()

    if args.list or not args.city:
        print("Available cities:")
        for k in sorted(CITIES):
            s, w, n, e = CITIES[k]
            print("  %-15s  bbox(S,W,N,E)= %.4f, %.4f, %.4f, %.4f" % (k, s, w, n, e))
        if not args.city:
            sys.exit(0)
        return

    fetch(args.city, zoom=args.zoom, force=args.force)


if __name__ == "__main__":
    main()
