# The Map & Terrain

Terrain is the new ocean. Where Rule the Waves fought on flat sea, CITY BATTLE fights on the **real
3D topography of real cities** — and that topography blocks line of sight and shell paths, creating
defilade, dead space and immunity zones (01_FIRE_AND_BALLISTICS). The map is gameplay, not scenery.

## Real DEM terrain
- The battlefield is built from a **real-world digital elevation model** — **Copernicus DEM GLO-30**
  (~30 m, accurate, proper ocean ≈ 0), so hills, ridges and valleys are **geographically true**.
- Real **OpenStreetMap buildings** are draped on the terrain as footprints + heights — additional
  LOS blockers and cover.
- Cities planned/used: Sydney (first), San Francisco, New York, Tehran, Gaza, Shenzhen, Hong Kong,
  London, Tokyo. Hilly cities (SF, Sydney) best showcase terrain-occluded LOS and defilade.

## Water from elevation
- **Water is derived from negative/low elevation** against a water level — anything below it is sea,
  harbour or river. This is why **Sydney Harbour** becomes a real obstacle.
- Water gates movement: only **amphibious** crabs can cross (early = can't fire in water; later =
  fire with a penalty — see 02_CRAB_DESIGN), making **strategic water crossings** a real tactic.

## Weather & wind
- Live or per-battle **weather**: a wind / precipitation / pressure field plus an upper-air profile
  (Open-Meteo in the pipeline). **Precipitation slows crab movement**; **fog/rain/haze/night cut
  spotting** and push fights to short range (03_COMBAT). Wind nudges drones and long shell flights.

## Map scales
- **Large theatre maps** — full-city extents for big-class engagements (Line/Siege lances over long
  ranges).
- **Suburb-scale maps** — smaller, **local-area** maps (a particular suburb) suited to **smaller
  classes** (Recon/Skirmisher), with tighter, more urban fights. A **suburb overlay** view mode
  labels districts.

## Performance & LOD
- The periphery is only **rendered when in range or in sight** — outer areas load/draw by visibility
  (LOD), keeping framerate to spare (the target device is a phone). High detail where it matters,
  cheap where it doesn't.

## The map pipeline
The real-area → 3D pipeline is a **standalone, reusable method** (reference:
`citymap/PIPELINE_METHOD.md`, schema `citymap/MAP_FORMAT.md`). From a lon/lat bounding box it
produces **one `*.citymap.json`** in a single local-metre frame containing:

| Layer | Content |
|---|---|
| **Terrain** | `res × res` heightmap (m above sea level), cell size, min/max |
| **Buildings** | OSM footprint polygons (local m) + height + terrain height beneath |
| **Weather** | (optional) wind/precip/pressure field + upper-air profile |
| **Geo metadata** | bbox, origin, real-world size in metres, water level |

One JSON, one coordinate frame — so the **web viewer (Three.js)**, the **Unity terrain**, and even a
**printable STL** all line up from one source of truth (free data, no API keys; attribution required
— Copernicus DEM, © OpenStreetMap contributors ODbL, Open-Meteo CC BY 4.0).

## Camera & overlays
- **WASD free-fly camera** — look around the map freely to plan positions and read the terrain.
- **Suburb overlay** view mode — district boundaries/labels.
- **Fog-of-war LOS shading** — terrain is shaded by what your crabs can currently see (03_COMBAT).
- **Immunity-zone & fire-shadow overlays** — the map draws each gun's **dead-space / fire shadow**
  behind crests (flat vs indirect, at different ranges) and the **immunity band** for a selected
  crab vs a chosen enemy shell size, so you can read penetration depth and safe positioning straight
  off the terrain.
