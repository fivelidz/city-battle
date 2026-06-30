# CITY BATTLE — Simulation Architecture

The combat sim is **deterministic, fixed-step, and decoupled from rendering** — the defining
architecture of a real-time-with-pause wargame (RtW3 / Combat Mission style). This doc is the
contract every combat script obeys.

## 1. The clock — `SimClock`

A single authority (singleton/service) owns:
- `Paused` (bool) — when true, sim time does not advance, but rendering & UI stay live.
- `TimeScale` — `0` (paused), `1×`, `2×`, `4×` (RtW-style buttons).
- A fixed sim tick rate **`SIM_HZ = 20`** (50 ms/tick). Logic runs at 20 Hz; rendering at
  whatever the device gives (target 60, floor 30). Visuals **interpolate** between the last
  two sim states so 20 Hz logic looks smooth.
- An **accumulator**: each rendered frame adds `Time.deltaTime * TimeScale` to the accumulator;
  while `accumulator >= SIM_DT` we run one `SimTick()` and subtract `SIM_DT`. When paused,
  nothing is added, so the world freezes but the camera/selection/UI keep responding.

```
render frame:
  if !Paused: accumulator += dt * timeScale
  while accumulator >= SIM_DT: SimTick(); accumulator -= SIM_DT
  renderAlpha = accumulator / SIM_DT   // for interpolation
  Render(interpolate(prevState, curState, renderAlpha))
```

## 2. Orders vs resolution

The defining RtwP feel: **the world is frozen, the interface is live.**
- While paused (or running), the player issues **orders** (move-to, target, fire-mode,
  hull-down, deploy-drone). Orders are *intent* and go into each unit's **order queue/state**.
- Orders are **applied by the sim**, never directly by UI/render code. UI writes intent;
  `SimTick` reads intent and mutates sim state.
- This clean split makes the sim deterministic, save/replay-able, and headless-testable.

## 3. Determinism rules

- Sim state is mutated **only** inside `SimTick()` and only by sim systems.
- RNG is a single explicitly-seeded stream (`SimRandom(seed)`); never use `UnityEngine.Random`
  in sim code. Same seed + same orders ⇒ identical battle (enables replays & tests).
- No `Time.deltaTime` inside sim logic — use the fixed `SIM_DT`.
- Render/visual code may read sim state but must never write it.

## 4. Tick order (each `SimTick`)

1. **Intake orders** (consume queued player/AI intents into unit state).
2. **Movement** — integrate positions along paths; clamp to terrain height; update facing.
3. **Sensors / vision** — recompute each side's visible set (terrain LOS + drones). Cached;
   only recompute for units that moved or every N ticks.
4. **Fire control** — for each gun with a valid target & LOS (or spotted indirect target),
   compute firing solution; if ready & ROF cooldown elapsed, **spawn projectile**.
5. **Ballistics** — integrate in-flight projectiles (gravity + drag); test terrain impact
   (heightmap height compare, O(1)) and unit hits (short raycasts vs colliders).
6. **Damage resolution** — on hit: pick zone, look up penetration vs range, compare armour,
   apply damage (mobility/firepower/structure), spalling.
7. **Drones** — advance drone agents (move, loiter, spot, attack); apply jamming effects.
8. **State bookkeeping** — destroyed units, morale/suppression, win/loss check.
9. **Snapshot** — copy curState→prevState for next-frame interpolation.

## 5. Terrain-occluded Line of Sight (the core new query)

We do **NOT** physics-raycast every unit pair every tick. Instead:

### 5.1 Heightmap ray-march (analytic terrain LOS)
Given shooter S and target T (world XЗ positions, with eye heights):
- Walk the 2D segment S→T in K steps (step ≈ terrain cell size).
- At each sample point p, look up terrain height `h(p)` (O(1) heightmap lookup, bilinear).
- The straight sight ray has height `rayH(p) = lerp(S.eyeY, T.eyeY, t)`.
- If `h(p) > rayH(p)` at any sample ⇒ **terrain blocks LOS**. Else clear.
- Microseconds per query; this is the decades-old viewshed technique.

### 5.2 Tiered occlusion
1. Cheap heightmap ray-march for terrain (above) — reject most cases instantly.
2. Only for pairs that pass terrain test, raycast vs **building & unit colliders** (the
   discrete occluders the heightmap doesn't represent).
3. Cache LOS per ordered unit-pair; invalidate when either moves or every N ticks.

### 5.3 Defilade / hull-down
A unit behind a crest exposes only its **carapace**: LOS to its body is blocked but the top
zone may be hittable by **plunging/indirect** fire. Hull-down = deliberately occupying such a
spot — flanks/glacis hidden, only carapace exposed.

### 5.4 Indirect fire & spotting
- **Direct fire** requires LOS S→T.
- **Indirect / high-arc fire** does NOT require shooter LOS, but requires the target to be
  **spotted** (in some friendly unit's or **recon drone's** vision). This is why recon drones
  are a force-multiplier: they reveal defilade targets for over-the-ridge artillery.

## 6. Ballistics

Projectile integrated per sim tick:
- Launch velocity from gun muzzle velocity, elevation θ, bearing φ.
- `a = gravity + drag(v)` (drag ∝ -k·|v|·v; k from shell ballistic coefficient).
- Step position/velocity (semi-implicit Euler at SIM_DT, sub-step for fast shells).
- **Terrain impact:** when projectile Y ≤ `h(projectile.xz)` → ground hit at that point.
- **Unit hit:** short segment raycast each step vs unit colliders.
- **Firing solution (inverse):** to hit a known target point at range R with muzzle speed v,
  solve for elevation θ (low/high arc). High arc chosen when terrain occludes the low arc.
  Time-of-flight surfaced in the HUD (drives lead vs moving targets).

## 7. Hit & damage

- **To-hit:** base accuracy × fire-control tech × (stationary bonus) × (target stationary
  bonus) × range falloff × suppression. Dispersion pattern around the aim point; sample.
- **Zone selection:** geometry of impact (incoming angle vs target facing) picks the zone
  (frontal glacis / flank / carapace / legs / cupola / mantlet).
- **Penetration:** `pen = lookup(caliber, range)` (VerPen for direct face hits, HorPen for
  plunging/top hits) × shell-quality tech × nation AP modifier.
- **Resolve:** `pen` vs `zoneArmour × armourQuality`. Penetrate → internal damage roll
  (mobility/firepower/structure/sensors depending on zone); fail → bounce or spall (minor).

## 8. Save / replay / test

- Sim state is a serialisable struct graph (units, projectiles, drones, RNG seed/counter,
  order queues, tick #). Save = serialise; load = deserialise + resume.
- **Replay** = initial state + seed + ordered order-log; deterministic re-run.
- **Headless tests** drive `SimTick` directly with scripted orders and assert outcomes
  (no rendering) — mirrors the train_sort headless-test discipline.

## 9. Mobile performance levers
- 20 Hz sim decoupled from 60 Hz render; interpolate visuals.
- LOS caching (biggest win) — never re-march every pair every tick.
- Terrain heightmap doubles as collider (cheap ground queries).
- MultiMesh/instancing for projectiles & identical modules; LOD + impostors for distant mechs.
- When paused, drop render rate (battery/thermal friendly — a paused-heavy game is ideal).
