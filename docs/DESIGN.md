# CITY BATTLE — Design Document

> **Working title:** CITY BATTLE (codename `city_battle`)
> **Genre:** Real-time-with-pause tactical mecha-artillery wargame + deep design/research/management layer.
> **Pitch:** *Rule the Waves 3, on land, with artillery crab-mechas, fought across the real
> topography of the world's great cities.*
> **Engine:** Unity 6 (6000.4.2f1), URP, Android-first (Redmi Note 14 5G), desktop for dev.
> **Aesthetic:** NERV / Evangelion — stark technical HUD, monospace telemetry, hexes,
> hazard orange & red on near-black, angular panels, lots of live readouts.

---

## 0. The one-paragraph version

You are the high command of a near-future nation in an **alt-modern world that never had
WW1 or WW2**. Warfare is waged by **artillery crab-mechas** — multi-legged walking weapon
platforms that you **design** (chassis, armour scheme, gun calibre & placement, sensors,
and — later — drone bays and electronic warfare), **research** along a 2025→2070 tech curve,
**produce** within a budget, and **command** in **real-time-with-pause** battles across
**real 3D city terrain** (Sydney, San Francisco, New York, Tehran, Gaza, Shenzhen, Hong
Kong, London, Tokyo). Battles are won by **fire control and physics** — getting the right
mech to the right ridge, computing a firing solution over occluding terrain, and landing
shells that penetrate the enemy's armour where it's thin. The game is **deep, paused,
mathematical, and focused** — exactly the RtW3 loop, modernised and made visually legible.

---

## 1. Pillars (and how each maps to RtW3)

| Pillar | City Battle | RtW3 equivalent | Notes / upgrade |
|---|---|---|---|
| **DESIGN** | Build a mecha on a **weight + cost budget**: chassis size → split across legs/drive, armour (per-zone), guns (calibre/placement/arc), sensors, drone bays, EW. | Ship design: displacement → hull/armour/engine/guns/torpedoes. | RtW already had a `LT` "land battery" type + "4-in Field Battery" template — direct precedent. |
| **RESEARCH** | 2025→2070 tech tree: `Name; Year; Chance%; Cost; ID; Effect`. Year-gated, stochastic. Branches: Machinery, Armour, Hull/Chassis, Fire Control, Damage Control, Mountings, Guns/AP, **Drones**, **Electronic Warfare**, Sensors. | 14 research areas, identical schema. | Torpedo branch → **Drone branch**. New **EW branch** (jamming/fibre-optic/spoofing). |
| **COMBAT** | Real-time-with-pause. Give move/target/fire orders, pause freely. Ballistic arcs, **terrain-occluded line-of-sight**, per-zone armour penetration. | RtwP naval combat on a flat sea map. | **Terrain is the new ocean** — topography blocks LOS and shells; this is the core new challenge. |
| **MAP / TERRAIN** | Real heightmap city terrain. Hills, valleys, buildings = cover & blockers. | Flat sea (+ coast/land targets). | Topography is gameplay, not decoration. |
| **MANAGEMENT** | Budget, production queue, unit roster, research allocation, light politics between alt-history nations. | Economy, build queue, fleet, research, politics. | Politics **trimmed**: random futuristic nations w/ perks; no deep diplomacy sim. Production + research kept rich. |

**Explicitly scrapped from RtW3:** deep diplomacy/world-politics simulation, naval-specific
systems (torpedoes-as-such, submarines/ASW as literal subs). **Kept & deepened:**
production, research, unit design, the penetration-vs-range damage model, nation traits.

---

## 2. The alt-modern world & era curve (2025 → 2070)

A world where the 20th century's two great wars never happened, so military technology
followed a *different but analogous* curve. We **map RtW3's 1890→1950 progression onto
2025→2070**, compressed and re-themed for walking artillery:

| Phase | Years | RtW3 analogue | Mecha character | Unlocks |
|---|---|---|---|---|
| **Dreadnought Crabs** | 2025–2035 | Pre-dreadnought → dreadnought | Big, slow, heavily-armoured, **gun-centric**. Few huge guns + secondaries. Crude optical/early-digital fire control. | Heavy chassis, thick belt armour, large-calibre rail/coil & conventional guns, basic rangefinders. |
| **Fire-Control Era** | 2035–2045 | Director firing, better optics | Faster, better-aimed. Centralised fire control, stabilised mounts. | Director firing, stabilisation, improved AP, triple mounts. |
| **Sensor & Network Era** | 2045–2055 | Radar, fire-control computers | Networked units share targeting. Radar/LIDAR. | Active sensors, datalink, computed firing solutions, all-or-nothing armour schemes. |
| **Drone Dawn** | 2055–2063 | **Torpedo / light-forces era** | **Drones arrive** as the new asymmetric threat (the torpedo-equivalent late unlock). Recon + strike + early swarms. | Recon drones (extend LOS over terrain!), loitering munitions, drone bays. |
| **EW & Autonomy** | 2063–2070 | Late-war tech (radar FC, oxygen torps) | Electronic warfare dominates. Jamming, **fibre-optic-tethered drones** (unjammable), spoofing, swarm AI, C-UAS hard-kill. | Jammers, fibre-optic control, frequency-hopping, swarm autonomy, counter-drone turrets. |

