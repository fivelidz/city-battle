# Real-Area → 3D Model Pipeline (a reusable METHOD)

A self-contained, copy-pasteable guide for turning **any real-world bounding box**
into a single canonical 3D dataset: an **accurate topographic terrain heightmap**
+ **real OpenStreetMap buildings** + (optional) **live weather**, all projected into
one local-metre JSON that web (Three.js), a game engine (Unity), and 3D-model/3D-print
tools can all consume from one source of truth.

> This was written because the city-map generation pipeline in CITY BATTLE is, by
> itself, a genuinely reusable way to make 3D models of real places. Nothing here is
> game-specific — the same JSON drives a browser viewer, a Unity terrain, **and** a
> watertight printable STL.

Companion reference: [`MAP_FORMAT.md`](./MAP_FORMAT.md) (the canonical schema, terse).
This document is the longer "how to actually do it from scratch" guide.

---

## 1. Overview — what it produces and where the data comes from

### Output
One file: **`data/<area>.citymap.json`** containing, in a single local-metre coordinate frame:

| Layer        | Content                                                                   |
|--------------|---------------------------------------------------------------------------|
| **Terrain**  | A `res × res` heightmap (metres above sea level), row-major, with cell size, min/max. |
| **Buildings**| Real OSM footprint polygons (local metres) + height + the terrain height under each. |
| **Weather**  | *(optional)* A wind/precip/pressure field sampled across the area + an upper-air profile. |
| **Geo metadata** | bbox (lon/lat), origin, real-world size in metres, water level.        |

Because everything lives in **one JSON in one coordinate frame**, web and game and
print all line up automatically — no per-consumer re-projection.

### Data sources (all free, no API keys)

| Layer     | Source                              | Notes                                            |
|-----------|-------------------------------------|--------------------------------------------------|
| Elevation | **Copernicus DEM GLO-30** (preferred) | ~30 m float DEM, proper ocean≈0, COG GeoTIFFs on AWS open data. No key. |
| Elevation | AWS Terrarium PNG tiles (fallback)  | Coarser/noisier, ocean nodata spikes. Used only if `tifffile` is missing. |
| Buildings | **OpenStreetMap** via Overpass API  | Building ways → footprints + heights. No key.    |
| Weather   | **Open-Meteo** forecast API         | Live wind/precip/pressure grid + 850 hPa profile. No key. Optional. |

### Licences / attribution (REQUIRED if you share, publish, or sell output)
- **Elevation (Copernicus DEM GLO-30):** "Produced using Copernicus WorldDEM-30 © DLR e.V.
  2010–2014 and © Airbus Defence and Space GmbH 2014–2018", provided under the Copernicus
  Programme. Hosted as AWS open data (`copernicus-dem-30m` S3 bucket).
