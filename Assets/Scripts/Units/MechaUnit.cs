// CITY BATTLE — MechaUnit: a crab-mecha on the battlefield.
// Holds sim state (position, orders, armour, weapons), is advanced by BattleSim each tick,
// and exposes interpolation hooks for smooth rendering at >SIM_HZ.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;

namespace CityBattle.Units
{
    public enum FireMode { Hold, Direct, Indirect }

    [System.Serializable]
    public class WeaponInstance
    {
        public GunDef def;
        public float cooldown;            // seconds until next shot allowed
        public int mountSocket;           // which chassis socket this gun sits on

        public bool Ready => cooldown <= 0f;
        public void Tick(float dt) { if (cooldown > 0f) cooldown -= dt; }
        public void FireReset() => cooldown = def.ReloadSeconds;
    }

    public class MechaUnit
    {
        // ---- Identity ----
        public int Id;
        public string Name;
        public int Team;                  // 0 = player, 1 = enemy
        public ChassisDef Chassis;
        public ArmorScheme Armor;
        public ArmorDef ArmorMaterial;
        public NationDef Nation;
        public List<WeaponInstance> Weapons = new();
        public List<EwDef> EwModules = new();          // jammers, laser-CUAS, charge bays, etc.

        // ---- Sim state ----
        public Vector3 Position;          // world, .y clamped to ground
        public Vector3 PrevPosition;      // for render interpolation
        public float HeadingDeg;          // facing (Y)
        public float PrevHeadingDeg;
        public Vector3 Velocity;
        public bool Moving;
        public bool HullDown;             // defilade stance: only carapace exposed

        // ---- Orders ----
        public bool HasMoveOrder;
        public Vector3 MoveTarget;
        public readonly List<Vector3> Waypoints = new();   // queued waypoints (SHIFT-chained)
        public MechaUnit FireTarget;
        public FireMode Fire = FireMode.Hold;

        public void SetMove(Vector3 dest) { Waypoints.Clear(); MoveTarget = dest; HasMoveOrder = true; }
        public void QueueMove(Vector3 dest)
        {
            if (!HasMoveOrder) { MoveTarget = dest; HasMoveOrder = true; }
            else Waypoints.Add(dest);
        }
        public void StopMove() { Waypoints.Clear(); HasMoveOrder = false; }

        // ---- Condition ----
        public float Structure = 100f;    // overall structural integrity
        public MechaSystems Sys;          // localised subsystem damage (RtW3-style)

        // Derived condition (read from the subsystem model; fall back to 1 if not yet built).
        public float Mobility => Sys?.MobilityFactor() ?? 1f;
        public float FireControlHealth => Sys?.FireControlFactor() ?? 1f;
        public bool Immobilised => Sys?.Immobilised ?? false;
        public bool Disarmed => Sys?.Disarmed ?? false;
        public bool Blinded => Sys?.Blinded ?? false;

        // A unit is out of action if structurally destroyed OR fully mission-killed.
        public bool Alive => Structure > 0f && !(Sys?.AmmoCookedOff ?? false);
        public bool MissionKilled => !Alive || (Immobilised && Disarmed);
        public bool CanMove => !Immobilised && Alive;
        public bool CanShoot => !Disarmed && Alive;

        // ---- Vision ----
        public float BaseSightRange = 4000f;  // metres on flat ground (terrain extends/limits)
        public float EyeHeight = 6f;          // metres above ground (chassis height)

        public Vector3 Forward => Quaternion.Euler(0, HeadingDeg, 0) * Vector3.forward;
        public Vector3 EyePosition => Position + Vector3.up * EyeHeight;

        // ---- Derived stats with nation modifiers ----
        public float Accuracy => (Nation.accuracy <= 0 ? 1f : Nation.accuracy) * FireControlHealth;
        public float ArmorQuality => (Nation.armorQuality <= 0 ? 1f : Nation.armorQuality)
                                     * (ArmorMaterial.qualityFactor <= 0 ? 1f : ArmorMaterial.qualityFactor);
        public float SpeedMs => Chassis.BaseSpeedMs * Mathf.Clamp01(Mobility);

