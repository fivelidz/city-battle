// CITY BATTLE — TacticalInfo: the four-gate gunnery model made queryable for the UI.
// For a (shooter, target) pair it answers the RtW3 questions the player must see:
//   GATE A  Detected   — is the target spotted by the shooter's team (own LOS or relay)?
//   GATE B  In range   — within the weapon's max range?
//   --       Direct LOS — does the shooter personally have terrain line-of-sight?
//   GATE C  Locked     — firing-solution quality (bracketing 0..1)
//   GATE D  Penetrate  — at this range, which armour zone is struck, and is it defeated?
// Pure read-only over sim state. The UI renders these; the sim uses the same logic to fire.
using UnityEngine;
using CityBattle.Data;
using CityBattle.Units;

namespace CityBattle.Combat
{
    public struct TargetSolution
    {
        public bool detected;          // GATE A
        public bool inRange;           // GATE B
        public bool directLos;         // shooter's own terrain LOS
        public bool relayed;           // spotted by an ALLY/drone but not self (enables indirect)
        public bool canEngage;         // detected && inRange && (directLos || relayed)
        public bool indirect;          // would fire on a high arc (no direct LOS)
        public float rangeM;
        public float bearingDeg;
        public float lockQuality;      // GATE C, 0..1
        public HitZone strikeZone;     // GATE D: which zone the shell hits at this range
        public float penetrationMm;    // shell pen at this range vs that zone
        public float zoneArmourMm;     // target armour at that zone (x quality)
        public bool willPenetrate;     // GATE D result
        public float timeOfFlight;
        public float elevationDeg;
    }

    public static class TacticalInfo
    {
        /// <summary>Build the full firing picture for shooter -> target using its primary weapon.</summary>
        public static TargetSolution Solve(BattleSim sim, MechaUnit shooter, MechaUnit target)
        {
            var s = new TargetSolution();
            if (shooter == null || target == null || !shooter.Alive || !target.Alive) return s;
            var terrain = sim.Terrain;

            Vector3 muzzle = shooter.EyePosition;
            Vector3 tp = target.EyePosition;
            s.rangeM = Vector3.Distance(muzzle, tp);
            Vector3 flat = new Vector3(tp.x - muzzle.x, 0, tp.z - muzzle.z);
            s.bearingDeg = Mathf.Atan2(flat.x, flat.z) * Mathf.Rad2Deg;
            if (s.bearingDeg < 0) s.bearingDeg += 360f;

            // GATE A: detection (team-wide spotting; relay if an ally/drone sees it but we don't).
            s.detected = sim.IsVisibleTo(target, shooter.Team);
            s.directLos = terrain.HasLineOfSight(muzzle, tp, target.HullDown ? target.EyeHeight * 0.5f : 0f);
            s.relayed = s.detected && !s.directLos;

            var gun = shooter.Weapons.Count > 0 ? shooter.Weapons[0].def : default;
            float gunRange = gun.maxRangeM;

            // GATE B: range.
            s.inRange = gun.name != null && s.rangeM <= gunRange;

            // Indirect if no direct LOS (lob over terrain) — needs detection (relay/own spotting).
            s.indirect = !s.directLos;
            s.canEngage = s.detected && s.inRange && (s.directLos || s.relayed);

            // GATE C: lock quality (bracketing accumulator), maintained by the sim.
            s.lockQuality = sim.LockQuality(shooter, target);

            // Firing solution (elevation/TOF) for display.
            if (gun.name != null && s.inRange)
            {
                bool high = s.indirect;
                if (Ballistics.LaunchVelocity(muzzle, tp, gun.muzzleVelocityMs, high,
                        out _, out float tof, out float elev))
                { s.timeOfFlight = tof; s.elevationDeg = elev; }
            }

            // GATE D: which zone is struck at this range, and penetration vs that zone.
            // Plunging/indirect fire (steep descent) strikes the TOP (carapace -> deck analogue);
            // flat direct fire strikes the side/glacis (belt analogue). Range drives the table.
            bool plunging = s.indirect || s.elevationDeg > 30f;
            s.strikeZone = plunging ? HitZone.Carapace : FrontalOrFlank(shooter, target);
            var penTable = plunging ? sim.Db.HorPen : sim.Db.VerPen;
            if (gun.name != null) s.penetrationMm = penTable.Lookup(gun.caliberMm, s.rangeM);
            s.zoneArmourMm = target.Armor.Of(s.strikeZone) * target.ArmorQuality;
            s.willPenetrate = s.penetrationMm > s.zoneArmourMm;

            return s;
        }

