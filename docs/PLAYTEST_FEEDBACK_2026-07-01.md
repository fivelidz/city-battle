# Playtest Feedback & Backlog — 2026-07-01 (qalarc.com web demo)

> Source: user playtest of the live qalarc.com City Battle web demo. Captured verbatim-in-intent
> so nothing is lost. Grouped by area, each item tagged with status:
> `[ ]` todo · `[~]` in progress · `[x]` done this session · `[L]` later/backlog.
> Overall verdict from the user: **"working pretty well… good progress… this is looking to be a
> good game."**

---

## A. Map orientation & geography

- **[x] A1 — MAP reads east-on-the-LEFT (needs coordinate-convention fix).** ROOT CAUSE FOUND
  (deep investigation): the data is geographically correct — bbox `[W 151.18, S -33.9, E 151.3,
  N -33.79]`, and `x_m=(lon-west)*mPerLon` so **+X really is EAST**, `+Z` really is NORTH. The
  problem is a **handedness/display-convention** issue: in a right-handed `+X=east / +Z=north /
  +Y=up` frame, ANY north-up view (even a true top-down with up=+Z) renders **east on the
  screen-LEFT** — it's mathematically unavoidable in that frame. So it's NOT a camera bug and NOT
  a data mirror; the map frame is effectively left-handed for screen display.
  - **Correct fix (deliberate, do as its own change):** make the display east-on-right by
    mirroring the EAST axis consistently at every world-placement boundary — flip terrain heightmap
    columns in the mesh + topo texture + `heightAt` (all read `H[z*res+x]` → read `H[z*res+(res-1-x)]`
    OR equivalently `worldX = W - x`), flip building / road / suburb / unit-spawn X the same way,
    and negate the east component in `bearingFromVec` (`atan2(-dx, dz)`) + swap the E/W compass
    edge labels. Because units/suburbs/roads/buildings all derive from the same lon→X mapping, they
    must ALL flip together or they desync — hence do it in one careful pass, not piecemeal.
  - NOT shipped in round 1 (too invasive to rush into the shared live demo). The camera default is
    now north-up (N at top); the E/W screen-side correction is the remaining, deliberate step.
  - Ground-truth check for the fix: Sydney's ocean/harbour mouth is to the EAST (higher lon) — it
    should end up on the screen-RIGHT when north is up.

## B. Suburbs

- **[x] B1 — SUBURB BORDERS should be ACTUAL polygon borders, not circle/point markers.** The user
  wants the real suburb boundary outlines (neon border lines following the true boundary polygon),
  NOT a ring/disc at a centroid. Need suburb boundary polygons from OSM (admin_level boundaries)
  draped on terrain as neon outlines.

## C. UI panels & layout

- **[x] C1 — CONDITIONS panel obscures the left-side view/toggle selector panels.** The bottom-right
  Conditions/weather panel overlaps the left toggle column. Reposition so nothing overlaps.
- **[x] C2 — The Conditions "[ HIDE ]" button does not work.** Wire it up (collapse the panel body).
- **[x] C3 — "FROM ARRIVAL" / preview info blocks are too cluttered.** Replace the inline
  explanatory paragraphs with a small **ⓘ (i-in-a-circle)** icon that reveals the explanation on
  hover/click (tooltip/popover). Applies to the several verbose help paragraphs in the left panel.

## D. Camera & controls

- **[x] D1 — MOUSE WHEEL should zoom in/out.** (orbit + fly cam both).
- **[x] D2 — `=`/`-` keys control speed.** (already `,`/`.`; add `=`/`-` too, or replace.)
- **[x] D3 — MOVEMENT SPEED should be INDICATED and adjustable via a SLIDER** (not just 1/2/3/4×
  buttons — a continuous slider, with the current speed shown as a readout). DONE: slider (0.25–8×)
  + live readout + `=`/`-` keys.
- **[x] D5 — DISCRETE selectable play speeds** should be present (not only the continuous slider).
  Provide clear speed presets to click. Current presets 1×/2×/3×/4×; expand to include a
  slow/study speed (0.5×) and faster (6×/8×) so you can pick a distinct speed. (Slider covers the
  in-between; presets give one-click canonical speeds.)
- **[x] D4 — FLY CAM should be ON by DEFAULT.**

## E. Ballistics terminology & model (consult ARTILLERY_DOCTRINE.md)

> Ref: `docs/wiki/ref/ARTILLERY_DOCTRINE.md §1`. Correct doctrinal terms:
> **DIRECT** (flat, needs LOS) · **INDIRECT** (arced howitzer, needs spotter) ·
> **HIGH-ANGLE / MORTAR** (steep lob, short range, minimal dead space).

