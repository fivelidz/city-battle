// CITY BATTLE — MechaView: procedural crab-mecha visual proxy.
// Builds a low-poly "crab" from primitives (carapace body, legs, gun mount sockets) so units
// are legible immediately, before authored GLB models. Exposes named sockets for modular guns.
// Replaceable: a designed mecha will swap this for a real chassis GLB + socketed weapon GLBs.
using System.Collections.Generic;
using UnityEngine;

namespace CityBattle.Units
{
    public class MechaView : MonoBehaviour
    {
        public Transform Body;
        public readonly List<Transform> WeaponSockets = new();
        Renderer[] _renderers;
        Material _baseMat;
        GameObject _spottedRing;

        // Visual oversizing: mechas are drawn somewhat larger than their true ~8m height so they
        // read on a kilometre map, but small enough to feel to-scale when you zoom in close.
        // (Lowered from 9x; the camera can now zoom right in to inspect individual units.)
        public const float VisualScale = 3.5f;

        public static MechaView Create(string name, Material mat, float height)
        {
            var root = new GameObject(name);
            var view = root.AddComponent<MechaView>();
            view.Build(mat, height);
            return view;
        }

        Transform _turret;
        Material _darkMat;

        void Build(Material mat, float height)
        {
            _baseMat = mat;
            // Build at an enlarged "icon" size so units are visible from the RTS camera.
            height *= VisualScale;
            float bodyR = Mathf.Clamp(height * 0.6f, 18f, 55f);
            float stand = height * 0.45f;   // ground-to-belly standing height

            // A darker variant material for legs/turret so the crab reads with contrast.
            if (mat != null)
            {
                _darkMat = new Material(mat);
                var c = mat.color * 0.55f; c.a = 1f;
                _darkMat.color = c;
                if (_darkMat.HasProperty("_BaseColor")) _darkMat.SetColor("_BaseColor", c);
            }

            // ---- Carapace: a wide, low, hull-like body (flattened cube reads as a crab shell). ----
            Body = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
            Body.name = "Carapace";
            Body.SetParent(transform);
            Body.localPosition = new Vector3(0, stand, 0);
            Body.localScale = new Vector3(bodyR * 2.0f, bodyR * 0.7f, bodyR * 2.4f);
            Strip(Body.gameObject);
            // bevel the front with a smaller angled block (glacis)
            var glacis = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
            glacis.name = "Glacis"; glacis.SetParent(transform); Strip(glacis.gameObject);
            glacis.localPosition = new Vector3(0, stand - bodyR*0.1f, bodyR*1.15f);
            glacis.localScale = new Vector3(bodyR*1.9f, bodyR*0.5f, bodyR*0.6f);
            glacis.localRotation = Quaternion.Euler(35, 0, 0);

            // ---- Sensor mast / cupola (front) ----
            var cupola = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
            cupola.name = "Cupola"; cupola.SetParent(transform); Strip(cupola.gameObject);
            cupola.localPosition = new Vector3(0, stand + bodyR*0.5f, bodyR*0.7f);
            cupola.localScale = new Vector3(bodyR*0.5f, bodyR*0.5f, bodyR*0.5f);

            // ---- Rotating turret + long barrel on top ----
            _turret = new GameObject("Turret").transform;
            _turret.SetParent(transform);
            _turret.localPosition = new Vector3(0, stand + bodyR*0.45f, -bodyR*0.2f);
            var turretBox = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
            turretBox.name = "TurretBox"; turretBox.SetParent(_turret); Strip(turretBox.gameObject);
            turretBox.localScale = new Vector3(bodyR*0.9f, bodyR*0.5f, bodyR*1.1f);
            var barrel = GameObject.CreatePrimitive(PrimitiveType.Cylinder).transform;
            barrel.name = "Barrel"; barrel.SetParent(_turret); Strip(barrel.gameObject);
            barrel.localRotation = Quaternion.Euler(90, 0, 0);
            barrel.localScale = new Vector3(bodyR*0.22f, bodyR*1.4f, bodyR*0.22f);
            barrel.localPosition = new Vector3(0, bodyR*0.1f, bodyR*1.5f);

            // ---- Legs: 8 angled crab legs that splay to the ground. ----
            int legsPerSide = 4;
            for (int side = -1; side <= 1; side += 2)
            for (int i = 0; i < legsPerSide; i++)
            {
                float t = (i - 1.5f) * 0.62f;
                var leg = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
                leg.name = $"Leg_{(side<0?"L":"R")}{i}";
                leg.SetParent(transform); Strip(leg.gameObject);
                float lx = side * bodyR * 1.15f;
                float lz = t * bodyR;
                leg.localScale = new Vector3(bodyR*0.16f, stand*1.25f, bodyR*0.16f);
                leg.localPosition = new Vector3(lx, stand*0.5f, lz);
                leg.localRotation = Quaternion.Euler(0, 0, side * 28f);
                if (_darkMat) leg.GetComponent<Renderer>().sharedMaterial = _darkMat;
            }

            // ---- Facing chevron (a flat triangle-ish marker pointing forward at the front). ----
            var chevron = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
            chevron.name = "Facing"; chevron.SetParent(transform); Strip(chevron.gameObject);
            chevron.localPosition = new Vector3(0, 1f, bodyR*1.8f);
            chevron.localScale = new Vector3(bodyR*0.5f, 0.5f, bodyR*0.9f);
            chevron.localRotation = Quaternion.Euler(0, 45, 0);

            // ---- Weapon sockets ----
            AddSocket("Mount_Dorsal", new Vector3(0, stand + bodyR*0.45f, 0));
            AddSocket("Mount_FlankL", new Vector3(-bodyR, stand, 0));
            AddSocket("Mount_FlankR", new Vector3(bodyR, stand, 0));

            // ---- Spotted ring (shows when this unit is visible to the enemy) ----
            _spottedRing = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            _spottedRing.name = "SpottedRing";
            Strip(_spottedRing);
            _spottedRing.transform.SetParent(transform);
            _spottedRing.transform.localPosition = new Vector3(0, 0.5f, 0);
            _spottedRing.transform.localScale = new Vector3(bodyR * 2.6f, 0.3f, bodyR * 2.6f);
            _spottedRing.SetActive(false);

            ApplyMaterial(mat);
            // legs keep dark mat
            foreach (var t in GetComponentsInChildren<Transform>())
                if (t.name.StartsWith("Leg_") && _darkMat) t.GetComponent<Renderer>().sharedMaterial = _darkMat;
            if (_turret != null && _darkMat)
                foreach (var r in _turret.GetComponentsInChildren<Renderer>()) r.sharedMaterial = _darkMat;
            _renderers = GetComponentsInChildren<Renderer>();
        }

