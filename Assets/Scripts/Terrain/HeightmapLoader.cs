// CITY BATTLE -- HeightmapLoader: ingest a real-world city heightmap (produced by
// terrain_pipeline/) into the float[,] heights TerrainBuilder/TerrainField consume.
// This lets the game run on actual SF/Sydney/etc. terrain instead of procedural noise.
//
// Two entry points:
//   LoadRaw(path, resolution, maxHeightMeters)      -- 16-bit little-endian .raw on disk
//   LoadFromTexture(tex, maxHeightMeters)           -- a 16-bit / grayscale Texture2D
//
// Output convention matches TerrainField: float[,] indexed [x, z], x = east,
// z = north, value = metres above the terrain's local zero. Multiply normalised
// 0..1 heightmap samples by maxHeightMeters (use size_height_m from {city}_meta.json).
//
// Dependency-light: pure UnityEngine + System.IO, compiles under Unity 6, no editor APIs.
using System.IO;
using UnityEngine;

namespace CityBattle.Terrain
{
    public static class HeightmapLoader
    {
        /// <summary>
        /// Load a 16-bit little-endian RAW heightmap (Unity "Import Raw" format) from disk
        /// into a float[,] of metres, indexed [x, z] to match TerrainField.
        /// </summary>
        /// <param name="path">Absolute or project-relative path to the .raw file.</param>
        /// <param name="resolution">Samples per side (e.g. 513, 1025). File must be
        /// resolution*resolution 16-bit values.</param>
        /// <param name="maxHeightMeters">Vertical span in metres mapped to full-scale
        /// (65535). Use size_height_m from {city}_meta.json.</param>
        public static float[,] LoadRaw(string path, int resolution, float maxHeightMeters)
        {
            if (!File.Exists(path))
            {
                Debug.LogError("HeightmapLoader.LoadRaw: file not found: " + path);
                return null;
            }

            int expected = resolution * resolution * 2; // 2 bytes per 16-bit sample
            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length < expected)
            {
                Debug.LogError("HeightmapLoader.LoadRaw: file too small. Expected " +
                               expected + " bytes for " + resolution + "x" + resolution +
                               " 16-bit, got " + bytes.Length + ".");
                return null;
            }

            float[,] heights = new float[resolution, resolution]; // [x, z]
            float inv = maxHeightMeters / 65535f;

            // RAW is row-major: rows run along Z (north), columns along X (east).
            // We read row r (z) then column c (x). Little-endian: low byte first.
            int i = 0;
            for (int z = 0; z < resolution; z++)
            {
                for (int x = 0; x < resolution; x++)
                {
                    int lo = bytes[i];
                    int hi = bytes[i + 1];
                    i += 2;
                    ushort raw = (ushort)(lo | (hi << 8)); // little-endian decode
                    heights[x, z] = raw * inv;
                }
            }
            return heights;
        }

        /// <summary>
        /// Read a Texture2D's grayscale heightmap into a float[,] of metres, indexed [x, z].
        /// Works with the 16-bit PNG produced by the pipeline (imported as a readable
        /// texture) or any standard grayscale texture. Uses the red channel as height.
        /// </summary>
        /// <param name="tex">A readable texture (Read/Write Enabled in import settings).</param>
        /// <param name="maxHeightMeters">Vertical span mapped to full-scale (1.0 in the
        /// normalised colour). Use size_height_m from {city}_meta.json.</param>
        public static float[,] LoadFromTexture(Texture2D tex, float maxHeightMeters)
        {
            if (tex == null)
            {
                Debug.LogError("HeightmapLoader.LoadFromTexture: texture is null.");
                return null;
            }
            if (tex.width != tex.height)
            {
                Debug.LogWarning("HeightmapLoader.LoadFromTexture: non-square texture (" +
                                 tex.width + "x" + tex.height + "); using min side.");
            }

            int res = Mathf.Min(tex.width, tex.height);
            float[,] heights = new float[res, res]; // [x, z]

            // GetPixel returns colour with channels normalised to 0..1; for a 16-bit
            // single-channel import Unity expands the value into the float colour, so the
            // red channel already carries full 16-bit precision. Texture row 0 is the
            // bottom (south) in Unity's UV convention, matching our z = north indexing.
            for (int z = 0; z < res; z++)
            {
                for (int x = 0; x < res; x++)
                {
                    float norm = tex.GetPixel(x, z).r; // 0..1
                    heights[x, z] = norm * maxHeightMeters;
                }
            }
            return heights;
        }
    }
}
