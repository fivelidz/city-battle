// CITY BATTLE — CampaignState: the MANAGEMENT pillar (docs/DESIGN.md 1, 5).
// Budget, production queue, unit roster, research allocation, calendar. Trimmed politics:
// alt-history nations with perks and simple tension. Serialises to JSON for save/load.
using System;
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Design;
using CityBattle.Sim;

namespace CityBattle.Campaign
{
    [Serializable]
    public class ProductionItem
    {
        public string designName;
        public string designJson;     // the MechaDesign blueprint
        public float costRemaining;
        public float totalCost;
        public int quantity = 1;
        public float Progress => totalCost > 0 ? 1f - costRemaining / totalCost : 1f;
    }

    [Serializable]
    public class RosterUnit
    {
        public string unitName;
        public string designName;
        public string designJson;
        public int condition = 100;   // 0..100; battle damage persists
        public bool deployed;
    }

    public class CampaignState
    {
        public int Year = 2025;
        public int Month = 1;
        public int PlayerNationId = 1;
        public float Budget = 50000f;            // build/maintenance currency
        public float ResearchPointsPerMonth = 120f;

        public readonly List<ProductionItem> ProductionQueue = new();
        public readonly List<RosterUnit> Roster = new();
        public readonly List<MechaDesign> Designs = new();
        public ResearchState Research = new();

        SimRandom _rng = new SimRandom(20250101u);

        public void NewCampaign(Database db, TechTree tree, int nationId = 1)
        {
            PlayerNationId = nationId;
            var nation = db.NationById(nationId);
            Year = nation.startingYear > 0 ? nation.startingYear : 2025;
            Research.ResearchSpeed = nation.researchSpeed <= 0 ? 1f : nation.researchSpeed;
            Research.GrantStartingTech(tree);
        }

        public NationDef Nation(Database db) => db.NationById(PlayerNationId);

        // ---- Production ----

        public bool QueueProduction(Database db, MechaDesign design, int qty = 1)
        {
            var val = design.Validate(db, Year);
            if (!val.ok) return false;
            float cost = design.TotalCost(db) * qty;
            ProductionQueue.Add(new ProductionItem
            {
                designName = design.designName, designJson = design.ToJson(),
                costRemaining = cost, totalCost = cost, quantity = qty
            });
            return true;
        }

        /// <summary>Advance one month: spend on production, run research, accrue income.</summary>
        public List<int> AdvanceMonth(Database db, TechTree tree, float income = 6000f, float buildSpend = 4000f)
        {
            Budget += income;

            // Pay down the front production item.
            if (ProductionQueue.Count > 0)
            {
                float spend = Mathf.Min(buildSpend, Budget, ProductionQueue[0].costRemaining);
                ProductionQueue[0].costRemaining -= spend;
                Budget -= spend;
                if (ProductionQueue[0].costRemaining <= 0.01f)
                {
                    var done = ProductionQueue[0];
                    for (int i = 0; i < done.quantity; i++)
                        Roster.Add(new RosterUnit
                        {
                            unitName = $"{done.designName}-{Roster.Count + 1:000}",
                            designName = done.designName, designJson = done.designJson, condition = 100
                        });
                    ProductionQueue.RemoveAt(0);
                }
            }

            // Research interval.
            float points = ResearchPointsPerMonth * (Nation(db).researchSpeed <= 0 ? 1f : Nation(db).researchSpeed);
            var completed = Research.Advance(tree, Year, points, _rng);

            // Calendar.
            Month++;
            if (Month > 12) { Month = 1; Year++; }
            return completed;
        }

        // ---- Persistence ----

        [Serializable]
        class SaveBlob
        {
            public int year, month, playerNationId;
            public float budget, rpm;
            public List<ProductionItem> queue;
            public List<RosterUnit> roster;
            public List<string> designJsons;
            public List<int> known;
        }

        public string ToJson()
        {
            var blob = new SaveBlob
            {
                year = Year, month = Month, playerNationId = PlayerNationId,
                budget = Budget, rpm = ResearchPointsPerMonth,
                queue = ProductionQueue, roster = Roster,
                designJsons = new List<string>(), known = new List<int>(Research.Known)
            };
            foreach (var d in Designs) blob.designJsons.Add(d.ToJson());
            return JsonUtility.ToJson(blob, true);
        }

        public static CampaignState FromJson(string json)
        {
            var blob = JsonUtility.FromJson<SaveBlob>(json);
            var cs = new CampaignState
            {
                Year = blob.year, Month = blob.month, PlayerNationId = blob.playerNationId,
                Budget = blob.budget, ResearchPointsPerMonth = blob.rpm
            };
            cs.ProductionQueue.AddRange(blob.queue ?? new List<ProductionItem>());
            cs.Roster.AddRange(blob.roster ?? new List<RosterUnit>());
            if (blob.designJsons != null)
                foreach (var dj in blob.designJsons) cs.Designs.Add(MechaDesign.FromJson(dj));
            if (blob.known != null) cs.Research.Known = new HashSet<int>(blob.known);
            return cs;
        }
    }
}
