// CITY BATTLE — SimRandom: deterministic RNG for the simulation.
// NEVER use UnityEngine.Random in sim code (non-deterministic across frames/platforms).
// xorshift128 — fast, deterministic, seedable, replay-safe.
namespace CityBattle.Sim
{
    public sealed class SimRandom
    {
        uint _x, _y, _z, _w;

        public SimRandom(uint seed = 2531011u)
        {
            if (seed == 0) seed = 1u;
            _x = seed; _y = seed * 1812433253u + 1u;
            _z = _y * 1812433253u + 1u; _w = _z * 1812433253u + 1u;
        }

        public uint NextUInt()
        {
            uint t = _x ^ (_x << 11);
            _x = _y; _y = _z; _z = _w;
            _w = _w ^ (_w >> 19) ^ t ^ (t >> 8);
            return _w;
        }

        /// <summary>Uniform float in [0,1).</summary>
        public float NextFloat() => (NextUInt() & 0xFFFFFF) / 16777216f;

        /// <summary>Uniform float in [min,max).</summary>
        public float Range(float min, float max) => min + NextFloat() * (max - min);

        /// <summary>Integer in [min,max).</summary>
        public int RangeInt(int min, int max) => min + (int)(NextFloat() * (max - min));

        /// <summary>True with probability p in [0,1].</summary>
        public bool Chance(float p) => NextFloat() < p;

        /// <summary>Approx standard-normal via central limit (sum of 4 uniforms).</summary>
        public float NextGaussian()
        {
            float s = NextFloat() + NextFloat() + NextFloat() + NextFloat() - 2f;
            return s * 1.224745f; // scale so variance ~1
        }
    }
}
