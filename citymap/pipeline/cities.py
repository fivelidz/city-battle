# CITY BATTLE - city bounding boxes. ARTILLERY SCALE (large: tens of km).
# Late-game guns reach ~30km, so battlefields are large. Terrain (topography + water) is the
# star; buildings are an optional dense overlay near the urban core.
# bbox = [west_lon, south_lat, east_lon, north_lat]

CITIES = {
    # Sydney harbour + eastern suburbs + north shore: the most dramatic terrain (harbour, cliffs,
    # headlands, ridges). ~18 x 18 km, fetched at HIGH resolution (z14, ~8 m/px) for real detail.
    "sydney": {
        "display": "Sydney - Harbour & Eastern Theatre",
        "bbox": [151.18, -33.90, 151.30, -33.79],
        "water_level_m": 0.0,
        "dem_zoom": 14,
        # Buildings across the WHOLE map bbox (not just the core) so the entire theatre is built up.
        "buildings_bbox": [151.18, -33.90, 151.30, -33.79],
    },
    # Tight harbour assault map (smaller, very dense) for close urban fights.
    "sydney_harbour": {
        "display": "Sydney - Harbour & CBD (assault)",
        "bbox": [151.19, -33.875, 151.265, -33.82],
        "water_level_m": 0.0,
        "dem_zoom": 14,
        "buildings_bbox": [151.19, -33.875, 151.265, -33.82],
    },
}


def get(city):
    if city not in CITIES:
        raise SystemExit(f"Unknown city '{city}'. Known: {', '.join(CITIES)}")
    return CITIES[city]
