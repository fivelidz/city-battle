// CITY BATTLE — tests for ObjectiveSystem: scenario win/lose resolution (eliminate, hold-flag,
// escort) including the hold timer, contested bleed, convoy arrival/loss, and universal defeat.
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat;

namespace CityBattle.Tests
{
    public class ObjectiveTests
    {
        Database _db;
        [SetUp] public void Setup() => _db = Database.Load();

        TerrainField Flat(int n = 200, float cell = 12f, float h = 10f)
        {
            var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++) hm[x, z] = h;
            return new TerrainField(hm, cell, Vector3.zero);
        }

        MechaUnit Mk(BattleSim sim, string name, int team, Vector3 pos)
        {
            var chassis = _db.Chassis.Find(c => c.cls == ChassisClass.Line);
            var gun = _db.Guns.Find(g => g.name.Contains("155"));
            pos.y = sim.Terrain.HeightAt(pos.x, pos.z);
            var u = new MechaUnit { Id = sim.Units.Count + 1, Name = name, Team = team, Chassis = chassis,
                Armor = ArmorScheme.Dreadnought, Nation = _db.Nations[0], ArmorMaterial = _db.Armors[0],
                Position = pos, PrevPosition = pos, EyeHeight = 8f,
                CommsRangeM = chassis.commsRangeM > 0 ? chassis.commsRangeM : 9000f };
            u.Weapons.Add(new WeaponInstance { def = gun });
            u.EnsureSystems();
            sim.Units.Add(u);
            return u;
        }

        // Build a sim + objective tracking against a tiny custom scenario.
        BattleSim Begin(WinCondition win)
        {
            var sim = new BattleSim(Flat(), 1);
            var sc = new Scenario { Id = "test", Title = "Test", Win = win };
            sim.Objectives.Begin(sim, sc);
            return sim;
        }

        // ---- Eliminate ----
        [Test]
        public void Eliminate_VictoryWhenEnemyGone()
        {
            var sim = Begin(WinCondition.Eliminate);
            Mk(sim, "P1", 0, new Vector3(300, 0, 300));
            var foe = Mk(sim, "E1", 1, new Vector3(900, 0, 900));
            sim.Objectives.Tick(0.1f);
            Assert.AreEqual(BattleOutcome.InProgress, sim.Objectives.Outcome, "Still fighting while enemy alive.");
            foe.Structure = 0f;   // knock out the last enemy
            sim.Objectives.Tick(0.1f);
            Assert.AreEqual(BattleOutcome.Victory, sim.Objectives.Outcome, "Win when the enemy force is eliminated.");
        }

        [Test]
        public void Eliminate_DefeatWhenPlayerForceWiped()
        {
            var sim = Begin(WinCondition.Eliminate);
            var p = Mk(sim, "P1", 0, new Vector3(300, 0, 300));
            Mk(sim, "E1", 1, new Vector3(900, 0, 900));
            p.Structure = 0f;
            sim.Objectives.Tick(0.1f);
            Assert.AreEqual(BattleOutcome.Defeat, sim.Objectives.Outcome, "Losing the whole player force is a universal defeat.");
        }

        // ---- HoldFlag ----
        [Test]
        public void HoldFlag_AccruesTimerAndWins()
        {
            var sim = Begin(WinCondition.HoldFlag);
            sim.Objectives.HoldRequiredS = 5f;
            var flagPos = new Vector3(800, 0, 800);
            sim.Command.PlaceFlag("HOLD", new Vector3(flagPos.x, sim.Terrain.HeightAt(flagPos.x, flagPos.z), flagPos.z), FlagKind.Hold, 0);
            Mk(sim, "P1", 0, flagPos);                          // standing on the objective
            Mk(sim, "E1", 1, new Vector3(100, 0, 100));         // enemy far away, not contesting
            for (int i = 0; i < 60; i++) sim.Objectives.Tick(0.1f);   // 6s of holding uncontested
            Assert.AreEqual(BattleOutcome.Victory, sim.Objectives.Outcome, "Holding the flag long enough wins.");
        }

        [Test]
        public void HoldFlag_ContestedBleedsTheTimer()
        {
            var sim = Begin(WinCondition.HoldFlag);
            sim.Objectives.HoldRequiredS = 30f;
            var flagPos = new Vector3(800, 0, 800);
            sim.Command.PlaceFlag("HOLD", new Vector3(flagPos.x, sim.Terrain.HeightAt(flagPos.x, flagPos.z), flagPos.z), FlagKind.Hold, 0);
            Mk(sim, "P1", 0, flagPos);
            Mk(sim, "E1", 1, flagPos + new Vector3(50, 0, 0));   // enemy on the flag too -> contested
            for (int i = 0; i < 50; i++) sim.Objectives.Tick(0.1f);
            Assert.AreEqual(0f, sim.Objectives.HoldTimer, 0.001f, "A contested objective does not accrue and bleeds to zero.");
            Assert.AreEqual(BattleOutcome.InProgress, sim.Objectives.Outcome, "No win while contested.");
        }

        // ---- Escort ----
        [Test]
        public void Escort_WinsWhenConvoyReachesExit()
        {
            var sim = Begin(WinCondition.Escort);
            var exit = new Vector3(900, 0, 900);
            sim.Command.PlaceFlag("EXIT", new Vector3(exit.x, sim.Terrain.HeightAt(exit.x, exit.z), exit.z), FlagKind.Move, 0);
            var convoy = Mk(sim, "CONVOY-01", 0, new Vector3(300, 0, 300));
            sim.Objectives.Tick(0.1f);
            Assert.AreEqual(BattleOutcome.InProgress, sim.Objectives.Outcome, "Not won until the convoy arrives.");
            convoy.Position = new Vector3(exit.x, sim.Terrain.HeightAt(exit.x, exit.z), exit.z);  // teleport to exit
            sim.Objectives.Tick(0.1f);
            Assert.AreEqual(BattleOutcome.Victory, sim.Objectives.Outcome, "Convoy reaching the exit wins the escort.");
        }

        [Test]
        public void Escort_DefeatWhenConvoyLost()
        {
            var sim = Begin(WinCondition.Escort);
            var exit = new Vector3(900, 0, 900);
            sim.Command.PlaceFlag("EXIT", new Vector3(exit.x, sim.Terrain.HeightAt(exit.x, exit.z), exit.z), FlagKind.Move, 0);
            var convoy = Mk(sim, "CONVOY-01", 0, new Vector3(300, 0, 300));
            Mk(sim, "ESCORT-02", 0, new Vector3(350, 0, 300));   // keep player force alive so it's not a *force* wipe
            convoy.Structure = 0f;
            sim.Objectives.Tick(0.1f);
            Assert.AreEqual(BattleOutcome.Defeat, sim.Objectives.Outcome, "Losing the convoy is a defeat.");
        }

        // ---- Lifecycle ----
        [Test]
        public void Begin_ResetsOutcomeAndTimer()
        {
            var sim = Begin(WinCondition.HoldFlag);
            sim.Objectives.HoldTimer = 12f;
            sim.Objectives.Outcome = BattleOutcome.Victory;
            sim.Objectives.Begin(sim, new Scenario { Id = "t2", Title = "T2", Win = WinCondition.Eliminate });
            Assert.AreEqual(0f, sim.Objectives.HoldTimer, "Begin clears the hold timer.");
            Assert.AreEqual(BattleOutcome.InProgress, sim.Objectives.Outcome, "Begin resets the outcome.");
        }
    }
}
