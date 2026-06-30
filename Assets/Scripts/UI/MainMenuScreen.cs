// CITY BATTLE — MainMenuScreen: the front door. New Game / Continue / jump to each component.
// Bootstraps the persistent GameState and routes to the five screens via GameNav.
using UnityEngine;
using CityBattle.Campaign;

namespace CityBattle.UI
{
    public class MainMenuScreen : MonoBehaviour
    {
        GUIStyle _title, _btn, _sub, _panel;
        Texture2D _bg;
        bool _init;

        static readonly Color Orange = new Color(1f, 0.42f, 0.10f);
        static readonly Color Green = new Color(0.30f, 1f, 0.20f);
        static readonly Color Bg = new Color(0.039f, 0.047f, 0.055f, 0.98f);

        void Start() => GameState.Ensure();

        void InitStyles()
        {
            _bg = new Texture2D(1, 1); _bg.SetPixel(0, 0, Bg); _bg.Apply();
            _title = new GUIStyle(GUI.skin.label) { fontSize = 40, fontStyle = FontStyle.Bold, normal = { textColor = Orange }, alignment = TextAnchor.MiddleCenter };
            _sub = new GUIStyle(GUI.skin.label) { fontSize = 15, normal = { textColor = Green }, alignment = TextAnchor.MiddleCenter };
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 18, fontStyle = FontStyle.Bold, normal = { textColor = Orange }, fixedHeight = 44 };
            _panel = new GUIStyle(GUI.skin.box); _panel.normal.background = _bg;
            _init = true;
        }

        void OnGUI()
        {
            if (!_init) InitStyles();
            // full-screen dark backdrop
            GUI.Box(new Rect(0, 0, Screen.width, Screen.height), GUIContent.none, _panel);

            float w = 420, h = 460;
            var r = new Rect(Screen.width / 2 - w / 2, Screen.height / 2 - h / 2, w, h);
            GUILayout.BeginArea(r);
            GUILayout.Space(10);
            GUILayout.Label("CITY BATTLE", _title);
            GUILayout.Label("artillery mecha warfare on the world's cities", _sub);
            GUILayout.Label($"v{Version.Number}  \"{Version.Codename}\"", _sub);
            GUILayout.Space(24);

            var gs = GameState.Instance;
            if (GUILayout.Button("NEW CAMPAIGN", _btn)) { gs.NewGame(); GameNav.Go(GameNav.Campaign); }
            GUILayout.Space(6);
            GUI.enabled = gs != null && gs.HasSave();
            if (GUILayout.Button("CONTINUE", _btn)) { gs.Load(); GameNav.Go(GameNav.Campaign); }
            GUI.enabled = true;
            GUILayout.Space(18);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("DESIGN", _btn)) GameNav.Go(GameNav.Design);
            if (GUILayout.Button("RESEARCH", _btn)) GameNav.Go(GameNav.Research);
            GUILayout.EndHorizontal();
            GUILayout.Space(6);
            if (GUILayout.Button("SKIRMISH BATTLE", _btn)) GameNav.Go(GameNav.Battle);
            GUILayout.EndArea();

            // Footer hint
            var foot = new GUIStyle(_sub) { fontSize = 12 };
            GUI.Label(new Rect(0, Screen.height - 26, Screen.width, 20),
                "Design mechas - research tech - command battles on real city terrain", foot);
        }
    }
}
