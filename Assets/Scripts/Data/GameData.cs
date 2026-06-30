// CITY BATTLE — Game data definitions & loader.
// Loads the RtW3-style plain-text data tables (CSV in Resources/CSV/) into typed records.
// Data-driven by design: the CSVs stay human-editable/forkable, mirroring Rule the Waves 3.
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace CityBattle.Data
{
    public enum GunType { Conventional, Rail, Coil }

    [System.Serializable]
    public struct GunDef
    {
        public int id;
        public string name;
        public float caliberMm;
        public float shellWeightKg;
        public float rofRpm;
        public float maxRangeM;
        public float muzzleVelocityMs;
        public float weightT;
        public float cost;
        public int yearAvailable;
        public GunType type;

        /// <summary>Seconds between shots from rounds-per-minute.</summary>
        public float ReloadSeconds => rofRpm > 0f ? 60f / rofRpm : 9999f;
    }

    public enum ChassisClass { Recon, Skirmisher, Line, Spider, Siege, Carrier }

    [System.Serializable]
    public struct ChassisDef
    {
        public int id;
        public string name;
        public ChassisClass cls;
        public float massBudgetT;
        public float baseArmorBudgetT;
        public int numLegs;
        public float baseSpeedKmh;
        public float turnRateDps;
        public int numWeaponMounts;
        public int numUtilityMounts;
        public float cost;
        public float maintenance;
        public int yearAvailable;
        public float maxMountCaliberMm;   // largest gun a mount can take
        public int crew;                  // affects damage-control speed
        public float powerOutput;         // gates energy weapons (rail/coil/laser) + EW draw

        public float BaseSpeedMs => baseSpeedKmh / 3.6f;
    }

    [System.Serializable]
    public struct ArmorDef
    {
        public int id;
        public string name;
        public int yearAvailable;
        public float densityKgPerM2PerMm;
        public float qualityFactor;
        public float costPerT;
    }

    public enum DroneRole { Recon, LoiterMunition, Strike, Swarm }
    public enum PayloadType { None, ShapedCharge, Frag, Thermobaric, Emp, Laser }
    public enum ControlLink { Radio, FibreOptic, Satellite, Mesh }
    public enum Autonomy { Manual, Waypoint, FireAndForget, SwarmAi }

    [System.Serializable]
    public struct DroneDef
    {
        public int id;
        public string name;
        public DroneRole role;
        public int yearAvailable;
        public float speedKmh;
        public float rangeM;
        public float loiterMin;
        public float altitudeM;
        public float payloadKg;
        public PayloadType payloadType;
        public ControlLink controlLink;
        public Autonomy autonomy;
        public float cost;

        public float SpeedMs => speedKmh / 3.6f;
        public bool JamImmune => controlLink == ControlLink.FibreOptic;
    }

    public enum EwType
    {
        Jammer, Spoofer, DroneDetector, CuasHardkill, HardenedLink, FreqHop,
        LaserCuas, ChargeBay, LaserCounter, Decoy
    }

    [System.Serializable]
    public struct EwDef
    {
        public int id;
        public string name;
        public EwType type;
        public int yearAvailable;
        public float radiusM;
        public float strength;
        public float weightT;
        public float cost;
    }

    [System.Serializable]
    public struct NationDef
    {
        public int id;
        public string name;
        public float accuracy;
        public float damageControl;
        public float armorQuality;
        public float fireControl;
        public float droneDoctrine;
        public float ewStrength;
        public float fabricationEfficiency;
        public float researchSpeed;
        public int startingYear;
        public string[] traits;
    }

    /// <summary>
    /// Penetration lookup table (VerPen or HorPen). Rows keyed by caliber, columns by range.
    /// Bilinear interpolation across both axes for any (caliber, range).
    /// </summary>
    public class PenTable
    {
        public float[] ranges;                       // column headers (metres), ascending
        public List<float> calibers = new();         // row keys (mm), ascending
        public List<float[]> rows = new();           // pen values per caliber row

        public int CaliberCount => calibers.Count;

        /// <summary>mm of armour penetrated by `caliberMm` at `rangeM`. Interpolated & clamped.</summary>
        public float Lookup(float caliberMm, float rangeM)
        {
            if (calibers.Count == 0) return 0f;

            // Find caliber rows to interpolate between.
            int ci = 0;
            while (ci < calibers.Count - 1 && calibers[ci + 1] <= caliberMm) ci++;
            int ci2 = Mathf.Min(ci + 1, calibers.Count - 1);
            float ct = (calibers[ci2] > calibers[ci])
                ? Mathf.Clamp01((caliberMm - calibers[ci]) / (calibers[ci2] - calibers[ci]))
                : 0f;

            float penLo = LookupRange(rows[ci], rangeM);
            float penHi = LookupRange(rows[ci2], rangeM);
            return Mathf.Lerp(penLo, penHi, ct);
        }

        private float LookupRange(float[] row, float rangeM)
        {
            if (rangeM <= ranges[0]) return row[0];
            if (rangeM >= ranges[ranges.Length - 1]) return row[row.Length - 1];
            int r = 0;
            while (r < ranges.Length - 1 && ranges[r + 1] <= rangeM) r++;
            int r2 = Mathf.Min(r + 1, ranges.Length - 1);
            float rt = (ranges[r2] > ranges[r])
                ? (rangeM - ranges[r]) / (ranges[r2] - ranges[r])
                : 0f;
            return Mathf.Lerp(row[r], row[r2], rt);
        }
    }
}
