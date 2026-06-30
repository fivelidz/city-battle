// CITY BATTLE — Data integrity tests. Verifies the CSV tables load and obey design invariants.
using NUnit.Framework;
using CityBattle.Data;

namespace CityBattle.Tests
{
    public class DataTests
    {
        Database _db;
        [SetUp] public void Setup() => _db = Database.Load();

        [Test] public void Guns_Load_NonEmpty() => Assert.Greater(_db.Guns.Count, 5);
        [Test] public void Chassis_Load_NonEmpty() => Assert.Greater(_db.Chassis.Count, 4);
        [Test] public void Drones_Load_NonEmpty() => Assert.Greater(_db.Drones.Count, 8);
        [Test] public void Nations_Load_NonEmpty() => Assert.Greater(_db.Nations.Count, 4);
        [Test] public void Ew_Load_NonEmpty() => Assert.Greater(_db.EwModules.Count, 6);

        [Test]
        public void Guns_BiggerCaliber_LowerRof_Conventional()
        {
            // Among conventional guns, ROF should trend down as caliber rises.
            GunDef small = default, big = default;
            foreach (var g in _db.Guns)
            {
                if (g.type != GunType.Conventional) continue;
                if (small.name == null || g.caliberMm < small.caliberMm) small = g;
                if (big.name == null || g.caliberMm > big.caliberMm) big = g;
            }
            Assert.Less(big.rofRpm, small.rofRpm, "Largest conv gun should have lower ROF than smallest.");
            Assert.Greater(big.maxRangeM, small.maxRangeM, "Larger gun should out-range smaller.");
        }

        [Test]
        public void Rail_Coil_HaveHigherVelocity()
        {
            float convMax = 0, railMin = float.MaxValue;
            foreach (var g in _db.Guns)
            {
                if (g.type == GunType.Conventional) convMax = System.Math.Max(convMax, g.muzzleVelocityMs);
                else railMin = System.Math.Min(railMin, g.muzzleVelocityMs);
            }
            Assert.Greater(railMin, convMax, "Rail/coil muzzle velocity should exceed all conventional.");
        }

        [Test]
        public void VerPen_DecreasesWithRange()
        {
            foreach (var cal in _db.VerPen.calibers)
            {
                float near = _db.VerPen.Lookup(cal, 1000f);
                float far = _db.VerPen.Lookup(cal, 16000f);
                Assert.GreaterOrEqual(near, far, $"VerPen for {cal}mm should drop with range.");
            }
        }

        [Test]
        public void HorPen_IncreasesWithRange()
        {
            foreach (var cal in _db.HorPen.calibers)
            {
                float near = _db.HorPen.Lookup(cal, 1000f);
                float far = _db.HorPen.Lookup(cal, 16000f);
                Assert.LessOrEqual(near, far, $"HorPen for {cal}mm should rise with range.");
            }
        }

        [Test]
        public void Drones_HaveRecon_AndFibreOptic()
        {
            bool recon = false, fibre = false, laser = false;
            foreach (var d in _db.Drones)
            {
                if (d.role == DroneRole.Recon) recon = true;
                if (d.controlLink == ControlLink.FibreOptic) fibre = true;
                if (d.payloadType == PayloadType.Laser) laser = true;
            }
            Assert.IsTrue(recon, "Need at least one recon drone.");
            Assert.IsTrue(fibre, "Need at least one fibre-optic (jam-immune) drone.");
            Assert.IsTrue(laser, "Need at least one laser-payload drone (per user request).");
        }

        [Test]
        public void Ew_HasJammerAndLaserCuas()
        {
            bool jam = false, laserCuas = false, charge = false;
            foreach (var e in _db.EwModules)
            {
                if (e.type == EwType.Jammer) jam = true;
                if (e.type == EwType.LaserCuas) laserCuas = true;
                if (e.type == EwType.ChargeBay) charge = true;
            }
            Assert.IsTrue(jam, "Need a jammer.");
            Assert.IsTrue(laserCuas, "Need a laser C-UAS (laser counter-drone).");
            Assert.IsTrue(charge, "Need a charge bay (laser charging).");
        }
    }
}
