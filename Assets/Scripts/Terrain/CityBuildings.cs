// CITY BATTLE -- CityBuildings: procedurally extrude OSM building footprints onto the
// terrain as cover/occluder meshes. Reads out/{city}_buildings.json (produced by
// terrain_pipeline/fetch_buildings.py) from StreamingAssets and builds box prisms whose
// base sits on the TerrainField under each footprint centroid and whose top is base+height.
//
// The JSON is a list of { "polygon": [[x_m, z_m], ...], "height_m": <float> } in LOCAL
// METRES, x=east (Unity +X), z=north (Unity +Z) -- the same local frame as the heightmap.
// Buildings are placed in terrain-local space and parented under this GameObject, so set
// this object's transform to the terrain origin (e.g. share TerrainBuilder's transform).
//
// Buildings are occluders: each gets a MeshCollider so line-of-sight raycasts and physics
// treat them as solid cover. For very dense cities the footprints are batched into a small
// number of combined meshes (UInt32 index, capped chunks) to keep GameObject/draw counts sane.
//
// Dependency-light: pure UnityEngine + System.IO, Unity 6 / URP compatible, no editor APIs.
// Pure ASCII.
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace CityBattle.Terrain
{
    public class CityBuildings : MonoBehaviour
    {
        [Header("Source")]
        [Tooltip("StreamingAssets-relative path, e.g. Terrain/san_francisco_buildings.json")]
        public string BuildingsJsonPath = "Terrain/san_francisco_buildings.json";

        [Header("Look / placement")]
        public Material BuildingMaterial;
        [Tooltip("Sink building bases this many metres into the ground to avoid gaps on slopes.")]
        public float FoundationSinkM = 1.0f;
        [Tooltip("Skip footprints whose bounding box is smaller than this (metres). 0 = keep all.")]
        public float MinFootprintM = 0f;
        [Tooltip("Default height (m) if a record has a non-positive height.")]
        public float DefaultHeightM = 8f;

        [Header("Batching")]
        [Tooltip("Max vertices per combined mesh chunk (UInt32 indices, stays well under limits).")]
        public int MaxVertsPerChunk = 60000;

        // Lightweight JSON record (matches the Python output schema).
        [System.Serializable]
        class BuildingRec
        {
            public float[][] polygon; // [ [x,z], ... ]
            public float height_m;
        }

        public int BuildingCount { get; private set; }
        public int ChunkCount { get; private set; }

        /// <summary>
        /// Read {city}_buildings.json from StreamingAssets and generate extruded building
        /// meshes as child GameObjects, with bases sampled from the supplied terrain.
        /// </summary>
        public void BuildFromJson(string streamingAssetsRelativePath, TerrainField terrain)
        {
            string path = Path.Combine(Application.streamingAssetsPath, streamingAssetsRelativePath);
            if (!File.Exists(path))
            {
                Debug.LogWarning("[CityBuildings] buildings JSON not found at " + path + "; skipping.");
                return;
            }

            string json = File.ReadAllText(path);
            List<BuildingRec> recs = ParseBuildings(json);
            if (recs == null || recs.Count == 0)
            {
                Debug.LogWarning("[CityBuildings] no buildings parsed from " + path + ".");
                return;
            }

            ClearChildren();
            BuildMeshes(recs, terrain);

            Debug.Log("[CityBuildings] built " + BuildingCount + " buildings in " +
                      ChunkCount + " mesh chunk(s) from " + streamingAssetsRelativePath);
        }

        /// <summary>Convenience overload using the serialized BuildingsJsonPath field.</summary>
        public void BuildFromJson(TerrainField terrain)
        {
            BuildFromJson(BuildingsJsonPath, terrain);
        }

        void BuildMeshes(List<BuildingRec> recs, TerrainField terrain)
        {
            BuildingCount = 0;
            ChunkCount = 0;

            // Working buffers for the current chunk.
            var verts = new List<Vector3>(MaxVertsPerChunk);
            var tris = new List<int>(MaxVertsPerChunk * 3);

            for (int r = 0; r < recs.Count; r++)
            {
                BuildingRec rec = recs[r];
                float[][] poly = rec.polygon;
                if (poly == null || poly.Length < 3) continue;

                if (MinFootprintM > 0f && FootprintSpan(poly) < MinFootprintM) continue;

                float height = rec.height_m > 0f ? rec.height_m : DefaultHeightM;

                // If adding this building would overflow the chunk, flush first.
                int needed = poly.Length * 2;
                if (verts.Count + needed > MaxVertsPerChunk && verts.Count > 0)
                {
                    FlushChunk(verts, tris);
                }

                AppendBuilding(poly, height, terrain, verts, tris);
                BuildingCount++;
            }

            if (verts.Count > 0) FlushChunk(verts, tris);
        }

        // Append one extruded prism (side walls + flat top cap) into the chunk buffers.
        void AppendBuilding(float[][] poly, float height, TerrainField terrain,
                            List<Vector3> verts, List<int> tris)
        {
            int m = poly.Length;

            // Centroid in local x,z, then base height from the terrain (world Y).
            float cx = 0f, cz = 0f;
            for (int i = 0; i < m; i++) { cx += poly[i][0]; cz += poly[i][1]; }
            cx /= m; cz /= m;

            float baseY = SampleBase(terrain, cx, cz) - FoundationSinkM;
            float topY = baseY + height;

            // Ensure CCW winding (positive shoelace) so the top cap faces up.
            if (SignedArea(poly) < 0f) poly = ReversedCopy(poly);

            int start = verts.Count;

            // bottom ring [0..m-1], then top ring [m..2m-1]
            for (int i = 0; i < m; i++)
                verts.Add(new Vector3(poly[i][0], baseY, poly[i][1]));
            for (int i = 0; i < m; i++)
                verts.Add(new Vector3(poly[i][0], topY, poly[i][1]));

            int bot = start;
            int top = start + m;

            // Side walls: edge i->j makes a quad (bot_i, bot_j, top_j, top_i).
            for (int i = 0; i < m; i++)
            {
                int j = (i + 1) % m;
                int b0 = bot + i, b1 = bot + j;
                int t0 = top + i, t1 = top + j;
                tris.Add(b0); tris.Add(b1); tris.Add(t1);
                tris.Add(b0); tris.Add(t1); tris.Add(t0);
            }

            // Top cap: fan from the first top vertex (fine for convex-ish footprints).
            for (int i = 1; i < m - 1; i++)
            {
                tris.Add(top); tris.Add(top + i); tris.Add(top + i + 1);
            }
        }

        float SampleBase(TerrainField terrain, float localX, float localZ)
        {
            if (terrain == null) return transform.position.y;
            // TerrainField queries are in WORLD space; convert local -> world.
            Vector3 world = transform.TransformPoint(new Vector3(localX, 0f, localZ));
            return terrain.HeightAt(world.x, world.z);
        }

        void FlushChunk(List<Vector3> verts, List<int> tris)
        {
            var go = new GameObject("BuildingsChunk_" + ChunkCount);
            go.transform.SetParent(transform, false);

            var mesh = new Mesh { name = "BuildingsChunk_" + ChunkCount };
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            if (BuildingMaterial != null) mr.sharedMaterial = BuildingMaterial;

            // Occluder: solid cover for LOS raycasts and physics.
            var mc = go.AddComponent<MeshCollider>();
            mc.sharedMesh = mesh;

            ChunkCount++;
            verts.Clear();
            tris.Clear();
        }

        void ClearChildren()
        {
            for (int i = transform.childCount - 1; i >= 0; i--)
            {
                Transform c = transform.GetChild(i);
                if (Application.isPlaying) Destroy(c.gameObject);
                else DestroyImmediate(c.gameObject);
            }
        }

        // --- helpers ----------------------------------------------------------
        static float SignedArea(float[][] poly)
        {
            float a = 0f;
            int n = poly.Length;
            for (int i = 0; i < n; i++)
            {
                float[] p0 = poly[i];
                float[] p1 = poly[(i + 1) % n];
                a += p0[0] * p1[1] - p1[0] * p0[1];
            }
            return a * 0.5f;
        }

        static float[][] ReversedCopy(float[][] poly)
        {
            int n = poly.Length;
            var outp = new float[n][];
            for (int i = 0; i < n; i++) outp[i] = poly[n - 1 - i];
            return outp;
        }

        static float FootprintSpan(float[][] poly)
        {
            float minX = float.MaxValue, maxX = float.MinValue;
            float minZ = float.MaxValue, maxZ = float.MinValue;
            for (int i = 0; i < poly.Length; i++)
            {
                float x = poly[i][0], z = poly[i][1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
            return Mathf.Max(maxX - minX, maxZ - minZ);
        }

        // --- minimal JSON parse ----------------------------------------------
        // Unity's JsonUtility cannot deserialize a top-level array or jagged
        // float[][], so we parse the compact array-of-objects ourselves. The
        // file is machine-generated by fetch_buildings.py with a fixed shape:
        //   [{"polygon": [[x,z],...], "height_m": h}, ...]
        // This scanner is tolerant of whitespace but assumes that schema.
        static List<BuildingRec> ParseBuildings(string s)
        {
            var list = new List<BuildingRec>();
            int n = s.Length;
            int i = 0;

            while (i < n)
            {
                int polyStart = s.IndexOf("\"polygon\"", i, System.StringComparison.Ordinal);
                if (polyStart < 0) break;

                // find the '[' that opens the polygon array
                int lb = s.IndexOf('[', polyStart);
                if (lb < 0) break;

                // read pairs until the matching closing ']' of the polygon array
                var pts = new List<float[]>();
                int j = lb + 1;
                int depth = 1; // we are inside the outer polygon array
                while (j < n && depth > 0)
                {
                    char c = s[j];
                    if (c == '[')
                    {
                        // an inner [x,z] pair
                        int innerEnd = s.IndexOf(']', j + 1);
                        if (innerEnd < 0) { depth = 0; break; }
                        float[] pair = ParsePair(s, j + 1, innerEnd);
                        if (pair != null) pts.Add(pair);
                        j = innerEnd + 1;
                    }
                    else if (c == ']')
                    {
                        depth--;
                        j++;
                    }
                    else
                    {
                        j++;
                    }
                }

                // parse height_m after the polygon
                float height = 8f;
                int hKey = s.IndexOf("\"height_m\"", j, System.StringComparison.Ordinal);
                if (hKey >= 0)
                {
                    int colon = s.IndexOf(':', hKey);
                    if (colon >= 0)
                    {
                        int k = colon + 1;
                        int valEnd = k;
                        while (valEnd < n && s[valEnd] != ',' && s[valEnd] != '}') valEnd++;
                        float.TryParse(s.Substring(k, valEnd - k).Trim(),
                            System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture, out height);
                        j = valEnd;
                    }
                }

                if (pts.Count >= 3)
                {
                    var rec = new BuildingRec();
                    rec.polygon = pts.ToArray();
                    rec.height_m = height;
                    list.Add(rec);
                }

                i = j;
            }

            return list;
        }

        static float[] ParsePair(string s, int from, int to)
        {
            // substring between [ and ] holding "x, z"
            string body = s.Substring(from, to - from);
            int comma = body.IndexOf(',');
            if (comma < 0) return null;
            float x, z;
            bool ok1 = float.TryParse(body.Substring(0, comma).Trim(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out x);
            bool ok2 = float.TryParse(body.Substring(comma + 1).Trim(),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out z);
            if (!ok1 || !ok2) return null;
            return new float[] { x, z };
        }
    }
}
