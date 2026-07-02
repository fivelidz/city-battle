# Reference Dossier — Artillery Doctrine (study)

> **Status:** source-research dossier on real (chiefly US Army) field-artillery & gunnery
> doctrine, kept as the basis for CITY BATTLE's trajectory/terrain layer — the part that
> **replaces flat open terrain** with real topography. Distilled into wiki pages 01 & 03–07.
> Primary references reviewed: ATP 3-09.x fire-support series, ATP 3-21.90 (Fig 5-1, dead space),
> FM 6-series gunnery. **→ City Battle** call-outs note in-game equivalents.

---

## 1. The three fire trajectories: direct, indirect, mortar (high-angle)

A gun's **trajectory** is the path of the shell. The *same* range can be reached by a **low**
(flat, fast) arc or a **high** (steep, slow) arc — the choice decides what terrain you clear and
where the shell strikes.

| Type | Trajectory | Line of sight | Hits target on | Typical use |
|---|---|---|---|---|
| **Direct fire** | flat / low-angle | **required** — gunner sees the target | front / side (shallow angle) | tanks, anti-armour, point targets you can see |
| **Indirect fire** | arced (howitzer) | **not** required — a **forward observer** spots & corrects | side at mid range, **top** at long range | the bulk of artillery: reach unseen targets over terrain |
| **Mortar / high-angle** | very steep lob | not required — observer spots | **top** (near-vertical fall) | drop into **defilade / reverse slopes / urban pits** nothing else can reach |

- **Gun** = high muzzle velocity, **flat & far**. **Howitzer** = selectable elevation, flexible
  arc. **Mortar** = **steep & short**, the high-angle specialist.
- **Accuracy ladder:** direct fire (you see & correct) is **most accurate**; observed indirect is
  good once registered; **blind/predicted high-angle is the loosest**.

> **→ City Battle:** DIRECT (flat, needs LOS, hits side/glacis), OBLIQUE/INDIRECT (arced, needs a
> **spotter**, hits side at mid / **top** at long), MORTAR/HIGH-ANGLE (steep, the only way into deep
> defilade). See 01_FIRE_AND_BALLISTICS.

---

## 2. Dead space, masking & crest clearance

- **Line of sight (LOS):** an unobstructed straight line from observer/gun to target. Terrain,
  vegetation and buildings block it.
- **Masking:** terrain (a crest, ridge, building) **in front of the gun** that the trajectory would
  strike first. A flat shot is *masked* by any intervening crest.
- **Crest clearance:** the minimum **elevation** needed so the shell clears the masking crest. A
  flat gun may be **unable** to clear a close, high crest at all.
- **Dead space:** the ground **behind a crest that a given weapon cannot hit** — the flatter the
  trajectory, the **larger** the dead space (the shell sails over the pocket and lands far beyond).
  *(Ref: ATP 3-21.90 Fig 5-1.)*
  - **Flat gun → large dead space.**
  - **Howitzer (higher arc) → smaller dead space.**
  - **Mortar (near-vertical) → almost none** — it drops straight into the pocket.
- **Consequence:** a target tucked in **deep defilade** behind a ridge can be hit **only** by
  high-angle/mortar fire, **and only if** spotted and within the lobbing weapon's range. If the
  available arc can't drop steeply enough or is out of range, the target is **untouchable**.

> **→ City Battle:** dead space is a core mechanic. Direct fire shows a **flat shadow** behind
> crests; indirect shows its (smaller) shadow. Targets in deep defilade need a spotter + a
> high-enough arc, or they cannot be engaged.

---

## 3. Terrain positions: defilade, hull-down, reverse slope

- **Defilade:** any position where terrain **shields you from direct fire and observation**.
  - **Full defilade:** completely hidden from the enemy's flat fire & line of sight.
  - **Partial / hull defilade ("hull-down"):** only your **turret/top** shows over the crest — you
    can shoot, but only your **top** is exposed (to plunging fire), your sides/front are hidden.
  - **Turret-down:** fully hidden; you must move up to hull-down to fire.
- **Reverse slope:** position on the **far side** of a ridge from the enemy. Safe from their **flat
  fire and ground observation**; they must use **high-angle fire** (needing an observer who can see
  over) or **crest the ridge** to engage you. A classic defensive posture.
- **Defilade is also how artillery survives counter-battery** — guns sit hidden behind terrain and
  lob indirect fire out.

