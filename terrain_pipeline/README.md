# CITY BATTLE -- Terrain Pipeline

Convert **real-world city elevation (DEM)** into a 16-bit heightmap that Unity
Terrain (or the game's own `TerrainBuilder`) can consume. No GIS stack, no API key.

```
terrain_pipeline/
  fetch_dem.py          # download + stitch elevation tiles  -> raw/{city}_dem.npy
  make_heightmap.py     # resample + 16-bit export           -> out/{city}_height.{png,raw} + _meta.json
  fetch_buildings.py    # OSM building footprints (Overpass)  -> out/{city}_buildings.json
  make_buildings_obj.py # extrude footprints onto the DEM     -> out/{city}_buildings.obj
  make_stl.py           # watertight solid terrain for print  -> out/{city}_terrain.stl
  cache/                # downloaded Terrarium PNG tiles (re-used between runs)
  raw/                  # stitched DEM arrays (metres) as .npy
  out/                  # Unity-ready heightmaps, buildings, STL + metadata
```

## Dependencies

Core libs only -- all commonly available:

```bash
pip install --user numpy requests pillow
```

- **rasterio is NOT required.** This pipeline uses the open *tiles* approach
  (decode elevation directly from PNG tiles), so no heavy GIS stack is needed.
- If `numpy` / `requests` / `pillow` are missing, both scripts detect it and
  print the exact install line above, then exit cleanly.

Verified working on CachyOS / Arch with: numpy 2.4.1, requests 2.32.5, Pillow 12.1.0.

## Data source & attribution (REQUIRED)

Elevation comes from the **AWS Terrain Tiles** open dataset (Mapzen / Terrarium):

```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

- Free, open, **no API key**.
- Terrarium encoding: `elevation_m = (R*256 + G + B/256) - 32768`
- Underlying data: SRTM and other open DEMs aggregated by Mapzen.

**Attribution:** you must credit the data when you ship. Suggested line:

> Elevation data: AWS Terrain Tiles (Mapzen) -- SRTM, USGS, and other open
> sources. Contains data (c) OpenStreetMap contributors. CC-BY / public-domain
> components per the Mapzen Terrain Tiles attribution.

See: https://github.com/tilezen/joerd/blob/master/docs/attribution.md

## Usage

### 1. Fetch the DEM

```bash
python3 fetch_dem.py san_francisco
# options:
python3 fetch_dem.py sydney --zoom 12     # higher zoom = more detail + more tiles
python3 fetch_dem.py san_francisco --force # ignore cache, re-download
python3 fetch_dem.py --list                # list cities + bounding boxes
```

Built-in cities (each a ~5-8 km bbox over dramatic terrain):
`san_francisco, new_york, sydney, london, tokyo, hong_kong, tehran, shenzhen, gaza`

Output: `raw/{city}_dem.npy` (float32 metres, north-up). Prints min/max elevation.
Tiles are cached in `cache/`; re-runs skip the download.

### 2. Build the Unity heightmap

```bash
python3 make_heightmap.py san_francisco
# options:
python3 make_heightmap.py san_francisco --resolution 1025      # 2^n+1: 513,1025,2049
python3 make_heightmap.py san_francisco --exaggeration 1.5     # vertical drama for the game
```

Outputs in `out/`:

| File                  | What it is                                                        |
|-----------------------|-------------------------------------------------------------------|
| `{city}_height.png`   | 16-bit grayscale PNG (`I;16`). Import as a Texture2D heightmap.    |
| `{city}_height.raw`   | 16-bit little-endian RAW. Unity Terrain "Import Raw" format.       |
| `{city}_meta.json`    | bbox, resolution, real-world metres, recommended Unity Terrain size.|

The PNG and RAW are bit-identical 16-bit data; pick whichever import path you want.

### 3. Fetch building footprints (OpenStreetMap)

```bash
python3 fetch_buildings.py san_francisco
# options:
python3 fetch_buildings.py gaza --force   # ignore the cached Overpass response, refetch
python3 fetch_buildings.py --list         # list cities (same bboxes as the DEM)
```

Queries the **Overpass API** (`https://overpass-api.de/api/interpreter`, no key)
for every `way["building"]` inside the city's bbox -- the *same* bbox used by the
DEM, so buildings line up with the terrain. For each building it records the
footprint polygon and a height (`height` tag, else `building:levels * 3 m`, else
8 m default), converted to **local metres** (x = east, z = north; SW-corner
origin -- identical to the heightmap frame).

Output: `out/{city}_buildings.json` -- a list of
`{ "polygon": [[x_m, z_m], ...], "height_m": <float> }`.
The raw Overpass response is cached to `out/{city}_osm_raw.json`, so re-runs are
instant. Overpass can be slow/rate-limited; the script uses a 60 s timeout,
tries several public mirrors, and exits cleanly (non-zero) without clobbering
existing output if the API is unreachable -- just re-run later.

Verified results (Jun 2026):

| City          | Buildings | JSON size |
|---------------|-----------|-----------|
| san_francisco | 71,378    | 19.4 MB   |
| gaza          | 63,117    | 8.4 MB    |

### 4. Extrude buildings to a 3D OBJ

```bash
python3 make_buildings_obj.py san_francisco
```

Reads `out/{city}_buildings.json` + the DEM (`raw/{city}_dem.npy`) and extrudes
each footprint into a box prism: base at the terrain height under the footprint
centroid, top at base + `height_m`. Writes a single combined Wavefront
`out/{city}_buildings.obj` (vertices + faces, no materials) -- import into Unity
*or* combine with the terrain STL for 3D printing.

Verified (san_francisco): **1,684,088 vertices / 2,383,376 triangles / 97.8 MB**.
Base heights (3.8 m) match SF's min elevation; tops reach ~286 m (Twin Peaks +
towers). Dependency-light: numpy + json only.

