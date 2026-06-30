// CITY BATTLE — Design / Research / Campaign tests (the concurrent management layers).
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Design;
using CityBattle.Campaign;
using CityBattle.Sim;

namespace CityBattle.Tests
{
    public class CampaignTests
    {
        Database _db;
        TechTree _tree;
        [SetUp] public void Setup() { _db = Database.Load(); _tree = TechTree.Load(); }

        // ---- Design ----

        MechaDesign BaseDesign()
        {
            var siege = _db.Chassis.Find(c => c.cls == ChassisClass.Siege);
            var gun = _db.Guns.Find(g => g.name.Contains("155"));
            var d = new MechaDesign
            {
                designName = "TEST PATTERN", chassisId = siege.id,
                armorMaterialId = _db.Armors[0].id,
                carapaceMm = 50, glacisMm = 180, flankMm = 120, legsMm = 60, cupolaMm = 90, mantletMm = 140
            };
            d.weaponGunIds.Add(gun.id);
            return d;
        }

        [Test]
        public void Design_Validates_WithinBudget()
        {
            var d = BaseDesign();
            var v = d.Validate(_db, 2035);
            Assert.IsTrue(v.ok, "Reasonable design should validate. Errors: " + string.Join("; ", v.errors));
            Assert.Greater(v.massBudgetT, 0);
            Assert.Greater(v.costTotal, 0);
        }

        [Test]
        public void Design_Overweight_Fails()
        {
            var d = BaseDesign();
            d.glacisMm = 5000; d.carapaceMm = 5000; d.flankMm = 5000; // absurd armour
            var v = d.Validate(_db, 2035);
            Assert.IsFalse(v.ok, "Absurd armour should overflow the mass budget.");
            Assert.IsTrue(v.errors.Exists(e => e.Contains("OVERWEIGHT")));
        }

        [Test]
        public void Design_TooManyWeapons_Fails()
        {
            var d = BaseDesign();
            var gun = _db.Guns.Find(g => g.name.Contains("105"));
            var chassis = _db.ChassisById(d.chassisId);
            for (int i = 0; i < chassis.numWeaponMounts + 2; i++) d.weaponGunIds.Add(gun.id);
            var v = d.Validate(_db, 2035);
            Assert.IsFalse(v.ok);
        }

        [Test]
        public void Design_RoundTrips_Json()
        {
            var d = BaseDesign();
            string json = d.ToJson();
            var d2 = MechaDesign.FromJson(json);
            Assert.AreEqual(d.chassisId, d2.chassisId);
            Assert.AreEqual(d.weaponGunIds.Count, d2.weaponGunIds.Count);
            Assert.AreEqual(d.glacisMm, d2.glacisMm, 0.001f);
        }

        [Test]
        public void Design_Instantiates_RuntimeUnit()
        {
            var d = BaseDesign();
            var u = d.Instantiate(_db, 0, _db.Nations[0], Vector3.zero);
            Assert.AreEqual(1, u.Weapons.Count);
            Assert.AreEqual(d.glacisMm, u.Armor.glacis, 0.001f);
        }

        // ---- Research ----

        [Test]
        public void TechTree_Loads_AllBranches()
        {
            Assert.Greater(_tree.Techs.Count, 60, "Should load ~81 techs.");
            var branches = new List<string>(_tree.Branches());
            Assert.Contains("DRONES", branches);
            Assert.Contains("Electronic Warfare", branches);
        }

        [Test]
        public void Research_StartingTech_Granted()
        {
            var rs = new ResearchState();
            rs.GrantStartingTech(_tree);
            Assert.Greater(rs.Known.Count, 0, "Starting techs should be granted at game start.");
        }

        [Test]
        public void Research_Advances_And_Completes_OverTime()
        {
            var rs = new ResearchState { ResearchSpeed = 1f };
            rs.GrantStartingTech(_tree);
            // Fund every available 2030 tech and pour points in for many intervals.
            foreach (var t in rs.Available(_tree, 2030)) rs.Fund(t.techId);
            var rng = new SimRandom(42);
            int completed = 0;
            for (int i = 0; i < 240; i++) // ~20 years of monthly intervals
                completed += rs.Advance(_tree, 2030, 500f, rng).Count;
            Assert.Greater(completed, 0, "Funded research should complete some techs over time.");
        }

        // ---- Campaign ----

        [Test]
        public void Campaign_NewThenProduce_DeliversUnit()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 1);
            Assert.AreEqual(2025, cs.Year);

            var d = BaseDesign();
            Assert.IsTrue(cs.QueueProduction(_db, d, 1), "Valid design should queue.");
            Assert.AreEqual(1, cs.ProductionQueue.Count);

            int rosterBefore = cs.Roster.Count;
            // Advance enough months with generous build spend to finish the unit.
            for (int m = 0; m < 60 && cs.ProductionQueue.Count > 0; m++)
                cs.AdvanceMonth(_db, _tree, income: 8000f, buildSpend: 8000f);
            Assert.Greater(cs.Roster.Count, rosterBefore, "Production should deliver a unit to the roster.");
        }

        [Test]
        public void Campaign_RoundTrips_Json()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 2);
            cs.Designs.Add(BaseDesign());
            cs.AdvanceMonth(_db, _tree);
            string json = cs.ToJson();
            var cs2 = CampaignState.FromJson(json);
            Assert.AreEqual(cs.PlayerNationId, cs2.PlayerNationId);
            Assert.AreEqual(cs.Designs.Count, cs2.Designs.Count);
        }
    }
}
