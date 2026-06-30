# CITY BATTLE — Handover (v0.2.0 "DREADNOUGHT CRAB")

> **v0.2 update — Enemy AI + localised damage + critical ballistics fix.**
> - **Enemy AI** (`Assets/Scripts/AI/CommanderAI.cs`): fights without cheating fog-of-war.
>   Scouts (launches recon drones / advances) when it has no contact; picks good firing
>   positions (high ground, hull-down, sensible standoff); focus-fires (prioritises spotted,
>   wounded, dangerous, in-range foes); chooses direct vs indirect fire; preserves badly-hurt
>   units. Wired in `BattleController` (`EnemyAI` on by default; `PlayerAI` toggles AI-vs-AI).
> - **Localised RtW3-style damage** (`Assets/Scripts/Units/MechaSystems.cs`): hits damage
>   discrete subsystems with distinct consequences — **leg groups → immobilisation**, **turrets
>   → disarmed**, **sensor mast → blinded (fire control collapses)**, **datalink → loses drone
>   control**, **ammo bay → cook-off (catastrophic)**, **reactor breach**, plus **fires that
>   spread** and are fought by damage control. No "sinking": a mecha is knocked out when
>   structurally destroyed OR mission-killed (immobile + disarmed). Splash now scales with
>   calibre and can shrapnel legs. HUD shows a live SYSTEMS status line; the 3D view lists/tints.
> - **CRITICAL BUG FIXED:** projectile drag coefficient was ~40x too high (8e-4), shedding
>   ~700 m/s² so shells fell *hundreds of metres short* — combat looked like it worked (units
>   fired) but never connected. Now calibre-based (`DragModel.DragFor`), aim point raised to the
>   target's mid-body so near-flat direct shots don't clip intervening crests, and dispersion
>   reworked as a ground-plane CEP with **ranging-in** (sustained settled fire brackets the
>   target). Verified: a full **AI-vs-AI battle now fights to a decision** (1 survivor vs 0,
>   337 damage dealt) in the test suite. **42/42 tests pass.**


> *Rule the Waves 3, on land, with artillery crab-mechas, on the real topography of the
> world's cities.* Real-time-with-pause tactical combat + deep design/research/management.
> Unity 6 (6000.4.2f1), URP, Android-first. NERV/Evangelion HUD aesthetic.

> **Status:** Vertical slice de-risked and **green**. All four pillars implemented in code and
> **32/32 EditMode tests pass**. The hard core is proven: real heightmap terrain, modular
> crab-mechas, RtwP sim with pause, ballistics + terrain-occluded line-of-sight, recon-drone
> spotting, penetration-vs-armour damage, and the drone/EW rock-paper-scissors layer.

Last updated: after the autonomous "continue across all elements / drones replace torpedoes /
add laser-charging-counters / build first prototype" build session.

---

## 0. WHERE THINGS ARE

- **Canonical Unity project:** `~/projects/unity_projects/phone_games/city_battle/rulethecity/`
  (the URP-template project the user created; everything was consolidated here).
  > There is a second, bare project at `city_battle/` (no rulethecity) — **ignore it**, it was
  > the initial scaffold; all real work lives in `rulethecity/`.
- **Docs:** `rulethecity/docs/` — `DESIGN.md`, `SIM.md`, `TECH_TREE.md` (81 techs).
- **Data tables (RtW3-style CSV):** `rulethecity/Assets/Resources/CSV/`
  — guns, verpen, horpen, chassis, armor, drones, ew, nations, tech.
- **Code:** `rulethecity/Assets/Scripts/` (asmdef `CityBattle.Runtime` + `CityBattle.Editor`).
- **Tests:** `rulethecity/Assets/Tests/EditMode/` (asmdef `CityBattle.Tests`).
- **Terrain pipeline:** `rulethecity/terrain_pipeline/` (Python: real city DEM → heightmap).
- **Scene:** `rulethecity/Assets/Scenes/Battle.unity` (the vertical slice; built by SceneBuilder).

---

## 1. HOW TO RUN / TEST  (headless, agent-friendly)

The Unity editor binary: `~/Unity/Hub/Editor/6000.4.2f1/Editor/Unity`

> ⚠️ Only ONE Unity instance can open the project at a time. If the user has the editor open,
> headless commands will abort with "another Unity instance is running". Close it first
> (`kill -TERM <pid>` of the `Hub/Editor/...Unity` process), then remove
> `rulethecity/Temp/UnityLockfile` if present.

