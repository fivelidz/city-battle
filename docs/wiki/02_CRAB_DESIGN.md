# Crab Design — the Foundry

Where you build a crab-mecha as a **walking warship**. A design is a **budget allocation**: a
chassis gives you a mass budget, weapon mounts and utility slots; you spend them on **armour
(per zone)**, **guns (and where they sit)**, and **modules**. Balance decides the crab's auto-class
and its **immunity zone**. (Schema: `MECHA_SCHEMA.md`. Data: `Assets/Resources/CSV/`.)

## Chassis classes → Rule the Waves codes
Each chassis "look" maps to an RtW ship-class code. As in RtW, the **class label is partly
derived** from your finished numbers (tonnage, gun bore, armour, speed) — up-gun & up-armour a Line
and it reads as a heavy cruiser; strip the belt off a Siege and keep the guns and it reads as a
battlecruiser.

| Chassis | Class | RtW code | Mass (t) | Legs | Speed | Mounts | Util | Max bore | Year | Role |
|---|---|---|---|---|---|---|---|---|---|---|
| **Whippet** | Recon | scout strider (DD-ish) | 28 | 6 | 72 | 1 | 3 | 57mm | 2027 | scout/spotter/EW carrier |
| **Jackal** | Skirmisher | **DD** destroyer-crab | 55 | 6 | 60 | 2 | 2 | 90mm | 2025 | fast harasser, anti-light/anti-drone |
| **Hoplite** | Line | **CL** cruiser-crab | 120 | 8 | 42 | 3 | 3 | 155mm | 2025 | balanced workhorse |
| **Phalanx** | Line | **CA** heavy cruiser-crab | 165 | 8 | 38 | 4 | 3 | 180mm | 2031 | up-gunned line crab |
| **Bastion** | Spider | stable **CA** gun platform | 210 | 12 | 30 | 5 | 4 | 203mm | 2029 | many legs = hard to immobilise |
| **Leviathan** | Siege | **BB/BC** battle-crab | 360 | 8 | 22 | 6 | 3 | 305mm | 2025 | dreadnought-crab: biggest guns, thickest belt, slow |
| **Carrier-Crab Nimbus** | Carrier | **CV** drone carrier | 240 | 10 | 34 | 3 | 6 | 127mm | 2056 | drone mothership, many utility slots |

**What the codes mean** (from RtW, see `ref/RTW2_MECHANICS.md`): **DD** destroyer = small, fast,
lightly armoured; **CL** light cruiser = medium; **CA** heavy cruiser = bigger guns & armour; **BC**
battlecruiser = battleship guns on a *fast, lighter-armoured* hull (speed bought with armour);
**BB** battleship = heaviest guns + thickest belt, slow; **CV** carrier = hull given to drones, light
guns. **Recon < DD < CL < CA < BC/BB** in tonnage and bore.

## Per-zone armour scheme
Armour is set as **thickness (mm) per zone**, not one number. Mass cost = zone area × thickness ×
material density; effective protection = `thickness × material quality × nation armour quality`.

| Zone | RtW analogue | Threatened by |
|---|---|---|
| **Bow / glacis** | front belt | direct (flat) fire from ahead |
| **Port / starboard flank** | side belt | flanking fire, broadside exposure |
| **Stern** | rear belt | fire from behind |
| **Deck / carapace** | deck | plunging/indirect fire at long range, drone top-attack |
| **Legs** | (rudder/screws) | any hit; enough = immobilised → fixed battery |
| **Cupola / sensor head** | conning tower | a hit here **blinds** fire control |
| **Mantlet** | turret face | protects each gun mount |

The **glacis/flank vs carapace** split is the core decision — it sets your **immunity zone** (the
range band where neither side nor top can be penetrated by a given enemy gun; see
01_FIRE_AND_BALLISTICS). **All-or-nothing** layout (a 2046 tech) concentrates armour on the vitals.

**Armour materials** (`armor.csv`, year-gated by research):

| Material | Year | Density | Quality | Cost/t |
|---|---|---|---|---|
| RHA Steel | 2025 | 7.85 | 1.00 | 1000 |
| Face-Hardened Plate | 2031 | 7.85 | 1.12 | 1500 |
| Composite Laminate | 2040 | 5.90 | 1.30 | 2600 |
| Ceramic-Composite | 2048 | 4.40 | 1.52 | 4200 |
| Reactive Composite | 2057 | 5.10 | 1.78 | 6800 |
| Nano-Lattice | 2065 | 3.20 | 2.10 | 11500 |

Later materials are **lighter and tougher** — the same protection for less mass frees budget for
guns or speed.

## Gun placement — the critical decision
Placement is **extremely important**: it decides a gun's **firing range contribution** and, above
all, the **cones of fire** — which bearings each weapon can actually engage. (Crab frame:
bow=+Z fore, stern=-Z aft, starboard=+X right, port=-X left; see `CRAB_CONVENTIONS.md`.)

- **Main turrets** sit on the **centreline**, **fore and aft**. Centreline mains have **wide arcs**
  and can fire to **either broadside** — the most efficient placement (one gun helps both sides).
