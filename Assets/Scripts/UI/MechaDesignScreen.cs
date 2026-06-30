// CITY BATTLE - MechaDesignScreen: the SHIPYARD / mecha-designer (the DESIGN pillar, IMGUI).
// NERV/RtW3 styled. Owns one MechaDesign being edited against a Database for a given Year.
// Pick a chassis (sets the budget), allocate per-zone armour + material, fit guns on weapon
// mounts, fit EW/drones on utility mounts, and watch the live Validate() readout.
// Built-in GUI.skin font only (OS fonts crash standalone builds). OnGUI / IMGUI only.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Design;

namespace CityBattle.UI
{
    public class MechaDesignScreen : MonoBehaviour
    {
        // The year this design is gated against (chassis/guns/armour/modules must be available).
        public int Year = 2030;

        Database _db;
        MechaDesign _design;

        GUIStyle _mono, _small, _header, _btn, _btnSm, _warn, _panel;
        bool _init;
        Vector2 _chassisScroll, _readoutScroll;

        static readonly Color Bg = new Color(0.039f, 0.047f, 0.055f, 0.95f);
        static readonly Color Orange = new Color(1f, 0.42f, 0.10f);
        static readonly Color Red = new Color(0.92f, 0.16f, 0.18f);
        static readonly Color Green = new Color(0.30f, 1f, 0.20f);
        static readonly Color Amber = new Color(1f, 0.80f, 0.12f);
        static readonly Color Cyan = new Color(0.30f, 0.85f, 1f);
        static readonly Color Dim = new Color(0.5f, 0.55f, 0.6f, 1f);

        void Start()
        {
            _db = Database.Instance;
            _design = DefaultDesign();
        }

        // Always show something: build a default design on the first Siege (else Line, else any) chassis.
        MechaDesign DefaultDesign()
        {
            ChassisDef c = FindDefaultChassis();
            int matId = FirstAvailableArmorId();
            var d = new MechaDesign
            {
                designName = "NEW PATTERN",
                chassisId = c.id,
                armorMaterialId = matId
            };
            return d;
        }

        ChassisDef FindDefaultChassis()
        {
            ChassisDef best = default;
            bool found = false;
            foreach (var c in _db.ChassisAvailable(Year))
            {
                if (!found) { best = c; found = true; }
                if (c.cls == ChassisClass.Siege) return c;
                if (c.cls == ChassisClass.Line && best.cls != ChassisClass.Siege) best = c;
            }
            if (found) return best;
            // No chassis available this year; fall back to whatever exists so the screen never null-refs.
            return _db.Chassis.Count > 0 ? _db.Chassis[0] : default;
        }

        int FirstAvailableArmorId()
        {
            foreach (var a in _db.Armors)
                if (a.yearAvailable <= Year) return a.id;
            return _db.Armors.Count > 0 ? _db.Armors[0].id : 0;
        }

        void InitStyles()
        {
            // Built-in font only (OS fonts fail in standalone builds and spam the log).
            _mono = new GUIStyle(GUI.skin.label) { fontSize = 13, normal = { textColor = Green }, richText = false };
            _small = new GUIStyle(_mono) { fontSize = 11 };
            _header = new GUIStyle(_mono) { fontSize = 15, fontStyle = FontStyle.Bold, normal = { textColor = Orange } };
            _warn = new GUIStyle(_mono) { normal = { textColor = Red }, fontStyle = FontStyle.Bold };
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold, normal = { textColor = Orange }, fixedHeight = 28 };
            _btnSm = new GUIStyle(GUI.skin.button) { fontSize = 12, normal = { textColor = Orange }, fixedHeight = 22, fixedWidth = 26 };
            _panel = new GUIStyle(GUI.skin.box);
            _panel.normal.background = SolidTex(Bg);
            _init = true;
        }

        static Texture2D SolidTex(Color c) { var t = new Texture2D(1, 1); t.SetPixel(0, 0, c); t.Apply(); return t; }
        GUIStyle StA(Color c) => new GUIStyle(_mono) { normal = { textColor = c } };

        void OnGUI()
        {
            if (!_init) InitStyles();
            if (_db == null || _design == null) return;

            DrawTopBar();
            DrawChassisPanel();   // LEFT
            DrawArmourPanel();    // CENTER-TOP
            DrawWeaponsPanel();   // CENTER-BOTTOM
            DrawModulesPanel();   // RIGHT-TOP
            DrawReadoutPanel();   // RIGHT-BOTTOM
        }