### Example: San Francisco (verified)

```
Source elevation min/max: 3.6 m / 280.6 m   (Twin Peaks ~280 m -- correct)
Real extents: 5720 m (W) x 7792 m (L), vertical span 277.0 m
Recommended Unity Terrain size: W=5720.1  L=7792.4  H=277.0  (metres)
```

## Importing into Unity

### Option A -- Unity Terrain "Import Raw" (recommended for the Terrain system)

1. Create a Terrain: **GameObject -> 3D Object -> Terrain**.
2. Select it -> Terrain inspector -> **Terrain Settings** (gear icon).
3. Under **Texture Resolutions / Heightmap**, click **Import Raw...**
4. Choose `out/{city}_height.raw` and set, per `{city}_meta.json` -> `unity_terrain.import_raw`:
   - **Depth:** Bit 16
   - **Resolution:** Width = Height = `heightmap_resolution` (e.g. 513)
   - **Byte Order:** **Windows** (little-endian)
   - **Flip Vertically:** off
5. Then set the Terrain's world size (Terrain Settings -> Mesh Resolution), from
   `{city}_meta.json` -> `unity_terrain`:
   - **Terrain Width**  = `size_width_m`   (X / east-west)
   - **Terrain Length** = `size_length_m`  (Z / north-south)
   - **Terrain Height** = `size_height_m`  (Y / vertical span * exaggeration)

That reproduces the city at true horizontal scale, with the vertical exaggeration
you chose baked into `size_height_m`.

### Option B -- Feed the PNG into the game's own TerrainBuilder

`Assets/Scripts/Terrain/HeightmapLoader.cs` (namespace `CityBattle.Terrain`) lets
`TerrainBuilder` consume a real heightmap instead of procedural noise:

- `HeightmapLoader.LoadRaw(path, resolution, maxHeightMeters)`
  reads `{city}_height.raw` (16-bit LE) from disk into `float[,]` (metres, `[x,z]`).
- `HeightmapLoader.LoadFromTexture(tex, maxHeightMeters)`
  reads a 16-bit / grayscale `Texture2D` (the PNG, imported **Read/Write Enabled**)
  into the same `float[,]`.

Use `size_height_m` from `{city}_meta.json` as `maxHeightMeters`, and
`heightmap_resolution` as `resolution`. The returned `float[,]` plugs straight
into `new TerrainField(heights, cellSize, origin)`, where
`cellSize = size_width_m / (resolution - 1)`.

Example wiring (sketch -- a small Unity-side loader/MonoBehaviour can be added):

