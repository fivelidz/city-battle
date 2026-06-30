// CITY BATTLE — Integration tests: prove the five components share one data model and that a
// designed mecha flows Design -> (save/load) -> Production -> Roster -> Battle correctly.
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Design;
using CityBattle.Campaign;
using CityBattle.Combat;
using CityBattle.Terrain;
using CityBattle.Units;

namespace CityBattle.Tests
{
    public class IntegrationTests
    {
        Database _db;
        TechTree _tree;
        [SetUp] public void Setup() { _db = Database.Load(); _tree = TechTree.Load(); }

        MechaDesign GoodDesign()
        {
            var line = _db.Chassis.Find(c => c.cls == ChassisClass.Line);
            var gun = _db.Guns.Find(g => g.name.Contains("155"));
            var d = new MechaDesign {
                designName = "TESTPATTERN", chassisId = line.id, armorMaterialId = _db.Armors[0].id,
                carapaceMm = 40, glacisMm = 150, flankMm = 100, legsMm = 50, cupolaMm = 80, mantletMm = 120 };
            d.weaponGunIds.Add(gun.id);
            return d;
        }

        // ---- Schema: new chassis attributes load ----
        [Test]
        public void Chassis_NewAttributes_Loaded()
        {
            var siege = _db.Chassis.Find(c => c.cls == ChassisClass.Siege);
            Assert.Greater(siege.maxMountCaliberMm, 100f, "Siege chassis should allow big guns.");
            Assert.Greater(siege.crew, 0, "Crew should load.");
            Assert.Greater(siege.powerOutput, 0f, "Power output should load.");

            var skirm = _db.Chassis.Find(c => c.cls == ChassisClass.Skirmisher);
            Assert.Less(skirm.maxMountCaliberMm, siege.maxMountCaliberMm,
                "A skirmisher's mount caliber limit should be below a siege chassis.");
        }

        // ---- Design: caliber gate enforced ----
        [Test]
        public void Design_OversizedGun_RejectedByMountLimit()
        {
            var skirm = _db.Chassis.Find(c => c.cls == ChassisClass.Skirmisher);
            var bigGun = _db.Guns.Find(g => g.name.Contains("305"));   // 305mm siege gun
            var d = new MechaDesign { designName = "BAD", chassisId = skirm.id, armorMaterialId = _db.Armors[0].id,
                carapaceMm = 20, glacisMm = 40, flankMm = 30, legsMm = 20, cupolaMm = 20, mantletMm = 30 };
            d.weaponGunIds.Add(bigGun.id);
            var v = d.Validate(_db, 2040);
            Assert.IsFalse(v.ok, "A 305mm on a skirmisher must be rejected.");
            Assert.IsTrue(v.errors.Exists(e => e.Contains("mount limit")), "Should cite the mount caliber limit.");
        }

        // ---- Design -> JSON -> instantiate -> battle unit ----
        [Test]
        public void Design_FlowsTo_BattleUnit_WithCorrectStats()
        {
            var d = GoodDesign();
            string json = d.ToJson();
            var d2 = MechaDesign.FromJson(json);

            var nation = _db.Nations[0];
            var u = d2.Instantiate(_db, 0, nation, Vector3.zero);
            u.EnsureSystems();

            Assert.AreEqual(d.glacisMm, u.Armor.glacis, 0.01f, "Armour carries into the battle unit.");
            Assert.AreEqual(1, u.Weapons.Count, "The fitted gun carries into the battle unit.");
            Assert.AreEqual(d.designName, u.Name);
            Assert.IsNotNull(u.Sys, "Battle unit has a subsystems model.");
        }

        // ---- Campaign: produce a design -> roster -> deploy into a battle and it fights ----
        [Test]
        public void Campaign_Produce_Deploy_Fights()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 1);
            var d = GoodDesign();
            cs.Designs.Add(d);
            Assert.IsTrue(cs.QueueProduction(_db, d, 1), "Valid design should queue.");

            int before = cs.Roster.Count;
            for (int m = 0; m < 60 && cs.Roster.Count == before; m++)
                cs.AdvanceMonth(_db, _tree, income: 9000f, buildSpend: 9000f);
            Assert.Greater(cs.Roster.Count, before, "Production delivered a unit to the roster.");

            // Deploy the roster unit's design into a battle vs an enemy and confirm it can engage.
            var roster = cs.Roster[cs.Roster.Count - 1];
            var rDesign = MechaDesign.FromJson(roster.designJson);

            int n = 120; float cell = 12f; var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++) hm[x, z] = 10f;
            var terrain = new TerrainField(hm, cell, Vector3.zero);
            var sim = new BattleSim(terrain, 99);

            var mine = rDesign.Instantiate(_db, 0, _db.Nations[0], new Vector3(600, 0, 400));
            mine.Id = 1; mine.EnsureSystems(); mine.Position = terrain.ClampToGround(mine.Position); mine.PrevPosition = mine.Position;
            sim.Units.Add(mine);

            var foeDesign = GoodDesign();
            var foe = foeDesign.Instantiate(_db, 1, _db.Nations[1], new Vector3(600, 0, 900));
            foe.Id = 2; foe.EnsureSystems(); foe.Position = terrain.ClampToGround(foe.Position); foe.PrevPosition = foe.Position;
            sim.Units.Add(foe);

            mine.FireTarget = foe; mine.Fire = FireMode.Direct;
            float foeStart = foe.Structure;
            for (int i = 0; i < 1500; i++) sim.Tick();
            Assert.Less(foe.Structure, foeStart, "A produced+deployed design should fight and deal damage.");
        }

        // ---- GameState save/load round-trips the whole game ----
        [Test]
        public void GameState_CampaignSaveLoad_RoundTrips()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 2);
            cs.Designs.Add(GoodDesign());
            cs.AdvanceMonth(_db, _tree);
            string json = cs.ToJson();
            var cs2 = CampaignState.FromJson(json);
            Assert.AreEqual(cs.PlayerNationId, cs2.PlayerNationId);
            Assert.AreEqual(cs.Designs.Count, cs2.Designs.Count);
            Assert.AreEqual(cs.Year, cs2.Year);
        }
    }
}