**Design intent:** early game *feels* like Rule the Waves dreadnought duels (slow, armoured,
gun-vs-gun, terrain manoeuvre), and the **drone/EW layers arrive late** exactly as torpedoes
& radar did in RtW — they don't replace the gun core, they add a rock-paper-scissors layer
on top of it.

---

## 3. Core combat model (the maths)

This is ported directly from RtW3's real data model (verified by reading the game files).

### 3.1 Guns
A gun is defined by **calibre** (its primary stat); calibre drives everything else:
- shell weight, rate of fire (rounds/min), max range, cost, weight, turret cost.
- Bigger calibre → heavier shell, **lower** ROF, **longer** range, much higher cost/weight.

### 3.2 Penetration vs range (the heart of damage)
Two lookup tables, keyed by **(calibre, range)**:
- **VerPen** (vertical / face-on penetration): **drops** with range.
- **HorPen** (horizontal / plunging / top penetration): **rises** with range (shells plunge).
At impact: pick the hit zone, look up penetration for the shell's calibre at the actual
range, compare to that zone's armour thickness. Penetrate → internal damage; fail → bounce/spall.

### 3.3 Armour — per zone
A mecha's armour is tracked **per location** (RtW3 tracked belt/deck/conning-tower/turrets/
secondary). Our zones (crab-themed):
- **Carapace (top/deck)** — vs plunging fire. Thin here = vulnerable to high-arc artillery.
- **Frontal glacis (face belt)** — vs direct fire from the front.
- **Flank plates (side belt)** — vs direct fire from the sides (flanking matters).
- **Leg actuators** — mobility kill if hit; usually lighter.
- **Sensor/command cupola** — fire-control kill if hit.
- **Gun mantlets** — per-weapon.
Armour **scheme** choice (distributed vs all-or-nothing) is a design decision, as in RtW.

### 3.4 Terrain-occluded line of sight (THE new mechanic)
Because we fight on real topography, **LOS and shell paths are blocked by terrain**:
- **Direct fire** needs clear LOS shooter→target (heightmap ray-march, §Sim doc).
- **Indirect / high-arc fire** can lob over a ridge **if** the target's position is known
  (spotted directly, or by a **recon drone / forward unit**) — this is why drones matter.
- Hills give **defilade** (hull-down): expose only your carapace, hide your flanks.
- A unit on a **ridge/high ground** sees & shoots farther; valleys are blind.

### 3.5 Movement & firing
- **Stationary firing is more accurate** (settled mount) and the **target is easier to hit
  when stationary** — moving = harder to hit but worse accuracy yourself. Classic trade.
- Orders: **Move to position**, **Target unit**, **Set fire mode** (hold/direct/indirect),
  **Hull-down**, **Deploy drone**. All issued freely while **paused**; resolved on unpause.
- Time controls: **Pause / 1× / 2× / 4×** (RtW-style).

---

## 4. Drones & Electronic Warfare (the modern upgrade over torpedoes)

Drones are **active agents on the map**, not fire-and-forget runs. This is the single
biggest improvement over RtW's torpedoes.

### 4.1 Drone roles
- **Recon drone** — extends your vision over terrain (spots defilade targets for indirect
  fire). Cheap, unarmed, the LOS force-multiplier. *(First milestone uses this.)*
- **Loitering munition** — orbits an area, dives on a target; good vs thin carapace armour.
- **Strike drone** — direct attack run with a shaped-charge / frag / EMP payload.
- **Swarm** (late) — many cheap drones with autonomy; saturate point defence.

### 4.2 Drone tech axes (the rich tree torpedoes never had)
- **Airframe / endurance** — range, loiter time, speed, **altitude** (altitude defeats terrain occlusion).
- **Payload** — anti-armour (shaped charge), frag, thermobaric, **EMP** (vs electronics).
- **Autonomy** — manual → waypoint → fire-and-forget → swarming AI.
- **Datalink / control** — radio (jammable) → **fibre-optic tether** (unjammable, but
  range- & mobility-limited, exactly like 2024-era FPV drones) → satellite/mesh.

### 4.3 Electronic Warfare (rock-paper-scissors)
- **Jammer emplacement** on a mecha degrades enemy **radio** drones in a radius.
- Counter: **fibre-optic drones** (immune to jamming, but tethered → short reach) or
  **frequency-hopping / hardened links** (EW research).
- **GPS spoofing**, **drone detection**, and **C-UAS hard-kill turrets** (point defence) round it out.
- This creates real loadout decisions: do you carry guns+armour, or sacrifice weight for
  a jammer and counter-drone defence?

---