### Compile-check (exit 0 = clean)
```bash
cd ~/projects/unity_projects/phone_games/city_battle/rulethecity
~/Unity/Hub/Editor/6000.4.2f1/Editor/Unity -projectPath "$PWD" -batchmode -quit -nographics -logFile /tmp/cc.log
# then: grep -E "error CS" /tmp/cc.log   (should be empty)
# assemblies land in Library/ScriptAssemblies/CityBattle.Runtime.dll + .Editor.dll
```

### Run all EditMode tests (currently 32/32)
```bash
cd ~/projects/unity_projects/phone_games/city_battle/rulethecity
~/Unity/Hub/Editor/6000.4.2f1/Editor/Unity -projectPath "$PWD" -batchmode -runTests \
  -testPlatform EditMode -testResults /tmp/tr.xml -logFile /tmp/test.log
# summary: grep -oE 'total="[0-9]+" passed="[0-9]+" failed="[0-9]+"' /tmp/tr.xml
```

### Rebuild the battle scene
```bash
~/Unity/Hub/Editor/6000.4.2f1/Editor/Unity -projectPath "$PWD" -batchmode -quit -nographics \
  -executeMethod CityBattle.EditorTools.SceneBuilder.BuildVerticalSlice -logFile /tmp/scene.log
```
Or in the editor: menu **CityBattle ▸ Build Vertical Slice Scene**.

### Play it (interactive editor)
Open `rulethecity` in Unity, open `Assets/Scenes/Battle.unity`, press Play.
Controls: **L-click** select a friendly mecha · **R-click** ground = move order, R-click enemy =
target · **1/2/3** = fire mode (Hold/Direct/Indirect) · **H** = hull-down · **R** = launch recon
drone · **WASD/arrows** pan · **Q/E** rotate · **scroll** zoom · HUD buttons = Pause/1x/2x/4x/Step.

### Real city terrain (San Francisco tested)
```bash
cd ~/projects/unity_projects/phone_games/city_battle/rulethecity/terrain_pipeline
python3 fetch_dem.py san_francisco      # downloads DEM tiles (no API key)
python3 make_heightmap.py san_francisco # -> out/san_francisco_height.raw + .png + _meta.json
```
Import the `.raw` via Unity Terrain ▸ Import Raw (16-bit, little-endian, sizes from `_meta.json`),
or load with `CityBattle.Terrain.HeightmapLoader`. SF range verified 3.6 m → 280.6 m (Twin Peaks).

### Unity MCP bridge
`com.coplaydev.unity-mcp` (MCP for Unity) is installed in the project manifest. When the editor
is open interactively, run **Window ▸ MCP for Unity ▸ Configure All Detected Clients** to let an
AI client drive the live editor. (Headless work above does not need it.)

---

## 2. ARCHITECTURE (the important bit)

**Deterministic, fixed-step sim decoupled from rendering** (docs/SIM.md). This is what makes it a
real wargame and makes it headless-testable.

```
SimClock (20 Hz fixed tick, pausable, 1x/2x/4x)  ── drives ──►  BattleSim.Tick()
   │ render frames interpolate between sim states                   │
   ▼                                                                 ▼ each tick, in order:
BattleController (Unity)  reads sim state, renders             1 orders → 2 movement →
   • TerrainBuilder → mesh + collider (proc noise OR real DEM) 3 vision/LOS → 4 drones →
   • MechaView (procedural crab + weapon sockets)             5 fire control → 6 ballistics →
   • projectile / drone visual proxies                        7 damage
```

