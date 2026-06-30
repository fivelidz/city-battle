// CITY BATTLE — NavOverlay: drops the top navigation bar into any screen and ensures the
// persistent GameState exists. Add one to each scene (Campaign/Design/Research/Battle).
using UnityEngine;
using UnityEngine.SceneManagement;
using CityBattle.Campaign;

namespace CityBattle.UI
{
    public class NavOverlay : MonoBehaviour
    {
        public string CurrentScene = "";

        void Start()
        {
            GameState.Ensure();
            if (string.IsNullOrEmpty(CurrentScene))
                CurrentScene = SceneManager.GetActiveScene().name;
        }

        void OnGUI()
        {
            // Draw the nav bar very last so it sits on top; use a high depth.
            NavBar.Draw(CurrentScene);
        }
    }
}
