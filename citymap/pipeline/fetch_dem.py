#!/usr/bin/env python3
"""CITY BATTLE - fetch real elevation (DEM) for a city bbox.

Source: AWS Terrain Tiles (Terrarium PNG encoding), open data, no API key.
  elevation_m = (R*256 + G + B/256) - 32768
Stitches the covering tiles at a chosen zoom, decodes to metres, crops to the bbox,
saves a north-up float grid to cache/<city>_dem.npy.

Usage: python3 fetch_dem.py sydney_harbour [zoom]
"""

import sys, os, math, io
import numpy as np

try:
    import requests
except ImportError:
    raise SystemExit("Need 'requests': pip install --user requests numpy pillow")
try:
    from PIL import Image
except ImportError:
    raise SystemExit("Need 'pillow': pip install --user pillow")

from cities import get

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "cache")
os.makedirs(CACHE, exist_ok=True)
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def deg2tile(lon, lat, z):
    n = 2**z
    xt = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    yt = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return xt, yt


def tile_px_bounds(lon, lat, z, tile=256):
    xt, yt = deg2tile(lon, lat, z)
    return xt * tile, yt * tile


def fetch_tile(z, x, y, sess):
    n = 2**z
    if x < 0 or y < 0 or x >= n or y >= n:
        return None
    fn = os.path.join(CACHE, f"terr_{z}_{x}_{y}.png")
    if os.path.exists(fn):
        try:
            return Image.open(fn).convert("RGB")
        except Exception:
            pass
    url = TILE_URL.format(z=z, x=x, y=y)
    try:
        r = sess.get(url, timeout=30)
        if r.status_code != 200:
            return None
        open(fn, "wb").write(r.content)
        return Image.open(io.BytesIO(r.content)).convert("RGB")
    except Exception as e:
        print(f"  tile {z}/{x}/{y} failed: {e}")
        return None


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 fetch_dem.py <city> [zoom]")
    city = sys.argv[1]
    info = get(city)
    z = int(sys.argv[2]) if len(sys.argv) > 2 else info.get("dem_zoom", 13)
    west, south, east, north = info["bbox"]
    print(f"[fetch_dem] {city}  bbox={info['bbox']}  zoom={z}")

    tile = 256
    x0f, y0f = tile_px_bounds(west, north, z)  # top-left (NW)
    x1f, y1f = tile_px_bounds(east, south, z)  # bottom-right (SE)
    tx0, ty0 = int(math.floor(x0f / tile)), int(math.floor(y0f / tile))
    tx1, ty1 = int(math.floor(x1f / tile)), int(math.floor(y1f / tile))
    nx, ny = (tx1 - tx0 + 1), (ty1 - ty0 + 1)
    print(f"[fetch_dem] stitching {nx}x{ny} tiles")

    sess = requests.Session()
    sess.headers.update({"User-Agent": "city-battle-dem/1.0"})
    mosaic = np.zeros((ny * tile, nx * tile), dtype=np.float32)
    got = 0
    for j in range(ny):
        for i in range(nx):
            img = fetch_tile(z, tx0 + i, ty0 + j, sess)
            if img is None:
                continue
            got += 1
            a = np.asarray(img, dtype=np.float32)
            elev = a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0
            mosaic[j * tile : (j + 1) * tile, i * tile : (i + 1) * tile] = elev
    print(f"[fetch_dem] fetched {got}/{nx * ny} tiles")

    # Crop mosaic to the exact bbox in pixel space.
    px_off = tx0 * tile
    py_off = ty0 * tile
    cx0 = int(round(x0f - px_off))
    cx1 = int(round(x1f - px_off))
    cy0 = int(round(y0f - py_off))
    cy1 = int(round(y1f - py_off))
    crop = mosaic[cy0:cy1, cx0:cx1]
    if crop.size == 0:
        raise SystemExit("[fetch_dem] empty crop - check bbox/zoom")

    # crop is north-up already (row 0 = north). Save as north-up.
    out = os.path.join(CACHE, f"{city}_dem.npy")
    np.save(out, crop)
    print(
        f"[fetch_dem] saved {out}  shape={crop.shape}  "
        f"elev {crop.min():.1f}..{crop.max():.1f} m"
    )


if __name__ == "__main__":
    main()
