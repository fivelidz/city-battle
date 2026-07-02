// CITY BATTLE -- CityMapLoader: reads the canonical citymap JSON produced by
// citymap/pipeline/build_map.py (see citymap/MAP_FORMAT.md) into the data the Unity game
// consumes: a float[,] heightfield (for TerrainField/TerrainBuilder), building footprints
// (poly + height + base), water level, and the map's real-world extent + weather summary.
//
// This is the "one source of truth" bridge promised in MAP_FORMAT.md: the SAME JSON drives
// both the web review viewer and the Unity game, so they match geographically.
//
// Canonical schema (data/<city>.citymap.json):
//   {
//     "city": "...", "display": "...",
//     "bbox": [w,s,e,n], "origin_lonlat": [w,s], "size_m": [width_m, length_m],
//     "terrain": { "res": N, "cell_m": f, "min_m": f, "max_m": f, "heights": [ N*N floats ] },
//     "water_level_m": f,
//     "buildings": [ { "poly": [[x_m,z_m],...], "h": f, "base_m": f }, ... ],
//     "weather": { "summary": { ... } }   // optional
//   }
//
// Coordinate frame: x = east (+X), z = north (+Z), y = up (metres ASL). heights are row-major:
//   heights[z*res + x].  TerrainField wants float[x,z], so we transpose on read.
//
// JsonUtility can't parse jagged float[][] (building polys) or a bare top-level array, so the
// building list and the heights array are parsed with a small hand-rolled scanner. Terrain scalar
// fields go through JsonUtility for robustness. Dependency-light: UnityEngine + System.IO only.
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;

namespace CityBattle.Terrain
{
    /// <summary>A single building footprint from the citymap: local-metre polygon + height + base.</summary>
    public struct CityMapBuilding
    {
        public Vector2[] Poly;   // [x_m, z_m] local metres
        public float HeightM;    // building height above its base
        public float BaseM;      // terrain height under the footprint centroid (metres ASL)
    }

    /// <summary>Everything the game needs from one citymap JSON.</summary>
    public class CityMapData
    {
        public string City;
        public string Display;
        public int Res;
        public float CellM;
        public float MinM, MaxM;
        public float WaterLevelM;
        public float WidthM, LengthM;
        public float[,] Heights;                 // [x, z], metres ASL
        public List<CityMapBuilding> Buildings = new();
        public string WeatherSummary;            // human-readable, or null

        /// <summary>Build a sim TerrainField at the given world origin from this map's heights.</summary>
        public TerrainField ToTerrainField(Vector3 origin)
        {
            var f = new TerrainField(Heights, CellM, origin);
            f.WaterLevelM = origin.y + WaterLevelM;
            return f;
        }
    }

    public static class CityMapLoader
    {
        /// <summary>Load a citymap JSON from a StreamingAssets-relative path (e.g.
        /// "CityMaps/sydney_harbour.citymap.json"). Returns null on failure.</summary>
        public static CityMapData LoadFromStreamingAssets(string relativePath)
        {
            string path = Path.Combine(Application.streamingAssetsPath, relativePath);
            return LoadFromFile(path);
        }

        /// <summary>Load a citymap JSON from an absolute/explicit file path. Returns null on failure.</summary>
        public static CityMapData LoadFromFile(string path)
        {
            if (!File.Exists(path))
            {
                Debug.LogError("[CityMapLoader] citymap not found: " + path);
                return null;
            }
            string json = File.ReadAllText(path);
            return Parse(json);
        }

