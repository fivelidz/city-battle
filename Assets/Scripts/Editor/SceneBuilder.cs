// CITY BATTLE — SceneBuilder: programmatically constructs the vertical-slice battle scene.
// Callable from the Editor menu OR headless batchmode via -executeMethod
// CityBattle.EditorTools.SceneBuilder.BuildVerticalSlice. Idempotent (overwrites the scene).
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Combat;
using CityBattle.UI;
// (kept) SceneBuilder constructs the vertical-slice battle scene.

namespace CityBattle.EditorTools
{
    public static class SceneBuilder
    {
        const string ScenePath = "Assets/Scenes/Battle.unity";

        [MenuItem("CityBattle/Build Vertical Slice Scene")]
        public static void BuildVerticalSlice()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // ---- Materials (URP) ----
            // Terrain uses a vertex-colour shader so the baked elevation/slope/contour shading shows.
            var terrainMat = MakeTerrainMat();
            var playerMat = MakeMat("Mat_Player", new Color(0.20f, 0.55f, 0.85f), emissive: new Color(0.0f, 0.25f, 0.45f));
            var enemyMat = MakeMat("Mat_Enemy", new Color(0.85f, 0.25f, 0.15f), emissive: new Color(0.45f, 0.06f, 0.0f));
            var projMat = MakeMat("Mat_Projectile", new Color(1f, 0.8f, 0.2f), emissive: new Color(1f, 0.5f, 0f));

            // ---- Sim clock ----
            var clockGo = new GameObject("SimClock");
            var clock = clockGo.AddComponent<SimClock>();

            // ---- Terrain ----
            var terrainGo = new GameObject("Terrain", typeof(MeshFilter), typeof(MeshRenderer), typeof(MeshCollider));
            var tb = terrainGo.AddComponent<TerrainBuilder>();
            tb.Resolution = 192; tb.CellSize = 12f; tb.MaxHeight = 150f; tb.Seed = 1337;
            tb.TerrainMaterial = terrainMat;

            // ---- Battle controller ----
            var bcGo = new GameObject("BattleController");
            var bc = bcGo.AddComponent<BattleController>();
            bc.TerrainBuilder = tb; bc.Clock = clock;
            bc.PlayerMat = playerMat; bc.EnemyMat = enemyMat; bc.ProjectileMat = projMat;

            // ---- Camera (RTS-style, looking down at the field) ----
            var camGo = new GameObject("MainCamera", typeof(Camera));
            camGo.tag = "MainCamera";
            var cam = camGo.GetComponent<Camera>();
            cam.farClipPlane = 12000f;
            cam.backgroundColor = new Color(0.03f, 0.04f, 0.05f);
            cam.clearFlags = CameraClearFlags.SolidColor;
            var camRig = camGo.AddComponent<BattleCamera>();
            // Frame the player force (south) looking toward the enemy (north), steep top-down RTS view.
            camRig.Target = new Vector3(950, 0, 600);
            camRig.Distance = 900f;
            camRig.Pitch = 58f;
            camRig.MinDistance = 40f;
            camRig.MaxDistance = 5000f;

            // ---- Light (sun) ----
            var sunGo = new GameObject("Sun", typeof(Light));
            var sun = sunGo.GetComponent<Light>();
            sun.type = LightType.Directional;
            sun.transform.rotation = Quaternion.Euler(48, 40, 0);
            sun.intensity = 1.0f;
            sun.color = new Color(1f, 0.96f, 0.88f);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.30f, 0.33f, 0.38f);

            // ---- HUD ----
            var hudGo = new GameObject("HUD");
            hudGo.AddComponent<BattleHUD>().Controller = bc;
            AddNav("Battle");

            // ---- Order input ----
            var inputGo = new GameObject("OrderInput");
            var oi = inputGo.AddComponent<OrderInput>();
            oi.Controller = bc; oi.Cam = cam; oi.DebugSelect = true;

            // ---- Tactical overlay (range rings, move arrows, LOS lines) ----
            var ovGo = new GameObject("TacticalOverlay");
            var ov = ovGo.AddComponent<TacticalOverlay>();
            ov.Controller = bc; ov.Input = oi;

            // ---- Demo driver (scripted self-playtest; auto-engages so the UI can be verified
            //      without mouse input). Disabled for the shipping player build via env/CLI later. ----
            var demoGo = new GameObject("DemoDriver");
            var demo = demoGo.AddComponent<DemoDriver>();
            demo.Controller = bc; demo.Input = oi; demo.Enabled = true; demo.Speed = 2f;

