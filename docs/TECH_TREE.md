# CITY BATTLE - Research Tech Tree

This document presents the full CITY BATTLE research tree using a schema mirroring
*Rule the Waves 3*'s `ResearchAreas.dat`. Each technology is defined by:

`Name ; Year ; StartingTech(Y/N) ; ResearchChance% ; Cost ; TechID ; Effect`

**How research works (RtW3-style):**

- **Year-gating:** a tech cannot be researched before its listed `Year`. The world
  advances through the era curve (2025-2070), and techs unlock as the calendar
  reaches their year. Techs marked **Starting = Y** are available to every nation at
  game start (2025) and represent baseline 2025 capability.
- **Stochastic research:** each research interval, every tech a nation is actively
  funding rolls against its `Chance%`. On success the tech is acquired; otherwise the
  invested research points carry forward. Higher national `research_speed` and tech
  focus raise the effective chance.
- **Cost:** research points required (accumulated across intervals) to complete the
  tech once it has been rolled in. Bigger, later, more transformative techs cost more.
- **Effects:** either **incremental modifiers** (small percentage gains applied
  gradually, e.g. "2% weight saving on machinery") or **unlocks** (binary capabilities,
  e.g. "Enables fibre-optic drone control").

The era curve drives the gating:

| Era | Years | Theme |
|-----|-------|-------|
| Dreadnought Crabs | 2025-2035 | Big slow gun-mechas, crude fire control |
| Fire-Control Era | 2035-2045 | Directors, stabilisation, better AP |
| Sensor & Network Era | 2045-2055 | Radar/LIDAR, datalink, computed solutions, all-or-nothing armour |
| Drone Dawn | 2055-2063 | Drones as the late asymmetric unlock (recon, loiter, strike) |
| EW & Autonomy | 2063-2070 | Jamming, fibre-optic tethers, spoofing, swarm AI, C-UAS |

The **DRONES** and **Electronic Warfare** branches are the richest and most modern,
reflecting their status as the late-game game-changers (the torpedo-equivalent and its
hard counter).

---

## Machinery

Powerplant, actuators, and gait efficiency for the leg-walker chassis.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Diesel-Electric Drive | 2025 | Y | 100 | 0 | 100 | Baseline locomotion; gradual reliability gains |
| Hydraulic Leg Actuators | 2025 | Y | 100 | 0 | 101 | Baseline gait; 1% weight saving on machinery |
| Compact Powerpack | 2029 | N | 45 | 600 | 102 | 3% weight saving on machinery |
| Hybrid Capacitor Bank | 2036 | N | 38 | 1100 | 103 | Gradual top-speed improvement; enables coil/rail power draw |
| Electro-Active Muscles | 2044 | N | 30 | 1900 | 104 | 5% weight saving; improved turn rate |
| High-Density Fuel Cells | 2051 | N | 28 | 2600 | 105 | Extended operational range; 3% weight saving |
| Superconducting Drive | 2060 | N | 20 | 4200 | 106 | Large speed gain; required for heavy railgun power |
| Adaptive Gait AI | 2066 | N | 18 | 5100 | 107 | Gradual mobility and stability improvement on rough terrain |

---

## Armour

Protective material science. Unlocks the tiers defined in `armor.csv`.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| RHA Steel | 2025 | Y | 100 | 0 | 120 | Baseline armour tier (quality 1.00) |
| Face-Hardened Plate | 2031 | N | 50 | 800 | 121 | Unlocks Face-Hardened tier (quality 1.12) |
| Spaced Armour Arrays | 2037 | N | 40 | 1300 | 122 | Improved resistance to shaped charges; gradual protection gain |
| Composite Laminate | 2040 | N | 34 | 2000 | 123 | Unlocks Composite tier (quality 1.30, lighter) |
| All-or-Nothing Layout | 2046 | N | 30 | 2400 | 124 | Concentrates armour on vitals; better budget efficiency |
| Ceramic-Composite | 2048 | N | 28 | 3100 | 125 | Unlocks Ceramic-Composite tier (quality 1.52) |
| Reactive Composite | 2057 | N | 22 | 4500 | 126 | Unlocks Reactive tier (quality 1.78) |
| Nano-Lattice Armor | 2065 | N | 17 | 6800 | 127 | Unlocks Nano-Lattice tier (quality 2.10, much lighter) |

---

## Hull / Chassis

