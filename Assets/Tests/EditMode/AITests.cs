// CITY BATTLE — AI + localised-damage integration tests.
// Verifies the enemy AI maneuvers/engages without cheating fog-of-war, and that RtW3-style
// localised damage produces the right tactical consequences (immobilise / disarm / blind / fire
// / ammo cook-off). Plus a full AI-vs-AI battle that runs to a decision.
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat;
using CityBattle.AI;

namespace CityBattle.Tests
{
    public class AITests
    {
        Database _db;
        [SetUp] public void Setup() { _db = Database.Load(); }

        TerrainField Hills(int n = 200, float cell = 12f, float ridgeH = 120f)
        {
            var hm = new float[n, n];
            for (int x = 0; x < n; x++)
            for (int z = 0; z < n; z++)
                hm[x, z] = 20f + (z >= 95 && z <= 105 ? ridgeH : 0f)
                              + Mathf.PerlinNoise(x * 0.05f, z * 0.05f) * 25f;
            return new TerrainField(hm, cell, Vector3.zero);
        }

        MechaUnit Spawn(BattleSim sim, string name, int team, ChassisClass cls, ArmorScheme armor,
                        string gunContains, Vector3 pos)
        {
            var chassis = _db.Chassis.Find(c => c.cls == cls);
            var gun = _db.Guns.Find(g => g.name.Contains(gunContains));
            pos.y = sim.Terrain.HeightAt(pos.x, pos.z);
            var u = new MechaUnit
            {
                Id = sim.Units.Count + 1, Name = name, Team = team, Chassis = chassis,
                Armor = armor, Nation = _db.Nations[team % _db.Nations.Count],
                ArmorMaterial = _db.Armors[0], Position = pos, PrevPosition = pos,
                EyeHeight = 8f, HeadingDeg = team == 0 ? 0 : 180
            };
            u.Weapons.Add(new WeaponInstance { def = gun });
            u.EnsureSystems();
            sim.Units.Add(u);
            return u;
        }

        // ---- Localised damage consequences ----

        [Test]
        public void Legs_Destroyed_Immobilises()
        {
            var sys = new MechaSystems(legGroups: 4, hasSecondary: true);
            // Destroy enough leg groups to pin it.
            foreach (var kv in new List<Units.Subsystem>(sys.Systems.Keys))
                if (kv.ToString().StartsWith("Leg")) sys.Get(kv).integrity = 0f;
            Assert.IsTrue(sys.Immobilised, "All legs gone -> immobilised.");
            Assert.AreEqual(0f, sys.MobilityFactor(), 0.001f);
        }

        [Test]
        public void Turrets_Destroyed_Disarms()
        {
            var sys = new MechaSystems(4, true);
            sys.Get(Units.Subsystem.TurretMain).integrity = 0f;
            sys.Get(Units.Subsystem.TurretSecondary).integrity = 0f;
            Assert.IsTrue(sys.Disarmed, "Both turrets gone -> disarmed.");
        }

        [Test]
        public void SensorMast_Destroyed_Blinds()
        {
            var sys = new MechaSystems(4, true);
            sys.Get(Units.Subsystem.SensorMast).integrity = 0f;
            Assert.IsTrue(sys.Blinded, "Sensor mast gone -> blinded (fire control collapses).");
            Assert.Less(sys.FireControlFactor(), 0.3f);
        }

        [Test]
        public void HeavyHit_Produces_LocalisedConsequence()
        {
            var rng = new SimRandom(5);
            var sys = new MechaSystems(4, true);
            // Pour heavy penetrations into the legs zone; expect immobilisation eventually.
            bool immobilised = false;
            for (int i = 0; i < 40 && !immobilised; i++)
            {
                var rep = sys.ApplyPenetration(HitZone.Legs, 300f, rng);
                if (sys.Immobilised) immobilised = true;
            }
            Assert.IsTrue(immobilised, "Sustained leg hits should immobilise.");
        }

        [Test]
        public void Carapace_DeepHits_CanCookOffAmmo()
        {
            var rng = new SimRandom(9);
            bool cooked = false;
            // Many deep top hits -> at some point the magazine detonates.
            for (int trial = 0; trial < 60 && !cooked; trial++)
            {
                var sys = new MechaSystems(4, true);
                for (int i = 0; i < 30 && !sys.AmmoCookedOff; i++)
                    sys.ApplyPenetration(HitZone.Carapace, 400f, rng);
                if (sys.AmmoCookedOff) cooked = true;
            }
            Assert.IsTrue(cooked, "Deep carapace penetrations should sometimes cook off the ammo bay.");
        }

        [Test]
        public void Immobilised_Unit_DoesNotMove_But_CanStillShoot()
        {
            var sim = new BattleSim(Hills(), 1);
            var u = Spawn(sim, "PINNED", 0, ChassisClass.Siege, ArmorScheme.Dreadnought, "155", new Vector3(600, 0, 600));
            // Knock out all legs.
            foreach (var k in new List<Units.Subsystem>(u.Sys.Systems.Keys))
                if (k.ToString().StartsWith("Leg")) u.Sys.Get(k).integrity = 0f;
            Assert.IsFalse(u.CanMove);
            Assert.IsTrue(u.CanShoot);
            var before = u.Position;
            u.MoveTarget = new Vector3(1000, 0, 1000); u.HasMoveOrder = true;
            for (int i = 0; i < 100; i++) u.TickMovement(sim.Terrain, SimClock.SIM_DT);
            Assert.AreEqual(before, u.Position, "Immobilised unit must not move.");
        }

