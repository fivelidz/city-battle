# CITY BATTLE — User Directives (captured 2026-06-30)

Verbatim-faithful record of the user's direction so nothing is lost. Worked through systematically.

## Map creation / 3D modelling
- The map-creation pipeline is great and **should be recorded & saved as a standalone method** —
  it could be awesome on its own for making 3D models of real areas.
- High detail on the maps is fantastic, but **outer areas only need to be rendered if in range or
  in sight** (LOD by visibility — load/draw the periphery only when relevant).
- For battles with **smaller classes**, more **local areas like particular suburbs** could be good
  (smaller suburb-scale maps).
- Want to **look around the map with WASD to fly** (free-fly camera).
- A **view mode that shows a suburb overlay**.

## Firing / artillery realism (see ref image: ATP 3-21.90 Fig 5-1, dead space)
- For firing in range, show **oblique and direct fire shadows**. Showing **different distances**
  matters — relevant to **penetration depth**.
- Whether shells go through the **deck** or the **side armour** depends on **the angle the shell
  hits** the enemy.
- If the enemy is **behind obstacles**, hitting it may be impossible — indirect fire may not have
  the right range. This is **"dead space"** (area safe from a weapon's fire behind terrain).
- Use **artillery images for loads & tutorials** in the game (ref folder:
  `Assets/reference_ideas/`).
- Understand artillery practice: **direct, indirect, and mortar fire** to get around terrain and
  how each affects **accuracy**. Correct terminology throughout.
- **Firing on last-known position** should be possible.
- Display **immunity zones** for allied ships, for **different shell sizes**.
- If the player has **intelligence** about an enemy class (armour depth, gun capabilities), show it.

## Reference / study
- Review the full **Rule the Waves 2 wiki**: https://rtw2.fandom.com/wiki/Rule_The_Waves_2_Wiki
  (mechanics, effects, immunity zones, ship classes, etc.)
- Write **our own game wiki** as we go — keeps us on point + helps new players.

## Ship classes & design
- Ships can be given **class names** on design.
- Use the **same overall class categories as Rule the Waves**: DD, CA, CL (LC), BB, BC, etc.
  (Keep the chassis "look" categories I built, but map them to RtW class codes.)
- **Amphibious** is a **build option**: early game amphibious mechs **cannot shoot while in water**;
  later tech gives a **water penalty to shoot** instead. → **strategic water crossings** on maps
  like Sydney.

## Weather
- **Precipitation should cause slower movement.**

## Foundry redo (the designer)
- Love the adjustable 3D modelling — good direction — but redo with:
  1. **Tech-unlock timing** is variable depending on tech progress (model RtW's research).
  2. **Module placement should be selectable** (choose where modules go).
  3. **Gun placement similar to RtW** — gun placement is **extremely critical**: it affects
     **firing range** and determines the **cones of fire** (broadsides, fore/aft arcs, etc.).
- Better gun-placement potential; **improve the models**; **Leviathans can be longer** to fit guns.

## Management
- **Wars decided by victory points.**
- Player must **remain popular to stay in power** (as in RtW3).
- Keep working on management elements.

## Tooling note
- Can use **Meshy.AI for models later**, once we have a more established frame.

## Process
- Save & archive; go through all of this carefully; work on all elements.
