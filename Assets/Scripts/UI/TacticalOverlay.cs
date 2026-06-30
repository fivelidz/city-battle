// CITY BATTLE — TacticalOverlay: world-space tactical drawing (the RtW3 information layer).
// For the SELECTED unit it draws: the move path (arrowed) + queued waypoints, a max-range ring,
// line-of-sight lines to each enemy (green = direct LOS, amber = spotted-via-relay/indirect,
// grey = unspotted), and a marker on the current fire target. Uses pooled LineRenderers so it
// works in standalone builds (no editor Gizmos / no OnPostRender camera dependency).
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Combat;
using CityBattle.Units;
using CityBattle.Terrain;

namespace CityBattle.UI
{
    public class TacticalOverlay : MonoBehaviour
    {
        public BattleController Controller;
        public OrderInput Input;

        readonly List<LineRenderer> _pool = new();
        int _used;
        Material _lineMat;

        static readonly Color MovePath = new Color(0.2f, 0.9f, 1f, 0.9f);
        static readonly Color Waypoint = new Color(0.2f, 0.7f, 1f, 0.7f);
        static readonly Color RangeRing = new Color(1f, 0.55f, 0.1f, 0.5f);
        static readonly Color LosClear = new Color(0.2f, 1f, 0.3f, 0.85f);   // direct LOS
        static readonly Color LosRelay = new Color(1f, 0.78f, 0.1f, 0.85f);  // spotted via relay (indirect)
        static readonly Color LosNone = new Color(0.5f, 0.5f, 0.55f, 0.35f); // not spotted
        static readonly Color TargetMark = new Color(1f, 0.15f, 0.15f, 1f);

        void Awake()
        {
            var sh = CityBattle.Units.ShaderUtilSafe.Unlit();
            if (sh != null) _lineMat = new Material(sh);
        }

        void LateUpdate()
        {
            if (Controller?.Sim == null) return;
            _used = 0;

            var sel = Input?.Selected;
            if (sel != null && sel.Alive)
            {
                DrawMovePath(sel);
                DrawRangeRing(sel);
                DrawLosLines(sel);
                if (sel.FireTarget != null && sel.FireTarget.Alive) DrawTargetMarker(sel.FireTarget);
            }

            // Hide unused pooled lines.
            for (int i = _used; i < _pool.Count; i++) _pool[i].enabled = false;
        }

        // ---- drawing primitives ----

        LineRenderer Next(Color c, float width)
        {
            LineRenderer lr;
            if (_used < _pool.Count) lr = _pool[_used];
            else
            {
                var go = new GameObject("OverlayLine");
                go.transform.SetParent(transform);
                lr = go.AddComponent<LineRenderer>();
                lr.material = _lineMat;
                lr.useWorldSpace = true;
                lr.numCapVertices = 2;
                lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                lr.receiveShadows = false;
                _pool.Add(lr);
            }
            _used++;
            lr.enabled = true;
            lr.startColor = lr.endColor = c;
            lr.startWidth = lr.endWidth = width;
            lr.startColor = c; lr.endColor = c;
            return lr;
        }

        void Line(Vector3 a, Vector3 b, Color c, float w)
        {
            var lr = Next(c, w);
            lr.positionCount = 2;
            lr.SetPosition(0, a + Vector3.up * 3f);
            lr.SetPosition(1, b + Vector3.up * 3f);
        }

        void Polyline(List<Vector3> pts, Color c, float w)
        {
            var lr = Next(c, w);
            lr.positionCount = pts.Count;
            for (int i = 0; i < pts.Count; i++) lr.SetPosition(i, pts[i] + Vector3.up * 3f);
        }

        // ---- overlays ----

