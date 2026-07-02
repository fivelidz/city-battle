# Reference Dossier — Rule the Waves 2 Mechanics (study)

> **Status:** source-research dossier, kept as a faithful structured study of the Rule the
> Waves 2/3 mechanics CITY BATTLE is modelled on. Distilled into the wiki pages (02–07).
> Primary source reviewed: the Rule The Waves 2 Wiki (rtw2.fandom.com) plus the RtW3 data files.
> Re-themed equivalents for CITY BATTLE are noted in **→ City Battle** call-outs.

---

## 1. Ship class codes — and how class is auto-derived

RtW does not let you pick a "class" arbitrarily. The **class code is derived** from the ship's
actual numbers — chiefly **displacement (tonnage)**, **main gun bore**, **armour**, and **speed**.
Design a hull within certain envelopes and the game labels it accordingly.

| Code | Name | Rough envelope (drives the label) | Role |
|---|---|---|---|
| **DD** | Destroyer | small tonnage, light guns, high speed, little/no belt | screen, torpedo attack, scouting |
| **CL** | Light Cruiser | medium tonnage, medium guns (≈5–6 in), fast, thin belt | scout leader, screen, trade protection |
| **CA** | Heavy Cruiser | larger tonnage, heavier guns (≈7.5–8 in), cruiser armour | line scout, raider, second-line battle |
| **BC** | Battlecruiser | battleship-size guns on a **fast, lighter-armoured** hull | fast wing of the battle line; trades armour for speed |
| **BB** | Battleship | heaviest tonnage, biggest guns, **thickest belt**, slow | the main battle line |
| **CV** | Aircraft Carrier | large hull given over to a **flight deck / air group**, light guns | air strike & scouting platform |
| **CVL** | Light Carrier | smaller carrier | escort air |
| **AMC / others** | armed merchant, monitor, etc. | edge cases | niche |

**Key idea:** the same hull becomes a **BC instead of a BB** if you keep the big guns but cut the
belt and raise speed; it becomes a **CA instead of a CL** if you up-gun and up-armour. Class is a
*readout of your design choices*, not a separate slider.

> **→ City Battle:** chassis "looks" (Recon / Skirmisher / Line / Spider / Siege / Carrier) map to
> these codes, and the class label is likewise partly derived from tonnage / bore / armour:
> Recon→scout strider, Skirmisher→**DD**, Line→**CL/CA**, Spider→stable **CA**-style gun platform,
> Siege→**BB/BC**, Carrier→**CV**.

---

## 2. Armour — belt vs deck, and the immunity zone

RtW tracks armour **per location**: **belt** (side), **deck** (top), **conning tower**, **turret
faces**, **barbettes**, **secondary battery**, plus internal **bulkheads**.

- **Belt (side armour):** defeats **flat-trajectory** hits that arrive at a shallow angle — i.e.
  fire at **short-to-medium** range. Vertical/"face-on" penetration is **highest at short range**.
- **Deck (top armour):** defeats **plunging** hits that arrive steeply — i.e. fire at **long**
  range. Horizontal/"deck" penetration **rises with range** as shells fall more steeply.

### Penetration vs range
- **Vertical (belt) penetration falls with range** — the shell slows, arrives shallower & weaker
  against the side.
- **Horizontal (deck) penetration rises with range** — the steeper angle of fall lets it punch
  through the top.

### Immunity zone (a.k.a. zone of immunity)
Against a **specific enemy gun**, a ship has a **range band where neither belt nor deck can be
penetrated**:
- **Inner edge** = range beyond which the enemy's **belt** penetration drops to ≤ your belt.
- **Outer edge** = range beyond which the enemy's **deck** penetration rises to > your deck.
- **Between the edges = immune.** A poorly balanced design (too little deck for its belt, or vice
  versa) can have an **inverted / non-existent** immunity zone — penetrable at all ranges.

> **→ City Battle:** identical model. Belt→**glacis/flank**, deck→**carapace**. The game **draws
> the immunity band** for your crab vs a chosen enemy shell size so you can fight inside your
> immune band and outside theirs (`verpen.csv` = vertical, `horpen.csv` = horizontal).

---

## 3. Fire control — tiers & accuracy factors

