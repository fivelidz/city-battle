# CITY BATTLE — Mecha Attribute Schema (the design lynchpin)

This is the **authoritative definition of what a mecha IS** — every attribute the design UI sets,
the combat sim reads, production costs, and research unlocks. All five game components
(Design, Combat, Research, Production, Campaign) share this one model. If it isn't here, it
isn't a real attribute.

Modelled on Rule the Waves 3's ship-design schema, translated to walking artillery.

---

## 1. The design budget (what you spend)

A mecha is built on a **chassis**, which provides three budgets you allocate:

| Budget | Unit | Provided by chassis | Spent on |
|---|---|---|---|
| **Mass** | tonnes (t) | `mass_budget_t` | armour + weapons + modules + drones. Over budget = invalid. |
| **Weapon mounts** | count | `num_weapon_mounts` | one gun per mount (each mount has a size limit & arc). |
| **Utility slots** | count | `num_utility_mounts` | sensors / EW / drone bays / support modules. |

Plus a derived **cost** (build) and **maintenance** (upkeep/month). Designs are gated by **year**
(a chassis/gun/module can't be fitted before its `year_available`, i.e. before it's researched).

---

## 2. CHASSIS attributes (the platform)

From `chassis.csv`, extended:

| Attribute | Meaning | Combat effect |
|---|---|---|
| `id`, `name`, `class` | identity; class ∈ {Recon, Skirmisher, Line, Spider, Siege, Carrier} | flavour + role |
| `mass_budget_t` | total tonnage you can fit | hard cap on the build |
| `base_armor_budget_t` | suggested armour allocation (guideline) | — |
| `num_legs` | 2–12 leg groups | more legs = more mobility resilience (lose some, keep walking) |
| `base_speed_kmh` | top speed unladen | actual speed scales with mobility damage & load |
| `turn_rate_dps` | degrees/sec pivot | how fast it can face a new threat / re-aim hull |
| `num_weapon_mounts` | gun hardpoints | how many guns |
| `num_utility_mounts` | module slots | how many sensors/EW/drone bays |
| `max_mount_caliber_mm` | **NEW** — largest gun a mount can take | a Skirmisher can't carry a 305mm siege gun |
| `mount_arcs` | **NEW** — firing arc per mount (e.g. 360 turret, 180 dorsal, 90 fixed) | which directions each gun can engage |
| `cost`, `maintenance` | build + upkeep | economy |
| `year_available` | when researchable | progression gate |
| `crew` | **NEW** — nominal crew | affects damage-control speed / casualty effects |
| `power_output` | **NEW** — reactor/powerpack output | gates energy weapons (rail/coil/laser) & EW draw |

**Class roles (RtW analogues):**
- **Recon** (Whippet) — fast, lightly armed, lots of utility slots → scouting/spotting/EW.
- **Skirmisher** (Jackal) — fast harasser, light guns, anti-light/anti-drone.
- **Line** (Hoplite/Phalanx) — the workhorse cruiser-equivalent; balanced.
- **Spider** (Bastion) — many legs = stable heavy gun platform, hard to immobilise.
- **Siege** (Leviathan) — the dreadnought-crab: huge mass, biggest guns, thickest armour, slow.
- **Carrier** (Nimbus) — drone mothership: many utility slots/drone bays, modest guns.

---

## 3. ARMOUR scheme (per-zone protection)

Armour is allocated as **thickness in mm per zone** (not a single number). Mass cost per zone =
area(zone, chassis size) × thickness × material density. Choosing where to be thick is the core
RtW armour decision (belt vs deck → here glacis/flank vs carapace).

| Zone | RtW analogue | Threatened by |
|---|---|---|
| **Carapace** (top) | deck | plunging/indirect fire at long range, drone top-attack |
| **Glacis** (frontal belt) | belt (front) | direct fire from the front (flat trajectory, short range) |
| **Flank** (side belt, L/R) | belt (side) | direct fire from the sides → flanking |
| **Legs** | (rudder/props) | any hit; enough damage = immobilised |
| **Cupola** (sensor head) | conning tower | hits here = blinded (fire-control loss) |
| **Mantlet** (gun shield) | turret face | protects the weapon mount |

Armour **material** (`armor.csv`) sets density + `quality_factor` (effective protection
multiplier) + cost/t, and is year-gated (RHA → composite → reactive → nano). Effective
protection at a zone = `thickness_mm × material.quality_factor × nation.armor_quality`.

The **immunity band** (stand-off zone) is computed from glacis & carapace vs an enemy gun's
pen-vs-range curves (see `TacticalInfo.ImmunityBand`).

---

## 4. WEAPONS (guns on mounts)

Each occupied weapon mount holds one **gun** (`guns.csv`). A gun's attributes:

| Attribute | Meaning | Effect |
|---|---|---|
| `caliber_mm` | bore size (the master stat) | drives shell weight, pen, ROF, range, weight, cost |
| `shell_weight_kg` | projectile mass | damage per hit |
| `rof_rpm` | rounds/minute | smaller calibre = faster; heavy = slow |
| `max_range_m` | reach | bigger = farther |
| `muzzle_velocity_ms` | shell speed | flatter trajectory, more pen; rail/coil = very high |
| `weight_t`, `cost` | mass + build cost on the mecha | budget |
| `type` | conventional / rail / coil | rail/coil need `power_output`; later year |
| `year_available` | gate | progression |

