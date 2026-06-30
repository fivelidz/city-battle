// CITY BATTLE — DroneAgent: an active drone on the battlefield (docs/DESIGN.md 4).
// Recon drones extend their team's vision over terrain (the LOS force-multiplier).
// Strike/loiter drones run attack profiles. Radio-linked drones are degraded by jammers;
// fibre-optic drones are jam-immune but short-ranged.
using UnityEngine;
using CityBattle.Data;
using CityBattle.Units;

namespace CityBattle.Combat.Drones
{
    public enum DronePhase { Transit, Loiter, Attack, Returning, Lost }

    public class DroneAgent
    {
        public DroneDef Def;
        public int Team;
        public Vector3 Position;
        public Vector3 PrevPosition;
        public Vector3 Home;          // launch point (for range/return)
        public Vector3 Waypoint;      // current go-to
        public MechaUnit AttackTarget;
        public DronePhase Phase = DronePhase.Transit;
        public float LoiterTimer;
        public float Life;            // seconds aloft
        public bool Dead;

        // Link quality 0..1; jamming pushes radio links down.
        public float LinkQuality = 1f;

        public DroneAgent(DroneDef def, int team, Vector3 home, Vector3 waypoint)
        {
            Def = def; Team = team; Home = home; Position = home; PrevPosition = home;
            Waypoint = waypoint;
            // Recon drones fly at altitude (defeats terrain occlusion); set initial Y.
            Position.y = home.y + def.altitudeM;
            Waypoint.y = waypoint.y + def.altitudeM;
        }

        public void Tick(BattleSim sim, float dt)
        {
            PrevPosition = Position;
            Life += dt;

            // ---- Hard-kill C-UAS (laser / kinetic) can shoot the drone down ----
            if (EWSystem.TryHardKill(sim, this, dt)) { Dead = true; return; }

            // ---- Link / jamming ----
            UpdateLink(sim);
            if (LinkQuality <= 0.05f && !Def.JamImmune)
            {
                // Lost link: radio drone drifts and falls out (unless autonomous).
                if (Def.autonomy == Autonomy.Manual || Def.autonomy == Autonomy.Waypoint)
                {
                    Phase = DronePhase.Lost;
                    Position += Vector3.down * 8f * dt; // descend/crash
                    if (Position.y <= sim.Terrain.HeightAt(Position.x, Position.z)) Dead = true;
                    return;
                }
            }

            // ---- Endurance ----
            if (Life > Def.loiterMin * 60f + 30f) { Phase = DronePhase.Returning; }

            switch (Phase)
            {
                case DronePhase.Transit: TickTransit(sim, dt); break;
                case DronePhase.Loiter: TickLoiter(sim, dt); break;
                case DronePhase.Attack: TickAttack(sim, dt); break;
                case DronePhase.Returning: TickReturn(sim, dt); break;
            }
        }

        void UpdateLink(BattleSim sim)
        {
            if (Def.JamImmune) { LinkQuality = 1f; return; }
            // Fibre-optic also limited by tether length (range).
            float fromHome = Vector3.Distance(Position, Home);
            if (Def.controlLink == ControlLink.FibreOptic && fromHome > Def.rangeM)
            { LinkQuality = 0f; return; }

            // Jammers from the enemy team degrade radio/satellite links by proximity & strength.
            float jam = EWSystem.JammingAgainst(sim, this);
            LinkQuality = Mathf.Clamp01(1f - jam);
        }

        void MoveToward(Vector3 target, BattleSim sim, float dt)
        {
            Vector3 to = target - Position;
            float dist = to.magnitude;
            float step = Def.SpeedMs * dt;
            if (dist <= step) { Position = target; return; }
            Position += to / dist * step;
        }

        void TickTransit(BattleSim sim, float dt)
        {
            MoveToward(Waypoint, sim, dt);
            if (Vector3.Distance(Position, Waypoint) < 15f)
            {
                Phase = (Def.role == DroneRole.Recon) ? DronePhase.Loiter : DronePhase.Loiter;
                LoiterTimer = Def.loiterMin * 60f;
            }
            // Strike/loiter drones acquire a target if one is visible.
            if (Def.role != DroneRole.Recon) AcquireTarget(sim);
        }

        void TickLoiter(BattleSim sim, float dt)
        {
            // Orbit the waypoint (simple circle).
            float ang = Life * 0.6f;
            Vector3 orbit = Waypoint + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * 120f;
            orbit.y = Waypoint.y;
            MoveToward(orbit, sim, dt);
            LoiterTimer -= dt;
            if (Def.role != DroneRole.Recon) AcquireTarget(sim);
            if (LoiterTimer <= 0f) Phase = DronePhase.Returning;
        }

        void AcquireTarget(BattleSim sim)
        {
            if (AttackTarget != null && AttackTarget.Alive) { Phase = DronePhase.Attack; return; }
            MechaUnit best = null; float bestD = float.MaxValue;
            foreach (var u in sim.Units)
            {
                if (!u.Alive || u.Team == Team) continue;
                float d = Vector3.Distance(Position, u.Position);
                if (d < bestD) { bestD = d; best = u; }
            }
            if (best != null && bestD < Def.rangeM) { AttackTarget = best; Phase = DronePhase.Attack; }
        }

        void TickAttack(BattleSim sim, float dt)
        {
            if (AttackTarget == null || !AttackTarget.Alive) { Phase = DronePhase.Loiter; AttackTarget = null; return; }
            Vector3 tp = AttackTarget.Position + Vector3.up * AttackTarget.EyeHeight;
            MoveToward(tp, sim, dt);
            if (Vector3.Distance(Position, tp) < 6f)
            {
                Detonate(sim);
                Dead = true;
            }
        }

        void Detonate(BattleSim sim)
        {
            if (AttackTarget == null) return;
            // Top-attack: drones strike the carapace (thin top armour).
            float pen = Def.payloadType switch
            {
                PayloadType.ShapedCharge => 400f,
                PayloadType.Thermobaric => 180f,
                PayloadType.Frag => 90f,
                PayloadType.Emp => 0f,       // disables electronics instead
                PayloadType.Laser => 250f,
                _ => 60f
            };
            AttackTarget.EnsureSystems();
            if (Def.payloadType == PayloadType.Emp)
            {
                // EMP fries electronics: sensor mast + datalink, not armour.
                var mast = AttackTarget.Sys.Get(Units.Subsystem.SensorMast);
                var link = AttackTarget.Sys.Get(Units.Subsystem.Datalink);
                if (mast != null) mast.integrity = Mathf.Max(0f, mast.integrity - 0.6f);
                if (link != null) link.integrity = Mathf.Max(0f, link.integrity - 0.7f);
            }
            else
            {
                // Top-attack drones strike the carapace (thin top armour).
                float armor = AttackTarget.Armor.Of(HitZone.Carapace) * AttackTarget.ArmorQuality;
                float residual = pen - armor;
                if (residual > 0f) AttackTarget.ApplyDamage(HitZone.Carapace, residual, sim.Rng);
            }
            sim.OnImpact?.Invoke(AttackTarget.Position, AttackTarget, HitZone.Carapace, pen > AttackTarget.Armor.carapace);
        }

        void TickReturn(BattleSim sim, float dt)
        {
            MoveToward(Home, sim, dt);
            if (Vector3.Distance(Position, Home) < 10f) Dead = true;
        }

        public Vector3 RenderPosition(float alpha) => Vector3.Lerp(PrevPosition, Position, alpha);
    }
}
