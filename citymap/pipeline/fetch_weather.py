#!/usr/bin/env python3
"""CITY BATTLE - fetch a real WEATHER + WIND FIELD over a city bbox.

Source: Open-Meteo forecast API (https://open-meteo.com), free, no API key.
Samples a GRIDxGRID lattice of lat/lon across the city bbox in ONE multi-point call (Open-Meteo
accepts comma-separated latitude/longitude lists and returns a LIST of result objects), reads the
CURRENT surface conditions at each point, converts wind speed+direction to u/v components, and
projects each point into the SAME local-metre frame build_map.py uses
(x=(lon-west)*111320*cos(midlat), z=(lat-south)*111320).

Also fetches one upper-air (850 hPa) profile at the bbox centre for an isobaric / 3D-ish sense.

Output: cache/<city>_weather.json   (consumed by build_map.py -> embedded into the citymap).

Usage: python3 fetch_weather.py sydney [grid]
"""

import sys, os, json, math
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    raise SystemExit("Need 'requests': pip install --user requests")

from cities import get

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "cache")
os.makedirs(CACHE, exist_ok=True)

API = "https://api.open-meteo.com/v1/forecast"


def wind_uv(speed, direction):
    """Meteorological wind direction (deg FROM) + speed -> (u east, v north) the wind blows TO."""
    rad = math.radians(direction)
    u = -speed * math.sin(rad)
    v = -speed * math.cos(rad)
    return u, v


