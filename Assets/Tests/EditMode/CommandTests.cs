// CITY BATTLE — tests for the command layer: flags, flagship, formations, best-engage, scenarios.
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat;

namespace CityBattle.Tests
{
    public class CommandTests
    {
        Database _db;
        [SetUp] public void Setup() => _db = Database.Load();

        TerrainField Flat(int n = 200, float cell = 12f, float h = 10f)
        {
            var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++) hm[x, z] = h;
            return new TerrainField(hm, cell, Vector3.zero);
        }

        MechaUnit Mk(BattleSim sim, string name, int team, ChassisClass cls, Vector3 pos)
        {
            var chassis = _db.Chassis.Find(c => c.cls == cls);
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

        // ---- Flags ----
        [Test]
        public void Flag_AssignMovesUnitToFlag()
        {
            var sim = new BattleSim(Flat(), 1);
            var u = Mk(sim, "U1", 0, ChassisClass.Line, new Vector3(300, 0, 300));
            var flag = sim.Command.PlaceFlag("ALPHA", new Vector3(900, 0, 900), FlagKind.Move, 0);
            sim.Command.Assign(u, flag);
            Assert.IsTrue(u.HasMoveOrder, "Assigning a flag orders the unit to move.");
            Assert.AreEqual(flag, sim.Command.FlagOf(u), "Unit is registered to its flag.");
            // Run; it should head toward the flag.
            float startDist = Vector3.Distance(u.Position, flag.Position);
            for (int i = 0; i < 2000; i++) u.TickMovement(sim.Terrain, SimClock.SIM_DT);
            Assert.Less(Vector3.Distance(u.Position, flag.Position), startDist, "Unit advances toward its flag.");
        }

        [Test]
        public void Flag_ReassignMovesBetweenFlags()
        {
            var sim = new BattleSim(Flat(), 1);
            var u = Mk(sim, "U1", 0, ChassisClass.Line, new Vector3(300, 0, 300));
            var a = sim.Command.PlaceFlag("A", new Vector3(900, 0, 300), FlagKind.Move, 0);
            var b = sim.Command.PlaceFlag("B", new Vector3(300, 0, 900), FlagKind.Move, 0);
            sim.Command.Assign(u, a);
            sim.Command.Assign(u, b);
            Assert.AreEqual(b, sim.Command.FlagOf(u), "Reassigning moves the unit to the new flag only.");
            Assert.IsFalse(a.Assigned.Contains(u), "Unit removed from the old flag.");
        }

        // ---- Flagship ----
        [Test]
        public void Flagship_AutoPicksAndAnchorsCommsNet()
        {
            var sim = new BattleSim(Flat(), 1);
            var lev = Mk(sim, "LEV", 0, ChassisClass.Siege, new Vector3(500, 0, 500));
            var jak = Mk(sim, "JAK", 0, ChassisClass.Skirmisher, new Vector3(700, 0, 500));
            var fs = sim.Command.AutoFlagship(sim.Units, 0);
            Assert.IsNotNull(fs, "A flagship is chosen.");
            // The big Siege (more mass + comms) should outrank the skirmisher.
            Assert.AreEqual(lev, fs, "Auto flagship favours the heavier, better-comms crab.");
        }

        [Test]
        public void Flagship_IsCommandNode_OnTheNet()
        {
            var sim = new BattleSim(Flat(), 1);
            var fs = Mk(sim, "FS", 0, ChassisClass.Line, new Vector3(500, 0, 500));
            var other = Mk(sim, "B", 0, ChassisClass.Line, new Vector3(800, 0, 500));
            sim.Command.SetFlagship(fs);
            for (int i = 0; i < 8; i++) sim.Tick();
            Assert.IsTrue(fs.OnNet, "Flagship is the command node, always on the net.");
            Assert.IsTrue(string.IsNullOrEmpty(fs.RelayVia), "Flagship relays directly (no upstream relay).");
        }

        // ---- Formations ----
        [Test]
        public void Formation_LineSpreadsUnitsAbreast()
        {
            var sim = new BattleSim(Flat(), 1);
            var group = new List<MechaUnit> {
                Mk(sim, "A", 0, ChassisClass.Line, new Vector3(300, 0, 300)),
                Mk(sim, "B", 0, ChassisClass.Line, new Vector3(360, 0, 300)),
                Mk(sim, "C", 0, ChassisClass.Line, new Vector3(420, 0, 300)),
            };
            sim.Command.Formation = Formation.Line;
            sim.Command.MoveFormation(group, new Vector3(1000, 0, 1000), sim.Terrain);
            // Each got a distinct destination spread perpendicular to travel.
            var d0 = group[0].MoveTarget; var d1 = group[1].MoveTarget; var d2 = group[2].MoveTarget;
            Assert.AreNotEqual(d0, d1); Assert.AreNotEqual(d1, d2);
            Assert.IsTrue(group[0].HasMoveOrder && group[2].HasMoveOrder, "All units in the group get move orders.");
        }

        // ---- Best engage ----
        [Test]
        public void BestEngage_ReturnsAReachablePositionWithLOS()
        {
            var sim = new BattleSim(Flat(), 1);
            var me = Mk(sim, "ME", 0, ChassisClass.Line, new Vector3(600, 0, 400));
            var foe = Mk(sim, "FOE", 1, ChassisClass.Line, new Vector3(600, 0, 1400));
            Vector3 spot = TacticalInfo.BestEngagePosition(sim, me, foe);
            Assert.IsTrue(sim.Terrain.InBounds(spot), "Engage position is on the map.");
            // From the suggested spot it should have LOS to the target on flat ground.
            Vector3 eye = spot + Vector3.up * me.EyeHeight;
            Assert.IsTrue(sim.Terrain.HasLineOfSight(eye, foe.EyePosition), "Suggested spot has LOS to the target.");
            float range = Vector3.Distance(spot, foe.Position);
            Assert.Less(range, me.Weapons[0].def.maxRangeM, "Suggested spot is within gun range.");
        }

        // ---- Scenarios ----
        [Test]
        public void Scenario_ExamplesBuildWithFlagshipAndFlags()
        {
            foreach (var make in Scenario.Examples)
            {
                var s = make();
                Assert.IsNotEmpty(s.Title);
                Assert.Greater(s.Units.Count, 1, $"{s.Id} has forces.");
                Assert.IsTrue(s.Units.Exists(u => u.team == 0), $"{s.Id} has a player force.");
                Assert.IsTrue(s.Units.Exists(u => u.team == 1), $"{s.Id} has an enemy force.");
                // Every example names a flagship and at least one objective flag.
                Assert.IsTrue(s.Units.Exists(u => u.flagship), $"{s.Id} designates a flagship.");
                Assert.Greater(s.Flags.Count, 0, $"{s.Id} has objective flags.");
                // Chassis & gun names must resolve to real data.
                foreach (var su in s.Units)
                {
                    Assert.IsNotNull(_db.Chassis.Find(c => c.name == su.chassisName), $"{su.name}: chassis '{su.chassisName}' exists");
                    Assert.IsNotNull(_db.Guns.Find(g => g.name == su.gunName).name, $"{su.name}: gun '{su.gunName}' exists");
                }
            }
        }
    }
}