Hitting at range depends on a **fire-control tier** plus situational modifiers.

**Tier progression (early → late):**
1. **Optical sights / coincidence rangefinders** — crude, short effective range.
2. **Mechanical/stereoscopic rangefinders** — better ranging.
3. **Director firing** — one director lays all guns; big accuracy jump.
4. **Analog fire-control computers / plotting tables** — computed lead & spotting corrections.
5. **Radar-assisted fire control** — ranging in poor visibility & night; large long-range gain.

**Accuracy modifiers (worsen or improve the hit chance):**
- **Range** (farther = worse), **own speed / manoeuvre** (turning ruins a solution),
- **target speed & evasion**, **visibility/weather/night**, **smoke**, **rangefinder base length**,
- **straddling state** (once you bracket the target, subsequent salvos hit more), **crew quality**,
- **target size**, **own ship listing/damaged**.

> **→ City Battle:** Fire Control branch (Iron Sights → Director Firing → Ballistic Computer →
> Radar-Cued → Networked → Predictive AI). Bracketing/straddle, range, movement and weather apply.

---

## 4. Critical hits (localised damage)

A penetrating hit can score a **critical** beyond raw structural damage:

| Critical | Effect |
|---|---|
| **Flooding** | water ingress; list, slowed, can sink if uncontrolled |
| **Fire** | spreading fire; reduces fighting ability; can reach magazines |
| **Magazine** | ammunition detonation — often catastrophic / instant loss |
| **Engine / boiler** | speed loss, possible immobilisation |
| **Turret / gun** | a main mount knocked out (firepower loss) |
| **Rudder / steering** | locked rudder — ship circles, can't steer |
| **Conning tower / bridge** | command & fire-control disruption |

Damage control (crew, pumps, fire parties) fights flooding/fire over time; success depends on the
**Damage Control** rating.

> **→ City Battle:** re-themed to **leg immobilise**, **turret KO**, **sensor/cupola blind**, **ammo
> cook-off** (the magazine analogue), **drivetrain/reactor** hit, **datalink** loss. **There is no
> sinking** — crabs are *knocked out* (immobile + disarmed, or structural/cook-off loss) and the
> crew must be **rescued**.

---

## 5. Research model

RtW research is a **stochastic, year-gated, per-field** system.

- **Fields / areas:** research is split into areas (e.g. **Construction, Gunnery, Fire Control,
  Armour, Torpedoes, Engines/Machinery, Aviation/Carriers, Damage Control, Electronics/Radar…**).
- **Year-gating:** a technology cannot appear before its **historical year**; the calendar must
  reach it. This paces the era curve.
- **Skip-chance %:** each tech has a **research chance** rolled per interval. You don't buy a tech
  outright — you fund a field, and techs **roll in** probabilistically; missing the roll carries
  invested points forward. Some "breakthroughs" may be **skipped** for years on a bad streak.
- **Proliferation:** once a tech exists in the world, **other nations acquire it more easily**
  (it diffuses), so a lead is temporary unless you keep pushing.
- **RP cost (≈20k units):** research is funded in **research points**; transformative techs cost
  large multiples (the RtW economy thinks in ~20,000-point blocks for major programmes).
- **Priority high / med / low:** you set a **funding priority** per field to bias where your RP go.
- **Enabling vs gradual:** some techs are binary **unlocks** (new gun, new hull type, radar), others
  are **gradual modifiers** (a steady % improvement applied while researched).

> **→ City Battle:** mirrored exactly. Branches: Machinery, Armour, Hull/Chassis, Fire Control,
> Damage Control, Mountings, Guns & AP, Sensors, **Drones**, **Electronic Warfare**. Schema:
> `Name; Year; Starting(Y/N); Chance%; Cost; TechID; Effect`. Era curve 2025→2070 (see TECH_TREE.md).

---

## 6. Ship design

Design is a **displacement-budget** allocation problem.

- **Displacement budget:** the hull tonnage is your total budget. Everything (armour, guns,
  machinery for speed, torpedoes, fuel, fire control) **spends weight**. Over budget = invalid.
- **Trade-offs:** more speed → bigger engines → less weight for armour/guns; thicker belt → less
  deck or fewer guns. **Balance is the whole game** (and it decides your auto-class).