## 5. Nations (alt-history, trimmed politics)

Random/authored **futuristic nations** with **perks/traits** (RtW3 modelled these compactly:
Accuracy, DamageControl, APShellQuality, NightFighting, plus personality traits like
TechnicalExcellence, EfficientShipbuildingIndustry). We reuse that compact model:
- **Combat modifiers:** Accuracy, DamageControl, ArmourQuality, FireControl, DroneDoctrine, EWStrength.
- **Industrial traits:** EfficientFabrication (cheaper builds), TechnicalExcellence (faster research), etc.
- **Research biases:** per-branch advantages (a nation strong in Drones, weak in Armour…).
- **Light politics:** tension/alliance between nations drives *which* wars happen and the
  budget you get — but **no deep diplomacy sim**. Names & perks are author-supplied (user
  will provide nation names/perks later).

---

## 6. Scope — milestones

### Milestone 1 — VERTICAL SLICE (de-risk the hard core) ← BUILDING NOW
Prove the genuinely risky tech in one scene:
1. **One real city's heightmap terrain** imported into Unity.
2. **2–3 modular crab-mechas** (placeholder geometry, real weapon sockets).
3. **Give move orders + pause** (RtwP sim loop).
4. **One artillery arc** with **terrain-occluded line-of-sight** (ballistics + heightmap LOS).
5. **One recon drone** that extends vision (spots a defilade target for indirect fire).
Success = paused/resumed battle where a hull-down mech is invisible until a drone spots it,
then takes indirect fire over a ridge. *Framerate to spare on the Redmi.*

### Milestone 2 — DESIGN + DATA (concurrent)
- ScriptableObject data model for guns/chassis/armour/drones, CSV-backed tables.
- Mecha **design screen** (NERV UI): pick chassis, spend weight/cost budget, place guns.
- Designs save/load as JSON; the battlefield model is reconstructed from the design.

### Milestone 3 — RESEARCH + MANAGEMENT (concurrent)
- Tech tree data + research allocation screen (year-gated, stochastic).
- Production queue + budget + roster.

### Milestone 4 — CAMPAIGN GLUE
- Nations, wars trigger battles, battle outcomes feed back into economy/research.

**Per the user:** gameplay, design, research, and management are built **concurrently** and
converge logically — Milestone 1 de-risks, then the layers grow in parallel on the shared
data model.

---

## 7. Aesthetic & UI direction — NERV / Evangelion

- **Palette:** near-black (#0A0C0E) base; hazard **orange (#FF6B1A)** and alert **red
  (#E5232B)** accents; readout **green (#39FF14)/amber**; thin white hairlines.
- **Type:** monospace for all telemetry/data (calibre, range, pen, bearing, ETA); a
  condensed sans for headers. Everything reads like an instrument.
- **Shapes:** hexagons, angular cut-corner panels, concentric range rings, bearing tapes,
  crosshair reticles, "PATTERN ORANGE"-style alert banners.
- **Motion:** terse, snappy, slight scanline/CRT vibe; numbers tick; warnings flash.
- **Battle HUD:** selected-unit telemetry panel, firing-solution overlay (range/bearing/
  time-of-flight/pen-vs-armour), LOS/defilade shading on terrain, drone feed inset.
- Follows good UI practice: clear hierarchy, legible at phone size, touch-first targets,
  consistent grid. Semantic, accessible, high-contrast.

---

## 8. Tech stack & conventions

- **Unity 6 / URP**, Input System, MCP-for-Unity bridge installed (`com.coplaydev.unity-mcp`).
- **Data-driven:** ScriptableObjects authored from CSV tables in `Assets/Resources/CSV/`
  (so the RtW-style tables stay human-editable and forkable).
- **Sim/render split:** deterministic fixed-step sim, separate from rendering (see `SIM.md`).
- **Terrain pipeline:** Python (Overture/OSM buildings + Copernicus/USGS-3DEP DEM) → heightmap
  PNG + glTF, baked offline, imported as Unity assets (see `TERRAIN_PIPELINE.md`).
- **House conventions** (from train_sort/vector_run): `docs/` with DESIGN/AUDIT/etc.,
  `USER_PROMPTS.md` verbatim log, `HANDOVER.md`, headless test scripts, version file.
- **`.opencodeignore`** excludes `Library/`, big binaries, DEM rasters (RAM hygiene).

---

## 9. Open questions for the user (non-blocking)
- Nation names + perks (you said you'll supply these).
- Which city for the Milestone-1 slice? (Default pick: **San Francisco** — dramatic hills =
  best showcase of terrain-occluded LOS + defilade, and US 3DEP 1 m DEM is free/public-domain.)
- Currency/era flavour names (research points, build budget naming).
- How sci-fi the late game goes (rail/coil guns, energy weapons?) — currently: plausible
  near-future (rail/coil + conventional + drones + EW), not laser-fantasy.

*This document is the source of truth for direction. Update it as decisions are made.*