        // ---- top bar ----
        void DrawTopBar()
        {
            GUILayout.BeginArea(new Rect(0, 0, Screen.width, 30), _panel);
            GUILayout.BeginHorizontal();
            GUILayout.Label("// CITY BATTLE :: SHIPYARD", _header, GUILayout.Width(320));
            GUILayout.Label("NAME", _mono, GUILayout.Width(44));
            _design.designName = GUILayout.TextField(_design.designName ?? "", _mono, GUILayout.Width(220));
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("- YR", _btn, GUILayout.Width(54))) Year--;
            GUILayout.Label($"YEAR {Year}", _header, GUILayout.Width(110));
            if (GUILayout.Button("+ YR", _btn, GUILayout.Width(54))) Year++;
            if (GUILayout.Button("NEW", _btn, GUILayout.Width(70))) _design = DefaultDesign();
            if (GUILayout.Button("SAVE", _btn, GUILayout.Width(70))) SaveDesign();
            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        void SaveDesign()
        {
            string json = _design.ToJson();
            PlayerPrefs.SetString("citybattle.design." + _design.designName, json);
            PlayerPrefs.Save();
            Debug.Log("[Shipyard] SAVED design '" + _design.designName + "'\n" + json);
        }

        // ---- LEFT: chassis picker ----
        void DrawChassisPanel()
        {
            float w = 300, top = 34, h = Screen.height - top - 6;
            GUILayout.BeginArea(new Rect(6, top, w, h), _panel);
            GUILayout.Label("== CHASSIS ==", _header);
            var cur = _design.Chassis(_db);
            GUILayout.Label("FITTED: " + (cur.name ?? "(none)"), StA(Cyan));
            GUILayout.Space(4);

            _chassisScroll = GUILayout.BeginScrollView(_chassisScroll, GUILayout.Height(h - 230));
            foreach (var c in _db.ChassisAvailable(Year))
            {
                bool sel = c.id == _design.chassisId;
                string tag = sel ? "[*]" : "[ ]";
                if (GUILayout.Button($"{tag} {c.name} [{c.cls}]", sel ? StA(Cyan) : _mono))
                    SelectChassis(c);
            }
            GUILayout.EndScrollView();

            GUILayout.Space(6);
            GUILayout.Label("-- SPECS --", _header);
            if (cur.name != null)
            {
                GUILayout.Label($"CLASS    {cur.cls}", _small);
                GUILayout.Label($"MASS BGT {cur.massBudgetT:0} t", _small);
                GUILayout.Label($"WPN MNT  {cur.numWeaponMounts}", _small);
                GUILayout.Label($"UTL MNT  {cur.numUtilityMounts}", _small);
                GUILayout.Label($"SPEED    {cur.baseSpeedKmh:0} km/h", _small);
                GUILayout.Label($"LEGS     {cur.numLegs}", _small);
                GUILayout.Label($"COST     {cur.cost:N0}", _small);
            }
            GUILayout.EndArea();
        }

        void SelectChassis(ChassisDef c)
        {
            // Selecting a new chassis resets the budget: trim weapons/modules to the new mount counts.
            _design.chassisId = c.id;
            while (_design.weaponGunIds.Count > c.numWeaponMounts)
                _design.weaponGunIds.RemoveAt(_design.weaponGunIds.Count - 1);
            int util = _design.ewIds.Count + _design.droneIds.Count;
            while (util > c.numUtilityMounts)
            {
                if (_design.droneIds.Count > 0) _design.droneIds.RemoveAt(_design.droneIds.Count - 1);
                else if (_design.ewIds.Count > 0) _design.ewIds.RemoveAt(_design.ewIds.Count - 1);
                util = _design.ewIds.Count + _design.droneIds.Count;
            }
        }

