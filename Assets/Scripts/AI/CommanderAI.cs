// CITY BATTLE — CommanderAI: the enemy (or allied-bot) tactical brain.
// Runs on the sim tick at a slow cadence (~2 Hz). It does NOT cheat the fog of war — it reasons
// only over what its team can see (terrain LOS + drones), exactly like the player. Behaviour,
// RtW-flavoured:
//   * SCOUT  — if it can't see the enemy, push recon drones / advance cautiously to gain contact.
//   * POSTURE — pick good firing positions: high ground (sight + range), hull-down behind crests,
//               keeping thick frontal armour toward the threat; avoid silhouetting on skylines.
//   * ENGAGE — focus-fire: prioritise spotted, wounded, high-threat, in-range enemies; choose
//              direct fire when LOS is clear, indirect (lob over terrain) when only spotted.
//   * PRESERVE — pull back mission-killed/immobile-risk units; immobilised units fight in place.
// Deterministic: uses the sim's SimRandom, no UnityEngine.Random.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Combat;
using CityBattle.Units;
using CityBattle.Terrain;
using CityBattle.Data;

namespace CityBattle.AI
{
    public enum AiStance { Aggressive, Balanced, Defensive }

    public class CommanderAI
    {
        public int Team;
        public AiStance Stance = AiStance.Balanced;
        public bool UseDrones = true;

        // Per-unit AI memory.
        class UnitBrain
        {
            public Vector3 desiredPos;
            public bool hasDesiredPos;
            public long lastRepositionTick;
            public MechaUnit committedTarget;
            public long lastDroneTick = -99999;
        }
        readonly Dictionary<MechaUnit, UnitBrain> _brains = new();

        public CommanderAI(int team, AiStance stance = AiStance.Balanced)
        { Team = team; Stance = stance; }

        UnitBrain Brain(MechaUnit u)
        {
            if (!_brains.TryGetValue(u, out var b)) { b = new UnitBrain(); _brains[u] = b; }
            return b;
        }

        public void Think(BattleSim sim, int team, long tick)
        {
            var terrain = sim.Terrain;
            var myUnits = new List<MechaUnit>();
            var enemies = new List<MechaUnit>();
            foreach (var u in sim.Units)
            {
                if (!u.Alive) continue;
                if (u.Team == team) myUnits.Add(u);
                else enemies.Add(u);
            }
            if (myUnits.Count == 0) return;

            // Visible enemies = those our team has spotted.
            var visibleEnemies = new List<MechaUnit>();
            foreach (var e in enemies) if (sim.IsVisibleTo(e, team)) visibleEnemies.Add(e);

            foreach (var u in myUnits)
                ThinkUnit(sim, terrain, u, myUnits, enemies, visibleEnemies, tick);
        }

        void ThinkUnit(BattleSim sim, TerrainField terrain, MechaUnit u, List<MechaUnit> allies,
                       List<MechaUnit> allEnemies, List<MechaUnit> visibleEnemies, long tick)
        {
            var brain = Brain(u);

            // ---- PRESERVE: badly hurt and not pinned -> pull back from the threat axis. ----
            if (u.Structure < 28f && u.CanMove && Stance != AiStance.Aggressive)
            {
                Vector3 away = AwayFromThreat(u, visibleEnemies, terrain);
                u.MoveTarget = away; u.HasMoveOrder = true;
                u.HullDown = true;
                u.Fire = u.FireTarget != null ? FireMode.Direct : FireMode.Hold;
                return;
            }

            // ---- TARGETING: pick the best enemy we can actually engage. ----
            MechaUnit target = SelectTarget(sim, terrain, u, visibleEnemies);
            if (target != null)
            {
                brain.committedTarget = target;
                u.FireTarget = target;
                bool los = terrain.HasLineOfSight(u.EyePosition, target.EyePosition);
                float range = Vector3.Distance(u.EyePosition, target.EyePosition);
                float gunRange = u.Weapons.Count > 0 ? u.Weapons[0].def.maxRangeM : 0f;

                // Choose fire posture: direct if LOS, else indirect lob (target is spotted).
                u.Fire = los ? FireMode.Direct : FireMode.Indirect;

                // Effective engagement range: shells disperse badly at extreme range, so the AI
                // fights at a sensible distance (not the gun's theoretical max) and closes if beyond it.
                float effRange = EffectiveEngagementRange(u, gunRange);
                if (range > effRange)
                {
                    Reposition(sim, terrain, u, target, tick, closeIn: true);
                }
                else
                {
                    // In range: seek a good posture (hull-down on a crest facing the target) but
                    // don't fidget — stationary fire is more accurate.
                    MaybePostureHold(sim, terrain, u, target, tick);
                }
            }
            else
            {
                // ---- SCOUT: no visible target. Gain contact. ----
                Scout(sim, terrain, u, allEnemies, tick);
            }
        }

