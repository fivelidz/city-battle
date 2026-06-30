// CITY BATTLE — CommsNet: the line-of-sight (laser / tight-beam) command-and-control network.
// Radio is too jammed in this world, so the fleet relays orders & intel over LOS comms. A crab is
// ON THE NET if a relay chain of friendly units (each with a working comms mast + terrain LOS to the
// next) links it back to the command node. Off the net -> the player loses control (it follows its
// last orders) and live intel; only a fading LAST-KNOWN ("ghost") position remains.
// See docs/INTELLIGENCE_LAYER.md. Reuses the terrain LOS ray-march (no new core tech).
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Units;
using CityBattle.Terrain;

namespace CityBattle.Combat
{
    public static class CommsNet
    {
        /// <summary>
        /// Recompute the comms net for `team`: BFS from the command node over friendly LOS links.
        /// Sets each friendly unit's OnNet / RelayVia, and updates ghost (last-known) state for
        /// units that have dropped off. `commandUnit` is the HQ link (e.g. the highest/first unit).
        /// </summary>
        public static void Recompute(IReadOnlyList<MechaUnit> units, TerrainField terrain, int team,
                                     double simTime, MechaUnit commandUnit = null)
        {
            var team_units = new List<MechaUnit>();
            foreach (var u in units) if (u.Team == team && u.Alive) team_units.Add(u);
            if (team_units.Count == 0) return;

            // The command node: explicit, else the unit with the best comms (alive, mast OK, highest).
            MechaUnit cmd = commandUnit;
            if (cmd == null || cmd.Team != team || !cmd.Alive)
            {
                foreach (var u in team_units)
                    if (cmd == null || (u.CanRelay && u.Position.y > cmd.Position.y)) cmd = u;
            }

            // BFS over LOS links between relay-capable friendlies within comms range.
            var onNet = new HashSet<MechaUnit>();
            var queue = new Queue<MechaUnit>();
            if (cmd != null) { onNet.Add(cmd); queue.Enqueue(cmd); cmd.RelayVia = null; }

            while (queue.Count > 0)
            {
                var relay = queue.Dequeue();
                if (!relay.CanRelay) continue;   // a relay with a wrecked mast can't pass comms on
                foreach (var other in team_units)
                {
                    if (onNet.Contains(other)) continue;
                    float dist = Vector3.Distance(relay.EyePosition, other.EyePosition);
                    float reach = Mathf.Min(relay.CommsRangeM, other.CommsRangeM);
                    if (dist > reach) continue;
                    if (!terrain.HasLineOfSight(relay.EyePosition, other.EyePosition)) continue;
                    onNet.Add(other);
                    other.RelayVia = (relay == cmd) ? null : relay.Name;
                    queue.Enqueue(other);
                }
            }

            // Apply on/off-net state + ghost (last-known) tracking.
            foreach (var u in team_units)
            {
                bool nowOnNet = onNet.Contains(u);
                if (nowOnNet)
                {
                    u.OnNet = true;
                    u.LastKnownPos = u.Position;     // net knows its live position
                    u.LastContactTime = simTime;
                    u.HasGhost = false;
                }
                else
                {
                    // Dropped off the net: hold the last-known position as a ghost.
                    if (u.OnNet) { u.LastKnownPos = u.Position; u.LastContactTime = simTime; }
                    u.OnNet = false;
                    u.RelayVia = null;
                    u.HasGhost = true;
                }
            }
        }

        /// <summary>How many of the team's living crabs are currently on the net.</summary>
        public static (int onNet, int total) Count(IReadOnlyList<MechaUnit> units, int team)
        {
            int on = 0, tot = 0;
            foreach (var u in units)
                if (u.Team == team && u.Alive) { tot++; if (u.OnNet) on++; }
            return (on, tot);
        }
    }
}
