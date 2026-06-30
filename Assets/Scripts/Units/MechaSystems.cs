// CITY BATTLE — MechaSystems: localised, RtW3-style subsystem damage.
// In Rule the Waves a hit doesn't just chip a hitpoint bar — it can flood a compartment, knock
// out a turret, wreck the rudder, start a fire, or cause a magazine detonation, each with a
// distinct tactical consequence. There is no "sinking" on land, but a crab-mecha can be:
//   * IMMOBILISED  (legs shot out -> can't move, becomes a fixed gun)
//   * DISARMED      (turrets/mantlets knocked out -> can't shoot)
//   * BLINDED       (sensor cupola wrecked -> fire control collapses, can't spot/aim well)
//   * SET ABLAZE    (fires spread, causing ongoing internal damage unless controlled)
//   * GUTTED        (ammo cook-off / reactor breach -> catastrophic, the "magazine explosion")
// These are the meaningful kill states; a unit is "knocked out" when structurally destroyed OR
// fully mission-killed (immobilised + disarmed) - captured rather than literally sunk.
using System.Collections.Generic;
using UnityEngine;

namespace CityBattle.Units
{
    /// <summary>Discrete trackable subsystems, each mapped to one or more armour zones.</summary>
    public enum Subsystem
    {
        LegFL, LegFR, LegML, LegMR, LegRL, LegRR,   // up to 6 leg groups (crab gait)
        DriveTrain,                                  // powerpack / locomotion
        TurretMain,                                  // primary weapon mount
        TurretSecondary,
        SensorMast,                                  // fire-control / spotting cupola
        Datalink,                                    // networking (drone control, shared targeting)
        AmmoBay,                                     // magazine — can cook off
        Reactor                                      // powerplant — catastrophic if breached
    }

    public enum SubsystemStatus { Operational, Degraded, Disabled, Destroyed }

    public class SystemHealth
    {
        public Subsystem system;
        public float integrity = 1f;       // 1..0
        public SubsystemStatus Status =>
            integrity > 0.66f ? SubsystemStatus.Operational :
            integrity > 0.33f ? SubsystemStatus.Degraded :
            integrity > 0.01f ? SubsystemStatus.Disabled :
                                SubsystemStatus.Destroyed;
        public bool Functional => integrity > 0.33f;
    }

    /// <summary>
    /// The full systems state of one mecha. Owns the localised consequences of hits and the
    /// per-tick effects (fire spread, mobility recompute, ammo cook-off chance).
    /// </summary>
    public class MechaSystems
    {
        public readonly Dictionary<Subsystem, SystemHealth> Systems = new();

        public bool OnFire;
        public float FireIntensity;        // 0..1, grows if unchecked, drains structure
        public bool AmmoCookedOff;         // catastrophic flag
        public int LegGroups = 6;          // how many leg groups this chassis actually has

        public MechaSystems(int legGroups = 6, bool hasSecondary = true)
        {
            LegGroups = Mathf.Clamp(legGroups, 2, 6);
            var legs = new[] { Subsystem.LegFL, Subsystem.LegFR, Subsystem.LegML,
                               Subsystem.LegMR, Subsystem.LegRL, Subsystem.LegRR };
            for (int i = 0; i < LegGroups; i++) Add(legs[i]);
            Add(Subsystem.DriveTrain);
            Add(Subsystem.TurretMain);
            if (hasSecondary) Add(Subsystem.TurretSecondary);
            Add(Subsystem.SensorMast);
            Add(Subsystem.Datalink);
            Add(Subsystem.AmmoBay);
            Add(Subsystem.Reactor);
        }

        void Add(Subsystem s) => Systems[s] = new SystemHealth { system = s };

        public SystemHealth Get(Subsystem s) => Systems.TryGetValue(s, out var h) ? h : null;

        // ---- Derived mobility / firepower / sensors (read by MechaUnit) ----