        // ---- Target selection: focus fire on the juiciest reachable enemy. ----
        MechaUnit SelectTarget(BattleSim sim, TerrainField terrain, MechaUnit u, List<MechaUnit> visibleEnemies)
        {
            MechaUnit best = null;
            float bestScore = float.MinValue;
            float gunRange = u.Weapons.Count > 0 ? u.Weapons[0].def.maxRangeM : 6000f;

            foreach (var e in visibleEnemies)
            {
                float range = Vector3.Distance(u.EyePosition, e.EyePosition);
                bool los = terrain.HasLineOfSight(u.EyePosition, e.EyePosition);
                // Must be hittable: direct (LOS, in range) OR indirect (spotted, in range).
                bool inRange = range <= gunRange;
                if (!inRange) continue;

                float score = 0f;
                score += los ? 40f : 10f;                       // prefer direct-fire targets
                score += (1f - range / Mathf.Max(1f, gunRange)) * 30f;  // closer = easier
                score += (100f - e.Structure) * 0.5f;           // finish wounded enemies
                if (e.Disarmed) score -= 25f;                   // a disarmed enemy is low priority
                if (e.MissionKilled) score -= 40f;
                // Threat: an enemy aiming at us / with a big gun is dangerous -> prioritise.
                if (e.FireTarget == u) score += 25f;
                if (e.Weapons.Count > 0) score += e.Weapons[0].def.caliberMm * 0.08f;
                // Exposed (not hull-down) enemies are easier kills.
                if (!e.HullDown) score += 10f;

                if (score > bestScore) { bestScore = score; best = e; }
            }
            return best;
        }

        // The distance at which this gun is actually effective (accuracy still reasonable).
        // Far below the gun's theoretical max range; tuned so dispersion lands hits.
        float EffectiveEngagementRange(MechaUnit u, float gunMaxRange)
        {
            // Larger calibres reach a bit farther effectively; cap so AI closes on big maps.
            float cal = u.Weapons.Count > 0 ? u.Weapons[0].def.caliberMm : 100f;
            float eff = Mathf.Lerp(900f, 3500f, Mathf.Clamp01((cal - 57f) / 250f));
            return Mathf.Min(eff, gunMaxRange);
        }

        // ---- Reposition toward a firing position (high ground near, but not too near, the target). ----
        void Reposition(BattleSim sim, TerrainField terrain, MechaUnit u, MechaUnit target, long tick, bool closeIn)
        {
            var brain = Brain(u);
            // Throttle re-planning so units commit to a move (RtW orders are deliberate).
            if (brain.hasDesiredPos && tick - brain.lastRepositionTick < 60 &&
                Vector3.Distance(new Vector3(u.Position.x,0,u.Position.z), new Vector3(brain.desiredPos.x,0,brain.desiredPos.z)) > 30f)
            {
                u.MoveTarget = brain.desiredPos; u.HasMoveOrder = true;
                return;
            }

            float gunRange = u.Weapons.Count > 0 ? u.Weapons[0].def.maxRangeM : 6000f;
            float eff = EffectiveEngagementRange(u, gunRange);
            // Stand off at a fraction of effective range (aggressive closes more).
            float standoff = eff * (Stance == AiStance.Aggressive ? 0.55f : Stance == AiStance.Defensive ? 0.9f : 0.7f);

            Vector3 best = FindFiringPosition(terrain, u, target.Position, standoff, sim);
            brain.desiredPos = best; brain.hasDesiredPos = true; brain.lastRepositionTick = tick;
            u.MoveTarget = best; u.HasMoveOrder = true;
        }

        // Sample candidate positions around the desired standoff ring; score by elevation,
        // LOS to target, and (lightly) cover. Picks high ground with a sightline.
        Vector3 FindFiringPosition(TerrainField terrain, MechaUnit u, Vector3 targetPos, float standoff, BattleSim sim)
        {
            Vector3 toMe = (u.Position - targetPos); toMe.y = 0;
            float baseAng = Mathf.Atan2(toMe.x, toMe.z);
            Vector3 best = u.Position; float bestScore = float.MinValue;

            for (int i = 0; i < 12; i++)
            {
                float ang = baseAng + (i - 6) * 0.18f;        // arc on our side of the target
                float dist = standoff * (0.8f + 0.4f * sim.Rng.NextFloat());
                float wx = targetPos.x + Mathf.Sin(ang) * dist;
                float wz = targetPos.z + Mathf.Cos(ang) * dist;
                if (!terrain.InBounds(new Vector3(wx, 0, wz))) continue;
                float gy = terrain.HeightAt(wx, wz);
                Vector3 cand = new Vector3(wx, gy, wz);

                float score = 0f;
                score += (gy - terrain.Origin.y) * 0.15f;     // high ground: more sight + range
                Vector3 eye = cand + Vector3.up * u.EyeHeight;
                Vector3 tEye = targetPos + Vector3.up * 6f;
                if (terrain.HasLineOfSight(eye, tEye)) score += 30f;   // can shoot directly
                score -= Vector3.Distance(cand, u.Position) * 0.01f;   // prefer nearer moves
                if (score > bestScore) { bestScore = score; best = cand; }
            }
            return best;
        }