def conditions_text(precip, cloud, wind):
    parts = []
    if precip is not None and precip > 0.2:
        parts.append("rain" if precip > 1.0 else "light rain")
    elif cloud is not None:
        if cloud >= 80:
            parts.append("overcast")
        elif cloud >= 40:
            parts.append("partly cloudy")
        else:
            parts.append("clear")
    if wind is not None:
        if wind >= 14:
            parts.append("strong wind")
        elif wind >= 8:
            parts.append("breezy")
        elif wind >= 3:
            parts.append("light wind")
        else:
            parts.append("calm")
    return ", ".join(parts) if parts else "unknown"


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 fetch_weather.py <city> [grid]")
    city = sys.argv[1]
    grid = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    info = get(city)
    west, south, east, north = info["bbox"]
    midlat = (south + north) / 2.0
    mpd_lon = 111320.0 * math.cos(math.radians(midlat))
    mpd_lat = 111320.0
    print(f"[fetch_weather] {city}  bbox={info['bbox']}  grid={grid}x{grid}")

    # Sample lattice of lat/lon across the bbox (cell centres avoid edge clipping).
    lats, lons = [], []
    for j in range(grid):
        lat = south + (j + 0.5) / grid * (north - south)
        for i in range(grid):
            lon = west + (i + 0.5) / grid * (east - west)
            lats.append(round(lat, 5))
            lons.append(round(lon, 5))

    lat_csv = ",".join(str(v) for v in lats)
    lon_csv = ",".join(str(v) for v in lons)
    params = {
        "latitude": lat_csv,
        "longitude": lon_csv,
        "current": "temperature_2m,precipitation,rain,wind_speed_10m,wind_direction_10m,"
        "wind_gusts_10m,surface_pressure,cloud_cover",
        "hourly": "wind_speed_10m,wind_direction_10m,precipitation,surface_pressure,"
        "pressure_msl,cloud_cover",
        "wind_speed_unit": "ms",
        "timezone": "Australia/Sydney",
        "forecast_days": 2,
    }
    print(f"[fetch_weather] querying Open-Meteo for {len(lats)} points ...")
    r = requests.get(
        API,
        params=params,
        timeout=60,
        headers={"User-Agent": "city-battle-weather/1.0"},
    )
    if r.status_code != 200:
        raise SystemExit(
            f"[fetch_weather] Open-Meteo HTTP {r.status_code}: {r.text[:300]}"
        )
    data = r.json()
    # Multi-point -> list; single-point -> dict. Normalise to list.
    results = data if isinstance(data, list) else [data]
    if len(results) != len(lats):
        print(
            f"[fetch_weather] WARN: got {len(results)} results for {len(lats)} points"
        )

    points = []
    sum_u = sum_v = sum_spd = sum_precip = sum_pres = sum_cloud = 0.0
    n = 0
    for k, res in enumerate(results):
        cur = res.get("current", {})
        lat = res.get("latitude", lats[k] if k < len(lats) else None)
        lon = res.get("longitude", lons[k] if k < len(lons) else None)
        spd = cur.get("wind_speed_10m")
        wdir = cur.get("wind_direction_10m")
        precip = cur.get("precipitation")
        pres = cur.get("surface_pressure")
        cloud = cur.get("cloud_cover")
        if spd is None or wdir is None:
            u = v = 0.0
        else:
            u, v = wind_uv(spd, wdir)
        x_m = (lon - west) * mpd_lon if lon is not None else None
        z_m = (lat - south) * mpd_lat if lat is not None else None
        points.append(
            {
                "lat": lat,
                "lon": lon,
                "x_m": round(x_m, 1) if x_m is not None else None,
                "z_m": round(z_m, 1) if z_m is not None else None,
                "wind_speed": spd,
                "wind_dir": wdir,
                "u": round(u, 3),
                "v": round(v, 3),
                "precip": precip,
                "pressure": pres,
                "cloud": cloud,
                "temp": cur.get("temperature_2m"),
                "gust": cur.get("wind_gusts_10m"),
            }
        )
        if spd is not None:
            sum_u += u
            sum_v += v
            sum_spd += spd
            n += 1
        if precip is not None:
            sum_precip += precip
        if pres is not None:
            sum_pres += pres
        if cloud is not None:
            sum_cloud += cloud

    n = max(1, n)
    np_ = max(1, len(points))
    mean_u, mean_v = sum_u / n, sum_v / n
    mean_spd = sum_spd / n
    # mean direction FROM the mean vector (invert the wind_uv transform)
    mean_dir = (math.degrees(math.atan2(-mean_u, -mean_v)) + 360.0) % 360.0
    mean_precip = sum_precip / np_
    mean_pres = sum_pres / np_
    mean_cloud = sum_cloud / np_

    # --- upper-air (850 hPa) at bbox centre for an isobaric / 3D sense ---
    upper = None
    try:
        cp = {
            "latitude": round(midlat, 5),
            "longitude": round((west + east) / 2.0, 5),
            "hourly": "wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,"
            "temperature_850hPa",
            "wind_speed_unit": "ms",
            "timezone": "Australia/Sydney",
            "forecast_days": 1,
        }
        ru = requests.get(
            API,
            params=cp,
            timeout=60,
            headers={"User-Agent": "city-battle-weather/1.0"},
        )
        if ru.status_code == 200:
            ud = ru.json()
            h = ud.get("hourly", {})
            if h.get("time"):
                # pick the current hour index (nearest to now)
                idx = 0
                spd850 = h.get("wind_speed_850hPa", [None])[idx]
                dir850 = h.get("wind_direction_850hPa", [None])[idx]
                gh850 = h.get("geopotential_height_850hPa", [None])[idx]
                t850 = h.get("temperature_850hPa", [None])[idx]
                u850 = v850 = None
                if spd850 is not None and dir850 is not None:
                    u850, v850 = wind_uv(spd850, dir850)
                    u850, v850 = round(u850, 3), round(v850, 3)
                upper = {
                    "level_hPa": 850,
                    "wind_speed": spd850,
                    "wind_dir": dir850,
                    "u": u850,
                    "v": v850,
                    "geopotential_height_m": gh850,
                    "temp": t850,
                    "valid_time": h["time"][idx],
                }
    except Exception as e:
        print(f"[fetch_weather] upper-air fetch skipped: {e}")

    summary = {
        "mean_wind_speed": round(mean_spd, 2),
        "mean_wind_dir": round(mean_dir, 1),
        "mean_wind_u": round(mean_u, 3),
        "mean_wind_v": round(mean_v, 3),
        "mean_precip": round(mean_precip, 3),
        "pressure_msl": round(mean_pres, 1),
        "mean_cloud": round(mean_cloud, 1),
        "conditions_text": conditions_text(mean_precip, mean_cloud, mean_spd),
        "wind_speed_unit": "m/s",
        "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Open-Meteo",
    }

    out = {
        "city": city,
        "bbox": info["bbox"],
        "origin_lonlat": [west, south],
        "grid": [grid, grid],
        "projection": "x=(lon-west)*111320*cos(midlat), z=(lat-south)*111320",
        "points": points,
        "upper_air": upper,
        "summary": summary,
    }
    out_fn = os.path.join(CACHE, f"{city}_weather.json")
    json.dump(out, open(out_fn, "w"))
    print(f"[fetch_weather] saved {out_fn}  ({os.path.getsize(out_fn) // 1024} KB)")
    print(
        f"[fetch_weather] CURRENT {city}: wind {summary['mean_wind_speed']} m/s "
        f"from {summary['mean_wind_dir']} deg  | precip {summary['mean_precip']} mm  | "
        f"pressure {summary['pressure_msl']} hPa  | cloud {summary['mean_cloud']}%  | "
        f"{summary['conditions_text']}"
    )
    if upper:
        print(
            f"[fetch_weather] 850 hPa: wind {upper['wind_speed']} m/s from {upper['wind_dir']} deg "
            f"| height {upper['geopotential_height_m']} m | temp {upper['temp']} C"
        )


if __name__ == "__main__":
    main()
