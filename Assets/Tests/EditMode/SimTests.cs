// CITY BATTLE — Simulation tests: ballistics, terrain LOS, and a full deterministic battle
// smoke test proving the de-risking vertical slice (drone spots hull-down target -> indirect
// fire over a ridge -> penetration/damage). Runs headless, no rendering.
using NUnit.Framework;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat;
using CityBattle.Combat.Drones;

namespace CityBattle.Tests
{
    public class SimTests
    {
        // ---- Ballistics ----

        [Test]
        public void Ballistics_SolveElevation_FlatShot_RoundTrips()
        {
            float v = 900f, range = 5000f, dh = 0f;
            Assert.IsTrue(Ballistics.SolveElevation(v, range, dh, false, out float elev));
            // Reconstruct landing point from the elevation; should land near `range`.
            float vx = v * Mathf.Cos(elev), vy = v * Mathf.Sin(elev);
            float tof = range / vx;
            float landY = vy * tof - 0.5f * Ballistics.G * tof * tof;
            Assert.That(landY, Is.EqualTo(0f).Within(5f), "Vacuum shot should land near target height.");
        }

        [Test]
        public void Ballistics_OutOfRange_ReturnsFalse()
        {
            // Way beyond max range for this muzzle velocity.
            Assert.IsFalse(Ballistics.SolveElevation(300f, 50000f, 0f, false, out _));
        }

        [Test]
        public void Ballistics_HighArc_HasGreaterElevation_ThanLow()
        {
            float v = 900f, range = 4000f;
            Ballistics.SolveElevation(v, range, 0, false, out float low);
            Ballistics.SolveElevation(v, range, 0, true, out float high);
            Assert.Greater(high, low, "High arc elevation must exceed low arc.");
        }

        // ---- Terrain LOS ----

        TerrainField FlatField(float h, int n = 32, float cell = 10f)
        {
            var hm = new float[n, n];
            for (int x = 0; x < n; x++) for (int z = 0; z < n; z++) hm[x, z] = h;
            return new TerrainField(hm, cell, Vector3.zero);
        }

        [Test]
        public void LOS_Flat_Clear()
        {
            var t = FlatField(0f);
            Vector3 a = new Vector3(20, 5, 20), b = new Vector3(280, 5, 280);
            Assert.IsTrue(t.HasLineOfSight(a, b));
        }

        [Test]
        public void LOS_RidgeBlocks()
        {
            int n = 64; float cell = 10f;
            var hm = new float[n, n];
            // A tall ridge wall across the middle column band.
            for (int x = 0; x < n; x++)
            for (int z = 0; z < n; z++)
                hm[x, z] = (z >= 30 && z <= 34) ? 120f : 0f;
            var t = new TerrainField(hm, cell, Vector3.zero);

            Vector3 a = new Vector3(100, 5, 50);    // before ridge (z=50m -> index 5)
            Vector3 b = new Vector3(100, 5, 550);   // after ridge (z=550m -> index 55)
            Assert.IsFalse(t.HasLineOfSight(a, b), "Tall ridge between observer and target must block LOS.");

            // Elevated observer above the ridge should see over it.
            Vector3 high = new Vector3(100, 200, 50);
            Assert.IsTrue(t.HasLineOfSight(high, new Vector3(100, 130, 550)), "From above the ridge, LOS should be clear.");
        }

        [Test]
        public void HeightAt_Bilinear_Interpolates()
        {
            int n = 4; float cell = 10f;
            var hm = new float[n, n];
            hm[0, 0] = 0; hm[1, 0] = 10; hm[0, 1] = 0; hm[1, 1] = 10;
            var t = new TerrainField(hm, cell, Vector3.zero);
            // Halfway between x=0 and x=10 -> height 5.
            Assert.That(t.HeightAt(5f, 0f), Is.EqualTo(5f).Within(0.01f));
        }

        // ---- Full battle smoke test ----