```csharp
// meta: resolution=513, size_height_m=277, size_width_m=5720.1
float[,] heights = HeightmapLoader.LoadRaw(rawPath, 513, 277f);
float cellSize = 5720.1f / (513 - 1);
var field = new TerrainField(heights, cellSize, transform.position);
// ...then build the mesh from `heights` exactly as TerrainBuilder.BuildMesh does.
```

## Coordinate convention

- Source DEM array is `[row, col]` with row 0 = **north**, col 0 = **west**.
- `make_heightmap.py` flips rows so the exported heightmap has row 0 = **south**,
  matching Unity Terrain's SW-corner origin (+X east, +Z north).
- `HeightmapLoader` returns `float[,]` indexed `[x, z]` (x = east, z = north),
  matching `TerrainField` / `TerrainBuilder`.

## Importing buildings into Unity

`Assets/Scripts/Terrain/CityBuildings.cs` (namespace `CityBattle.Terrain`) is a
`MonoBehaviour` that reads `{city}_buildings.json` from **StreamingAssets** and
procedurally extrudes the footprints onto a `TerrainField`:

```csharp
// after TerrainBuilder.Build() returns a TerrainField:
var field = terrainBuilder.Build();
var buildings = terrainGameObject.AddComponent<CityBuildings>();
buildings.BuildingsJsonPath = "Terrain/san_francisco_buildings.json";
buildings.BuildFromJson(field);   // or BuildFromJson(path, field)
```

- Copy `out/{city}_buildings.json` into `Assets/StreamingAssets/Terrain/`.
- Put the `CityBuildings` component on (or parented to) the terrain GameObject so
  it shares the terrain's local origin -- the footprints are in the same local
  metre frame as the heightmap, so they register automatically.
- Buildings are batched into combined meshes (UInt32 index, ~60k verts/chunk) and
  each chunk gets a **MeshCollider**, so they act as solid **cover/occluders** for
  the terrain LOS / ballistics system.
- For very dense cities set `MinFootprintM` (e.g. 6) to drop tiny sheds and keep
  the vertex count manageable.

## 3D Printing City Models

You can print a real city as a tabletop relief: the **terrain** as a solid base
with the hills in relief, optionally with the **buildings** sitting on top.

### Files involved

| File                       | Role                                                        |
|----------------------------|-------------------------------------------------------------|
| `out/{city}_terrain.stl`   | Watertight solid terrain (top relief + skirts + base plate).|
| `out/{city}_buildings.obj` | Extruded building boxes on the terrain (open prisms).       |

### Step 1 -- Make the terrain solid and printable

`make_stl.py` already emits a **watertight, manifold solid**: the height surface,
four side skirts, and a flat base plate, so it slices as-is. A base plate matters
because a bare heightfield is an open shell (zero thickness) -- no slicer can
print that. The built-in writer needs **only numpy**:

```bash
python3 make_stl.py san_francisco
# options:
python3 make_stl.py san_francisco --scale 10000   # 1:10000 -> ~57 cm long (default)
python3 make_stl.py san_francisco --z-exag 1.5     # exaggerate relief so hills read
python3 make_stl.py san_francisco --resample 2     # halve grid -> ~1/4 the triangles
python3 make_stl.py san_francisco --base-mm 5       # thicker base plate
```

Verified (san_francisco, 1:10000, full 513x513 grid):
**528,386 triangles, ~25 MB binary STL, 572 x 779 mm footprint, 27.7 mm relief.**

### Step 2 -- (Optional) merge in the buildings

The `*_buildings.obj` boxes share the terrain's coordinate frame, so they drop
straight onto the STL. They are *open* prisms (no bottom face -- they sit on the
ground), so to print them you make the whole thing manifold once, merged:

**Recommended: Blender** (free, handles big meshes):

1. `File > Import > Stl` -> `out/{city}_terrain.stl`.
2. `File > Import > Wavefront (.obj)` -> `out/{city}_buildings.obj`.
   (Blender's OBJ axis default is Y-up forward -Z; if the buildings land on their
   side, set Forward = Z, Up = Y on import. Our OBJ is x=east, y=up, z=north.)