        // ---- CENTER-TOP: armour allocation + material ----
        void DrawArmourPanel()
        {
            float x = 312, top = 34, w = 420, h = 322;
            GUILayout.BeginArea(new Rect(x, top, w, h), _panel);
            GUILayout.Label("== ARMOUR ==", _header);

            // Material picker (year-gated).
            var mat = _design.ArmorMat(_db);
            GUILayout.BeginHorizontal();
            GUILayout.Label("MATERIAL", _mono, GUILayout.Width(80));
            GUILayout.Label(mat.name ?? "(none)", StA(Cyan), GUILayout.Width(150));
            if (GUILayout.Button("CYCLE", _btn, GUILayout.Width(90))) CycleArmorMaterial();
            GUILayout.EndHorizontal();
            GUILayout.Label($"  density {mat.densityKgPerM2PerMm:0.00} kg/m2/mm  quality {mat.qualityFactor:0.00}  cost/t {mat.costPerT:0}", _small);
            GUILayout.Space(4);

            GUILayout.Label("ZONE        mm     mass", _small);
            ArmourRow("CARAPACE", ref _design.carapaceMm);
            ArmourRow("GLACIS",   ref _design.glacisMm);
            ArmourRow("FLANK",    ref _design.flankMm);
            ArmourRow("LEGS",     ref _design.legsMm);
            ArmourRow("CUPOLA",   ref _design.cupolaMm);
            ArmourRow("MANTLET",  ref _design.mantletMm);

            GUILayout.Space(4);
            GUILayout.Label($"ARMOUR MASS  {_design.ArmorMassT(_db):0.0} t", StA(Amber));
            GUILayout.EndArea();
        }