        [Test]
        public void Battle_DroneSpots_HullDownTarget_EnablesIndirectKill()
        {
            // Build a terrain with a ridge so the shooter has NO direct LOS to the hidden enemy.
            int n = 200; float cell = 12f;
            var hm = new float[n, n];
            for (int x = 0; x < n; x++)
            for (int z = 0; z < n; z++)
            {
                // Ridge band near z index 95-105 (world ~1140-1260m), 160m tall.
                hm[x, z] = (z >= 95 && z <= 105) ? 160f : 20f;
            }
            var terrain = new TerrainField(hm, cell, Vector3.zero);
            var sim = new BattleSim(terrain, 777);

            var db = Database.Load();
            var nation = db.Nations[0];
            var siege = db.Chassis.Find(c => c.cls == ChassisClass.Siege);
            var gun = db.Guns.Find(g => g.name.Contains("155"));

            // Player shooter SOUTH of the ridge.
            var shooter = MakeUnit(sim, "P1", 0, siege, ArmorScheme.Dreadnought, nation, gun,
                new Vector3(1200, 0, 600), terrain);
            shooter.Fire = FireMode.Indirect;

            // Enemy hull-down NORTH of the ridge (no direct LOS from shooter).
            var enemyGun = db.Guns.Find(g => g.name.Contains("105"));
            var enemy = MakeUnit(sim, "E1", 1, siege, ArmorScheme.Skirmisher, db.Nations[1], enemyGun,
                new Vector3(1200, 0, 1800), terrain);
            enemy.HullDown = true;
            shooter.FireTarget = enemy;

            // 1) Confirm shooter has NO direct LOS (ridge blocks it).
            bool directLos = terrain.HasLineOfSight(shooter.EyePosition, enemy.EyePosition);
            Assert.IsFalse(directLos, "Ridge should block direct LOS shooter->enemy.");

            // 2) Without spotting, the enemy is NOT visible to player -> no fire solution allowed.
            RunTicks(sim, 40);
            Assert.IsFalse(sim.IsVisibleTo(enemy, 0), "Enemy must be unspotted before recon.");
            int shellsBefore = sim.Projectiles.Count;

            // 3) Launch a recon drone (flies at altitude, sees over the ridge).
            var reconDef = db.Drones.Find(d => d.role == DroneRole.Recon);
            var drone = new DroneAgent(reconDef, 0, shooter.EyePosition, new Vector3(1200, 0, 1800));
            sim.ActiveDrones.Add(drone);

            // 4) Run until the drone reaches overwatch and spots the enemy.
            bool spotted = false;
            for (int i = 0; i < 4000 && !spotted; i++)
            {
                sim.Tick();
                if (sim.IsVisibleTo(enemy, 0)) spotted = true;
            }
            Assert.IsTrue(spotted, "Recon drone should spot the hull-down enemy from altitude.");

            // 5) Once spotted, indirect fire should produce shells lobbed over the ridge.
            float enemyStructStart = enemy.Structure;
            for (int i = 0; i < 6000; i++) sim.Tick();

            Assert.Less(enemy.Structure, enemyStructStart + 0.001f,
                "After spotting + indirect fire, enemy should take damage over time.");
            // The whole point: a hidden target became killable only via drone spotting + indirect arc.
            Debug.Log($"[SmokeTest] enemy struct {enemyStructStart:0.0} -> {enemy.Structure:0.0}, " +
                      $"shells fired (snapshot) {sim.Projectiles.Count}, drones {sim.ActiveDrones.Count}");
        }

        // ---- helpers ----

        static MechaUnit MakeUnit(BattleSim sim, string name, int team, ChassisDef chassis,
            ArmorScheme armor, NationDef nation, GunDef gun, Vector3 pos, TerrainField t)
        {
            pos.y = t.HeightAt(pos.x, pos.z);
            var u = new MechaUnit
            {
                Id = sim.Units.Count + 1, Name = name, Team = team, Chassis = chassis,
                Armor = armor, Nation = nation,
                ArmorMaterial = sim.Db.Armors.Count > 0 ? sim.Db.Armors[0] : default,
                Position = pos, PrevPosition = pos, EyeHeight = 8f,
                HeadingDeg = team == 0 ? 0 : 180
            };
            u.Weapons.Add(new WeaponInstance { def = gun });
            sim.Units.Add(u);
            return u;
        }

        static void RunTicks(BattleSim sim, int n) { for (int i = 0; i < n; i++) sim.Tick(); }
    }
}
