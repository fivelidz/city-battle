// CITY BATTLE — Ballistics: firing-solution maths and projectile integration.
// Real physics per docs/SIM.md 6: gravity + drag, low/high arc solutions, terrain impact.
using UnityEngine;

namespace CityBattle.Combat
{
    public static class Ballistics
    {
        public const float G = 9.81f;

        /// <summary>
        /// Solve launch elevation (radians) to hit a target at horizontal distance `range`
        /// and height difference `dh` (target.y - shooter.y) with muzzle speed `v`.
        /// Returns false if out of range. `high` selects the lobbed (indirect) arc.
        /// Vacuum solution (drag corrected separately) — good enough for FC display + aiming.
        /// </summary>
        public static bool SolveElevation(float v, float range, float dh, bool high, out float elevRad)
        {
            elevRad = 0f;
            if (range < 0.01f) { elevRad = Mathf.Sign(dh) * Mathf.PI / 2f; return true; }

            float v2 = v * v;
            float v4 = v2 * v2;
            float disc = v4 - G * (G * range * range + 2f * dh * v2);
            if (disc < 0f) return false;          // target out of ballistic range

            float root = Mathf.Sqrt(disc);
            float numer = high ? (v2 + root) : (v2 - root);
            elevRad = Mathf.Atan2(numer, G * range);
            return true;
        }

        /// <summary>Time of flight for a given launch elevation, speed, and horizontal range.</summary>
        public static float TimeOfFlight(float v, float elevRad, float range)
        {
            float vx = v * Mathf.Cos(elevRad);
            return vx > 0.01f ? range / vx : 0f;
        }

        /// <summary>Maximum flat-ground range for a muzzle speed (45 deg, vacuum).</summary>
        public static float MaxRange(float v) => v * v / G;

        /// <summary>
        /// Build a launch velocity vector (world) from shooter to target point, choosing arc.
        /// Returns false if unreachable.
        /// </summary>
        public static bool LaunchVelocity(Vector3 from, Vector3 to, float speed, bool high,
                                          out Vector3 vel, out float tof, out float elevDeg)
        {
            vel = Vector3.zero; tof = 0f; elevDeg = 0f;
            Vector3 flat = new Vector3(to.x - from.x, 0, to.z - from.z);
            float range = flat.magnitude;
            float dh = to.y - from.y;

            if (!SolveElevation(speed, range, dh, high, out float elev)) return false;

            Vector3 dir = range > 0.01f ? flat / range : Vector3.forward;
            float vx = speed * Mathf.Cos(elev);
            float vy = speed * Mathf.Sin(elev);
            vel = dir * vx + Vector3.up * vy;
            tof = TimeOfFlight(speed, elev, range);
            elevDeg = elev * Mathf.Rad2Deg;
            return true;
        }

        /// <summary>Descent angle (degrees below horizontal) of a velocity vector. Positive = falling.</summary>
        public static float DescentAngle(Vector3 vel)
        {
            float horiz = new Vector2(vel.x, vel.z).magnitude;
            return -Mathf.Atan2(vel.y, Mathf.Max(0.001f, horiz)) * Mathf.Rad2Deg;
        }
    }

    /// <summary>An in-flight shell. Integrated each sim tick by BattleSim.</summary>
    public class Projectile
    {
        public Vector3 Position;
        public Vector3 PrevPosition;
        public Vector3 Velocity;
        public float CaliberMm;
        public float MuzzleSpeed;
        public int FiringTeam;
        public Units.MechaUnit IntendedTarget;
        public float LaunchRange;          // horizontal range to aim point (for pen lookup)
        public bool Dead;
        // Quadratic drag coefficient (1/m). MUST be tiny: the firing solution is computed in
        // vacuum, so drag is only a small correction. A bug with drag=8e-4 here caused shells to
        // shed ~700 m/s^2 and fall hundreds of metres short. Larger calibres = better ballistic
        // coefficient = less drag. Set by BattleSim from calibre via DragFor().
        public float Drag = 2e-5f;

        public void Integrate(float dt)
        {
            PrevPosition = Position;
            float speed = Velocity.magnitude;
            // gravity + light quadratic drag (acceleration = -Drag * |v| * v)
            Vector3 a = Vector3.down * Ballistics.G - Velocity * (Drag * speed);
            Velocity += a * dt;
            Position += Velocity * dt;
        }
    }

    public static class DragModel
    {
        /// <summary>Quadratic drag coeff by calibre: bigger shell = sleeker = less drag.</summary>
        public static float DragFor(float caliberMm)
            => Mathf.Lerp(4e-5f, 8e-6f, Mathf.Clamp01((caliberMm - 20f) / 285f));
    }
}
