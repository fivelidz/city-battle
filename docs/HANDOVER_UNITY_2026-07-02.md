# City Battle — Handover: Web Demo → Unity-First Build (2026-07-02)

The web tactical-map demo is **done and archived** (a good, playable barebones demo). We're now
transitioning to a **Unity-first, higher-fidelity build**: a much better map, proper visual panels,
POV display screens, and real art. This document hands that over.

---

## 1. TL;DR for whoever picks this up

- **The web demo (`citymap/web/viewer.js`) was a fast prototype + map-review viewer.** It proved the
  UX, the artillery/topography feel, and the tactical loop. Treat it as a **visual/UX reference**,
  not code to port.
- **The authoritative game already exists in Unity** — `Assets/Scripts/` is a deterministic, TESTED
  (89/89 EditMode) simulation with far more depth than the web demo ever had (real ballistics with
  drag, per-zone armour + vertical/horizontal penetration tables, subsystem/cook-off damage, LOS
  comms net with ghost contacts, EW/drones, fog-of-war AI, and a full 5-pillar campaign).
- **So "moving to Unity" is mostly: finish the Unity FRONT-END (map fidelity, panels, POV screens,
  art) on top of the sim that's already built and working.** Not a rewrite.

---

## 2. What the web demo delivered (and what to carry over as *design*, not code)

Everything in `docs/PLAYTEST_FEEDBACK_2026-07-01.md` (rounds 1–7) is the distilled UX spec, validated
by playtesting. The web features worth reproducing in Unity's HUD:

- True topographic map, **N-E-S-W compass**, fog-of-war viewshed, comms mesh, ballistic dead-space,
  slope/trafficability, real OSM suburb-boundary polygons (+ 4-colour territory infill), roads,
  buildings.
- **Maths fire-solution panel** (muzzle vel, QE, angle of fall, ToF, apex, charge zone, hit zone,
  multi-gun selector, "CANNOT REACH"), parabolic trajectory arcs (visible even for unselected units),
  a **combat POV inset** (LOS elevation profile with the real shell arc), immunity/THREAT band.
- **Command UX:** move/hold/attack flags + waypoints, right-click to remove a flag, flagship = star,
  formations, best-position; **unit panel with orders** (movement + speed + fire-at-will/hold-fire),
  current/max speed, HP + ammo bars; **Order-of-Battle list (U)**; spotted-enemy named contact list
  (👁 sees / ✛ fires / 📡 comms-revealed); auto-pause on events + event popups; **field wiki**;
  gameplay options; draggable panels; a title menu.
- **Barebones demo scenario:** 3v3 skirmish, eliminate win, command mode on by default.

These are UX targets. The Unity sim already supports the underlying mechanics for almost all of them.

---

## 3. What already exists in Unity (the canonical sim) — build ON this

`Assets/Scripts/` (namespaces `CityBattle.{Combat, Sim, Units, Data, Design, Campaign, AI, Terrain, UI}`):