- **Armour allocation:** distribute weight across **belt, deck, conning tower, turrets, barbettes,
  secondary**. The belt-vs-deck split sets your **immunity zone** shape.
- **Gun placement — turret positions:** RtW lays out turrets in **fixed positions** (the engine
  exposes up to **~24 turret positions** across the hull). Choices:
  - **Centreline fore & aft** — guns on the long axis; widest arcs; can fire either broadside.
  - **Superfiring** — a raised turret firing **over** the one in front of it (A over B forward,
    X over Y aft) so both bear ahead/astern.
  - **Wing turrets** — mounted to **port/starboard**; only bear on that side; waste weight on the
    off-broadside but can add to one broadside.
  - **Centreline > wing** generally, because centreline guns contribute to **both** broadsides.
- **Cones of fire / arcs:** every mount has a **firing arc** (the bearings it can train on); the
  hull, superstructure and other turrets **block** part of it. The ship's **broadside** is the set
  of guns that can bear on a beam target; **end-on** fire is usually far fewer guns. Manoeuvring to
  bring the **full broadside** to bear is core tactics.

> **→ City Battle:** the **Foundry**. Mass budget; per-zone armour (glacis/flank/carapace/legs/
> cupola/mantlet); **gun placement is critical** — fore/aft centreline mains, superfiring, port/
> starboard secondaries, and **cones of fire** decide which bearings can fire. See 02_CRAB_DESIGN.

---

## 7. Strategic layer

The campaign is a loop of **prestige, tension, budget, and victory points**.

- **Victory Points (VP):** **wars are won on VP.** Sinking/damaging enemy ships, winning battles,
  achieving mission objectives and bombarding targets earn VP; losses cost VP. The side with more
  VP when a war ends wins it.
- **Prestige / popularity:** a running measure of how well you're doing in the public/political
  eye. **It keeps you in power.** It **rises** with battle victories, won wars, prestige ships, and
  good event choices; it **falls** with lost ships, lost battles, budget mismanagement and bad
  events. **Low prestige → you can be removed from power** (game over for your tenure).
- **Tension (0–13):** a per-rival **tension scale**. It climbs from incidents, arms races, crises
  and provocative deployments. **Tension gates your budget** (high tension → emergency budget
  rises) and **at 13 it triggers war.** Managing tension — when to back down, when to push — is the
  strategic game.
- **Budget:** monthly **income** (national funds, scaling with economy & era) vs **expenses**
  (ship maintenance, construction, research). You allocate between **building, research, and
  reserve**. Tension/war can raise the budget; peace shrinks it.
- **Mission types:** the war generates **missions/battles** — fleet actions, **convoy escort**,
  **commerce raiding**, **coastal bombardment**, **shore-target destruction**, **scouting**,
  **fleet engagements**, **invasion/landing support**, **minelaying/sweeping**. Each has objectives
  that feed VP.

> **→ City Battle:** kept and re-themed (see 05_CAMPAIGN). VP win wars; prestige/popularity keeps
> you in power; tension 0–13 gates budget and triggers war at 13; missions become battle/convoy
> escort/destroy emplacement/crew rescue/coastal raid/invasion support.

---

## 8. Weather & visibility

- **Visibility** (set by weather, time of day, smoke) caps the range at which you can **spot** and
  effectively **fire**. Poor visibility **compresses engagements to short range** — which favours
  **belt-threatening flat fire** and torpedoes, and blunts long-range gunnery advantages.
- **Sea state / weather:** rough weather degrades accuracy (especially for small ships and small
  guns), can force speed reductions, and hampers torpedo/air operations. **Night** drastically cuts
  spotting unless you have radar/searchlights; **fog/rain/haze** cut it too.
- Weather is partly **random per battle**, so the same fleet performs differently day to day —
  good fire control and radar mitigate bad visibility.

> **→ City Battle:** fog/rain/haze cut **spotting** (LOS & sensor range) and push fights to short
> range (side-armour threat); **precipitation also slows crab movement**; recon drones partly
> restore vision over terrain & weather.

---

*End of dossier. See `ARTILLERY_DOCTRINE.md` for the trajectory/terrain layer that replaces the
flat-sea map.*