        static HitZone FrontalOrFlank(MechaUnit shooter, MechaUnit target)
        {
            Vector3 toShot = (shooter.Position - target.Position); toShot.y = 0; toShot.Normalize();
            Vector3 fwd = target.Forward; fwd.y = 0; fwd.Normalize();
            float dot = Vector3.Dot(toShot, fwd);
            if (dot > 0.5f || dot < -0.5f) return HitZone.Glacis;       // front/rear -> glacis belt
            Vector3 right = Vector3.Cross(Vector3.up, fwd);
            return Vector3.Dot(toShot, right) > 0 ? HitZone.FlankR : HitZone.FlankL;
        }

        /// <summary>The stand-off / immunity band vs a given enemy weapon (RtW immunity zone).
        /// Returns (innerM, outerM): inside this band neither side plate nor top plate is defeated.
        /// inner = range beyond which side armour is safe; outer = range where plunging defeats top.</summary>
        public static (float inner, float outer, bool exists) ImmunityBand(BattleSim sim, MechaUnit target, GunDef enemyGun)
        {
            float sideArmour = target.Armor.Of(HitZone.Glacis) * target.ArmorQuality;
            float topArmour = target.Armor.Of(HitZone.Carapace) * target.ArmorQuality;

            // Inner edge: smallest range where VerPen drops to <= side armour.
            float inner = 0f; bool innerFound = false;
            for (float r = 200; r <= enemyGun.maxRangeM; r += 200)
            {
                if (sim.Db.VerPen.Lookup(enemyGun.caliberMm, r) <= sideArmour) { inner = r; innerFound = true; break; }
            }
            // Outer edge: smallest range where HorPen rises to > top armour.
            float outer = enemyGun.maxRangeM; bool outerFound = false;
            for (float r = 200; r <= enemyGun.maxRangeM; r += 200)
            {
                if (sim.Db.HorPen.Lookup(enemyGun.caliberMm, r) > topArmour) { outer = r; outerFound = true; break; }
            }
            bool exists = innerFound && (!outerFound || outer > inner);
            return (inner, outer, exists);
        }

        /// <summary>
        /// Suggest the best firing position for `shooter` to engage `target`: samples positions on
        /// the shooter's side of the target and scores them by — can I hit it (LOS + in my range),
        /// am I inside MY immunity band vs its gun, do I present a flank to it / can I flank it, and
        /// is the ground a touch elevated. Returns the best world position to move to.
        /// </summary>
        public static Vector3 BestEngagePosition(BattleSim sim, MechaUnit shooter, MechaUnit target)
        {
            var terrain = sim.Terrain;
            var myGun = shooter.Weapons.Count > 0 ? shooter.Weapons[0].def : default;
            var enemyGun = target.Weapons.Count > 0 ? target.Weapons[0].def : default;
            float myRange = myGun.name != null ? myGun.maxRangeM : 8000f;
            float effRange = Mathf.Min(myRange, 6000f);          // fight at an effective distance
            var (innerImm, outerImm, hasImm) = enemyGun.name != null
                ? ImmunityBand(sim, shooter, enemyGun) : (0f, 0f, false);

            Vector3 best = shooter.Position; float bestScore = float.MinValue;
            Vector3 toMe = (shooter.Position - target.Position); toMe.y = 0;
            float baseAng = Mathf.Atan2(toMe.x, toMe.z);

            for (int i = 0; i < 16; i++)
            {
                float ang = baseAng + (i - 8) * 0.22f;          // arc on our side of the target
                for (int rr = 0; rr < 3; rr++)
                {
                    float dist = effRange * (0.55f + rr * 0.2f);
                    float wx = target.Position.x + Mathf.Sin(ang) * dist;
                    float wz = target.Position.z + Mathf.Cos(ang) * dist;
                    if (!terrain.InBounds(new Vector3(wx, 0, wz))) continue;
                    float gy = terrain.HeightAt(wx, wz);
                    Vector3 cand = new Vector3(wx, gy, wz);
                    Vector3 eye = cand + Vector3.up * shooter.EyeHeight;
                    Vector3 tEye = target.EyePosition;

                    float score = 0f;
                    if (terrain.HasLineOfSight(eye, tEye)) score += 40f;       // can fire directly
                    score += (gy - terrain.Origin.y) * 0.12f;                  // high ground
                    // Inside MY immunity band vs the enemy gun = I'm safe at this range.
                    if (hasImm && dist >= innerImm && dist <= outerImm) score += 35f;
                    // Flanking: am I off the target's frontal arc (hitting its thinner flank)?
                    Vector3 toCand = (cand - target.Position); toCand.y = 0; toCand.Normalize();
                    float dotFwd = Vector3.Dot(toCand, target.Forward);
                    if (Mathf.Abs(dotFwd) < 0.5f) score += 15f;                // beam-on = flank
                    score -= Vector3.Distance(cand, shooter.Position) * 0.004f; // prefer nearer moves
                    if (score > bestScore) { bestScore = score; best = cand; }
                }
            }
            return best;
        }
    }
}
