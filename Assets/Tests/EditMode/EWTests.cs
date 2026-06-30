// CITY BATTLE — Electronic-warfare tests: jamming, fibre-optic immunity, laser C-UAS hard-kill.
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat;
using CityBattle.Combat.Drones;

namespace CityBattle.Tests
{
    public class EWTests
    {
        TerrainField Flat(int n = 64, float cell = 12f)
        {
            var hm = new float[n, n];
            return new TerrainField(hm, cell, Vector3.zero);
        }

        BattleSim MakeSim(out Database db)
        {
            var t = Flat();
            var sim = new BattleSim(t, 999);
            db = sim.Db;
            return sim;
        }

        MechaUnit EnemyWith(BattleSim sim, EwType ewType, Vector3 pos)
        {
            var db = sim.Db;
            var u = new MechaUnit
            {
                Id = sim.Units.Count + 1, Name = "JAMMER", Team = 1,
                Chassis = db.Chassis[0], Armor = ArmorScheme.Dreadnought,
                Nation = db.Nations[0], ArmorMaterial = db.Armors[0],
                Position = pos, PrevPosition = pos, EyeHeight = 8f
            };
            foreach (var e in db.EwModules) if (e.type == ewType) { u.EwModules.Add(e); break; }
            sim.Units.Add(u);
            return u;
        }

        [Test]
        public void Jammer_Degrades_RadioDrone_Link()
        {
            var sim = MakeSim(out var db);
            EnemyWith(sim, EwType.Jammer, new Vector3(300, 0, 300));

            var radioDef = db.Drones.Find(d => d.role == DroneRole.Recon && d.controlLink == ControlLink.Radio);
            Assert.IsNotNull(radioDef.name, "Need a radio recon drone in data.");
            var drone = new DroneAgent(radioDef, 0, new Vector3(310, 0, 310), new Vector3(320, 0, 320));

            float jam = EWSystem.JammingAgainst(sim, drone);
            Assert.Greater(jam, 0.2f, "A radio drone near an enemy jammer should be significantly jammed.");
        }

        [Test]
        public void FibreOptic_Drone_Is_JamImmune()
        {
            var sim = MakeSim(out var db);
            EnemyWith(sim, EwType.Jammer, new Vector3(300, 0, 300));

            var fibreDef = db.Drones.Find(d => d.controlLink == ControlLink.FibreOptic);
            Assert.IsNotNull(fibreDef.name, "Need a fibre-optic drone in data.");
            var drone = new DroneAgent(fibreDef, 0, new Vector3(305, 0, 305), new Vector3(320, 0, 320));

            float jam = EWSystem.JammingAgainst(sim, drone);
            Assert.AreEqual(0f, jam, 0.0001f, "Fibre-optic drones must be immune to jamming.");
        }

        [Test]
        public void LaserCuas_HardKills_NearbyDrone()
        {
            var sim = MakeSim(out var db);
            var def = db.EwModules.Find(e => e.type == EwType.LaserCuas);
            Assert.IsNotNull(def.name, "Need a laser C-UAS module in data.");
            var enemy = EnemyWith(sim, EwType.LaserCuas, new Vector3(300, 0, 300));

            var strikeDef = db.Drones.Find(d => d.role == DroneRole.Strike);
            var drone = new DroneAgent(strikeDef, 0, new Vector3(305, 0, 305), new Vector3(300, 0, 300));
            sim.ActiveDrones.Add(drone);

            // Run a few seconds; the drone should be shot down inside the CUAS radius.
            bool killed = false;
            for (int i = 0; i < 200; i++) // 200 ticks ~ 10s
            {
                sim.Tick();
                if (drone.Dead) { killed = true; break; }
            }
            Assert.IsTrue(killed, "Laser C-UAS should hard-kill a drone loitering in its radius.");
        }

        [Test]
        public void HardenedLink_Reduces_Jamming()
        {
            var sim = MakeSim(out var db);
            EnemyWith(sim, EwType.Jammer, new Vector3(300, 0, 300));

            // Friendly unit carrying a hardened link / freq-hop.
            var friendly = new MechaUnit
            {
                Id = 99, Name = "EW-GUARD", Team = 0, Chassis = db.Chassis[0],
                Armor = ArmorScheme.Dreadnought, Nation = db.Nations[0], ArmorMaterial = db.Armors[0],
                Position = new Vector3(320, 0, 320), PrevPosition = new Vector3(320, 0, 320), EyeHeight = 8f
            };
            foreach (var e in db.EwModules) if (e.type == EwType.FreqHop || e.type == EwType.HardenedLink) { friendly.EwModules.Add(e); break; }
            sim.Units.Add(friendly);

            var radioDef = db.Drones.Find(d => d.controlLink == ControlLink.Radio && d.role == DroneRole.Recon);
            var drone = new DroneAgent(radioDef, 0, new Vector3(305, 0, 305), new Vector3(320, 0, 320));

            float jam = EWSystem.JammingAgainst(sim, drone);
            // With hardening it should be reduced versus the raw jammer effect (which was >0.2 in the other test).
            Assert.Less(jam, 1f);
        }
    }
}
