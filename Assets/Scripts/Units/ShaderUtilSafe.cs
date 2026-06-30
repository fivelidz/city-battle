// CITY BATTLE — ShaderUtilSafe: robust shader lookup for runtime-created materials.
// Shader.Find can return null in standalone builds when a shader wasn't included (stripped).
// We try several candidates and cache the first that resolves; callers must null-check.
using UnityEngine;

namespace CityBattle.Units
{
    public static class ShaderUtilSafe
    {
        static Shader _unlit;
        static bool _tried;

        public static Shader Unlit()
        {
            if (_tried) return _unlit;
            _tried = true;
            string[] names =
            {
                "Universal Render Pipeline/Unlit",
                "Sprites/Default",
                "Unlit/Color",
                "Hidden/Internal-Colored",
                "UI/Default",
            };
            foreach (var n in names)
            {
                var s = Shader.Find(n);
                if (s != null) { _unlit = s; break; }
            }
            return _unlit;
        }
    }
}
