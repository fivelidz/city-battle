// CITY BATTLE — Central data Database.
// Loads all CSV tables from Resources/CSV/ into typed lists once, exposes lookups.
// Pure data; no Unity scene dependency beyond Resources.Load for the CSV text assets.
using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace CityBattle.Data
{
    public class Database
    {
        public readonly List<GunDef> Guns = new();
        public readonly List<ChassisDef> Chassis = new();
        public readonly List<ArmorDef> Armors = new();
        public readonly List<DroneDef> Drones = new();
        public readonly List<EwDef> EwModules = new();
        public readonly List<NationDef> Nations = new();
        public PenTable VerPen = new();
        public PenTable HorPen = new();

        static Database _instance;
        public static Database Instance => _instance ??= Load();

        public static Database Load()
        {
            var db = new Database();
            db.LoadGuns("CSV/guns");
            db.LoadChassis("CSV/chassis");
            db.LoadArmor("CSV/armor");
            db.LoadDrones("CSV/drones");
            db.LoadEw("CSV/ew");
            db.LoadNations("CSV/nations");
            db.VerPen = LoadPenTable("CSV/verpen");
            db.HorPen = LoadPenTable("CSV/horpen");
            Debug.Log($"[Database] Loaded {db.Guns.Count} guns, {db.Chassis.Count} chassis, " +
                      $"{db.Armors.Count} armors, {db.Drones.Count} drones, {db.EwModules.Count} EW, " +
                      $"{db.Nations.Count} nations, pen calibers ver={db.VerPen.CaliberCount}.");
            return db;
        }

        // ---- CSV utility ----

        static string[] ReadLines(string resourcePath)
        {
            var ta = Resources.Load<TextAsset>(resourcePath);
            if (ta == null)
            {
                Debug.LogError($"[Database] Missing resource: {resourcePath}");
                return Array.Empty<string>();
            }
            return ta.text.Replace("\r\n", "\n").Replace("\r", "\n")
                          .Split('\n', StringSplitOptions.RemoveEmptyEntries);
        }

        static float F(string s) => float.Parse(s, CultureInfo.InvariantCulture);
        static int I(string s) => int.Parse(s, CultureInfo.InvariantCulture);

        /// <summary>Convert snake_case CSV token to a PascalCase enum value.</summary>
        static TEnum E<TEnum>(string token) where TEnum : struct
        {
            string pascal = ToPascal(token);
            if (Enum.TryParse<TEnum>(pascal, true, out var v)) return v;
            Debug.LogWarning($"[Database] Unknown {typeof(TEnum).Name} '{token}' -> default.");
            return default;
        }

        static string ToPascal(string token)
        {
            var parts = token.Split('_', StringSplitOptions.RemoveEmptyEntries);
            var sb = new System.Text.StringBuilder();
            foreach (var p in parts)
                sb.Append(char.ToUpperInvariant(p[0])).Append(p.Substring(1));
            return sb.ToString();
        }

        // ---- Loaders ----

        void LoadGuns(string path)
        {
            var lines = ReadLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                Guns.Add(new GunDef
                {
                    id = I(c[0]), name = c[1], caliberMm = F(c[2]), shellWeightKg = F(c[3]),
                    rofRpm = F(c[4]), maxRangeM = F(c[5]), muzzleVelocityMs = F(c[6]),
                    weightT = F(c[7]), cost = F(c[8]), yearAvailable = I(c[9]),
                    type = E<GunType>(c[10])
                });
            }
        }

        void LoadChassis(string path)
        {
            var lines = ReadLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                Chassis.Add(new ChassisDef
                {
                    id = I(c[0]), name = c[1], cls = E<ChassisClass>(c[2]),
                    massBudgetT = F(c[3]), baseArmorBudgetT = F(c[4]), numLegs = I(c[5]),
                    baseSpeedKmh = F(c[6]), turnRateDps = F(c[7]), numWeaponMounts = I(c[8]),
                    numUtilityMounts = I(c[9]), cost = F(c[10]), maintenance = F(c[11]),
                    yearAvailable = I(c[12]),
                    // New schema columns (backward-compatible: default if absent).
                    maxMountCaliberMm = c.Length > 13 ? F(c[13]) : 999f,
                    crew = c.Length > 14 ? I(c[14]) : 4,
                    powerOutput = c.Length > 15 ? F(c[15]) : 100f,
                    baseCamo = c.Length > 16 ? F(c[16]) : 1f,
                    commsRangeM = c.Length > 17 ? F(c[17]) : 9000f
                });
            }
        }

        void LoadArmor(string path)
        {
            var lines = ReadLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                Armors.Add(new ArmorDef
                {
                    id = I(c[0]), name = c[1], yearAvailable = I(c[2]),
                    densityKgPerM2PerMm = F(c[3]), qualityFactor = F(c[4]), costPerT = F(c[5])
                });
            }
        }

        void LoadDrones(string path)
        {
            var lines = ReadLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                Drones.Add(new DroneDef
                {
                    id = I(c[0]), name = c[1], role = E<DroneRole>(c[2]), yearAvailable = I(c[3]),
                    speedKmh = F(c[4]), rangeM = F(c[5]), loiterMin = F(c[6]), altitudeM = F(c[7]),
                    payloadKg = F(c[8]), payloadType = E<PayloadType>(c[9]),
                    controlLink = E<ControlLink>(c[10]), autonomy = E<Autonomy>(c[11]), cost = F(c[12])
                });
            }
        }

        void LoadEw(string path)
        {
            var lines = ReadLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                EwModules.Add(new EwDef
                {
                    id = I(c[0]), name = c[1], type = E<EwType>(c[2]), yearAvailable = I(c[3]),
                    radiusM = F(c[4]), strength = F(c[5]), weightT = F(c[6]), cost = F(c[7])
                });
            }
        }

        void LoadNations(string path)
        {
            var lines = ReadLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                // traits column may contain semicolons; it is the LAST column.
                string traitsRaw = c.Length > 11 ? c[11] : "";
                Nations.Add(new NationDef
                {
                    id = I(c[0]), name = c[1], accuracy = F(c[2]), damageControl = F(c[3]),
                    armorQuality = F(c[4]), fireControl = F(c[5]), droneDoctrine = F(c[6]),
                    ewStrength = F(c[7]), fabricationEfficiency = F(c[8]), researchSpeed = F(c[9]),
                    startingYear = I(c[10]),
                    traits = traitsRaw.Split(';', StringSplitOptions.RemoveEmptyEntries)
                });
            }
        }

        static PenTable LoadPenTable(string path)
        {
            var t = new PenTable();
            var lines = ReadLines(path);
            if (lines.Length == 0) return t;
            var header = lines[0].Split(',');
            t.ranges = new float[header.Length - 1];
            for (int j = 1; j < header.Length; j++) t.ranges[j - 1] = F(header[j]);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                t.calibers.Add(F(c[0]));
                var row = new float[c.Length - 1];
                for (int j = 1; j < c.Length; j++) row[j - 1] = F(c[j]);
                t.rows.Add(row);
            }
            return t;
        }

        // ---- Convenience lookups ----

        public GunDef GunById(int id) => Guns.Find(g => g.id == id);
        public ChassisDef ChassisById(int id) => Chassis.Find(c => c.id == id);
        public NationDef NationById(int id) => Nations.Find(n => n.id == id);

        public IEnumerable<GunDef> GunsAvailable(int year)
        {
            foreach (var g in Guns) if (g.yearAvailable <= year) yield return g;
        }
        public IEnumerable<ChassisDef> ChassisAvailable(int year)
        {
            foreach (var c in Chassis) if (c.yearAvailable <= year) yield return c;
        }
        public IEnumerable<DroneDef> DronesAvailable(int year)
        {
            foreach (var d in Drones) if (d.yearAvailable <= year) yield return d;
        }
    }
}
