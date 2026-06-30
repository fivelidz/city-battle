// CITY BATTLE — CombatLog: the scrolling battle narrative (RtW3's message log).
// A global feed plus per-unit feeds. Records ranging/straddle/hit/penetrate/bounce/system-KO/
// spotting/move events in plain language. This is the cheapest, most flavourful way to surface
// the four-gate gunnery model (Detected -> In range -> Locked -> Penetrate) to the player.
using System.Collections.Generic;

namespace CityBattle.Combat
{
    public enum LogKind { Info, Spot, Ranging, Straddle, Hit, Penetrate, Bounce, System, Order, Kill }

    public struct LogEntry
    {
        public double simTime;
        public LogKind kind;
        public string text;
        public int unitId;       // owning unit (-1 = global only)
    }

    public class CombatLog
    {
        public readonly List<LogEntry> Global = new();
        readonly Dictionary<int, List<LogEntry>> _perUnit = new();
        public int MaxGlobal = 400;

        public void Add(double t, LogKind kind, string text, int unitId = -1)
        {
            var e = new LogEntry { simTime = t, kind = kind, text = text, unitId = unitId };
            Global.Add(e);
            if (Global.Count > MaxGlobal) Global.RemoveAt(0);
            if (unitId >= 0)
            {
                if (!_perUnit.TryGetValue(unitId, out var list)) { list = new(); _perUnit[unitId] = list; }
                list.Add(e);
                if (list.Count > 120) list.RemoveAt(0);
            }
        }

        public IReadOnlyList<LogEntry> ForUnit(int unitId)
            => _perUnit.TryGetValue(unitId, out var list) ? list : System.Array.Empty<LogEntry>();

        public IEnumerable<LogEntry> Recent(int n)
        {
            int start = System.Math.Max(0, Global.Count - n);
            for (int i = start; i < Global.Count; i++) yield return Global[i];
        }

        public void Clear() { Global.Clear(); _perUnit.Clear(); }
    }
}