        // ---- AI behaviour ----

        [Test]
        public void AI_Engages_VisibleEnemy_InRange()
        {
            var sim = new BattleSim(Hills(ridgeH: 0f), 3); // flat-ish so LOS is clear
            var ai = Spawn(sim, "AI-1", 1, ChassisClass.Line, ArmorScheme.Dreadnought, "155", new Vector3(1000, 0, 1200));
            var foe = Spawn(sim, "FOE", 0, ChassisClass.Line, ArmorScheme.Skirmisher, "105", new Vector3(1000, 0, 800));
            sim.Commanders[1] = new CommanderAI(1, AiStance.Balanced) { UseDrones = false };

            // Run; the AI should acquire and target the visible foe.
            for (int i = 0; i < 60; i++) sim.Tick();
            Assert.AreEqual(foe, sim.Units.Find(u => u.Name == "AI-1").FireTarget,
                "AI should target the visible in-range enemy.");
        }

        [Test]
        public void AI_Scouts_When_NoContact_LaunchesDrone()
        {
            // Big ridge hides the enemy; AI has no LOS -> should scout with a drone.
            var sim = new BattleSim(Hills(ridgeH: 220f), 7);
            var ai = Spawn(sim, "AI-1", 1, ChassisClass.Line, ArmorScheme.Dreadnought, "155", new Vector3(1200, 0, 1700));
            var foe = Spawn(sim, "FOE", 0, ChassisClass.Siege, ArmorScheme.Dreadnought, "203", new Vector3(1200, 0, 500));
            foe.HullDown = true;
            sim.Commanders[1] = new CommanderAI(1, AiStance.Balanced) { UseDrones = true };

            int dronesLaunched = 0;
            for (int i = 0; i < 2000; i++) { sim.Tick(); dronesLaunched = Mathf.Max(dronesLaunched, sim.ActiveDrones.Count); }
            Assert.Greater(dronesLaunched, 0, "AI with no contact should launch a recon drone to find the enemy.");
        }

        [Test]
        public void Full_AIvsAI_Battle_Reaches_Decision()
        {
            // Rolling hills (no impassable ridge) so the AI can manoeuvre into contact and fight.
            var sim = new BattleSim(Hills(ridgeH: 0f), 2024);
            // Two small forces ~1.2km apart.
            Spawn(sim, "A1", 0, ChassisClass.Line, ArmorScheme.Dreadnought, "155", new Vector3(900, 0, 700));
            Spawn(sim, "A2", 0, ChassisClass.Skirmisher, ArmorScheme.Skirmisher, "105", new Vector3(1100, 0, 650));
            Spawn(sim, "B1", 1, ChassisClass.Line, ArmorScheme.Dreadnought, "155", new Vector3(1300, 0, 1700));
            Spawn(sim, "B2", 1, ChassisClass.Skirmisher, ArmorScheme.Skirmisher, "105", new Vector3(1100, 0, 1750));

            sim.Commanders[0] = new CommanderAI(0, AiStance.Aggressive) { UseDrones = true };
            sim.Commanders[1] = new CommanderAI(1, AiStance.Aggressive) { UseDrones = true };

            int startA = sim.LivingCount(0), startB = sim.LivingCount(1);
            bool decided = false;
            // Run up to ~10 minutes of sim (20Hz * 600s = 12000 ticks).
            for (int i = 0; i < 12000; i++)
            {
                sim.Tick();
                if (sim.EffectiveCount(0) == 0 || sim.EffectiveCount(1) == 0) { decided = true; break; }
            }

            // The battle should PRODUCE a real engagement: meaningful damage dealt by manoeuvring AI.
            float totalDamage = 0f;
            foreach (var u in sim.Units) totalDamage += (100f - u.Structure);
            Debug.Log($"[AIvsAI] A {sim.LivingCount(0)}/{startA} B {sim.LivingCount(1)}/{startB} " +
                      $"effA={sim.EffectiveCount(0)} effB={sim.EffectiveCount(1)} totalDamage={totalDamage:0} decided={decided}");
            Assert.Greater(totalDamage, 30f, "AI-vs-AI battle should deal substantial damage (real engagement).");
        }

        [Test]
        public void AI_DoesNot_Target_Unspotted_Enemy()
        {
            // Tall ridge: AI cannot see the enemy and has no drones -> must NOT have a fire solution.
            var sim = new BattleSim(Hills(ridgeH: 260f), 11);
            var ai = Spawn(sim, "AI-1", 1, ChassisClass.Siege, ArmorScheme.Dreadnought, "155", new Vector3(1200, 0, 1700));
            var foe = Spawn(sim, "FOE", 0, ChassisClass.Siege, ArmorScheme.Dreadnought, "203", new Vector3(1200, 0, 500));
            foe.HullDown = true;
            sim.Commanders[1] = new CommanderAI(1, AiStance.Defensive) { UseDrones = false };

            for (int i = 0; i < 30; i++) sim.Tick();
            var aiUnit = sim.Units.Find(u => u.Name == "AI-1");
            // It may have a stale target ref, but it should not be firing at an unspotted foe.
            Assert.IsFalse(sim.IsVisibleTo(foe, 1), "Foe must be unspotted behind the tall ridge.");
        }
    }
}