- **Superfiring:** at an end with 2+ mains, raise one to fire **over** the other (A over B forward,
  X over Y aft) so both bear ahead/astern.
- **Secondaries / broadsides** sit on the **port/starboard midship flanks** and fire **outboard** to
  their side only — they add to **one** broadside but not the other (a wing-turret trade).
- **Cones of fire / arcs:** every mount has a firing **arc**; the hull, legs and other turrets
  **block** part of it. A target dead ahead may only be engaged by fore mains; a beam target by the
  full broadside. **Manoeuvring the hull to bring the full broadside to bear is core tactics** — you
  turn the whole crab like a ship.
- A mount can't take a gun above the chassis `max_mount_caliber_mm` — a Jackal can't carry a 305.

**Guns** (`guns.csv`):

| Gun | Bore | Shell | ROF | Range | MV | Wt(t) | Cost | Year | Type |
|---|---|---|---|---|---|---|---|---|---|
| LC-20 Autocannon | 20 | 0.13 | 650 | 3000 | 1050 | 0.15 | 40 | 2025 | conv |
| MK-30 Chaingun | 30 | 0.42 | 420 | 4500 | 1080 | 0.35 | 80 | 2025 | conv |
| RB-57 Light Gun | 57 | 2.6 | 180 | 7500 | 1020 | 0.9 | 180 | 2026 | conv |
| FT-76 Field Gun | 76 | 6.2 | 90 | 11000 | 990 | 1.7 | 340 | 2027 | conv |
| HW-105 Howitzer | 105 | 15.0 | 40 | 16000 | 940 | 3.4 | 620 | 2028 | conv |
| GM-122 Gun-Mortar | 122 | 21.8 | 28 | 18500 | 910 | 4.8 | 880 | 2030 | conv |
| BR-155 Battle Gun | 155 | 43.5 | 16 | 24000 | 945 | 8.2 | 1500 | 2032 | conv |
| SG-203 Heavy Siege | 203 | 100.0 | 7 | 30000 | 900 | 16.0 | 3200 | 2034 | conv |
| LV-305 Dreadnought | 305 | 385.0 | 2 | 38000 | 860 | 42.0 | 9800 | 2025 | conv |
| CG-40 Coil Repeater | 40 | 0.85 | 260 | 9000 | 1650 | 0.7 | 520 | 2047 | coil |
| CG-90 Coilgun | 90 | 9.5 | 55 | 26000 | 2050 | 5.6 | 2600 | 2050 | coil |
| RG-90 Light Railgun | 90 | 9.0 | 48 | 34000 | 2700 | 5.2 | 3000 | 2048 | rail |
| RG-127 Railgun | 127 | 18.0 | 30 | 42000 | 2950 | 9.5 | 5400 | 2045 | rail |
| RG-180 Heavy Railgun | 180 | 52.0 | 12 | 58000 | 3200 | 19.0 | 11200 | 2052 | rail |

**Bore is the master stat:** bigger = heavier shell, **slower** ROF, **longer** range, much more
weight & cost. **Rail/coil** guns have very high muzzle velocity (flatter, more pen, longer reach)
but need **power output** (heavy chassis + Machinery tech) and arrive late. The **GM-122 Gun-Mortar**
is the early high-angle specialist for getting into defilade.

## Modules — utility slots (selectable placement)
Fit into `num_utility_mounts`; **you choose where each module goes** (sensor head, dorsal bay,
flank). Three families:

- **Sensors** — optical rangefinder, radar/LIDAR, thermal, datalink. Extend detection & accuracy
  (radar/LIDAR see through smoke/dust/night; datalink shares targeting and lets you control more
  drones).
- **Electronic Warfare** (`ew.csv`) — jammer, spoofer, drone detector, CUAS hardkill/laser,
  hardened link, freq-hop, charge bay, laser counter, decoy. The rock-paper-scissors layer vs
  drones (see 03_COMBAT, 04_RESEARCH).
- **Drone bays** (`drones.csv`) — recon (extend LOS over terrain), loiter munitions (top-attack),
  strike, swarm. Drones are the late asymmetric unlock — the **torpedo-equivalent**, but active.

Carrying a jammer or CUAS turret means **less weight for guns/armour** — a real loadout decision.

## Amphibious build option
**Amphibious** is a buildable option enabling **strategic water crossings** (e.g. crossing Sydney
Harbour, see 06_MAP):
- **Early amphibious:** the crab can wade/cross water but **cannot fire while in the water**.
- **Later tech:** firing while in water is allowed but with an **accuracy penalty**.

This turns water from a hard wall into a tactical corridor — flank an enemy by fording where they
don't expect a gun line.

## Tech-gated availability & custom names
- Every chassis, gun, armour material, sensor, EW module and drone has a **`year_available`** and is
  **unlocked by research** (see 04_RESEARCH). Because research is **stochastic**, the year a
  component actually becomes buildable **varies per playthrough** — you might field railguns early
  or be stuck on conventional guns for years.
- A finished design can be given a **custom class name** (as in RtW) — name your battle-crab line
  and it carries through the roster, production and battle UI.