- **Elevation (fallback):** AWS Terrain Tiles (Mapzen/Terrarium; SRTM et al.) — attribute appropriately.
- **Buildings:** © OpenStreetMap contributors, **ODbL**. Share-alike applies to derived geometry.
- **Weather:** Open-Meteo (https://open-meteo.com), data under **CC BY 4.0** — attribute
  "Weather data by Open-Meteo.com". Underlying models (GFS/ICON/ECMWF) keep their own licences.

---

## 2. Step-by-step — add a new area and generate it

All pipeline scripts live in `citymap/pipeline/` and **must be run from inside that
directory** (they `from cities import get`). Cached intermediates land in `citymap/cache/`,
final maps in `citymap/data/`.

```bash
cd <repo>/rulethecity/citymap/pipeline
```

### Prerequisites (one-time)
```bash
# Core (any python3):
pip install --user requests numpy pillow

# Accurate DEM reader — needs an interpreter that has tifffile + imagecodecs.
# Here that is python3.11 (verified: tifffile 2026.3.3). Install into THAT interpreter:
python3.11 -m pip install --user --break-system-packages tifffile imagecodecs
```
> Why a separate interpreter? The Copernicus reader (`fetch_dem_cop.py`) decodes
> DEFLATE/LZW float32 COG GeoTIFFs with `tifffile` (+`imagecodecs`) — **no rasterio/gdal**.
> If `python3` lacks `tifffile`, the script prints the exact install line and exits
> *without touching the cache*, so the Terrarium fallback still works.

### Step 0 — Define the area in `cities.py`
`bbox = [west_lon, south_lat, east_lon, north_lat]`. Add an entry to the `CITIES` dict:

```python
CITIES = {
    "my_area": {
        "display": "My Area — Subtitle",
        "bbox": [151.18, -33.90, 151.30, -33.79],   # [W, S, E, N] lon/lat
        "water_level_m": 0.0,                         # sea level (coastal). Inland: 0 is fine.
        "dem_zoom": 14,                               # only used by the Terrarium fallback
        # Buildings can be a SMALLER inner box than the terrain bbox.
        # Large areas have too many OSM buildings — restrict to the urban core:
        "buildings_bbox": [151.19, -33.89, 151.27, -33.83],
    },
}
```
- **Battle/large scale:** make `bbox` big (tens of km) for sweeping terrain. Use a tight
  inner `buildings_bbox` so Overpass doesn't choke and the JSON stays small.
- **Assault/small scale:** make `bbox` small (3–5 km) and set `buildings_bbox == bbox`
  for dense, fully-built coverage.
- How to get a bbox: draw a rectangle on https://geojson.io or read corners off
  OpenStreetMap; write them as `[W, S, E, N]`.

### Step 1 — Fetch accurate elevation (Copernicus DEM)
```bash
python3.11 fetch_dem_cop.py my_area
# -> cache/my_area_dem.npy   (north-up float32 grid, metres ASL, ~30 m/px)
# Also caches the source 1° tiles: cache/Copernicus_DSM_COG_10_S34_00_E151_00_DEM.tif etc.
```
It works out which 1°×1° Copernicus tiles cover the bbox, downloads them once (cached),
crops to the exact bbox, and (for Sydney) prints a sanity check against known landmark
elevations. Ocean / missing tiles are treated as 0 m.

**Fallback** (only if you can't install `tifffile`):
```bash
python3 fetch_dem.py my_area [zoom]    # AWS Terrarium PNG tiles → same cache/my_area_dem.npy
```
Both writers produce the **identical** `cache/<area>_dem.npy`, so the rest of the pipeline
doesn't care which you used.

### Step 2 — Fetch OSM buildings (Overpass)
```bash
python3 fetch_buildings.py my_area
# -> cache/my_area_osm.json            (raw Overpass response, cached)
# -> cache/my_area_buildings_raw.json  (parsed: footprint lon/lat + height_m + levels)
```
Uses `buildings_bbox` if present (else the full bbox). Height resolution order:
`height` tag → `building:levels × 3.1 m` → default `8 m`. Two Overpass endpoints are tried.
**The raw response is cached** — delete `cache/my_area_osm.json` to force a refetch.

### Step 3 — Fetch weather (optional)
```bash
python3 fetch_weather.py my_area [grid]   # grid default = 8 (an 8×8 lattice)
# -> cache/my_area_weather.json
```
One multi-point Open-Meteo call samples a `grid×grid` lattice across the bbox (current
wind/precip/pressure/cloud), converts wind speed+direction to `u/v` (the direction wind
blows *to*), projects each point into the same local-metre frame, and grabs one 850 hPa
upper-air profile at the bbox centre. Skip this step for a terrain+buildings-only model.

### Step 4 — Build the canonical map
```bash
python3 build_map.py my_area [grid_res]    # grid_res default = 129
# -> data/my_area.citymap.json
```
Combines DEM + buildings (+ weather if its cache exists), projects everything to local
metres, resamples terrain to `grid_res × grid_res`, snaps each building base to the
terrain under its centroid, and writes the canonical JSON. If `cache/<area>_weather.json`
exists it is embedded automatically; otherwise the map is built without a weather field.

**Full run, copy-paste:**
```bash
cd <repo>/rulethecity/citymap/pipeline
python3.11 fetch_dem_cop.py   my_area
python3   fetch_buildings.py  my_area
python3   fetch_weather.py    my_area        # optional
python3   build_map.py        my_area 129
```

### Resolution / size trade-offs

**DEM zoom** (Terrarium fallback only; Copernicus is fixed at ~30 m native):

| `dem_zoom` | Native px | Detail | Cost                          |
|------------|-----------|--------|-------------------------------|
| 12         | ~150 m/px | coarse | few tiles, fast               |
| 13         | ~75 m/px  | medium | moderate                      |
| 14         | ~8 m/px*  | fine   | many tiles, slow (*effective; oversamples ~30 m source) |

**Terrain grid resolution** (`grid_res` arg to `build_map.py`) — the game/mesh grid the
DEM is resampled onto. Use **`2ⁿ+1`** values so they map cleanly to engine terrains:

| `grid_res` | Samples  | Detail        | JSON size (approx, terrain only) |
|------------|----------|---------------|----------------------------------|
| **129**    | 16,641   | tabletop / mobile | small (~hundreds KB)        |
| **257**    | 66,049   | desktop / detailed | medium (~MB; verified 4.1 MB for Sydney w/ 18k buildings) |
| **385**    | 148,225  | high-detail print | large                       |

Higher `grid_res` = finer relief and more vertices but a bigger file; the **DEM's ~30 m
native resolution is the real ceiling** — going far past `res ≈ width_m/30` just interpolates.

**Verified examples (this repo):**
- `sydney_harbour` @ res 129 → 6934 × 6123 m, elev −3.1..107 m, 2553 buildings, 632 KB.
- `sydney` @ res 257 → 11095 × 12245 m, elev 0..118 m, 18478 buildings, 4157 KB, weather embedded.

---

## 3. The canonical format

See [`MAP_FORMAT.md`](./MAP_FORMAT.md) for the terse schema. Summary of fields in
`data/<area>.citymap.json`:

```jsonc
{
  "city": "my_area",
  "display": "My Area — Subtitle",
  "bbox": [west, south, east, north],     // lon/lat
  "origin_lonlat": [west, south],          // local (0,0) maps here (SW corner)
  "size_m": [width_m, length_m],           // real-world extent of the map
  "water_level_m": 0.0,                     // sea level (coastal); 0 inland
  "water_frac": 0.21,                       // fraction of cells at/below water level
  "terrain": {
    "res": 129,                             // grid is res x res samples
    "cell_m": 54.2,                         // width_m / (res-1) — metres between samples
    "min_m": -3.1, "max_m": 107.0,          // elevation range (metres ASL)
    "heights": [ /* res*res floats */ ]      // row-major, metres ASL, index = z*res + x
  },
  "buildings": [
    { "poly": [[x_m, z_m], ...],            // footprint in LOCAL METRES
      "h": 24.0,                            // building height (m)
      "base_m": 12.5 }                      // terrain height under the centroid (m)
  ],
  "weather": { /* optional — see MAP_FORMAT.md: grid, field[], upper_air, summary */ }
}
```

### Coordinate convention (the key to everything lining up)
- **x = east, z = north, y = up (metres ASL).**
- Local-metre projection (equirectangular about the bbox mid-latitude):
  ```
  midlat = (south + north) / 2
  x = (lon - west)  * 111320 * cos(midlat)
  z = (lat - south) * 111320
  ```
- `heights[z*res + x]` is row-major, so a renderer builds a grid mesh directly.
- Buildings carry `base_m` (terrain under their centroid) so they sit on the ground in
  every consumer without re-sampling the heightmap.
- Weather `u/v` are in this **same** local-metre frame, so a projectile/particle can sample
  the nearest field point and add drift directly.

> The projection is **approximate** — fine for areas up to a few tens of km, but it
> stretches at high latitude and over very large east–west spans (see Limitations).

---

## 4. Using the output — multiple consumers, one JSON

### 4a. Web — Three.js (`web/viewer.js`)
The viewer builds the terrain as a heightmapped `PlaneGeometry`, then extrudes buildings:

```js
// Terrain: a (res-1)x(res-1) plane, displaced by the heightmap.
var t = map.terrain, res = t.res, H = t.heights;
var W = map.size_m[0], L = map.size_m[1];
var geo = new THREE.PlaneGeometry(W, L, res - 1, res - 1);
geo.rotateX(-Math.PI / 2);                 // make it horizontal (y = up)
var pos = geo.attributes.position;
for (var i = 0; i < pos.count; i++) pos.setY(i, H[i]);   // i == z*res + x
geo.computeVertexNormals();
// ...textured + a water plane drawn at water_level_m where min_m < water_level.
```
Buildings (`addBuilding`) triangulate each `poly` as a roof fan at `y = base_m + h`, then
extrude walls down to `y = base_m`. Footprints are already in the terrain's local frame,
so no transform is needed. Buildings are bucketed into an 8×8 chunk grid for draw-call
sanity / fog-cull. Weather points become wind arrows + rain in the same frame.

Run it: serve `citymap/web/` over HTTP and open `index.html`
(`?city=my_area` query selects the map).

### 4b. Unity — same JSON, shared source of truth
Existing loaders under `Assets/Scripts/Terrain/`:
- **`HeightmapLoader.cs`** — ingests a heightmap into the `float[,] heights` (indexed
  `[x, z]`, x=east, z=north, metres) that `TerrainField`/`TerrainBuilder` consume. It has
  `LoadRaw(...)` / `LoadFromTexture(...)` paths for the *older* raw/PNG pipeline; for the
  canonical JSON you read `terrain.heights` directly: `heights[x, z] = H[z*res + x]` and
  the terrain's world size is `size_m`.
- **`CityBuildings.cs`** — extrudes building footprints onto the `TerrainField` as box
  prisms with `MeshCollider`s (cover/occluders). It expects records of
  `{ polygon: [[x,z],...], height_m }` in the **same local-metre frame** (x=east=+X,
  z=north=+Z). The canonical JSON's `buildings[].poly` / `.h` map straight onto that; use
  `base_m` for the base instead of re-sampling (or let it sample the `TerrainField`).

A thin `CityMapLoader` (referenced in `MAP_FORMAT.md`) parses `<area>.citymap.json` once
and feeds both: `terrain.heights → TerrainField`, `buildings → CityBuildings`. Because web
and Unity read the **identical** numbers in the **identical** frame, the browser review
view and the in-engine map match exactly.

### 4c. 3D models / 3D printing — "awesome for making 3D models of areas"
This is the standalone payoff: the same data → a **watertight, printable relief** of any
real place. The older `terrain_pipeline/` already has the two makers; the canonical JSON
carries everything they need (`terrain.heights`, `size_m`, `min_m/max_m`, `buildings`).

**A. Terrain → solid STL** (`terrain_pipeline/make_stl.py`)
Builds a closed manifold prism — printable as-is:
- **top**: the heightfield (one quad → 2 triangles per cell)
- **4 side walls**: skirts dropping from the terrain edge to a base plane
- **bottom**: a single flat base plate

```bash
cd <repo>/rulethecity/terrain_pipeline
python3 make_stl.py my_area --scale 10000     # 1:10000 → tabletop size
# -> out/my_area_terrain.stl   (binary STL; needs only numpy)
```
Coordinates are millimetres at the chosen print scale; X=east, Y=north, Z=up. The writer
is dependency-free (binary STL, ~5× smaller than ASCII); `trimesh`/`numpy-stl` are used if
present but not required.

**B. Buildings → OBJ** (`terrain_pipeline/make_buildings_obj.py`)
Extrudes each footprint into a box: base = terrain height under the centroid, top = base +
height. Emits one combined `.obj` (x=east, y=up, z=north).
```bash
python3 make_buildings_obj.py my_area
# -> out/my_area_buildings.obj
```
These are **open** prisms (no bottom — they sit on the ground), so to print them you make
the whole assembly manifold once, merged with the terrain.

**C. Combine + make watertight (Blender, recommended)**
1. Import `my_area_terrain.stl` and `my_area_buildings.obj`
   (OBJ import: set **Forward = Z, Up = Y** so buildings stand upright — our frame is
   x=east, y=up, z=north).
2. Select all → **Object → Join** (one mesh).
3. Enable the **3D-Print Toolbox** add-on → **Check All** / **Make Manifold** to seal gaps
   on slopes and close the building bottoms against the terrain.
4. **File → Export → STL** → a single printable `my_area_print.stl`.

Or, headless with trimesh:
```python
import trimesh
terr = trimesh.load("out/my_area_terrain.stl")
bld  = trimesh.load("out/my_area_buildings.obj")
scene = trimesh.util.concatenate([terr, bld])
scene.export("out/my_area_print.stl")
```

**Scale considerations** (DEM bbox is typically a few km on a side):

| Scale       | ~5 km area → model | Notes                                                |
|-------------|--------------------|------------------------------------------------------|
| 1:50000     | ~10 cm             | Whole area on one small bed; little fine relief.     |
| **1:10000** | **~50–57 cm**      | Default. Great detail; **tile it** to fit a 220–256 mm bed. |
| 1:5000      | ~1 m               | Museum-scale; tile heavily.                          |

- **Vertical exaggeration:** real relief can look flat at tabletop scale. Multiply
  `terrain.heights` (or the STL Z) by ~1.5–3× for legibility without distorting footprints.
- **Tiling:** a 57 cm model won't fit a typical bed — slice the STL into a grid
  (Blender Bisect+cap, or PrusaSlicer's *Cut* tool) and print in pieces.
- **Orientation:** print base-plate-down (flat plate on the bed).
- **Attribution still required** on shared/sold prints (Copernicus + OSM ODbL, see §1).

> To print straight from the **canonical JSON** (without the old `.raw`/`.npy` files),
> a ~40-line script can read `terrain.heights`/`res`/`size_m` and emit the same closed
> prism, and read `buildings[].poly/.h/.base_m` for the box extrusions — the geometry math
> is identical to `make_stl.py` / `make_buildings_obj.py`.

---

## 5. Extending the method

### Add more areas
Add entries to the `CITIES` dict in `cities.py` and run the four steps. That's it — the
schema, web viewer, Unity loader and STL makers are all area-agnostic.

### Higher resolution
- Raise `grid_res` in `build_map.py` (129 → 257 → 385) for a finer mesh.
- The **DEM's ~30 m native resolution is the real limit** — past `res ≈ width_m/30`
  you're just interpolating. To go *genuinely* finer you need a finer DEM source:
  - **LiDAR upgrade path:** swap in 1 m LiDAR DEMs where available. For Australia,
    **ELVIS** (https://elevation.fsdf.org.au) serves 1 m DEMs — drop a new
    `fetch_dem_elvis.py` that writes the same `cache/<area>_dem.npy` (north-up float32),
    and the rest of the pipeline is unchanged. This is the accuracy upgrade path.

### Add another data layer (use weather as the template)
Weather shows the pattern for any extra layer:
1. A `fetch_<layer>.py` that pulls data, projects it into the **same local-metre frame**
   (`x = (lon-west)*111320*cos(midlat)`, `z = (lat-south)*111320`), and writes
   `cache/<area>_<layer>.json`.
2. `build_map.py` checks for that cache and, if present, embeds a compact `"<layer>"`
   object into the canonical JSON (the terrain/buildings output is unchanged either way).
3. Each consumer (web/Unity/print) optionally reads the new key.

Candidate layers: roads/rail (OSM), land cover / vegetation, water polygons (coastline),
flood/inundation, population/heat — all just need lon/lat → local-metre projection + a JSON.

---

## 6. Limitations & gotchas

- **`python3.11` requirement for the accurate DEM.** `fetch_dem_cop.py` needs `tifffile`
  (+`imagecodecs`) to read the Copernicus COG GeoTIFFs. If your default `python3` lacks
  them, the script exits cleanly with the exact install line and does **not** overwrite the
  cache, so the Terrarium fallback (`fetch_dem.py`) keeps working. (Verified here:
  `python3.11` has `tifffile 2026.3.3`.)
- **Run scripts from `pipeline/`.** They do `from cities import get`; running from another
  directory raises `ModuleNotFoundError`.
- **DEM nodata / ocean clamping.** `build_map.py` clamps elevations to robust percentiles
  (≈0.2/99.8) bounded to `[-60, +400] m` to kill deep-ocean nodata spikes and decode
  outliers — so the *raw* min/max can differ from the JSON's. Copernicus treats ocean and
  missing tiles as ~0 m. Set `water_level_m` correctly for coastal areas; the viewer draws
  a water plane only where `min_m < water_level`.
- **Overpass rate limits + caching.** The raw OSM response is cached as
  `cache/<area>_osm.json`; the second run reuses it. To force a refetch, delete that file.
  Overpass can return HTTP 429/504 under load — the fetcher tries two endpoints and you may
  need to retry later. Be polite (don't hammer it).
- **Large areas need an inner `buildings_bbox`.** A big terrain bbox can contain tens of
  thousands of buildings → huge JSON and a slow/failed Overpass query. Restrict buildings
  to the urban core via `buildings_bbox` (terrain stays full-size).
- **Equirectangular projection is approximate.** `x = Δlon·111320·cos(midlat)`,
  `z = Δlat·111320` is accurate for small/medium areas but distorts at high latitude and
  over very large east–west extents (it's a flat-Earth approximation about one mid-latitude).
  For city/regional scale this is well within tolerance; for very large maps consider a
  proper projection (UTM).
- **Building heights are heuristic.** Only ~some OSM buildings carry a real `height`; others
  use `building:levels × 3.1 m` or fall back to `8 m`. Skylines are plausible, not surveyed.
- **Weather is a live snapshot.** The field reflects `summary.fetched_utc`; re-run
  `fetch_weather.py` + `build_map.py` to refresh it.

---

## Quick reference — full generation from scratch
```bash
# 0. edit cities.py: add "my_area" with bbox [W,S,E,N], water_level_m, buildings_bbox
cd <repo>/rulethecity/citymap/pipeline

# 1. accurate elevation (needs python3.11 + tifffile/imagecodecs)
python3.11 fetch_dem_cop.py my_area        # → cache/my_area_dem.npy
#    fallback if no tifffile:  python3 fetch_dem.py my_area 14

# 2. OSM buildings
python3 fetch_buildings.py my_area         # → cache/my_area_buildings_raw.json

# 3. weather (optional)
python3 fetch_weather.py my_area 8         # → cache/my_area_weather.json

# 4. canonical map
python3 build_map.py my_area 129           # → data/my_area.citymap.json

# 5a. WEB:    serve citymap/web/ and open index.html?city=my_area
# 5b. UNITY:  CityMapLoader → HeightmapLoader (terrain) + CityBuildings (footprints)
# 5c. PRINT:  cd ../../terrain_pipeline
#             python3 make_stl.py my_area --scale 10000
#             python3 make_buildings_obj.py my_area
#             Blender: import both, Join, 3D-Print Toolbox → Make Manifold, export STL
```
