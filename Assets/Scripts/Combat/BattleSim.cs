// CITY BATTLE — BattleSim: the deterministic combat conductor (docs/SIM.md 4).
// Subscribes to SimClock.OnSimTick and advances every system in fixed order.
// Sim-side only: mutates unit/projectile/drone state; rendering reads it via interpolation.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;

namespace CityBattle.Combat
{
    public class BattleSim
    {
        public TerrainField Terrain;
        public readonly List<MechaUnit> Units = new();
        public readonly List<Projectile> Projectiles = new();
        public readonly List<Drones.DroneAgent> ActiveDrones = new();
        public SimRandom Rng;
        public Database Db;

        // Spotting: per-team set of units currently visible to that team.
        public readonly HashSet<MechaUnit>[] Visible = { new(), new() };
        // Previous-tick spotting (to log new contacts).
        readonly HashSet<MechaUnit>[] _wasVisible = { new(), new() };

        // The scrolling battle narrative (global + per-unit).
        public readonly CombatLog Log = new();

        // Events for presentation/audio/fx.
        public System.Action<Projectile> OnProjectileSpawned;
        public System.Action<Vector3, MechaUnit, HitZone, bool> OnImpact; // pos, target, zone, penetrated

        int _losTickCounter;

        public double SimTime;   // mirrors SimClock for log timestamps

        /// <summary>Weather precipitation 0..1 (0 dry, 1 heavy rain). Slows movement & cuts accuracy.</summary>
        public float Precipitation = 0f;
        float PrecipMoveFactor => 1f - Precipitation * 0.4f;   // up to 40% slower in heavy rain

        /// <summary>Firing-solution / bracketing quality 0..1 for a shooter->target pair.</summary>
        public float LockQuality(MechaUnit shooter, MechaUnit target)
            => _rangedIn.TryGetValue((shooter.Id, target.Id), out var v) ? v : 0f;

        public BattleSim(TerrainField terrain, uint seed = 12345)
        {
            Terrain = terrain;
            Rng = new SimRandom(seed);
            Db = Database.Instance;
        }

        /// <summary>Optional AI commanders, one per team. Null = human-controlled.</summary>
        public AI.CommanderAI[] Commanders = new AI.CommanderAI[2];
        long _tick;

        public void Tick()
        {
            float dt = SimClock.SIM_DT;
            _tick++;
            SimTime += dt;

            // 1. Vision FIRST so AI & fire control act on current spotting.
            _losTickCounter++;
            if (_losTickCounter >= 4) { RecomputeVision(); _losTickCounter = 0; }

            // 2. AI commanders issue orders (intent) on a slower cadence (every ~0.5s).
            if (_tick % 10 == 0)
                for (int t = 0; t < 2; t++)
                    Commanders[t]?.Think(this, t, _tick);

            // 3. Movement
            foreach (var u in Units) if (u.Alive) u.TickMovement(Terrain, dt, PrecipMoveFactor);

            // 4. Drones (advance agents, extend vision, run attacks)
            for (int i = ActiveDrones.Count - 1; i >= 0; i--)
            {
                var d = ActiveDrones[i];
                d.Tick(this, dt);
                if (d.Dead) ActiveDrones.RemoveAt(i);
            }

            // 5. Fire control -> spawn projectiles
            foreach (var u in Units)
            {
                if (!u.Alive || !u.CanFireNow || u.Fire == FireMode.Hold) continue;
                u.TickWeapons(dt);
                TryFire(u);
            }

            // 6. Ballistics + impacts
            for (int i = Projectiles.Count - 1; i >= 0; i--)
            {
                var p = Projectiles[i];
                StepProjectile(p, dt);
                if (p.Dead) Projectiles.RemoveAt(i);
            }

            // 7. Subsystem upkeep (fires spread, burn damage, cook-off).
            foreach (var u in Units) if (u.Alive) u.TickSystems(dt, Rng);

            // 8. Win/loss bookkeeping handled by caller (BattleController).
        }