> **→ City Battle:** defilade/hull-down/reverse-slope all model directly. Hull-down exposes only
> the **carapace**; reverse slope forces the enemy to high-angle fire or crest the ridge.

---

## 4. Angle of fall → which face is struck

- **Angle of fall** = how **steeply** the shell descends at the point of impact.
- It **increases with range** (the shell loses horizontal speed and falls more steeply) and is far
  **steeper for high-angle fire**.
- **Shallow angle of fall → strikes the SIDE / front** (the vertical face — belt/glacis).
- **Steep angle of fall → strikes the TOP** (the horizontal face — deck/carapace).
- This is the single rule that ties trajectory, range, and armour together: **short-range flat fire
  threatens the side; long-range or lobbed fire threatens the top.** It is identical to the naval
  **belt-vs-deck** logic — the angle of fall is the bridge between the two domains.

> **→ City Battle:** the unifying ballistic rule. Angle of fall picks the hit zone; the gun's
> vertical (`verpen`) or horizontal (`horpen`) penetration table is then compared to that zone's
> effective armour. See 01_FIRE_AND_BALLISTICS.

---

## 5. Dispersion & the beaten zone

Even a perfectly laid gun scatters its rounds — manufacturing, propellant, wind and wear vary.

- **Dispersion pattern:** rounds fall in an **ellipse** elongated **along** the gun-target line
  (range error >> deflection error). This footprint is the **beaten zone**.
- **Probable error (PE):** the statistical measure of dispersion — **range PE** (along the line)
  and **deflection PE** (across it). Range PE is the larger; it **grows with range** and is bigger
  for high-angle fire.
- **Beaten zone shape:** **long & narrow** for flat fire (a shallow-falling round skids forward);
  **shorter & rounder** for high-angle fire (a steep round bites a tighter footprint, even though
  it's individually less accurate).
- A target sitting still in the beaten zone is **bracketed** and increasingly hit; a moving target
  walks out of it.

> **→ City Battle:** the beaten zone ellipse grows with range and is wider for high-angle fire;
> moving (yours or theirs) resets the bracket. See 01 & 03.

---

## 6. Observed vs predicted fire; registration

- **Observed fire:** a **forward observer (FO)** or drone watches the rounds land and **corrects**
  ("add 200, right 50") onto the target. Far more accurate — the spotter closes the loop.
- **Predicted fire:** fired on **computed data alone** (survey, map, met) with **no observer
  correction**. Faster and gains surprise, but **looser** — accuracy depends on good survey,
  weather data, and gun calibration.
- **Registration:** firing on a **known point** first to measure the actual corrections
  (accounting for wear, met, lay), then **transferring** those corrections to nearby targets. A
  **registered** predicted shoot is much tighter than a cold predicted one.
- **Firing on a last-known position:** if the observer loses the target, the guns can still engage
  its **last reported location** as a predicted target — may miss if it moved, but denies the ground.

> **→ City Battle:** observed (spotter/drone) fire is tightest; predicted/registered fire is the
> mid tier; **firing on last-known position** is supported when contact is lost. See 03_COMBAT.

---

## 7. Fire-mission terminology

| Term | Meaning |
|---|---|
| **Adjust fire** | ranging rounds while the observer corrects onto the target |
| **Fire for effect (FFE)** | the adjustment is good — fire the full effective volume now |
| **Time on target (TOT)** | multiple guns time their rounds to **all land at once** (max shock) |
| **Counter-battery** | fire aimed at silencing the **enemy's guns** (often found by their muzzle flash / trajectory) |
| **Danger close** | the target is near friendly troops — tighter control required |
| **Grid mission** | target given by map grid coordinates |
| **Polar mission** | target given as **range + bearing from the observer** |
| **Shift-from-known-point** | target given as a **shift off a registered point** |
| **Registration** | calibrating corrections on a known point (see §6) |
| **Sheaf** | how a battery's beaten zones are arranged over the target (converged/parallel/open) |
| **Final protective fire (FPF)** | pre-planned barrage on a defensive line, called in extremis |

> **→ City Battle:** these appear as in-game order/UI terms: adjust fire, FFE, TOT, counter-battery,
> danger close, grid/polar/shift-from-known-point, registration. See 01 & 07_GLOSSARY.

---

*End of dossier. This trajectory/terrain model underpins the fire, combat and map chapters
(pages 01, 03–07).*
