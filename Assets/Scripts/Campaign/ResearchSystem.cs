// CITY BATTLE — ResearchSystem: the RESEARCH pillar (docs/DESIGN.md 1, TECH_TREE.md).
// Year-gated, stochastic research mirroring Rule the Waves 3's ResearchAreas.dat model:
// each research interval, funded techs roll against their chance%; on success the invested
// points complete the tech. Loads tech.csv. Deterministic via an injected SimRandom.
using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using CityBattle.Sim;

namespace CityBattle.Campaign
{
    [Serializable]
    public struct TechDef
    {
        public int techId;
        public string branch;
        public string name;
        public int year;
        public bool starting;
        public float chancePct;
        public float cost;
        public string effect;
    }

    public class TechTree
    {
        public readonly List<TechDef> Techs = new();
        static TechTree _instance;
        public static TechTree Instance => _instance ??= Load();

        public static TechTree Load(string resourcePath = "CSV/tech")
        {
            var tt = new TechTree();
            var ta = Resources.Load<TextAsset>(resourcePath);
            if (ta == null) { Debug.LogError("[TechTree] Missing " + resourcePath); return tt; }
            var lines = ta.text.Replace("\r", "").Split('\n', StringSplitOptions.RemoveEmptyEntries);
            for (int i = 1; i < lines.Length; i++)
            {
                var c = lines[i].Split(',');
                if (c.Length < 8) continue;
                tt.Techs.Add(new TechDef
                {
                    techId = int.Parse(c[0], CultureInfo.InvariantCulture),
                    branch = c[1], name = c[2],
                    year = int.Parse(c[3], CultureInfo.InvariantCulture),
                    starting = c[4] == "1",
                    chancePct = float.Parse(c[5], CultureInfo.InvariantCulture),
                    cost = float.Parse(c[6], CultureInfo.InvariantCulture),
                    effect = c.Length > 7 ? c[7] : ""
                });
            }
            Debug.Log($"[TechTree] Loaded {tt.Techs.Count} techs.");
            return tt;
        }

        public IEnumerable<string> Branches()
        {
            var seen = new HashSet<string>();
            foreach (var t in Techs) if (seen.Add(t.branch)) yield return t.branch;
        }
    }

    /// <summary>A nation's research progress: which techs are known, and accumulated points.</summary>
    public class ResearchState
    {
        public HashSet<int> Known = new();
        public Dictionary<int, float> Invested = new();   // techId -> accumulated points
        public HashSet<int> Funded = new();               // techIds currently being funded

        public float ResearchSpeed = 1f;                  // nation modifier

        public void GrantStartingTech(TechTree tree)
        {
            foreach (var t in tree.Techs) if (t.starting) Known.Add(t.techId);
        }

        public bool IsKnown(int techId) => Known.Contains(techId);

        /// <summary>Techs available to fund now: year-reached, not known, prereq branch progression loose.</summary>
        public IEnumerable<TechDef> Available(TechTree tree, int year)
        {
            foreach (var t in tree.Techs)
                if (!Known.Contains(t.techId) && t.year <= year)
                    yield return t;
        }

        public void Fund(int techId) => Funded.Add(techId);
        public void Unfund(int techId) => Funded.Remove(techId);

        /// <summary>
        /// One research interval. `points` is the nation's research budget this interval, split
        /// across funded techs. Each rolls against chance%; success applies points toward cost.
        /// Returns techIds newly completed this interval.
        /// </summary>
        public List<int> Advance(TechTree tree, int year, float points, SimRandom rng)
        {
            var completed = new List<int>();
            var fundable = new List<TechDef>();
            foreach (var t in tree.Techs)
                if (Funded.Contains(t.techId) && !Known.Contains(t.techId) && t.year <= year)
                    fundable.Add(t);
            if (fundable.Count == 0) return completed;

            float share = points / fundable.Count * ResearchSpeed;
            foreach (var t in fundable)
            {
                float eff = Mathf.Clamp01(t.chancePct / 100f * ResearchSpeed);
                if (!rng.Chance(eff)) continue;             // no breakthrough this interval
                float inv = Invested.TryGetValue(t.techId, out var p) ? p : 0f;
                inv += share;
                Invested[t.techId] = inv;
                if (inv >= t.cost)
                {
                    Known.Add(t.techId);
                    Funded.Remove(t.techId);
                    Invested.Remove(t.techId);
                    completed.Add(t.techId);
                }
            }
            return completed;
        }
    }
}