        public int LivingCount(int team)
        {
            int n = 0; foreach (var u in Units) if (u.Team == team && u.Alive) n++; return n;
        }
        public int EffectiveCount(int team)  // not mission-killed
        {
            int n = 0; foreach (var u in Units) if (u.Team == team && u.Alive && !u.MissionKilled) n++; return n;
        }

        // ---- Vision ----

        // Who first spotted each target (for relay attribution / "spotted by" UI).
        public readonly Dictionary<MechaUnit, string>[] SpottedBy =
            { new Dictionary<MechaUnit, string>(), new Dictionary<MechaUnit, string>() };

        void RecomputeVision()
        {
            // Remember last frame to detect NEW contacts for the log.
            _wasVisible[0].Clear(); foreach (var u in Visible[0]) _wasVisible[0].Add(u);
            _wasVisible[1].Clear(); foreach (var u in Visible[1]) _wasVisible[1].Add(u);

            Visible[0].Clear(); Visible[1].Clear();
            SpottedBy[0].Clear(); SpottedBy[1].Clear();

            foreach (var observer in Units)
            {
                if (!observer.Alive) continue;
                int team = observer.Team;
                int enemyTeam = 1 - team;
                float sight = observer.EffectiveSightRange(Terrain);

                foreach (var target in Units)
                {
                    if (target.Team != enemyTeam || !target.Alive) continue;
                    if (CanSee(observer.EyePosition, sight, target))
                    {
                        Visible[team].Add(target);
                        if (!SpottedBy[team].ContainsKey(target)) SpottedBy[team][target] = observer.Name;
                    }
                }
            }

            // Drones contribute spotting to their owning team (the recon-relay backbone).
            foreach (var d in ActiveDrones)
            {
                foreach (var target in Units)
                {
                    if (target.Team == d.Team || !target.Alive) continue;
                    if (CanSee(d.Position, d.Def.rangeM, target))
                    {
                        Visible[d.Team].Add(target);
                        if (!SpottedBy[d.Team].ContainsKey(target)) SpottedBy[d.Team][target] = d.Def.name + " (drone)";
                    }
                }
            }

            // Log NEW contacts (and lost contacts) for each team.
            for (int team = 0; team < 2; team++)
            {
                foreach (var t in Visible[team])
                    if (!_wasVisible[team].Contains(t))
                        Log.Add(SimTime, LogKind.Spot,
                            $"CONTACT: {t.Name} spotted by {SpottedBy[team].GetValueOrDefault(t, "?")}", -1);
            }
        }

        /// <summary>Name of the friendly observer/drone that spotted `target` for `team` (relay UI).</summary>
        public string SpotterFor(MechaUnit target, int team)
            => SpottedBy[team].TryGetValue(target, out var n) ? n : null;

        bool CanSee(Vector3 eye, float sightRange, MechaUnit target)
        {
            Vector3 tp = target.EyePosition;
            float dist = Vector3.Distance(eye, tp);
            if (dist > sightRange) return false;
            // Hull-down targets are only spottable from above or very close.
            float clearance = target.HullDown ? target.EyeHeight * 0.5f : 0f;
            return Terrain.HasLineOfSight(eye, tp, clearance);
        }

        public bool IsSpotted(MechaUnit u) => Visible[1 - u.Team].Contains(u);
        public bool IsVisibleTo(MechaUnit u, int team) => Visible[team].Contains(u);

        // ---- Fire control ----

