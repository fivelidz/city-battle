// CITY BATTLE — BattleCamera: RTS-style pan/zoom/orbit rig (mouse + touch friendly).
using UnityEngine;

namespace CityBattle.UI
{
    public class BattleCamera : MonoBehaviour
    {
        public Vector3 Target = new Vector3(1100, 0, 1000);
        public float Distance = 1600f;
        public float MinDistance = 40f;      // can zoom right in to inspect a single mecha
        public float MaxDistance = 5000f;    // and pull way out for the strategic overview
        public float Pitch = 55f;
        public float MinPitch = 12f;
        public float MaxPitch = 85f;
        public float Yaw = 0f;
        public float PanSpeed = 1.2f;
        public float ZoomSpeed = 0.12f;      // proportional zoom (smooth across the whole range)
        public float RotateSpeed = 80f;

        void LateUpdate()
        {
            HandleInput();
            Apply();
        }

        void HandleInput()
        {
            // Zoom (scroll) — PROPORTIONAL so it's smooth from a 5km overview down to a 40m close-up.
            float scroll = Input.mouseScrollDelta.y;
            if (Mathf.Abs(scroll) > 0.01f)
                Distance = Mathf.Clamp(Distance * (1f - scroll * ZoomSpeed), MinDistance, MaxDistance);
            // Zoom with +/- keys too (keyboard-friendly).
            if (Input.GetKey(KeyCode.Equals) || Input.GetKey(KeyCode.KeypadPlus)) Distance = Mathf.Max(MinDistance, Distance * 0.97f);
            if (Input.GetKey(KeyCode.Minus) || Input.GetKey(KeyCode.KeypadMinus)) Distance = Mathf.Min(MaxDistance, Distance * 1.03f);

            // Pan with arrow keys / WASD (scaled by distance so it feels consistent at any zoom).
            Vector3 fwd = Quaternion.Euler(0, Yaw, 0) * Vector3.forward;
            Vector3 right = Quaternion.Euler(0, Yaw, 0) * Vector3.right;
            float h = Input.GetAxisRaw("Horizontal");
            float v = Input.GetAxisRaw("Vertical");
            Target += (right * h + fwd * v) * PanSpeed * Distance * Time.deltaTime;

            if (Input.GetMouseButton(2))
            {
                Target -= right * Input.GetAxis("Mouse X") * PanSpeed * Distance * 0.02f;
                Target -= fwd * Input.GetAxis("Mouse Y") * PanSpeed * Distance * 0.02f;
            }

            // Rotate yaw with Q/E; tilt pitch with R/F.
            if (Input.GetKey(KeyCode.Q)) Yaw -= RotateSpeed * Time.deltaTime;
            if (Input.GetKey(KeyCode.E)) Yaw += RotateSpeed * Time.deltaTime;
            if (Input.GetKey(KeyCode.R)) Pitch = Mathf.Clamp(Pitch + RotateSpeed * 0.5f * Time.deltaTime, MinPitch, MaxPitch);
            if (Input.GetKey(KeyCode.F)) Pitch = Mathf.Clamp(Pitch - RotateSpeed * 0.5f * Time.deltaTime, MinPitch, MaxPitch);
        }

        /// <summary>Snap the camera to focus on a world position at a chosen distance (e.g. on select).</summary>
        public void FocusOn(Vector3 worldPos, float distance)
        {
            Target = worldPos;
            Distance = Mathf.Clamp(distance, MinDistance, MaxDistance);
        }

        void Apply()
        {
            Quaternion rot = Quaternion.Euler(Pitch, Yaw, 0);
            Vector3 pos = Target - (rot * Vector3.forward) * Distance;
            transform.position = pos;
            transform.rotation = rot;
        }
    }
}
