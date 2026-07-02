# Combat

Real-time-with-pause battles on real terrain. You issue **move / target / fire-mode** orders while
**paused**, then resolve on unpause (Pause / 1× / 2× / 4×). Combat is decided by **what you can see**
and **what your shells can reach** (01_FIRE_AND_BALLISTICS) — not by a health bar.

## Spotting & fog of war
You only know what your crabs can **perceive**.

- **You see what's in LOS / sensor range.** A crab detects targets in its **line of sight** (clear
  over terrain & buildings) out to its **sight range** (base + sensors + an **elevation bonus** — a
  crab on a ridge sees & shoots farther; valleys are blind).
- **Recon drones extend it.** A recon drone (`drones.csv`: Kite Eye, High Hawk, Stratos Eye) flies
  **above** the terrain and spots **defiladed** targets your ground crabs can't see — feeding
  indirect-fire solutions over ridges. Drones are the LOS force-multiplier.
- **Identification is uncertain at range.** A distant contact may be an unidentified blip; you may
  not know its exact class, gun bore or armour until you get closer, fuse more sensors, or it fires.
- **Intel reveals enemy capability.** If you have **intelligence** on an enemy **class** — its
  armour depth and gun capabilities — the game shows it, so you can compute its **immunity zone**
  and yours, and position to fight inside your immune band and outside theirs.
- **Sensors degrade with weather & damage:** smoke/dust/night cut optical spotting (radar/LIDAR
  mitigate); a destroyed **cupola** blinds the crab; **jamming** can knock out drone spotters.

## Comms & command (the line-of-sight net)
Radio is too jammed in this world, so the fleet relays orders & intel over **tight-beam laser
comms** — which need **line of sight**. This is a second fog layer *on top of* vision.
- **On the net** (a relay chain of friendly crabs/relay-drones with LOS links back to command) →
  you can **issue orders** and get **live intel**. **Off the net** (no LOS path — e.g. behind a
  ridge) → you **can't command** it (it follows its last orders) and only a fading **ghost /
  last-known position** remains until contact is restored.
- **Relays:** a crab on **high ground** or a **recon/relay drone aloft** bridges LOS gaps and
  reconnects cut-off units. A **comms mast (datalink) hit** stops a crab transmitting/relaying.
- **Camouflage** shrinks the range at which enemies detect you (a design/tech attribute; Recon
  crabs are stealthier, a Siege is easy to spot).
- **RDF (radio direction finding):** a crab that is **emitting** (active radar, jammer, radio) can
  be **located by the enemy without LOS** — so practise **emission control** (go quiet to stay
  hidden). Tech ladder: laser links → improved optics → RDF/EMCON → camouflage → relay drones →
  **mesh/satellite comms** (late game; removes the comms fog entirely). See `docs/INTELLIGENCE_LAYER.md`.

## Fire control & hit resolution
- **Bracketing / straddle:** sustained fire on a still target converges — shorts and overs close
  into a **straddle**, then hits accumulate. Moving (yours or theirs) **resets the bracket**.
- **Beaten zone:** shells scatter in an ellipse, long along the range line, narrow across; it grows
  with range and is wider for high-angle fire (see 01 & `ref/ARTILLERY_DOCTRINE.md`).
- **Accuracy factors** (better → worse): direct fire at short range > observed/adjusted (a spotter
  or drone corrects) > registered predicted > predicted low-angle > blind long-range high-angle.
  **Range** (farther = looser + steeper fall), **moving shooter** (much worse), **moving target**
  (harder to bracket), **visibility/weather**, **blinded sensors** and **jammed spotters** all hurt.
- **Hit resolution:** on impact, the **angle of fall** picks the struck zone (shallow → side/glacis;
  steep → carapace), then the gun's penetration at the actual range (`verpen` vertical / `horpen`
  horizontal) is compared to that zone's **effective armour**. Penetrate → internal/critical damage;
  fail → bounce or spall.
- **Firing on last-known position:** if you lose contact you can still fire **predicted** at the
  target's last known spot — looser, may miss if it moved, but denies the ground.

## Critical & localised damage (no sinking)
There is **no sinking**. Crabs take **localised subsystem damage** — a penetrating hit can knock out
a specific system (see `MechaSystems.cs`):

| Hit | Effect |
|---|---|
| **Leg cluster** | mobility loss; enough damage = **immobilised** → fights as a fixed battery |
| **Turret / mount** | that gun is **knocked out** (firepower loss) |
| **Cupola / sensor mast** | **blinded** — fire control & sight collapse |
| **Datalink** | loses drone control / network targeting |
| **Ammo bay** | **cook-off** (the magazine analogue) — catastrophic; can mission-kill the crab |
| **Drivetrain / reactor** | speed loss; reactor loss disables energy weapons/EW |
| **Fire** | spreading damage; can reach the ammo bay if not controlled |

**Damage control** (crew + Damage Control tech) fights fires and repairs subsystems over time. A
crab is **knocked out** when it's mission-killed — immobile **and** disarmed, or lost to structural
collapse / cook-off — not "sunk".

## Crew rescue
A knocked-out crab's **crew must be rescued**. A downed crew is a recoverable asset, not an
automatic loss — protect or extract them (a dedicated **crew rescue** mission type exists; see
05_CAMPAIGN). Losing crews permanently costs you experience and prestige.

## Weather effects
- **Precipitation slows movement** — rain/snow bog down the leg-walkers (a directive-level rule).
- **Fog / rain / haze / night cut spotting** — shorten LOS & sensor range, compress fights to
  **short range**, which raises the **side-armour (flat-fire) threat** and blunts long-range
  gunnery. Radar/LIDAR and recon drones partially restore vision.
- Weather varies per battle, so the same lance performs differently day to day — good fire control,
  sensors and drones hedge against bad visibility.
