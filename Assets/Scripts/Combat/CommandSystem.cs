// CITY BATTLE — CommandSystem: flag-based command, flagships, and formations.
// The player commands by placing FLAGS (named objectives) on the map and assigning crabs to them;
// a designated FLAGSHIP anchors the comms net and leads a FORMATION. This is the bridge between
// "click a unit, right-click a spot" and proper fleet command.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Units;
using CityBattle.Terrain;

namespace CityBattle.Combat
{
    public enum FlagKind { Move, Hold, Attack, Rally }

    public class CommandFlag
    {
        public int Id;
        public string Label;
        public FlagKind Kind = FlagKind.Move;
        public Vector3 Position;
        public int Team;                       // which side owns this flag
        public readonly List<MechaUnit> Assigned = new();  // crabs ordered to this flag
    }

    public enum Formation { None, Line, Wedge, Column, Screen }

    public class CommandSystem
    {
        public readonly List<CommandFlag> Flags = new();
        public MechaUnit Flagship;             // the player's command crab (team 0)
        public Formation Formation = Formation.None;
        public float FormationSpacingM = 220f;
        int _nextFlagId = 1;

        // ---- Flags ----
        public CommandFlag PlaceFlag(string label, Vector3 pos, FlagKind kind = FlagKind.Move, int team = 0)
        {
            var f = new CommandFlag { Id = _nextFlagId++, Label = label, Position = pos, Kind = kind, Team = team };
            Flags.Add(f);
            return f;
        }

        public void RemoveFlag(CommandFlag f) { foreach (var u in f.Assigned) {} Flags.Remove(f); }

        /// <summary>Order a crab to a flag — it moves to (and holds/attacks at) the flag position.</summary>
        public void Assign(MechaUnit u, CommandFlag flag)
        {
            // Remove from any other flag first.
            foreach (var fl in Flags) fl.Assigned.Remove(u);
            flag.Assigned.Add(u);
            u.SetMove(flag.Position);
            u.Fire = flag.Kind == FlagKind.Attack ? FireMode.Direct : u.Fire;
        }

        public CommandFlag FlagOf(MechaUnit u)
        {
            foreach (var f in Flags) if (f.Assigned.Contains(u)) return f;
            return null;
        }

        // ---- Flagship ----
        /// <summary>Designate a crab as the flagship (command node). Defaults to the best-comms crab.</summary>
        public void SetFlagship(MechaUnit u) => Flagship = u;

        // A flagship is a substantial COMMAND crab: tonnage (command capacity) dominates, with
        // comms range, mounts and height as tie-breakers. A scout makes a poor flagship.
        static float FlagshipScore(MechaUnit u) =>
            u.Chassis.massBudgetT * 20f + u.CommsRangeM + u.Chassis.numWeaponMounts * 200f + u.Position.y * 10f;

        /// <summary>Pick a sensible default flagship for a team: alive, comms-mast OK, biggest/highest.</summary>
        public MechaUnit AutoFlagship(IReadOnlyList<MechaUnit> units, int team)
        {
            MechaUnit best = null;
            foreach (var u in units)
            {
                if (u.Team != team || !u.Alive || !u.CanRelay) continue;
                if (best == null || FlagshipScore(u) > FlagshipScore(best)) best = u;
            }
            Flagship = best;
            return best;
        }

        // ---- Formations: move a group to a flag holding a relative shape around a lead unit ----
        /// <summary>Order a group to a destination in formation (lead = flagship or first unit).</summary>
        public void MoveFormation(List<MechaUnit> group, Vector3 dest, TerrainField terrain)
        {
            if (group == null || group.Count == 0) return;
            var lead = (Flagship != null && group.Contains(Flagship)) ? Flagship : group[0];
            Vector3 dir = (dest - lead.Position); dir.y = 0;
            if (dir.sqrMagnitude < 1f) dir = lead.Forward;
            dir.Normalize();
            Vector3 right = Vector3.Cross(Vector3.up, dir);

            for (int i = 0; i < group.Count; i++)
            {
                var u = group[i];
                Vector3 offset = FormationOffset(i, group.Count, dir, right);
                Vector3 p = dest + offset;
                if (terrain != null) p.y = terrain.HeightAt(p.x, p.z);
                u.SetMove(p);
            }
        }

        Vector3 FormationOffset(int i, int n, Vector3 dir, Vector3 right)
        {
            float s = FormationSpacingM;
            switch (Formation)
            {
                case Formation.Line:   // abreast, perpendicular to travel
                    return right * ((i - (n - 1) / 2f) * s);
                case Formation.Column: // single file behind the lead
                    return -dir * (i * s);
                case Formation.Wedge:  // V — lead at point, others fanning back
                {
                    int side = (i % 2 == 0) ? 1 : -1;
                    int rank = (i + 1) / 2;
                    return -dir * (rank * s * 0.8f) + right * (side * rank * s * 0.6f);
                }
                case Formation.Screen: // spread wide ahead (scouts)
                    return right * ((i - (n - 1) / 2f) * s * 1.6f) + dir * s * 0.5f;
                default:
                    return right * ((i - (n - 1) / 2f) * s * 0.5f);
            }
        }
    }
}