        /// <summary>0..1 mobility from leg groups + drivetrain. Lose enough legs -> immobilised.</summary>
        public float MobilityFactor()
        {
            int total = 0, functional = 0;
            foreach (var kv in Systems)
            {
                if (!IsLeg(kv.Key)) continue;
                total++;
                if (kv.Value.Functional) functional++;
            }
            if (total == 0) return DriveFactor();
            float legFrac = (float)functional / total;
            // A crab can limp on most legs; below half it crawls; below a third it's pinned.
            float legMob = legFrac >= 0.66f ? 1f
                         : legFrac >= 0.5f ? 0.6f
                         : legFrac >= 0.34f ? 0.3f
                         : 0f;
            return legMob * DriveFactor();
        }

        float DriveFactor()
        {
            var d = Get(Subsystem.DriveTrain);
            if (d == null) return 1f;
            return d.Functional ? Mathf.Lerp(0.5f, 1f, d.integrity) : 0f;
        }

        public bool Immobilised => MobilityFactor() <= 0.01f;

        /// <summary>0..1 firepower from turret integrity. Both turrets gone -> disarmed.</summary>
        public float FirepowerFactor()
        {
            var m = Get(Subsystem.TurretMain);
            var s = Get(Subsystem.TurretSecondary);
            float main = m != null && m.Functional ? m.integrity : 0f;
            float sec = s != null && s.Functional ? s.integrity * 0.4f : 0f;
            return Mathf.Clamp01(main + sec);
        }

        public bool Disarmed => FirepowerFactor() <= 0.01f;

        /// <summary>0..1 fire control from sensor mast (drives accuracy + spotting range).</summary>
        public float FireControlFactor()
        {
            var s = Get(Subsystem.SensorMast);
            if (s == null) return 1f;
            return s.Functional ? Mathf.Lerp(0.25f, 1f, s.integrity) : 0.1f;
        }

        /// <summary>Datalink/comms-mast health (drone control, shared targeting, AND the comms relay).
        /// In CITY BATTLE comms are tight-beam/laser (line-of-sight): the datalink is the comms mast.</summary>
        public float DatalinkFactor()
        {
            var d = Get(Subsystem.Datalink);
            return d != null && d.Functional ? d.integrity : 0f;
        }

        /// <summary>Can this crab transmit/relay on the comms net? (Comms mast / datalink must work.)</summary>
        public bool CommsMastWorking => DatalinkFactor() > 0.2f;

        public bool Blinded => FireControlFactor() <= 0.2f;

        static bool IsLeg(Subsystem s) => s == Subsystem.LegFL || s == Subsystem.LegFR ||
            s == Subsystem.LegML || s == Subsystem.LegMR || s == Subsystem.LegRL || s == Subsystem.LegRR;

        // ---- Apply a penetrating hit at a zone (called from damage resolution) ----

        public struct DamageReport
        {
            public Subsystem system;
            public SubsystemStatus newStatus;
            public bool immobilisedNow, disarmedNow, blindedNow, fireStarted, ammoDetonation;
        }

        /// <summary>
        /// Resolve a penetrating hit on a hit-zone into subsystem damage with RtW3-style
        /// consequences. `severity` ~ residual penetration (mm over armour). rng deterministic.
        /// </summary>
        public DamageReport ApplyPenetration(HitZone zone, float severity, Sim.SimRandom rng)
        {
            var rep = new DamageReport();
            bool wasImmobile = Immobilised, wasDisarmed = Disarmed, wasBlind = Blinded;

            Subsystem target = PickSystemForZone(zone, rng);
            rep.system = target;
            var h = Get(target);
            if (h == null) return rep;

            float dmg = Mathf.Clamp01(severity / 250f) * rng.Range(0.4f, 1.0f);
            h.integrity = Mathf.Max(0f, h.integrity - dmg);
            rep.newStatus = h.Status;

            // Secondary consequences by zone/system.
            switch (target)
            {
                case Subsystem.AmmoBay:
                    // A deep penetration into the magazine risks cook-off (the "magazine explosion").
                    float cookChance = Mathf.Clamp01((severity - 80f) / 300f) * (1.2f - h.integrity);
                    if (rng.Chance(cookChance)) { AmmoCookedOff = true; rep.ammoDetonation = true; }
                    else if (rng.Chance(0.3f)) StartFire(rng, 0.4f);
                    break;
                case Subsystem.Reactor:
                    if (h.Status == SubsystemStatus.Destroyed && rng.Chance(0.5f))
                    { AmmoCookedOff = true; rep.ammoDetonation = true; } // reactor breach ~ catastrophic
                    else if (rng.Chance(0.4f)) StartFire(rng, 0.5f);
                    break;
                default:
                    // Any solid internal hit can start a fire.
                    if (rng.Chance(Mathf.Clamp01(severity / 400f))) { StartFire(rng, 0.25f); rep.fireStarted = OnFire; }
                    break;
            }

            rep.immobilisedNow = !wasImmobile && Immobilised;
            rep.disarmedNow = !wasDisarmed && Disarmed;
            rep.blindedNow = !wasBlind && Blinded;
            return rep;
        }