        void TryFire(MechaUnit shooter)
        {
            var target = shooter.FireTarget;
            if (target == null || !target.Alive) return;

            // Need the target spotted by the shooter's team (direct LOS or drone/ally spotting).
            bool spotted = IsVisibleTo(target, shooter.Team);
            if (!spotted) return;

            bool directLos = Terrain.HasLineOfSight(shooter.EyePosition, target.EyePosition);

            // Trajectory class by fire mode: Direct=flat (needs LOS), Indirect=arced, Mortar=high.
            // No LOS forces at least an arced lob. Dead space: a flat/arced trajectory may be unable
            // to clear intervening terrain to reach a defiladed target — only a high arc gets in.
            var traj = shooter.Fire switch
            {
                FireMode.Mortar => TrajectoryClass.High,
                FireMode.Indirect => TrajectoryClass.Arced,
                _ => directLos ? TrajectoryClass.Flat : TrajectoryClass.Arced
            };
            bool indirect = traj != TrajectoryClass.Flat;

            // Flat fire into dead space (no LOS) is impossible.
            if (traj == TrajectoryClass.Flat && !directLos) return;
            // Arced fire can be masked by terrain higher than its arc; high-angle (mortar) gets in.
            if (traj == TrajectoryClass.Arced && !directLos &&
                !ArcClearsTerrain(shooter.EyePosition, target.EyePosition, 0.25f))
                return;  // target is in dead space for this arc — need a steeper trajectory (mortar)

            foreach (var w in shooter.Weapons)
            {
                if (!w.Ready) continue;
                Vector3 muzzle = shooter.EyePosition;
                Vector3 trueAim = PredictAim(shooter, target, w.def);
                float range = new Vector2(trueAim.x - muzzle.x, trueAim.z - muzzle.z).magnitude;
                if (range > w.def.maxRangeM) continue;

                // Dispersion as a GROUND-PLANE scatter around the aim point (realistic, bounded
                // miss distances), then solve the firing solution to that scattered point.
                Vector3 aim = ScatterAim(trueAim, muzzle, shooter, target, range);

                if (!Ballistics.LaunchVelocity(muzzle, aim, w.def.muzzleVelocityMs, indirect,
                                               out Vector3 vel, out float tof, out float elevDeg))
                {
                    if (DebugFire) UnityEngine.Debug.Log($"[FIRE] {shooter.Name}->{target.Name} NO SOLUTION range={range:0} indirect={indirect}");
                    continue;
                }
                if (DebugFire)
                {
                    float aimMiss = Vector3.Distance(new Vector3(aim.x,0,aim.z), new Vector3(target.Position.x,0,target.Position.z));
                    UnityEngine.Debug.Log($"[FIRE] {shooter.Name}->{target.Name} range={range:0} aimMissFromTgt={aimMiss:0} indirect={indirect} elev={elevDeg:0.0}");
                }

                var p = new Projectile
                {
                    Position = muzzle, PrevPosition = muzzle, Velocity = vel,
                    CaliberMm = w.def.caliberMm, MuzzleSpeed = w.def.muzzleVelocityMs,
                    FiringTeam = shooter.Team, IntendedTarget = target, LaunchRange = range,
                    Drag = DragModel.DragFor(w.def.caliberMm)
                };
                Projectiles.Add(p);
                OnProjectileSpawned?.Invoke(p);
                w.FireReset();

                // Ranging-in: sustained fire on the same target tightens the next salvo
                // (like RtW3 salvos bracketing the target). Decays when target/shooter moves.
                RegisterShot(shooter, target);
            }
        }

        Vector3 PredictAim(MechaUnit shooter, MechaUnit target, GunDef gun)
        {
            // Lead: extrapolate the target along its velocity by the (range-based) time of flight.
            float range = Vector3.Distance(shooter.EyePosition, target.EyePosition);
            float estTof = range / Mathf.Max(1f, gun.muzzleVelocityMs * 0.6f);
            Vector3 lead = target.Moving ? target.Velocity * estTof : Vector3.zero;
            Vector3 aim = target.Position + lead;
            aim.y = Terrain.HeightAt(aim.x, aim.z) + target.EyeHeight * 0.5f;
            return aim;
        }

        // Per shooter->target ranging-in memory (tightens dispersion with sustained accurate fire).
        readonly Dictionary<(int, int), float> _rangedIn = new();