        void DrawMovePath(MechaUnit u)
        {
            if (!u.HasMoveOrder) return;
            var terrain = Controller.Terrain;
            var pts = new List<Vector3> { GroundAt(u.Position, terrain), GroundAt(u.MoveTarget, terrain) };
            foreach (var wp in u.Waypoints) pts.Add(GroundAt(wp, terrain));
            // Densify so the path follows terrain height.
            var dense = Densify(pts, terrain, 40f);
            Polyline(dense, MovePath, 6f);

            // Arrowhead at the final destination.
            Vector3 end = pts[pts.Count - 1];
            Vector3 prev = pts[pts.Count - 2];
            DrawArrowhead(prev, end, MovePath, terrain);

            // Waypoint pips.
            for (int i = 1; i < pts.Count; i++) DrawRing(pts[i], 18f, Waypoint, 10);
        }

        void DrawArrowhead(Vector3 from, Vector3 to, Color c, TerrainField terrain)
        {
            Vector3 dir = (to - from); dir.y = 0;
            if (dir.sqrMagnitude < 0.01f) return;
            dir.Normalize();
            Vector3 right = Vector3.Cross(Vector3.up, dir);
            float s = 35f;
            Vector3 b1 = GroundAt(to - dir * s + right * s * 0.6f, terrain);
            Vector3 b2 = GroundAt(to - dir * s - right * s * 0.6f, terrain);
            Line(to, b1, c, 6f);
            Line(to, b2, c, 6f);
        }

        void DrawRangeRing(MechaUnit u)
        {
            if (u.Weapons.Count == 0) return;
            float range = u.Weapons[0].def.maxRangeM;
            // Clamp visual ring so it doesn't blow past the map; show effective + max.
            float shown = Mathf.Min(range, Controller.Terrain.WorldWidth * 0.9f);
            DrawRing(GroundAt(u.Position, Controller.Terrain), shown, RangeRing, 72, follow:true);
        }

        void DrawLosLines(MechaUnit u)
        {
            var sim = Controller.Sim;
            foreach (var e in sim.Units)
            {
                if (e.Team == u.Team || !e.Alive) continue;
                var sol = TacticalInfo.Solve(sim, u, e);
                Color c = !sol.detected ? LosNone : (sol.directLos ? LosClear : LosRelay);
                // Only draw to detected enemies fully; faintly to undetected (last-known not modelled yet).
                if (!sol.detected) continue;
                Line(GroundAt(u.EyePosition, Controller.Terrain), GroundAt(e.EyePosition, Controller.Terrain), c, sol.directLos ? 4f : 3f);
            }
        }

        void DrawTargetMarker(MechaUnit t)
        {
            DrawRing(GroundAt(t.Position, Controller.Terrain), 40f, TargetMark, 16);
            DrawRing(GroundAt(t.Position, Controller.Terrain), 55f, TargetMark, 20);
        }

        // ---- helpers ----

        void DrawRing(Vector3 center, float radius, Color c, int seg, bool follow = false)
        {
            var pts = new List<Vector3>();
            var terrain = Controller.Terrain;
            for (int i = 0; i <= seg; i++)
            {
                float a = (float)i / seg * Mathf.PI * 2f;
                Vector3 p = center + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * radius;
                p.y = follow ? terrain.HeightAt(p.x, p.z) : center.y;
                pts.Add(p);
            }
            Polyline(pts, c, follow ? 5f : 4f);
        }

        List<Vector3> Densify(List<Vector3> pts, TerrainField terrain, float step)
        {
            var outp = new List<Vector3>();
            for (int i = 0; i < pts.Count - 1; i++)
            {
                Vector3 a = pts[i], b = pts[i + 1];
                float d = Vector3.Distance(new Vector3(a.x,0,a.z), new Vector3(b.x,0,b.z));
                int n = Mathf.Max(1, Mathf.CeilToInt(d / step));
                for (int k = 0; k < n; k++)
                {
                    Vector3 p = Vector3.Lerp(a, b, (float)k / n);
                    p.y = terrain.HeightAt(p.x, p.z);
                    outp.Add(p);
                }
            }
            outp.Add(GroundAt(pts[pts.Count - 1], terrain));
            return outp;
        }

        static Vector3 GroundAt(Vector3 p, TerrainField t)
        {
            p.y = t.HeightAt(p.x, p.z);
            return p;
        }
    }
}
