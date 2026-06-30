// CITY BATTLE — GameState: the persistent thread that ties all five components together.
// A DontDestroyOnLoad singleton holding the single CampaignState (budget, research, designs,
// roster) that the Menu / Design / Research / Campaign / Battle screens all read & write.
// This is the integration backbone: one game, five screens, one shared state.
using UnityEngine;
using CityBattle.Data;
using CityBattle.Design;

namespace CityBattle.Campaign
{
    public class GameState : MonoBehaviour
    {
        public static GameState Instance { get; private set; }

        public CampaignState Campaign;
        public TechTree Tech;
        public Database Db;

        // The design currently open in the shipyard (carried between Design <-> Campaign).
        public MechaDesign EditingDesign;
        // The next battle's deploy list (roster unit names), set by Campaign, read by Battle.
        public System.Collections.Generic.List<string> DeployRoster = new();
        public string BattleCity = "";   // optional real-city terrain for the next battle

        const string SaveKey = "citybattle.save.v1";

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
            Db = Database.Instance;
            Tech = TechTree.Instance;
            if (Campaign == null) NewGame();
        }

        public void NewGame(int nationId = 1)
        {
            Campaign = new CampaignState();
            Campaign.NewCampaign(Db, Tech, nationId);
            // Seed a starter design so the shipyard always has something.
            EditingDesign = StarterDesign();
            Campaign.Designs.Add(EditingDesign);
        }

        public MechaDesign StarterDesign()
        {
            var line = Db.Chassis.Find(c => c.cls == ChassisClass.Line);
            var gun = Db.Guns.Find(g => g.name.Contains("155"));
            var d = new MechaDesign
            {
                designName = "PATTERN-I HOPLITE",
                chassisId = line.id,
                armorMaterialId = Db.Armors.Count > 0 ? Db.Armors[0].id : 0,
                carapaceMm = 40, glacisMm = 150, flankMm = 100, legsMm = 50, cupolaMm = 80, mantletMm = 120
            };
            if (gun.name != null) d.weaponGunIds.Add(gun.id);
            return d;
        }

        // ---- Persistence (whole-game save) ----
        public void Save()
        {
            if (Campaign == null) return;
            PlayerPrefs.SetString(SaveKey, Campaign.ToJson());
            PlayerPrefs.Save();
            Debug.Log("[GameState] saved.");
        }

        public bool Load()
        {
            if (!PlayerPrefs.HasKey(SaveKey)) return false;
            Campaign = CampaignState.FromJson(PlayerPrefs.GetString(SaveKey));
            if (Campaign.Designs.Count > 0) EditingDesign = Campaign.Designs[0];
            Debug.Log("[GameState] loaded.");
            return true;
        }

        public bool HasSave() => PlayerPrefs.HasKey(SaveKey);

        /// <summary>Ensure a GameState exists (any screen can call this to bootstrap).</summary>
        public static GameState Ensure()
        {
            if (Instance != null) return Instance;
            var go = new GameObject("GameState");
            return go.AddComponent<GameState>();
        }
    }
}
