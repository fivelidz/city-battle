// CITY BATTLE — MechaDesign: a player-authored mecha blueprint (the DESIGN pillar).
// Mirrors Rule the Waves 3 ship design: pick a chassis (a mass + cost budget), then spend it
// across armour (per-zone thickness), weapons (placed on sockets), drone bays and EW modules.
// A design is data only -> the battlefield MechaUnit, the design screen, and the save file all
// read from this same blueprint (docs/DESIGN.md 1, 8). Serialises to JSON.
using System;
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Units;

namespace CityBattle.Design
{
    [Serializable]
    public class MechaDesign
    {
        public string designName = "NEW PATTERN";
        public int chassisId;
        public int armorMaterialId;

        // Per-zone armour thickness in mm (player allocates these; mass derives from them).
        public float carapaceMm = 40f;
        public float glacisMm = 150f;
        public float flankMm = 100f;
        public float legsMm = 50f;
        public float cupolaMm = 80f;
        public float mantletMm = 120f;

        public List<int> weaponGunIds = new();   // one per occupied weapon mount
        public List<int> droneIds = new();        // drones carried (bays)
        public List<int> ewIds = new();           // EW modules on utility mounts

        // ---- Derived analysis (computed against the Database) ----

        public ChassisDef Chassis(Database db) => db.ChassisById(chassisId);
        public ArmorDef ArmorMat(Database db) =>
            db.Armors.Find(a => a.id == armorMaterialId);

        /// <summary>Approx surface area (m^2) per zone for mass calc — scales with chassis size.</summary>
        static (float carapace, float glacis, float flank, float legs, float cupola, float mantlet)
            ZoneAreas(ChassisDef c)
        {
            float s = Mathf.Pow(c.massBudgetT / 100f, 0.5f); // size factor
            return (carapace: 28f * s, glacis: 16f * s, flank: 14f * s,
                    legs: 10f * s, cupola: 4f * s, mantlet: 6f * s);
        }

        public float ArmorMassT(Database db)
        {
            var c = Chassis(db);
            var mat = ArmorMat(db);
            float density = mat.densityKgPerM2PerMm <= 0 ? 7.85f : mat.densityKgPerM2PerMm; // kg per m^2 per mm
            var a = ZoneAreas(c);
            float kg = density * (
                a.carapace * carapaceMm + a.glacis * glacisMm + a.flank * 2f * flankMm +
                a.legs * legsMm + a.cupola * cupolaMm + a.mantlet * mantletMm);
            return kg / 1000f;
        }

        public float WeaponMassT(Database db)
        {
            float m = 0f;
            foreach (var id in weaponGunIds) m += db.GunById(id).weightT;
            return m;
        }

        public float EwMassT(Database db)
        {
            float m = 0f;
            foreach (var id in ewIds) { var e = db.EwModules.Find(x => x.id == id); m += e.weightT; }
            return m;
        }

        public float DroneMassT(Database db)
        {
            // Each drone bay adds a nominal 1.5t handling+launch mass plus payload.
            float m = 0f;
            foreach (var id in droneIds) { var d = db.Drones.Find(x => x.id == id); m += 1.5f + d.payloadKg / 1000f; }
            return m;
        }

        public float TotalMassT(Database db) =>
            ArmorMassT(db) + WeaponMassT(db) + EwMassT(db) + DroneMassT(db);

        public float TotalCost(Database db)
        {
            var c = Chassis(db);
            float cost = c.cost;
            foreach (var id in weaponGunIds) cost += db.GunById(id).cost;
            foreach (var id in ewIds) { var e = db.EwModules.Find(x => x.id == id); cost += e.cost; }
            foreach (var id in droneIds) { var d = db.Drones.Find(x => x.id == id); cost += d.cost; }
            var mat = ArmorMat(db);
            cost += ArmorMassT(db) * (mat.costPerT <= 0 ? 1f : mat.costPerT);
            return cost;
        }

        // ---- Validation (the budget gate — like RtW3 telling you the design is overweight) ----

