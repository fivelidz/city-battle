#!/usr/bin/env python3
"""CITY BATTLE - combine DEM + buildings into the canonical game map JSON.

Reads cache/<city>_dem.npy and cache/<city>_buildings_raw.json, projects everything to LOCAL
METRES (x=east, z=north), resamples the terrain to a game grid, snaps each building base to the
terrain under its centroid, and writes data/<city>.citymap.json (see ../MAP_FORMAT.md).

Usage: python3 build_map.py sydney_harbour [grid_res]
"""

import sys, os, json, math
import numpy as np

from cities import get

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "cache")
DATA = os.path.join(HERE, "..", "data")
os.makedirs(DATA, exist_ok=True)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 build_map.py <city> [grid_res]")
    city = sys.argv[1]
    res = int(sys.argv[2]) if len(sys.argv) > 2 else 129
    info = get(city)
    west, south, east, north = info["bbox"]
    midlat = (south + north) / 2.0
    mpd_lon = 111320.0 * math.cos(math.radians(midlat))
    mpd_lat = 111320.0
    width_m = (east - west) * mpd_lon
    length_m = (north - south) * mpd_lat

    # --- terrain ---
    dem = np.load(os.path.join(CACHE, f"{city}_dem.npy"))  # north-up rows
    # Clamp tile-decode outliers (ocean nodata / spikes) to a plausible band using percentiles.
    lo_p = np.percentile(dem, 0.2)
    hi_p = np.percentile(dem, 99.8)
    lo_clamp = max(-60.0, float(lo_p))  # don't let deep-ocean nodata dominate
    hi_clamp = min(400.0, float(hi_p) + 10.0)
    dem = np.clip(dem, lo_clamp, hi_clamp)
    # Flip so row 0 = south (z increases north), to match z=north local axis.
    dem_sn = np.flipud(dem)
    H, W = dem_sn.shape
    heights = np.zeros((res, res), dtype=np.float32)
    for zi in range(res):
        fz = zi / (res - 1) * (H - 1)
        z0 = int(min(fz, H - 1))
        z1 = min(z0 + 1, H - 1)
        tz = fz - z0
        for xi in range(res):
            fx = xi / (res - 1) * (W - 1)
            x0 = int(min(fx, W - 1))
            x1 = min(x0 + 1, W - 1)
            tx = fx - x0
            a = dem_sn[z0, x0] * (1 - tx) + dem_sn[z0, x1] * tx
            b = dem_sn[z1, x0] * (1 - tx) + dem_sn[z1, x1] * tx
            heights[zi, xi] = a * (1 - tz) + b * tz

    cell_m = width_m / (res - 1)

    def terrain_at(x_m, z_m):
        fx = x_m / max(cell_m, 1e-6)
        fz = z_m / max((length_m / (res - 1)), 1e-6)
        x0 = max(0, min(res - 1, int(fx)))
        z0 = max(0, min(res - 1, int(fz)))
        return float(heights[z0, x0])

    # --- buildings ---
    braw_fn = os.path.join(CACHE, f"{city}_buildings_raw.json")
    buildings_out = []
    if os.path.exists(braw_fn):
        braw = json.load(open(braw_fn))
        for b in braw:
            poly = []
            cx = cz = 0.0
            for lon, lat in b["footprint"]:
                x_m = (lon - west) * mpd_lon
                z_m = (lat - south) * mpd_lat
                poly.append([round(x_m, 1), round(z_m, 1)])
                cx += x_m
                cz += z_m
            n = max(1, len(poly))
            base = terrain_at(cx / n, cz / n)
            buildings_out.append(
                {"poly": poly, "h": b["height_m"], "base_m": round(base, 1)}
            )
    else:
        print("[build_map] no buildings cache; terrain-only map")

    # --- roads (optional) ---
    roads_out = []
    rraw_fn = os.path.join(CACHE, f"{city}_roads_raw.json")
    if os.path.exists(rraw_fn):
        rraw = json.load(open(rraw_fn))
        for r in rraw:
            path = []
            for lon, lat in r["path"]:
                x_m = (lon - west) * mpd_lon
                z_m = (lat - south) * mpd_lat
                # keep only points within (or near) the map
                path.append([round(x_m, 1), round(z_m, 1)])
            if len(path) >= 2:
                roads_out.append({"path": path, "kind": r["kind"]})
        print(f"[build_map] embedded {len(roads_out)} roads")

    water_level = info.get("water_level_m", 0.0)
    water_frac = float((heights <= water_level).mean())
    out = {
        "city": city,
        "display": info["display"],
        "bbox": info["bbox"],
        "origin_lonlat": [west, south],
        "size_m": [round(width_m, 1), round(length_m, 1)],
        "water_level_m": water_level,
        "water_frac": round(water_frac, 3),
        "terrain": {
            "res": res,
            "cell_m": round(cell_m, 2),
            "min_m": round(float(heights.min()), 1),
            "max_m": round(float(heights.max()), 1),
            "heights": [
                round(float(v), 1) for v in heights.flatten()
            ],  # row-major z*res+x
        },
        "buildings": buildings_out,
        "roads": roads_out,
    }

    # --- weather (optional) ---
    # If fetch_weather.py has produced cache/<city>_weather.json, embed a compact "weather" object:
    # the per-point wind field (u/v in m/s, in the SAME local-metre frame) + precip/pressure +
    # a summary. Terrain/buildings output is unchanged whether or not weather exists.
    weather_fn = os.path.join(CACHE, f"{city}_weather.json")
    if os.path.exists(weather_fn):
        try:
            wx = json.load(open(weather_fn))
            field = []
            for p in wx.get("points", []):
                field.append(
                    {
                        "x_m": p.get("x_m"),
                        "z_m": p.get("z_m"),
                        "u": p.get("u"),
                        "v": p.get("v"),
                        "wind_speed": p.get("wind_speed"),
                        "wind_dir": p.get("wind_dir"),
                        "precip": p.get("precip"),
                        "pressure": p.get("pressure"),
                        "cloud": p.get("cloud"),
                    }
                )
            out["weather"] = {
                "grid": wx.get("grid"),
                "wind_speed_unit": "m/s",
                "field": field,
                "upper_air": wx.get("upper_air"),
                "summary": wx.get("summary"),
            }
            s = wx.get("summary", {})
            print(
                f"[build_map] embedded weather: {len(field)} pts, "
                f"wind {s.get('mean_wind_speed')} m/s from {s.get('mean_wind_dir')} deg, "
                f"{s.get('conditions_text')}"
            )
        except Exception as e:
            print(f"[build_map] weather present but failed to embed: {e}")
    else:
        print("[build_map] no weather cache; map without weather field")
    out_fn = os.path.join(DATA, f"{city}.citymap.json")
    json.dump(out, open(out_fn, "w"))
    sz = os.path.getsize(out_fn)
    print(f"[build_map] {out_fn}  ({sz // 1024} KB)")
    print(
        f"[build_map] size {width_m:.0f} x {length_m:.0f} m  grid {res}x{res}  "
        f"elev {out['terrain']['min_m']}..{out['terrain']['max_m']} m  "
        f"buildings {len(buildings_out)}"
    )


if __name__ == "__main__":
    main()