**Placement matters:** a gun sits on a mount with a position + **arc**. Penetration vs the target
depends on **range** (which armour zone is struck — flat→glacis/flank, plunging→carapace) and the
gun's pen-vs-range table (`verpen.csv` flat / `horpen.csv` plunging).

**Ammo types (per gun, future):** AP (anti-armour), HE (anti-soft/topside), each trading pen for
blast — RtW AP/HE selection. Currently single shell type; AP/HE is a planned extension.

---

## 5. MODULES (utility slots) — sensors, EW, drones, support

Fitted into `num_utility_mounts`. This is where the modern depth lives.

### Sensors (gate detection & accuracy — RtW rangefinders/radar)
| Module | Effect |
|---|---|
| Optical rangefinder | +fire-control accuracy at range |
| Radar / LIDAR | detection + accuracy in smoke/dust/night |
| Thermal | passive detection of hot units |
| Datalink | share targeting (relay) + control more drones |

### Electronic Warfare (`ew.csv`) — the rock-paper-scissors layer
| Type | Effect |
|---|---|
| `jammer` | degrades enemy RADIO/satellite drones in radius |
| `spoofer` | feeds false positions |
| `drone_detector` | reveals incoming drones early |
| `cuas_hardkill` / `laser_cuas` | shoots down nearby drones (kinetic / laser) |
| `hardened_link` / `freq_hop` | counters enemy jamming (protects own drones) |
| `charge_bay` | recharges laser/energy systems & drones |
| `laser_counter` | mirror/ablative defence vs enemy lasers |
| `decoy` | draws off guided munitions |

### Drone bays (`drones.csv`) — the torpedo-equivalent, but active agents
| Attribute | Meaning |
|---|---|
| `role` | recon / loiter_munition / strike / swarm |
| `range_m`, `loiter_min`, `altitude_m` | reach, endurance, altitude (altitude beats terrain occlusion) |
| `payload_kg`, `payload_type` | none/shaped_charge/frag/thermobaric/emp/laser |
| `control_link` | radio (jammable) / fibre_optic (immune, short) / satellite / mesh |
| `autonomy` | manual / waypoint / fire_and_forget / swarm_ai |

### Support modules (future)
Extra damage-control, ammo storage, fuel/endurance, command (boosts nearby allies).

---

## 6. DERIVED COMBAT STATS (what the sim actually uses)

Computed from the design + research + nation, surfaced in the design UI so the player sees the
consequences of choices:

| Derived stat | Formula (concept) |
|---|---|
| **Total mass** | armour + weapons + modules + drones (≤ chassis mass_budget) |
| **Top speed** | `base_speed × mobilityFactor` (mobilityFactor falls as legs/drive take damage) |
| **Turn rate** | chassis `turn_rate_dps` (× mobility) |
| **Firepower** | sum of gun {pen, ROF, shell weight}; degrades as turrets are knocked out |
| **Max effective range** | from the fitted guns' ranges |
| **Protection profile** | per-zone effective mm; immunity band vs reference enemy guns |
| **Sight range** | base + sensors + elevation bonus; collapses if cupola/sensor destroyed |
| **Drone capacity** | from drone bays + datalink |
| **EW strength / counter** | from EW modules + nation `ew_strength` |
| **Build cost / maintenance** | chassis + parts (× nation `fabrication_efficiency`) |

## 7. SUBSYSTEMS (localised damage state — runtime, not designed)

Tracked per mecha at runtime (see `MechaSystems.cs`): leg groups, drivetrain, turrets, sensor
mast, datalink, ammo bay, reactor. Each has integrity → status (Operational/Degraded/Disabled/
Destroyed) with distinct consequences (immobilise / disarm / blind / lose-drone-control /
cook-off). No "sinking" — units are knocked out by structure loss, ammo cook-off, or full
mission-kill (immobile + disarmed). This is the *consequence* layer of the armour-zone design.

---

## 8. How the components share this schema

```
            ┌─────────────────────────────────────────────┐
            │            MECHA SCHEMA (this doc)            │
            │  chassis · armour · guns · modules · drones   │
            └───────┬───────────┬───────────┬──────────────┘
   DESIGN UI ───────┘           │           └────── PRODUCTION (cost/maint, build queue)
   (allocate budget,            │                    └ delivers RosterUnit (a saved design)
    place guns, fit modules)    │
            RESEARCH ───────────┤            COMBAT (sim reads the instantiated MechaUnit:
   (year-gates which chassis/   │             armour zones, gun pen tables, modules, drones,
    guns/modules/materials are  │             derived speed/sight/firepower)
    available to the designer)  │
            CAMPAIGN/NATIONS ───┘  (nation modifiers fold into derived stats)
```

`MechaDesign` (Design/) is the serialised blueprint; `MechaDesign.Instantiate()` turns it into a
runtime `MechaUnit` (Units/) for battle. One schema, five components.

---

## 9. Authoring data files (where each attribute lives)
- `chassis.csv` — platforms (+ new: max_mount_caliber_mm, mount_arcs, crew, power_output)
- `guns.csv` — weapons · `verpen.csv`/`horpen.csv` — penetration tables
- `armor.csv` — materials · `drones.csv` — drones · `ew.csv` — EW/sensor modules
- `nations.csv` — faction modifiers · `tech.csv` — research that unlocks the above by year