Crab-mecha chassis classes and structural engineering.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Skirmisher Frame | 2025 | Y | 100 | 0 | 140 | Unlocks Skirmisher and Line chassis |
| Siege Frame | 2025 | Y | 100 | 0 | 141 | Unlocks Siege (dreadnought-crab) chassis |
| Recon Frame | 2027 | N | 55 | 500 | 142 | Unlocks Recon chassis |
| Spider Multi-Leg Layout | 2029 | N | 42 | 1200 | 143 | Unlocks Spider chassis (stable gun platform) |
| Reinforced Subframe | 2035 | N | 38 | 1500 | 144 | 3% mass-budget efficiency; higher mount limit |
| Modular Mount Bays | 2042 | N | 32 | 2100 | 145 | Adds one utility mount slot to medium+ chassis |
| Lightweight Exostructure | 2050 | N | 26 | 2900 | 146 | 5% mass saving across all chassis |
| Drone-Carrier Frame | 2056 | N | 24 | 3800 | 147 | Unlocks Carrier-Crab chassis (extra utility mounts) |

---

## Fire Control

Aiming, stabilisation, and computed firing solutions.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Iron Sights & Optics | 2025 | Y | 100 | 0 | 160 | Baseline crude fire control |
| Mechanical Rangefinder | 2028 | N | 50 | 700 | 161 | Gradual accuracy improvement at medium range |
| Director Firing | 2036 | N | 40 | 1400 | 162 | Enables centralised director control of mounts |
| Gun Stabilisation | 2039 | N | 35 | 1800 | 163 | Accuracy on the move; gradual improvement |
| Analog Ballistic Computer | 2043 | N | 32 | 2300 | 164 | Computed lead; accuracy gain at long range |
| Radar-Cued Solutions | 2048 | N | 28 | 3000 | 165 | Couples sensors to guns; large long-range accuracy gain |
| Networked Fire Solutions | 2054 | N | 24 | 3700 | 166 | Datalinked cooperative targeting across a lance |
| Predictive Targeting AI | 2063 | N | 19 | 4900 | 167 | Gradual accuracy gain vs fast and evasive targets |

---

## Damage Control

Repair, redundancy, and crew/automation survivability.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Manual Repair Drills | 2025 | Y | 100 | 0 | 180 | Baseline damage control |
| Fire Suppression Foam | 2030 | N | 48 | 700 | 181 | Reduces fire/ammo-cook-off severity |
| Redundant Hydraulics | 2037 | N | 40 | 1300 | 182 | Gradual mobility-kill resistance improvement |
| Automated Repair Bots | 2046 | N | 30 | 2200 | 183 | Faster in-battle repair of subsystems |
| Self-Sealing Lines | 2052 | N | 27 | 2800 | 184 | Reduces leak/coolant loss; gradual survivability gain |
| Distributed Control Mesh | 2061 | N | 21 | 4000 | 185 | Tolerates EW/comms damage; gradual control resilience |

---

## Mountings

Weapon mount types and turret engineering.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Single Mount | 2025 | Y | 100 | 0 | 200 | Baseline single weapon mount |
| Pintle Mount | 2025 | Y | 100 | 0 | 201 | Light flexible mount for autocannons |
| Twin Mount | 2032 | N | 44 | 900 | 202 | Enables twin mounts |
| Powered Traverse | 2038 | N | 38 | 1400 | 203 | Faster mount slew; gradual ROF benefit |
| Triple Mount | 2045 | N | 30 | 2100 | 204 | Enables triple mounts |
| Auto-Loading Cradle | 2050 | N | 27 | 2700 | 205 | Gradual ROF improvement on large calibres |
| Rail/Coil Mount Rails | 2046 | N | 26 | 3200 | 206 | Enables mounting of rail and coil guns |

---

## Guns & AP

Gun design and armour-piercing projectile quality. Calibres correspond to `guns.csv`.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Conventional Cannon | 2025 | Y | 100 | 0 | 220 | Baseline conventional guns (20-305mm) |
| Improved Propellant | 2029 | N | 46 | 800 | 221 | Gradual muzzle-velocity and range improvement |
| Capped AP Shot | 2033 | N | 40 | 1300 | 222 | Gradual vertical penetration improvement |
| Siege Ordnance | 2034 | N | 36 | 1900 | 223 | Unlocks 203mm and 305mm siege guns |
| Long-Rod Penetrators | 2042 | N | 32 | 2400 | 224 | Gradual penetration gain; better velocity retention |
| Coilgun Principles | 2047 | N | 27 | 3300 | 225 | Unlocks coil guns (high velocity for calibre) |
| Railgun Principles | 2045 | N | 26 | 3600 | 226 | Unlocks rail guns (very high velocity and range) |
| Hypervelocity Sabot | 2055 | N | 22 | 4400 | 227 | Gradual penetration gain for rail/coil calibres |
| Smart Fuzing | 2060 | N | 20 | 4800 | 228 | Improved plunging/top-attack effect at long range |