        Subsystem PickSystemForZone(HitZone zone, Sim.SimRandom rng)
        {
            switch (zone)
            {
                case HitZone.Legs:
                    return RandomLeg(rng);
                case HitZone.Cupola:
                    return rng.Chance(0.65f) ? Subsystem.SensorMast : Subsystem.Datalink;
                case HitZone.Mantlet:
                    return rng.Chance(0.7f) ? Subsystem.TurretMain : Subsystem.TurretSecondary;
                case HitZone.Carapace:
                    // Top hits reach internals: ammo, reactor, datalink, turret roofs.
                    float r = rng.NextFloat();
                    if (r < 0.30f) return Subsystem.AmmoBay;
                    if (r < 0.50f) return Subsystem.Reactor;
                    if (r < 0.70f) return Subsystem.TurretMain;
                    if (r < 0.85f) return Subsystem.Datalink;
                    return Subsystem.DriveTrain;
                case HitZone.Glacis:
                default:
                    // Frontal/flank belt hits: drivetrain, turret, ammo (lower chance), legs.
                    float g = rng.NextFloat();
                    if (g < 0.30f) return Subsystem.DriveTrain;
                    if (g < 0.55f) return Subsystem.TurretMain;
                    if (g < 0.70f) return RandomLeg(rng);
                    if (g < 0.85f) return Subsystem.AmmoBay;
                    return Subsystem.Reactor;
            }
        }

        Subsystem RandomLeg(Sim.SimRandom rng)
        {
            var legs = new List<Subsystem>();
            foreach (var kv in Systems) if (IsLeg(kv.Key)) legs.Add(kv.Key);
            return legs.Count > 0 ? legs[rng.RangeInt(0, legs.Count)] : Subsystem.DriveTrain;
        }

        void StartFire(Sim.SimRandom rng, float intensity)
        {
            OnFire = true;
            FireIntensity = Mathf.Max(FireIntensity, intensity);
        }

        // ---- Per-tick: fire spread + damage-control suppression ----

        /// <summary>Advance fires. Returns structural damage to apply this tick from fire.</summary>
        public float TickFire(float dt, float damageControl, Sim.SimRandom rng)
        {
            if (!OnFire) return 0f;
            // Damage control fights the fire; higher nation DC suppresses faster.
            float suppress = 0.05f * dt * Mathf.Max(0.5f, damageControl);
            float spread = 0.02f * dt;
            FireIntensity = Mathf.Clamp01(FireIntensity + spread - suppress);
            if (FireIntensity <= 0.02f) { OnFire = false; FireIntensity = 0f; return 0f; }
            // A live fire can spread to the ammo bay -> delayed cook-off.
            if (rng.Chance(FireIntensity * 0.02f * dt))
            {
                var ammo = Get(Subsystem.AmmoBay);
                if (ammo != null) ammo.integrity = Mathf.Max(0f, ammo.integrity - 0.1f);
                if (ammo != null && ammo.integrity <= 0.1f && rng.Chance(0.2f)) AmmoCookedOff = true;
            }
            return FireIntensity * 8f * dt; // structural attrition from burning
        }

        public string StatusLine()
        {
            var tags = new List<string>();
            if (Immobilised) tags.Add("IMMOBILE");
            if (Disarmed) tags.Add("DISARMED");
            if (Blinded) tags.Add("BLIND");
            if (OnFire) tags.Add($"FIRE {FireIntensity*100:0}%");
            if (AmmoCookedOff) tags.Add("AMMO!!");
            return tags.Count > 0 ? string.Join(" ", tags) : "NOMINAL";
        }
    }
}
