# CITY BATTLE — Map, Scale, Water & Movement Design Notes

Captures the user's direction (2026-06-30) for the city-map / terrain side of the game.

## Scale — this is an ARTILLERY game
- Battlefields are LARGE. Late-game guns reach ~30 km (Rule the Waves precedent), so maps span
  tens of kilometres. The default Sydney theatre is **~32 x 31 km**.
- Terrain (topography + water) is the star; buildings are a dense overlay near the urban core.
- Two map sizes per city: a large "theatre" (sydney, 32 km) and a tight "assault" map
  (sydney_harbour, ~8 km) for close urban fights.
- Crabs are SMALL relative to the map — you zoom in to inspect them (RtW ship-icon feel).

## Water (from negative elevation)
- Any terrain at or below `water_level_m` (0 m = sea level) is WATER.
- The viewer renders a translucent water surface at sea level + depth shading (deeper = darker/bluer).
- Sydney is ~9% water (harbour, ocean, river inlets) — it reads clearly in both view modes.

## View modes (viewer)
- STANDARD SHADED — muted natural terrain (valley-green -> earth -> rock) with slope shading.
- COLOURED ELEVATION — hypsometric tint (low green -> tan -> brown -> grey-white) so relief and
  water channels read at a glance. Toggle in the legend; `?mode=elevation` for direct load.

## Amphibious & terrain movement (game model — to implement in sim)
- **Huge mecha-crabs are amphibious to a point:** they can WADE through water up to a depth tied
  to chassis size (a Leviathan/Siege wades deeper than a Skirmisher). Beyond max wade depth =
  impassable (must go around / use a crossing).
  - `wade_depth_m ~= f(chassis mass / height)` — Siege ~ deep, Recon ~ shallow.
  - While wading, speed is reduced (drag) and the hull sits lower (carapace becomes the exposed zone).
- **Terrain slows movement:** steep slopes reduce speed (already modelled in MechaUnit movement);
  water wading reduces speed; soft/built-up ground could too (future).
- This is consistent with the existing `MechaUnit.TickMovement` slope penalty; water-wade is the
  new axis to add (per-chassis max wade depth + in-water speed multiplier).

## Lore (user-authored)
- Cities are **inhospitable**: a downed crew can't survive long once their crab is knocked out —
  they must be **rescued/recovered** (a mechanic: extraction of downed crews).
- **Civilian crab-mechas** scavenge the battle area (neutral units; engaging them is a choice/penalty).
- Mission variety (RtW-style): straight battle, **convoy escort**, **destroy an emplacement**,
  recon, crew rescue, hold ground, etc. (mission-type system to be built on the existing sim).

## Movement feel (RtW-style)
- Crabs manoeuvre like ships: they can **side-step / present broadsides**, turn deliberately
  (turn-rate limited), and the side vs frontal armour distinction matters (flanking = hitting
  thinner flank plate). Strafing/broadside movement is a first-class order.

## Identification at range (RtW-style fog)
- Identifying a crab's exact class is **uncertain at long range** — contacts show as
  "CONTACT / IDENT UNCERTAIN" until close/observed enough. (Already reflected in the viewer's
  hostile unit label; to be a real spotting-confidence mechanic in the sim.)

## Pipeline (citymap/)
- `pipeline/fetch_dem.py` -> DEM tiles; `fetch_buildings.py` -> OSM; `build_map.py` -> canonical
  `data/<city>.citymap.json` (terrain grid + water + buildings in local metres).
- `web/` Three.js viewer consumes the same JSON; Unity will load it via a CityMapLoader so the
  web review and the game share one source of truth.
