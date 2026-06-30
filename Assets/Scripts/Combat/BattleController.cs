// CITY BATTLE — BattleController: the scene-level owner of a battle.
// Builds terrain, spawns mechas (sim + visual proxies), drives the BattleSim from SimClock,
// and renders interpolated unit/projectile/drone state. This is the vertical-slice entry point.
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Sim;
using CityBattle.Terrain;
using CityBattle.Units;
using CityBattle.Combat.Drones;

namespace CityBattle.Combat
{
    public class BattleController : MonoBehaviour
    {
        public TerrainBuilder TerrainBuilder;
        public SimClock Clock;
        public Material PlayerMat;
        public Material EnemyMat;
        public Material ProjectileMat;

        [Header("AI")]
        public bool EnemyAI = true;          // team 1 controlled by the bot commander
        public bool PlayerAI = false;        // team 0 too -> AI-vs-AI demonstration / self-test
        public AI.AiStance EnemyStance = AI.AiStance.Balanced;

        public BattleSim Sim { get; private set; }
        public TerrainField Terrain { get; private set; }

        readonly Dictionary<MechaUnit, MechaView> _views = new();
        readonly Dictionary<Projectile, Transform> _projViews = new();
        readonly Dictionary<DroneAgent, Transform> _droneViews = new();

        public System.Action OnBattleReady;

        void Start()
        {
            if (TerrainBuilder == null) TerrainBuilder = FindFirstObjectByType<TerrainBuilder>();
            if (Clock == null) Clock = FindFirstObjectByType<SimClock>();
            BuildBattle();
        }

        [Header("City terrain (optional)")]
        public bool UseRealCityBuildings = false;
        public string BuildingsJson = "Terrain/san_francisco_buildings.json";
        public float MinBuildingFootprintM = 200f;  // only render larger buildings as cover

        public void BuildBattle()
        {
            Terrain = TerrainBuilder.Build();
            Sim = new BattleSim(Terrain, 0xC1B);
            Sim.OnProjectileSpawned += SpawnProjectileView;
            Sim.OnImpact += OnImpact;

            // Optionally drape real OSM city buildings on the terrain as cover/occluders.
            if (UseRealCityBuildings)
            {
                var bGo = new GameObject("CityBuildings");
                bGo.transform.SetParent(TerrainBuilder.transform, false);
                var cb = bGo.AddComponent<CityBattle.Terrain.CityBuildings>();
                cb.MinFootprintM = MinBuildingFootprintM;
                cb.BuildFromJson(BuildingsJson, Terrain);
            }

            var db = Database.Instance;
            var playerNation = db.Nations.Count > 0 ? db.Nations[0] : default;
            var enemyNation = db.Nations.Count > 1 ? db.Nations[1] : playerNation;

            // --- Player force (south), in a tighter cluster so the camera frames it clearly. ---
            SpawnMecha("PLAYER-01 LEVIATHAN", 0, ChassisByName("Leviathan"), ArmorScheme.Dreadnought,
                playerNation, GunByName("BR-155 Battle Gun"), new Vector3(750, 0, 500));
            SpawnMecha("PLAYER-02 HOPLITE", 0, ChassisByName("Hoplite"), ArmorScheme.Dreadnought,
                playerNation, GunByName("HW-105 Howitzer"), new Vector3(950, 0, 480));
            SpawnMecha("PLAYER-03 BASTION", 0, ChassisByName("Bastion"), ArmorScheme.Dreadnought,
                playerNation, GunByName("SG-203 Heavy Siege"), new Vector3(1150, 0, 520));

            // --- Enemy force (north), ~1.2km away; one hull-down behind the ridge. ---
            var enemy = SpawnMecha("ENEMY-01 LEVIATHAN", 1, ChassisByName("Leviathan"), ArmorScheme.Dreadnought,
                enemyNation, GunByName("SG-203 Heavy Siege"), new Vector3(1000, 0, 1700));
            enemy.HullDown = true;
            SpawnMecha("ENEMY-02 PHALANX", 1, ChassisByName("Phalanx"), ArmorScheme.Skirmisher,
                enemyNation, GunByName("FT-76 Field Gun"), new Vector3(1250, 0, 1650));
            SpawnMecha("ENEMY-03 JACKAL", 1, ChassisByName("Jackal"), ArmorScheme.Skirmisher,
                enemyNation, GunByName("HW-105 Howitzer"), new Vector3(800, 0, 1750));

            // --- AI commanders ---
            if (EnemyAI) Sim.Commanders[1] = new AI.CommanderAI(1, EnemyStance) { UseDrones = true };
            if (PlayerAI) Sim.Commanders[0] = new AI.CommanderAI(0, AI.AiStance.Aggressive) { UseDrones = true };

            Clock.OnSimTick += Sim.Tick;
            Clock.OnRenderInterpolate += Render;
            Clock.Paused = true; // start paused; player gives orders first

            OnBattleReady?.Invoke();
            Debug.Log($"[Battle] Ready. {Sim.Units.Count} units on a {Terrain.WorldWidth:F0}x{Terrain.WorldLength:F0}m field. " +
                      $"EnemyAI={EnemyAI} PlayerAI={PlayerAI}. Paused.");
        }

        ChassisDef ChassisByName(string n) => Database.Instance.Chassis.Find(c => c.name == n);
        GunDef GunByName(string n) => Database.Instance.Guns.Find(g => g.name == n);