- **Combat/** — `BattleSim` (fixed-tick conductor), `Ballistics` (real drag + low/high arcs),
  `TacticalInfo` (the four-gate gunnery model, UI-queryable), `CommsNet` (LOS relay + ghost contacts),
  `EWSystem`, `DroneAgent`, `CommandSystem` (flags/flagship/formations), `ObjectiveSystem`
  (eliminate/hold/escort/destroy), `Scenario` (Harbour/Ridge/Convoy), `CombatLog`, `BattleController`.
- **Sim/** — `SimClock` (20 Hz fixed step, pausable, 1×/2×/4×, render-interpolated), `SimRandom`
  (deterministic).
- **Units/** — `MechaUnit`, `ArmorZones` (per-zone armour + HitZone), `MechaSystems` (subsystem/
  cook-off damage), `MechaView` (**procedural placeholder crab** — replace with real art).
- **Design/** `MechaDesign`; **Campaign/** `CampaignState` (VP/prestige/tension/budget/roster),
  `ResearchSystem` (tech.csv), `GameState` (cross-screen singleton + save).
- **AI/** `CommanderAI` (fog-of-war-honest, deterministic).
- **Terrain/** `TerrainField` (headless LOS ray-march), `TerrainBuilder`, `HeightmapLoader`,
  `CityBuildings`.
- **Data/** `Database` + `GameData` over `Resources/CSV/` (guns, chassis, armor, drones, ew, nations,
  tech, verpen, horpen).
- **UI/** IMGUI screens: `BattleHUD`, `TacticalOverlay`, `OrderInput`, `BattleCamera`, `StrategicHUD`,
  `MechaDesignScreen`, `ResearchScreen`, `MainMenuScreen`, nav.
- **Tests/** — 10 EditMode files, ~89 tests. **Run them WITHOUT `-quit`** (the `-quit` flag races the
  runner — this was the fix): `Unity -runTests -batchmode -projectPath . -testPlatform EditMode
  -testResults out.xml -logFile log.txt`. Editor: `~/Unity/Hub/Editor/6000.4.2f1/Editor/Unity`.

---

## 4. The Unity-first gaps to close (the actual work)

Priority order for the higher-fidelity build the user wants:

1. **Map fidelity + unify on ONE map.** Web uses Sydney (`citymap/data/sydney.citymap.json`); Unity
   currently loads San Francisco (`StreamingAssets/Terrain/san_francisco_*`). Pick one (Sydney is the
   flagship) and load the **same citymap JSON** in Unity — higher-res terrain, real roads/buildings/
   suburb polygons draped, better shading than the web could do. The `citymap/pipeline/` scripts
   already produce the data; add a Unity loader for that JSON (or convert to the raw/meta format
   `HeightmapLoader` expects).
2. **Visual panels / HUD.** Rebuild the web demo's best panels as proper Unity UI (UI Toolkit or
   uGUI, not IMGUI) — unit panel with orders/HP/ammo, fire-solution maths panel, Order-of-Battle,
   contact list, combat log, auto-pause, wiki. The data all comes from `TacticalInfo` / `BattleSim`.
3. **POV display screens.** The user specifically wants real POV/camera screens (render-texture
   cameras down the firing LOS, gun-cam, unit portrait cam) — Unity can do this properly (the web
   version faked it with a 2D canvas after a GL-viewport bug). Use `RenderTexture` + a second camera.
4. **Real art.** Replace `MechaView`'s procedural crab with authored chassis/weapon models (Meshy.AI
   was mentioned). Terrain/building materials, water, weather VFX.
5. **Trajectory/analysis visuals in 3D** — the parabolic arcs, dead-space, immunity/threat band, and
   fog-of-war as real 3D overlays (the web `viewer.js` is the reference for how each should read).
6. **Per-gun ammo** (AT1) and any remaining depth items — most are already in the sim.

---

## 5. Where everything lives / deploy

- Game repo (private): `github.com/fivelidz/city-battle` → local `.../city_battle/rulethecity/`.
- Web demo: `citymap/web/` (viewer.js + index.html); live at **qalarc.com/projects/city-battle/**
  (from the `qalarc.ai` repo → Cloudflare Pages). Deploy is **stash-safe, city-battle files only**
  (concurrent `chanalyse` pushes — never `git add .`; see `docs/DEPLOY_ROLLBACK_LOG.md`).
- Map pipeline: `citymap/pipeline/` (fetch_dem / fetch_buildings / fetch_roads / **fetch_suburbs** /
  build_map). `build_map.py` emits a compact integer-coord JSON.
- Reference docs: `docs/wiki/` (8 chapters + 2 refs), `docs/SIM.md`, `docs/DESIGN.md`,
  `docs/INTELLIGENCE_LAYER.md`, `docs/TECH_TREE.md`, `docs/wiki/ref/ARTILLERY_DOCTRINE.md`,
  `docs/wiki/ref/RTW2_MECHANICS.md`, and the full playtest backlog
  `docs/PLAYTEST_FEEDBACK_2026-07-01.md`.

## 6. Archive / restore points

- **Full backup:** `~/projects/_ARCHIVES/city_battle/city_battle_barebones_demo_YYYYMMDD.tar.gz`
  (~69 MB, all source minus regenerable heavy dirs) + `standalone_web_demo_YYYYMMDD/` (runnable demo)
  + `README.md`.
- **Git tags:** `barebones-demo-v1`, `barebones-demo-v1.1` (the demo-ready milestone).
- **Filesystem snapshots:** `rulethecity/archive/barebones_demo_ready_YYYYMMDD/`.

---

## 7. Ground rules (keep)

- Never `rm`/delete; archive before overwrite.
- Keep the map **geographically true** (N-E-S-W) and gun ranges **hard-capped** (indirect never
  exceeds flat max; high-angle/mortar is short-range).
- The sim is **deterministic** — keep `SimRandom` (no `UnityEngine.Random` in sim code) so tests stay
  meaningful.
- Reference RtW3 mechanics + real artillery doctrine (the docs above).

---

*The barebones web demo did its job: it proved the game is fun and the two pillars — topographic 3-D
maps + real artillery mechanics — are compelling. The Unity project already holds the deep, tested
sim. The next phase is building the high-fidelity Unity front-end (map, panels, POV, art) on top of
it. Good foundation to hand over.*

---

## 8. "Is Unity actually the best direction?" — strategic assessment (2026-07-02)

**Verdict: yes, go Unity-first — but de-risk the build first, and keep the web demo alive.**

Reasoning:
- We are NOT choosing web vs Unity from scratch. The **deep, tested sim already lives in Unity**
  (~7.3k lines C#, 89 tests). The web `viewer.js` (~5.2k lines) is a SIMPLIFIED visualization/UX
  prototype. Going "web-first" would mean **porting the entire tested C# sim into JS** — expensive,
  risky, throws away determinism + tests. Going Unity-first means **building the front-end on a sim
  that already works.** Cheaper and safer.
- The user's goals — higher-fidelity map, visual panels, **POV/gun-cam screens**, real 3D art — are
  Unity's home turf (RenderTexture cameras, asset pipeline, terrain/LOD, lighting). The web had to
  FAKE the POV with a 2D canvas after a GL-viewport bug.

Caveats to handle, in order:
1. **RESOLVE THE UNITY BUILD BLOCKER FIRST** (`m_LockCount`/`unity_builtin_extra`, see docs/AUDIT.md).
   Editor + tests run, but standalone builds were failing. Don't build a big front-end on a project
   you can't ship. Confirm a running build — ideally a **WebGL** build to keep the shareable link.
2. **Reach regresses** off web. If "send a link, plays instantly" still matters, target Unity→WebGL
   so you keep both fidelity AND the qalarc.com teaser.
3. **Keep the web demo LIVE** as the public "try it now" teaser + the UX spec/reference. Don't delete.

Recommended sequence: (1) fix build + prove a WebGL export, (2) unify on the Sydney citymap in Unity,
(3) build the high-fidelity front-end (panels, POV cameras, art) on the existing sim, (4) keep web
demo live.

Wrong-call scenario (for completeness): ONLY if the top priority were frictionless 2-second
click-to-play reach over fidelity would staying web + slowly deepening the JS sim win. That's not the
stated goal.
