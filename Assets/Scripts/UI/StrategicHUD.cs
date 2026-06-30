// CITY BATTLE — StrategicHUD: NERV-style management/research/design overview (IMGUI).
// A self-contained strategic console you can drop into any scene: it owns a CampaignState,
// shows budget/calendar/roster, lets you advance months (running research + production), and
// browse the tech tree + available designs. Proves the management pillar end-to-end in-editor.
// (A UI-Toolkit pass will replace IMGUI for the dense production tables later.)
using UnityEngine;
using CityBattle.Data;
using CityBattle.Design;
using CityBattle.Campaign;

namespace CityBattle.UI
{
    public class StrategicHUD : MonoBehaviour
    {
        Database _db;
        TechTree _tree;
        CampaignState _camp;
        Vector2 _scrollTech, _scrollRoster;
        int _tab;
        GUIStyle _mono, _header, _btn;
        bool _init;
        string _log = "";

        static readonly Color Orange = new Color(1f, 0.42f, 0.10f);
        static readonly Color Green = new Color(0.22f, 1f, 0.08f);
        static readonly Color Amber = new Color(1f, 0.78f, 0.10f);
        static readonly Color Bg = new Color(0.039f, 0.047f, 0.055f, 0.95f);

        void Start()
        {
            _db = Database.Instance;
            _tree = TechTree.Instance;
            _camp = new CampaignState();
            _camp.NewCampaign(_db, _tree, 1);
            // Fund a spread of currently-available research so the tree visibly advances.
            foreach (var t in _camp.Research.Available(_tree, _camp.Year)) _camp.Research.Fund(t.techId);
            // Seed one starter design.
            _camp.Designs.Add(StarterDesign());
        }

        MechaDesign StarterDesign()
        {
            var siege = _db.Chassis.Find(c => c.cls == ChassisClass.Siege);
            var gun = _db.Guns.Find(g => g.name.Contains("155"));
            var d = new MechaDesign { designName = "PATTERN-I LEVIATHAN", chassisId = siege.id, armorMaterialId = _db.Armors[0].id };
            if (gun.name != null) d.weaponGunIds.Add(gun.id);
            return d;
        }

        void InitStyles()
        {
            // Built-in font only (OS fonts fail in standalone builds and spam the log).
            _mono = new GUIStyle(GUI.skin.label)
            { fontSize = 13, normal = { textColor = Green } };
            _header = new GUIStyle(_mono) { fontSize = 15, fontStyle = FontStyle.Bold, normal = { textColor = Orange } };
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, normal = { textColor = Orange }, fixedHeight = 28 };
            _init = true;
        }

        void OnGUI()
        {
            if (!_init) InitStyles();
            if (_camp == null) return;

            var area = new Rect(8, 8, 440, Screen.height - 16);
            var box = new GUIStyle(GUI.skin.box); box.normal.background = Tex(Bg);
            GUILayout.BeginArea(area, box);

            GUILayout.Label($"// CITY BATTLE :: STRATEGIC  {Version.Number}", _header);
            var n = _camp.Nation(_db);
            GUILayout.Label($"NATION {n.name}   {_camp.Year}.{_camp.Month:00}   BUDGET {_camp.Budget:N0}", _mono);

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("OVERVIEW", _btn)) _tab = 0;
            if (GUILayout.Button("RESEARCH", _btn)) _tab = 1;
            if (GUILayout.Button("DESIGN", _btn)) _tab = 2;
            if (GUILayout.Button("ROSTER", _btn)) _tab = 3;
            GUILayout.EndHorizontal();

            if (GUILayout.Button(">> ADVANCE 1 MONTH", _btn))
            {
                var done = _camp.AdvanceMonth(_db, _tree);
                foreach (var id in done)
                {
                    var t = _tree.Techs.Find(x => x.techId == id);
                    _log = $"RESEARCHED: {t.name} [{t.branch}]\n" + _log;
                }
            }

