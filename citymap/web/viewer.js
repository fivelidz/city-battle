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
    // brighter overlay accents (the muted palette above reads too dim for ranges/links)
    rangeMax: 0xe8a838,   // clear AMBER max gun-range ring
    rangeEff: 0xc87a3a,   // inner "effective range" ring (warmer/closer)
    losClear: 0x7fe6a0,   // bright green = clear LOS line
    losBlock: 0xe05a4e,   // bright red   = blocked LOS line
    comms:    0x5fd6c6,   // teal comms link line
    commsOff: 0xc8463c,   // off-net warning
    mkFriend: 0x57c7bd, mkHostile: 0xd75a52, mkCiv: 0xc9a23a,  // billboard marker tints
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
               fire: false, slope: false, comms: QS.get("comms") === "1",
               deadzones: false };

  // ?slope=1 force-enables the SLOPE / trafficability overlay for screenshots.
  if (QS.get("slope") === "1") { show.slope = true; show.los = false; }

  // ?deadzones=1 force-enables the FIRE PICTURE (direct-fire dead-zone) shading for the
  // selected unit (screenshots). It replaces the plain viewshed on the selected unit's terrain.
  if (QS.get("deadzones") === "1") { show.deadzones = true; show.los = false; }

  var lastDeadStats = null;   // {deadPct, inRange, hit} for the selected unit's dead-zone picture

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

  // ===========================================================================
  // COMMAND MODE state (the playable layer on top of the review viewer).
  //  - cmd.on        : command mode UI is active (flags, sim loop, orders)
  //  - cmd.playing   : the movement + combat sim is running (else paused — give orders first)
  //  - cmd.flagType  : the order type the next right-click drops ("move"|"hold"|"attack")
  //  - cmd.flagship  : the designated friendly command/flagship unit (comms net root)
  //  - cmd.scenario  : current scenario key ("" = free deploy)
  //  - cmd.selectedSet : multi-select for formation moves
  // Each unit gets userData.cmd = { flags:[{x,z,type,group}], targetIdx, struct, ko, speed,
  //                                 firingTo, fireGroup } when command mode initialises.
  // ===========================================================================
  var cmd = {
    on: false, playing: false, flagType: "move", flagship: null, scenario: "",
    selectedSet: [], objective: null, flagGroup: null, orderGroup: null, fxGroup: null,
    forceScenario: QS.get("scenario") || "", forcePlay: QS.get("play") === "1",
    netStat: "", flagshipOffNet: false,
  };
  var FLAG_COL = { move: 0x5fd6c6, hold: 0xe8a838, attack: 0xd75a52, objective: 0x7fe6a0 };

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
    renderer.domElement.addEventListener("contextmenu", onContext);
    var startCity = QS.get("city");
    if (!startCity || !CITIES.some(function (c) { return c[0] === startCity; })) startCity = "sydney";
    loadCity(startCity);   // default to the large 32km theatre (override with ?city=sydney_harbour)
    var sel0 = document.getElementById("citySel"); if (sel0) sel0.value = startCity;
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
    [terrainMesh, buildingsGroup, unitsGroup, overlayGroup, wireMesh, windGroup, rainGroup, suburbGroup, fireGroup,
     cmd.flagGroup, cmd.orderGroup, cmd.fxGroup].forEach(function (o) {
      if (o) { scene.remove(o); }
    });
    terrainMesh = buildingsGroup = unitsGroup = overlayGroup = wireMesh = null;
    windGroup = rainGroup = suburbGroup = fireGroup = null;
    cmd.flagGroup = cmd.orderGroup = cmd.fxGroup = null;
    cmd.flagship = null; cmd.selectedSet = []; cmd.objective = null;
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

    // ----- COMMAND MODE: command groups + (optional) forced scenario / autoplay -----
    initCommand();
    if (cmd.forceScenario) { setCommandMode(true); loadScenario(cmd.forceScenario); }
    if (cmd.forcePlay) { setCommandMode(true); setPlaying(true); autoIssueDemoOrders(); }

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

  // ---------- FIRE PICTURE: the SELECTED unit's DIRECT-FIRE dead zones ----------
  // Triggered on UNIT SELECTION (the "DEAD ZONES" toggle), independent of the FIRE ANALYSIS
  // trajectory picker. Always uses DIRECT (flat) fire — the question is "what flat-fire pockets
  // does THIS gun own vs what hides behind crests within its reach". Shares canHit/losGrid with
  // fire-analysis but is its own UX: green = in range + hittable (clear LOS), red/orange = in
  // range but DEAD ZONE (terrain-masked), dim = out of range. Stashes deadPct for the panel.
  function computeDeadZones(u) {
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var colors = terrainMesh.geometry.attributes.color;
    var d = u.userData;
    var p = trajParams("direct");                       // always flat fire for the picture
    var maxR = (d.rangeM > 0 ? d.rangeM : 14000) * p.reachMul * fogFactor();
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
        if (dist > maxR) {
          // OUT OF RANGE -> neutral / dim
          r = 0.30; gg = 0.33; bb = 0.37;
        } else {
          inRange++;
          var ok = canHit(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz, v, p);
          if (ok) {
            hit++;
            // HITTABLE: subtle clear GREEN, brighter nearer the gun
            var near = clamp(1 - dist / maxR, 0, 1);
            r = 0.42 + near * 0.14; gg = 0.74 + near * 0.30; bb = 0.48 + near * 0.12;
          } else {
            // DEAD ZONE: in range but masked by terrain -> warm RED/ORANGE pocket
            r = 1.05; gg = 0.34; bb = 0.30;
          }
        }
        colors.setXYZ(idx, r, gg, bb);
      }
    }
    colors.needsUpdate = true;

    var deadPct = inRange > 0 ? Math.round((1 - hit / inRange) * 100) : 0;
    lastDeadStats = { deadPct: deadPct, inRange: inRange, hit: hit, maxR: maxR };
    return lastDeadStats;
  }

  // Update the SELECTED unit panel's dead-zone readout line.
  function updateDeadReadout(u) {
    var row = document.getElementById("uDeadRow");
    if (!row) return;
    if (!show.deadzones || !u || !(u.userData.rangeM > 0)) {
      row.style.display = "none";
      return;
    }
    row.style.display = "block";
    var dp = (lastDeadStats && lastDeadStats.deadPct != null) ? lastDeadStats.deadPct : 0;
    var el = document.getElementById("uDeadPct");
    el.textContent = dp + "%";
    document.getElementById("uDeadBar").style.width = dp + "%";
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
  // TRUE gradient = rise/run = sqrt(dx^2+dz^2)/run, an unclamped tan(angle) value.
  // 0 = flat, 1 = 45deg, ~1.19 = 50deg (crab cliff limit). Uses central differences
  // so the run between the sampled neighbours is 2*cell (and 2*rz in z).
  function gradientAt(H, res, x, z, cell, rz) {
    var xl = Math.max(0, x - 1), xr = Math.min(res - 1, x + 1);
    var zd = Math.max(0, z - 1), zu = Math.min(res - 1, z + 1);
    var runX = (xr - xl) * cell, runZ = (zu - zd) * rz;
    var dx = (H[z * res + xr] - H[z * res + xl]) / (runX || cell);
    var dz = (H[zu * res + x] - H[zd * res + x]) / (runZ || cell);
    return Math.sqrt(dx * dx + dz * dz);     // tan(slope angle)
  }
  // Crab trafficability thresholds (rise/run). Tuned to brief: cliff > ~1.2 (~50deg).
  var SLOPE_T = { moderate: 0.30, steep: 0.70, cliff: 1.20 };
  // Bin a gradient into 0=gentle 1=moderate 2=steep 3=cliff.
  function slopeBin(g) {
    if (g >= SLOPE_T.cliff) return 3;
    if (g >= SLOPE_T.steep) return 2;
    if (g >= SLOPE_T.moderate) return 1;
    return 0;
  }

  // ---------- SLOPE / TRAFFICABILITY OVERLAY ----------
  // Recolours every terrain vertex by steepness so players can read where crab-mechas
  // are slowed (moderate/steep) or completely blocked (cliffs). Drives the SAME per-vertex
  // colour multiplier as the viewshed/fire overlays, so it cleanly restores on toggle-off.
  // Water (height <= water_level_m) is left at neutral so the water plane reads as water.
  function computeSlopeOverlay() {
    if (!terrainMesh) return;
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var wlevel = map.water_level_m;
    var rz = (map.size_m[1] / (res - 1));   // metres per grid row in z (north)
    var colors = terrainMesh.geometry.attributes.color;
    // Tint multipliers per bin (multiply the baked topo texture). Gentle keeps natural
    // ground (slight cool-green lift); steeper bins push amber -> orange -> red.
    //   0 GENTLE  : near-neutral, faint green  (passable, full speed)
    //   1 MODERATE: amber/yellow               (slowed)
    //   2 STEEP   : orange                     (very slow)
    //   3 CLIFF   : red                        (impassable)
    var BIN = [
      [0.82, 1.02, 0.86],   // gentle  - desaturated green wash
      [1.30, 1.05, 0.42],   // moderate- amber
      [1.45, 0.78, 0.34],   // steep   - orange
      [1.55, 0.36, 0.30],   // cliff   - red
    ];
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        if (H[idx] <= wlevel) { colors.setXYZ(idx, 1, 1, 1); continue; }  // water: neutral
        var g = gradientAt(H, res, xi, zi, cell, rz);
        var b = slopeBin(g);
        var c = BIN[b];
        // within steep/cliff bins, brighten a touch with severity so ridgelines pop
        if (b >= 2) {
          var sev = clamp((g - SLOPE_T.steep) / (SLOPE_T.cliff - SLOPE_T.steep), 0, 1.4);
          colors.setXYZ(idx, c[0] + sev * 0.10, c[1], c[2]);
        } else {
          colors.setXYZ(idx, c[0], c[1], c[2]);
        }
      }
    }
    colors.needsUpdate = true;
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
    addUnit("ANZAC-01", "friend", "Line", "BR-155 (18km)", 18000, W * 0.40, L * 0.30, "Hoplite-class. Holding the ridge line. COMMAND NODE.");
    addUnit("ANZAC-02", "friend", "Siege", "SG-305 (30km)", 30000, W * 0.52, L * 0.22, "Leviathan dreadnought-crab. 305mm siege gun.");
    addUnit("ANZAC-03", "friend", "Recon", "SR-90 (9km)", 9000, W * 0.66, L * 0.40, "Forward scout-crab. Relays the net across the harbour.");
    addUnit("ANZAC-04", "friend", "Line", "BR-120 (12km)", 12000, W * 0.78, L * 0.78, "Flanking element - pushing into the far valley.");
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
    hull.position.y = unitLen * 0.16; hull.userData._isHull = true; g.add(hull);
    var prow = new THREE.Mesh(new THREE.ConeGeometry(beamW * 0.5, unitLen * 0.35, 4), bodyMat);
    prow.rotation.x = -Math.PI / 2; prow.rotation.y = Math.PI / 4;
    prow.position.set(0, unitLen * 0.16, unitLen * 0.6); prow.userData._isHull = true; g.add(prow);
    // low central turret + thin long barrel (the gun) pointing forward
    var tur = new THREE.Mesh(new THREE.BoxGeometry(beamW * 0.7, unitLen * 0.12, unitLen * 0.3), bodyMat);
    tur.position.y = unitLen * 0.26; tur.userData._isHull = true; g.add(tur);
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

    // ---- BIG BILLBOARD MARKER + NAME LABEL (always faces camera; the primary way to spot/click) ----
    // The true-scale crab hull is tiny on an 11-32km map; this marker is the clear, clickable icon.
    var span = Math.max(map.size_m[0], map.size_m[1]);
    var mkCol = side === "friend" ? COL.mkFriend : side === "hostile" ? COL.mkHostile : COL.mkCiv;
    var markerTex = makeUnitMarkerTexture(side, mkCol);
    var mkMat = new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthTest: false, depthWrite: false });
    var marker = new THREE.Sprite(mkMat);
    var mkSize = Math.max(260, span * 0.050);
    marker.scale.set(mkSize, mkSize, 1);
    marker.position.y = unitLen * 1.4 + mkSize * 0.55;
    marker.renderOrder = 20;
    g.add(marker);

    // selection halo behind the marker (hidden until selected; pulses in animate())
    var haloTex = makeHaloTexture(mkCol);
    var haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    var halo = new THREE.Sprite(haloMat);
    halo.scale.set(mkSize * 2.2, mkSize * 2.2, 1);
    halo.position.copy(marker.position);
    halo.renderOrder = 19;
    g.add(halo);

    // name label above the marker
    var label = makeLabelSprite(name, span);
    label.position.y = marker.position.y + mkSize * 0.85;
    label.material.depthTest = false; label.renderOrder = 21;
    g.add(label);

    // OFF-NET ghost outline (a dashed red ring on the ground) — shown only when off the comms net
    var offRing = new THREE.LineLoop(
      ringLoopGeom(mkSize * 0.7, 48),
      new THREE.LineDashedMaterial({ color: COL.commsOff, dashSize: mkSize * 0.18, gapSize: mkSize * 0.13, transparent: true, opacity: 0.95, depthTest: false }));
    offRing.computeLineDistances();
    offRing.rotation.x = -Math.PI / 2; offRing.position.y = 2; offRing.renderOrder = 18;
    offRing.visible = false; g.add(offRing);

    // "NO COMMS" red warning tag — shown only when off net
    var offTag = makeTagSprite("NO COMMS", COL.commsOff, span);
    offTag.position.y = label.position.y + mkSize * 0.5;
    offTag.material.depthTest = false; offTag.renderOrder = 23;
    offTag.visible = false; g.add(offTag);

    g.userData = { name: name, side: side, cls: cls, gun: gun, rangeM: rangeM, note: note, x: x, z: z, eye: y + unitLen * 0.3,
                   marker: marker, mkMat: mkMat, halo: halo, haloMat: haloMat, label: label, labelMat: label.material,
                   offRing: offRing, offTag: offTag, baseMkY: marker.position.y, mkSize: mkSize,
                   _eyeOff: unitLen * 0.3, struct: 100 };
    unitsGroup.add(g);
    units.push(g);
  }

  // A flat ring-loop geometry (points around a circle on the XY plane) for dashed ground rings.
  function ringLoopGeom(rad, segs) {
    var pts = [];
    for (var i = 0; i < segs; i++) {
      var a = i / segs * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, 0));
    }
    var g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  }

  // Canvas sprite for a unit marker: a coloured diamond (friend), chevron/triangle (hostile),
  // or circle (civilian), with a dark outline so it pops on any terrain. Always billboarded.
  function makeUnitMarkerTexture(side, colInt) {
    var S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    var c = "#" + ("000000" + colInt.toString(16)).slice(-6);
    ctx.lineWidth = 7; ctx.strokeStyle = "rgba(8,11,10,0.92)"; ctx.fillStyle = c;
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6;
    var m = 18, c2 = S / 2;
    if (side === "friend") {
      // diamond
      ctx.beginPath();
      ctx.moveTo(c2, m); ctx.lineTo(S - m, c2); ctx.lineTo(c2, S - m); ctx.lineTo(m, c2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (side === "hostile") {
      // downward chevron / inverted triangle
      ctx.beginPath();
      ctx.moveTo(m, m + 8); ctx.lineTo(S - m, m + 8); ctx.lineTo(c2, S - m);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      // circle
      ctx.beginPath(); ctx.arc(c2, c2, c2 - m, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // inner highlight dot
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(c2, c2, 7, 0, Math.PI * 2); ctx.fill();
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }

  // Soft radial halo for the selected-unit pulse.
  function makeHaloTexture(colInt) {
    var S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    var c = "#" + ("000000" + colInt.toString(16)).slice(-6);
    var g = ctx.createRadialGradient(S/2, S/2, S*0.18, S/2, S/2, S*0.5);
    g.addColorStop(0, "rgba(255,255,255,0.0)");
    g.addColorStop(0.55, c + "00");
    g.addColorStop(0.78, hexA(c, 0.85));
    g.addColorStop(0.9, hexA(c, 0.35));
    g.addColorStop(1, c + "00");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  // ---------- overlays: LOS + range ----------
  function rebuildOverlays() {
    if (overlayGroup) scene.remove(overlayGroup);
    overlayGroup = new THREE.Group(); scene.add(overlayGroup);
    var u = selected || units[0];
    if (!u) {
      if (show.slope) computeSlopeOverlay(); else clearViewshed();
      return;
    }
    var d = u.userData;

    // SLOPE / trafficability overlay takes priority over the analysis shaders when on.
    if (show.slope) {
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      computeSlopeOverlay();
      updateFireReadout(null);   // hide fire panel if it was open
    } else if (show.fire) {
      // FIRE ANALYSIS takes over the terrain shading when active (replaces plain viewshed).
      computeFireAnalysis(u);
      buildFireRings(u);
      updateFireReadout(u);
    } else if (show.deadzones) {
      // FIRE PICTURE: shade the SELECTED unit's direct-fire dead zones (red) vs hittable (green).
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      updateFireReadout(null);          // keep the separate fire-analysis panel hidden
      if (u.userData.rangeM > 0) computeDeadZones(u);
      else if (show.los) computeViewshed(u); else clearViewshed();   // unarmed unit: fall back to viewshed
      updateDeadReadout(u);
    } else {
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      // VIEWSHED light-cast: highlight everything this unit can see.
      if (show.los) computeViewshed(u); else clearViewshed();
      updateDeadReadout(u);
    }

    // FOG-CULL LOD: dim/hide buildings outside this unit's sight (recompute on selection change).
    applyFogCull();

    // GUN RANGE: a clear AMBER max-range ring (follows terrain, clamped to map edge) + a closer
    // amber-orange "effective range" ring. Drawn thick & bright, clearly distinct from the teal
    // LOS viewshed, with a "N km" tag floating at the ring's edge.
    if (show.range && d.rangeM > 0) {
      // translucent amber coverage disc so the gun's reach reads even when the boundary runs
      // off-map (a 18km gun on an 11km map): the whole in-range ground is faintly amber-lit.
      addRangeDisc(d, d.rangeM);
      addRangeRing(d, d.rangeM, COL.rangeMax, 0.95, 7, (d.rangeM / 1000).toFixed(0) + " km");
      // effective range = ~60% of max (where most accurate / decisive fire lands)
      var effM = d.rangeM * 0.6;
      addRangeRing(d, effM, COL.rangeEff, 0.8, 5, "eff " + (effM / 1000).toFixed(0) + " km");
    }

    // LOS lines from the selected unit to every other unit (bright green=clear, bright red=blocked).
    // Faked "thickness" by drawing the line a few times with tiny offsets (LineBasicMaterial.linewidth
    // is ignored on most platforms).
    if (show.los && !show.comms) {
      for (var k = 0; k < units.length; k++) {
        if (units[k] === u) continue;
        var o = units[k].userData;
        var clear = hasLOS(d.x, d.z, d.eye, o.x, o.z, o.eye);
        addThickLine(losSamples(d, o), clear ? COL.losClear : COL.losBlock, clear ? 0.98 : 0.85, 7);
      }
    }

    // COMMS NET overlay (its own toggle) — replaces the per-unit LOS spray with the friendly
    // relay graph: who is on the command net (LOS chain to the command unit) and who is OFF.
    if (show.comms) { buildCommsNet(u); }
    else { clearCommsMarks(); }

    // marker selection highlight (pulse handled per-frame in animate())
    updateMarkerHighlights();
  }

  // A faint translucent amber DISC over the in-range ground (a coverage footprint). Built as a
  // displaced circle geometry so it sits on the terrain; rendered additively-soft so it reads as a
  // gun-coverage glow without hiding the topo underneath.
  function addRangeDisc(d, radM) {
    var seg = 64, geo = new THREE.CircleGeometry(radM, seg);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var W = map.size_m[0], L = map.size_m[1];
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i) + d.x, z = pos.getZ(i) + d.z;
      pos.setY(i, heightAt(clamp(x, 0, W), clamp(z, 0, L)) + 6);
    }
    geo.attributes.position.needsUpdate = true;
    var mat = new THREE.MeshBasicMaterial({ color: COL.rangeMax, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide });
    var disc = new THREE.Mesh(geo, mat);
    disc.position.set(d.x, 0, d.z);
    disc.renderOrder = 8;
    overlayGroup.add(disc);
  }

  // Draw one gun-range ring that hugs the terrain, clamped to the map but still tracing the arc,
  // with a small floating distance tag at a point on the ring that's inside the map.
  function addRangeRing(d, radM, colInt, opacity, thickness, tagText) {
    var segs = 200;
    var W = map.size_m[0], L = map.size_m[1];
    var pad = 30;   // keep the visible arc a touch inside the edge
    // Break the circle into runs of IN-MAP points so an out-of-map arc isn't drawn as a flat
    // clamp along the border. Each in-map run is drawn as its own thick line (a true arc).
    var run = [], runs = [], tagPt = null, lastTagPt = null;
    for (var i = 0; i <= segs; i++) {
      var a = i / segs * Math.PI * 2;
      var rx = d.x + Math.cos(a) * radM;
      var rz = d.z + Math.sin(a) * radM;
      var inMap = (rx >= pad && rx <= W - pad && rz >= pad && rz <= L - pad);
      if (inMap) {
        var v = new THREE.Vector3(rx, heightAt(rx, rz) + 10, rz);
        run.push(v);
        lastTagPt = v;
        // prefer a tag point on the screen-facing (south / +z) side so it's readable
        if (rz > d.z) tagPt = v;
      } else if (run.length) {
        runs.push(run); run = [];
      }
    }
    if (run.length) runs.push(run);
    for (var r = 0; r < runs.length; r++) {
      if (runs[r].length >= 2) addThickLine(runs[r], colInt, opacity, thickness);
    }
    if (tagText) {
      var anchor = tagPt || lastTagPt;
      if (anchor) {
        var tag = makeTagSprite(tagText, colInt, Math.max(W, L));
        tag.position.copy(anchor); tag.position.y += 60;
        tag.material.depthTest = false; tag.renderOrder = 22;
        overlayGroup.add(tag);
      }
    }
  }

  // Fake a thicker bright line by stacking a few slightly y-offset copies (linewidth is unreliable).
  function addThickLine(pts, colInt, opacity, thickness) {
    // offset scales with the map so the stacked copies actually read as a thick band.
    var span = map ? Math.max(map.size_m[0], map.size_m[1]) : 10000;
    var step = Math.max(18, span * 0.0022);
    var n = thickness ? Math.max(3, Math.round(thickness / 1.4)) : 3;
    for (var j = 0; j < n; j++) {
      var off = j * step;
      var p2 = pts;
      if (off) { p2 = pts.map(function (p) { return new THREE.Vector3(p.x, p.y + off, p.z); }); }
      var g = new THREE.BufferGeometry().setFromPoints(p2);
      var m = new THREE.LineBasicMaterial({ color: colInt, transparent: true,
        opacity: opacity * (1 - j * 0.18), depthTest: false });
      var ln = new THREE.Line(g, m); ln.renderOrder = 15 + j;
      overlayGroup.add(ln);
    }
  }

  // small floating value tag (amber on dark) used for the range rings.
  function makeTagSprite(text, colInt, span) {
    var fs = 38, pad = 14;
    var cv = document.createElement("canvas"); var mctx = cv.getContext("2d");
    mctx.font = "bold " + fs + "px DejaVu Sans Mono, monospace";
    var tw = Math.ceil(mctx.measureText(text.toUpperCase()).width);
    cv.width = tw + pad * 2; cv.height = fs + pad * 2;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "rgba(10,13,11,0.82)"; ctx.fillRect(0, 0, cv.width, cv.height);
    var c = "#" + ("000000" + colInt.toString(16)).slice(-6);
    ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3);
    ctx.font = "bold " + fs + "px DejaVu Sans Mono, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = c;
    ctx.fillText(text.toUpperCase(), cv.width / 2, cv.height / 2 + 2);
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; tex.anisotropy = 4;
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    var h = Math.max(90, span * 0.016); spr.scale.set(h * (cv.width / cv.height), h, 1);
    return spr;
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

  // ===========================================================================
  // COMMS NET — the line-of-sight command-and-control graph (INTELLIGENCE_LAYER.md).
  // Comms are tight-beam laser: a friendly unit is ON THE NET if it has terrain LOS to another
  // on-net friendly (relayed: A->B->C). The command node is the selected friendly (or the first
  // friendly). On-net links are drawn as teal lines; off-net friendlies are dimmed, ringed with a
  // dashed red "NO COMMS" loop, and ghost-labelled. Readout: "COMMS: N/M units on net".
  // ===========================================================================
  function buildCommsNet(sel) {
    var friends = units.filter(function (g) { return g.userData.side === "friend" && !(g.userData.cmd && g.userData.cmd.ko); });
    // command node = the FLAGSHIP if set & alive (command mode), else selected friendly, else first
    var cmdNode = (cmd.flagship && cmd.flagship.userData.side === "friend" && !cmd.flagship.userData.cmd.ko && friends.indexOf(cmd.flagship) >= 0)
      ? cmd.flagship
      : ((sel && sel.userData.side === "friend") ? sel : friends[0]);
    var cmdLocal = cmdNode;   // (renamed to avoid shadowing the global `cmd` command state)
    var onNet = {};   // index in `friends` -> true
    if (cmdLocal) {
      var ci = friends.indexOf(cmdLocal);
      onNet[ci] = true;
      var frontier = [ci];
      // BFS over the friendly LOS graph (comms range = generous; laser link is long-range)
      var COMMS_RANGE = Math.max(map.size_m[0], map.size_m[1]) * 1.2;
      var linkSet = {};   // dedupe drawn links "i_j"
      var links = [];
      while (frontier.length) {
        var a = frontier.pop();
        var ad = friends[a].userData;
        for (var b = 0; b < friends.length; b++) {
          if (b === a || onNet[b]) continue;
          var bd = friends[b].userData;
          if (Math.hypot(ad.x - bd.x, ad.z - bd.z) > COMMS_RANGE) continue;
          if (hasLOS(ad.x, ad.z, ad.eye, bd.x, bd.z, bd.eye)) {
            onNet[b] = true; frontier.push(b);
          }
        }
      }
      // draw links between every pair of on-net friends that actually have LOS (shows the mesh)
      for (var i = 0; i < friends.length; i++) {
        if (!onNet[i]) continue;
        for (var j = i + 1; j < friends.length; j++) {
          if (!onNet[j]) continue;
          var id = friends[i].userData, jd = friends[j].userData;
          if (Math.hypot(id.x - jd.x, id.z - jd.z) > COMMS_RANGE) continue;
          if (hasLOS(id.x, id.z, id.eye, jd.x, jd.z, jd.eye)) {
            addThickLine(losSamples(id, jd), COL.comms, 0.95, 5);
          }
        }
      }
    }
    // mark each friendly on/off net; tag off-net for the inspect panel
    var nOn = 0;
    for (var f = 0; f < friends.length; f++) {
      var g = friends[f], on = !!onNet[f];
      g.userData._onNet = on;
      g.userData._isCmd = (g === cmdLocal);
      if (on) nOn++;
      setOffNet(g, !on);
    }
    // non-friendly units never get off-net marks
    units.forEach(function (g) { if (g.userData.side !== "friend") { g.userData._onNet = null; setOffNet(g, false); } });

    var statEl = document.getElementById("commsStat");
    if (statEl) statEl.textContent = nOn + "/" + friends.length + " on net";
    var topEl = document.getElementById("commsTop");
    if (topEl) { topEl.style.display = "inline"; topEl.textContent = "COMMS: " + nOn + "/" + friends.length + " ON NET"; }
    // feed the command panel: net status + flagship-off-net warning
    cmd.netStat = nOn + "/" + friends.length + " on net";
    if (cmd.flagship) {
      var fi = friends.indexOf(cmd.flagship);
      cmd.flagshipOffNet = (fi < 0) || !onNet[fi];   // flagship lost or off the net
    }
    syncCommandPanel();
    // refresh inspect-panel comms line if a unit is open
    if (selected) refreshCommsLine(selected);
  }

  function setOffNet(g, off) {
    var d = g.userData;
    if (d.offRing) d.offRing.visible = off;
    if (d.offTag) d.offTag.visible = off;
    // dim the whole crab + marker when off net (ghost)
    var dim = off ? 0.35 : 1.0;
    g.traverse(function (o) {
      if (o.isMesh && o.material && o !== d.offRing) {
        if (o.userData._baseOpacity === undefined) {
          o.userData._baseOpacity = (o.material.opacity !== undefined ? o.material.opacity : 1);
          o.userData._baseTransparent = !!o.material.transparent;
        }
        o.material.transparent = off ? true : o.userData._baseTransparent;
        o.material.opacity = o.userData._baseOpacity * dim;
      }
    });
    if (d.mkMat) { d.mkMat.opacity = dim; }
    if (d.labelMat) { d.labelMat.opacity = off ? 0.55 : 1; }
  }

  function clearCommsMarks() {
    units.forEach(function (g) {
      g.userData._onNet = undefined;
      setOffNet(g, false);
    });
    var statEl = document.getElementById("commsStat");
    if (statEl) statEl.textContent = "--";
    var topEl = document.getElementById("commsTop");
    if (topEl) topEl.style.display = "none";
    cmd.netStat = "";
    if (cmd.flagship) cmd.flagshipOffNet = cmd.flagship.userData.cmd && cmd.flagship.userData.cmd.ko;
    syncCommandPanel();
    if (selected) refreshCommsLine(selected);
  }

  function refreshCommsLine(g) {
    var el = document.getElementById("uComms"); if (!el) return;
    var d = g.userData;
    if (d.side !== "friend") { el.textContent = "n/a (hostile/civ)"; el.className = "dim"; return; }
    if (!show.comms || d._onNet === undefined) { el.textContent = "enable COMMS NET"; el.className = "dim"; return; }
    if (d._isCmd) { el.textContent = "COMMAND NODE"; el.className = "k"; return; }
    if (d._onNet) { el.textContent = "ON NET"; el.className = "k"; }
    else { el.textContent = "OFF NET - NO CONTACT"; el.className = "warn"; }
  }

  // selected unit: show + pulse its halo; others hide halo.
  function updateMarkerHighlights() {
    units.forEach(function (g) {
      var d = g.userData;
      if (!d.haloMat) return;
      d.haloMat.opacity = (g === selected) ? 0.9 : 0;
    });
  }

  // ---------- interaction ----------
  function onClick(e) {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(units, true);
    if (hits.length) {
      var g = hits[0].object; while (g.parent && units.indexOf(g) < 0) g = g.parent;
      if (units.indexOf(g) >= 0) {
        // command mode: SHIFT-click adds a friendly to the multi-select set (formation);
        // clicking a hostile while a friendly is selected sets it as the engage TARGET.
        if (cmd.on && e.shiftKey && g.userData.side === "friend") {
          var idx = cmd.selectedSet.indexOf(g);
          if (idx >= 0) cmd.selectedSet.splice(idx, 1); else cmd.selectedSet.push(g);
          selectUnit(g);
          return;
        }
        if (cmd.on && g.userData.side === "hostile" && selected && selected.userData.side === "friend") {
          cmd.target = g;   // remembered for BEST POSITION
          document.getElementById("status").textContent = "TARGET: " + g.userData.name;
        }
        if (!e.shiftKey) cmd.selectedSet = [g];
        selectUnit(g);
      }
    }
  }
  // RIGHT-CLICK in command mode: drop an order flag on the terrain for the selected unit
  // (or for the whole selectedSet as a formation), or clear a flag if a flag was clicked.
  // SHIFT = chain a waypoint.
  function onContext(e) {
    if (!cmd.on) return;        // only active in command mode (normal context menu otherwise)
    e.preventDefault();
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // 1) did we right-click an existing flag? -> clear that unit's orders
    if (cmd.flagGroup) {
      var fhits = raycaster.intersectObjects(cmd.flagGroup.children, true);
      if (fhits.length) {
        var fg = fhits[0].object; while (fg.parent && !fg.userData.isFlag) fg = fg.parent;
        if (fg.userData.isFlag && !fg.userData.isObjective) {
          // find the unit owning this flag and clear its orders
          units.forEach(function (g) {
            if (g.userData.cmd && g.userData.cmd.flags.indexOf(fg) >= 0) clearOrders(g);
          });
          return;
        }
      }
    }
    // 2) raycast the terrain for a ground point
    if (!terrainMesh) return;
    var thits = raycaster.intersectObject(terrainMesh, false);
    if (!thits.length) return;
    var p = thits[0].point;
    var x = clamp(p.x, 0, map.size_m[0]), z = clamp(p.z, 0, map.size_m[1]);
    var shift = e.shiftKey;
    // formation move if multiple units are in the set
    if (cmd.selectedSet.length > 1 && !shift) { formationMove(x, z, cmd.flagType); return; }
    if (selected && selected.userData.side === "friend") {
      issueOrder(selected, x, z, cmd.flagType, shift);
      document.getElementById("status").textContent =
        (shift ? "WAYPOINT ADDED" : cmd.flagType.toUpperCase() + " ORDER ISSUED");
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
    document.getElementById("uStruct").style.width = (d.cmd ? Math.round(d.cmd.struct) : 100) + "%";
    document.getElementById("uGun").textContent = d.gun;
    document.getElementById("uRange").textContent = d.rangeM ? (d.rangeM / 1000).toFixed(1) + " km" : "n/a";
    document.getElementById("uNote").textContent = d.note;
    rebuildOverlays();
    refreshCommsLine(g);
    if (typeof syncCommandPanel === "function") syncCommandPanel();
  }

  // Cycle the selection through FRIENDLY crabs with the , and . keys (player units first; if there
  // are none, fall back to cycling all units). dir = -1 (previous) | +1 (next). Wraps around.
  // Selecting via keys does exactly what clicking does (selectUnit) and optionally eases the
  // camera toward the new unit so it's findable without yanking the view.
  function cycleUnit(dir) {
    if (!units.length) return;
    var list = units.filter(function (g) { return g.userData.side === "friend"; });
    if (!list.length) list = units;           // no friendlies -> cycle everything
    var i = list.indexOf(selected);
    if (i < 0) i = (dir > 0) ? -1 : 0;        // selected not in list -> start at an edge
    var next = list[(i + dir + list.length) % list.length];
    selectUnit(next);
    focusUnit(next);
  }

  // Gentle, OPTIONAL camera ease toward a unit when cycling (orbit mode only; never fights fly cam).
  // Only nudges the orbit target — keeps the current zoom/angle so it doesn't disorient the player.
  function focusUnit(g) {
    if (fly.on || !controls) return;
    var d = g.userData;
    var ty = heightAt(d.x, d.z);
    var cur = controls.target;
    // ease 55% of the way to the new unit (subtle, not a snap)
    cur.set(cur.x + (d.x - cur.x) * 0.55, cur.y + (ty - cur.y) * 0.55, cur.z + (d.z - cur.z) * 0.55);
    controls.update();
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
  var deadSync = function () {};   // set in bindUI; lets fire/slope toggles refresh DEAD ZONES btn
  function bindUI() {
    tog("tLOS", "los"); tog("tRange", "range"); tog("tBld", "bld"); tog("tWire", "wire");
    tog("tWind", "wind"); tog("tRain", "rain");
    tog("tSub", "suburbs"); tog("tFogCull", "fogcull");
    document.getElementById("tSub").classList.toggle("on", show.suburbs);
    document.getElementById("tFogCull").classList.toggle("on", show.fogcull);
    document.getElementById("tFly").onclick = function () { setFly(!fly.on); };

    // ---- COMMS NET toggle (its own overlay; coexists with gun range + units) ----
    function syncCommsUI() {
      document.getElementById("tComms").classList.toggle("on", show.comms);
      document.getElementById("commsLeg").style.display = show.comms ? "block" : "none";
    }
    document.getElementById("tComms").onclick = function () {
      show.comms = !show.comms;
      syncCommsUI(); rebuildOverlays();
    };
    syncCommsUI();

    // ---- DEAD ZONES toggle (FIRE PICTURE for the selected unit) ----
    // Shades the selected crab's direct-fire dead zones (red) vs hittable ground (green).
    // Shares the fire-analysis dead-space machinery but is its own UX, keyed to selection.
    // Mutually exclusive with FIRE ANALYSIS + SLOPE (they all own the terrain colours).
    function syncDeadUI() {
      document.getElementById("tDead").classList.toggle("on", show.deadzones);
      document.getElementById("deadLeg").style.display = show.deadzones ? "block" : "none";
      document.getElementById("tLOS").classList.toggle("on", show.los && !show.fire && !show.deadzones);
    }
    document.getElementById("tDead").onclick = function () {
      show.deadzones = !show.deadzones;
      if (show.deadzones) {
        // the dead-zone picture replaces the plain viewshed + competing shaders
        show.fire = false; show.slope = false; show.los = false;
        document.getElementById("fire").style.display = "none";
        syncFireUI(); syncSlopeUI();
      } else {
        show.los = true;                       // restore the default viewshed
      }
      syncDeadUI(); syncFireUI(); syncSlopeUI(); rebuildOverlays();
    };
    syncDeadUI();
    deadSync = syncDeadUI;   // expose so other toggles can refresh the dead-zone button

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
      if (show.fire) { show.los = false; show.slope = false; show.deadzones = false; syncSlopeUI(); deadSync(); }  // fire shading replaces viewshed/slope/deadzones
      else { show.los = true; }
      document.getElementById("fire").style.display = show.fire ? "block" : "none";
      syncFireUI(); rebuildOverlays();
    };
    function setTraj(m) {
      fireMode = m;
      if (!show.fire) { show.fire = true; show.los = false; show.slope = false; show.deadzones = false; syncSlopeUI(); deadSync(); document.getElementById("fire").style.display = "block"; }
      syncFireUI(); rebuildOverlays();
    }
    document.getElementById("fDirect").onclick  = function () { setTraj("direct"); };
    document.getElementById("fOblique").onclick = function () { setTraj("oblique"); };
    document.getElementById("fMortar").onclick  = function () { setTraj("mortar"); };
    syncFireUI();

    // ---- SLOPE / TRAFFICABILITY toggle (mutually exclusive with fire + viewshed) ----
    function syncSlopeUI() {
      document.getElementById("tSlope").classList.toggle("on", show.slope);
      document.getElementById("slopeLeg").style.display = show.slope ? "block" : "none";
    }
    document.getElementById("tSlope").onclick = function () {
      show.slope = !show.slope;
      if (show.slope) {
        // turning slope on shuts down the competing terrain shaders
        show.fire = false; show.los = false; show.deadzones = false;
        document.getElementById("fire").style.display = "none";
      } else {
        show.los = true;                       // restore the default viewshed
      }
      syncSlopeUI(); syncFireUI(); deadSync(); rebuildOverlays();
    };
    syncSlopeUI();
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

    // ---- COMMAND MODE bindings ----
    document.getElementById("tCmd").onclick = function () { setCommandMode(!cmd.on); };
    var scenSel = document.getElementById("scenSel");
    if (scenSel) scenSel.onchange = function () {
      if (scenSel.value) loadScenario(scenSel.value);
      else { cmd.scenario = ""; document.getElementById("cScen").textContent = "FREE DEPLOY"; }
    };
    document.getElementById("playBtn").onclick = function () { setPlaying(!cmd.playing); };
    function setFlagType(t) {
      cmd.flagType = t;
      ["Move","Hold","Attack"].forEach(function (n) {
        document.getElementById("ft" + n).classList.toggle("on", n.toLowerCase() === t);
      });
    }
    document.getElementById("ftMove").onclick   = function () { setFlagType("move"); };
    document.getElementById("ftHold").onclick   = function () { setFlagType("hold"); };
    document.getElementById("ftAttack").onclick = function () { setFlagType("attack"); };
    document.getElementById("cFlagshipBtn").onclick = function () {
      if (selected && selected.userData.side === "friend") setFlagship(selected);
      else autoPickFlagship();
    };
    document.getElementById("cBestBtn").onclick = function () {
      var tgt = cmd.target || units.filter(function (g) { return g.userData.side === "hostile" && !g.userData.cmd.ko; })[0];
      if (selected && selected.userData.side === "friend" && tgt) bestPosition(selected, tgt);
      else document.getElementById("status").textContent = "SELECT A FRIENDLY + TARGET AN ENEMY";
    };
    document.getElementById("cClearBtn").onclick = function () {
      if (selected) clearOrders(selected);
    };
    document.getElementById("cAllBtn").onclick = function () {
      cmd.selectedSet = units.filter(function (g) { return g.userData.side === "friend" && !g.userData.cmd.ko; });
      document.getElementById("status").textContent = "ALL FRIENDLY UNITS SELECTED (" + cmd.selectedSet.length + ")";
    };
    // expose for keyboard
    cmd._setFlagType = setFlagType;
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
      // , / . cycle the selected unit (previous / next friendly crab). Skip if typing in the <select>.
      if ((e.key === "," || e.key === ".") && (!document.activeElement || document.activeElement.tagName !== "SELECT")) {
        cycleUnit(e.key === "," ? -1 : 1); e.preventDefault(); return;
      }
      // COMMAND MODE keys: 1/2/3 = flag type, SPACE = play/pause
      if (cmd.on && (!document.activeElement || document.activeElement.tagName !== "SELECT")) {
        if (k === "1") { if (cmd._setFlagType) cmd._setFlagType("move");   e.preventDefault(); return; }
        if (k === "2") { if (cmd._setFlagType) cmd._setFlagType("hold");   e.preventDefault(); return; }
        if (k === "3") { if (cmd._setFlagType) cmd._setFlagType("attack"); e.preventDefault(); return; }
        if (e.key === " " || k === "spacebar") { setPlaying(!cmd.playing); e.preventDefault(); return; }
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

  // ===========================================================================
  // COMMAND MODE — the playable command demo: flags (orders), flagship, movement,
  // engagement, formations and scenarios. Additive on top of the review viewer; all
  // existing overlays keep working. The sim loop only runs when cmd.playing is true.
  // ===========================================================================

  // class -> ground speed (m/s, scaled so movement is watchable on an 11km map).
  function classSpeed(cls) {
    return cls === "Recon" ? 230 : cls === "Line" ? 160 : cls === "Siege" ? 95 :
           cls === "Convoy" ? 70 : 175;
  }

  // Per-unit command state. Called once after units are placed.
  function initCommand() {
    cmd.flagGroup  = new THREE.Group(); scene.add(cmd.flagGroup);
    cmd.orderGroup = new THREE.Group(); scene.add(cmd.orderGroup);
    cmd.fxGroup    = new THREE.Group(); scene.add(cmd.fxGroup);
    cmd.flagship = null; cmd.selectedSet = []; cmd.objective = null;
    units.forEach(function (g) {
      var d = g.userData;
      d.cmd = { flags: [], targetIdx: 0, struct: d.struct != null ? d.struct : 100,
                ko: false, speed: classSpeed(d.cls), firingTo: null, fireLine: null,
                fireTimer: 0 };
    });
    syncCommandPanel();
  }

  function setCommandMode(on) {
    cmd.on = on;
    var p = document.getElementById("cmd");      if (p) p.style.display = on ? "block" : "none";
    var h = document.getElementById("cmdHint");  if (h) h.style.display = on ? "block" : "none";
    var s = document.getElementById("scenSel");  if (s) s.style.display = on ? "block" : "none";
    var b = document.getElementById("tCmd");     if (b) b.classList.toggle("on", on);
    if (cmd.flagGroup)  cmd.flagGroup.visible  = on;
    if (cmd.orderGroup) cmd.orderGroup.visible  = on;
    if (cmd.fxGroup)    cmd.fxGroup.visible     = on;
    if (!on) { setPlaying(false); }
    syncCommandPanel();
  }

  function setPlaying(on) {
    cmd.playing = on;
    var b = document.getElementById("playBtn");
    if (b) { b.classList.toggle("playing", on); b.innerHTML = on ? "&#10073;&#10073; PAUSE" : "&#9654; PLAY"; }
    var s = document.getElementById("cSim");
    if (s) { s.textContent = on ? "RUNNING" : "PAUSED"; s.className = on ? "k" : "warn"; }
  }

  // ---- FLAGS (order objectives) -------------------------------------------------
  // Build a flag mesh: a thin pole + a coloured pennant sprite at a terrain point.
  function makeFlag(x, z, type, isObjective) {
    var col = isObjective ? FLAG_COL.objective : (FLAG_COL[type] || FLAG_COL.move);
    var span = Math.max(map.size_m[0], map.size_m[1]);
    var poleH = Math.max(90, span * 0.013);
    var grp = new THREE.Group();
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(poleH * 0.03, poleH * 0.03, poleH, 5),
      new THREE.MeshBasicMaterial({ color: 0x1a1f1d }));
    pole.position.y = poleH / 2; grp.add(pole);
    // pennant sprite (triangle banner on a canvas)
    var pen = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makePennantTexture(col, isObjective ? "OBJ" : type[0].toUpperCase()),
      transparent: true, depthTest: false, depthWrite: false }));
    var pw = poleH * 0.95;
    pen.scale.set(pw, pw * 0.62, 1);
    pen.position.set(pw * 0.42, poleH * 0.82, 0);
    pen.renderOrder = 24; grp.add(pen);
    // ground ring so the flag base reads on terrain
    var ring = new THREE.Mesh(new THREE.RingGeometry(poleH * 0.18, poleH * 0.26, 20),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 2; ring.renderOrder = 9; grp.add(ring);
    grp.position.set(x, heightAt(clamp(x, 0, map.size_m[0]), clamp(z, 0, map.size_m[1])), z);
    grp.userData = { isFlag: true, fx: x, fz: z, type: type, isObjective: isObjective, pennant: pen };
    return grp;
  }

  function makePennantTexture(colInt, letter) {
    var S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    var c = "#" + ("000000" + colInt.toString(16)).slice(-6);
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 6;
    ctx.fillStyle = c; ctx.strokeStyle = "rgba(8,11,10,0.92)"; ctx.lineWidth = 6;
    // pennant: a swallow-tail banner from left edge
    ctx.beginPath();
    ctx.moveTo(10, 14); ctx.lineTo(118, 30); ctx.lineTo(80, 50);
    ctx.lineTo(118, 70); ctx.lineTo(10, 96); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "#0b0d0c";
    ctx.font = "bold 42px DejaVu Sans Mono, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(letter, 48, 54);
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }

  // Issue an order: drop a flag for a unit. waypoint=true chains it; else replaces.
  function issueOrder(g, x, z, type, waypoint) {
    if (!g || g.userData.side !== "friend") return;
    var c = g.userData.cmd;
    if (!waypoint) { clearOrders(g); }
    var flag = makeFlag(x, z, type || cmd.flagType, false);
    cmd.flagGroup.add(flag);
    c.flags.push(flag);
    if (!waypoint) c.targetIdx = 0;
    drawOrderLines(g);
  }

  function clearOrders(g) {
    var c = g.userData.cmd;
    c.flags.forEach(function (f) { cmd.flagGroup.remove(f); });
    c.flags = []; c.targetIdx = 0;
    if (c.fireLine) { cmd.fxGroup.remove(c.fireLine); c.fireLine = null; }
    c.firingTo = null;
    drawOrderLines(g);
  }

  // Redraw the order/path lines for ALL friendly units (cheap; few units).
  function drawOrderLines(_changed) {
    if (!cmd.orderGroup) return;
    while (cmd.orderGroup.children.length) cmd.orderGroup.remove(cmd.orderGroup.children[0]);
    units.forEach(function (g) {
      var d = g.userData, c = d.cmd;
      if (!c || !c.flags.length || c.ko) return;
      var col = FLAG_COL[c.flags[c.flags.length - 1].userData.type] || FLAG_COL.move;
      // chain: unit -> flag[target] -> flag[...] in order
      var pts = [new THREE.Vector3(d.x, heightAt(d.x, d.z) + 18, d.z)];
      for (var i = c.targetIdx; i < c.flags.length; i++) {
        var f = c.flags[i].userData;
        pts.push(new THREE.Vector3(f.fx, heightAt(clamp(f.fx,0,map.size_m[0]), clamp(f.fz,0,map.size_m[1])) + 18, f.fz));
      }
      if (pts.length < 2) return;
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var mat = new THREE.LineDashedMaterial({ color: col, transparent: true, opacity: 0.9,
        dashSize: 80, gapSize: 50, depthTest: false });
      var ln = new THREE.Line(geo, mat); ln.computeLineDistances(); ln.renderOrder = 14;
      cmd.orderGroup.add(ln);
    });
  }

  // ---- FLAGSHIP ----------------------------------------------------------------
  function setFlagship(g) {
    if (!g || g.userData.side !== "friend") return;
    // remove old crown
    if (cmd.flagship && cmd.flagship.userData.crown) {
      cmd.flagship.remove(cmd.flagship.userData.crown);
      cmd.flagship.userData.crown = null;
      if (cmd.flagship.userData.flagTag) { cmd.flagship.remove(cmd.flagship.userData.flagTag); cmd.flagship.userData.flagTag = null; }
    }
    cmd.flagship = g;
    var d = g.userData;
    var span = Math.max(map.size_m[0], map.size_m[1]);
    var crownTex = makeCrownTexture();
    var crown = new THREE.Sprite(new THREE.SpriteMaterial({ map: crownTex, transparent: true, depthTest: false, depthWrite: false }));
    var cs = d.mkSize * 0.62;
    crown.scale.set(cs, cs, 1);
    crown.position.set(0, d.baseMkY + d.mkSize * 0.62, 0);
    crown.renderOrder = 25; g.add(crown); d.crown = crown;
    var tag = makeTagSprite("FLAGSHIP", FLAG_COL.objective, span);
    tag.position.set(0, d.baseMkY + d.mkSize * 1.25, 0);
    tag.material.depthTest = false; tag.renderOrder = 25; g.add(tag); d.flagTag = tag;
    // flagship is the comms command node — refresh net if comms overlay on
    if (show.comms) rebuildOverlays();
    syncCommandPanel();
  }

  function autoPickFlagship() {
    // heaviest friendly: Siege > Line > others, then biggest gun range
    var rank = { Siege: 3, Line: 2, Recon: 1 };
    var best = null, bestScore = -1;
    units.forEach(function (g) {
      if (g.userData.side !== "friend" || g.userData.cmd.ko) return;
      var s = (rank[g.userData.cls] || 0) * 1e6 + (g.userData.rangeM || 0);
      if (s > bestScore) { bestScore = s; best = g; }
    });
    if (best) setFlagship(best);
  }

  function makeCrownTexture() {
    var S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "#e8c84a"; ctx.strokeStyle = "rgba(8,11,10,0.9)"; ctx.lineWidth = 6;
    // a 5-point star
    var cx = S/2, cy = S/2, R = S*0.40, r = S*0.17;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = -Math.PI/2 + i * Math.PI/5;
      var rad = (i % 2 === 0) ? R : r;
      var x = cx + Math.cos(ang)*rad, y = cy + Math.sin(ang)*rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }

  // ---- MOVEMENT + COMBAT SIM (stepped only when cmd.playing) -------------------
  var ARRIVE_M = 50;
  function stepCommandSim(dt) {
    if (!cmd.on || !cmd.playing) return;
    dt = Math.min(dt, 0.1);
    var moved = false;
    units.forEach(function (g) {
      var d = g.userData, c = d.cmd;
      if (!c || c.ko) return;
      // --- MOVEMENT toward current flag ---
      if (c.flags.length && c.targetIdx < c.flags.length) {
        var f = c.flags[c.targetIdx].userData;
        var dx = f.fx - d.x, dz = f.fz - d.z;
        var dist = Math.hypot(dx, dz);
        if (dist <= ARRIVE_M) {
          c.targetIdx++;
          if (c.targetIdx >= c.flags.length) { moved = true; }   // arrived at last flag
        } else {
          var step = c.speed * dt;
          if (step > dist) step = dist;
          d.x += dx / dist * step; d.z += dz / dist * step;
          var ny = heightAt(clamp(d.x,0,map.size_m[0]), clamp(d.z,0,map.size_m[1]));
          g.position.set(d.x, ny, d.z);
          d.eye = ny + d._eyeOff;
          // face travel direction
          g.rotation.y = Math.atan2(dx, dz);
          moved = true;
        }
      }
      // --- ENGAGEMENT ---
      stepEngage(g, dt);
    });
    if (moved) { drawOrderLines(); }
    // keep the selected unit's overlays roughly current without thrashing every frame
    cmd._ovTimer = (cmd._ovTimer || 0) + dt;
    if (moved && cmd._ovTimer > 0.5) { cmd._ovTimer = 0; if (selected) rebuildOverlays(); }
    updateFiringFx();
    checkFlagshipNet();
  }

  // Decide a unit's combat target and resolve damage over time.
  function stepEngage(g, dt) {
    var d = g.userData, c = d.cmd;
    if (d.side === "civ" || d.rangeM <= 0) { c.firingTo = null; return; }
    // attack flag => seek nearest enemy in range; else only engage if it's an enemy we already target
    var lastFlag = c.flags.length ? c.flags[c.targetIdx >= c.flags.length ? c.flags.length-1 : c.targetIdx].userData : null;
    var wantsAttack = (lastFlag && lastFlag.type === "attack") || c.flags.some(function(f){return f.userData.type==="attack";});
    // friendly engages hostiles; hostile engages friendlies (so the demo fights back)
    var enemySide = d.side === "friend" ? "hostile" : "friend";
    var target = null, bestD = Infinity;
    units.forEach(function (e) {
      if (e === g) return;
      var ed = e.userData;
      if (ed.side !== enemySide || ed.cmd.ko) return;
      var dist = Math.hypot(ed.x - d.x, ed.z - d.z);
      if (dist > d.rangeM) return;
      if (!hasLOS(d.x, d.z, d.eye, ed.x, ed.z, ed.eye)) return;
      if (dist < bestD) { bestD = dist; target = e; }
    });
    // friendlies only auto-fire when they have an ATTACK order (or are the flagship leading);
    // hostiles always defend. This keeps MOVE orders peaceful until told to engage.
    var mayFire = (d.side === "hostile") || wantsAttack || d._engageAll;
    if (target && mayFire) {
      c.firingTo = target;
      // hit model: per second, damage chance scales with closeness within range
      var rangeFrac = bestD / d.rangeM;           // 0=point blank, 1=max range
      var dps = (12 + 26 * (1 - rangeFrac));       // 12..38 struct/sec
      var td = target.userData.cmd;
      td.struct -= dps * dt;
      if (td.struct <= 0) { td.struct = 0; knockOut(target); }
      updateStructBar(target);
    } else {
      c.firingTo = null;
    }
  }

  function knockOut(g) {
    var c = g.userData.cmd; if (c.ko) return;
    c.ko = true; c.firingTo = null;
    if (c.fireLine) { cmd.fxGroup.remove(c.fireLine); c.fireLine = null; }
    // grey the unit out
    g.traverse(function (o) {
      if (o.isMesh && o.material && o.material.color) {
        o.material.color.setHex(0x44484a);
        if (o.material.emissive) o.material.emissive.setHex(0x000000);
      }
    });
    if (g.userData.mkMat) g.userData.mkMat.opacity = 0.4;
    if (g.userData.labelMat) g.userData.labelMat.opacity = 0.4;
    // KO tag
    if (!g.userData.koTag) {
      var span = Math.max(map.size_m[0], map.size_m[1]);
      var t = makeTagSprite("KNOCKED OUT", 0x9a3a33, span);
      t.position.set(0, g.userData.baseMkY + g.userData.mkSize * 0.55, 0);
      t.material.depthTest = false; t.renderOrder = 26; g.add(t); g.userData.koTag = t;
    }
    clearOrders(g);
    if (cmd.flagship === g) { cmd.flagshipOffNet = true; syncCommandPanel(); }
    syncCommandPanel();
  }

  function updateStructBar(g) {
    if (selected === g) {
      var bar = document.getElementById("uStruct");
      if (bar) bar.style.width = Math.round(g.userData.cmd.struct) + "%";
    }
  }

  // Animated firing lines (tracer dashes) between firing pairs.
  function updateFiringFx() {
    var t = performance.now() * 0.001;
    units.forEach(function (g) {
      var c = g.userData.cmd; if (!c) return;
      if (c.firingTo && !c.ko && !c.firingTo.userData.cmd.ko) {
        var a = g.userData, b = c.firingTo.userData;
        var pts = [
          new THREE.Vector3(a.x, a.eye, a.z),
          new THREE.Vector3(b.x, b.eye + 10, b.z)
        ];
        if (!c.fireLine) {
          var geo = new THREE.BufferGeometry().setFromPoints(pts);
          var mat = new THREE.LineDashedMaterial({ color: 0xffcf6a, transparent: true,
            opacity: 0.95, dashSize: 120, gapSize: 200, depthTest: false });
          c.fireLine = new THREE.Line(geo, mat); c.fireLine.renderOrder = 28;
          cmd.fxGroup.add(c.fireLine);
        }
        c.fireLine.geometry.setFromPoints(pts);
        c.fireLine.computeLineDistances();
        // scroll the dashes to read as tracer fire
        c.fireLine.material.dashOffset = -(t * 600) % 320;
        c.fireLine.visible = true;
      } else if (c.fireLine) {
        cmd.fxGroup.remove(c.fireLine); c.fireLine = null;
      }
    });
  }

  // ---- BEST POSITION helper ----------------------------------------------------
  // Find a nearby cell that has LOS to the targeted enemy and good range, drop a flag there.
  function bestPosition(g, enemy) {
    if (!g || !enemy) return;
    var d = g.userData, ed = enemy.userData;
    var res = map.terrain.res, cell = map.terrain.cell_m, H = map.terrain.heights;
    var rz = map.size_m[1] / (res - 1);
    var rangeM = d.rangeM > 0 ? d.rangeM : 12000;
    var bestX = null, bestZ = null, bestScore = -Infinity;
    // search a window of grid cells around the FRIENDLY unit (keep it local & cheap)
    var win = 28;
    var cx = Math.round(d.x / cell), cz = Math.round(d.z / rz);
    for (var zi = cz - win; zi <= cz + win; zi += 2) {
      if (zi < 0 || zi >= res) continue;
      for (var xi = cx - win; xi <= cx + win; xi += 2) {
        if (xi < 0 || xi >= res) continue;
        var wx = xi * cell, wz = zi * rz, wy = H[zi * res + xi];
        var dist = Math.hypot(ed.x - wx, ed.z - wz);
        if (dist > rangeM * 0.95 || dist < rangeM * 0.18) continue;   // in range, not on top of it
        if (!losGrid(wx, wz, wy + d._eyeOff, ed.x, ed.z, ed.eye, res, H, cell, rz)) continue;
        // score: prefer effective range (~55% of max), higher ground, and flanking offset
        var rangeScore = -Math.abs(dist - rangeM * 0.55) / rangeM;
        var elevScore = wy / Math.max(1, map.terrain.max_m) * 0.6;
        var travel = -Math.hypot(wx - d.x, wz - d.z) / rangeM * 0.25;   // don't walk too far
        var score = rangeScore + elevScore + travel;
        if (score > bestScore) { bestScore = score; bestX = wx; bestZ = wz; }
      }
    }
    if (bestX != null) {
      issueOrder(g, bestX, bestZ, "attack", false);
      document.getElementById("status").textContent = "BEST FIRING POSITION ORDERED";
    } else {
      document.getElementById("status").textContent = "NO CLEAR FIRING POSITION FOUND";
    }
  }

  // ---- FORMATIONS (light) ------------------------------------------------------
  // Move all friendly (non-KO) units to a flag in a LINE perpendicular to travel,
  // spread around the flagship.
  function formationMove(x, z, type) {
    var fr = units.filter(function (g) { return g.userData.side === "friend" && !g.userData.cmd.ko; });
    if (!fr.length) return;
    var lead = cmd.flagship && fr.indexOf(cmd.flagship) >= 0 ? cmd.flagship : fr[0];
    var ld = lead.userData;
    // travel direction (from lead toward flag); perpendicular = line spread axis
    var tdx = x - ld.x, tdz = z - ld.z, tl = Math.hypot(tdx, tdz) || 1;
    var px = -tdz / tl, pz = tdx / tl;          // perpendicular unit
    var span = Math.max(map.size_m[0], map.size_m[1]) * 0.018;  // spacing between units
    var n = fr.length, mid = (n - 1) / 2;
    fr.forEach(function (g, i) {
      var off = (i - mid) * span;
      issueOrder(g, x + px * off, z + pz * off, type || cmd.flagType, false);
    });
    document.getElementById("status").textContent = "FORMATION MOVE ORDERED (" + n + " UNITS)";
  }

  // ---- SCENARIOS ---------------------------------------------------------------
  function relabelUnit(g, name, side, cls, gun, rangeM, x, z, note) {
    var d = g.userData;
    d.name = name; d.side = side; d.cls = cls; d.gun = gun; d.rangeM = rangeM;
    d.note = note;
    var ny = heightAt(clamp(x,0,map.size_m[0]), clamp(z,0,map.size_m[1]));
    d.x = x; d.z = z; g.position.set(x, ny, z);
    d.eye = ny + d._eyeOff;
    d.cmd.struct = 100; d.cmd.ko = false; d.cmd.speed = classSpeed(cls);
    // recolour body to the (possibly new) side
    var col = side === "friend" ? COL.friend : side === "hostile" ? COL.hostile : COL.civ;
    var mk = side === "friend" ? COL.mkFriend : side === "hostile" ? COL.mkHostile : COL.mkCiv;
    g.traverse(function (o) {
      if (o.isMesh && o.material && o.material.color && o.userData._isHull) {
        o.material.color.setHex(col); if (o.material.emissive) o.material.emissive.setHex(col);
      }
    });
    if (d.markerTexHolder) { /* marker tex set below */ }
    if (d.mkMat) { d.mkMat.map = makeUnitMarkerTexture(side, mk); d.mkMat.map.needsUpdate = true; d.mkMat.opacity = 1; }
    if (d.labelMat) d.labelMat.opacity = 1;
    // relabel name sprite
    if (d.label && d.label.parent) {
      d.label.parent.remove(d.label);
      var span = Math.max(map.size_m[0], map.size_m[1]);
      var nl = makeLabelSprite(name, span);
      nl.position.copy(d.label.position); nl.material.depthTest = false; nl.renderOrder = 21;
      g.add(nl); d.label = nl; d.labelMat = nl.material;
    }
    // clear KO visuals
    if (d.koTag) { g.remove(d.koTag); d.koTag = null; }
    clearOrders(g);
  }

  function loadScenario(key) {
    if (!units.length) return;
    cmd.scenario = key;
    var W = map.size_m[0], L = map.size_m[1];
    // clear flagship marker
    if (cmd.flagship && cmd.flagship.userData.crown) {
      cmd.flagship.remove(cmd.flagship.userData.crown); cmd.flagship.userData.crown = null;
      if (cmd.flagship.userData.flagTag) { cmd.flagship.remove(cmd.flagship.userData.flagTag); cmd.flagship.userData.flagTag = null; }
    }
    cmd.flagship = null;
    // clear objective flags
    if (cmd.objective && cmd.objective.parent) cmd.flagGroup.remove(cmd.objective);
    cmd.objective = null;
    units.forEach(function (g) { clearOrders(g); });
    var u = units;   // 6 demo units
    var objName = "—";
    if (key === "harbour_crossing") {
      // friendlies south of harbour, objective on far north shore, 2 enemies defending
      relabelUnit(u[0], "ANZAC-01", "friend", "Line",  "BR-155 (18km)", 18000, W*0.42, L*0.14, "Assault element. Crossing the harbour to seize the north shore.");
      relabelUnit(u[1], "ANZAC-02", "friend", "Siege", "SG-305 (30km)", 30000, W*0.55, L*0.10, "Siege support. Flagship — directs the crossing.");
      relabelUnit(u[2], "ANZAC-03", "friend", "Recon", "SR-90 (9km)",    9000, W*0.66, L*0.18, "Amphibious scout. Leads the water crossing.");
      relabelUnit(u[3], "ANZAC-04", "friend", "Line",  "BR-120 (12km)", 12000, W*0.34, L*0.18, "Flank guard.");
      relabelUnit(u[4], "DEFENDER-1", "hostile", "Line", "? (defending)", 16000, W*0.46, L*0.86, "Dug in on the north shore objective.");
      relabelUnit(u[5], "DEFENDER-2", "hostile", "Line", "? (defending)", 14000, W*0.58, L*0.88, "Second defender covering the objective.");
      placeObjective(W*0.50, L*0.90, "NORTH SHORE — far harbour bank");
      objName = "SEIZE NORTH SHORE";
      setFlagship(u[1]);
    } else if (key === "ridge_defence") {
      // friendlies on high ground, enemies attacking from low, HOLD flag on crest
      relabelUnit(u[0], "ANZAC-01", "friend", "Line",  "BR-155 (18km)", 18000, 1084, 8801, "Holding the high crest. Flagship.");
      relabelUnit(u[1], "ANZAC-02", "friend", "Siege", "SG-305 (30km)", 30000, 1500, 8500, "Siege gun on the ridge — dominates the approaches.");
      relabelUnit(u[2], "ANZAC-03", "friend", "Recon", "SR-90 (9km)",    9000,  800, 9100, "Spotter on the flank of the ridge.");
      relabelUnit(u[3], "ANZAC-04", "friend", "Line",  "BR-120 (12km)", 12000, 1300, 9200, "Reserve, just behind the crest.");
      relabelUnit(u[4], "RAIDER-1", "hostile", "Line", "? (attacking)", 15000, 3200, 7000, "Attacking uphill from the low ground.");
      relabelUnit(u[5], "RAIDER-2", "hostile", "Line", "? (attacking)", 15000, 2400, 6400, "Second attacker pushing the ridge.");
      placeObjective(1084, 8801, "HOLD THE CREST");
      objName = "HOLD THE CREST";
      setFlagship(u[0]);
    } else if (key === "convoy_escort") {
      // a slow convoy must reach an exit flag; raiders intercept
      relabelUnit(u[0], "CONVOY-LEAD", "friend", "Convoy", "light (4km)", 4000, W*0.12, L*0.30, "Slow convoy. Must reach the EXIT. Flagship.");
      relabelUnit(u[1], "ESCORT-1", "friend", "Line",  "BR-120 (12km)", 12000, W*0.16, L*0.36, "Close escort.");
      relabelUnit(u[2], "ESCORT-2", "friend", "Recon", "SR-90 (9km)",    9000, W*0.10, L*0.24, "Outrider — screens ahead.");
      relabelUnit(u[3], "ESCORT-3", "friend", "Line",  "BR-155 (18km)", 18000, W*0.18, L*0.30, "Rear guard.");
      relabelUnit(u[4], "RAIDER-1", "hostile", "Recon", "? (raider)", 9000, W*0.55, L*0.55, "Fast raider trying to intercept the convoy.");
      relabelUnit(u[5], "RAIDER-2", "hostile", "Line",  "? (raider)", 12000, W*0.72, L*0.40, "Second raider closing on the route.");
      placeObjective(W*0.88, L*0.62, "CONVOY EXIT");
      objName = "GET CONVOY TO EXIT";
      setFlagship(u[0]);
    }
    selected = units[0]; selectUnit(selected);
    var sd = document.getElementById("scenSel"); if (sd) sd.value = key;
    var cs = document.getElementById("cScen");
    if (cs) cs.textContent = key ? key.replace(/_/g, " ").toUpperCase() : "FREE DEPLOY";
    var co = document.getElementById("cObj"); if (co) co.textContent = objName;
    cmd._objName = objName;
    frameCamera();
    rebuildOverlays();
    syncCommandPanel();
  }

  function placeObjective(x, z, label) {
    if (cmd.objective && cmd.objective.parent) cmd.flagGroup.remove(cmd.objective);
    var f = makeFlag(x, z, "move", true);
    // make objective bigger
    f.scale.set(1.6, 1.6, 1.6);
    var span = Math.max(map.size_m[0], map.size_m[1]);
    var tag = makeTagSprite(label || "OBJECTIVE", FLAG_COL.objective, span);
    tag.position.set(0, span * 0.028, 0); tag.material.depthTest = false; tag.renderOrder = 25;
    f.add(tag);
    cmd.flagGroup.add(f);
    cmd.objective = f;
  }

  // ---- DEMO ORDERS (headless screenshots): auto-issue so movement/combat is visible ----
  function autoIssueDemoOrders() {
    if (cmd.objective) {
      var o = cmd.objective.userData;
      // order each friendly to ATTACK toward the objective so firing lines + movement render
      units.forEach(function (g) {
        if (g.userData.side === "friend" && !g.userData.cmd.ko) {
          var jx = (Math.random() - 0.5) * 600, jz = (Math.random() - 0.5) * 600;
          issueOrder(g, o.fx + jx, o.fz + jz, "attack", false);
        }
      });
    }
    // nudge everyone forward a bit so the screenshot shows motion + tracers immediately
    units.forEach(function (g) { g.userData._engageAll = true; });
    for (var i = 0; i < 90; i++) stepCommandSim(0.1);
  }

  function checkFlagshipNet() {
    if (!cmd.flagship || !cmd.on) { cmd.flagshipOffNet = false; return; }
    var off = cmd.flagship.userData.cmd.ko;
    if (off !== cmd.flagshipOffNet) { cmd.flagshipOffNet = off; syncCommandPanel(); }
  }

  function syncCommandPanel() {
    var fn = document.getElementById("cFlag");
    if (fn) { fn.textContent = cmd.flagship ? cmd.flagship.userData.name : "—"; }
    var wr = document.getElementById("cFlagWarnRow");
    if (wr) wr.style.display = (cmd.flagship && cmd.flagshipOffNet) ? "block" : "none";
    var sn = document.getElementById("cSelName");
    if (sn) sn.textContent = selected ? selected.userData.name : "— none —";
    var cn = document.getElementById("cNet");
    if (cn) cn.textContent = cmd.netStat || (show.comms ? "—" : "enable COMMS NET");
    var co = document.getElementById("cObj");
    if (co && cmd._objName) co.textContent = cmd._objName;
    // flag-type button highlight
    ["Move","Hold","Attack"].forEach(function (t) {
      var b = document.getElementById("ft" + t);
      if (b) b.classList.toggle("on", cmd.flagType === t.toLowerCase());
    });
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

    // COMMAND MODE: advance movement + combat when playing
    if (cmd.on && cmd.playing) stepCommandSim(dt);
    else if (cmd.on) updateFiringFx();   // keep tracers tidy when paused

    // pulse the selected unit's halo
    if (selected && selected.userData.haloMat) {
      var pulse = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004));
      selected.userData.haloMat.opacity = pulse;
      var s = selected.userData.mkSize * (2.0 + 0.25 * (0.5 + 0.5 * Math.sin(performance.now() * 0.004)));
      selected.userData.halo.scale.set(s, s, 1);
    }
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