        void RegisterShot(MechaUnit shooter, MechaUnit target)
        {
            var key = (shooter.Id, target.Id);
            float prev = _rangedIn.TryGetValue(key, out var v) ? v : 0f;
            float r = prev;
            // Ranging quality resets if either is moving (lost the bracket).
            if (shooter.Moving || target.Moving) r = Mathf.Max(0f, r - 0.3f);
            else r = Mathf.Min(1f, r + 0.12f);
            _rangedIn[key] = r;

            // Log the RtW3-style ranging progression: ranging -> straddle -> on target.
            if (prev < 0.15f && r >= 0.15f)
                Log.Add(SimTime, LogKind.Ranging, $"{shooter.Name} ranging on {target.Name} (shorts/overs)", shooter.Id);
            else if (prev < 0.55f && r >= 0.55f)
                Log.Add(SimTime, LogKind.Straddle, $"STRADDLE! {shooter.Name} brackets {target.Name}", shooter.Id);
        }

        float RangedIn(MechaUnit shooter, MechaUnit target)
            => _rangedIn.TryGetValue((shooter.Id, target.Id), out var v) ? v : 0f;

        /// <summary>
        /// Dead-space test for an ARCED (howitzer) trajectory: does a parabola from `from` to `to`
        /// with apex height controlled by `bow` clear the intervening terrain? A flatter `bow`
        /// (smaller) leaves more dead space; a high arc (mortar) clears almost anything. Used to
        /// model "only mortar fire reaches into deep defilade" (ATP 3-21.90).
        /// </summary>
        bool ArcClearsTerrain(Vector3 from, Vector3 to, float bow)
        {
            Vector3 d = to - from;
            float horiz = new Vector2(d.x, d.z).magnitude;
            if (horiz < 1f) return true;
            int steps = Mathf.Clamp(Mathf.CeilToInt(horiz / Terrain.CellSize), 4, 120);
            float apex = bow * horiz;   // apex height above the straight chord
            for (int i = 1; i < steps; i++)
            {
                float t = (float)i / steps;
                float wx = from.x + d.x * t;
                float wz = from.z + d.z * t;
                float chordY = from.y + d.y * t;
                float arcY = chordY + apex * 4f * t * (1f - t);   // parabolic bump
                if (Terrain.HeightAt(wx, wz) > arcY) return false;  // terrain pokes through the arc
            }
            return true;
        }

        Vector3 ScatterAim(Vector3 aim, Vector3 muzzle, MechaUnit shooter, MechaUnit target, float range)
        {
            // Fire control (cupola) health + situational penalties (firing while wading, rain).
            float acc = shooter.Accuracy * shooter.SituationalAccuracy * (1f - Precipitation * 0.3f);
            float shooterStill = shooter.Moving ? 2.2f : 1f;       // firing on the move is much worse
            float targetStill = target.Moving ? 1.4f : 1f;         // a moving target is harder to bracket
            float ranged = 1f - 0.6f * RangedIn(shooter, target);  // up to 60% tighter when ranged-in

            // CEP-style radius in metres: grows with range, shrinks with accuracy/ranging.
            // Tuned so settled, ranged-in fire brackets a target at medium range within a few salvos.
            float cepM = (3f + range * 0.006f) * shooterStill * targetStill * ranged / Mathf.Max(0.4f, acc);

            // Scatter on the ground plane (downrange + cross-range).
            Vector3 flat = new Vector3(aim.x - muzzle.x, 0, aim.z - muzzle.z);
            Vector3 downrange = flat.sqrMagnitude > 1e-3f ? flat.normalized : Vector3.forward;
            Vector3 cross = Vector3.Cross(Vector3.up, downrange);

            float dr = Rng.NextGaussian() * cepM;       // range error (long/short)
            float cr = Rng.NextGaussian() * cepM * 0.7f; // cross error (left/right, usually tighter)

            Vector3 scattered = aim + downrange * dr + cross * cr;
            // Aim at the target's mid-body height above the LOCAL ground (so a direct, near-flat
            // shot doesn't dip into intervening terrain crests on its way down).
            scattered.y = Terrain.HeightAt(scattered.x, scattered.z) + Mathf.Max(2f, target.EyeHeight * 0.6f);
            return scattered;
        }

