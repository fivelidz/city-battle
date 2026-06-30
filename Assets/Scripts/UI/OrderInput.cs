// CITY BATTLE — OrderInput: selection + order issuing (the RTwP command layer).
// Left-click selects a player mech; right-click on ground issues a move order; right-click on
// an enemy assigns a fire target. Orders can be given while paused (intent buffered into state).
using UnityEngine;
using CityBattle.Combat;
using CityBattle.Units;

namespace CityBattle.UI
{
    public class OrderInput : MonoBehaviour
    {
        public BattleController Controller;
        public Camera Cam;

        public MechaUnit Selected { get; private set; }
        public System.Action<MechaUnit> OnSelectionChanged;

        /// <summary>Programmatic selection (used by DemoDriver / scripted tests).</summary>
        public void SelectForDemo(MechaUnit u) { Selected = u; OnSelectionChanged?.Invoke(u); }

        void Update()
        {
            if (Controller?.Sim == null || Cam == null) return;

            if (Input.GetMouseButtonDown(0)) HandleSelect();
            if (Input.GetMouseButtonDown(1)) HandleOrder();

            // Fire mode hotkeys for the selected unit.
            if (Selected != null && Selected.Alive)
            {
                if (Input.GetKeyDown(KeyCode.Alpha1)) Selected.Fire = FireMode.Hold;
                if (Input.GetKeyDown(KeyCode.Alpha2)) Selected.Fire = FireMode.Direct;
                if (Input.GetKeyDown(KeyCode.Alpha3)) Selected.Fire = FireMode.Indirect;
                if (Input.GetKeyDown(KeyCode.H)) Selected.HullDown = !Selected.HullDown;
                if (Input.GetKeyDown(KeyCode.G)) LaunchRecon();
            }
        }

        public bool DebugSelect = false;

        void HandleSelect()
        {
            if (!RaycastGround(out Vector3 hit))
            {
                if (DebugSelect) Debug.Log("[Select] raycast missed ground");
                return;
            }
            // Pick nearest player unit to the click (generous radius — units are ~80m icons).
            MechaUnit best = null; float bestD = 200f;
            float nearestAny = 9999f;
            foreach (var u in Controller.Sim.Units)
            {
                if (u.Team != 0 || !u.Alive) continue;
                float d = Vector3.Distance(new Vector3(hit.x,0,hit.z), new Vector3(u.Position.x,0,u.Position.z));
                nearestAny = Mathf.Min(nearestAny, d);
                if (d < bestD) { bestD = d; best = u; }
            }
            if (DebugSelect) Debug.Log($"[Select] hit=({hit.x:0},{hit.z:0}) nearestPlayer={nearestAny:0}m selected={(best!=null?best.Name:"none")}");
            Selected = best;
            OnSelectionChanged?.Invoke(Selected);
        }

        void HandleOrder()
        {
            if (Selected == null || !Selected.Alive) return;
            // Off the comms net = out of contact: the player can't issue new orders (it follows
            // its last orders). Only friendly (team 0) units are player-commanded.
            if (Selected.Team == 0 && !Selected.OnNet)
            {
                Controller.Sim.Log.Add(Controller.Sim.SimTime, Combat.LogKind.Order,
                    $"{Selected.Name} OUT OF CONTACT — no comms (order not sent)", Selected.Id);
                return;
            }
            if (!RaycastGround(out Vector3 hit)) return;

            // Right-click near an enemy = target it; otherwise = move order.
            MechaUnit enemy = null; float bestD = 140f;
            foreach (var u in Controller.Sim.Units)
            {
                if (u.Team == 0 || !u.Alive) continue;
                float d = Vector3.Distance(new Vector3(hit.x,0,hit.z), new Vector3(u.Position.x,0,u.Position.z));
                if (d < bestD) { bestD = d; enemy = u; }
            }

            if (enemy != null)
            {
                Selected.FireTarget = enemy;
                if (Selected.Fire == FireMode.Hold) Selected.Fire = FireMode.Direct;
                Controller.Sim.Log.Add(Controller.Sim.SimTime, Combat.LogKind.Order,
                    $"{Selected.Name} ordered to engage {enemy.Name}", Selected.Id);
            }
            else
            {
                // SHIFT held => queue a chained waypoint; otherwise set a fresh move.
                bool shift = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
                if (shift) Selected.QueueMove(hit);
                else Selected.SetMove(hit);
                Controller.Sim.Log.Add(Controller.Sim.SimTime, Combat.LogKind.Order,
                    shift ? $"{Selected.Name} waypoint added" : $"{Selected.Name} ordered to move", Selected.Id);
            }
        }

        void LaunchRecon()
        {
            if (Selected == null) return;
            // Send recon toward the enemy half of the map (or the nearest known threat area).
            Vector3 area = new Vector3(1500, 0, 1600);
            Controller.LaunchRecon(Selected, area);
        }

        bool RaycastGround(out Vector3 hit)
        {
            hit = Vector3.zero;
            Ray ray = Cam.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out RaycastHit rh, 10000f)) { hit = rh.point; return true; }
            // Fallback: intersect the terrain field analytically.
            var t = Controller.Terrain;
            if (t == null) return false;
            for (float d = 100; d < 8000; d += 20f)
            {
                Vector3 p = ray.origin + ray.direction * d;
                if (p.y <= t.HeightAt(p.x, p.z)) { hit = t.ClampToGround(p); return true; }
            }
            return false;
        }
    }
}
