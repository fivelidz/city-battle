// CITY BATTLE — tests for the new sim systems: amphibious/water movement, precipitation slowing,
// trajectory dead-space (direct blocked / mortar reaches), and the campaign prestige/VP/tension loop.
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat;
using CityBattle.Campaign;
using CityBattle.Design;

namespace CityBattle.Tests
{
    public class SystemsTests
    {
        Database _db;
        TechTree _tree;
        [SetUp] public void Setup() { _db = Database.Load(); _tree = TechTree.Load(); }

        TerrainField FlatWithChannel(float landH, float channelH, float waterLevel)
        {
            int n = 80; float cell = 12f;
            var hm = new float[n, n];
            for (int x = 0; x < n; x++)
            for (int z = 0; z < n; z++)
            {
                // A water channel across the middle with GENTLY-SLOPED banks (so wading crabs can
                // climb out — a vertical cliff would correctly be impassable).
                float h;
                if (z < 30) h = landH;
                else if (z < 40) h = Mathf.Lerp(landH, channelH, (z - 30) / 10f);   // descend into channel
                else if (z <= 50) h = channelH;
                else if (z < 60) h = Mathf.Lerp(channelH, landH, (z - 50) / 10f);   // climb out
                else h = landH;
                hm[x, z] = h;
            }
            var t = new TerrainField(hm, cell, Vector3.zero) { WaterLevelM = waterLevel };
            return t;
        }

        MechaUnit Mk(string name, ChassisClass cls, Vector3 pos, TerrainField t)
        {
            var chassis = _db.Chassis.Find(c => c.cls == cls);
            var gun = _db.Guns.Find(g => g.name.Contains("155"));
            pos.y = t.HeightAt(pos.x, pos.z);
            var u = new MechaUnit {
                Id = 1, Name = name, Team = 0, Chassis = chassis, Armor = ArmorScheme.Dreadnought,
                Nation = _db.Nations[0], ArmorMaterial = _db.Armors[0], Position = pos, PrevPosition = pos,
                EyeHeight = 8f };
            u.Weapons.Add(new WeaponInstance { def = gun });
            u.EnsureSystems();
            return u;
        }

        // ---- Water / amphibious ----
        [Test]
        public void NonAmphibious_BlockedByWater()
        {
            var t = FlatWithChannel(20f, -5f, 0f);   // channel at -5m, sea level 0 => water
            var u = Mk("DRY", ChassisClass.Line, new Vector3(400, 0, 300), t);  // south of channel
            u.Amphibious = false;
            u.SetMove(new Vector3(400, 0, 780));      // north, across the channel
            for (int i = 0; i < 1000; i++) u.TickMovement(t, SimClock.SIM_DT);
            // Stopped on the near shoreline before the deep water (water begins ~z=432m).
            Assert.Less(u.Position.z, 470f, "Non-amphibious crab must not cross the water channel.");
        }

        [Test]
        public void Amphibious_WadesShallowWater()
        {
            var t = FlatWithChannel(20f, -2f, 0f);   // shallow channel (-2m), wadeable
            var u = Mk("WADER", ChassisClass.Siege, new Vector3(400, 0, 300), t);
            u.Amphibious = true; u.MaxWadeDepthM = 4f;
            u.SetMove(new Vector3(400, 0, 780));
            for (int i = 0; i < 8000; i++) u.TickMovement(t, SimClock.SIM_DT);
            // Water spans roughly z=432..648m; reaching the far land (z>700) proves it forded.
            Assert.Greater(u.Position.z, 700f, "Amphibious crab should wade across the shallow channel to the far side.");
        }

        [Test]
        public void Amphibious_CrossesDeepWater()
        {
            // New rule: amphibious crabs cross ANY water depth (just slowed).
            var t = FlatWithChannel(20f, -30f, 0f);  // very deep channel
            var u = Mk("SWIMMER", ChassisClass.Siege, new Vector3(400, 0, 300), t);
            u.Amphibious = true;
            u.SetMove(new Vector3(400, 0, 780));
            for (int i = 0; i < 9000; i++) u.TickMovement(t, SimClock.SIM_DT);
            Assert.Greater(u.Position.z, 700f, "Amphibious crab should cross even deep water now.");
        }

