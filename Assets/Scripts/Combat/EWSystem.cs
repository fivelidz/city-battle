// CITY BATTLE — EWSystem: electronic warfare resolution (docs/DESIGN.md 4.3).
// Implements the rock-paper-scissors layer:
//   * Jammers degrade enemy RADIO/SATELLITE drone links by proximity & strength.
//   * Fibre-optic drones are immune (but short-ranged) -> the counter to jamming.
//   * Laser C-UAS hard-kills nearby enemy drones each tick (probabilistic).
//   * Charge bays / laser counters are passive force enablers (hooks for later weapon tech).
// Pure sim-side, queried by BattleSim each tick.
using UnityEngine;
using CityBattle.Data;
using CityBattle.Units;
using CityBattle.Combat.Drones;

namespace CityBattle.Combat
{
    public static class EWSystem
    {
        /// <summary>
        /// Compute total jamming [0..1] applied to `drone` by enemy jammers on the field.
        /// Fibre-optic drones return 0 (immune). Strength falls off with distance from emitter.
        /// </summary>
        public static float JammingAgainst(BattleSim sim, DroneAgent drone)
        {
            if (drone.Def.JamImmune) return 0f;

            float jam = 0f;
            foreach (var u in sim.Units)
            {
                if (!u.Alive || u.Team == drone.Team) continue;
                foreach (var e in u.EwModules)
                {
                    if (e.type != EwType.Jammer) continue;
                    float d = Vector3.Distance(u.Position, drone.Position);
                    if (d > e.radiusM) continue;
                    float falloff = 1f - d / e.radiusM;          // 1 at emitter, 0 at edge
                    float ewNation = u.Nation.ewStrength <= 0 ? 1f : u.Nation.ewStrength;
                    jam += falloff * e.strength * ewNation;
                }
            }

            // Drone-side counters reduce jamming (frequency-hopping / hardened link carried by owner team).
            float counter = LinkHardeningForTeam(sim, drone.Team);
            jam = Mathf.Max(0f, jam - counter);
            return Mathf.Clamp01(jam);
        }

        static float LinkHardeningForTeam(BattleSim sim, int team)
        {
            float best = 0f;
            foreach (var u in sim.Units)
            {
                if (!u.Alive || u.Team != team) continue;
                foreach (var e in u.EwModules)
                    if (e.type == EwType.HardenedLink || e.type == EwType.FreqHop)
                        best = Mathf.Max(best, (e.strength - 1f));  // strength>1 -> hardening margin
            }
            return best;
        }

        /// <summary>
        /// Laser / hard-kill C-UAS: each enemy unit with a CUAS module has a per-tick chance to
        /// destroy a drone within its radius. Returns true if the drone was shot down.
        /// </summary>
        public static bool TryHardKill(BattleSim sim, DroneAgent drone, float dt)
        {
            foreach (var u in sim.Units)
            {
                if (!u.Alive || u.Team == drone.Team) continue;
                foreach (var e in u.EwModules)
                {
                    bool isCuas = e.type == EwType.CuasHardkill || e.type == EwType.LaserCuas;
                    if (!isCuas) continue;
                    float d = Vector3.Distance(u.Position, drone.Position);
                    if (d > e.radiusM) continue;

                    // Laser CUAS is instant/precise; kinetic is range-degraded.
                    float baseRate = (e.type == EwType.LaserCuas) ? 0.9f : 0.5f;
                    float rangeFactor = 1f - 0.5f * (d / e.radiusM);
                    float perSecond = baseRate * rangeFactor * e.strength;
                    float pTick = 1f - Mathf.Exp(-perSecond * dt);
                    if (sim.Rng.Chance(pTick)) return true;
                }
            }
            return false;
        }

        /// <summary>Does this team field any drone detector? (Reveals incoming enemy drones early.)</summary>
        public static bool HasDroneDetection(BattleSim sim, int team, out float radius)
        {
            radius = 0f;
            foreach (var u in sim.Units)
            {
                if (!u.Alive || u.Team != team) continue;
                foreach (var e in u.EwModules)
                    if (e.type == EwType.DroneDetector) radius = Mathf.Max(radius, e.radiusM);
            }
            return radius > 0f;
        }
    }
}