        public static CityMapData Parse(string json)
        {
            var data = new CityMapData();

            data.City = ScanString(json, "\"city\"");
            data.Display = ScanString(json, "\"display\"");

            // --- terrain block ---
            int tStart = json.IndexOf("\"terrain\"", System.StringComparison.Ordinal);
            if (tStart < 0) { Debug.LogError("[CityMapLoader] no terrain block."); return null; }

            data.Res = (int)ScanNumberAfter(json, "\"res\"", tStart);
            data.CellM = ScanNumberAfter(json, "\"cell_m\"", tStart);
            data.MinM = ScanNumberAfter(json, "\"min_m\"", tStart);
            data.MaxM = ScanNumberAfter(json, "\"max_m\"", tStart);
            data.WaterLevelM = ScanNumberAfter(json, "\"water_level_m\"", 0, 0f);

            // size_m: [width, length]
            ScanNumberPair(json, "\"size_m\"", out data.WidthM, out data.LengthM);
            if (data.WidthM <= 0f) data.WidthM = (data.Res - 1) * data.CellM;
            if (data.LengthM <= 0f) data.LengthM = (data.Res - 1) * data.CellM;

            // --- heights: flat row-major float array, heights[z*res + x] ---
            int res = data.Res;
            data.Heights = ParseHeights(json, res);
            if (data.Heights == null)
            {
                Debug.LogError("[CityMapLoader] failed to parse heights array.");
                return null;
            }

            // --- buildings: [ { "poly": [[x,z],...], "h": f, "base_m": f }, ... ] ---
            data.Buildings = ParseBuildings(json);

            // --- weather summary (optional) ---
            data.WeatherSummary = ScanString(json, "\"conditions_text\"");

            Debug.Log($"[CityMapLoader] '{data.Display}' res={res} cell={data.CellM:F1}m " +
                      $"elev[{data.MinM:F0}..{data.MaxM:F0}]m water={data.WaterLevelM:F1} " +
                      $"buildings={data.Buildings.Count} " +
                      $"({data.WidthM:F0}x{data.LengthM:F0}m)" +
                      (string.IsNullOrEmpty(data.WeatherSummary) ? "" : $" weather='{data.WeatherSummary}'"));
            return data;
        }

        // ---- heights: transpose row-major [z*res+x] into float[x,z] ----
        static float[,] ParseHeights(string json, int res)
        {
            int key = json.IndexOf("\"heights\"", System.StringComparison.Ordinal);
            if (key < 0) return null;
            int open = json.IndexOf('[', key);
            if (open < 0) return null;

            var heights = new float[res, res];
            int expected = res * res;
            int count = 0;

            int i = open + 1;
            int n = json.Length;
            var sb = new System.Text.StringBuilder(24);
            while (i < n)
            {
                char c = json[i];
                if (c == ']') break;
                if (c == ',' || c == ' ' || c == '\n' || c == '\r' || c == '\t')
                {
                    if (sb.Length > 0)
                    {
                        if (count < expected)
                        {
                            int z = count / res;   // row-major: index = z*res + x
                            int x = count - z * res;
                            heights[x, z] = ParseFloat(sb.ToString());
                        }
                        count++;
                        sb.Clear();
                    }
                    i++;
                    continue;
                }
                sb.Append(c);
                i++;
            }
            if (sb.Length > 0)
            {
                if (count < expected)
                {
                    int z = count / res;
                    int x = count - z * res;
                    heights[x, z] = ParseFloat(sb.ToString());
                }
                count++;
            }

            if (count != expected)
                Debug.LogWarning($"[CityMapLoader] heights count {count} != res*res {expected} " +
                                 "(map may be truncated).");
            return heights;
        }

        // ---- buildings: hand-rolled scan of the "buildings" array of objects ----
        static List<CityMapBuilding> ParseBuildings(string json)
        {
            var list = new List<CityMapBuilding>();
            int key = json.IndexOf("\"buildings\"", System.StringComparison.Ordinal);
            if (key < 0) return list;
            int arr = json.IndexOf('[', key);
            if (arr < 0) return list;

            int i = arr + 1;
            int n = json.Length;
            int depth = 1; // inside the buildings array

            while (i < n && depth >= 1)
            {
                char c = json[i];
                if (c == ']' && depth == 1) break;
                if (c == '{')
                {
                    // parse one building object starting at i; find its matching close brace
                    int objEnd = MatchBrace(json, i);
                    if (objEnd < 0) break;
                    string obj = json.Substring(i, objEnd - i + 1);
                    var b = ParseOneBuilding(obj);
                    if (b.Poly != null && b.Poly.Length >= 3) list.Add(b);
                    i = objEnd + 1;
                    continue;
                }
                i++;
            }
            return list;
        }

        static CityMapBuilding ParseOneBuilding(string obj)
        {
            var b = new CityMapBuilding();
            b.HeightM = ScanNumberAfter(obj, "\"h\"", 0, 8f);
            b.BaseM = ScanNumberAfter(obj, "\"base_m\"", 0, 0f);
            b.Poly = ParsePolygon(obj);
            return b;
        }