        // ---- Ballistics step + impact ----

        void StepProjectile(Projectile p, float dt)
        {
            // Sub-step fast shells so they don't tunnel through thin terrain/units.
            int sub = Mathf.Clamp(Mathf.CeilToInt(p.Velocity.magnitude * dt / (Terrain.CellSize * 0.5f)), 1, 8);
            float sdt = dt / sub;
            for (int s = 0; s < sub; s++)
            {
                p.Integrate(sdt);

                // Terrain impact.
                float ground = Terrain.HeightAt(p.Position.x, p.Position.z);
                if (p.Position.y <= ground)
                {
                    p.Position.y = ground;
                    ResolveImpactNearMiss(p);
                    p.Dead = true;
                    return;
                }

                // Unit hit (segment test against simple capsules).
                foreach (var u in Units)
                {
                    if (!u.Alive || u.Team == p.FiringTeam) continue;
                    if (SegmentHitsUnit(p.PrevPosition, p.Position, u))
                    {
                        ResolveHit(p, u);
                        p.Dead = true;
                        return;
                    }
                }

                if (!Terrain.InBounds(p.Position) && p.Position.y < ground - 50f) { p.Dead = true; return; }
            }
        }

        bool SegmentHitsUnit(Vector3 a, Vector3 b, MechaUnit u)
        {
            // Treat the mech as a vertical capsule of radius ~3m, height ~ eye*2.
            Vector3 c0 = u.Position + Vector3.up * 0.5f;
            Vector3 c1 = u.Position + Vector3.up * (u.EyeHeight + 1f);
            float r = 3.2f;
            return SegSegDist(a, b, c0, c1) <= r;
        }

        void ResolveHit(Projectile p, MechaUnit target)
        {
            float descent = Ballistics.DescentAngle(p.Velocity);
            HitZone zone = ZoneGeometry.ResolveZone(target.Forward, target.Position, p.PrevPosition, descent, Rng);

            // Plunging fire (steep descent) strikes the top -> use horizontal/deck pen table.
            var penTable = (descent > 35f) ? Db.HorPen : Db.VerPen;
            float pen = penTable.Lookup(p.CaliberMm, p.LaunchRange);

            float armor = target.Armor.Of(zone) * target.ArmorQuality;
            float residual = pen - armor;
            bool penetrated = residual > 0f;
            bool wasAlive = target.Alive;
            string zoneName = ZoneName(zone);

            if (penetrated)
            {
                var report = target.ApplyDamage(zone, residual, Rng);
                LastReport = report;          // surfaced for fx/log/AI
                Log.Add(SimTime, LogKind.Penetrate,
                    $"HIT! {target.Name} {zoneName} PENETRATED ({pen:0}mm vs {armor:0}mm)", target.Id);

                // Localised consequence callouts (the RtW3 damage-effect feed).
                if (report.immobilisedNow) Log.Add(SimTime, LogKind.System, $"{target.Name} IMMOBILISED (legs/drive)", target.Id);
                if (report.disarmedNow)    Log.Add(SimTime, LogKind.System, $"{target.Name} DISARMED (weapon mounts out)", target.Id);
                if (report.blindedNow)     Log.Add(SimTime, LogKind.System, $"{target.Name} BLINDED (sensor mast destroyed)", target.Id);
                if (report.fireStarted)    Log.Add(SimTime, LogKind.System, $"{target.Name} ON FIRE", target.Id);
                if (report.ammoDetonation) Log.Add(SimTime, LogKind.Kill, $"AMMO COOK-OFF! {target.Name} DESTROYED", target.Id);
            }
            else
            {
                target.ApplyShock(Mathf.Clamp(pen * 0.02f, 0.2f, 3f)); // bounce/spall
                Log.Add(SimTime, LogKind.Bounce,
                    $"hit on {target.Name} {zoneName} bounced ({pen:0}mm vs {armor:0}mm)", target.Id);
            }

            if (wasAlive && !target.Alive)
                Log.Add(SimTime, LogKind.Kill, $"*** {target.Name} KNOCKED OUT ***", target.Id);

            OnImpact?.Invoke(p.Position, target, zone, penetrated);
        }

