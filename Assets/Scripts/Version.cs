namespace CityBattle
{
    /// <summary>Single source of truth for the build version (shown in HUD / about).</summary>
    public static class Version
    {
        public const string Number = "0.1.0";
        public const string Codename = "DREADNOUGHT CRAB";
        public static string Full => $"CITY BATTLE v{Number} \"{Codename}\"";
    }
}
