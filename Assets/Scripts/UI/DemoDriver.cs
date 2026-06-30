// CITY BATTLE — DemoDriver: scripted self-playtest for screenshot verification & smoke testing.
// When enabled it drives the game with no mouse/keyboard: selects a player unit, assigns a
// target, optionally launches a recon drone, and unpauses at a chosen speed. This lets the full
// information layer (status diagram, four-gate readout, range rings, LOS lines, combat log) be
// verified visually in a headless-launched standalone build (synthetic OS input doesn't reach
// Unity on Wayland). Also functions as an in-engine integration test of the whole UI+sim stack.
using UnityEngine;
using CityBattle.Combat;
using CityBattle.Units;

namespace CityBattle.UI
{
    public class DemoDriver : MonoBehaviour
    {
        public BattleController Controller;
        public OrderInput Input;
        public bool Enabled = false;
        public float StartDelay = 1.0f;
        public float Speed = 2f;
        public bool LaunchRecon = true;

        float _t;
        bool _done;

        void Start()
        {
            // Allow turning the demo off at launch:  ./CityBattle.x86_64 -nodemo
            foreach (var a in System.Environment.GetCommandLineArgs())
                if (a == "-nodemo") Enabled = false;
        }

        void Update()
        {
            if (!Enabled || _done || Controller?.Sim == null) return;
            _t += Time.deltaTime;
            if (_t < StartDelay) return;
            _done = true;

            var sim = Controller.Sim;

            // Pick a player unit and the nearest enemy; wire them up.
            MechaUnit me = null, foe = null;
            foreach (var u in sim.Units)
                if (u.Team == 0 && u.Alive) { me = u; break; }
            if (me != null)
            {
                float best = float.MaxValue;
                foreach (var e in sim.Units)
                    if (e.Team == 1 && e.Alive)
                    {
                        float d = Vector3.Distance(me.Position, e.Position);
                        if (d < best) { best = d; foe = e; }
                    }
            }

            if (me != null)
            {
                Input.SelectForDemo(me);
                if (foe != null)
                {
                    me.FireTarget = foe;
                    me.Fire = FireMode.Direct;
                    // Order an advance toward the enemy so the move-arrow overlay shows too.
                    Vector3 toFoe = (foe.Position - me.Position).normalized;
                    me.SetMove(me.Position + toFoe * 500f);
                    me.QueueMove(me.Position + toFoe * 900f);
                }
                if (LaunchRecon)
                    Controller.LaunchRecon(me, new Vector3(1000, 0, 1700));
            }

            // Also set the other player units to engage so the battle actually unfolds.
            foreach (var u in sim.Units)
                if (u.Team == 0 && u.Alive && u != me)
                {
                    u.Fire = FireMode.Direct;
                    MechaUnit nf = null; float bd = float.MaxValue;
                    foreach (var e in sim.Units) if (e.Team == 1 && e.Alive)
                    { float d = Vector3.Distance(u.Position, e.Position); if (d < bd) { bd = d; nf = e; } }
                    u.FireTarget = nf;
                }

            // Focus the camera on the selected unit at a medium-close distance for inspection.
            var cam = FindFirstObjectByType<BattleCamera>();
            if (cam != null && me != null) cam.FocusOn(me.Position, 350f);

            Controller.Clock.SetSpeed(Speed);
            Debug.Log("[DemoDriver] scripted engagement started; selection + target + recon wired, running.");
        }
    }
}
