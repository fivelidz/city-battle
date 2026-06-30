// CITY BATTLE — BattleHUD: the NERV/RtW3 tactical information layer (IMGUI).
// Surfaces the four-gate gunnery model (Detected / In-range / Locked / Penetrates), a per-unit
// mecha STATUS DIAGRAM (silhouette + armour zones + subsystem damage), full unit telemetry
// (speed actual/ordered, range/bearing, accuracy, deck-vs-side armour, weapon pen-vs-range),
// an ORDERS summary for the whole force, and the scrolling COMBAT LOG (global + per-unit).
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Combat;
using CityBattle.Sim;
using CityBattle.Units;
using Subsystem = CityBattle.Units.Subsystem;   // disambiguate from UnityEngine.Subsystem

namespace CityBattle.UI
{
    public class BattleHUD : MonoBehaviour
    {
        public BattleController Controller;
        OrderInput _input;
        GUIStyle _mono, _small, _header, _btn, _warn, _panel;
        Texture2D _white;
        bool _init;
        bool _helpOpen = false;
        bool _showOrders = true;
        bool _logUnitOnly = false;
        Vector2 _logScroll;

        static readonly Color Bg = new Color(0.039f, 0.047f, 0.055f, 0.95f);
        static readonly Color Orange = new Color(1f, 0.42f, 0.10f);
        static readonly Color Red = new Color(0.92f, 0.16f, 0.18f);
        static readonly Color Green = new Color(0.30f, 1f, 0.20f);
        static readonly Color Amber = new Color(1f, 0.80f, 0.12f);
        static readonly Color Cyan = new Color(0.30f, 0.85f, 1f);
        static readonly Color Hair = new Color(0.6f, 0.65f, 0.7f, 0.6f);
        static readonly Color Dim = new Color(0.5f, 0.55f, 0.6f, 1f);

        void Start() => _input = FindFirstObjectByType<OrderInput>();

        void InitStyles()
        {
            _mono = new GUIStyle(GUI.skin.label) { fontSize = 13, normal = { textColor = Green }, richText = false };
            _small = new GUIStyle(_mono) { fontSize = 11 };
            _header = new GUIStyle(_mono) { fontSize = 15, fontStyle = FontStyle.Bold, normal = { textColor = Orange } };
            _warn = new GUIStyle(_mono) { normal = { textColor = Red }, fontStyle = FontStyle.Bold };
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold, normal = { textColor = Orange }, fixedHeight = 30 };
            _panel = new GUIStyle(GUI.skin.box);
            _panel.normal.background = SolidTex(Bg);
            _white = SolidTex(Color.white);
            _init = true;
        }

        static Texture2D SolidTex(Color c) { var t = new Texture2D(1, 1); t.SetPixel(0, 0, c); t.Apply(); return t; }

        void OnGUI()
        {
            if (!_init) InitStyles();
            if (Controller?.Sim == null) return;
            var clock = Controller.Clock;

            DrawTopBar(clock);
            DrawTimeControls(clock);
            DrawForceStatus();
            DrawSelectedPanel();
            DrawOrdersPanel();
            DrawCombatLog();
            DrawHelp();
        }

