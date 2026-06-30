// CITY BATTLE - ResearchScreen: the RESEARCH tree viewer (the RESEARCH pillar, IMGUI).
// NERV/RtW3 styled. Owns a TechTree + ResearchState. Browse branches, fund/unfund available
// techs, and ADVANCE YEAR to run the stochastic research model and watch techs complete.
// Built-in GUI.skin font only (OS fonts crash standalone builds). OnGUI / IMGUI only.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Campaign;
using CityBattle.Sim;

namespace CityBattle.UI
{
    public class ResearchScreen : MonoBehaviour
    {
        // The current research year. Techs with year > Year are LOCKED.
        public int Year = 2030;

        TechTree _tree;
        ResearchState _research;
        SimRandom _rng;
        string _branch = "";
        string _log = "";

        GUIStyle _mono, _small, _header, _btn, _warn;
        bool _init;
        Vector2 _branchScroll, _techScroll, _logScroll;

        static readonly Color Orange = new Color(1f, 0.42f, 0.10f);
        static readonly Color Red = new Color(0.92f, 0.16f, 0.18f);
        static readonly Color Green = new Color(0.30f, 1f, 0.20f);
        static readonly Color Amber = new Color(1f, 0.80f, 0.12f);
        static readonly Color Cyan = new Color(0.30f, 0.85f, 1f);
        static readonly Color White = new Color(0.85f, 0.88f, 0.90f);
        static readonly Color Dim = new Color(0.45f, 0.50f, 0.55f, 1f);
        static readonly Color Bg = new Color(0.039f, 0.047f, 0.055f, 0.95f);

        void Start()
        {
            _tree = TechTree.Instance;
            _research = new ResearchState();
            _research.GrantStartingTech(_tree);
            _rng = new SimRandom(20300101u);
            // Default to the first branch so the centre panel always shows something.
            foreach (var b in _tree.Branches()) { _branch = b; break; }
        }

        void InitStyles()
        {
            // Built-in font only (OS fonts fail in standalone builds and spam the log).
            _mono = new GUIStyle(GUI.skin.label) { fontSize = 13, normal = { textColor = Green }, richText = false };
            _small = new GUIStyle(_mono) { fontSize = 11 };
            _header = new GUIStyle(_mono) { fontSize = 15, fontStyle = FontStyle.Bold, normal = { textColor = Orange } };
            _warn = new GUIStyle(_mono) { normal = { textColor = Red }, fontStyle = FontStyle.Bold };
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold, normal = { textColor = Orange }, fixedHeight = 28 };
            _init = true;
        }

        GUIStyle StA(Color c) => new GUIStyle(_mono) { normal = { textColor = c } };
        static Texture2D SolidTex(Color c) { var t = new Texture2D(1, 1); t.SetPixel(0, 0, c); t.Apply(); return t; }

        GUIStyle _panel;
        GUIStyle Panel()
        {
            if (_panel == null) { _panel = new GUIStyle(GUI.skin.box); _panel.normal.background = SolidTex(Bg); }
            return _panel;
        }

        void OnGUI()
        {
            if (!_init) InitStyles();
            if (_tree == null || _research == null) return;

            DrawTopBar();
            DrawBranchPanel();   // LEFT
            DrawTechPanel();     // CENTER
            DrawSummaryPanel();  // RIGHT
        }