        /// <summary>Aim the turret toward a world target (called by the controller when engaging).</summary>
        public void AimTurret(Vector3? worldTarget)
        {
            if (_turret == null) return;
            if (worldTarget.HasValue)
            {
                Vector3 d = worldTarget.Value - _turret.position; d.y = 0;
                if (d.sqrMagnitude > 1f) _turret.rotation = Quaternion.LookRotation(d, Vector3.up);
            }
        }

        void AddSocket(string n, Vector3 localPos)
        {
            var s = new GameObject(n).transform;
            s.SetParent(transform);
            s.localPosition = localPos;
            WeaponSockets.Add(s);
        }

        static void Strip(GameObject go)
        {
            var c = go.GetComponent<Collider>();
            if (c) Destroy(c);
        }

        void ApplyMaterial(Material mat)
        {
            if (mat == null) return;
            foreach (var r in GetComponentsInChildren<Renderer>())
                if (r.gameObject != _spottedRing) r.sharedMaterial = mat;
        }

        Material _ringMat;
        bool _ringTried;
        public void SetSpotted(bool spotted, bool hullDown)
        {
            if (!_spottedRing) return;
            _spottedRing.SetActive(spotted);
            if (spotted && _ringMat == null && !_ringTried)
            {
                _ringTried = true;
                var sh = ShaderUtilSafe.Unlit();
                if (sh != null)
                {
                    var col = new Color(1f, 0.85f, 0.1f, 1f);
                    _ringMat = new Material(sh) { color = col };
                    if (_ringMat.HasProperty("_BaseColor")) _ringMat.SetColor("_BaseColor", col);
                    _spottedRing.GetComponent<Renderer>().sharedMaterial = _ringMat;
                }
                else if (_baseMat != null)
                {
                    // Fallback: tint the base material brightly for the ring.
                    _ringMat = new Material(_baseMat) { color = new Color(1f, 0.85f, 0.1f, 1f) };
                    _spottedRing.GetComponent<Renderer>().sharedMaterial = _ringMat;
                }
            }
        }

        // Reflect localised damage: immobilised crabs list to one side; fires tint the hull red.
        public void SetDamageState(bool immobilised, bool disarmed, bool onFire, float structure01)
        {
            if (Body == null) return;
            // A wrecked turret droops the barrel; immobilised legs make it sag.
            if (disarmed && WeaponSockets.Count > 0)
                WeaponSockets[0].localRotation = Quaternion.Euler(35f, 0, 0);
            // Tint toward red/black as structure falls or when ablaze.
            if (_baseMat != null)
            {
                foreach (var r in GetComponentsInChildren<Renderer>())
                {
                    if (r.gameObject == _spottedRing) continue;
                    var c = _baseMat.color;
                    if (onFire) c = Color.Lerp(c, new Color(0.9f, 0.2f, 0.05f), 0.5f);
                    c = Color.Lerp(new Color(0.15f,0.13f,0.12f), c, Mathf.Clamp01(structure01 * 0.7f + 0.3f));
                    // Use a per-renderer material instance only if needed; keep cheap by tinting shared once.
                }
            }
        }

        public void SetDead()
        {
            transform.rotation = Quaternion.Euler(20, transform.eulerAngles.y, 15);
            if (_spottedRing) _spottedRing.SetActive(false);
        }

        public Transform SocketFor(int index) =>
            (index >= 0 && index < WeaponSockets.Count) ? WeaponSockets[index] : transform;
    }
}
