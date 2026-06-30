// CITY BATTLE — GameNav: app navigation between the five screens.
// Central place that knows the scene names and switches between them, ensuring a GameState
// exists first. Every screen draws a small top nav bar via NavBar() so you can move around.
using UnityEngine;
using UnityEngine.SceneManagement;
using CityBattle.Campaign;

namespace CityBattle.UI
{
    public static class GameNav
    {
        public const string Menu = "Menu";
        public const string Campaign = "Strategic";   // existing strategic console = campaign hub
        public const string Design = "Design";
        public const string Research = "Research";
        public const string Battle = "Battle";

        public static void Go(string scene)
        {
            GameState.Ensure();
            if (Application.CanStreamedLevelBeLoaded(scene))
                SceneManager.LoadScene(scene);
            else
                Debug.LogWarning($"[GameNav] scene '{scene}' not in Build Settings.");
        }
    }

    /// <summary>A reusable top navigation bar drawn by each screen's OnGUI.</summary>
    public static class NavBar
    {
        static GUIStyle _btn, _bar;
        static Texture2D _bg;
        static readonly Color Orange = new Color(1f, 0.42f, 0.10f);
        static readonly Color Bg = new Color(0.039f, 0.047f, 0.055f, 0.97f);

        static void Init()
        {
            _bg = new Texture2D(1, 1); _bg.SetPixel(0, 0, Bg); _bg.Apply();
            _bar = new GUIStyle(GUI.skin.box); _bar.normal.background = _bg;
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold, normal = { textColor = Orange }, fixedHeight = 26 };
        }

        /// <summary>Draw the nav bar at the top. Returns the height it consumed.</summary>
        public static float Draw(string current)
        {
            if (_bar == null) Init();
            float h = 30;
            GUILayout.BeginArea(new Rect(0, 0, Screen.width, h), _bar);
            GUILayout.BeginHorizontal();
            GUILayout.Label("// CITY BATTLE", new GUIStyle(GUI.skin.label) { normal = { textColor = Orange }, fontStyle = FontStyle.Bold }, GUILayout.Width(120));
            Tab("MENU", GameNav.Menu, current);
            Tab("CAMPAIGN", GameNav.Campaign, current);
            Tab("DESIGN", GameNav.Design, current);
            Tab("RESEARCH", GameNav.Research, current);
            Tab("BATTLE", GameNav.Battle, current);
            GUILayout.FlexibleSpace();
            var gs = GameState.Instance;
            if (gs != null && gs.Campaign != null)
                GUILayout.Label($"{gs.Campaign.Year}.{gs.Campaign.Month:00}  ${gs.Campaign.Budget:N0}",
                    new GUIStyle(GUI.skin.label) { normal = { textColor = new Color(0.3f,1f,0.2f) } }, GUILayout.Width(220));
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
            return h;
        }

        static void Tab(string label, string scene, string current)
        {
            var style = new GUIStyle(_btn);
            if (scene == current) style.normal.textColor = new Color(0.3f, 1f, 0.2f);
            if (GUILayout.Button(label, style, GUILayout.Width(90)))
                if (scene != current) GameNav.Go(scene);
        }
    }
}