        void DrawTopBar()
        {
            GUILayout.BeginArea(new Rect(0, 0, Screen.width, 30), Panel());
            GUILayout.BeginHorizontal();
            GUILayout.Label("// CITY BATTLE :: RESEARCH", _header, GUILayout.Width(340));
            GUILayout.FlexibleSpace();
            GUILayout.Label($"YEAR {Year}", _header, GUILayout.Width(120));
            GUILayout.Label($"KNOWN {_research.Known.Count}/{_tree.Techs.Count}", _mono, GUILayout.Width(160));
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        // ---- LEFT: branch list ----
        void DrawBranchPanel()
        {
            float w = 240, top = 34, h = Screen.height - top - 6;
            GUILayout.BeginArea(new Rect(6, top, w, h), Panel());
            GUILayout.Label("== BRANCHES ==", _header);
            _branchScroll = GUILayout.BeginScrollView(_branchScroll, GUILayout.Height(h - 40));
            foreach (var b in _tree.Branches())
            {
                bool sel = b == _branch;
                string tag = sel ? "[*]" : "[ ]";
                int known = 0, total = 0;
                foreach (var t in _tree.Techs)
                    if (t.branch == b) { total++; if (_research.IsKnown(t.techId)) known++; }
                if (GUILayout.Button($"{tag} {b}  {known}/{total}", sel ? StA(Cyan) : _mono))
                    _branch = b;
            }
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        // ---- CENTER: techs in the selected branch ----
        void DrawTechPanel()
        {
            float x = 252, top = 34, w = Screen.width - x - 312, h = Screen.height - top - 6;
            if (w < 360) w = 360;
            GUILayout.BeginArea(new Rect(x, top, w, h), Panel());
            GUILayout.Label($"== {(_branch.Length > 0 ? _branch : "(no branch)")} ==", _header);
            GUILayout.Label("click an AVAILABLE tech to toggle funding", _small);
            GUILayout.Space(2);

            _techScroll = GUILayout.BeginScrollView(_techScroll, GUILayout.Height(h - 60));
            foreach (var t in _tree.Techs)
            {
                if (t.branch != _branch) continue;

                bool known = _research.IsKnown(t.techId);
                bool funded = _research.Funded.Contains(t.techId);
                bool locked = t.year > Year;

                string status; Color col;
                if (known) { status = "DONE";      col = Green; }
                else if (funded) { status = "FUNDED";    col = Amber; }
                else if (locked) { status = "LOCKED";    col = Dim; }
                else { status = "AVAILABLE"; col = White; }

                GUILayout.BeginHorizontal();
                if (GUILayout.Button($"[{status,-9}] {t.name}  ({t.year})  ${t.cost:0}", StA(col)))
                    ToggleFunding(t);
                GUILayout.EndHorizontal();
                GUILayout.Label($"     UNLOCKS: {(string.IsNullOrEmpty(t.effect) ? "-" : t.effect)}", _small);
            }
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        void ToggleFunding(TechDef t)
        {
            // Only AVAILABLE techs can be funded (known = done, locked = year not reached).
            if (_research.IsKnown(t.techId)) return;
            if (t.year > Year) return;
            if (_research.Funded.Contains(t.techId)) _research.Unfund(t.techId);
            else _research.Fund(t.techId);
        }

        // ---- RIGHT: summary + advance year ----
        void DrawSummaryPanel()
        {
            float w = 300, x = Screen.width - w - 6, top = 34, h = Screen.height - top - 6;
            GUILayout.BeginArea(new Rect(x, top, w, h), Panel());
            GUILayout.Label("== SUMMARY ==", _header);
            GUILayout.Label($"YEAR     {Year}", _mono);
            GUILayout.Label($"KNOWN    {_research.Known.Count}/{_tree.Techs.Count}", StA(Green));
            GUILayout.Label($"FUNDED   {_research.Funded.Count}", StA(Amber));
            int avail = 0;
            foreach (var t in _research.Available(_tree, Year)) avail++;
            GUILayout.Label($"AVAIL    {avail}", _mono);

            GUILayout.Space(6);
            if (GUILayout.Button(">> ADVANCE YEAR", _btn)) AdvanceYear();
            if (GUILayout.Button("FUND ALL AVAILABLE", _btn)) FundAllAvailable();
            GUILayout.Space(6);

            GUILayout.Label("== RESEARCH LOG ==", _header);
            _logScroll = GUILayout.BeginScrollView(_logScroll, GUILayout.Height(h - 240));
            GUILayout.Label(_log.Length > 0 ? _log : "(fund techs, then advance the year)", _mono);
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        void FundAllAvailable()
        {
            foreach (var t in _research.Available(_tree, Year)) _research.Fund(t.techId);
        }

        void AdvanceYear()
        {
            Year++;
            // Run a few research intervals to simulate a year of stochastic progress.
            var newlyDone = new List<int>();
            for (int i = 0; i < 6; i++)
            {
                var done = _research.Advance(_tree, Year, 100f, _rng);
                newlyDone.AddRange(done);
            }
            if (newlyDone.Count == 0)
            {
                _log = $"-- {Year}: no breakthroughs --\n" + _log;
            }
            else
            {
                foreach (var id in newlyDone)
                {
                    var t = _tree.Techs.Find(x => x.techId == id);
                    _log = $"{Year}: RESEARCHED {t.name} [{t.branch}]\n" + _log;
                    Debug.Log($"[Research] Completed {t.name} ({t.branch}) -> {t.effect}");
                }
            }
        }
    }
}