            GUILayout.Space(6);
            switch (_tab)
            {
                case 0: DrawOverview(); break;
                case 1: DrawResearch(); break;
                case 2: DrawDesign(); break;
                case 3: DrawRoster(); break;
            }

            GUILayout.EndArea();
        }

        void DrawOverview()
        {
            GUILayout.Label("== STATUS ==", _header);
            GUILayout.Label($"KNOWN TECH    {_camp.Research.Known.Count}/{_tree.Techs.Count}", _mono);
            GUILayout.Label($"FUNDED TECH   {_camp.Research.Funded.Count}", _mono);
            GUILayout.Label($"DESIGNS       {_camp.Designs.Count}", _mono);
            GUILayout.Label($"ROSTER        {_camp.Roster.Count} units", _mono);
            GUILayout.Label($"PRODUCTION Q  {_camp.ProductionQueue.Count}", _mono);
            if (_camp.ProductionQueue.Count > 0)
            {
                var p = _camp.ProductionQueue[0];
                GUILayout.Label($"  BUILDING {p.designName}  {p.Progress*100:00}%", StA(Amber));
            }
            GUILayout.Space(8);
            GUILayout.Label("== EVENT LOG ==", _header);
            GUILayout.Label(_log.Length > 0 ? _log : "(advance months to research tech)", _mono);
        }

        void DrawResearch()
        {
            GUILayout.Label("== TECH (available now) ==", _header);
            _scrollTech = GUILayout.BeginScrollView(_scrollTech, GUILayout.Height(Screen.height - 220));
            string branch = "";
            foreach (var t in _tree.Techs)
            {
                if (t.year > _camp.Year) continue;
                bool known = _camp.Research.IsKnown(t.techId);
                if (t.branch != branch) { branch = t.branch; GUILayout.Label($"-- {branch} --", _header); }
                var style = known ? StA(Green) : (_camp.Research.Funded.Contains(t.techId) ? StA(Amber) : _mono);
                string tag = known ? "[DONE]" : (_camp.Research.Funded.Contains(t.techId) ? "[FUND]" : "[    ]");
                if (GUILayout.Button($"{tag} {t.name}  ({t.year})", style))
                {
                    if (!known)
                    {
                        if (_camp.Research.Funded.Contains(t.techId)) _camp.Research.Unfund(t.techId);
                        else _camp.Research.Fund(t.techId);
                    }
                }
            }
            GUILayout.EndScrollView();
        }

        void DrawDesign()
        {
            GUILayout.Label("== DESIGNS ==", _header);
            foreach (var d in _camp.Designs)
            {
                var v = d.Validate(_db, _camp.Year);
                GUILayout.Label($"{d.designName}", _header);
                GUILayout.Label($"  CHASSIS {d.Chassis(_db).name}", _mono);
                GUILayout.Label($"  MASS {v.massUsedT:0}/{v.massBudgetT:0}t  COST {v.costTotal:N0}", v.ok ? StA(Green) : StA(Amber));
                GUILayout.Label($"  WPN {v.weaponMountsUsed}/{v.weaponMounts}  UTIL {v.utilityMountsUsed}/{v.utilityMounts}", _mono);
                if (GUILayout.Button($"QUEUE PRODUCTION ({d.TotalCost(_db):N0})", _btn))
                    _camp.QueueProduction(_db, d, 1);
            }
        }

        void DrawRoster()
        {
            GUILayout.Label($"== ROSTER ({_camp.Roster.Count}) ==", _header);
            _scrollRoster = GUILayout.BeginScrollView(_scrollRoster, GUILayout.Height(Screen.height - 200));
            foreach (var r in _camp.Roster)
                GUILayout.Label($"{r.unitName}  COND {r.condition}%", _mono);
            if (_camp.Roster.Count == 0) GUILayout.Label("(queue a design then advance months)", _mono);
            GUILayout.EndScrollView();
        }

        GUIStyle StA(Color c) => new GUIStyle(_mono) { normal = { textColor = c } };
        static Texture2D Tex(Color c) { var t = new Texture2D(1, 1); t.SetPixel(0, 0, c); t.Apply(); return t; }
    }
}
