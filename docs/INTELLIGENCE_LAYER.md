# CITY BATTLE — Intelligence, Comms & Detection Layer (design notes)

Captured from user direction (2026-06-30). To be implemented after the current task list.
This is the **fog-of-war / command-and-control** layer that makes CITY BATTLE a true fleet-command
game. It builds on the existing terrain LOS + viewshed + drone spotting — little new core tech.

## Core lore decision: comms are LINE OF SIGHT (laser / tight-beam)
The world's electronic warfare is so severe that **radio is unreliable** — fleets rely on
**tight-beam laser / optical comms**, which need **line of sight** between units (or relays).
This is the elegant choice because it **reuses the LOS ray-march** already used for fire & vision,
and makes terrain the heart of command-and-control.

## 1. Comms / control range (the command net)
- A crab is **on the comms net** if a friendly **relay** (another crab, a recon/relay drone, or a
  command node) has **line of sight** to it (terrain-occluded ray-march, same as fire LOS),
  within a comms range that scales with the comms gear/tech.
- **On the net** → you can give it orders in real time AND receive its **live intel** (what it
  sees, its status).
- **Off the net** (no friendly LOS / out of range) → you **cannot control** it (it follows its
  last orders / a fallback doctrine) and you get **no live intel** from it. You only know its
  **last-known position** — a "ghost" marker that ages/drifts the longer contact is lost.
- The net is **relayed**: A sees B, B sees C → C is on the net via B even if HQ can't see C.
  High ground units and drones become **relay nodes** linking the fleet.

## 2. What breaks comms
- **Comms mast / datalink subsystem hit** — a crab whose comms mast is destroyed can't transmit/
  relay (cut off even with LOS). (Add a `CommsMast` subsystem alongside SensorMast/Datalink.)
- **Jamming** — degrades the radio fallback and any non-laser links in a radius (existing EW).
- **Terrain** — walking behind a ridge / into defilade drops LOS to relays → off the net.
- **Range** — beyond comms range even with LOS.

## 3. Tech ladder (comms & detection)
- **Optical/laser link** (early) — LOS comms, the baseline.
- **Relay drones** — fly up to bridge LOS gaps / extend the net over terrain.
- **Hardened/freq-hop radio** (existing EW) — partial non-LOS fallback, jam-resistant.
- **Satellite / mesh comms** (late) — LOS-independent control (removes the fog-of-control), the
  premium endgame unlock. Until then, terrain genuinely limits command.

## 4. Detection & intelligence (who can you see, and how well)
- **Visual / sensor spotting** (existing viewshed) — see units in LOS & sensor range.
- **Identification uncertainty at range** (existing) — a far contact is "CONTACT — IDENT
  UNCERTAIN"; closer/observed longer → class identified → reveals its armour/guns (immunity-zone
  math becomes possible).
- **Radio Direction Finding (RDF)** — a detection tech: locate **emitting** units (anyone using
  radio / active sensors / jammers) by their emissions, even without LOS — but only a bearing/
  rough position, not an ID. Encourages emission control (go quiet).
- **Camouflage** — reduces an enemy's detection range & hit chance vs you (design/tech option).
- **Last-known location / ghost markers** — when you lose contact (visual or comms), the unit's
  last-seen position is held as a fading "ghost"; you can **fire on the last-known position**
  (predicted fire — already in the sim) but it may have moved.
- **Intelligence (strategic)** — the campaign intel budget (RtW) can buy advance sight of enemy
  designs / steal tech, at the cost of raised tension (already in the management model).

## 5. How it slots onto what exists
| Existing system | Extension for this layer |
|---|---|
| Terrain LOS ray-march | also computes the comms-relay net (friendly LOS graph) |
| Viewshed / fog of war | gains a **comms fog** (control fog) on top of the vision fog |
| Drone spotting | recon/relay drones also extend the comms net |
| Subsystems (SensorMast/Datalink) | add **CommsMast**; its loss cuts the unit off |
| EW (jammer/hardened/freq-hop/fibre) | jamming degrades radio fallback; fibre-optic = unjammable |
| Spotting confidence (ID at range) | drives the intel reveal of enemy armour/guns |
| Predicted fire (last-known pos) | ghost markers + fire-on-last-known already supported |

## 6. UI implications (later)
- Map shows the **comms net** (LOS links between friendly relays) and **off-net units** dimmed /
  marked "NO CONTACT — last seen 00:42, ghost pos".
- A crab inspect panel shows COMMS: ON NET (via <relay>) / OFF NET, and comms-mast health.
- RDF contacts shown as bearing lines / uncertain ellipses (emitter detected, not IDed).
- Toggle to view the comms-relay network like the LOS/range overlays.

**Status:** design captured. Implement after the current task list (models/hub/wiki/class-derivation/
tutorial). Most of it is additive on the existing LOS + subsystem + EW + drone systems.