        // ---- top bar ----
        void DrawTopBar(SimClock clock)
        {
            GUILayout.BeginArea(new Rect(0, 0, Screen.width, 28), _panel);
            GUILayout.BeginHorizontal();
            GUILayout.Label("// CITY BATTLE :: TACTICAL", _header, GUILayout.Width(300));
            GUILayout.FlexibleSpace();
            string state = clock.Paused ? "<PAUSED>" : $"RUN x{clock.TimeScale:0}";
            var st = new GUIStyle(_mono) { normal = { textColor = clock.Paused ? Amber : Green } };
            GUILayout.Label($"T+{clock.SimTime:000.0}s   {state}", st, GUILayout.Width(260));
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        void DrawTimeControls(SimClock clock)
        {
            float w = 360, h = 44;
            GUILayout.BeginArea(new Rect(Screen.width / 2 - w / 2, Screen.height - h - 4, w, h), _panel);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button(clock.Paused ? "RESUME" : "PAUSE", _btn)) clock.TogglePause();
            if (GUILayout.Button("1x", _btn)) clock.SetSpeed(1);
            if (GUILayout.Button("2x", _btn)) clock.SetSpeed(2);
            if (GUILayout.Button("4x", _btn)) clock.SetSpeed(4);
            if (GUILayout.Button("STEP", _btn)) clock.StepOnce();
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        void DrawForceStatus()
        {
            int p = 0, e = 0, pa = 0, ea = 0;
            foreach (var u in Controller.Sim.Units)
            {
                if (u.Team == 0) { p++; if (u.Alive) pa++; }
                else { e++; if (u.Alive) ea++; }
            }
            GUILayout.BeginArea(new Rect(Screen.width - 232, 32, 226, 64), _panel);
            GUILayout.Label("FORCE STATUS", _header);
            GUILayout.Label($"FRIENDLY {pa}/{p} OPERATIONAL", _mono);
            GUILayout.Label($"HOSTILE  {ea}/{e} DETECTED", new GUIStyle(_mono) { normal = { textColor = Red } });
            GUILayout.EndArea();
        }

        // ---- selected unit: telemetry + status diagram + firing solution ----
        void DrawSelectedPanel()
        {
            var u = _input?.Selected;
            if (u == null) return;
            float w = 380, h = 470;
            GUILayout.BeginArea(new Rect(6, 32, w, h), _panel);

            GUILayout.Label($"UNIT // {u.Name}", _header);
            GUILayout.Label($"{u.Chassis.name} [{u.Chassis.cls}]   {(u.Nation.name ?? "")}", _small);

            // Mobility / speed (actual vs ordered) + range.
            float spdActual = u.Velocity.magnitude * 3.6f;
            float spdMax = u.Chassis.baseSpeedKmh * Mathf.Clamp01(u.Mobility);
            GUILayout.Label($"SPEED  {spdActual:00.0}/{spdMax:00.0} km/h   MOB {u.Mobility*100:000}%",
                u.Immobilised ? StA(Red) : _mono);

            // Condition bars.
            GUILayout.Label($"STRUCT {Bar(u.Structure/100f)} {u.Structure:000}%", StructStyle(u.Structure));
            GUILayout.Label($"F.CTRL {Bar(u.FireControlHealth)} {u.FireControlHealth*100:000}%", u.Blinded ? StA(Red) : _mono);
            if (u.Sys != null)
            {
                bool bad = u.Immobilised || u.Disarmed || u.Blinded || u.Sys.OnFire;
                GUILayout.Label($"SYS    {u.Sys.StatusLine()}", bad ? StA(Red) : StA(Green));
            }

            // Armour readout: deck (top) vs side (belt) — the RtW3 distinction.
            GUILayout.Label($"ARMOUR top {u.Armor.carapace:000}  glacis {u.Armor.glacis:000}  flank {u.Armor.flank:000} mm", _small);

            // Weapon.
            if (u.Weapons.Count > 0)
            {
                var g = u.Weapons[0].def;
                GUILayout.Label($"WEAPON {g.name}  {g.caliberMm:0}mm  rng {g.maxRangeM/1000f:0.0}km  ROF {g.rofRpm:0}/min", _small);
            }
            GUILayout.Label($"STANCE {(u.HullDown ? "HULL-DOWN [H]" : "EXPOSED  [H]")}   FIRE {u.Fire} [1/2/3]", u.HullDown ? StA(Amber) : _mono);

            // The STATUS DIAGRAM (the centerpiece).
            DrawMechaDiagram(u, new Rect(10, 210, 150, 150));

            // Firing solution to the current target (the four gates).
            DrawFiringSolution(u, new Rect(170, 200, 200, 250));

            GUILayout.EndArea();
        }

        void DrawFiringSolution(MechaUnit u, Rect r)
        {
            GUILayout.BeginArea(r);
            var t = u.FireTarget;
            if (t == null || !t.Alive)
            {
                GUILayout.Label("NO TARGET", _header);
                GUILayout.Label("R-click a red enemy to engage.\n[R] launch recon drone.", _small);
                GUILayout.EndArea();
                return;
            }
            var sol = TacticalInfo.Solve(Controller.Sim, u, t);
            GUILayout.Label("FIRING SOLUTION", _header);
            GUILayout.Label($"TGT {t.Name}", _warn);
            string spotter = Controller.Sim.SpotterFor(t, u.Team);

            Gate("DETECTED", sol.detected, sol.detected ? (sol.directLos ? "own LOS" : $"relay: {spotter}") : "no contact");
            Gate("IN RANGE", sol.inRange, $"{sol.rangeM:0000}m / {(u.Weapons.Count>0?u.Weapons[0].def.maxRangeM:0):0000}m");
            Gate("LOS", sol.directLos, sol.directLos ? "clear" : (sol.relayed ? "blocked -> INDIRECT" : "blocked"));
            GUILayout.Label($"LOCK   {Bar(sol.lockQuality)} {sol.lockQuality*100:000}%", LockStyle(sol.lockQuality));
            Gate("PENETRATE", sol.willPenetrate, $"{ZoneShort(sol.strikeZone)} {sol.penetrationMm:000}vs{sol.zoneArmourMm:000}mm");
            GUILayout.Label($"BRG {sol.bearingDeg:000}   TOF {sol.timeOfFlight:0.0}s   EL {sol.elevationDeg:00.0}", _small);

            GUILayout.EndArea();
        }

        void Gate(string label, bool ok, string detail)
        {
            var s = new GUIStyle(_mono) { normal = { textColor = ok ? Green : Red } };
            GUILayout.Label($"{(ok ? "[+]" : "[ ]")} {label}: {detail}", s);
        }

        // ---- the mecha status diagram ----
        // A top-down crab silhouette: carapace (center), glacis (front), flanks (sides), legs,
        // cupola, mantlet. Each filled by colour for armour value and outlined red when its
        // subsystem is damaged. The RtW3 "ship status diagram", land edition.
        void DrawMechaDiagram(MechaUnit u, Rect area)
        {
            GUI.Box(area, GUIContent.none, _panel);
            float cx = area.x + area.width / 2f;
            float cy = area.y + area.height / 2f;

            // helper to fill a rect with a colour
            void Cell(float x, float y, float w, float h, Color col)
            {
                var prev = GUI.color; GUI.color = col;
                GUI.DrawTexture(new Rect(x, y, w, h), _white);
                GUI.color = prev;
            }
            Color ArmourCol(float mm) => Color.Lerp(new Color(0.25f,0.3f,0.35f), new Color(0.55f,0.75f,0.4f), Mathf.Clamp01(mm/250f));
            Color SysCol(Subsystem s, Color baseC)
            {
                var h = u.Sys?.Get(s);
                if (h == null) return baseC;
                return h.Status switch {
                    SubsystemStatus.Destroyed => new Color(0.15f,0.15f,0.15f),
                    SubsystemStatus.Disabled => Red,
                    SubsystemStatus.Degraded => Amber,
                    _ => baseC
                };
            }

            // Carapace (center top plate)
            Cell(cx-26, cy-30, 52, 60, ArmourCol(u.Armor.carapace));
            // Glacis (front bar)
            Cell(cx-26, cy-42, 52, 12, ArmourCol(u.Armor.glacis));
            // Flanks
            Cell(cx-40, cy-30, 14, 60, SysCol(Subsystem.TurretSecondary, ArmourCol(u.Armor.flank)));
            Cell(cx+26, cy-30, 14, 60, ArmourCol(u.Armor.flank));
            // Cupola (sensor head, front center)
            Cell(cx-8, cy-46, 16, 10, SysCol(Subsystem.SensorMast, Cyan));
            // Main turret (center)
            Cell(cx-10, cy-18, 20, 24, SysCol(Subsystem.TurretMain, Orange));
            // Gun barrel
            Cell(cx-3, cy-44, 6, 26, SysCol(Subsystem.TurretMain, Orange));
            // Legs (6 pips around)
            Subsystem[] legs = { Subsystem.LegFL, Subsystem.LegML, Subsystem.LegRL, Subsystem.LegFR, Subsystem.LegMR, Subsystem.LegRR };
            for (int i = 0; i < 6; i++)
            {
                bool left = i < 3;
                float lx = left ? area.x + 6 : area.x + area.width - 14;
                float ly = cy - 30 + (i % 3) * 26;
                Cell(lx, ly, 8, 16, SysCol(legs[i], new Color(0.5f,0.55f,0.5f)));
            }

            // Fire marker
            if (u.Sys != null && u.Sys.OnFire)
            {
                var prev = GUI.color; GUI.color = new Color(1f,0.4f,0.05f, 0.6f + 0.4f*Mathf.Sin(Time.time*8f));
                GUI.DrawTexture(new Rect(cx-12, cy-6, 24, 18), _white); GUI.color = prev;
            }
            GUI.Label(new Rect(area.x+4, area.yMax-18, area.width, 16), "STATUS DIAGRAM", _small);
        }

        // ---- orders summary for the whole force ----
        void DrawOrdersPanel()
        {
            if (!_showOrders) { /* still draw toggle */ }
            float w = 250;
            float h = _showOrders ? 200 : 30;
            var r = new Rect(Screen.width - w - 6, 100, w, h);
            GUILayout.BeginArea(r, _panel);
            if (GUILayout.Button(_showOrders ? "ORDERS [hide]" : "ORDERS [show]", _btn)) _showOrders = !_showOrders;
            if (_showOrders)
            {
                foreach (var u in Controller.Sim.Units)
                {
                    if (u.Team != 0) continue;
                    string ord = !u.Alive ? "DESTROYED"
                        : u.HasMoveOrder ? $"MOVE (+{u.Waypoints.Count}wp)"
                        : u.FireTarget != null ? $"ENGAGE {u.FireTarget.Name.Substring(0, Mathf.Min(8,u.FireTarget.Name.Length))}"
                        : "HOLD";
                    var c = !u.Alive ? Dim : (u.FireTarget != null ? Amber : Green);
                    GUILayout.Label($"{Short(u.Name,10)} {u.Fire.ToString().Substring(0,3)} {ord}", StA(c));
                }
            }
            GUILayout.EndArea();
        }

        // ---- combat log ----
        void DrawCombatLog()
        {
            float w = 460, h = 180;
            var r = new Rect(6, Screen.height - h - 4, w, h);
            GUILayout.BeginArea(r, _panel);
            GUILayout.BeginHorizontal();
            GUILayout.Label("COMBAT LOG", _header, GUILayout.Width(120));
            var sel = _input?.Selected;
            if (sel != null && GUILayout.Button(_logUnitOnly ? "[UNIT]" : "[ALL]", _btn, GUILayout.Width(70)))
                _logUnitOnly = !_logUnitOnly;
            GUILayout.EndHorizontal();

            _logScroll = GUILayout.BeginScrollView(_logScroll, GUILayout.Height(h - 40));
            IEnumerable<LogEntry> entries;
            if (_logUnitOnly && sel != null) entries = Controller.Sim.Log.ForUnit(sel.Id);
            else entries = Controller.Sim.Log.Recent(40);
            foreach (var e in entries)
                GUILayout.Label($"{e.simTime:000.0} {e.text}", new GUIStyle(_small) { normal = { textColor = LogColor(e.kind) } });
            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        Color LogColor(LogKind k) => k switch
        {
            LogKind.Spot => Cyan, LogKind.Straddle => Amber, LogKind.Penetrate => Green,
            LogKind.Bounce => Dim, LogKind.System => Orange, LogKind.Kill => Red,
            LogKind.Order => Cyan, _ => new Color(0.7f,0.75f,0.7f)
        };

        void DrawHelp()
        {
            float w = 300, h = _helpOpen ? 168 : 30;
            var r = new Rect(Screen.width - w - 6, Screen.height - h - 54, w, h);
            GUILayout.BeginArea(r, _panel);
            if (GUILayout.Button(_helpOpen ? "HOW TO PLAY [hide]" : "HOW TO PLAY [show]", _btn)) _helpOpen = !_helpOpen;
            if (_helpOpen)
                GUILayout.Label(
                    "STARTS PAUSED. RESUME to run.\n" +
                    "L-CLICK select your (blue) mecha\n" +
                    "R-CLICK ground = MOVE  (SHIFT = waypoint)\n" +
                    "R-CLICK red enemy = TARGET\n" +
                    "[1]/[2]/[3] Hold/Direct/Indirect\n" +
                    "[H] hull-down  [G] recon drone\n" +
                    "WASD pan  Q/E rotate  R/F tilt\n" +
                    "wheel or +/- ZOOM (in close to inspect)", _small);
            GUILayout.EndArea();
        }

        // ---- helpers ----
        GUIStyle StructStyle(float s) => StA(s > 60 ? Green : s > 30 ? Amber : Red);
        GUIStyle LockStyle(float l) => StA(l > 0.55f ? Green : l > 0.15f ? Amber : Red);
        GUIStyle StA(Color c) => new GUIStyle(_mono) { normal = { textColor = c } };
        static string Short(string s, int n) => s.Length <= n ? s : s.Substring(0, n);
        static string ZoneShort(HitZone z) => z switch { HitZone.Carapace=>"TOP", HitZone.Glacis=>"GLA", HitZone.FlankL=>"FLK", HitZone.FlankR=>"FLK", _=>z.ToString().Substring(0,3).ToUpper() };
        static string Bar(float t) { t = Mathf.Clamp01(t); int n = 10, f = Mathf.RoundToInt(t * n); return "[" + new string('|', f) + new string('.', n - f) + "]"; }
    }
}