        // In range: settle into a hull-down posture if a crest is handy; otherwise hold and fire.
        void MaybePostureHold(BattleSim sim, TerrainField terrain, MechaUnit u, MechaUnit target, long tick)
        {
            var brain = Brain(u);
            bool los = terrain.HasLineOfSight(u.EyePosition, target.EyePosition);

            // Defensive units like to be hull-down; aggressive ones stand and trade.
            if (Stance == AiStance.Defensive) u.HullDown = true;
            else if (Stance == AiStance.Aggressive) u.HullDown = false;

            // If we don't even have LOS but are "in range", nudge to a spot that does (or rely on indirect).
            if (!los && tick - brain.lastRepositionTick > 80)
            {
                float standoff = Vector3.Distance(u.Position, target.Position);
                Vector3 spot = FindFiringPosition(terrain, u, target.Position, standoff, sim);
                if (terrain.HasLineOfSight(spot + Vector3.up * u.EyeHeight, target.EyePosition))
                {
                    u.MoveTarget = spot; u.HasMoveOrder = true;
                    brain.lastRepositionTick = tick;
                    return;
                }
            }
            // Otherwise stop and shoot — stationary fire is more accurate.
            u.HasMoveOrder = false;
        }

        // ---- Scout: no contact. Launch recon drones (if available) and advance to gain contact. ----
        void Scout(BattleSim sim, TerrainField terrain, MechaUnit u, List<MechaUnit> allEnemies, long tick)
        {
            var brain = Brain(u);
            u.Fire = FireMode.Hold;

            // Where do we think the enemy is? Aim toward the enemy force centroid (their start side).
            Vector3 enemyDir = EnemyDirection(sim, u);
            Vector3 probe = u.Position + enemyDir * 1200f;
            probe = ClampInBounds(terrain, probe);

            // Recon drone: send one out occasionally toward the suspected enemy area.
            if (UseDrones && tick - brain.lastDroneTick > 1200) // ~60s between launches
            {
                var def = FindReconDrone(sim);
                if (def.HasValue)
                {
                    Vector3 area = ClampInBounds(terrain, u.Position + enemyDir * 2200f);
                    sim.ActiveDrones.Add(new Combat.Drones.DroneAgent(def.Value, u.Team, u.EyePosition, area));
                    brain.lastDroneTick = tick;
                }
            }

            // Cautious advance toward contact (Defensive holds more).
            if (Stance != AiStance.Defensive && u.CanMove)
            {
                u.MoveTarget = probe; u.HasMoveOrder = true;
            }
            else
            {
                u.HasMoveOrder = false;
                u.HullDown = true;
            }
        }

        // ---- helpers ----

        Vector3 EnemyDirection(BattleSim sim, MechaUnit u)
        {
            // Toward the centroid of all enemy units (uses ground truth positions for the *direction*
            // of advance only — this is "we know roughly where the front is", not perfect targeting).
            Vector3 c = Vector3.zero; int n = 0;
            foreach (var e in sim.Units)
                if (e.Team != u.Team && e.Alive) { c += e.Position; n++; }
            if (n == 0) return u.Forward;
            c /= n;
            Vector3 d = c - u.Position; d.y = 0;
            return d.sqrMagnitude > 1f ? d.normalized : u.Forward;
        }

        Vector3 AwayFromThreat(MechaUnit u, List<MechaUnit> threats, TerrainField terrain)
        {
            if (threats.Count == 0) return u.Position;
            Vector3 c = Vector3.zero;
            foreach (var t in threats) c += t.Position;
            c /= threats.Count;
            Vector3 away = (u.Position - c); away.y = 0;
            if (away.sqrMagnitude < 1f) away = -u.Forward;
            Vector3 dest = u.Position + away.normalized * 500f;
            return ClampInBounds(terrain, dest);
        }

        static Vector3 ClampInBounds(TerrainField t, Vector3 p)
        {
            p.x = Mathf.Clamp(p.x, t.Origin.x + 50f, t.Origin.x + t.WorldWidth - 50f);
            p.z = Mathf.Clamp(p.z, t.Origin.z + 50f, t.Origin.z + t.WorldLength - 50f);
            p.y = t.HeightAt(p.x, p.z);
            return p;
        }

        DroneDef? FindReconDrone(BattleSim sim)
        {
            foreach (var d in sim.Db.Drones) if (d.role == DroneRole.Recon) return d;
            return null;
        }
    }
}