            // Save scene.
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);

            // Register in build settings.
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            Debug.Log("[SceneBuilder] Vertical slice scene built at " + ScenePath);
        }

        [MenuItem("CityBattle/Build Strategic Console Scene")]
        public static void BuildStrategicScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camGo = new GameObject("MainCamera", typeof(Camera));
            camGo.tag = "MainCamera";
            var cam = camGo.GetComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.02f, 0.03f, 0.04f);
            var hud = new GameObject("StrategicHUD");
            hud.AddComponent<StrategicHUD>();
            AddNav("Strategic");
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Strategic.unity");
            Debug.Log("[SceneBuilder] Strategic console scene built at Assets/Scenes/Strategic.unity");
        }

        [MenuItem("CityBattle/Build Design Screen Scene")]
        public static void BuildDesignScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camGo = new GameObject("MainCamera", typeof(Camera));
            camGo.tag = "MainCamera";
            var cam = camGo.GetComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.02f, 0.03f, 0.04f);
            var screen = new GameObject("MechaDesignScreen");
            screen.AddComponent<MechaDesignScreen>();
            AddNav("Design");
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Design.unity");
            Debug.Log("[SceneBuilder] Design screen scene built at Assets/Scenes/Design.unity");
        }

        [MenuItem("CityBattle/Build Research Screen Scene")]
        public static void BuildResearchScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camGo = new GameObject("MainCamera", typeof(Camera));
            camGo.tag = "MainCamera";
            var cam = camGo.GetComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.02f, 0.03f, 0.04f);
            var screen = new GameObject("ResearchScreen");
            screen.AddComponent<ResearchScreen>();
            AddNav("Research");
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Research.unity");
            Debug.Log("[SceneBuilder] Research screen scene built at Assets/Scenes/Research.unity");
        }

        [MenuItem("CityBattle/Build Main Menu Scene")]
        public static void BuildMenuScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camGo = new GameObject("MainCamera", typeof(Camera));
            camGo.tag = "MainCamera";
            var cam = camGo.GetComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.02f, 0.03f, 0.04f);
            new GameObject("MainMenuScreen").AddComponent<UI.MainMenuScreen>();
            new GameObject("GameState").AddComponent<Campaign.GameState>();
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Menu.unity");
            Debug.Log("[SceneBuilder] Main menu scene built at Assets/Scenes/Menu.unity");
        }

        /// <summary>Build every screen scene and register them all in Build Settings (nav needs this).</summary>
        [MenuItem("CityBattle/Build ALL Scenes + Register")]
        public static void BuildAllScenes()
        {
            BuildMenuScene();
            BuildVerticalSlice();
            BuildStrategicScene();
            BuildDesignScene();
            BuildResearchScene();

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene("Assets/Scenes/Menu.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Strategic.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Design.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Research.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Battle.unity", true),
            };
            Debug.Log("[SceneBuilder] ALL scenes built and registered in Build Settings.");
        }

        // Adds the persistent GameState bootstrap + top nav bar to a scene.
        static void AddNav(string sceneName)
        {
            new GameObject("GameState").AddComponent<Campaign.GameState>();
            var nav = new GameObject("NavOverlay").AddComponent<UI.NavOverlay>();
            nav.CurrentScene = sceneName;
        }

        static Material MakeTerrainMat()
        {
            var shader = Shader.Find("CityBattle/TerrainVertexColor");
            Material m;
            if (shader != null)
            {
                m = new Material(shader) { name = "Mat_Terrain" };
                if (m.HasProperty("_Tint")) m.SetColor("_Tint", Color.white);
            }
            else
            {
                m = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "Mat_Terrain" };
                m.color = new Color(0.32f, 0.38f, 0.30f);
            }
            System.IO.Directory.CreateDirectory("Assets/Art/Materials");
            AssetDatabase.CreateAsset(m, "Assets/Art/Materials/Mat_Terrain.mat");
            return m;
        }

        static Material MakeMat(string name, Color col, Color? emissive = null)
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
            var m = new Material(shader) { name = name };
            m.color = col;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", col);
            if (emissive.HasValue && m.HasProperty("_EmissionColor"))
            {
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", emissive.Value);
            }
            System.IO.Directory.CreateDirectory("Assets/Art/Materials");
            AssetDatabase.CreateAsset(m, $"Assets/Art/Materials/{name}.mat");
            return m;
        }
    }
}