        static string ZoneName(HitZone z) => z switch
        {
            HitZone.Carapace => "TOP",
            HitZone.Glacis => "GLACIS",
            HitZone.FlankL => "L-FLANK",
            HitZone.FlankR => "R-FLANK",
            HitZone.Legs => "LEGS",
            HitZone.Cupola => "SENSOR",
            HitZone.Mantlet => "MANTLET",
            _ => z.ToString().ToUpper()
        };

        /// <summary>The most recent penetrating-hit subsystem report (for HUD/log/AI).</summary>
        public MechaSystems.DamageReport LastReport;

        /// <summary>Enable verbose fire-control logging (diagnostics only).</summary>
        public bool DebugFire = false;

        void ResolveImpactNearMiss(Projectile p)
        {
            // Splash: blast radius scales with calibre (a 305mm near-miss is far deadlier than a 76mm).
            float blastR = Mathf.Clamp(6f + p.CaliberMm * 0.08f, 7f, 30f);   // ~7m..~30m
            foreach (var u in Units)
            {
                if (!u.Alive || u.Team == p.FiringTeam) continue;
                float d = Vector3.Distance(p.Position, u.Position);
                if (d >= blastR) continue;
                float falloff = 1f - d / blastR;
                // A close splash can still penetrate thin top/leg armour with fragments.
                float fragPen = p.CaliberMm * 1.2f * falloff;
                float legArmor = u.Armor.Of(HitZone.Legs) * u.ArmorQuality;
                if (fragPen > legArmor && falloff > 0.5f && Rng.Chance(0.4f))
                    u.ApplyDamage(HitZone.Legs, fragPen - legArmor, Rng);   // shrapnel into the legs
                else
                    u.ApplyShock(Mathf.Lerp(p.CaliberMm * 0.05f, 0f, d / blastR));
            }
            OnImpact?.Invoke(p.Position, null, HitZone.Carapace, false);
        }

        // distance between two segments
        static float SegSegDist(Vector3 p1, Vector3 q1, Vector3 p2, Vector3 q2)
        {
            Vector3 d1 = q1 - p1, d2 = q2 - p2, r = p1 - p2;
            float a = Vector3.Dot(d1, d1), e = Vector3.Dot(d2, d2), f = Vector3.Dot(d2, r);
            float s, t;
            if (a <= 1e-6f && e <= 1e-6f) return r.magnitude;
            if (a <= 1e-6f) { s = 0; t = Mathf.Clamp01(f / e); }
            else
            {
                float c = Vector3.Dot(d1, r);
                if (e <= 1e-6f) { t = 0; s = Mathf.Clamp01(-c / a); }
                else
                {
                    float b = Vector3.Dot(d1, d2), denom = a * e - b * b;
                    s = denom > 1e-6f ? Mathf.Clamp01((b * f - c * e) / denom) : 0f;
                    t = (b * s + f) / e;
                    if (t < 0) { t = 0; s = Mathf.Clamp01(-c / a); }
                    else if (t > 1) { t = 1; s = Mathf.Clamp01((b - c) / a); }
                }
            }
            Vector3 cp1 = p1 + d1 * s, cp2 = p2 + d2 * t;
            return (cp1 - cp2).magnitude;
        }
    }
}