        [Test]
        public void Cliff_BlocksMovement()
        {
            // A vertical cliff (very steep rise) is impassable; the crab stops at its base.
            int n = 80; float cell = 12f; var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++)
                hm[x, z] = z >= 45 ? 400f : 10f;   // a 390m wall starting at z=45 (540m)
            var t = new TerrainField(hm, cell, Vector3.zero);
            var u = Mk("CLIMBER", ChassisClass.Line, new Vector3(400, 0, 300), t);
            u.SetMove(new Vector3(400, 0, 700));
            for (int i = 0; i < 2000; i++) u.TickMovement(t, SimClock.SIM_DT);
            Assert.Less(u.Position.z, 540f, "A crab cannot climb a sheer cliff — it stops at the base.");
        }

        [Test]
        public void InWater_CannotFire_UnlessTechAllows()
        {
            var t = FlatWithChannel(-3f, -3f, 0f);   // whole map is water
            var u = Mk("SWIM", ChassisClass.Siege, new Vector3(400, 0, 400), t);
            u.Amphibious = true; u.MaxWadeDepthM = 6f;
            u.TickMovement(t, SimClock.SIM_DT);      // refresh water state
            Assert.IsTrue(u.InWater, "Unit on submerged ground should be in water.");
            u.CanFireInWater = false;
            Assert.IsFalse(u.CanFireNow, "Early amphibious crab cannot fire while in water.");
            u.CanFireInWater = true;
            Assert.IsTrue(u.CanFireNow, "With the water-firing tech, it can fire (with penalty).");
            Assert.Less(u.SituationalAccuracy, 1f, "Firing in water carries an accuracy penalty.");
        }

        // ---- Precipitation slows movement ----
        [Test]
        public void Precipitation_SlowsMovement()
        {
            var t = FlatWithChannel(20f, 20f, float.NegativeInfinity);  // dry flat
            var dry = Mk("DRY", ChassisClass.Line, new Vector3(100, 0, 100), t);
            var wet = Mk("WET", ChassisClass.Line, new Vector3(100, 0, 100), t);
            dry.SetMove(new Vector3(100, 0, 800));
            wet.SetMove(new Vector3(100, 0, 800));
            for (int i = 0; i < 200; i++)
            {
                dry.TickMovement(t, SimClock.SIM_DT, 1.0f);      // clear
                wet.TickMovement(t, SimClock.SIM_DT, 0.6f);      // heavy rain
            }
            Assert.Greater(dry.Position.z, wet.Position.z + 5f, "Rain should make the wet unit lag behind.");
        }

        // ---- Trajectory dead space ----
        [Test]
        public void Mortar_ReachesDefilade_Direct_Does_Not()
        {
            // A tall ridge masks the target; shooter has no LOS.
            int n = 200; float cell = 12f; var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++)
                hm[x, z] = 20f + (z >= 95 && z <= 105 ? 250f : 0f);
            var terrain = new TerrainField(hm, cell, Vector3.zero);
            var sim = new BattleSim(terrain, 5);

            var shooter = Mk("ARTY", ChassisClass.Siege, new Vector3(1200, 0, 600), terrain);
            shooter.Team = 0; shooter.Id = 1;
            var enemy = Mk("TGT", ChassisClass.Line, new Vector3(1200, 0, 1700), terrain);
            enemy.Team = 1; enemy.Id = 2; enemy.HullDown = true;
            sim.Units.Add(shooter); sim.Units.Add(enemy);
            shooter.FireTarget = enemy;

            // Spot it via a recon drone so indirect fire is permitted.
            var recon = _db.Drones.Find(d => d.role == DroneRole.Recon);
            sim.ActiveDrones.Add(new Combat.Drones.DroneAgent(recon, 0, shooter.EyePosition, new Vector3(1200, 0, 1700)));
            for (int i = 0; i < 1500 && !sim.IsVisibleTo(enemy, 0); i++) sim.Tick();
            Assert.IsTrue(sim.IsVisibleTo(enemy, 0), "Recon should spot the defiladed enemy.");