- **[x] E1 — RENAME trajectory modes to doctrinal terms.** Current UI: DIRECT / OBLIQUE / MORTAR.
  → Should be **DIRECT / INDIRECT / HIGH-ANGLE (MORTAR)**. "Indirect" is the correct word, not
  "oblique". (User: "Indirect may be a better term than direct" — interpreted as: use the proper
  DIRECT vs INDIRECT distinction; oblique→indirect.)
- **[x] E2 — MORTAR / HIGH-ANGLE should have MUCH LOWER max range but LESS dead space.** Currently
  mortar shares the full max range — WRONG. Mortar = short range, near-vertical plunge, almost no
  dead zone. Cap mortar range well below the gun's flat max (it's a different, shorter-reaching
  high-angle regime).
- **[~] E3 (accuracy ladder done via O1 dmgMult; beaten-zone/dispersion later) — MORTAR ACCURACY:** high-angle/blind fire is the LOOSEST (biggest dispersion / beaten
  zone). Reflect in accuracy once dispersion is modelled (ref §5). Note kept for the ballistics
  accuracy pass.
- **[~] E4 (finite ammo + bar done; shell-impact RECORDING later) — RECORD where shells actually LAND** (impact points), and model **AMMUNITION** (finite
  rounds per gun, consumed per shot). Impacts logged/recorded; friendly hits recorded by location.

## F. Firing / targeting UX — the "maths-focused" fire panel

- **[x] F1 — SELECT TARGETING POINTS to fire at** (click a ground point or enemy to designate a
  fire mission), not just auto-engage.
- **[x] F2 — SHOW THE ACTUAL CALCULATIONS** when firing: **gun elevation (QE), charge/propellant
  zone, muzzle velocity, time of flight, angle of fall, range**. Make it a **maths-focused panel**
  that appears when firing. This is a headline feature the user wants.
- **[x] F3 — DRAW THE PARABOLIC TRAJECTORY of shells as a line** (the actual arc from muzzle to
  impact). Shown in the firing panel AND in the world.