        public class Validation
        {
            public bool ok;
            public List<string> errors = new();
            public List<string> warnings = new();
            public float massUsedT, massBudgetT, costTotal;
            public int weaponMounts, weaponMountsUsed, utilityMounts, utilityMountsUsed;
        }

        public Validation Validate(Database db, int currentYear = 2070)
        {
            var v = new Validation();
            var c = Chassis(db);
            if (c.name == null) { v.errors.Add("No chassis selected."); v.ok = false; return v; }

            v.massBudgetT = c.massBudgetT;
            v.massUsedT = TotalMassT(db);
            v.costTotal = TotalCost(db);
            v.weaponMounts = c.numWeaponMounts;
            v.weaponMountsUsed = weaponGunIds.Count;
            v.utilityMounts = c.numUtilityMounts;
            v.utilityMountsUsed = ewIds.Count + droneIds.Count;

            if (v.massUsedT > v.massBudgetT)
                v.errors.Add($"OVERWEIGHT: {v.massUsedT:0.0}t / {v.massBudgetT:0.0}t budget.");
            if (v.weaponMountsUsed > v.weaponMounts)
                v.errors.Add($"Too many weapons: {v.weaponMountsUsed}/{v.weaponMounts} mounts.");
            if (v.utilityMountsUsed > v.utilityMounts)
                v.errors.Add($"Too many utility modules: {v.utilityMountsUsed}/{v.utilityMounts} mounts.");

            // Year-gating (can't fit tech that isn't researched/available yet).
            if (c.yearAvailable > currentYear) v.errors.Add($"Chassis not available until {c.yearAvailable}.");
            foreach (var id in weaponGunIds)
            {
                var g = db.GunById(id);
                if (g.yearAvailable > currentYear) v.warnings.Add($"{g.name} not available until {g.yearAvailable}.");
                // Mount caliber limit: a light chassis can't carry a siege gun.
                float maxCal = c.maxMountCaliberMm > 0 ? c.maxMountCaliberMm : 999f;
                if (g.caliberMm > maxCal)
                    v.errors.Add($"{g.name} ({g.caliberMm:0}mm) exceeds {c.name} mount limit {maxCal:0}mm.");
                // Energy weapons need reactor power.
                if ((g.type == GunType.Rail || g.type == GunType.Coil) && c.powerOutput < g.caliberMm * 1.5f)
                    v.warnings.Add($"{g.name} may strain the powerplant (needs more power output).");
            }

            // Heuristic balance warnings.
            float massFrac = v.massUsedT / Mathf.Max(1f, v.massBudgetT);
            if (massFrac < 0.5f) v.warnings.Add("Under-utilised: more than half the mass budget is unused.");
            if (weaponGunIds.Count == 0) v.warnings.Add("Unarmed: no weapons fitted.");

            v.ok = v.errors.Count == 0;
            return v;
        }

        // ---- Build a runtime unit from this design ----

        public MechaUnit Instantiate(Database db, int team, NationDef nation, Vector3 pos)
        {
            var c = Chassis(db);
            var u = new MechaUnit
            {
                Name = designName, Team = team, Chassis = c, Nation = nation,
                ArmorMaterial = ArmorMat(db),
                Armor = new ArmorScheme
                {
                    carapace = carapaceMm, glacis = glacisMm, flank = flankMm,
                    legs = legsMm, cupola = cupolaMm, mantlet = mantletMm
                },
                Position = pos, PrevPosition = pos,
                EyeHeight = Mathf.Clamp(c.massBudgetT / 30f, 4f, 12f)
            };
            int socket = 0;
            foreach (var gid in weaponGunIds)
                u.Weapons.Add(new WeaponInstance { def = db.GunById(gid), mountSocket = socket++ });
            foreach (var eid in ewIds)
            { var e = db.EwModules.Find(x => x.id == eid); u.EwModules.Add(e); }
            return u;
        }

        // ---- Persistence ----

        public string ToJson() => JsonUtility.ToJson(this, true);
        public static MechaDesign FromJson(string json) => JsonUtility.FromJson<MechaDesign>(json);
    }
}
