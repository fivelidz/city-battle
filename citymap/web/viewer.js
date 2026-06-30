/* CITY BATTLE - Sydney tactical map viewer (fresh build).
   Loads the canonical citymap JSON (terrain grid + buildings in local metres), builds a
   heightmapped terrain mesh + extruded buildings, places demo crab units, and draws
   line-of-sight + gun-range overlays. Evangelion-esque MUTED palette. Three.js r128. */
(function () {
  "use strict";

  var CITIES = [
    ["sydney", "Sydney - Greater Harbour Theatre (32km)"],
    ["sydney_harbour", "Sydney - Harbour & CBD (assault)"],
  ];

  // ---------------------------------------------------------------------------
  // SUBURB / LOCALITY OVERLAY  (edit / add more here)
  // Each entry: [name, lon, lat]. Projected into the map's local-metre frame via the
  // same equirectangular transform the pipeline uses (see MAP_FORMAT.md):
  //   x = (lon - west)  * 111320 * cos(midlat)
  //   z = (lat - south) * 111320
  // Only localities whose projected (x,z) falls inside the loaded map's size_m are shown.
  // Centroids are hand-placed approximate suburb centres around Sydney Harbour / Eastern Suburbs
  // / Lower North Shore — the area covered by the sydney + sydney_harbour maps.
  // ---------------------------------------------------------------------------
  var SUBURBS = [
    ["The Rocks",       151.2089, -33.8599],
    ["Sydney CBD",      151.2093, -33.8688],
    ["Barangaroo",      151.2010, -33.8615],
    ["Millers Point",   151.2010, -33.8580],
    ["Dawes Point",     151.2085, -33.8550],
    ["Walsh Bay",       151.2040, -33.8560],
    ["Kirribilli",      151.2170, -33.8470],
    ["Milsons Point",   151.2120, -33.8460],
    ["McMahons Point",  151.2030, -33.8440],
    ["North Sydney",    151.2070, -33.8400],
    ["Neutral Bay",     151.2200, -33.8330],
    ["Cremorne",        151.2280, -33.8290],
    ["Cremorne Point",  151.2310, -33.8420],
    ["Mosman",          151.2440, -33.8290],
    ["Cremorne Junction",151.2270,-33.8260],
    ["Potts Point",     151.2250, -33.8700],
    ["Woolloomooloo",   151.2200, -33.8690],
    ["Elizabeth Bay",   151.2280, -33.8720],
    ["Darlinghurst",    151.2210, -33.8790],
    ["Rushcutters Bay", 151.2300, -33.8740],
    ["Surry Hills",     151.2110, -33.8850],
    ["Paddington",      151.2270, -33.8850],
    ["Edgecliff",       151.2390, -33.8790],
    ["Darling Point",   151.2380, -33.8700],
    ["Woollahra",       151.2420, -33.8870],
    ["Double Bay",      151.2440, -33.8770],
    ["Bellevue Hill",   151.2580, -33.8800],
    ["Point Piper",     151.2520, -33.8650],
    ["Rose Bay",        151.2680, -33.8700],
    ["Vaucluse",        151.2780, -33.8560],
    ["Watsons Bay",     151.2820, -33.8420],
    ["Dover Heights",   151.2790, -33.8730],
    ["Bondi",           151.2740, -33.8900],
    ["Bondi Junction",  151.2500, -33.8920],
    ["Woolwich",        151.1730, -33.8400],
    ["Hunters Hill",    151.1500, -33.8330],
    ["Birchgrove",      151.1810, -33.8500],
    ["Balmain",         151.1810, -33.8580],
    ["Balmain East",    151.1900, -33.8560],
    ["Pyrmont",         151.1950, -33.8700],
    ["Glebe",           151.1860, -33.8800],
    ["Ultimo",          151.1980, -33.8810],
    ["Chippendale",     151.1990, -33.8880],
    ["Waverton",        151.1980, -33.8380],
    ["Lavender Bay",    151.2070, -33.8440],
  ];

  var COL = {
    bg: 0x0b0d0c, water: 0x16302e, los: 0x6db48f, range: 0xb0822c,
    friend: 0x3e7a74, hostile: 0x9a3a33, civ: 0x7a6a3a,
  };

  var QS = new URLSearchParams(location.search);
  var viewMode = (QS.get("mode") === "elevation") ? "elevation" : "shaded";

  var scene, camera, renderer, controls, raycaster, mouse;
  var map = null, terrainMesh = null, terrainField = null, buildingsGroup = null;
  var unitsGroup = null, overlayGroup = null, wireMesh = null;
  var windGroup = null, rainGroup = null, suburbGroup = null;
  var units = [], selected = null;
  var show = { los: true, range: true, bld: true, wire: false, wind: false, rain: false,
               suburbs: QS.get("suburbs") === "1", fogcull: QS.get("fogcull") === "1",
               fire: false };

  // ---- FIRE ANALYSIS state ----
  // trajectory mode: "direct" (flat, lots of dead space) | "oblique" (arced howitzer, less)
  //                  | "mortar" (near-vertical, almost none)
  var fireMode = "direct";
  var fireQS = QS.get("fire");           // ?fire=direct|oblique|mortar force-enables for screenshots
  if (fireQS === "direct" || fireQS === "oblique" || fireQS === "mortar") {
    show.fire = true; fireMode = fireQS; show.los = false;   // fire shading replaces plain viewshed
  }
  var fireGroup = null;                   // overlay group for min/max + immunity rings
  var lastFireStats = null;               // {reachPct, deadPct, ...} last computed

  // ---- FLY CAMERA state ----
  var fly = {
    on: false,
    keys: {},                 // currently-pressed movement keys
    yaw: 0, pitch: 0,         // look angles (radians)
    speed: 0,                 // base units/sec, set when map loads (scales with map size)
    dragging: false, lastX: 0, lastY: 0,
    clock: null,
  };
  var buildingMeshes = [];    // chunked building meshes (for fog-cull); fallback: single merged mesh
  var buildingChunks = [];    // [{mesh, cx, cz, top}] centroid metadata per chunk for fog-cull

  // ---------- boot ----------
  function init() {
    var canvas = document.getElementById("c");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(COL.bg, 1);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COL.bg, 2500, 6500);

    camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 20000);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;

    // muted lighting (brighter so the baked topo detail reads clearly)
    scene.add(new THREE.HemisphereLight(0xc2d2c6, 0x1a1f1d, 1.05));
    var sun = new THREE.DirectionalLight(0xe6e0cf, 1.05);
    sun.position.set(-0.5, 1, 0.4); scene.add(sun);

    raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();

    fly.clock = new THREE.Clock();

    buildCitySelect();
    bindUI();
    bindFly();
    addEventListener("resize", onResize);
    renderer.domElement.addEventListener("click", onClick);
    loadCity("sydney");   // default to the large 32km theatre
    animate();
  }

  function buildCitySelect() {
    var sel = document.getElementById("citySel");
    CITIES.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c[0]; o.textContent = c[1]; sel.appendChild(o);
    });
    sel.onchange = function () { loadCity(sel.value); };
  }

  // ---------- load + build ----------
  function loadCity(key) {
    document.getElementById("load").style.display = "flex";
    document.getElementById("status").textContent = "LOADING " + key.toUpperCase();
    fetch("../data/" + key + ".citymap.json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { map = j; buildScene(); document.getElementById("load").style.display = "none"; })
      .catch(function (e) {
        document.getElementById("load").textContent = "MAP NOT FOUND: " + key + " (" + e + ")";
      });
  }

  function clearScene() {
    [terrainMesh, buildingsGroup, unitsGroup, overlayGroup, wireMesh, windGroup, rainGroup, suburbGroup, fireGroup].forEach(function (o) {
      if (o) { scene.remove(o); }
    });
    terrainMesh = buildingsGroup = unitsGroup = overlayGroup = wireMesh = null;
    windGroup = rainGroup = suburbGroup = fireGroup = null;
    buildingMeshes = []; buildingChunks = [];
    units = []; selected = null;
    document.getElementById("unit").style.display = "none";
  }

  var vshed = null; // viewshed visibility array (0..1 per vertex)

  function buildScene() {
    clearScene();
    var t = map.terrain, res = t.res, cell = t.cell_m, H = t.heights;
    var W = map.size_m[0], L = map.size_m[1];
    terrainField = { res: res, cell: cell, H: H, W: W, L: L };
    vshed = null;

    // ----- terrain mesh (heightmapped grid) with a BAKED topographic texture -----
    var geo = new THREE.PlaneGeometry(W, L, res - 1, res - 1);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) pos.setY(i, H[i]);   // index i == z*res+x
    geo.computeVertexNormals();
    // per-vertex viewshed colour multiplier (starts at 1 = fully lit)
    var vcol = new Float32Array(pos.count * 3);
    for (var v = 0; v < pos.count; v++) { vcol[v*3]=1; vcol[v*3+1]=1; vcol[v*3+2]=1; }
    geo.setAttribute("color", new THREE.BufferAttribute(vcol, 3));

    terrainTex = buildTopoTexture(t, map.water_level_m);
    var mat = new THREE.MeshStandardMaterial({
      map: terrainTex, vertexColors: true, roughness: 0.95, metalness: 0 });
    terrainMesh = new THREE.Mesh(geo, mat);
    terrainMesh.position.set(W / 2, 0, L / 2);
    scene.add(terrainMesh);

    // contour wireframe overlay (toggle)
    wireMesh = new THREE.LineSegments(new THREE.WireframeGeometry(geo.clone()),
      new THREE.LineBasicMaterial({ color: 0x4a5a50, transparent: true, opacity: 0.12 }));
    wireMesh.position.copy(terrainMesh.position); wireMesh.visible = show.wire; scene.add(wireMesh);

    // ----- water surface plane at sea level (negative elevation = water) -----
    if (t.min_m < map.water_level_m - 0.2) {
      var wg = new THREE.PlaneGeometry(W, L); wg.rotateX(-Math.PI / 2);
      var wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
        color: COL.water, transparent: true, opacity: 0.55, roughness: 0.25, metalness: 0.1 }));
      wm.position.set(W / 2, map.water_level_m + 0.5, L / 2);
      scene.add(wm); waterMesh = wm;
    } else { waterMesh = null; }

    // fog scales with map size
    scene.fog = new THREE.Fog(COL.bg, Math.max(W, L) * 0.6, Math.max(W, L) * 1.8);

    // ----- buildings -----
    buildBuildings();

    // ----- weather overlays (wind arrows, rain) + readout -----
    buildWeather();

    // ----- suburb / locality overlay (labels + boundary markers) -----
    buildSuburbs();

    // ----- demo units + overlays -----
    placeDemoUnits();
    selected = units[0] || null;     // select a unit so the viewshed shows on load
    if (selected) selectUnit(selected);
    rebuildOverlays();

    // ----- camera framing -----
    frameCamera();

    // ----- HUD text -----
    document.getElementById("cityName").textContent = map.display;
    document.getElementById("lCity").textContent = map.display;
    document.getElementById("lExt").textContent = Math.round(W) + " x " + Math.round(L) + " m";
    document.getElementById("lRel").textContent = t.min_m + " .. " + t.max_m + " m";
    document.getElementById("lBld").textContent = map.buildings.length + " structures";
    document.getElementById("status").textContent = "SECTOR ACTIVE";
  }

  var waterMesh = null, buildings_water = null;

  // Buildings are split into a coarse spatial GRID of merged chunks. One merged mesh would be
  // fastest, but the FOG-CULL feature needs to dim/hide buildings outside the selected unit's
  // viewshed — so we bucket buildings into NxN chunks (still only ~36-64 draw calls) and toggle /
  // tint whole chunks. Each chunk keeps its centroid so fog-cull can test it against LOS+range.
  var BLD_CHUNKS = 8;   // grid of chunks per axis (8x8 = 64 chunks max)

  function buildBuildings() {
    buildingsGroup = new THREE.Group();
    buildingMeshes = []; buildingChunks = [];
    var W = map.size_m[0], L = map.size_m[1];
    // Building footprints are in the SAME local-metre frame (x=east, z=north) as the terrain grid.
    var lowC = [0.30, 0.33, 0.30], midC = [0.40, 0.43, 0.40], hiC = [0.55, 0.57, 0.55];
    var n = map.buildings.length;

    // bucket building indices by chunk
    var nc = BLD_CHUNKS;
    var buckets = {};   // key "cz_cx" -> { verts, cols, minX, maxX, minZ, maxZ, sumX, sumZ, maxTop, cnt }
    function bucketFor(cx, cz) {
      var key = cz * nc + cx;
      var bk = buckets[key];
      if (!bk) { bk = buckets[key] = { verts: [], cols: [], sumX: 0, sumZ: 0, maxTop: 0, cnt: 0 }; }
      return bk;
    }
    for (var i = 0; i < n; i++) {
      var b = map.buildings[i];
      var p = b.poly; if (!p || p.length < 3) continue;
      // centroid (vertex average is fine for bucketing)
      var ccx = 0, ccz = 0;
      for (var v = 0; v < p.length; v++) { ccx += p[v][0]; ccz += p[v][1]; }
      ccx /= p.length; ccz /= p.length;
      var cx = clamp(Math.floor(ccx / W * nc), 0, nc - 1);
      var cz = clamp(Math.floor(ccz / L * nc), 0, nc - 1);
      var bk = bucketFor(cx, cz);
      var topBefore = bk.verts.length;
      addBuilding(b, bk.verts, bk.cols, lowC, midC, hiC);
      if (bk.verts.length > topBefore) {
        bk.sumX += ccx; bk.sumZ += ccz; bk.cnt++;
        var top = (b.base_m || 0) + Math.max(3, b.h || 8);
        if (top > bk.maxTop) bk.maxTop = top;
      }
    }

    Object.keys(buckets).forEach(function (key) {
      var bk = buckets[key];
      if (!bk.verts.length) return;
      var bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(bk.verts, 3));
      bg.setAttribute("color", new THREE.Float32BufferAttribute(bk.cols, 3));
      bg.computeVertexNormals();
      var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
      var bmesh = new THREE.Mesh(bg, mat);
      buildingsGroup.add(bmesh);
      buildingMeshes.push(bmesh);
      buildingChunks.push({
        mesh: bmesh, mat: mat,
        cx: bk.sumX / Math.max(1, bk.cnt),
        cz: bk.sumZ / Math.max(1, bk.cnt),
        top: bk.maxTop,
      });
    });

    buildingsGroup.visible = show.bld;
    scene.add(buildingsGroup);
    applyFogCull();   // honour current fog-cull state on (re)build
  }

  // Triangulate a building footprint (fan) + extrude its walls; append to vert/col arrays.
  function addBuilding(b, verts, cols, lowC, midC, hiC) {
    var p = b.poly; if (!p || p.length < 3) return;
    var base = b.base_m || 0;
    var h = Math.max(3, b.h || 8);
    var top = base + h;
    var c = h > 60 ? hiC : (h > 20 ? midC : lowC);
    var np = p.length;
    // roof (triangle fan around vertex 0) at y=top
    for (var k = 1; k < np - 1; k++) {
      pushV(verts, cols, p[0][0], top, p[0][1], c);
      pushV(verts, cols, p[k][0], top, p[k][1], c);
      pushV(verts, cols, p[k+1][0], top, p[k+1][1], c);
    }
    // walls
    var wc = [c[0]*0.8, c[1]*0.8, c[2]*0.8];
    for (var j = 0; j < np; j++) {
      var a = p[j], d = p[(j+1) % np];
      // two triangles per wall quad (base->top)
      pushV(verts, cols, a[0], base, a[1], wc); pushV(verts, cols, d[0], base, d[1], wc); pushV(verts, cols, d[0], top, d[1], wc);
      pushV(verts, cols, a[0], base, a[1], wc); pushV(verts, cols, d[0], top, d[1], wc); pushV(verts, cols, a[0], top, a[1], wc);
    }
  }
  function pushV(verts, cols, x, y, z, c) { verts.push(x, y, z); cols.push(c[0], c[1], c[2]); }

  // ---------- WEATHER: wind arrows + rain + readout ----------
  // Wind field points are in the SAME local-metre frame (x=east, z=north). u=east, v=north (m/s),
  // the direction the wind blows TO. We draw a short arrow at each point, lifted above terrain.
  function buildWeather() {
    windGroup = new THREE.Group(); windGroup.visible = show.wind; scene.add(windGroup);
    rainGroup = new THREE.Group(); rainGroup.visible = show.rain; scene.add(rainGroup);

    var w = map.weather;
    updateWeatherReadout(w);
    if (!w || !w.field || !w.field.length) return;

    var W = map.size_m[0], L = map.size_m[1];
    var span = Math.max(W, L);
    // arrow geometry scale: keep arrows readable on a multi-km map
    var lift = Math.max(40, span * 0.012);          // height above terrain
    var maxSpeed = 1;
    for (var s = 0; s < w.field.length; s++) maxSpeed = Math.max(maxSpeed, w.field[s].wind_speed || 0);
    var baseLen = span * 0.060;                      // length for the strongest arrow

    var shaftMat = new THREE.LineBasicMaterial({ color: 0xaad4ec, transparent: true, opacity: 0.92 });
    var headMat  = new THREE.MeshBasicMaterial({ color: 0xc4e4f4, transparent: true, opacity: 0.95, side: THREE.DoubleSide });

    // sample the field vector nearest to an arbitrary local-metre point
    function sampleField(qx, qz) {
      var best = null, bd = Infinity;
      for (var k = 0; k < w.field.length; k++) {
        var fp = w.field[k];
        var dd = (fp.x_m - qx) * (fp.x_m - qx) + (fp.z_m - qz) * (fp.z_m - qz);
        if (dd < bd) { bd = dd; best = fp; }
      }
      return best;
    }

    // Lay arrows on an EVEN grid INSIDE the map so they are always visible & well spread,
    // each sampling the nearest real weather vector. (The raw 8x8 lattice spans the wider
    // bbox and many points fall off-map, so a re-sample keeps the display clean.)
    var GN = 9;
    for (var gz = 0; gz < GN; gz++) {
      for (var gx = 0; gx < GN; gx++) {
        var px = W * (gx + 0.5) / GN;
        var pz = L * (gz + 0.5) / GN;
        var p = sampleField(px, pz); if (!p) continue;
        var spd = p.wind_speed || Math.hypot(p.u || 0, p.v || 0);
        // direction the wind blows TO, in XZ plane (u=east=+x, v=north=+z)
        var dx = (p.u || 0), dz = (p.v || 0);
        var dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        // guaranteed-visible length even in calm air, longer with stronger wind
        var len = baseLen * (0.45 + 0.55 * clamp(spd / maxSpeed, 0, 1));
        var y = heightAt(px, pz) + lift;
        var ax = px - dx * len * 0.5, az = pz - dz * len * 0.5;   // tail
        var bx = px + dx * len * 0.5, bz = pz + dz * len * 0.5;   // tip

        // shaft
        var sg = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(ax, y, az), new THREE.Vector3(bx, y, bz)]);
        windGroup.add(new THREE.Line(sg, shaftMat));
        // arrowhead (small flat triangle pointing along the wind)
        var hl = len * 0.34, hw = len * 0.20;
        var perpx = -dz, perpz = dx;
        var h0 = new THREE.Vector3(bx, y, bz);
        var h1 = new THREE.Vector3(bx - dx*hl + perpx*hw, y, bz - dz*hl + perpz*hw);
        var h2 = new THREE.Vector3(bx - dx*hl - perpx*hw, y, bz - dz*hl - perpz*hw);
        var hg = new THREE.BufferGeometry().setFromPoints([h0, h1, h2]);
        hg.setIndex([0,1,2]); hg.computeVertexNormals();
        windGroup.add(new THREE.Mesh(hg, headMat));
      }
    }

    // ----- RAIN: only if it's actually precipitating -----
    var meanP = (w.summary && w.summary.mean_precip) || 0;
    if (meanP > 0) {
      var N = 1400;
      var rg = new THREE.BufferGeometry();
      var arr = new Float32Array(N * 3);
      rainTop = span * 0.6;
      for (var r = 0; r < N; r++) {
        arr[r*3]   = Math.random() * W;
        arr[r*3+1] = Math.random() * rainTop;
        arr[r*3+2] = Math.random() * L;
      }
      rg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      var rmat = new THREE.PointsMaterial({ color: 0x9fb6c8, size: Math.max(6, span*0.0012),
        transparent: true, opacity: clamp(0.25 + meanP * 0.15, 0.2, 0.7), sizeAttenuation: true });
      rainPoints = new THREE.Points(rg, rmat);
      rainGroup.add(rainPoints);
    } else { rainPoints = null; }
  }
  var rainPoints = null, rainTop = 0;

  function updateWeatherReadout(w) {
    var el = document.getElementById("wxBody");
    if (!el) return;
    if (!w || !w.summary) { el.innerHTML = '<div class="row dim">NO WEATHER DATA</div>'; return; }
    var s = w.summary;
    var dir = Math.round(s.mean_wind_dir || 0);
    var spd = (s.mean_wind_speed || 0);
    var kmh = (spd * 3.6);
    var precip = (s.mean_precip || 0);
    var rainTxt = precip > 0 ? (precip.toFixed(1) + " mm") : '<span class="k">DRY</span>';
    var cond = (s.conditions_text || "").toUpperCase();
    el.innerHTML =
      '<div class="row"><span class="dim">WIND&nbsp;</span> <span class="k">' + spd.toFixed(1) + ' m/s</span> ' +
        '<span class="dim">(' + kmh.toFixed(0) + ' km/h)</span></div>' +
      '<div class="row"><span class="dim">DIR&nbsp;&nbsp;</span> ' + dirText(dir) + ' <span class="dim">' + dir + '\u00B0</span></div>' +
      '<div class="row"><span class="dim">RAIN&nbsp;</span> ' + rainTxt + '</div>' +
      '<div class="row"><span class="dim">PRES&nbsp;</span> ' + Math.round(s.pressure_msl || 0) + ' hPa</div>' +
      '<div class="row"><span class="dim">CLOUD</span> ' + Math.round(s.mean_cloud || 0) + ' %</div>' +
      '<div class="row dim" style="margin-top:4px">' + cond + '</div>';
  }
  function dirText(deg) {
    var dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(((deg % 360) / 22.5)) % 16];
  }

  // ---------- SUBURB / LOCALITY OVERLAY ----------
  // Project the hardcoded SUBURBS list into the map's local-metre frame and place a floating
  // canvas-sprite label + a small ground marker at each locality that falls inside the map.
  function buildSuburbs() {
    suburbGroup = new THREE.Group();
    suburbGroup.visible = show.suburbs;
    scene.add(suburbGroup);

    if (!map || !map.bbox) return;
    var west = map.bbox[0], south = map.bbox[1], east = map.bbox[2], north = map.bbox[3];
    var midlat = (south + north) / 2;
    var mPerLon = 111320 * Math.cos(midlat * Math.PI / 180);
    var mPerLat = 111320;
    var W = map.size_m[0], L = map.size_m[1];
    var span = Math.max(W, L);
    var lift = Math.max(120, span * 0.020);   // float labels above the terrain

    var placed = 0;
    for (var i = 0; i < SUBURBS.length; i++) {
      var s = SUBURBS[i];
      var x = (s[1] - west) * mPerLon;     // east metres from origin
      var z = (s[2] - south) * mPerLat;    // north metres from origin
      if (x < 0 || x > W || z < 0 || z > L) continue;   // outside this map
      var gy = heightAt(x, z);

      // floating text label (canvas sprite, muted Eva style)
      var spr = makeLabelSprite(s[0], span);
      spr.position.set(x, gy + lift, z);
      suburbGroup.add(spr);

      // thin "tether" line from the label down to the ground marker
      var tg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, gy + lift, z), new THREE.Vector3(x, gy + 4, z)]);
      suburbGroup.add(new THREE.Line(tg, new THREE.LineBasicMaterial({
        color: 0x6d8378, transparent: true, opacity: 0.30 })));

      // ground boundary marker: a faint ring locating the locality centroid
      var ringR = Math.max(60, span * 0.012);
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(ringR * 0.9, ringR, 28),
        new THREE.MeshBasicMaterial({ color: 0x7d9387, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, gy + 3, z);
      suburbGroup.add(ring);
      placed++;
    }
    suburbGroup.userData = { placed: placed };
  }

  // Build a muted canvas-texture sprite for a suburb name. Sprites always face the camera and
  // scale with the map so they stay legible whether you orbit out or fly low.
  function makeLabelSprite(text, span) {
    var pad = 18, fs = 40;
    var cv = document.createElement("canvas");
    var mctx = cv.getContext("2d");
    mctx.font = "bold " + fs + "px DejaVu Sans Mono, monospace";
    var tw = Math.ceil(mctx.measureText(text.toUpperCase()).width);
    cv.width = tw + pad * 2; cv.height = fs + pad * 2;
    var ctx = cv.getContext("2d");
    // muted panel background
    ctx.fillStyle = "rgba(13,17,16,0.72)";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "rgba(120,140,130,0.30)";
    ctx.lineWidth = 2; ctx.strokeRect(1, 1, cv.width - 2, cv.height - 2);
    // amber-ish muted text
    ctx.font = "bold " + fs + "px DejaVu Sans Mono, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(176,130,44,0.95)";
    ctx.fillText(text.toUpperCase(), cv.width / 2, cv.height / 2 + 2);

    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4; tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
    var spr = new THREE.Sprite(mat);
    // world scale: keep the label a sensible fraction of the map; aspect from canvas
    var hWorld = Math.max(120, span * 0.022);
    var wWorld = hWorld * (cv.width / cv.height);
    spr.scale.set(wWorld, hWorld, 1);
    return spr;
  }

  // ---------- FOG-CULL LOD ----------
  // When FOG CULL is on and a unit is selected, dim/hide building chunks that the unit cannot see
  // (outside sight range OR terrain-blocked LOS). Reuses the same LOS test as the viewshed so the
  // hidden buildings line up with the fog-of-war darkening on the terrain. Operates per-chunk
  // (centroid test) so it stays cheap even with 18k buildings.
  function applyFogCull() {
    if (!buildingChunks.length) return;
    // OFF, or buildings hidden, or no selection -> everything fully lit & visible
    if (!show.fogcull || !show.bld || !selected) {
      for (var i = 0; i < buildingChunks.length; i++) {
        var c = buildingChunks[i];
        c.mesh.visible = show.bld;
        c.mat.color.setRGB(1, 1, 1);
        c.mat.opacity = 1; c.mat.transparent = false;
      }
      return;
    }
    var d = selected.userData;
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var rz = (map.size_m[1] / (res - 1));
    var sightM = (d.rangeM > 0 ? Math.max(d.rangeM, 8000) : 12000) * fogFactor();
    var ex = d.x, ez = d.z, ey = d.eye + 8;

    for (var k = 0; k < buildingChunks.length; k++) {
      var ch = buildingChunks[k];
      var dist = Math.hypot(ch.cx - ex, ch.cz - ez);
      var visible;
      if (dist > sightM) {
        visible = false;
      } else {
        // test LOS to the top of the tallest building in the chunk (roofs poke over ridgelines)
        var by = Math.max(heightAt(ch.cx, ch.cz) + 2, ch.top);
        visible = losGrid(ex, ez, ey, ch.cx, ch.cz, by, res, H, cell, rz);
      }
      if (visible) {
        ch.mesh.visible = true;
        ch.mat.color.setRGB(1, 1, 1);
        ch.mat.opacity = 1; ch.mat.transparent = false;
      } else {
        // darken + fade chunks the unit can't see (don't fully hide so the city silhouette stays
        // faintly readable as "fogged" structure, matching the dark fog-of-war terrain)
        ch.mesh.visible = true;
        ch.mat.color.setRGB(0.20, 0.22, 0.26);
        ch.mat.transparent = true; ch.mat.opacity = 0.32;
      }
    }
  }

  var terrainTex = null;

  // Bake a detailed topographic texture: hypsometric tint + analytic HILLSHADE + CONTOUR lines.
  // Texture u maps to x (east), v maps to z (north). Vertex (x,z) has uv (x/(res-1), z/(res-1)).
  function buildTopoTexture(t, wlevel) {
    var res = t.res, H = t.heights, lo = t.min_m, hi = t.max_m, cell = t.cell_m;
    // supersample the texture a bit above grid res for crisper contours
    var TS = Math.min(2048, (res - 1) * 4);
    var cv = document.createElement("canvas"); cv.width = cv.height = TS;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(TS, TS);
    var d = img.data;
    // light direction for hillshade (NW, classic)
    var lx = -0.6, ly = 0.55, lz = -0.6; var ll = Math.hypot(lx, ly, lz); lx/=ll; ly/=ll; lz/=ll;

    function Hat(fx, fz) { // bilinear height at grid coords
      fx = clamp(fx, 0, res - 1.001); fz = clamp(fz, 0, res - 1.001);
      var x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
      var a = H[z0*res+x0]*(1-tx)+H[z0*res+x0+1]*tx;
      var b = H[(z0+1)*res+x0]*(1-tx)+H[(z0+1)*res+x0+1]*tx;
      return a*(1-tz)+b*tz;
    }
    var contourStep = 10; // metres between contour lines
    for (var py = 0; py < TS; py++) {
      for (var px = 0; px < TS; px++) {
        var fx = px/(TS-1)*(res-1), fz = py/(TS-1)*(res-1);
        var h = Hat(fx, fz);
        var col;
        if (h <= wlevel) {
          var depth = clamp((wlevel - h)/25, 0, 1);
          col = mix255([40,86,90],[10,30,46], depth);
        } else {
          // hypsometric base (muted, slightly more saturated for legibility)
          var te = clamp((h - Math.max(0,lo))/Math.max(1,hi-Math.max(0,lo)),0,1);
          var stops=[[58,92,60],[86,108,58],[140,134,74],[140,108,66],[146,138,126],[206,206,198]];
          var seg=te*(stops.length-1), si=Math.floor(seg), sf=seg-si;
          col = mix255(stops[si], stops[Math.min(si+1,stops.length-1)], sf);
          // hillshade from gradient (higher contrast = crisper relief)
          var e = 0.8;
          var hx = Hat(fx+e,fz)-Hat(fx-e,fz);
          var hz = Hat(fx,fz+e)-Hat(fx,fz-e);
          var nx=-hx, nz=-hz, ny=cell*2*e; var nl=Math.hypot(nx,ny,nz)||1;
          var shade = clamp((nx/nl*lx + ny/nl*ly + nz/nl*lz),0,1);
          shade = 0.40 + 0.95*shade;   // stronger light/shadow spread
          col=[col[0]*shade, col[1]*shade, col[2]*shade];
          // contour lines: darken where height crosses a multiple of contourStep
          var band = Math.abs(((h % contourStep)+contourStep)%contourStep);
          var near = Math.min(band, contourStep-band);
          // line thickness in metres scales with local slope so flats aren't over-drawn
          var slopeM = Math.hypot(hx,hz)/(2*e*cell)+1e-3;
          var lineW = clamp(0.55/Math.max(slopeM,0.02), 0.18, 1.1);
          if (near < lineW) {
            var major = Math.round(h/contourStep)%5===0;   // index line every 50 m
            var f = major?0.40:0.66;
            col=[col[0]*f, col[1]*f, col[2]*f];
          }
        }
        var o=(py*TS+px)*4;
        d[o]=col[0]|0; d[o+1]=col[1]|0; d[o+2]=col[2]|0; d[o+3]=255;
      }
    }
    ctx.putImageData(img,0,0);
    var tex=new THREE.CanvasTexture(cv);
    tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping; tex.anisotropy=8; tex.needsUpdate=true;
    return tex;
  }
  function mix255(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}

  // ---------- terrain helpers ----------
  function elevColor(y, lo, hi, slope, isWater, wlevel) {
    if (isWater) {
      // depth shading: deeper water = darker/bluer
      var depth = clamp((wlevel - y) / 30, 0, 1);
      return mix([0.10, 0.22, 0.21], [0.04, 0.10, 0.14], depth);
    }
    if (viewMode === "elevation") {
      // coloured hypsometric tint (muted): low blue-green -> green -> tan -> brown -> grey-white
      var te = clamp((y - Math.max(0, lo)) / Math.max(1, hi - Math.max(0, lo)), 0, 1);
      var stops = [
        [0.18, 0.34, 0.30], [0.27, 0.42, 0.24], [0.55, 0.52, 0.28],
        [0.5, 0.38, 0.24], [0.45, 0.42, 0.40], [0.72, 0.72, 0.70]
      ];
      var seg = te * (stops.length - 1), i = Math.floor(seg), f = seg - i;
      var c = mix(stops[i], stops[Math.min(i + 1, stops.length - 1)], f);
      var she = 1 - clamp(slope, 0, 1) * 0.30;
      return [c[0] * she, c[1] * she, c[2] * she];
    }
    // standard MUTED shaded view
    var t = clamp((y - Math.max(0, lo)) / Math.max(1, hi - Math.max(0, lo)), 0, 1);
    var k0 = [0.11, 0.17, 0.12], k1 = [0.20, 0.25, 0.15], k2 = [0.33, 0.30, 0.24], k3 = [0.48, 0.48, 0.44];
    var cc;
    if (t < 0.4) cc = mix(k0, k1, t / 0.4);
    else if (t < 0.75) cc = mix(k1, k2, (t - 0.4) / 0.35);
    else cc = mix(k2, k3, (t - 0.75) / 0.25);
    var sh = 1 - clamp(slope, 0, 1) * 0.45;
    return [cc[0] * sh, cc[1] * sh, cc[2] * sh];
  }

  // view-mode switch now just adjusts the texture emphasis (contours vs hypsometric handled in build)
  function recolorTerrain() {
    if (!terrainMesh) return;
    // rebuild the topo texture (cheap enough) honouring viewMode
    if (terrainTex) terrainTex.dispose();
    terrainTex = buildTopoTexture(map.terrain, map.water_level_m);
    terrainMesh.material.map = terrainTex;
    terrainMesh.material.needsUpdate = true;
  }

  // ---------- VIEWSHED: light-cast from the selected unit ----------
  // For each terrain vertex, test terrain LOS from the unit's eye; visible vertices stay lit,
  // hidden ones are darkened. Range falloff + fog reduce brightness with distance.
  function computeViewshed(u) {
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var colors = terrainMesh.geometry.attributes.color;
    var d = u.userData;
    var sightM = d.rangeM > 0 ? Math.max(d.rangeM, 8000) : 12000;  // viewshed reach
    sightM *= fogFactor();                                          // fog cuts it
    var ex = d.x, ez = d.z, ey = d.eye + 8;
    var rz = (map.size_m[1] / (res - 1));   // metres per grid row in z (north)
    // FOG OF WAR: areas the unit canNOT see are clearly SHADED OUT (dark/cold). Visible terrain
    // stays bright & natural with a faint warm lift. This is the inverse of a subtle highlight -
    // the hidden ground is obviously obscured so line-of-sight reads at a glance.
    //   - VISIBLE (clear LOS, in range) -> bright, slight warm  (vcol ~1.05 .. 1.25)
    //   - HIDDEN (blocked by terrain)    -> strongly shaded out  (vcol ~0.34, cold)
    //   - OUT-OF-RANGE                   -> shaded out + colder   (vcol ~0.28)
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        var wx = xi * cell, wz = zi * rz;
        var dist = Math.hypot(wx - ex, wz - ez);
        var r, gg, bb;
        if (dist > sightM) {
          // beyond sight range: shaded out, slightly cold/blue
          r = 0.26; gg = 0.29; bb = 0.34;
        } else {
          var clear = losGrid(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz);
          if (clear) {
            // in view: bright & clear, gentle warm lift that eases with distance (fog/certainty)
            var lit = clamp(1 - (dist / sightM) * 0.45, 0.45, 1);
            r = 0.95 + lit * 0.30; gg = 0.95 + lit * 0.24; bb = 0.85 + lit * 0.12;
          } else {
            // in range but terrain-blocked: clearly shaded out (cold shadow)
            r = 0.32; gg = 0.35; bb = 0.40;
          }
        }
        colors.setXYZ(idx, r, gg, bb);
      }
    }
    colors.needsUpdate = true;
  }
  function clearViewshed() {
    if (!terrainMesh) return;
    var colors = terrainMesh.geometry.attributes.color;
    for (var i = 0; i < colors.count; i++) colors.setXYZ(i, 1, 1, 1);
    colors.needsUpdate = true;
  }
  function losGrid(ax, az, ay, bx, bz, by, res, H, cell, rz) {
    var dx = bx - ax, dz = bz - az, dy = by - ay;
    var horiz = Math.hypot(dx, dz); if (horiz < cell) return true;
    var steps = Math.min(180, Math.max(2, Math.ceil(horiz / cell)));
    for (var i = 1; i < steps; i++) {
      var tt = i / steps;
      var sx = ax + dx * tt, sz = az + dz * tt;
      var fx = clamp(sx / cell, 0, res - 1.001), fz = clamp(sz / rz, 0, res - 1.001);
      var x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
      var a = H[z0*res+x0]*(1-tx)+H[z0*res+x0+1]*tx;
      var c = H[(z0+1)*res+x0]*(1-tx)+H[(z0+1)*res+x0+1]*tx;
      var gy = a*(1-tz)+c*tz;
      if (gy > ay + dy * tt + 2) return false;
    }
    return true;
  }
  function fogFactor() { return fog; }
  var fog = 1.0; // 1 = clear, lower = foggier

  // ===========================================================================
  // FIRE ANALYSIS  — trajectory-aware "what can this gun HIT" terrain shading.
  // Teaches the ATP 3-21.90 Fig 5-1 dead-space lesson: a FLAT (direct) gun leaves a
  // large unhittable pocket behind every crest; a HOWITZER (oblique) less; a MORTAR
  // (near-vertical high-angle) almost none. We test each terrain vertex against the
  // chosen trajectory and colour it green (hittable), red (dead space), or grey
  // (out of range), driving the same per-vertex colour attribute the viewshed uses.
  // ===========================================================================

  // Muzzle speed implied by a unit's max range (vacuum flat-fire max = v^2/g, matches
  // Ballistics.MaxRange in the game). v = sqrt(rangeM * g).
  function muzzleSpeed(rangeM) { return Math.sqrt(Math.max(1, rangeM) * 9.81); }

  // Per-trajectory tuning.  min-range fraction = inner dead zone for high-angle lobbers.
  function trajParams(mode) {
    if (mode === "mortar")  return { minFrac: 0.06, reachMul: 1.00, high: true,  arcGain: 1.10, label: "MORTAR / HIGH-ANGLE" };
    if (mode === "oblique") return { minFrac: 0.02, reachMul: 0.96, high: true,  arcGain: 0.07, label: "OBLIQUE / INDIRECT" };
    return                         { minFrac: 0.00, reachMul: 0.90, high: false, arcGain: 0.00, label: "DIRECT / FLAT" };
  }

  // Can a shell of muzzle speed v, fired on the chosen arc, reach (clear all intervening
  // terrain to) the target cell?  Returns true = hittable.
  //   DIRECT  : flat LOS must be clear (exactly the viewshed test) -> big dead space.
  //   OBLIQUE : parabolic arc rising then falling; terrain must stay UNDER the arc. The arc
  //             apex is raised by arcGain so it clears low ridges the flat shot can't, but a
  //             tall close mask still blocks it -> some dead space remains.
  //   MORTAR  : near-vertical plunge; only the launch corridor near the gun + the cell column
  //             matter, so almost nothing masks it -> dead space ~ 0 (only min/max range).
  function canHit(ex, ez, ey, tx, tz, ty, res, H, cell, rz, v, p) {
    var dx = tx - ex, dz = tz - ez;
    var horiz = Math.hypot(dx, dz);
    if (horiz < cell) return true;

    if (!p.high) {
      // DIRECT: straight line of sight from muzzle to target top.
      return losGrid(ex, ez, ey, tx, tz, ty, res, H, cell, rz);
    }

    // Indirect arc. Build a parabola from (0,ey) to (horiz,ty). The apex height above the
    // straight chord is scaled by arcGain * (a fraction of horizontal range) so higher arcs
    // (mortar) bow up much more and clear masks; the flatter oblique bows less.
    // arc(t) = chord(t) + bow * 4t(1-t),  with bow proportional to range & gain.
    var chord0 = ey, chord1 = ty;
    var bow = p.arcGain * horiz * 0.5;          // metres of extra apex height over the chord
    // mortar: huge bow so the descending leg is near-vertical over the target — almost no
    // intervening terrain can be higher than the arc except right at the gun.
    var steps = Math.min(180, Math.max(4, Math.ceil(horiz / cell)));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var sx = ex + dx * t, sz = ez + dz * t;
      var fx = clamp(sx / cell, 0, res - 1.001), fz = clamp(sz / rz, 0, res - 1.001);
      var x0 = Math.floor(fx), z0 = Math.floor(fz), txf = fx - x0, tzf = fz - z0;
      var a = H[z0*res+x0]*(1-txf)+H[z0*res+x0+1]*txf;
      var c = H[(z0+1)*res+x0]*(1-txf)+H[(z0+1)*res+x0+1]*txf;
      var gy = a*(1-tzf)+c*tzf;                 // terrain height under the arc at t
      var arcY = chord0 + (chord1 - chord0) * t + bow * 4 * t * (1 - t);
      if (gy > arcY + 2) return false;          // terrain pokes through the trajectory -> masked
    }
    return true;
  }

  // Colour the terrain by hittability for the selected unit + current trajectory mode.
  // Also computes dead-space % over in-range cells and stashes it for the readout.
  function computeFireAnalysis(u) {
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var colors = terrainMesh.geometry.attributes.color;
    var d = u.userData;
    var p = trajParams(fireMode);
    var maxR = (d.rangeM > 0 ? d.rangeM : 14000) * p.reachMul * fogFactor();
    var minR = maxR * p.minFrac;
    var v = muzzleSpeed(d.rangeM > 0 ? d.rangeM : 14000);
    var ex = d.x, ez = d.z, ey = d.eye + 8;
    var rz = (map.size_m[1] / (res - 1));

    var inRange = 0, hit = 0;
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        var wx = xi * cell, wz = zi * rz;
        var dist = Math.hypot(wx - ex, wz - ez);
        var r, gg, bb;
        if (dist > maxR || dist < minR) {
          // out of range (beyond max OR inside high-angle min dead zone) -> shaded grey
          r = 0.30; gg = 0.33; bb = 0.36;
        } else {
          inRange++;
          var ok = canHit(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz, v, p);
          if (ok) {
            hit++;
            // hittable: cool muted GREEN, brighter when nearer (better accuracy/cert.)
            var near = clamp(1 - dist / maxR, 0, 1);
            r = 0.40 + near * 0.18; gg = 0.78 + near * 0.30; bb = 0.46 + near * 0.16;
          } else {
            // DEAD SPACE: cannot be hit with this trajectory -> red tint (still readable)
            r = 1.05; gg = 0.36; bb = 0.33;
          }
        }
        colors.setXYZ(idx, r, gg, bb);
      }
    }
    colors.needsUpdate = true;

    var deadPct = inRange > 0 ? Math.round((1 - hit / inRange) * 100) : 0;
    lastFireStats = { mode: fireMode, label: p.label, deadPct: deadPct,
                      inRange: inRange, hit: hit, maxR: maxR, minR: minR };
    return lastFireStats;
  }

  // min/max range rings + (optional) immunity-zone band vs a reference enemy gun.
  function buildFireRings(u) {
    if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
    if (!show.fire || !u) return;
    fireGroup = new THREE.Group(); scene.add(fireGroup);
    var d = u.userData;
    var p = trajParams(fireMode);
    var maxR = (d.rangeM > 0 ? d.rangeM : 14000) * p.reachMul * fogFactor();
    var minR = maxR * p.minFrac;

    function ring(rad, col, op) {
      if (rad <= 0) return;
      var pts = [], segs = 110;
      for (var i = 0; i <= segs; i++) {
        var a = i / segs * Math.PI * 2;
        var rx = clamp(d.x + Math.cos(a) * rad, 0, map.size_m[0]);
        var rz = clamp(d.z + Math.sin(a) * rad, 0, map.size_m[1]);
        pts.push(new THREE.Vector3(rx, heightAt(rx, rz) + 5, rz));
      }
      fireGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op })));
    }
    ring(maxR, COL.range, 0.7);                 // max range
    if (minR > 0) ring(minR, COL.hostile, 0.6); // high-angle inner dead zone

    // IMMUNITY ZONE band vs a reference enemy gun (approximate, teaching aid):
    //   inner edge  = range beyond which enemy SIDE (vertical) pen <= our side armour
    //   outer edge  = range beyond which enemy TOP (plunging) pen  >  our top armour
    // We model these as fractions of the enemy gun's reach. Band between = immune.
    var enemy = units.filter(function (g) { return g.userData.side === "hostile" && g.userData.rangeM > 0; })[0];
    if (enemy) {
      var er = enemy.userData.rangeM;
      var innerEdge = er * 0.34;   // closer than this -> our side is defeated (short-range vertical pen)
      var outerEdge = er * 0.82;   // farther than this -> our deck is defeated (long-range plunging pen)
      if (outerEdge > innerEdge) {
        // tint the immune band with a faint amber filled ring (two arcs) centred on us.
        var g2 = new THREE.RingGeometry(innerEdge, outerEdge, 96, 1);
        g2.rotateX(-Math.PI / 2);
        var mband = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({
          color: COL.range, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
        mband_place(mband, d);
        fireGroup.add(mband);
        ring(innerEdge, COL.range, 0.35);
        ring(outerEdge, COL.range, 0.35);
      }
    }
  }
  function mband_place(mesh, d) {
    mesh.position.set(d.x, heightAt(d.x, d.z) + 3, d.z);
  }

  // Update the FIRE ANALYSIS readout panel + legend.
  function updateFireReadout(u) {
    var panel = document.getElementById("fire");
    if (!panel) return;
    if (!show.fire || !u) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    var d = u.userData, s = lastFireStats || {};
    document.getElementById("fUnit").textContent = d.name;
    document.getElementById("fMode").textContent = s.label || fireMode.toUpperCase();
    var maxKm = (s.maxR || 0) / 1000, minKm = (s.minR || 0) / 1000;
    document.getElementById("fReach").textContent =
      (minKm > 0.1 ? minKm.toFixed(1) + "-" : "0-") + maxKm.toFixed(1) + " km";
    var dp = (s.deadPct != null ? s.deadPct : 0);
    document.getElementById("fDeadPct").textContent = dp + "%";
    document.getElementById("fDeadBar").style.width = dp + "%";
    var hint = (fireMode === "mortar")
      ? "High-angle plunges straight into defilade — almost no dead space."
      : (fireMode === "oblique")
        ? "Arced fire clears low ridges; tall close masks still leave dead space."
        : "Flat fire is blocked by every crest — large dead-space pockets behind hills.";
    document.getElementById("fHint").textContent = hint;

    // angle-of-fall: prefer selected enemy; else nearest enemy crab to this unit.
    var target = null;
    if (selected && selected.userData.side === "hostile") target = selected;
    if (!target) {
      var best = Infinity;
      for (var i = 0; i < units.length; i++) {
        var o = units[i].userData;
        if (o.side !== "hostile") continue;
        var dd = Math.hypot(o.x - d.x, o.z - d.z);
        if (dd < best) { best = dd; target = units[i]; }
      }
    }
    var aofEl = document.getElementById("fAof"), noteEl = document.getElementById("fAofNote");
    if (target && target !== u) {
      var a = angleOfFall(u, target);
      aofEl.textContent = "RANGE " + (a.rng / 1000).toFixed(1) + "km \u00b7 " +
        a.fall.toFixed(0) + "\u00b0 \u00b7 " + (a.flat ? "FLAT" : "PLUNGING");
      aofEl.className = a.deck ? "k" : "warn";
      noteEl.textContent = "hits " + a.face + (a.deck
        ? " (top/carapace \u2014 plunging penetration)"
        : " (side/glacis \u2014 vertical penetration)") + " \u00b7 vs " + target.userData.name;
    } else {
      aofEl.textContent = "--"; aofEl.className = "k";
      noteEl.textContent = "no enemy crab in theatre";
    }
  }

  // Angle-of-fall readout for a (selected/hovered) enemy at the current trajectory.
  // Angle of fall rises with range and is steep for high-angle fire. Shallow -> SIDE; steep -> DECK.
  function angleOfFall(u, target) {
    var d = u.userData, o = target.userData;
    var rng = Math.hypot(o.x - d.x, o.z - d.z);
    var maxR = d.rangeM > 0 ? d.rangeM : 14000;
    var p = trajParams(fireMode);
    // vacuum: angle of fall for flat (low) arc grows toward 45deg near max range; high arc much steeper.
    var frac = clamp(rng / maxR, 0, 1.4);
    var fall;
    if (p.high) {
      // high/oblique arc descends steeply; mortar near-vertical.
      fall = (fireMode === "mortar") ? (70 + frac * 18) : (40 + frac * 28);
    } else {
      fall = 8 + frac * 34;          // flat fire: shallow near, ~42deg toward max range
    }
    fall = clamp(fall, 4, 88);
    var deck = fall >= 45;
    return { rng: rng, fall: fall, deck: deck,
             face: deck ? "DECK" : "SIDE", flat: fall < 30 };
  }
  function slopeAt(H, res, x, z, cell) {
    var xl = Math.max(0, x - 1), xr = Math.min(res - 1, x + 1);
    var zd = Math.max(0, z - 1), zu = Math.min(res - 1, z + 1);
    var dx = H[z * res + xr] - H[z * res + xl];
    var dz = H[zu * res + x] - H[zd * res + x];
    return Math.min(1, Math.sqrt(dx * dx + dz * dz) / (cell * 1.5));
  }
  function heightAt(xm, zm) {
    var tf = terrainField; if (!tf) return 0;
    var fx = clamp(xm / tf.cell, 0, tf.res - 1.001);
    var fz = clamp(zm / (tf.L / (tf.res - 1)), 0, tf.res - 1.001);
    var x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    var H = tf.H, r = tf.res;
    var a = H[z0 * r + x0] * (1 - tx) + H[z0 * r + x0 + 1] * tx;
    var b = H[(z0 + 1) * r + x0] * (1 - tx) + H[(z0 + 1) * r + x0 + 1] * tx;
    return a * (1 - tz) + b * tz;
  }
  // analytic terrain LOS (matches the game): true if clear
  function hasLOS(ax, az, ay, bx, bz, by) {
    var dx = bx - ax, dz = bz - az, dy = by - ay;
    var horiz = Math.sqrt(dx * dx + dz * dz); if (horiz < 1) return true;
    var steps = Math.max(2, Math.ceil(horiz / terrainField.cell));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var gy = heightAt(ax + dx * t, az + dz * t);
      if (gy > ay + dy * t + 1) return false;
    }
    return true;
  }

  // ---------- units ----------
  function placeDemoUnits() {
    unitsGroup = new THREE.Group(); scene.add(unitsGroup);
    var W = map.size_m[0], L = map.size_m[1];
    // artillery scale: late-game guns reach ~30km. Units spread across the large theatre.
    addUnit("ANZAC-01", "friend", "Line", "BR-155 (18km)", 18000, W * 0.40, L * 0.30, "Hoplite-class. Holding the ridge line.");
    addUnit("ANZAC-02", "friend", "Siege", "SG-305 (30km)", 30000, W * 0.52, L * 0.22, "Leviathan dreadnought-crab. 305mm siege gun.");
    addUnit("CONTACT-7", "hostile", "Line", "? (unidentified)", 16000, W * 0.60, L * 0.66, "IDENT UNCERTAIN - too far to confirm class.");
    addUnit("SCAV-NEUTRAL", "civ", "Recon", "unarmed", 0, W * 0.34, L * 0.55, "Civilian scavenger crab. Do not engage.");
  }
  function addUnit(name, side, cls, gun, rangeM, x, z, note) {
    var col = side === "friend" ? COL.friend : side === "hostile" ? COL.hostile : COL.civ;
    var dark = new THREE.MeshStandardMaterial({ color: 0x23271f, roughness: 0.8 });
    // Ship-scale: a real mecha is ~15-40m. Keep it close to TRUE scale (small on an 11km map);
    // you zoom in to inspect. A small constant icon multiplier keeps it just visible when zoomed out.
    var unitLen = (cls === "Siege") ? 40 : (cls === "Line") ? 28 : (cls === "Recon") ? 16 : 22; // metres
    var beamW = unitLen * 0.34;          // NARROW hull (ship-like aspect ratio)
    var bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.25, emissive: col, emissiveIntensity: 0.15 });
    var g = new THREE.Group();

    // narrow tapered hull (a stretched, pointed box -> destroyer silhouette)
    var hull = new THREE.Mesh(new THREE.BoxGeometry(beamW, unitLen * 0.16, unitLen), bodyMat);
    hull.position.y = unitLen * 0.16; g.add(hull);
    var prow = new THREE.Mesh(new THREE.ConeGeometry(beamW * 0.5, unitLen * 0.35, 4), bodyMat);
    prow.rotation.x = -Math.PI / 2; prow.rotation.y = Math.PI / 4;
    prow.position.set(0, unitLen * 0.16, unitLen * 0.6); g.add(prow);
    // low central turret + thin long barrel (the gun) pointing forward
    var tur = new THREE.Mesh(new THREE.BoxGeometry(beamW * 0.7, unitLen * 0.12, unitLen * 0.3), bodyMat);
    tur.position.y = unitLen * 0.26; g.add(tur);
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(beamW * 0.08, beamW * 0.08, unitLen * 0.7, 6), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, unitLen * 0.26, unitLen * 0.5); g.add(barrel);
    // skinny crab legs along the sides (thin)
    for (var s = -1; s <= 1; s += 2) for (var li = 0; li < 4; li++) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(unitLen * 0.04, unitLen * 0.18, unitLen * 0.04), dark);
      leg.position.set(s * beamW * 0.62, unitLen * 0.08, (li - 1.5) * unitLen * 0.22);
      leg.rotation.z = s * 0.5; g.add(leg);
    }
    // small ground ring marker so a tiny unit is still findable when zoomed out
    var ring = new THREE.Mesh(new THREE.RingGeometry(unitLen * 0.9, unitLen * 1.05, 24),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 1; g.add(ring);

    var y = heightAt(x, z);
    g.position.set(x, y, z);
    g.rotation.y = Math.random() * Math.PI * 2; // facing
    g.userData = { name: name, side: side, cls: cls, gun: gun, rangeM: rangeM, note: note, x: x, z: z, eye: y + unitLen * 0.3 };
    unitsGroup.add(g);
    units.push(g);
  }

  // ---------- overlays: LOS + range ----------
  function rebuildOverlays() {
    if (overlayGroup) scene.remove(overlayGroup);
    overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    var u = selected || units[0];
    if (!u) { clearViewshed(); return; }
    var d = u.userData;

    // FIRE ANALYSIS takes over the terrain shading when active (replaces plain viewshed).
    if (show.fire) {
      computeFireAnalysis(u);
      buildFireRings(u);
      updateFireReadout(u);
    } else {
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      // VIEWSHED light-cast: highlight everything this unit can see.
      if (show.los) computeViewshed(u); else clearViewshed();
    }

    // FOG-CULL LOD: dim/hide buildings outside this unit's sight (recompute on selection change).
    applyFogCull();

    // range ring (follows terrain)
    if (show.range && d.rangeM > 0) {
      var ringPts = [];
      var segs = 96;
      for (var i = 0; i <= segs; i++) {
        var a = i / segs * Math.PI * 2;
        var rx = d.x + Math.cos(a) * d.rangeM;
        var rz = d.z + Math.sin(a) * d.rangeM;
        rx = clamp(rx, 0, map.size_m[0]); rz = clamp(rz, 0, map.size_m[1]);
        ringPts.push(new THREE.Vector3(rx, heightAt(rx, rz) + 4, rz));
      }
      var rg = new THREE.BufferGeometry().setFromPoints(ringPts);
      overlayGroup.add(new THREE.Line(rg, new THREE.LineBasicMaterial({ color: COL.range, transparent: true, opacity: 0.6 })));
    }

    // LOS lines from the selected unit to every other unit (green=clear, red=blocked)
    if (show.los) {
      for (var k = 0; k < units.length; k++) {
        if (units[k] === u) continue;
        var o = units[k].userData;
        var clear = hasLOS(d.x, d.z, d.eye, o.x, o.z, o.eye);
        var pts = losSamples(d, o);
        var lg = new THREE.BufferGeometry().setFromPoints(pts);
        overlayGroup.add(new THREE.Line(lg, new THREE.LineBasicMaterial({
          color: clear ? COL.los : COL.hostile, transparent: true, opacity: clear ? 0.75 : 0.4 })));
      }
    }
  }
  function losSamples(a, b) {
    var pts = [], steps = 40;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      var ray = a.eye + (b.eye - a.eye) * t;
      pts.push(new THREE.Vector3(x, Math.max(ray, heightAt(x, z) + 2), z));
    }
    return pts;
  }

  // ---------- interaction ----------
  function onClick(e) {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(units, true);
    if (hits.length) {
      var g = hits[0].object; while (g.parent && units.indexOf(g) < 0) g = g.parent;
      if (units.indexOf(g) >= 0) { selectUnit(g); }
    }
  }
  function selectUnit(g) {
    selected = g; var d = g.userData;
    var p = document.getElementById("unit"); p.style.display = "block";
    document.getElementById("uName").textContent = d.name;
    document.getElementById("uClass").textContent = d.cls;
    var ident = d.side === "hostile" ? "HOSTILE (uncertain)" : d.side === "civ" ? "CIVILIAN" : "FRIENDLY";
    var ie = document.getElementById("uIdent"); ie.textContent = ident;
    ie.className = d.side === "hostile" ? "warn" : "k";
    document.getElementById("uStruct").style.width = "100%";
    document.getElementById("uGun").textContent = d.gun;
    document.getElementById("uRange").textContent = d.rangeM ? (d.rangeM / 1000).toFixed(1) + " km" : "n/a";
    document.getElementById("uNote").textContent = d.note;
    rebuildOverlays();
  }

  // ---------- camera ----------
  function frameCamera() {
    var W = map.size_m[0], L = map.size_m[1];
    var span = Math.max(W, L);
    camera.near = span * 0.001; camera.far = span * 6; camera.updateProjectionMatrix();
    controls.target.set(W / 2, 0, L / 2);
    // steeper tactical overhead so topography + viewshed read clearly
    camera.position.set(W / 2, span * 1.05, L / 2 + span * 0.55);
    controls.update();
  }

  // ---------- UI ----------
  function bindUI() {
    tog("tLOS", "los"); tog("tRange", "range"); tog("tBld", "bld"); tog("tWire", "wire");
    tog("tWind", "wind"); tog("tRain", "rain");
    tog("tSub", "suburbs"); tog("tFogCull", "fogcull");
    document.getElementById("tSub").classList.toggle("on", show.suburbs);
    document.getElementById("tFogCull").classList.toggle("on", show.fogcull);
    document.getElementById("tFly").onclick = function () { setFly(!fly.on); };

    // ---- FIRE ANALYSIS toggles ----
    function syncFireUI() {
      document.getElementById("tFire").classList.toggle("on", show.fire);
      document.getElementById("fireTraj").style.display = show.fire ? "flex" : "none";
      document.getElementById("fireLeg").style.display  = show.fire ? "block" : "none";
      ["fDirect","fOblique","fMortar"].forEach(function (id) {
        var m = id === "fDirect" ? "direct" : id === "fOblique" ? "oblique" : "mortar";
        document.getElementById(id).classList.toggle("on", fireMode === m);
      });
      // LOS toggle reflects that fire-analysis suppresses the plain viewshed
      document.getElementById("tLOS").classList.toggle("on", show.los && !show.fire);
    }
    document.getElementById("tFire").onclick = function () {
      show.fire = !show.fire;
      if (show.fire) { show.los = false; }            // fire shading replaces viewshed
      else { show.los = true; }
      document.getElementById("fire").style.display = show.fire ? "block" : "none";
      syncFireUI(); rebuildOverlays();
    };
    function setTraj(m) {
      fireMode = m;
      if (!show.fire) { show.fire = true; show.los = false; document.getElementById("fire").style.display = "block"; }
      syncFireUI(); rebuildOverlays();
    }
    document.getElementById("fDirect").onclick  = function () { setTraj("direct"); };
    document.getElementById("fOblique").onclick = function () { setTraj("oblique"); };
    document.getElementById("fMortar").onclick  = function () { setTraj("mortar"); };
    syncFireUI();
    var vS = document.getElementById("vShaded"), vE = document.getElementById("vElev");
    vS.classList.toggle("on", viewMode === "shaded"); vE.classList.toggle("on", viewMode === "elevation");
    vS.onclick = function () { viewMode = "shaded"; vS.classList.add("on"); vE.classList.remove("on"); recolorTerrain(); };
    vE.onclick = function () { viewMode = "elevation"; vE.classList.add("on"); vS.classList.remove("on"); recolorTerrain(); };
    document.getElementById("zin").onclick = function () { dolly(0.8); };
    document.getElementById("zout").onclick = function () { dolly(1.25); };
    document.getElementById("rst").onclick = function () { frameCamera(); };
    function tog(id, key) {
      var el = document.getElementById(id);
      el.onclick = function () {
        show[key] = !show[key]; el.classList.toggle("on", show[key]);
        if (key === "bld" && buildingsGroup) { buildingsGroup.visible = show.bld; applyFogCull(); }
        else if (key === "wire" && wireMesh) wireMesh.visible = show.wire;
        else if (key === "wind" && windGroup) windGroup.visible = show.wind;
        else if (key === "rain" && rainGroup) rainGroup.visible = show.rain;
        else if (key === "suburbs" && suburbGroup) suburbGroup.visible = show.suburbs;
        else if (key === "fogcull") applyFogCull();
        else rebuildOverlays();
      };
    }
  }
  function dolly(f) {
    var dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    dir.multiplyScalar(f); camera.position.copy(controls.target).add(dir); controls.update();
  }

  // ---------- FLY CAMERA ----------
  // Free-fly WASDQE/RF camera. While active, OrbitControls is disabled (so they don't fight) and
  // we drive camera.position + a yaw/pitch look direction each frame from held keys + mouse-drag.
  function bindFly() {
    addEventListener("keydown", function (e) {
      var k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser shortcuts alone
      if (e.key === "Escape") { if (fly.on) setFly(false); return; }
      // F toggles fly mode (bare press; not while focused on the city <select>)
      if (k === "f" && !e.repeat && (!document.activeElement || document.activeElement.tagName !== "SELECT")) {
        setFly(!fly.on); e.preventDefault(); return;
      }
      if (fly.on) {
        // movement keys: W/S fwd-back, A/D strafe, R/E up, Q down (F is the toggle, not descend)
        if ("wsadqer".indexOf(k) >= 0) { fly.keys[k] = true; e.preventDefault(); }
        if (k === "shift") fly.keys.shift = true;
      }
    });
    addEventListener("keyup", function (e) {
      var k = e.key.toLowerCase();
      if (k === "shift") fly.keys.shift = false;
      else delete fly.keys[k];
    });

    var dom = renderer.domElement;
    dom.addEventListener("mousedown", function (e) {
      if (!fly.on || e.button !== 0) return;
      fly.dragging = true; fly.lastX = e.clientX; fly.lastY = e.clientY;
    });
    addEventListener("mouseup", function () { fly.dragging = false; });
    addEventListener("mousemove", function (e) {
      if (!fly.on || !fly.dragging) return;
      var dx = e.clientX - fly.lastX, dy = e.clientY - fly.lastY;
      fly.lastX = e.clientX; fly.lastY = e.clientY;
      var sens = 0.0035;
      fly.yaw   -= dx * sens;
      fly.pitch -= dy * sens;
      var lim = Math.PI / 2 - 0.05;
      fly.pitch = clamp(fly.pitch, -lim, lim);
    });
    // wheel adjusts fly speed (instead of orbit zoom) while flying
    dom.addEventListener("wheel", function (e) {
      if (!fly.on) return;
      e.preventDefault();
      var f = e.deltaY < 0 ? 1.15 : 0.87;
      fly.speed = clamp(fly.speed * f, 30, 60000);
    }, { passive: false });
  }

  // F (and the FLY CAM button) toggle this. Initialises yaw/pitch from the CURRENT camera look
  // direction so the view doesn't jump when you enter fly mode.
  function setFly(on) {
    fly.on = on;
    var btn = document.getElementById("tFly");
    if (btn) btn.classList.toggle("on", on);
    var hint = document.getElementById("flyHint");
    if (hint) hint.style.display = on ? "block" : "none";
    document.getElementById("status").textContent = on ? "FLY CAM" : "SECTOR ACTIVE";

    if (on) {
      controls.enabled = false;
      // derive yaw/pitch from current camera->target direction
      var dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
      fly.pitch = Math.asin(clamp(dir.y, -1, 1));
      fly.yaw = Math.atan2(dir.x, dir.z);
      fly.keys = {};
      // speed scales with map size: cross ~11km in ~12s at base, ~3s on shift-boost
      var span = map ? Math.max(map.size_m[0], map.size_m[1]) : 11000;
      fly.speed = span * 0.09;     // units/sec
      fly.clock.getDelta();        // reset dt so first frame isn't a huge jump
    } else {
      controls.enabled = true;
      // hand the look direction back to OrbitControls: keep position, retarget ahead of the camera
      var fwd = flyForward();
      controls.target.copy(camera.position).addScaledVector(fwd, Math.max(50, (map ? Math.max(map.size_m[0], map.size_m[1]) : 11000) * 0.06));
      controls.update();
    }
  }

  function flyForward() {
    var cp = Math.cos(fly.pitch);
    return new THREE.Vector3(Math.sin(fly.yaw) * cp, Math.sin(fly.pitch), Math.cos(fly.yaw) * cp);
  }

  function updateFly(dt) {
    if (!fly.on) return;
    var fwd = flyForward();
    // strafe = forward x up (right-hand), kept horizontal
    var up = new THREE.Vector3(0, 1, 0);
    var right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    var move = new THREE.Vector3();
    var k = fly.keys;
    if (k.w) move.add(fwd);
    if (k.s) move.sub(fwd);
    if (k.d) move.add(right);
    if (k.a) move.sub(right);
    if (k.r || k.e) move.add(up);     // up
    if (k.q) move.sub(up);            // down  (F is reserved as the fly-mode toggle)
    var spd = fly.speed * (k.shift ? 4.0 : 1.0);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(spd * dt);
      camera.position.add(move);
    }
    // keep camera from sinking under terrain when flying low
    if (terrainField) {
      var minY = heightAt(camera.position.x, camera.position.z) + 6;
      if (camera.position.y < minY) camera.position.y = minY;
    }
    camera.lookAt(new THREE.Vector3().addVectors(camera.position, fwd));
  }

  // ---------- util ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
  function animate() {
    requestAnimationFrame(animate);
    var dt = fly.clock ? fly.clock.getDelta() : 0.016;
    if (fly.on) updateFly(Math.min(dt, 0.1));
    else controls.update();
    // animate rain falling (only when present + visible)
    if (rainPoints && rainGroup && rainGroup.visible && map) {
      var pos = rainPoints.geometry.attributes.position;
      var W = map.size_m[0], L = map.size_m[1];
      // a little horizontal drift from the mean wind vector
      var s = map.weather && map.weather.summary;
      var dux = s ? (s.mean_wind_u || 0) : 0, duz = s ? (s.mean_wind_v || 0) : 0;
      for (var i = 0; i < pos.count; i++) {
        var y = pos.getY(i) - 26;                 // fall speed
        var x = pos.getX(i) + dux * 0.6;
        var z = pos.getZ(i) + duz * 0.6;
        if (y < 0) { y = rainTop; x = Math.random() * W; z = Math.random() * L; }
        pos.setXYZ(i, ((x % W) + W) % W, y, ((z % L) + L) % L);
      }
      pos.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  init();
})();
