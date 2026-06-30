// CITY BATTLE — TerrainBuilder: turns a sim TerrainField into a renderable+collidable mesh.
// Two sources: procedural noise (instant, for prototyping) OR a real city DEM heightmap
// (.raw in StreamingAssets, produced by terrain_pipeline/). The same heightmap drives both the
// visual mesh and the sim's O(1) height/LOS queries.
using System.IO;
using UnityEngine;

namespace CityBattle.Terrain
{
    public enum TerrainSource { Procedural, RealDem }

    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class TerrainBuilder : MonoBehaviour
    {
        [Header("Source")]
        public TerrainSource Source = TerrainSource.Procedural;
        [Tooltip("StreamingAssets-relative path, e.g. Terrain/san_francisco_height.raw")]
        public string DemRawPath = "Terrain/san_francisco_height.raw";
        public int DemResolution = 513;
        public float DemMaxHeightM = 277f;     // size_height_m from {city}_meta.json
        public float DemCellSize = 11.15f;     // size_width_m / (resolution-1)

        [Header("Generation (procedural)")]
        public int Resolution = 192;        // samples per side
        public float CellSize = 12f;        // metres between samples (192*12 ~ 2.3 km map)
        public float MaxHeight = 140f;
        public uint Seed = 1337;

        [Header("Look")]
        public Material TerrainMaterial;
        public Gradient HeightTint;

        public TerrainField Field { get; private set; }

        public TerrainField Build()
        {
            float[,] hm;
            float cell;
            if (Source == TerrainSource.RealDem && TryLoadDem(out hm, out cell))
            {
                Resolution = hm.GetLength(0);
                MaxHeight = DemMaxHeightM;
                CellSize = cell;
            }
            else
            {
                hm = HeightmapGen.Generate(Resolution, MaxHeight, Seed);
                cell = CellSize;
            }
            Field = new TerrainField(hm, cell, transform.position);
            BuildMesh(hm);
            var mr0 = GetComponent<MeshRenderer>();
            Debug.Log($"[TerrainBuilder] built {Resolution}x{Resolution} src={Source} maxH={MaxHeight} " +
                      $"mat={(mr0.sharedMaterial!=null?mr0.sharedMaterial.shader.name:"NULL")} " +
                      $"sampleColor={(GetComponent<MeshFilter>().sharedMesh.colors.Length>0?GetComponent<MeshFilter>().sharedMesh.colors[Resolution*Resolution/2].ToString():"none")}");
            return Field;
        }

        bool TryLoadDem(out float[,] hm, out float cell)
        {
            hm = null; cell = DemCellSize;
            string path = Path.Combine(Application.streamingAssetsPath, DemRawPath);
            if (!File.Exists(path))
            {
                Debug.LogWarning($"[TerrainBuilder] DEM not found at {path}; using procedural.");
                return false;
            }
            hm = HeightmapLoader.LoadRaw(path, DemResolution, DemMaxHeightM);
            return hm != null;
        }

        void BuildMesh(float[,] hm)
        {
            int n = Resolution;
            var verts = new Vector3[n * n];
            var uvs = new Vector2[n * n];
            var colors = new Color[n * n];
            var tris = new int[(n - 1) * (n - 1) * 6];

            for (int x = 0; x < n; x++)
            for (int z = 0; z < n; z++)
            {
                int idx = x + z * n;
                float y = hm[x, z];
                verts[idx] = new Vector3(x * CellSize, y, z * CellSize);
                uvs[idx] = new Vector2((float)x / (n - 1), (float)z / (n - 1));
                float t = Mathf.Clamp01(y / MaxHeight);

                // Dark, saturated, high-contrast elevation palette so terrain reads at a glance:
                // deep valley green -> grass -> earth -> rock -> snow cap.
                // (We deliberately ignore the serialized HeightTint Gradient: an unset Unity
                //  Gradient defaults to WHITE and was washing the whole map out.)
                Color baseCol;
                {
                    Color c0 = new Color(0.07f, 0.16f, 0.09f);   // valley
                    Color c1 = new Color(0.16f, 0.30f, 0.12f);   // grass
                    Color c2 = new Color(0.34f, 0.30f, 0.14f);   // earth
                    Color c3 = new Color(0.34f, 0.30f, 0.27f);   // rock
                    Color c4 = new Color(0.70f, 0.72f, 0.72f);   // snow/light rock
                    if (t < 0.25f) baseCol = Color.Lerp(c0, c1, t / 0.25f);
                    else if (t < 0.5f) baseCol = Color.Lerp(c1, c2, (t - 0.25f) / 0.25f);
                    else if (t < 0.78f) baseCol = Color.Lerp(c2, c3, (t - 0.5f) / 0.28f);
                    else baseCol = Color.Lerp(c3, c4, (t - 0.78f) / 0.22f);
                }

                // Slope shading: darken steep faces (reads the relief much better).
                float hx = hm[Mathf.Min(x + 1, n - 1), z] - hm[Mathf.Max(x - 1, 0), z];
                float hz = hm[x, Mathf.Min(z + 1, n - 1)] - hm[x, Mathf.Max(z - 1, 0)];
                float slope = Mathf.Clamp01(new Vector2(hx, hz).magnitude / (CellSize * 1.2f));
                baseCol *= Mathf.Lerp(1f, 0.45f, slope);

                // Contour banding every ~25 m for height legibility (darker line).
                float band = Mathf.Repeat(y / 25f, 1f);
                if (band < 0.05f) baseCol *= 0.7f;

                baseCol.a = 1f;
                colors[idx] = baseCol;
            }

            int ti = 0;
            for (int x = 0; x < n - 1; x++)
            for (int z = 0; z < n - 1; z++)
            {
                int i = x + z * n;
                tris[ti++] = i;
                tris[ti++] = i + n;
                tris[ti++] = i + 1;
                tris[ti++] = i + 1;
                tris[ti++] = i + n;
                tris[ti++] = i + n + 1;
            }

            var mesh = new Mesh { name = "CityBattleTerrain" };
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.vertices = verts;
            mesh.uv = uvs;
            mesh.colors = colors;
            mesh.triangles = tris;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            GetComponent<MeshFilter>().sharedMesh = mesh;
            var mr = GetComponent<MeshRenderer>();
            if (TerrainMaterial != null) mr.sharedMaterial = TerrainMaterial;

            var mc = GetComponent<MeshCollider>();
            if (mc == null) mc = gameObject.AddComponent<MeshCollider>();
            mc.sharedMesh = mesh;
        }
    }
}