        void ArmourRow(string label, ref float mm)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(label, _mono, GUILayout.Width(86));
            if (GUILayout.Button("-", _btnSm)) mm = Mathf.Max(0f, mm - 10f);
            GUILayout.Label($"{mm:000}", _mono, GUILayout.Width(40));
            if (GUILayout.Button("+", _btnSm)) mm = Mathf.Min(2000f, mm + 10f);
            GUILayout.Label($"{ZoneMassT(label, mm):0.0} t", _small, GUILayout.Width(70));
            GUILayout.EndHorizontal();
        }

        // Approximate this zone's contribution to armour mass (re-derives the design's area model).
        float ZoneMassT(string label, float mm)
        {
            var c = _design.Chassis(_db);
            var mat = _design.ArmorMat(_db);
            float density = mat.densityKgPerM2PerMm <= 0 ? 7.85f : mat.densityKgPerM2PerMm;
            float s = Mathf.Pow(c.massBudgetT / 100f, 0.5f);
            float area;
            switch (label)
            {
                case "CARAPACE": area = 28f * s; break;
                case "GLACIS":   area = 16f * s; break;
                case "FLANK":    area = 14f * s * 2f; break; // two flanks
                case "LEGS":     area = 10f * s; break;
                case "CUPOLA":   area = 4f * s; break;
                case "MANTLET":  area = 6f * s; break;
                default:         area = 0f; break;
            }
            return density * area * mm / 1000f;
        }

        void CycleArmorMaterial()
        {
            var avail = new List<int>();
            foreach (var a in _db.Armors) if (a.yearAvailable <= Year) avail.Add(a.id);
            if (avail.Count == 0) return;
            int idx = avail.IndexOf(_design.armorMaterialId);
            idx = (idx + 1) % avail.Count;
            _design.armorMaterialId = avail[idx];
        }

        // ---- CENTER-BOTTOM: weapons ----
        void DrawWeaponsPanel()
        {
            float x = 312, top = 360, w = 420, h = Screen.height - top - 6;
            GUILayout.BeginArea(new Rect(x, top, w, h), _panel);
            var c = _design.Chassis(_db);
            int mounts = c.name != null ? c.numWeaponMounts : 0;
            GUILayout.Label($"== WEAPONS ({_design.weaponGunIds.Count}/{mounts}) ==", _header);

            for (int i = 0; i < mounts; i++)
            {
                GUILayout.BeginHorizontal();
                GUILayout.Label($"MNT{i + 1}", _mono, GUILayout.Width(48));
                if (i < _design.weaponGunIds.Count)
                {
                    var g = _db.GunById(_design.weaponGunIds[i]);
                    GUILayout.Label(g.name ?? "?", StA(Cyan), GUILayout.Width(150));
                    if (GUILayout.Button("CYCLE", _btn, GUILayout.Width(80))) CycleGun(i);
                    if (GUILayout.Button("X", _btn, GUILayout.Width(34))) _design.weaponGunIds.RemoveAt(i);
                }
                else
                {
                    GUILayout.Label("EMPTY", StA(Dim), GUILayout.Width(150));
                    if (GUILayout.Button("FIT", _btn, GUILayout.Width(80))) FitFirstGun();
                    GUILayout.Label(" ", _small, GUILayout.Width(34));
                }
                GUILayout.EndHorizontal();

                if (i < _design.weaponGunIds.Count)
                {
                    var g = _db.GunById(_design.weaponGunIds[i]);
                    GUILayout.Label($"   {g.caliberMm:0}mm  rng {g.maxRangeM / 1000f:0.0}km  ROF {g.rofRpm:0}/min  {g.weightT:0.0}t", _small);
                }
            }
            GUILayout.EndArea();
        }

        // Guns that FIT this chassis. The data model has no per-mount caliber cap field
        // (max_mount_caliber_mm is not present on ChassisDef), so every year-available gun fits.
        List<GunDef> FittableGuns()
        {
            var list = new List<GunDef>();
            foreach (var g in _db.GunsAvailable(Year)) list.Add(g);
            return list;
        }

        void FitFirstGun()
        {
            var c = _design.Chassis(_db);
            if (_design.weaponGunIds.Count >= c.numWeaponMounts) return;
            var guns = FittableGuns();
            if (guns.Count == 0) return;
            _design.weaponGunIds.Add(guns[0].id);
        }

        void CycleGun(int slot)
        {
            var guns = FittableGuns();
            if (guns.Count == 0) return;
            int cur = guns.FindIndex(g => g.id == _design.weaponGunIds[slot]);
            int next = (cur + 1) % guns.Count;
            _design.weaponGunIds[slot] = guns[next].id;
        }

        // ---- RIGHT-TOP: utility modules (EW + drones) ----
        void DrawModulesPanel()
        {
            float x = 738, top = 34, w = Screen.width - x - 6, h = 322;
            if (w < 280) { w = 280; x = Screen.width - w - 6; }
            GUILayout.BeginArea(new Rect(x, top, w, h), _panel);
            var c = _design.Chassis(_db);
            int mounts = c.name != null ? c.numUtilityMounts : 0;
            int used = _design.ewIds.Count + _design.droneIds.Count;
            GUILayout.Label($"== MODULES ({used}/{mounts}) ==", _header);

            // List fitted EW modules.
            for (int i = 0; i < _design.ewIds.Count; i++)
            {
                var e = _db.EwModules.Find(x2 => x2.id == _design.ewIds[i]);
                GUILayout.BeginHorizontal();
                GUILayout.Label("EW ", _mono, GUILayout.Width(34));
                GUILayout.Label(e.name ?? "?", StA(Cyan), GUILayout.Width(120));
                if (GUILayout.Button("CYCLE", _btn, GUILayout.Width(78))) CycleEw(i);
                if (GUILayout.Button("X", _btn, GUILayout.Width(32))) _design.ewIds.RemoveAt(i);
                GUILayout.EndHorizontal();
                GUILayout.Label($"   {e.type}  r{e.radiusM:0}m  str {e.strength:0.0}  {e.weightT:0.0}t", _small);
            }
            // List fitted drones.
            for (int i = 0; i < _design.droneIds.Count; i++)
            {
                var d = _db.Drones.Find(x2 => x2.id == _design.droneIds[i]);
                GUILayout.BeginHorizontal();
                GUILayout.Label("DRN", _mono, GUILayout.Width(34));
                GUILayout.Label(d.name ?? "?", StA(Cyan), GUILayout.Width(120));
                if (GUILayout.Button("CYCLE", _btn, GUILayout.Width(78))) CycleDrone(i);
                if (GUILayout.Button("X", _btn, GUILayout.Width(32))) _design.droneIds.RemoveAt(i);
                GUILayout.EndHorizontal();
                GUILayout.Label($"   {d.role}  rng {d.rangeM / 1000f:0.0}km  pl {d.payloadKg:0}kg", _small);
            }

            GUILayout.Space(4);
            if (used < mounts)
            {
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("+ EW", _btn)) FitFirstEw();
                if (GUILayout.Button("+ DRONE", _btn)) FitFirstDrone();
                GUILayout.EndHorizontal();
            }
            else
            {
                GUILayout.Label("(all utility mounts full)", StA(Dim));
            }
            GUILayout.EndArea();
        }

        List<EwDef> AvailableEw()
        {
            var list = new List<EwDef>();
            foreach (var e in _db.EwModules) if (e.yearAvailable <= Year) list.Add(e);
            return list;
        }

        void FitFirstEw()
        {
            var c = _design.Chassis(_db);
            if (_design.ewIds.Count + _design.droneIds.Count >= c.numUtilityMounts) return;
            var ew = AvailableEw();
            if (ew.Count == 0) return;
            _design.ewIds.Add(ew[0].id);
        }

        void FitFirstDrone()
        {
            var c = _design.Chassis(_db);
            if (_design.ewIds.Count + _design.droneIds.Count >= c.numUtilityMounts) return;
            var drones = new List<DroneDef>();
            foreach (var d in _db.DronesAvailable(Year)) drones.Add(d);
            if (drones.Count == 0) return;
            _design.droneIds.Add(drones[0].id);
        }

        void CycleEw(int slot)
        {
            var ew = AvailableEw();
            if (ew.Count == 0) return;
            int cur = ew.FindIndex(e => e.id == _design.ewIds[slot]);
            int next = (cur + 1) % ew.Count;
            _design.ewIds[slot] = ew[next].id;
        }

        void CycleDrone(int slot)
        {
            var drones = new List<DroneDef>();
            foreach (var d in _db.DronesAvailable(Year)) drones.Add(d);
            if (drones.Count == 0) return;
            int cur = drones.FindIndex(d => d.id == _design.droneIds[slot]);
            int next = (cur + 1) % drones.Count;
            _design.droneIds[slot] = drones[next].id;
        }

        // ---- RIGHT-BOTTOM: live derived-stats readout + validation banner ----
        void DrawReadoutPanel()
        {
            float x = 738, top = 360, w = Screen.width - x - 6, h = Screen.height - top - 6;
            if (w < 280) { w = 280; x = Screen.width - w - 6; }
            GUILayout.BeginArea(new Rect(x, top, w, h), _panel);
            GUILayout.Label("== READOUT ==", _header);

            var v = _design.Validate(_db, Year);

            // VALID / INVALID banner.
            if (v.ok) GUILayout.Label("[ VALID DESIGN ]", StA(Green));
            else GUILayout.Label("[ INVALID DESIGN ]", _warn);

            _readoutScroll = GUILayout.BeginScrollView(_readoutScroll, GUILayout.Height(h - 60));

            // Mass: red if over budget.
            bool over = v.massUsedT > v.massBudgetT;
            GUILayout.Label($"MASS   {v.massUsedT:0.0} / {v.massBudgetT:0.0} t", over ? _warn : StA(Green));
            GUILayout.Label($"COST   {v.costTotal:N0}", _mono);
            GUILayout.Label($"WPN    {v.weaponMountsUsed} / {v.weaponMounts} mounts", _mono);
            GUILayout.Label($"UTL    {v.utilityMountsUsed} / {v.utilityMounts} mounts", _mono);

            GUILayout.Space(4);
            GUILayout.Label("-- DERIVED --", _header);
            var c = _design.Chassis(_db);
            GUILayout.Label($"TOP SPEED   {c.baseSpeedKmh:0} km/h", _small);
            GUILayout.Label($"FIREPOWER   {TotalFirepowerMm():0} mm (sum cal)", _small);
            GUILayout.Label($"MAX RANGE   {MaxRangeKm():0.0} km", _small);
            GUILayout.Label($"PROTECTION  top {_design.carapaceMm:0} / gla {_design.glacisMm:0} / flk {_design.flankMm:0} mm", _small);

            GUILayout.Space(4);
            if (v.errors.Count > 0)
            {
                GUILayout.Label("-- ERRORS --", _warn);
                foreach (var e in v.errors) GUILayout.Label("! " + e, StA(Red));
            }
            if (v.warnings.Count > 0)
            {
                GUILayout.Label("-- WARNINGS --", StA(Amber));
                foreach (var wn in v.warnings) GUILayout.Label("~ " + wn, StA(Amber));
            }

            GUILayout.EndScrollView();
            GUILayout.EndArea();
        }

        // Sum of fitted gun calibers as a crude firepower proxy.
        float TotalFirepowerMm()
        {
            float sum = 0f;
            foreach (var id in _design.weaponGunIds) sum += _db.GunById(id).caliberMm;
            return sum;
        }

        // Max range across fitted guns (km computed by caller).
        float MaxRangeKm()
        {
            float best = 0f;
            foreach (var id in _design.weaponGunIds)
            {
                float r = _db.GunById(id).maxRangeM;
                if (r > best) best = r;
            }
            return best / 1000f;
        }
    }
}
