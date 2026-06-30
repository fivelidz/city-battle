// CITY BATTLE — TerrainField: the simulation's view of the ground.
// Wraps a heightmap (float[,] in metres) sampled in WORLD space, giving O(1) height
// lookups and the analytic ray-march line-of-sight that underpins terrain-occluded combat.
// See docs/SIM.md section 5. This is sim-side and Unity-Terrain-independent (testable headless).
using UnityEngine;

namespace CityBattle.Terrain
{
    public class TerrainField
    {
        public readonly int Width;        // samples in X
        public readonly int Length;       // samples in Z
        public readonly float CellSize;   // world metres between samples
        public readonly Vector3 Origin;   // world position of sample [0,0]
        readonly float[,] _height;        // [x,z] metres

        /// <summary>World Y of the water surface (sea level). Terrain below this is water.</summary>
        public float WaterLevelM = float.NegativeInfinity;   // -inf = no water by default

        public float WorldWidth => (Width - 1) * CellSize;
        public float WorldLength => (Length - 1) * CellSize;

        /// <summary>True if the ground at (x,z) is below the water surface.</summary>
        public bool IsWater(float worldX, float worldZ) => HeightAt(worldX, worldZ) < WaterLevelM;
        /// <summary>Water depth (metres) at (x,z); 0 on dry land.</summary>
        public float WaterDepthAt(float worldX, float worldZ)
            => Mathf.Max(0f, WaterLevelM - HeightAt(worldX, worldZ));

        public TerrainField(float[,] height, float cellSize, Vector3 origin)
        {
            _height = height;
            Width = height.GetLength(0);
            Length = height.GetLength(1);
            CellSize = cellSize;
            Origin = origin;
        }

        /// <summary>Bilinearly-interpolated terrain height (world Y) at world (x,z). O(1).</summary>
        public float HeightAt(float worldX, float worldZ)
        {
            float fx = (worldX - Origin.x) / CellSize;
            float fz = (worldZ - Origin.z) / CellSize;

            int x0 = Mathf.Clamp(Mathf.FloorToInt(fx), 0, Width - 1);
            int z0 = Mathf.Clamp(Mathf.FloorToInt(fz), 0, Length - 1);
            int x1 = Mathf.Min(x0 + 1, Width - 1);
            int z1 = Mathf.Min(z0 + 1, Length - 1);

            float tx = Mathf.Clamp01(fx - x0);
            float tz = Mathf.Clamp01(fz - z0);

            float h00 = _height[x0, z0];
            float h10 = _height[x1, z0];
            float h01 = _height[x0, z1];
            float h11 = _height[x1, z1];

            float h0 = Mathf.Lerp(h00, h10, tx);
            float h1 = Mathf.Lerp(h01, h11, tx);
            return Origin.y + Mathf.Lerp(h0, h1, tz);
        }

        public float HeightAt(Vector3 world) => HeightAt(world.x, world.z);

        public Vector3 ClampToGround(Vector3 world)
        {
            world.y = HeightAt(world.x, world.z);
            return world;
        }

        /// <summary>
        /// Analytic terrain line-of-sight (docs/SIM.md 5.1). Returns true if the straight
        /// segment from `from` to `to` (world, including eye/target heights in .y) is NOT
        /// blocked by terrain. Pure heightmap ray-march — microseconds, no physics.
        /// </summary>
        public bool HasLineOfSight(Vector3 from, Vector3 to, float clearance = 0f)
        {
            Vector3 d = to - from;
            float horiz = new Vector2(d.x, d.z).magnitude;
            if (horiz < 1e-3f) return true;

            int steps = Mathf.Max(2, Mathf.CeilToInt(horiz / CellSize));
            for (int i = 1; i < steps; i++)
            {
                float t = (float)i / steps;
                float wx = from.x + d.x * t;
                float wz = from.z + d.z * t;
                float rayY = from.y + d.y * t;             // straight sight ray height
                float groundY = HeightAt(wx, wz);
                if (groundY > rayY + clearance) return false; // terrain pokes above the ray
            }
            return true;
        }

        /// <summary>
        /// First terrain-impact point along a ray (used for ballistic ground hits and to find
        /// where LOS is broken). Returns true and sets `hit` if the ray descends into terrain.
        /// </summary>
        public bool RaycastTerrain(Vector3 origin, Vector3 dir, float maxDist, out Vector3 hit)
        {
            hit = origin;
            dir.Normalize();
            float step = CellSize * 0.5f;
            float prevDelta = origin.y - HeightAt(origin.x, origin.z);
            for (float d = step; d <= maxDist; d += step)
            {
                Vector3 p = origin + dir * d;
                float delta = p.y - HeightAt(p.x, p.z);
                if (delta <= 0f)
                {
                    // Linear interpolate the crossing for a tidy impact point.
                    float frac = prevDelta / (prevDelta - delta);
                    hit = origin + dir * (d - step + step * Mathf.Clamp01(frac));
                    hit.y = HeightAt(hit.x, hit.z);
                    return true;
                }
                prevDelta = delta;
            }
            return false;
        }

        public bool InBounds(Vector3 world)
        {
            float fx = world.x - Origin.x;
            float fz = world.z - Origin.z;
            return fx >= 0 && fz >= 0 && fx <= WorldWidth && fz <= WorldLength;
        }
    }
}