        /// <summary>Spawn a battle unit straight from a player-authored MechaDesign blueprint.</summary>
        public MechaUnit SpawnFromDesign(Design.MechaDesign design, int team, NationDef nation, Vector3 pos)
        {
            pos.y = Terrain.HeightAt(pos.x, pos.z);
            var u = design.Instantiate(Database.Instance, team, nation, pos);
            u.Id = Sim.Units.Count + 1;
            u.HeadingDeg = team == 0 ? 30f : 210f;
            u.EnsureSystems();
            Sim.Units.Add(u);
            var view = MechaView.Create(u.Name, team == 0 ? PlayerMat : EnemyMat, u.EyeHeight);
            view.transform.SetParent(transform);
            _views[u] = view;
            return u;
        }

        MechaUnit SpawnMecha(string name, int team, ChassisDef chassis, ArmorScheme armor,
                             NationDef nation, GunDef gun, Vector3 pos)
        {
            pos.y = Terrain.HeightAt(pos.x, pos.z);
            var u = new MechaUnit
            {
                Id = Sim.Units.Count + 1, Name = name, Team = team,
                Chassis = chassis, Armor = armor, Nation = nation,
                ArmorMaterial = Database.Instance.Armors.Count > 0 ? Database.Instance.Armors[0] : default,
                Position = pos, PrevPosition = pos, HeadingDeg = team == 0 ? 30f : 210f,
                EyeHeight = Mathf.Clamp(chassis.massBudgetT / 30f, 4f, 12f),
                Camouflage = chassis.baseCamo > 0 ? chassis.baseCamo : 1f,
                CommsRangeM = chassis.commsRangeM > 0 ? chassis.commsRangeM : 9000f
            };
            u.Weapons.Add(new WeaponInstance { def = gun, mountSocket = 0 });
            u.EnsureSystems();
            Sim.Units.Add(u);

            var view = MechaView.Create(name, team == 0 ? PlayerMat : EnemyMat, u.EyeHeight);
            view.transform.SetParent(transform);
            _views[u] = view;
            return u;
        }

        public DroneAgent LaunchRecon(MechaUnit owner, Vector3 targetArea)
        {
            var db = Database.Instance;
            var def = db.Drones.Find(d => d.role == DroneRole.Recon);
            if (def.name == null) return null;
            targetArea.y = Terrain.HeightAt(targetArea.x, targetArea.z);
            var d = new DroneAgent(def, owner.Team, owner.EyePosition, targetArea);
            Sim.ActiveDrones.Add(d);

            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Drone_" + def.name;
            go.transform.localScale = new Vector3(6, 2, 6);
            go.transform.SetParent(transform);
            if (PlayerMat) go.GetComponent<Renderer>().sharedMaterial = PlayerMat;
            _droneViews[d] = go.transform;
            return d;
        }

        void SpawnProjectileView(Projectile p)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = "Shell";
            go.transform.localScale = Vector3.one * Mathf.Clamp(p.CaliberMm / 40f, 1.5f, 6f);
            Destroy(go.GetComponent<Collider>());
            if (ProjectileMat) go.GetComponent<Renderer>().sharedMaterial = ProjectileMat;
            go.transform.SetParent(transform);
            _projViews[p] = go.transform;
        }

        void OnImpact(Vector3 pos, MechaUnit target, HitZone zone, bool pen)
        {
            // Simple flash; real FX later.
            // (left intentionally light — HUD/audio will hook this.)
        }

        void Render(float alpha)
        {
            foreach (var kv in _views)
            {
                var u = kv.Key; var v = kv.Value;
                if (!u.Alive) { v.SetDead(); continue; }
                v.transform.position = u.RenderPosition(alpha);
                v.transform.rotation = Quaternion.Euler(0, u.RenderHeading(alpha), 0);
                v.SetSpotted(Sim.IsSpotted(u), u.HullDown);
                v.SetDamageState(u.Immobilised, u.Disarmed, u.Sys?.OnFire ?? false, u.Structure / 100f);
                if (u.Team == 0) v.SetCommsState(u.OnNet, !u.OnNet && u.HasGhost);  // player comms picture
                // Aim the turret at the current fire target (or forward if none).
                v.AimTurret(u.FireTarget != null && u.FireTarget.Alive ? u.FireTarget.EyePosition : (Vector3?)null);
            }

            // Projectiles
            var deadP = new List<Projectile>();
            foreach (var kv in _projViews)
            {
                if (kv.Key.Dead || !Sim.Projectiles.Contains(kv.Key)) { deadP.Add(kv.Key); continue; }
                kv.Value.position = Vector3.Lerp(kv.Key.PrevPosition, kv.Key.Position, alpha);
            }
            foreach (var p in deadP) { if (_projViews[p]) Destroy(_projViews[p].gameObject); _projViews.Remove(p); }

            // Drones
            var deadD = new List<DroneAgent>();
            foreach (var kv in _droneViews)
            {
                if (kv.Key.Dead || !Sim.ActiveDrones.Contains(kv.Key)) { deadD.Add(kv.Key); continue; }
                kv.Value.position = kv.Key.RenderPosition(alpha);
            }
            foreach (var d in deadD) { if (_droneViews[d]) Destroy(_droneViews[d].gameObject); _droneViews.Remove(d); }
        }

        public MechaView ViewOf(MechaUnit u) => _views.TryGetValue(u, out var v) ? v : null;
    }
}
