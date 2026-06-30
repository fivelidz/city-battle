# CITY BATTLE — Crab Anatomy & Nautical Conventions

These terms and conventions carry across the WHOLE project — models, designer, sim, UI, lore.
Crab-mechas are treated as **walking warships**: long, narrow hulls that scuttle along their
long (fore-aft) axis on legs gripping at the bow and stern.

## Orientation (the canonical frame)
- **BOW / FORE** = the front of the hull = local **+Z**. The crab's primary facing/movement.
- **STERN / AFT** = the rear of the hull = local **-Z**.
- **STARBOARD** = right side = local **+X**.
- **PORT** = left side = local **-X**.
- **DECK / TOP** = up = local **+Y** (the carapace).
- Long axis = **fore-aft**. The crab moves primarily fore/aft (scuttles along the hull axis),
  turning its whole hull to bring guns to bear (like a ship manoeuvring).

## Legs
- Legs are clustered at the **BOW and STERN ends**, NOT along the port/starboard sides.
- They splay outward (and fore/aft) to reach the ground for a stable stance.
- The **midships port/starboard flanks are kept clear** — that's where broadside arcs face and
  secondary mounts sit.
- Leg count per chassis is split between a fore cluster and an aft cluster (e.g. 8 = 4 fore + 4 aft).
- Damage to a leg cluster degrades mobility; losing enough = immobilised (fights as a fixed battery).

## Guns (Rule the Waves turret logic)
- **Main turrets** sit on the **centreline**, placed **fore and aft**, **superfiring** when 2+ at
  one end (A over B forward, X over Y aft) so both can fire over each other.
- **Secondary / broadside mounts** sit on the **port/starboard midships flanks**, firing outboard.
- Turrets traverse within an arc; centreline mains have wide arcs, flank secondaries fire to their side.
- Barrel length & thickness scale with calibre. Big mains may be twin-barrelled.
- Bringing guns to bear = manoeuvring the hull (fore/aft turrets cover front/back; broadsides the sides).

## Armour zones (per the design schema)
Tied to the nautical frame:
- **BOW / glacis** — frontal belt (direct fire from ahead).
- **STERN** — rear belt.
- **PORT / STARBOARD flank** — side belt (flanking fire; broadside exposure).
- **DECK / carapace** — top (plunging/indirect fire, drone top-attack).
- **Legs**, **sensor cupola**, **mantlets** — as before.

## Movement feel
- Scuttles fore/aft along the hull axis; pivots the whole hull to re-aim and to present/avoid a
  broadside. Side-stepping is slower than fore/aft travel.
- Stationary firing is more accurate; a moving target is harder to hit (RtW trade).

## Where this is implemented
- `citymap/web/designer/crabmodel.js` — model geometry uses this frame (bow +Z, legs fore/aft,
  mains centreline fore/aft + flank secondaries). Convention block at the top of the file.
- `citymap/web/designer/designer.js` — loadout schematic labels BOW/STERN/PORT/STBD/DECK.
- Unity sim (`Assets/Scripts/Units/`) — `MechaUnit.Forward` is the bow; armour zones map to
  these names (Glacis=bow, FlankL/R=port/starboard, Carapace=deck).