            // DIRECT fire: no LOS over the 250m ridge -> no shells should ever reach (dead space).
            shooter.Fire = FireMode.Direct;
            float dmgDirectStart = enemy.Structure;
            for (int i = 0; i < 3000; i++) sim.Tick();
            Assert.AreEqual(dmgDirectStart, enemy.Structure, 0.001f,
                "Direct (flat) fire cannot reach a target in deep defilade behind a tall ridge.");

            // MORTAR fire: high-angle plunges in.
            shooter.Fire = FireMode.Mortar;
            float dmgMortarStart = enemy.Structure;
            for (int i = 0; i < 6000; i++) sim.Tick();
            Assert.Less(enemy.Structure, dmgMortarStart + 0.001f,
                "Mortar (high-angle) fire should reach into the defilade and damage the target.");
        }

        // ---- Campaign prestige / VP / tension ----
        [Test]
        public void Campaign_PrestigeVP_RespondToOutcomes()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 1);
            float p0 = cs.Prestige;
            cs.ResolveMission(won: true, vp: 5, prestigeDelta: 4f);
            Assert.AreEqual(5, cs.VictoryPoints);
            Assert.Greater(cs.Prestige, p0, "Winning raises prestige.");
            cs.ResolveMission(won: false, vp: 3, prestigeDelta: 4f);
            Assert.AreEqual(3, cs.EnemyVictoryPoints);
            cs.RefuseMission();
            Assert.Greater(cs.EnemyVictoryPoints, 3, "Refusing gives the enemy VP.");
        }

        [Test]
        public void Campaign_Tension13_DeclaresWar()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 1);
            int enemyId = _db.Nations.Find(n => n.id != 1).id;
            cs.AdjustTension(enemyId, 20);   // clamp to 13 -> war
            Assert.IsTrue(cs.AtWar, "Tension reaching 13 declares war.");
            Assert.AreEqual(enemyId, cs.WarEnemyNationId);
        }

        [Test]
        public void Campaign_PrestigeZero_RemovesFromCommand()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 1);
            cs.AddPrestige(-100f);
            Assert.IsTrue(cs.RemovedFromCommand, "Prestige hitting 0 removes you from command.");
        }

        // ---- Comms net (LOS relay) ----
        [Test]
        public void CommsNet_RidgeDropsUnitOffNet_RelayRestoresIt()
        {
            // Command unit south; a forward unit north behind a tall ridge (no direct LOS).
            int n = 200; float cell = 12f; var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++)
                hm[x, z] = 20f + (z >= 95 && z <= 105 ? 220f : 0f);
            var terrain = new TerrainField(hm, cell, Vector3.zero);

            var cmd = Mk("HQ", ChassisClass.Line, new Vector3(1200, 0, 600), terrain);
            cmd.Id = 1; cmd.Team = 0; cmd.CommsRangeM = 9000;
            var fwd = Mk("FWD", ChassisClass.Line, new Vector3(1200, 0, 1700), terrain);
            fwd.Id = 2; fwd.Team = 0; fwd.CommsRangeM = 9000;
            var units = new System.Collections.Generic.List<MechaUnit> { cmd, fwd };

            // No relay, ridge blocks LOS -> forward unit is OFF the net (ghost held).
            CommsNet.Recompute(units, terrain, 0, 10.0, cmd);
            Assert.IsTrue(cmd.OnNet, "Command node is on the net.");
            Assert.IsFalse(fwd.OnNet, "Unit behind a tall ridge has no LOS comms -> off the net.");
            Assert.IsTrue(fwd.HasGhost, "Off-net unit should leave a last-known ghost.");

            // Add a relay on the ridge with LOS to both -> forward unit back ON the net via relay.
            var relay = Mk("RELAY", ChassisClass.Recon, new Vector3(1200, 0, 1200), terrain);
            relay.Position = new Vector3(1200, terrain.HeightAt(1200, 1200) + 200, 1200); // atop the ridge
            relay.EyeHeight = 12f; relay.Id = 3; relay.Team = 0; relay.CommsRangeM = 9000;
            units.Add(relay);
            CommsNet.Recompute(units, terrain, 0, 11.0, cmd);
            Assert.IsTrue(fwd.OnNet, "A relay with LOS to both should put the forward unit back on the net.");
        }

        [Test]
        public void CommsNet_DeadCommsMast_CannotRelay()
        {
            var t = FlatWithChannel(20f, 20f, float.NegativeInfinity); // flat, clear LOS everywhere
            var a = Mk("HQ", ChassisClass.Line, new Vector3(100, 0, 100), t); a.Id = 1; a.Team = 0;
            var b = Mk("MID", ChassisClass.Line, new Vector3(100, 0, 5000), t); b.Id = 2; b.Team = 0;
            var c = Mk("FAR", ChassisClass.Line, new Vector3(100, 0, 9500), t); c.Id = 3; c.Team = 0;
            a.CommsRangeM = b.CommsRangeM = c.CommsRangeM = 6000;  // A->B->C chain (A can't reach C directly)
            var units = new System.Collections.Generic.List<MechaUnit> { a, b, c };

            CommsNet.Recompute(units, t, 0, 1.0, a);
            Assert.IsTrue(c.OnNet, "C should be on the net via relay B.");

            // Destroy B's comms mast (datalink) -> B can't relay -> C falls off.
            b.Sys.Get(CityBattle.Units.Subsystem.Datalink).integrity = 0f;
            CommsNet.Recompute(units, t, 0, 2.0, a);
            Assert.IsFalse(c.OnNet, "With the relay's comms mast destroyed, C loses comms.");
        }

        // ---- Intelligence: camouflage & RDF ----
        [Test]
        public void Camouflage_ReducesDetectionRange()
        {
            var t = FlatWithChannel(20f, 20f, float.NegativeInfinity); // flat, clear LOS
            var sim = new BattleSim(t, 3);
            var obs = Mk("OBS", ChassisClass.Line, new Vector3(100, 0, 100), t); obs.Id = 1; obs.Team = 0;
            // Target at the very edge of base sight range.
            float r = obs.BaseSightRange * 0.9f;
            var tgt = Mk("TGT", ChassisClass.Line, new Vector3(100, 0, 100 + r), t); tgt.Id = 2; tgt.Team = 1;
            sim.Units.Add(obs); sim.Units.Add(tgt);

            tgt.Camouflage = 1f;  // no camo -> spotted
            for (int i = 0; i < 6; i++) sim.Tick();
            Assert.IsTrue(sim.IsVisibleTo(tgt, 0), "Uncamouflaged target at 0.9x sight should be seen.");

            tgt.Camouflage = 0.5f; // heavy camo halves detection range -> now out of detection
            for (int i = 0; i < 6; i++) sim.Tick();
            Assert.IsFalse(sim.IsVisibleTo(tgt, 0), "Camouflage should shrink the range at which it's detected.");
        }

        [Test]
        public void RDF_LocatesEmittingUnit_WithoutLOS()
        {
            // Tall ridge blocks LOS, but an emitting unit is found by RDF.
            int n = 200; float cell = 12f; var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++)
                hm[x, z] = 20f + (z >= 95 && z <= 105 ? 260f : 0f);
            var terrain = new TerrainField(hm, cell, Vector3.zero);
            var sim = new BattleSim(terrain, 7);
            var obs = Mk("OBS", ChassisClass.Line, new Vector3(1200, 0, 600), terrain); obs.Id = 1; obs.Team = 0;
            var emitter = Mk("JAM", ChassisClass.Line, new Vector3(1200, 0, 1700), terrain); emitter.Id = 2; emitter.Team = 1;
            // Give it a jammer module so it emits.
            emitter.EwModules.Add(_db.EwModules.Find(e => e.type == EwType.Jammer));
            sim.Units.Add(obs); sim.Units.Add(emitter);

            for (int i = 0; i < 8; i++) sim.Tick();
            Assert.IsFalse(sim.IsSpotted(emitter), "Behind the ridge it shouldn't be visually spotted.");
            Assert.IsTrue(emitter.Emitting, "A jammer-equipped unit emits.");
            Assert.IsTrue(emitter.RdfDetected, "RDF should locate the emitting unit even without LOS.");
            Assert.IsTrue(sim.IsDetectedByEnemy(emitter), "Detected via RDF counts as known to the enemy.");
        }

        [Test]
        public void RelayDrone_BridgesCommsOverRidge()
        {
            int n = 200; float cell = 12f; var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++)
                hm[x, z] = 20f + (z >= 95 && z <= 105 ? 220f : 0f);
            var terrain = new TerrainField(hm, cell, Vector3.zero);
            var sim = new BattleSim(terrain, 11);
            var cmd = Mk("HQ", ChassisClass.Line, new Vector3(1200, 0, 600), terrain); cmd.Id = 1; cmd.Team = 0;
            var fwd = Mk("FWD", ChassisClass.Line, new Vector3(1200, 0, 1700), terrain); fwd.Id = 2; fwd.Team = 0;
            sim.Units.Add(cmd); sim.Units.Add(fwd);

            // No drone: forward unit off the net behind the ridge.
            CommsNet.Recompute(sim.Units, terrain, 0, 1.0, cmd, sim.ActiveDrones);
            Assert.IsFalse(fwd.OnNet, "Without a relay, forward unit is off the net.");

            // Launch a recon drone high over the ridge with LOS to both.
            var reconDef = _db.Drones.Find(d => d.role == DroneRole.Recon);
            var drone = new Combat.Drones.DroneAgent(reconDef, 0, cmd.EyePosition, new Vector3(1200, 0, 1150));
            drone.Position = new Vector3(1200, terrain.HeightAt(1200, 1150) + 400, 1150); // high above the crest
            sim.ActiveDrones.Add(drone);
            CommsNet.Recompute(sim.Units, terrain, 0, 2.0, cmd, sim.ActiveDrones);
            Assert.IsTrue(fwd.OnNet, "A relay drone aloft should bridge comms over the ridge.");
        }

        // ---- Design class derivation ----
        [Test]
        public void Design_DerivesRtWClassCodes()
        {
            var siege = _db.Chassis.Find(c => c.cls == ChassisClass.Siege);
            var line = _db.Chassis.Find(c => c.cls == ChassisClass.Line);
            var recon = _db.Chassis.Find(c => c.cls == ChassisClass.Recon);
            var carrier = _db.Chassis.Find(c => c.cls == ChassisClass.Carrier);
            var bigGun = _db.Guns.Find(g => g.caliberMm >= 300);   // 305
            var medGun = _db.Guns.Find(g => g.name.Contains("155"));
            var drone = _db.Drones.Find(d => d.role == DroneRole.Recon);

            // Siege + 305mm + thick belt => BB.
            var bb = new MechaDesign { chassisId = siege.id, armorMaterialId = _db.Armors[0].id, glacisMm = 300 };
            bb.weaponGunIds.Add(bigGun.id);
            Assert.AreEqual("BB", bb.DerivedClassCode(_db), "Big-gun thick-belt siege should read BB.");

            // Line + 155mm => CL/CA range.
            var cl = new MechaDesign { chassisId = line.id, armorMaterialId = _db.Armors[0].id, glacisMm = 150 };
            cl.weaponGunIds.Add(medGun.id);
            var code = cl.DerivedClassCode(_db);
            Assert.IsTrue(code == "CL" || code == "CA", "Line with 155mm should read CL or CA, got " + code);

            // Recon chassis => Recon.
            var rc = new MechaDesign { chassisId = recon.id, armorMaterialId = _db.Armors[0].id };
            Assert.AreEqual("Recon", rc.DerivedClassCode(_db));

            // Carrier with drones => CV.
            var cv = new MechaDesign { chassisId = carrier.id, armorMaterialId = _db.Armors[0].id };
            cv.droneIds.Add(drone.id); cv.droneIds.Add(drone.id);
            Assert.AreEqual("CV", cv.DerivedClassCode(_db));

            Assert.AreEqual("battle-crab", MechaDesign.ClassName("BB"));
        }

        [Test]
        public void Campaign_StrategicState_RoundTrips()
        {
            var cs = new CampaignState();
            cs.NewCampaign(_db, _tree, 2);
            cs.ResolveMission(true, 7, 3f);
            cs.AdjustTension(_db.Nations[0].id == 2 ? _db.Nations[1].id : _db.Nations[0].id, 5);
            string json = cs.ToJson();
            var cs2 = CampaignState.FromJson(json);
            Assert.AreEqual(cs.Prestige, cs2.Prestige, 0.01f);
            Assert.AreEqual(cs.VictoryPoints, cs2.VictoryPoints);
            Assert.AreEqual(cs.Tension.Count, cs2.Tension.Count);
        }
    }
}