### Key systems (Assets/Scripts/)
- **Data/** `GameData.cs` (typed defs + PenTable bilinear lookup), `Database.cs` (CSV loader).
- **Sim/** `SimClock.cs` (RTwP clock), `SimRandom.cs` (deterministic xorshift RNG).
- **Terrain/** `TerrainField.cs` (O(1) height + **analytic ray-march LOS** — the core new query),
  `HeightmapGen.cs` (procedural), `TerrainBuilder.cs` (mesh), `HeightmapLoader.cs` (real DEM).
- **Units/** `MechaUnit.cs` (sim unit: state/orders/movement/damage), `ArmorZones.cs`
  (per-zone armour + hit-zone geometry), `MechaView.cs` (crab visual + sockets).
- **Combat/** `Ballistics.cs` (firing-solution maths + projectile), `BattleSim.cs` (conductor),
  `DroneAgent.cs` (recon/strike/loiter agents), `EWSystem.cs` (jamming/laser-CUAS/hardening),
  `BattleController.cs` (scene owner).
- **Design/** `MechaDesign.cs` (weight/cost-budget blueprint + validation + JSON + instantiate).
- **Campaign/** `ResearchSystem.cs` (TechTree + year-gated stochastic ResearchState),
  `CampaignState.cs` (budget, production queue → roster, save/load).
- **UI/** `BattleCamera.cs`, `OrderInput.cs`, `BattleHUD.cs` (NERV/Evangelion IMGUI HUD).
- **Editor/** `SceneBuilder.cs`, `BatchTools.cs`.

---

## 3. THE CORE MODEL (ported from real Rule the Waves 3 data)

- **Guns:** calibre drives shell weight, ROF (down), range (up), cost, weight. 14 guns incl.
  rail/coil (later, higher velocity). `guns.csv`.
- **Damage = penetration-vs-range vs per-zone armour.** Two lookup tables: `verpen.csv`
  (face/direct, **drops** with range) and `horpen.csv` (plunging/top, **rises** with range).
  Zones: Carapace/Glacis/FlankL/FlankR/Legs/Cupola/Mantlet. Hull-down exposes only carapace.
- **Terrain-occluded LOS** (heightmap ray-march): direct fire needs LOS; **indirect fire** lobs
  over ridges at **spotted** targets — which is why **recon drones** matter (they see over terrain).
- **Drones replace torpedoes** as the late asymmetric unlock. Roles: recon/loiter/strike/swarm.
  Payloads incl. **laser**. Links: radio (jammable) / **fibre-optic (jam-immune, short)** / sat / mesh.
- **Electronic Warfare** (rock-paper-scissors): jammers degrade radio drones; fibre-optic immune;
  **laser C-UAS** hard-kills drones; hardened-link/freq-hop counter jamming; **charge bay** (laser
  charging) and laser-counter modules. `ew.csv` (12 modules).
- **Era curve 2025→2070** (alt-modern, no WW1/WW2): Dreadnought Crabs → Fire-Control → Sensor/
  Network → Drone Dawn → EW & Autonomy. 81 techs in `tech.csv` / `TECH_TREE.md`.
- **Nations:** 8 alt-history factions with combat/industrial/research perks. `nations.csv`.

---

## 4. WHAT'S PROVEN (tests)

`Assets/Tests/EditMode/` — 32 tests, all pass:
- **DataTests** (9): tables load; calibre↔ROF/range monotonic; rail/coil faster; verpen drops &
  horpen rises with range; recon+fibre+laser drones present; jammer+laserCUAS+chargeBay present.
- **SimTests** (7): elevation solver round-trips; out-of-range rejected; high>low arc; flat LOS
  clear; **ridge blocks LOS, elevated sees over**; bilinear height; **FULL SMOKE TEST: ridge hides
  hull-down enemy → recon drone spots it from altitude → indirect fire arcs over and damages it.**
- **EWTests** (4): jammer degrades radio link; **fibre-optic immune**; **laser C-UAS hard-kills**;
  hardened-link reduces jamming.
- **CampaignTests** (12): design validates within budget; overweight/too-many-weapons fail; design
  JSON round-trips + instantiates; tech tree loads all branches; starting tech granted; research
  completes over time; **production delivers a unit to the roster**; campaign save/load round-trips.

---

## 5. NEXT (deliberate, prioritised)

1. **Wire designed units into battle** — `BattleController` currently spawns hard-coded mechas;
   make it instantiate from `MechaDesign`/roster so the design pillar feeds combat.
2. **NERV management screens** — design/research/production HUDs (the `BattleHUD` IMGUI style is
   the seed; a UI-Toolkit pass for the heavy tables is the eventual goal).
3. **Real city in the scene** — swap `TerrainBuilder` procedural noise for the SF heightmap via
   `HeightmapLoader`; then add OSM building meshes (see research notes; Overture/OSM → glTF).
4. **Authored crab GLB models** via the Meshy.ai pipeline to replace `MechaView` primitives
   (sockets already named: Mount_Dorsal/FlankL/FlankR).
5. **AI opponent** — currently enemies are static targets; add basic move/target AI on the sim tick.
6. **Mobile build + on-phone test** (Redmi via `adb`; remember the HyperOS install gotcha →
   `~/projects/phone_projects/camera_system/install_with_miui_dialog.sh`).
7. **User to supply:** nation names/perks flavour, currency naming, how sci-fi the late game goes.

---

## 6. CONVENTIONS
- Data stays in human-editable CSV (fork-friendly, RtW3-style). Code reads CSV → typed defs.
- Sim code is deterministic: **never** `UnityEngine.Random` in sim — use `SimRandom`. No
  `Time.deltaTime` in sim logic — use `SimClock.SIM_DT`. Render reads sim, never writes it.
- `.opencodeignore` excludes `Library/`, big binaries, DEM rasters (RAM hygiene — see
  ~/projects/OPENCODE_MEMORY).
- `docs/` holds design truth; `USER_PROMPTS.md` logs prompts verbatim; `AUDIT.md` is the binding
  request checklist.
