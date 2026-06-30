// CITY BATTLE — HeightmapGen: procedural terrain for prototyping before real DEMs arrive.
// Produces a float[,] heightmap with hills/ridges/valleys so terrain-occluded LOS and
// defilade are immediately demonstrable. Deterministic (seeded). Replaceable by real
// city DEM data later (see terrain_pipeline/ and docs/TERRAIN_PIPELINE.md).
using UnityEngine;

namespace CityBattle.Terrain
{
    public static class HeightmapGen
    {
        /// <summary>
        /// Generate a heightmap of `size`x`size` samples. Layered value-noise + a couple of
        /// deliberate ridges so there is good defilade terrain for the vertical slice.
        /// </summary>
        public static float[,] Generate(int size, float maxHeight = 120f, uint seed = 1337)
        {
            var h = new float[size, size];
            var rng = new System.Random((int)seed);

            // Random gradient offsets per octave.
            float ox = (float)rng.NextDouble() * 1000f;
            float oz = (float)rng.NextDouble() * 1000f;

            for (int x = 0; x < size; x++)
            for (int z = 0; z < size; z++)
            {
                float nx = (float)x / size;
                float nz = (float)z / size;

                // Multi-octave value noise (Perlin) for rolling hills.
                float e = 0f, amp = 1f, freq = 2.5f, norm = 0f;
                for (int o = 0; o < 5; o++)
                {
                    e += amp * Mathf.PerlinNoise(ox + nx * freq, oz + nz * freq);
                    norm += amp;
                    amp *= 0.5f;
                    freq *= 2.07f;
                }
                e /= norm;

                // A diagonal ridge across the middle (great for hull-down / over-ridge fire).
                float ridge = RidgeBand(nx, nz, 0.55f, 0.10f) * 0.9f;
                // A second cross ridge.
                float ridge2 = RidgeBand(nz, nx, 0.30f, 0.07f) * 0.6f;

                // A central valley basin so units can hide in defilade.
                float bx = nx - 0.5f, bz = nz - 0.5f;
                float basin = -0.25f * Mathf.Exp(-(bx * bx + bz * bz) / 0.02f);

                float val = Mathf.Clamp01(e * 0.7f + ridge + ridge2 + basin + 0.15f);
                h[x, z] = val * maxHeight;
            }
            return h;
        }

        // A raised band centred on `center` (in the first axis) with given half-width.
        static float RidgeBand(float a, float b, float center, float halfWidth)
        {
            float d = Mathf.Abs(a - center);
            float t = Mathf.Clamp01(1f - d / halfWidth);
            // Smooth bump, modulated along the band so it's not a flat wall.
            float along = 0.6f + 0.4f * Mathf.PerlinNoise(b * 6f, center * 13f);
            return Mathf.SmoothStep(0f, 1f, t) * along;
        }
    }
}
