# Research & Technology

CITY BATTLE uses the **Rule the Waves research model** (see `ref/RTW2_MECHANICS.md` §5), re-themed
to walking artillery and stretched across an alt-modern **2025 → 2070** era curve. You **fund
fields**, and techs **roll in stochastically** — you don't buy them outright. Each tech:

`Name ; Year ; Starting(Y/N) ; Chance% ; Cost ; TechID ; Effect`  (full table: `docs/TECH_TREE.md`)

## How research works
- **Fields / branches:** research is split into branches, each funded separately:
  **Machinery, Armour, Hull/Chassis, Fire Control, Damage Control, Mountings, Guns & AP, Sensors,
  Drones, Electronic Warfare.**
- **Year-gating:** a tech **cannot** be researched before its listed `Year`; the calendar must reach
  it. **Starting = Y** techs are baseline 2025 capability everyone has.
- **Stochastic skip-chance:** each interval, every funded tech rolls against its **`Chance%`**. On
  success it's acquired; on failure the invested points **carry forward**. A bad streak can **skip**
  a breakthrough for years — research is a gamble, not a queue. High national `research_speed` and
  focused **priority** raise the effective chance.
- **Proliferation:** once a tech exists in the world, **rivals acquire it more easily** — leads are
  temporary unless you keep pushing.
- **RP cost:** the **`Cost`** is research points to complete a tech once rolled in; bigger, later,
  more transformative techs cost far more (early unlocks ~500–1300, late EW/drone techs 5000–7400).
- **Priority high / med / low:** set per-branch funding priority to bias where your RP go.

## Enabling vs gradual techs
- **Enabling (unlock):** a binary new capability — a chassis, gun, armour tier, mount type, drone or
  EW module becomes buildable. *(e.g. "Siege Ordnance → unlocks 203mm & 305mm guns";
  "Recon Drone Operations → unlocks recon drones".)*
- **Gradual (modifier):** a steady percentage gain applied while held. *(e.g. "Improved Propellant →
  gradual muzzle-velocity & range improvement"; "Electro-Active Muscles → 5% weight saving.")*

## The era curve (what unlocks when)
Because unlocks are stochastic, the **year a component actually arrives varies per playthrough**.

| Era | Years | Theme | Representative unlocks |
|---|---|---|---|
| **Dreadnought Crabs** | 2025–2035 | big slow gun-mechas, crude FC | Skirmisher/Siege frames, RHA & face-hardened armour, conventional 20–305mm guns, mechanical rangefinders |
| **Fire-Control Era** | 2035–2045 | directors, stabilisation, better AP | Director Firing, Gun Stabilisation, Twin/Triple Mounts, Capped/Long-Rod AP, composite armour |
| **Sensor & Network Era** | 2045–2055 | radar/LIDAR, datalink, computed solutions | Search Radar, LIDAR, Datalink Network, Radar-Cued Solutions, **rail & coil guns**, all-or-nothing & ceramic armour |
| **Drone Dawn** | 2055–2063 | drones as the late asymmetric unlock | Recon/Loiter/Strike drones, Carrier-Crab frame, satellite & mesh control, fire-and-forget seekers |
| **EW & Autonomy** | 2063–2070 | jamming, fibre-optic, spoofing, swarm AI, C-UAS | Jammers, Fibre-Optic Tether, Frequency Hopping, Swarm Autonomy, EMP payloads, CUAS hardkill, nano-lattice armour |

**Design intent:** early game plays like a RtW dreadnought duel (slow, armoured, gun-vs-gun + terrain
manoeuvre); **drones (the torpedo-equivalent) and EW (their hard counter) arrive late**, adding a
rock-paper-scissors layer on top of the gun core rather than replacing it.

## How research feeds the rest of the game
Research is the **gate** on the whole design space (see 02_CRAB_DESIGN):
- **Hull/Chassis** unlocks chassis classes (Recon, Spider, Carrier…).
- **Armour** unlocks the material tiers in `armor.csv`.
- **Guns & AP** + **Mountings** unlock calibres, gun types (coil/rail), and twin/triple mounts.
- **Fire Control / Sensors** improve accuracy, ranging, detection and ID.
- **Machinery** raises speed and gates the **power output** rail/coil guns and heavy EW need.
- **Drones / EW** unlock the late asymmetric platforms and their counters.
- **Damage Control** speeds repair and reduces fire/cook-off severity.

**TechID ranges:** Machinery 100–107 · Armour 120–127 · Hull/Chassis 140–147 · Fire Control 160–167
· Damage Control 180–185 · Mountings 200–206 · Guns & AP 220–228 · Sensors 240–246 · Drones 260–270
· Electronic Warfare 280–288.

**Nations bias research:** each nation has a `research_speed` and per-branch leanings (e.g. Sahel
Compact & Steppe Coalition favour Drones; Nordmark Union favours Armour; Aurelian Directorate
favours EW — see 05_CAMPAIGN, `nations.csv`).