        // ---- Movement (called by sim) ----
        public void TickMovement(TerrainField terrain, float dt)
        {
            PrevPosition = Position;
            PrevHeadingDeg = HeadingDeg;

            // Immobilised mechs cannot move (legs/drive shot out) — they fight as fixed guns.
            if (!HasMoveOrder || !CanMove) { Moving = false; Velocity = Vector3.zero; return; }

            Vector3 flatPos = new Vector3(Position.x, 0, Position.z);
            Vector3 flatTgt = new Vector3(MoveTarget.x, 0, MoveTarget.z);
            Vector3 to = flatTgt - flatPos;
            float dist = to.magnitude;

            if (dist < 2f)
            {
                if (Waypoints.Count > 0)
                {
                    MoveTarget = Waypoints[0];   // advance to next chained waypoint
                    Waypoints.RemoveAt(0);
                }
                else { HasMoveOrder = false; Moving = false; Velocity = Vector3.zero; }
                return;
            }

            Vector3 dir = to / dist;
            // Turn toward target at chassis turn rate.
            float desired = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            HeadingDeg = Mathf.MoveTowardsAngle(HeadingDeg, desired, Chassis.turnRateDps * dt);

            // Only advance once roughly facing the target (crabs pivot then walk).
            float facingErr = Mathf.Abs(Mathf.DeltaAngle(HeadingDeg, desired));
            float speed = SpeedMs * (facingErr < 30f ? 1f : 0.25f);

            // Slope slows movement (uphill penalty).
            float step = Mathf.Min(speed * dt, dist);
            Vector3 next = flatPos + dir * step;
            float groundNext = terrain.HeightAt(next.x, next.z);
            float groundNow = terrain.HeightAt(Position.x, Position.z);
            float slope = (groundNext - groundNow) / Mathf.Max(step, 0.001f);
            if (slope > 0.3f) next = flatPos + dir * step * Mathf.Clamp01(1f - (slope - 0.3f)); // uphill drag

            Position = new Vector3(next.x, groundNext, next.z);
            Velocity = (Position - PrevPosition) / dt;
            Moving = Velocity.sqrMagnitude > 0.01f;
        }

        public void TickWeapons(float dt)
        {
            foreach (var w in Weapons) w.Tick(dt);
        }

        /// <summary>Interpolated render transform between prev and current sim state.</summary>
        public Vector3 RenderPosition(float alpha) => Vector3.Lerp(PrevPosition, Position, alpha);
        public float RenderHeading(float alpha) => Mathf.LerpAngle(PrevHeadingDeg, HeadingDeg, alpha);

        /// <summary>Effective sight range: elevation helps, a wrecked sensor mast hurts.</summary>
        public float EffectiveSightRange(TerrainField terrain)
        {
            float h = Mathf.Max(0f, Position.y - terrain.Origin.y);
            float fc = FireControlHealth;                 // blinded units see much less
            return (BaseSightRange + Mathf.Sqrt(Mathf.Max(0f, h)) * 350f) * Mathf.Lerp(0.4f, 1f, fc);
        }

        // ---- Damage ----

        public void EnsureSystems()
        {
            if (Sys == null)
            {
                int legGroups = Chassis.numLegs > 0 ? Mathf.Clamp(Chassis.numLegs / 2, 2, 6) : 4;
                bool hasSecondary = Weapons.Count > 1 || Chassis.numWeaponMounts > 1;
                Sys = new MechaSystems(legGroups, hasSecondary);
            }
        }

        /// <summary>
        /// Resolve a PENETRATING hit. Routes to localised subsystem damage (RtW3-style: leg
        /// immobilisation, turret KO, sensor blind, fires, ammo cook-off) and applies structural
        /// attrition. Returns the systems report for fx/log/AI. penResidual = pen - armour (mm).
        /// </summary>
        public MechaSystems.DamageReport ApplyDamage(HitZone zone, float penResidual, Sim.SimRandom rng)
        {
            EnsureSystems();
            float dc = Nation.damageControl <= 0 ? 1f : Nation.damageControl;

            var report = Sys.ApplyPenetration(zone, penResidual, rng);

            // Structural attrition scales with residual penetration, reduced by damage control.
            float dmg = Mathf.Clamp(penResidual * 0.22f, 2f, 45f) / dc;
            if (zone == HitZone.Carapace) dmg *= 1.15f;  // top hits reach the guts
            Structure -= dmg;

            if (report.ammoDetonation) Structure = 0f;   // catastrophic — knocked out
            if (Structure < 0f) Structure = 0f;
            return report;
        }

        /// <summary>Back-compat overload (deterministic stream supplied by caller is preferred).</summary>
        public void ApplyDamage(HitZone zone, float penResidual)
            => ApplyDamage(zone, penResidual, new Sim.SimRandom((uint)(Id * 2654435761u + 1u)));

        /// <summary>Light non-penetrating spall/shock to structure.</summary>
        public void ApplyShock(float amount) { Structure = Mathf.Max(0f, Structure - amount); }

        /// <summary>Per-tick subsystem upkeep: advance fires, apply burn damage.</summary>
        public void TickSystems(float dt, Sim.SimRandom rng)
        {
            if (Sys == null) return;
            float dc = Nation.damageControl <= 0 ? 1f : Nation.damageControl;
            float burn = Sys.TickFire(dt, dc, rng);
            if (burn > 0f) Structure = Mathf.Max(0f, Structure - burn);
            if (Sys.AmmoCookedOff) Structure = 0f;
        }
    }
}
