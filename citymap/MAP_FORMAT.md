# CITY BATTLE — City Map Pipeline & Canonical Format

A clean, from-scratch pipeline that turns a real city bounding box into a **game-ready map**:
real **topography** (elevation) + real **buildings**, projected into local metres, in ONE JSON
that BOTH the web review viewer and the Unity game consume. Sydney first.

## Why a single canonical format
The previous (real-estate) viewer was buildings-only on a flat plane and not built for a game.
This pipeline is terrain-first (topography is the core gameplay) and produces one source of truth.

## Pipeline stages (citymap/pipeline/)
1a. `fetch_dem_cop.py <city>` — **PREFERRED.** Download ACCURATE elevation from the
    **Copernicus DEM GLO-30** Cloud-Optimised GeoTIFFs on AWS open data (no key) →
    `cache/<city>_dem.npy` (float32 metres, north-up grid). Cleaner + more accurate than
    Terrarium (proper float DEM, ocean ≈ 0, no nodata spikes). Reads the COG with `tifffile`
    (+`imagecodecs`) — NO rasterio/gdal. Run it with an interpreter that has tifffile installed
    (here: `python3.11 fetch_dem_cop.py sydney`). If tifffile is missing it prints exactly that and
    exits without touching the cache, so stage 1b still works.
1b. `fetch_dem.py <city>` — FALLBACK. Coarse AWS Terrarium PNG tiles (no key) → same
    `cache/<city>_dem.npy`. Kept for environments without tifffile. (~30 m, noisier, ocean nodata.)
2. `fetch_buildings.py <city>` — Overpass OSM buildings in the same bbox →
   `cache/<city>_osm.json` (raw) then footprints+heights.
2w. `fetch_weather.py <city> [grid]` — OPTIONAL. Real-time weather + wind field from the
    **Open-Meteo** forecast API (no key). Samples a grid×grid (default 8×8) lattice across the
    bbox in one multi-point call, converts wind speed/dir → u/v, projects each point into the same
    local-metre frame, and also grabs an 850 hPa upper-air profile at the bbox centre →
    `cache/<city>_weather.json`.
3. `build_map.py <city>` — combine DEM + buildings, project to LOCAL METRES, resample terrain to a
   game grid, snap building bases to terrain → `data/<city>.citymap.json` (the canonical map).
   If `cache/<city>_weather.json` exists, it also embeds a `"weather"` object (see below).
   Both DEM sources write the identical `cache/<city>_dem.npy` so build_map.py is unchanged either way.

## Canonical map JSON  (data/<city>.citymap.json)
```jsonc
{
  "city": "sydney_harbour",
  "display": "Sydney — Harbour & The Rocks",
  "bbox": [west, south, east, north],          // lon/lat
  "origin_lonlat": [west, south],              // local (0,0) maps here
  "size_m": [width_m, length_m],               // real-world extent of the map
  "terrain": {
    "res": 129,                                // grid is res x res samples
    "cell_m": <width_m/(res-1)>,               // metres between samples
    "min_m": <float>, "max_m": <float>,        // elevation range (metres ASL)
    "heights": [ ... res*res floats ... ]      // row-major, metres ASL, index = z*res + x
  },
  "water_level_m": <float>,                    // sea level for harbour cities (0 for Sydney)
  "buildings": [
    { "poly": [[x_m,z_m],...],                 // footprint in local metres (CCW)
      "h": <height_m>, "base_m": <terrain height under centroid> }
  ],
  "weather": {                                 // OPTIONAL — present only if a weather cache existed
    "grid": [8, 8],                            // sample lattice dims (rows, cols) across the bbox
    "wind_speed_unit": "m/s",
    "field": [                                 // grid*grid sample points, row-major
      { "x_m": <float>, "z_m": <float>,        // sample location in LOCAL METRES (same frame)
        "u": <float>, "v": <float>,            // wind vector the wind blows TO: u=east, v=north (m/s)
        "wind_speed": <float>, "wind_dir": <float>,   // speed (m/s) + met. direction FROM (deg)
        "precip": <float>,                     // mm in the current period
        "pressure": <float>,                   // surface pressure (hPa)
        "cloud": <float> }                     // cloud cover (%)
    ],
    "upper_air": {                             // 850 hPa profile at bbox centre (isobaric / 3D sense)
      "level_hPa": 850, "wind_speed": <float>, "wind_dir": <float>,
      "u": <float>, "v": <float>,
      "geopotential_height_m": <float>, "temp": <float>, "valid_time": "<ISO>"
    },
    "summary": {
      "mean_wind_speed": <float>, "mean_wind_dir": <float>,   // m/s, met. deg FROM
      "mean_wind_u": <float>, "mean_wind_v": <float>,         // mean vector (m/s, blows TO)
      "mean_precip": <float>, "pressure_msl": <float>, "mean_cloud": <float>,
      "conditions_text": "<human readable>", "wind_speed_unit": "m/s",
      "fetched_utc": "<ISO>", "source": "Open-Meteo"
    }
  }
}
```
- Coordinates: **x = east, z = north, y = up (metres ASL)**. Local metres via equirectangular:
  `x = (lon-west)*111320*cos(midlat)`, `z = (lat-south)*111320`.
- `heights[z*res + x]` so a renderer can build a grid mesh directly.
- Buildings carry their terrain base so they sit on the ground in both web + Unity.
- **Weather** is for gameplay (ballistics/wind drift, rain/visibility, pressure→fog). Wind `u/v`
  are in the SAME local-metre frame as terrain/buildings, so a projectile can sample the nearest
  field point and add wind drift directly. `wind_dir` is meteorological (degrees the wind blows
  FROM); `u/v` already encode the direction the wind blows TO. Field is a live snapshot
  (`summary.fetched_utc`); re-run `fetch_weather.py` + `build_map.py` to refresh.

## Consumers
- **Web viewer** (`citymap/web/`): Three.js, builds a heightmapped terrain mesh + extruded
  buildings from the canonical JSON. Eva-esque muted UI. For REVIEW.
- **Unity** (`Assets/Scripts/Terrain/CityMapLoader.cs`, later): reads the same JSON into a
  `TerrainField` (heights) + building meshes. One source of truth → web and game match.

## Cities (battle-sized bboxes ~3-5 km)
- `sydney_harbour` — The Rocks / CBD / harbour edge: dramatic relief + water + dense towers.
- (more added by editing the CITIES dict in fetch_dem.py / fetch_buildings.py)

## Data licences / attribution
- **Elevation (preferred):** Copernicus DEM GLO-30 — © DLR e.V. 2010–2014 and © Airbus Defence and
  Space GmbH 2014–2018, provided under the Copernicus Programme. Free for any use with attribution:
  "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
  2014-2018 …". Hosted as AWS open data (`copernicus-dem-30m` S3 bucket, no key).
- **Elevation (fallback):** AWS Terrain Tiles (Mapzen/Terrarium, SRTM/etc.) — attribute appropriately.
- **Buildings:** OpenStreetMap — © OpenStreetMap contributors (ODbL).
- **Weather:** Open-Meteo (https://open-meteo.com) — free for non-commercial use, data under
  CC BY 4.0; attribute "Weather data by Open-Meteo.com". Underlying models (e.g. GFS/ICON/ECMWF)
  retain their own licences.
