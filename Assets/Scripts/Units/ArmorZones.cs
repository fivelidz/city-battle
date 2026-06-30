// CITY BATTLE — armour zone model (per docs/DESIGN.md 3.3).
// A mecha's protection is tracked per LOCATION; penetration is resolved against the zone hit.
using UnityEngine;

namespace CityBattle.Units
{
    public enum HitZone
    {
        Carapace,   // top/deck  -> vs plunging/indirect fire
        Glacis,     // frontal belt -> vs direct fire from the front
        FlankL,     // left side belt
        FlankR,     // right side belt
        Legs,       // actuators -> mobility kill
        Cupola,     // sensor/command -> fire-control kill
        Mantlet     // gun shield (per-weapon, simplified to one here)
    }

    [System.Serializable]
    public struct ArmorScheme
    {
        // Armour thickness in mm per zone.
        public float carapace;
        public float glacis;
        public float flank;     // applied to both flanks
        public float legs;
        public float cupola;
        public float mantlet;

        public float Of(HitZone z) => z switch
        {
            HitZone.Carapace => carapace,
            HitZone.Glacis => glacis,
            HitZone.FlankL => flank,
            HitZone.FlankR => flank,
            HitZone.Legs => legs,
            HitZone.Cupola => cupola,
            HitZone.Mantlet => mantlet,
            _ => glacis
        };

        /// <summary>A reasonable "dreadnought crab" default scheme for the slice.</summary>
        public static ArmorScheme Dreadnought => new ArmorScheme
        {
            carapace = 60f, glacis = 220f, flank = 150f, legs = 70f, cupola = 120f, mantlet = 180f
        };

        public static ArmorScheme Skirmisher => new ArmorScheme
        {
            carapace = 25f, glacis = 80f, flank = 55f, legs = 35f, cupola = 50f, mantlet = 60f
        };
    }

    public static class ZoneGeometry
    {
        /// <summary>
        /// Pick which zone an incoming shot strikes, from the impact direction relative to the
        /// target's facing and the shot's descent angle (steep = plunging onto the carapace).
        /// </summary>
        public static HitZone ResolveZone(
            Vector3 targetForward, Vector3 targetPos, Vector3 shotFrom, float descentDeg,
            Sim.SimRandom rng)
        {
            // Plunging fire hits the top.
            if (descentDeg > 45f)
                return rng.Chance(0.7f) ? HitZone.Carapace : HitZone.Cupola;

            Vector3 toShot = (shotFrom - targetPos); toShot.y = 0; toShot.Normalize();
            Vector3 fwd = targetForward; fwd.y = 0; fwd.Normalize();
            Vector3 right = Vector3.Cross(Vector3.up, fwd);

            float dotFwd = Vector3.Dot(toShot, fwd);   // +1 = shot from front
            float dotRight = Vector3.Dot(toShot, right);

            // Small chance of leg/cupola incidental hits.
            float roll = rng.NextFloat();
            if (roll < 0.10f) return HitZone.Legs;
            if (roll < 0.14f) return HitZone.Cupola;
            if (roll < 0.20f) return HitZone.Mantlet;

            if (dotFwd > 0.5f) return HitZone.Glacis;
            if (dotFwd < -0.5f) return HitZone.Glacis;       // rear simplified to glacis-equiv for now
            return dotRight > 0 ? HitZone.FlankR : HitZone.FlankL;
        }
    }
}
