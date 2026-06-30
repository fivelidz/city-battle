# CITY BATTLE — AUDIT (binding request checklist)

Honest, code-verified status of every user request. ✅ done & tested · 🟡 partial/stubbed ·
⬜ not started. Reconcile all work against this file.

## THE FIVE COMPONENTS (architecture overview)
All five share one data model (`docs/MECHA_SCHEMA.md`) and one app flow (Menu → Campaign →
Design → Research → Battle, via `GameState` singleton + `GameNav`/`NavBar`). **55/55 EditMode
tests pass.**

1. **COMBAT / MAP** ✅ — RTwP sim, ballistics, terrain-occluded LOS, per-zone armour penetration,
   four-gate model (Detected/In-range/Locked/Penetrates) surfaced in the HUD, combat log,
   mecha status diagram, drones + EW, enemy AI. (`Sim/`, `Combat/`, `AI/`, `UI/BattleHUD`, `UI/TacticalOverlay`)
2. **MECHA DESIGN** ✅ — full attribute schema (chassis/armour/guns/modules/drones, caliber &
   power gates), shipyard UI (`UI/MechaDesignScreen`), validation, JSON save, instantiate→battle. Tested end-to-end.
3. **RESEARCH** ✅ — 81-tech year-gated stochastic tree, viewer UI (`UI/ResearchScreen`).
4. **CAMPAIGN / MANAGEMENT** ✅ — budget, production queue → roster → deploy-to-battle (tested),
   nations w/ perks, save/load. (`Campaign/`, `UI/StrategicHUD`)
5. **CITY TOPOGRAPHY** ✅ — real DEM → heightmap (9 cities, SF tested 3.6–280.6m), OSM buildings
   (71k for SF) → 3D OBJ, watertight STL for **3D printing**, Unity loaders (`HeightmapLoader`,
   `CityBuildings`), wired into battle as an option. (`terrain_pipeline/`, `Terrain/`)

> **BUILD BLOCKER:** the Unity Editor on this machine currently cannot produce ANY standalone
> player build (even an empty scene) — it fails writing `unity_builtin_extra` with an
> `m_LockCount==0` assertion during player shader processing. This is an Editor-installation
> issue (not game code: 55/55 tests pass, all scenes build). Fix = build via the interactive
> Unity GUI (File ▸ Build) or repair/reinstall Unity 6000.4.2f1. See HANDOVER.md.

---

## Combat / map mechanics
- ✅ Real-time-with-pause sim loop (fixed 20 Hz, Pause/1x/2x/4x/Step) — `SimClock`, tested.
- ✅ Give move orders to position — `OrderInput` + `MechaUnit.TickMovement`, tested via sim.
- ✅ Target enemy + fire control calculations — `BattleSim.TryFire` + `Ballistics`, tested.
- ✅ Pausing common / orders while paused (intent buffered) — `SimClock` + `OrderInput`.
- ✅ Real ballistics physics (gravity + drag, low/high arc firing solution) — `Ballistics`, tested.
- ✅ **Terrain-occluded line-of-sight** (heightmap ray-march) — `TerrainField.HasLineOfSight`, tested.
- ✅ Topographic terrain as blocker — ridge blocks LOS & shells; hull-down/defilade, tested.
- ✅ Stationary firing more accurate + stationary target easier to hit — `BattleSim.ApplyDispersion`.
- ✅ Armour depth (per-zone mm) + shell size (calibre) damage model — `ArmorZones` + pen tables, tested.
- 🟡 Visuals of combat — procedural crab `MechaView` + terrain mesh + projectile/drone proxies;
  authored GLB models & FX are next.
- ⬜ Enemy AI (enemies are currently static targets) — listed in HANDOVER "Next".

## Mecha design component
- ✅ Weight + cost budget design (chassis → armour/guns/EW/drones) — `MechaDesign`, tested.
- ✅ Different gun emplacements / sockets on the crab — `MechaView` named sockets; `WeaponInstance.mountSocket`.
- ✅ Armour depth + shell-size design choices — per-zone mm + calibre selection, validated.
- ✅ Design save/load (JSON) + instantiate into battle unit — tested.
- 🟡 Design SCREEN (UI) — model is done & tested; the NERV design UI screen is next.
- 🟡 Machine guns / multiple weapon types — small-calibre autocannons exist in `guns.csv`; multi-mount supported.

## Drones (replacing torpedoes)
- ✅ Drones as late-game asymmetric unlock (Drone Dawn 2055+) — `drones.csv`, year-gated, tested.
- ✅ Recon drone extends vision over terrain — `DroneAgent` + `BattleSim` vision, smoke-tested.
- ✅ Jamming + fibre-optics — `EWSystem`: jammer degrades radio, fibre-optic immune, tested.
- ✅ Drone tech: range, weaponry, **laser charging, counter systems** — `drones.csv` (laser payloads,
  fibre-optic, swarm) + `ew.csv` (laser C-UAS, charge bay, laser counter), tested.
- ✅ Strike / loiter / swarm roles + payloads (shaped/frag/thermobaric/EMP/laser) — `DroneAgent.Detonate`.

## Research & progression
- ✅ Tech tree 2025→2070, RtW3 schema (Name;Year;Starting;Chance%;Cost;TechID;Effect) — `TECH_TREE.md`
  (81 techs, 10 branches), `tech.csv`.
- ✅ Year-gated stochastic research — `ResearchState.Advance`, tested (completes over time).
- ✅ Dreadnought-crab start → progresses (armour/guns/FC/sensors/drones/EW eras) — era curve, data.

## Management / production
- ✅ Budget + production queue → roster delivery — `CampaignState`, tested.
- ✅ Campaign save/load (JSON) — tested.
- ✅ Nations (alt-history, perks/traits) — `nations.csv` (8), `NationDef` modifiers applied in combat.
- 🟡 Politics between futuristic nations — data + modifiers exist; tension/war-trigger glue is light by design.
- 🟡 Management SCREENS (UI) — model done; NERV production/research/roster UIs are next.

## Cities / terrain / 3D-print interest
- ✅ Real topographic terrain pipeline (DEM → 16-bit heightmap) — `terrain_pipeline/`, **SF tested**
  (3.6–280.6 m, Twin Peaks accurate); 9 cities bbox built-in.
- ✅ Unity heightmap loader for real DEMs — `HeightmapLoader.cs`.
- 🟡 City buildings (OSM/Overture → meshes) — researched & documented; not yet wired (next).
- 🟡 3D-print / real-estate reuse — same DEM pipeline feeds it; STL/watertight export documented in research, not built.
- ⬜ Use the SF heightmap IN the battle scene (currently procedural) — quick follow-up.

## Aesthetic
- ✅ Evangelion/NERV HUD — `BattleHUD` (hazard orange/red on near-black, monospace telemetry,
  firing-solution readout, force status, time controls).
- 🟡 Good UI practices / "utml" (UI Toolkit) — IMGUI used for the slice; UI-Toolkit pass planned for dense screens.

## Engine / infra
- ✅ Unity 6 project `rulethecity` (URP, Input System, test framework) — consolidated, compiles clean.
- ✅ Unity MCP bridge installed (`com.coplaydev.unity-mcp`).
- ✅ Headless compile + test workflow (32/32 EditMode tests pass).
- ✅ House docs (DESIGN/SIM/TECH_TREE/HANDOVER/USER_PROMPTS/AUDIT), `.opencodeignore`, version.

---
*Update this file as items move ⬜ → 🟡 → ✅. Never claim ✅ without a test or a verified run.*