3. Select both, `Ctrl+J` to join into one object.
4. Add a **Boolean (Union)** or just use `Mesh > Clean Up` then the
   **3D-Print Toolbox** add-on (`Edit > Preferences > Add-ons > 3D Print Toolbox`)
   -> **Check All** -> **Make Manifold**. This closes the building bottoms into
   the terrain and removes non-manifold edges.
5. `File > Export > Stl` -> a single printable `{city}_print.stl`.

**Python alternative** (if you prefer a script and have the libs):

```bash
pip install --user trimesh numpy-stl   # neither is required by THIS pipeline
```

```python
import trimesh
terr = trimesh.load("out/san_francisco_terrain.stl")
bld  = trimesh.load("out/san_francisco_buildings.obj")
scene = trimesh.util.concatenate([terr, bld])
scene.merge_vertices()
# trimesh.repair.fill_holes / boolean union (needs a backend: blender/manifold3d)
scene.export("out/san_francisco_print.stl")
```

`make_stl.py` reports whether `trimesh` / `numpy-stl` are installed; if not, it
falls back to its own dependency-free binary-STL writer (numpy only) and tells
you so. (On this machine neither was installed and the built-in writer was used.)

### Step 3 -- Scale and tiling

The DEM bbox is ~5-8 km on a side. Pick a scale denominator with `--scale`:

| Scale     | 5.7 km city becomes | Notes                                          |
|-----------|---------------------|------------------------------------------------|
| 1:5000    | ~1.14 m             | Huge -- museum diorama; must be tiled.          |
| **1:10000** (default) | **~57 cm** | Big but printable in pieces; nice detail.       |
| 1:20000   | ~29 cm              | Fits a 300 mm bed in 1-2 tiles.                |
| 1:50000   | ~11 cm              | Whole city on one plate; buildings get tiny.    |

A 57 cm model won't fit a typical 220-256 mm print bed, so **tile it**: slice the
STL into a grid (Blender: Bisect + cap, or PrusaSlicer's *Cut* tool) and print
quadrants, or re-run `make_stl.py` per-tile with a smaller bbox in
`fetch_dem.CITIES`. Use `--z-exag 1.3..2.0` -- at true 1:1 vertical, a 280 m hill
is only ~28 mm at 1:10000 and reads flat; exaggerating the vertical makes the
terrain legible without distorting the footprint.

### Step 4 -- Slicer settings (quick guide)

- **Walls/perimeters:** 3-4; **infill:** 10-15% gyroid is plenty for a display piece.
- **Supports:** the terrain skirts are vertical so they need none; tall thin
  buildings (towers) may need a little support or a brim.
- **Orientation:** print base-down (the flat plate is the bed surface).

### Data licence & attribution (REQUIRED when you share or sell prints)

- **Building footprints: OpenStreetMap, (c) OpenStreetMap contributors, licensed
  under the ODbL.** If you publish/share a derived model you must attribute
  "(c) OpenStreetMap contributors" and keep it ODbL-compatible. See
  https://www.openstreetmap.org/copyright .
- **Elevation: AWS Terrain Tiles (Mapzen / Terrarium)** -- SRTM/USGS and other
  open sources; attribute per
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md (see the
  "Data source & attribution" section above).

A suggested combined credit line to print on/with the model:

> Terrain: AWS Terrain Tiles (Mapzen) -- SRTM/USGS. Buildings: (c) OpenStreetMap
> contributors, ODbL.

## Notes / robustness

- Tiles are cached; missing tiles (e.g. open ocean) are treated as sea level (0 m).
- Every elevation HTTP request uses `timeout=30`; Overpass uses `timeout=60` and
  tries multiple mirrors. If the network is down with no cache, the scripts print
  a clear error and exit non-zero without clobbering existing output.
- `fetch_buildings.py` caches the raw Overpass JSON to `out/{city}_osm_raw.json`;
  delete that file or pass `--force` to refetch.
- Resolution should be `2^n + 1` (513, 1025, 2049) for Unity Terrain; a warning is
  printed otherwise but it still runs.
- Optional libs `trimesh` / `numpy-stl` / `shapely` are **not required**; the
  pipeline degrades to numpy-only writers and reports what it used.