---

## Sensors

Detection, ranging, and target discrimination.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Optical Spotting | 2025 | Y | 100 | 0 | 240 | Baseline visual detection range |
| Acoustic Ranging | 2031 | N | 46 | 700 | 241 | Gradual detection of moving targets |
| Search Radar | 2045 | N | 32 | 2200 | 242 | Enables radar detection beyond line of sight |
| LIDAR Array | 2049 | N | 28 | 2900 | 243 | High-precision ranging; fire-control synergy |
| Datalink Network | 2052 | N | 25 | 3400 | 244 | Shares contacts across a lance (network-centric) |
| Sensor Fusion Suite | 2058 | N | 22 | 4100 | 245 | Gradual detection and ID improvement; clutter rejection |
| Low-Probability-of-Intercept Radar | 2064 | N | 18 | 5000 | 246 | Harder to detect/jam; gradual stealth-sensing gain |

---

## DRONES

The late asymmetric branch - the torpedo-equivalent. Unlocks the platforms in
`drones.csv`. Richly developed across the Drone Dawn and EW & Autonomy eras.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Recon Drone Operations | 2055 | N | 26 | 3200 | 260 | Unlocks recon drones; extends vision (high altitude) |
| Long-Endurance Recon | 2058 | N | 24 | 3700 | 261 | Unlocks high-altitude long-range recon drone |
| Loitering Munitions | 2057 | N | 24 | 3900 | 262 | Unlocks loiter-munition drones (top-attack strike) |
| Dedicated Strike Drones | 2059 | N | 23 | 4300 | 263 | Unlocks strike drones (heavy payload, fast) |
| Satellite Drone Control | 2060 | N | 21 | 4600 | 264 | Enables over-the-horizon satellite-linked drones |
| Mesh Networking | 2061 | N | 20 | 4800 | 265 | Enables mesh-linked drone cooperation |
| Fire-and-Forget Seekers | 2062 | N | 19 | 5000 | 266 | Enables autonomous terminal homing payloads |
| Fibre-Optic Tether | 2064 | N | 17 | 5600 | 267 | Enables fibre-optic drone control (jam-immune, short range) |
| Swarm Autonomy AI | 2065 | N | 16 | 6200 | 268 | Enables swarm drones with swarm-AI coordination |
| EMP Payloads | 2066 | N | 15 | 6500 | 269 | Enables EMP drone payloads (disable enemy electronics) |
| Thermobaric Warheads | 2061 | N | 19 | 4900 | 270 | Enables thermobaric drone payloads (area effect) |

---

## Electronic Warfare

The hard counter to drones and networks. Mostly 2060+. Unlocks the modules in `ew.csv`.

| Name | Year | Starting | Chance% | Cost | TechID | Effect |
|------|------|----------|---------|------|--------|--------|
| Radio Jamming | 2060 | N | 22 | 4000 | 280 | Unlocks jammer module; degrades radio-linked enemy drones in radius |
| Drone Detection Suite | 2060 | N | 22 | 3800 | 281 | Unlocks drone detector; early warning of inbound drones |
| GNSS/Signal Spoofing | 2061 | N | 20 | 4400 | 282 | Unlocks spoofer; misdirects waypoint and satellite drones |
| C-UAS Hardkill | 2062 | N | 19 | 4900 | 283 | Unlocks CUAS turret (point defence against drones) |
| Hardened Datalink | 2063 | N | 19 | 4200 | 284 | Unlocks hardened link; counters enemy jamming of your drones |
| Frequency Hopping | 2064 | N | 18 | 4500 | 285 | Unlocks freq-hop; gradual resistance to jamming and spoofing |
| Wideband Jamming | 2067 | N | 15 | 6400 | 286 | Unlocks wideband jammer (large radius, high strength) |
| Counter-Swarm Doctrine | 2068 | N | 14 | 6900 | 287 | Gradual effectiveness gain of C-UAS against swarm-AI drones |
| Autonomous EW Management | 2069 | N | 13 | 7400 | 288 | Automated jamming/spoofing allocation; gradual EW efficiency gain |

---

*TechID ranges by branch: Machinery 100-107, Armour 120-127, Hull/Chassis 140-147,
Fire Control 160-167, Damage Control 180-185, Mountings 200-206, Guns & AP 220-228,
Sensors 240-246, DRONES 260-270, Electronic Warfare 280-288.*