        // poly: [[x,z],[x,z],...] -> Vector2[]
        static Vector2[] ParsePolygon(string obj)
        {
            int key = obj.IndexOf("\"poly\"", System.StringComparison.Ordinal);
            if (key < 0) return null;
            int outer = obj.IndexOf('[', key);
            if (outer < 0) return null;
            int outerEnd = MatchBracket(obj, outer);
            if (outerEnd < 0) return null;

            var pts = new List<Vector2>(16);
            int i = outer + 1;
            while (i < outerEnd)
            {
                char c = obj[i];
                if (c == '[')
                {
                    int pairEnd = obj.IndexOf(']', i);
                    if (pairEnd < 0 || pairEnd > outerEnd) break;
                    string pair = obj.Substring(i + 1, pairEnd - i - 1);
                    int comma = pair.IndexOf(',');
                    if (comma > 0)
                    {
                        float x = ParseFloat(pair.Substring(0, comma).Trim());
                        float z = ParseFloat(pair.Substring(comma + 1).Trim());
                        pts.Add(new Vector2(x, z));
                    }
                    i = pairEnd + 1;
                    continue;
                }
                i++;
            }
            return pts.Count >= 3 ? pts.ToArray() : null;
        }

        // ---- tiny JSON scan helpers (no allocations of a full parse tree) ----

        static string ScanString(string json, string key)
        {
            int k = json.IndexOf(key, System.StringComparison.Ordinal);
            if (k < 0) return null;
            int colon = json.IndexOf(':', k + key.Length);
            if (colon < 0) return null;
            int q1 = json.IndexOf('"', colon + 1);
            if (q1 < 0) return null;
            int q2 = json.IndexOf('"', q1 + 1);
            if (q2 < 0) return null;
            return json.Substring(q1 + 1, q2 - q1 - 1);
        }

        static float ScanNumberAfter(string json, string key, int from, float fallback = 0f)
        {
            int k = json.IndexOf(key, from, System.StringComparison.Ordinal);
            if (k < 0) return fallback;
            int colon = json.IndexOf(':', k + key.Length);
            if (colon < 0) return fallback;
            return ReadNumberAt(json, colon + 1, fallback);
        }

        static float ScanNumberAfter(string json, string key, int from)
            => ScanNumberAfter(json, key, from, 0f);

        static void ScanNumberPair(string json, string key, out float a, out float b)
        {
            a = 0f; b = 0f;
            int k = json.IndexOf(key, System.StringComparison.Ordinal);
            if (k < 0) return;
            int open = json.IndexOf('[', k);
            if (open < 0) return;
            int close = json.IndexOf(']', open);
            if (close < 0) return;
            string inner = json.Substring(open + 1, close - open - 1);
            int comma = inner.IndexOf(',');
            if (comma < 0) return;
            a = ParseFloat(inner.Substring(0, comma).Trim());
            b = ParseFloat(inner.Substring(comma + 1).Trim());
        }

        static float ReadNumberAt(string json, int start, float fallback)
        {
            int i = start;
            int n = json.Length;
            while (i < n && (json[i] == ' ' || json[i] == '\t' || json[i] == '\n' || json[i] == '\r')) i++;
            int begin = i;
            while (i < n)
            {
                char c = json[i];
                if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') i++;
                else break;
            }
            if (i == begin) return fallback;
            return ParseFloat(json.Substring(begin, i - begin));
        }

        static float ParseFloat(string s)
        {
            return float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out float v) ? v : 0f;
        }

        // Return index of the '}' matching the '{' at open (handles nested braces + strings).
        static int MatchBrace(string s, int open)
        {
            int depth = 0;
            bool inStr = false;
            for (int i = open; i < s.Length; i++)
            {
                char c = s[i];
                if (inStr) { if (c == '"' && s[i - 1] != '\\') inStr = false; continue; }
                if (c == '"') inStr = true;
                else if (c == '{') depth++;
                else if (c == '}') { depth--; if (depth == 0) return i; }
            }
            return -1;
        }

        // Return index of the ']' matching the '[' at open (handles nested brackets + strings).
        static int MatchBracket(string s, int open)
        {
            int depth = 0;
            bool inStr = false;
            for (int i = open; i < s.Length; i++)
            {
                char c = s[i];
                if (inStr) { if (c == '"' && s[i - 1] != '\\') inStr = false; continue; }
                if (c == '"') inStr = true;
                else if (c == '[') depth++;
                else if (c == ']') { depth--; if (depth == 0) return i; }
            }
            return -1;
        }
    }
}
