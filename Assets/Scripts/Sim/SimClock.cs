// CITY BATTLE — SimClock: fixed-step, pausable, time-scaled simulation driver.
// Implements the real-time-with-pause architecture from docs/SIM.md.
// Logic runs at SIM_HZ; rendering is decoupled; visuals interpolate via RenderAlpha.
using System;
using UnityEngine;

namespace CityBattle.Sim
{
    public class SimClock : MonoBehaviour
    {
        public const int SIM_HZ = 20;
        public const float SIM_DT = 1f / SIM_HZ;   // 0.05 s per tick

        public static SimClock Instance { get; private set; }

        [Header("State")]
        public bool Paused = true;                 // battles start paused (give orders first)
        [Tooltip("0=pause, 1,2,4 are the RtW-style speed buttons")]
        public float TimeScale = 1f;

        /// <summary>Fraction [0,1) into the current sim step — for visual interpolation.</summary>
        public float RenderAlpha { get; private set; }
        public long TickCount { get; private set; }
        public double SimTime { get; private set; }     // accumulated in-sim seconds

        float _accumulator;

        /// <summary>Fired once per fixed sim tick. Systems subscribe here.</summary>
        public event Action OnSimTick;
        /// <summary>Fired after all ticks of a frame, with the render alpha for interpolation.</summary>
        public event Action<float> OnRenderInterpolate;

        public bool IsRunning => !Paused && TimeScale > 0f;

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
        }

        void Update()
        {
            if (IsRunning)
                _accumulator += Time.deltaTime * TimeScale;

            // Safety clamp so a long stall (or huge timescale) can't spiral.
            float maxAccum = SIM_DT * 8f;
            if (_accumulator > maxAccum) _accumulator = maxAccum;

            while (_accumulator >= SIM_DT)
            {
                Tick();
                _accumulator -= SIM_DT;
            }

            RenderAlpha = Mathf.Clamp01(_accumulator / SIM_DT);
            OnRenderInterpolate?.Invoke(RenderAlpha);
        }

        void Tick()
        {
            TickCount++;
            SimTime += SIM_DT;
            OnSimTick?.Invoke();
        }

        // ---- Player controls (UI binds to these) ----

        public void TogglePause() => Paused = !Paused;
        public void SetPaused(bool p) => Paused = p;

        public void SetSpeed(float scale)
        {
            TimeScale = Mathf.Max(0f, scale);
            if (TimeScale > 0f) Paused = false;
        }

        /// <summary>Advance exactly one sim tick while paused (single-step debugging / careful play).</summary>
        public void StepOnce()
        {
            if (Paused) Tick();
        }
    }
}
