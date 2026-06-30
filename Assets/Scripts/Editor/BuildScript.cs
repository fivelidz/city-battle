// CITY BATTLE — BuildScript: produce a standalone, double-clickable game executable.
// Headless: Unity -batchmode -quit -executeMethod CityBattle.EditorTools.BuildScript.BuildLinux
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace CityBattle.EditorTools
{
    public static class BuildScript
    {
        const string BattleScene = "Assets/Scenes/Battle.unity";
        const string StrategicScene = "Assets/Scenes/Strategic.unity";

        // Minimal empty-scene build to isolate environment vs project build failures.
        public static void BuildMinimal()
        {
            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.DefaultGameObjects,
                UnityEditor.SceneManagement.NewSceneMode.Single);
            System.IO.Directory.CreateDirectory("Assets/Scenes");
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, "Assets/Scenes/Min.unity");
            string dir = Path.Combine(Directory.GetCurrentDirectory(), "Build", "Min");
            Directory.CreateDirectory(dir);
            var opts = new BuildPlayerOptions {
                scenes = new[] { "Assets/Scenes/Min.unity" },
                locationPathName = Path.Combine(dir, "Min.x86_64"),
                target = BuildTarget.StandaloneLinux64, options = BuildOptions.None };
            var r = BuildPipeline.BuildPlayer(opts);
            Debug.Log($"[BuildScript] MINIMAL build result={r.summary.result}");
            EditorApplication.Exit(r.summary.result == BuildResult.Succeeded ? 0 : 5);
        }

        [MenuItem("CityBattle/Build Linux Player")]
        public static void BuildLinux()
        {

            // Build the full game (Menu first so it boots into the menu).
            SceneBuilder.BuildAllScenes();

            string dir = Path.Combine(Directory.GetCurrentDirectory(), "Build", "Linux");
            Directory.CreateDirectory(dir);
            string exe = Path.Combine(dir, "CityBattle.x86_64");

            var opts = new BuildPlayerOptions
            {
                scenes = new[]
                {
                    "Assets/Scenes/Menu.unity",
                    "Assets/Scenes/Strategic.unity",
                    "Assets/Scenes/Design.unity",
                    "Assets/Scenes/Research.unity",
                    "Assets/Scenes/Battle.unity",
                },
                locationPathName = exe,
                target = BuildTarget.StandaloneLinux64,
                options = BuildOptions.None
            };

            Debug.Log("[BuildScript] Building Linux player -> " + exe);
            BuildReport report = BuildPipeline.BuildPlayer(opts);
            var sum = report.summary;
            Debug.Log($"[BuildScript] Result={sum.result} size={sum.totalSize} bytes " +
                      $"errors={sum.totalErrors} warnings={sum.totalWarnings} time={sum.totalTime}");
            if (sum.result != BuildResult.Succeeded)
            {
                Debug.LogError("[BuildScript] BUILD FAILED.");
                EditorApplication.Exit(3);
            }
            else
            {
                Debug.Log("[BuildScript] BUILD OK: " + exe);
            }
        }
    }
}
