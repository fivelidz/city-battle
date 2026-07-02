// CITY BATTLE -- MapCapture: headless, Play-mode-free screenshot of the Sydney citymap terrain.
// Builds the terrain + buildings the same way the battle does, points a camera at it, renders to a
// RenderTexture and writes a PNG. Avoids the Play-mode-under-xvfb exit hang, so it's reliable for
// visual verification from an agent/CI. Requires a GL context: run under xvfb-run (NOT -nographics).
//
//   xvfb-run -a Unity -projectPath . -batchmode -quit \
//     -executeMethod CityBattle.EditorTools.MapCapture.Run -logFile /tmp/mapcap.log
//
// Output: /tmp/citymap_capture.png  (override with -mapCaptureOut <path>)
using System.IO;
using UnityEngine;
using UnityEditor;
using CityBattle.Terrain;

namespace CityBattle.EditorTools
{
    public static class MapCapture
    {
        public static void Run()
        {
            string outPath = "/tmp/citymap_capture.png";
            var args = System.Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "-mapCaptureOut") outPath = args[i + 1];

            int W = 1600, H = 1000;

            // --- Terrain from the Sydney citymap (same path the scene uses) ---
            var terrainGo = new GameObject("CapTerrain", typeof(MeshFilter), typeof(MeshRenderer), typeof(MeshCollider));
            var tb = terrainGo.AddComponent<TerrainBuilder>();
            tb.Source = TerrainSource.CityMapJson;
            tb.CityMapPath = "CityMaps/sydney_harbour.citymap.json";
            tb.TerrainMaterial = MakeVertexColorMat();
            var field = tb.Build();

            if (tb.CityMap == null)
            {
                Debug.LogError("[MapCapture] citymap failed to load; aborting.");
                EditorApplication.Exit(2);
                return;
            }

            // --- Buildings ---
            var bGo = new GameObject("CapBuildings");
            bGo.transform.SetParent(terrainGo.transform, false);
            var cb = bGo.AddComponent<CityBuildings>();
            cb.MinFootprintM = 6f;
            cb.BuildingMaterial = MakeSolidMat(new Color(0.16f, 0.17f, 0.20f));
            cb.BuildFromCityMap(tb.CityMap.Buildings, field);

            // --- Water plane at sea level ---
            float w = tb.CityMap.WidthM, l = tb.CityMap.LengthM;
            var water = GameObject.CreatePrimitive(PrimitiveType.Quad);
            water.name = "CapWater";
            water.transform.position = new Vector3(w * 0.5f, tb.CityMap.WaterLevelM, l * 0.5f);
            water.transform.rotation = Quaternion.Euler(90, 0, 0);
            water.transform.localScale = new Vector3(w * 1.2f, l * 1.2f, 1f);
            water.GetComponent<MeshRenderer>().sharedMaterial = MakeSolidMat(new Color(0.05f, 0.15f, 0.28f));

            // --- Light ---
            var sunGo = new GameObject("CapSun", typeof(Light));
            var sun = sunGo.GetComponent<Light>();
            sun.type = LightType.Directional;
            sun.transform.rotation = Quaternion.Euler(48, 40, 0);
            sun.intensity = 1.1f;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.34f, 0.37f, 0.42f);

            // --- Camera: oblique aerial over the harbour ---
            var camGo = new GameObject("CapCam", typeof(Camera));
            var cam = camGo.GetComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.04f, 0.05f, 0.07f);
            cam.farClipPlane = 20000f;
            cam.fieldOfView = 45f;
            Vector3 target = new Vector3(w * 0.5f, 20f, l * 0.5f);
            Vector3 eye = target + new Vector3(-w * 0.35f, 3000f, -l * 0.45f);
            camGo.transform.position = eye;
            camGo.transform.LookAt(target);

            // --- Render to texture -> PNG ---
            var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGB32);
            rt.antiAliasing = 4;
            cam.targetTexture = rt;
            cam.Render();

            RenderTexture.active = rt;
            var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            cam.targetTexture = null;

            byte[] png = tex.EncodeToPNG();
            File.WriteAllBytes(outPath, png);
            Debug.Log($"[MapCapture] wrote {outPath} ({png.Length} bytes) " +
                      $"buildings={cb.BuildingCount} field={field.WorldWidth:F0}x{field.WorldLength:F0}m");

            Object.DestroyImmediate(rt);
            EditorApplication.Exit(0);
        }

        static Material MakeVertexColorMat()
        {
            // The scene's baked elevation/slope/contour shading lives in vertex colours; use the
            // project's custom vertex-colour terrain shader so the capture matches the game.
            var sh = Shader.Find("CityBattle/TerrainVertexColor");
            if (sh == null) sh = Shader.Find("Universal Render Pipeline/Unlit");
            if (sh == null) sh = Shader.Find("Unlit/Color");
            var m = new Material(sh) { name = "Cap_Terrain" };
            if (m.HasProperty("_Tint")) m.SetColor("_Tint", Color.white);
            return m;
        }

        static Material MakeSolidMat(Color c)
        {
            var sh = Shader.Find("Universal Render Pipeline/Lit");
            if (sh == null) sh = Shader.Find("Standard");
            var m = new Material(sh) { color = c };
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            return m;
        }
    }
}