- **[x] F4 — AUTO-TARGETING should ALSO show these** parabolic trajectory lines + calc.
- **[x] F5 — TRAJECTORY LINES visible even when the firing unit is NOT selected** (so you can watch
  the whole battle's arcs of fire). Applies to engagement fire, both sides.

## G. Immunity band (independent from fire-control)

- **[x] G1 — IMMUNITY BAND line should be MORE CLEAR & BOLD.** It's a distinct concept from
  fire-control and should read as its own bold overlay.
- **[x] G2 — Selecting the immunity band shows a DROPDOWN** to specify the **type of shell / gun
  expected to be faced**, so the band is computed from THAT threat gun vs the SELECTED unit's
  armour. (Currently it guesses from a reference enemy.)
- **[x] G3 — ENEMY units can be selected for immunity-band calc IF their class is known.** (Known
  class → known armour scheme → can compute their immunity band too.)

## H. Lines (movement / objective vs comms)

- **[x] H1 — MOVEMENT lines look too similar to COMMS lines.** Make movement/objective/order lines
  a **darker blue, more solid** (comms stays teal, thinner/dashed). ALL movement/objective-related
  lines get this darker-solid-blue treatment.

## I. Unit markers / indicators / selection

- **[x] I1 — Unit indicators (floating tags) are TOO BIG.** Make them **smaller triangles closer to
  the unit**, and allow **resize / turn OFF via a view button**.
- **[x] I2 — ARROW-KEY selection** of units (cycle through units with arrow keys). (`,`/`.` exists;
  add arrow keys.)
- **[x] I3 — SELECTED unit's triangle gets a YELLOW+BLACK outline.**
- **[x] I4 — A unit BEING FIRED ON gets a RED outline** on its position indicator — visible together
  with the selection outline if both apply.
- **[x] I5 — STATUS on the marker:** an **ammunition bar**, and a **status symbol** (e.g. knocked
  out, on fire).
- **[x] I6 — MOVEMENT FLAG disappears when the unit reaches it.** (Currently the flag lingers.)

## J. Selected-unit panel

- **[x] J1 — Show a small ZOOMED-IN VISUAL of the unit itself** in the selected-unit panel (a live
  mini-render / portrait) so you can see what it is and how it's moving.

## K. Combat log

- **[x] K1 — Log WHICH unit scored a hit and WITH WHAT ARMAMENT** ("ANZAC-02 hits RAIDER-1 with
  SG-305").
- **[x] K2 — For FRIENDLY units, record WHERE hits landed** (impact location / hit zone).
- **[x] K3 — Combat log can be OPENED into a scrollable panel** (full history).
- **[x] K4 — The MINI combat log must DECAY old messages** — currently everything stacks, gets
  squashed and unreadable. Cap + fade/expire old lines in the mini view.

## L. Combat viewer / POV

- **[x] L1 — "COMBAT VIEWER" POV system missing:** a zoomed-in point-of-view onto the TARGETED
  enemy from the firing unit's line of sight. User expected this and did not see it. Build a
  picture-in-picture / POV camera down the LOS to the target when engaging.

## M. Roads

- **[x] M1 — "Can you add the roads also?"** — Roads ARE implemented (ROADS toggle, OSM highways
  draped on terrain). Possibly the toggle was off, or the user wants them ON by default / more
  visible. ACTION: verify roads render on the live demo, consider default-on + heavier styling.

## P. Buildings — texturing (backlog / later)

- **[ ] P1 — Basic BUILDING TEXTURES.** Apply 3 simple textures to building meshes depending on
  building HEIGHT (low / mid / high tiers, matching the existing lowC/midC/hiC colour bands):
  e.g. low = warehouse/flat roof, mid = mid-rise windows, high = tower glass/curtain-wall. Keep it
  cheap (a small tiled canvas/procedural texture per tier, UV'd on the wall quads in addBuilding).
  Currently buildings are flat vertex-coloured by height only.

## N. Future / backlog (explicitly "potential in the future")

- **[L] N1 — UNMANNED COMMS TOWERS that can be destroyed** — static relay structures that extend
  LOS communications; destroying them collapses that part of the net. (Extends the comms-mast /
  relay-drone concept already in the Unity sim to fixed, destructible map structures.)

- **[L] N2 — SPOTTER EMCON (fire discipline).** In the TUTORIAL, cover the choice to hold a
  spotter's / observer's fire so it is NOT discovered: a unit that fires reveals its position (muzzle
  flash / RDF), so a forward observer that stays silent keeps directing indirect fire without giving
  itself away. Tie to a per-unit HOLD-FIRE / OBSERVE-ONLY posture (spot for others, never shoot).
  Doctrine: emission control (EMCON) + counter-battery. (Now that indirect fire needs a spotter — O1 —
  this is the natural next layer: spotters are valuable and must survive by staying hidden.)

- **[L] N3 — FLAGSHIP RISK: break radio silence to command out-of-range units.** Ordering a unit
  that is OUTSIDE the flagship's default comms range should be possible but RISKY — it forces the
  flagship to broadcast (break EMCON), which can reveal / RDF-locate the flagship's position. Show a
  clear WARNING/confirm before issuing such an order ("BREAK RADIO SILENCE? — reveals flagship
  position"). Models the real tension between command reach and staying hidden. Pairs with N2/comms
  net + the RDF locate mechanic already in the Unity sim.

---

## O. Known engine gaps (recorded from prior analysis — still outstanding, web demo)

1. **[x] O1 — Live combat uses FLAT LOS only.** The direct/indirect/mortar ballistic model exists
   as an overlay but the actual firefight ignores it — mortars can't yet lob over hills IN THE
   FIGHT. **Wiring `canHit` into `stepEngage` is the highest-value next step.** (Ties to E1/E2/F.)
2. **[ ] O2 — No armour/penetration in the web fight** — damage is a single 0–100 struct scalar.
   Unity sim has full per-zone verpen/horpen tables. (Ties to G immunity + angle-of-fall.)
3. **[ ] O3 — No subsystem / localised damage** (immobilise / disarm / fires / cook-off) in web.
   Unity has it.
4. **[ ] O4 — No drones / EW / camouflage / RDF** in the browser.
5. **[ ] O5 — Weather is cosmetic** — wind doesn't affect ballistics, rain doesn't slow movement
   (the `fog`/range hook exists but is a dead constant `1.0`).
6. **[ ] O6 — No save / persistence; only 3 hardcoded scenarios.**
7. **[ ] O7 — AI is basic (advance-and-fight)** — no flanking / retreat / target prioritisation.

### Mortar / accuracy review notes (keep with E2/E3/O1)
- Mortar/high-angle = **short range, near-vertical, minimal dead space** — the ONLY way into deep
  defilade — but the **loosest accuracy** (largest beaten zone; ref §5). It must NOT reach the
  gun's flat max range. When dispersion is added: range PE grows with range and is bigger for
  high-angle; a moving target walks out of the bracket.

---

## Priority ordering (proposed)

**Quick, clearly-specified wins (do first):**
D1 mouse-wheel zoom, D2 =/- speed, D4 fly-cam default, C2 hide button, I6 flag-disappears,
K4 mini-log decay, K1 log armament, H1 line colours, E1 rename indirect, E2 mortar range cap.

**Medium (real features):**
C1/C3 panel layout + ⓘ tooltips, I1/I3/I4 markers + outlines, I5 status bar, D3 speed slider,
J1 unit portrait, K3 scrollable log, G1/G2/G3 immunity band, A1 map flip.

**Headline (bigger builds):**
F1–F5 targeting + trajectory + maths panel, L1 combat POV viewer, O1 canHit in stepEngage,
B1 real suburb borders.

**Later:** N1 comms towers, O2–O7 depth systems.
