// CITY BATTLE — PlayCapture: enter Play mode headlessly (under xvfb), let the battle run a few
// seconds with the DemoDriver engaging, then capture screenshots. This verifies the ACTUAL
// rendered game + full information layer when the standalone player build is unavailable.
// Run: xvfb-run Unity -batchmode -executeMethod CityBattle.EditorTools.PlayCapture.Run -logFile ...
using System.Collections;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace CityBattle.EditorTools
{
    public static class PlayCapture
    {
        public static void Run()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/Battle.unity", OpenSceneMode.Single);
            EditorApplication.update += Tick;
            _frame = 0;
            _shot = 0;
            EditorApplication.EnterPlaymode();
        }

        static int _frame;
        static int _shot;

        static void Tick()
        {
            if (!EditorApplication.isPlaying) return;
            _frame++;
            // Capture at a few moments: ~2s, ~5s, ~9s (assuming ~60 editor fps in play).
            if (_frame == 130 || _frame == 320 || _frame == 560)
            {
                string path = $"/tmp/play_shot_{_shot}.png";
                ScreenCapture.CaptureScreenshot(path, 1);
                Debug.Log($"[PlayCapture] requested screenshot {path}");
                _shot++;
            }
            if (_frame >= 620)
            {
                EditorApplication.update -= Tick;
                Debug.Log("[PlayCapture] done, exiting play mode.");
                EditorApplication.ExitPlaymode();
                EditorApplication.delayCall += () => EditorApplication.Exit(0);
            }
        }
    }
}
