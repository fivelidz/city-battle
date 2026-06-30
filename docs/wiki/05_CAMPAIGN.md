# Campaign & Management

The strategic loop, ported from Rule the Waves (see `ref/RTW2_MECHANICS.md` §7) and trimmed of deep
diplomacy. You are the **high command** of an alt-modern nation: **win wars on victory points**,
**stay popular to stay in power**, and **manage tension and budget** between rival nations.

## Victory Points — winning wars
**Wars are decided by victory points (VP).** You earn VP by winning battles and completing mission
objectives (destroying enemy crabs, holding ground, wrecking emplacements, escorting convoys
through, supporting invasions); you **lose** VP for lost battles and lost crabs. The side with more
VP when a war ends **wins it**. VP is the scoreboard of every campaign.

## Prestige / popularity — staying in power
A running **prestige / popularity** measure decides whether you **keep your command**. (As in RtW3,
losing popularity can remove you from power — a tenure game-over.)

| Raises prestige | Lowers prestige |
|---|---|
| winning battles & wars | losing battles & wars |
| destroying enemy crabs cheaply | **losing your own crabs** (and crews) |
| meeting mission objectives | failed/aborted missions |
| sound budget management | overspending / debt |
| good event/decision choices | bad event choices, scandals |
| fielding prestige flagship designs | leaving rivals to out-build you |

Prestige is the political layer over VP: you can win battles and still fall if the cost in crabs and
money turns the public against you.

## Tension — the road to war
**Tension** is a per-rival scale **0 → 13** (RtW's model). It climbs from incidents, arms races,
crises and provocative deployments.
- **Tension gates your budget** — rising tension justifies larger (emergency) budgets.
- **At 13, war triggers.** Deciding when to push a rival and when to back down is the core strategic
  game — you provoke to fund a build-up, or de-escalate to avoid a war you're not ready for.

## Budget — income & expenses
A monthly budget balances **income** against **expenses**:
- **Income:** national funds, scaling with the economy and era; **rising tension/war raises it**,
  peace shrinks it.
- **Expenses:** crab **maintenance** (per `maintenance` in `chassis.csv`), **construction** of new
  crabs, and **research** funding across the branches (04_RESEARCH).
- You allocate between **building, research, and reserve**. Overspending hurts prestige.
- Nation **`fabrication_efficiency`** scales build cost; **`research_speed`** scales tech progress
  (`nations.csv`).

## Production → roster → deploy
1. **Design** a crab in the Foundry (02_CRAB_DESIGN) — it becomes a saved blueprint.
2. **Produce** it from the budget; it enters a **build queue** with a cost and lead time.
3. Completed crabs join your **roster**.
4. **Deploy** rostered crabs into the missions a war generates.

## Mission types
The war generates battles with distinct objectives that feed VP:

| Mission | Objective |
|---|---|
| **Battle / fleet action** | defeat the enemy lance in open engagement |
| **Convoy escort** | shepherd supply crabs/transports safely across the map |
| **Destroy emplacement** | knock out a fixed gun position / fortification |
| **Crew rescue** | recover the crew of a knocked-out crab before the enemy does |
| **Coastal raid** | hit-and-run against shore targets, then withdraw |
| **Invasion support** | escort & cover a landing / amphibious crossing (water-crossing crabs) |

## Crew rescue mechanic
Knocked-out crabs leave a **recoverable crew** (see 03_COMBAT — no sinking). A **crew rescue** lets
you extract them; losing crews permanently costs experience and prestige, so contested rescues are
worth fighting for. Veteran crews improve fire control and damage control over their careers.

## Nations
Alt-modern factions with compact perks (`nations.csv`): combat modifiers (Accuracy, DamageControl,
ArmourQuality, FireControl, DroneDoctrine, EWStrength) and industrial traits.

| Nation | Leaning (traits) |
|---|---|
| **Helvetic Concord** | TechnicalExcellence; FireControlMasters |
| **Nordmark Union** | HeavyArmour; SiegeDoctrine |
| **Sahel Compact** | DroneFocus; SwarmTactics |
| **Pacifica League** | DroneFocus; NetworkCentric |
| **Aurelian Directorate** | EWSpecialist; SignalsDominance |
| **Cordillera Pact** | MassProduction; Pragmatic |
| **Meridian Hegemony** | BalancedDoctrine; Expansionist |
| **Steppe Coalition** | DroneFocus; LightChassis; RapidResearch |

Politics is **light** — tension/alliance between nations drives *which* wars happen and the budget
you get, but there is **no deep diplomacy sim**.

## Setting & lore
The cities are **inhospitable** — the great metropolises are fought *over*, not lived in. Warfare is
waged by the crab-mechas across the ruins and topography, while **civilian scavenger-crabs** pick
through the contested terrain between battles. The walking warships are the only safe way to move and
fight in the broken urban landscape — which is why the campaign is fought crab-vs-crab over real
city ground (06_MAP).
