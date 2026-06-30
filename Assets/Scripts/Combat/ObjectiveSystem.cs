// CITY BATTLE — ObjectiveSystem: scenario win/lose resolution. Tracks the active scenario's
// objective and reports BattleOutcome (InProgress / Victory / Defeat) each tick, with progress
// (hold timer, escort arrival, kill counts) so the HUD can show "HOLD 12/30s" etc.
using UnityEngine;
using CityBattle.Units;

namespace CityBattle.Combat
{
    public enum BattleOutcome { InProgress, Victory, Defeat }

    public class ObjectiveSystem
    {
        public Scenario Scenario;
        public BattleOutcome Outcome = BattleOutcome.InProgress;
        public float HoldTimer;                 // seconds the objective flag has been held
        public float HoldRequiredS = 30f;       // hold this long to win a HoldFlag scenario
        public float CaptureRadiusM = 220f;     // how close a crab must be to "hold" / "reach" a flag
        public string Status = "";              // human-readable progress for the HUD

        BattleSim _sim;
        public void Begin(BattleSim sim, Scenario sc)
        {
            _sim = sim; Scenario = sc; Outcome = BattleOutcome.InProgress; HoldTimer = 0f;
        }

        /// <summary>Advance objective tracking. Call each sim tick (dt seconds).</summary>
        public void Tick(float dt)
        {
            if (_sim == null || Scenario == null || Outcome != BattleOutcome.InProgress) return;

            int playerAlive = _sim.EffectiveCount(0);
            int enemyAlive = _sim.EffectiveCount(1);

            // Universal defeat: the whole player force is gone.
            if (playerAlive == 0) { Outcome = BattleOutcome.Defeat; Status = "FORCE ELIMINATED"; return; }

            switch (Scenario.Win)
            {
                case WinCondition.Eliminate:
                    if (enemyAlive == 0) { Outcome = BattleOutcome.Victory; Status = "ENEMY ELIMINATED"; }
                    else Status = $"ENEMY {enemyAlive} REMAINING";
                    break;

                case WinCondition.HoldFlag:
                {
                    var flag = FirstPlayerFlag();
                    bool held = flag != null && AnyPlayerNear(flag.Position);
                    bool enemyContesting = flag != null && AnyEnemyNear(flag.Position);
                    if (held && !enemyContesting) HoldTimer += dt;
                    else HoldTimer = Mathf.Max(0f, HoldTimer - dt * 0.5f);   // bleed if contested/abandoned
                    Status = held ? $"HOLDING {HoldTimer:0}/{HoldRequiredS:0}s{(enemyContesting ? " (CONTESTED)" : "")}"
                                  : $"OBJECTIVE UNHELD {HoldTimer:0}/{HoldRequiredS:0}s";
                    if (HoldTimer >= HoldRequiredS) { Outcome = BattleOutcome.Victory; Status = "OBJECTIVE SECURED"; }
                    // Also win if you clear the field while holding nothing required.
                    if (enemyAlive == 0) { Outcome = BattleOutcome.Victory; Status = "ENEMY ELIMINATED"; }
                    break;
                }

                case WinCondition.Escort:
                {
                    var exit = FirstPlayerFlag();
                    var convoy = FindByNamePart("CONVOY");
                    if (convoy == null || !convoy.Alive) { Outcome = BattleOutcome.Defeat; Status = "CONVOY LOST"; }
                    else if (exit != null && Vector3.Distance(convoy.Position, exit.Position) < CaptureRadiusM)
                    { Outcome = BattleOutcome.Victory; Status = "CONVOY REACHED EXIT"; }
                    else Status = exit != null
                        ? $"CONVOY {Vector3.Distance(convoy.Position, exit.Position)/1000f:0.0}km FROM EXIT"
                        : "ESCORT THE CONVOY";
                    break;
                }

                case WinCondition.DestroyTarget:
                {
                    var target = FindByNamePart("TARGET");
                    if (target == null || !target.Alive) { Outcome = BattleOutcome.Victory; Status = "TARGET DESTROYED"; }
                    else Status = $"TARGET {target.Structure:0}% — DESTROY IT";
                    break;
                }
            }
        }

        // ---- helpers ----
        CommandFlag FirstPlayerFlag()
        {
            foreach (var f in _sim.Command.Flags) if (f.Team == 0) return f;
            return null;
        }
        bool AnyPlayerNear(Vector3 p)
        {
            foreach (var u in _sim.Units)
                if (u.Team == 0 && u.Alive && Vector3.Distance(u.Position, p) < CaptureRadiusM) return true;
            return false;
        }
        bool AnyEnemyNear(Vector3 p)
        {
            foreach (var u in _sim.Units)
                if (u.Team == 1 && u.Alive && Vector3.Distance(u.Position, p) < CaptureRadiusM) return true;
            return false;
        }
        MechaUnit FindByNamePart(string part)
        {
            foreach (var u in _sim.Units) if (u.Name != null && u.Name.Contains(part)) return u;
            return null;
        }
    }
}
