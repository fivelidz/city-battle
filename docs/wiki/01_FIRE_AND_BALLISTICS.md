# Fire & Ballistics

The heart of CITY BATTLE. One rule unifies everything: **the angle a shell falls at decides which
armour face it hits.** Flat shots hit the side/front; plunging shots hit the top/deck. Terrain
decides what you can even reach.

## Fire types (by trajectory)
Every gun fires along a chosen trajectory. The same shell can be lobbed low or high to reach the
same range — low-angle is flatter and faster, high-angle arcs over and plunges down.

| Mode | Trajectory | Needs LOS? | Hits | Use |
|---|---|---|---|---|
| **DIRECT** | flat / low-angle | yes (you must see the target) | side / glacis | accurate, short-mid range, you're also exposed |
| **OBLIQUE / INDIRECT** | arced (howitzer-like) | no — needs the target **spotted** (by an ally/recon drone) | side at mid range, **top** at long range | reach over low terrain at a spotted target |
| **MORTAR / HIGH-ANGLE** | very steep lob | no — needs spotting | **top/deck** | the only way into **deep defilade** (behind crests) |

- **Gun** = flat & far (high velocity). **Howitzer** = flexible angle. **Mortar** = steep & short.
  A crab's weapon has a trajectory class that sets how steeply it can drop.
- **Direct fire is most accurate** (you see and correct). Indirect is looser; high-angle loosest.

## Line of sight, masking & DEAD SPACE
- **Line of sight (LOS):** a clear straight line from your sensor to the target over the terrain.
  Hills, ridges and buildings block it. Direct fire **requires** LOS.
- **Masking:** terrain between you and the target that your trajectory would hit first. A flat
  shot is "masked" by any crest in the way.
- **Dead space:** the pocket of ground **behind a crest that a given weapon cannot hit** — the
  flat shell flies right over it and lands far beyond. (Ref: ATP 3-21.90 Fig 5-1.)
  - A **flat gun** has **large** dead space behind hills.
  - A **howitzer** (higher angle) has **less**.
  - A **mortar** (near-vertical) has **almost none** — it drops straight into the pocket.
  - **So a target in deep defilade behind a ridge can ONLY be hit by high-angle/mortar fire** —
    and only if it's **spotted** and within the lobbing weapon's range. If the indirect arc can't
    drop steeply enough or is out of range, the target is **untouchable**. This is core gameplay.

## Defilade, hull-down, reverse slope
- **Defilade:** terrain shields you from direct fire & observation.
- **Hull-down:** only your turret/top is exposed over a crest — you can shoot, your body is hidden
  (flanks/glacis protected; only the **carapace** is hittable, by plunging fire).
- **Turret-down:** fully hidden; you must move up to hull-down to fire.
- **Reverse slope:** sit on the far side of a ridge — safe from enemy flat fire; they must use
  high-angle fire or crest the ridge to hit you. A key defensive play.

## Angle of fall → which armour is hit
- **Angle of fall** = how steeply the shell descends at impact. It **increases with range** and is
  far steeper for high-angle fire.
- **Flat / shallow fall → hits the SIDE/GLACIS** (the thick belt). Defeated by **direct (vertical)
  penetration**, which is **highest at short range** and falls off with distance.
- **Steep / plunging fall → hits the TOP/CARAPACE** (the thin deck). Defeated by **plunging
  (horizontal) penetration**, which **rises with range**.
- This is the naval **belt vs deck** model exactly. Short range kills through the side; long range
  (or lobbed fire) kills through the top.

## IMMUNITY ZONE
Against a specific enemy gun, a crab has an **immunity zone**: the **range band where neither its
side armour nor its top armour can be penetrated.**
- **Inner edge** = the range beyond which the enemy gun's side (vertical) penetration drops to ≤
  your side armour. Closer than this, your side is defeated.
- **Outer edge** = the range beyond which the enemy gun's top (plunging) penetration rises to >
  your top armour. Farther than this, your top is defeated.
- Between the edges = **immune** to that gun's penetrating hits.
- A mismatched scheme can have **no immune band** (inverted zone — penetrable at all ranges).
- The game **displays the immunity zone** for your crabs vs a chosen enemy shell size, so you can
  position to fight inside your immune band and outside theirs. (See `TacticalInfo.ImmunityBand`.)

## Accuracy & dispersion
Shells scatter even when perfectly aimed.
- **Beaten zone:** an ellipse **long along the gun-target line** (range error) and narrow across
  (deflection error). It grows with range and is bigger for high-angle fire.
- **Ranging-in / straddling:** sustained fire on a still target **brackets** it — shorts and overs
  converge into a straddle, then hits. Moving (yours or theirs) resets the bracket.
- Accuracy ladder, worst → best: blind long-range high-angle → predicted low-angle → registered
  predicted → **observed/adjusted** (a spotter corrects) → **direct fire at short range**.
- **Firing on last-known position:** if you lose the target's contact you can still fire at its
  **last known position** (predicted fire) — looser, may miss if it moved, but better than nothing.

## What degrades fire
- **Range** (farther = looser + steeper fall), **moving shooter** (much worse), **moving target**
  (harder to bracket), **weather/visibility** (fog/rain/night/dust shorten spotting and accuracy;
  push fights to short range → side-armour threat), **blinded sensors** (cupola damage), **jamming**
  of drone spotters. **Precipitation also slows movement.**

## In-game terms (from real doctrine)
fire for effect (FFE) · adjust fire · registration · time on target (TOT) · counter-battery ·
danger close · grid / polar / shift-from-known-point missions · defilade / hull-down / reverse
slope · crest clearance · beaten zone / probable error.
