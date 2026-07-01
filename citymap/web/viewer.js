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
  var map = null, terrainMesh = null, terrainField = null, buildingsGroup = null, roadsGroup = null;
  var unitsGroup = null, overlayGroup = null, wireMesh = null;
  var windGroup = null, rainGroup = null, suburbGroup = null, compassGroup = null;
  var units = [], selected = null;
  // I1: unit-marker size + on/off (cycled by the MARKERS view button: full -> small -> off)
  var markerScale = 1.0, markersOn = true;
  // G2: threat gun for the immunity-band calc (name + max reach). "AUTO" uses the enemy on-map.
  var THREAT_GUNS = [
    { name: "AUTO (on-map enemy)", rangeM: 0 },
    { name: "SR-76 Field (76mm)",  rangeM: 2800 },
    { name: "RB-57 Light (57mm)",  rangeM: 3200 },
    { name: "BR-120 Line (120mm)", rangeM: 5000 },
    { name: "HW-105 Howitzer",     rangeM: 5500 },
    { name: "BR-155 Battle (155mm)", rangeM: 6500 },
    { name: "SG-305 Siege (305mm)", rangeM: 9500 }
  ];
  var immunityThreat = THREAT_GUNS[0];
  var show = { los: true, range: true, bld: true, roads: QS.get("roads") !== "0", wire: false, wind: false, rain: false,
               suburbs: QS.get("suburbs") !== "0", fogcull: QS.get("fogcull") === "1",
               subnames: QS.get("names") === "1",
               fire: false, slope: false, comms: QS.get("comms") === "1",
               deadzones: false, shaderange: QS.get("shadeoutrange") === "1",
               netlos: QS.get("netlos") === "1" };

  // PREVIEW MODE: "current" (default) | "arrival" — compute range+LOS+dead-zones as if the
  // selected unit were already standing on its current MOVE-flag destination.
  var previewMode = (QS.get("arrival") === "1") ? "arrival" : "current";

  // SOUND: WebAudio fire/impact SFX, gated behind a toggle. Default OFF (silent for headless
  // screenshots). ?sound=1 force-enables.
  var soundOn = (QS.get("sound") === "1");

  // SIM SPEED multiplier (1x/2x/3x/4x) — scales movement + combat update rate. Default 1x slow.
  var simSpeed = clamp(parseFloat(QS.get("speed")) || 1, 1, 4);

  // ?topo=1 shows the bare topographic terrain (no LOS/viewshed shading) — a clean map review.
  if (QS.get("topo") === "1") { show.los = false; }

  // ?slope=1 force-enables the SLOPE / trafficability overlay for screenshots.
  if (QS.get("slope") === "1") { show.slope = true; show.los = false; }

  // ?shadeoutrange=1 force-enables the SHADE OUT OF RANGE overlay for the selected unit.
  if (show.shaderange) { show.los = false; }
  // ?netlos=1 force-enables the collective NET LINE OF SIGHT overlay.
  if (show.netlos) { show.los = false; show.comms = true; }

  // ?deadzones=1 force-enables the FIRE PICTURE (direct-fire dead-zone) shading for the
  // selected unit (screenshots). It replaces the plain viewshed on the selected unit's terrain.
  if (QS.get("deadzones") === "1") { show.deadzones = true; show.los = false; }

  var lastDeadStats = null;   // {deadPct, inRange, hit} for the selected unit's dead-zone picture

  // ---- FIRE ANALYSIS state ----
  // trajectory mode: "direct" (flat, lots of dead space) | "oblique" (arced howitzer, less)
  //                  | "mortar" (near-vertical, almost none)
  var fireMode = "direct";
  var fireQS = QS.get("fire");           // ?fire=direct|indirect|mortar (oblique accepted as alias)
  if (fireQS === "oblique") fireQS = "indirect";
  if (fireQS === "direct" || fireQS === "indirect" || fireQS === "mortar") {
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
  var flyBootDone = false;   // fly-cam-on-by-default only fires once per session
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
    netStat: "", flagshipOffNet: false, fireTarget: null,
    // objective resolution: win/lose tracking for the active scenario (mirrors the Unity
    // ObjectiveSystem). holdTimer accrues while the crest is held uncontested; outcome flips
    // to "win"/"lose" and freezes the sim with a banner.
    objWin: "", objHold: 0, objHoldReq: 25, objCapM: 600, outcome: "",
  };
  var FLAG_COL = { move: 0x5fd6c6, hold: 0xe8a838, attack: 0xd75a52, objective: 0x7fe6a0 };

  // ---------- COMBAT LOG + SOUND + FX state (item G16) ----------
  var clogLines = [];          // recent combat log entries (newest last)
  var CLOG_MAX = 40;
  var audioCtx = null;         // lazily-created WebAudio context (only when SOUND is on)

  var CLOG_FULL_MAX = 300;        // full scrollable history keeps far more
  var CLOG_MINI_SHOW = 6;         // mini panel shows only the last few
  var CLOG_DECAY_S = 12;          // mini lines fade out after this many real seconds
  var clogFull = [];              // full history (for the expandable panel)
  var _clogDecayT = 0;            // throttle for mini-log time-decay re-render
  // Append a line to the combat log. kind = "" | "hit" | "ko" | "friend" for styling.
  function combatLog(html, kind) {
    var line = { html: html, kind: kind || "", t: (performance.now ? performance.now() : Date.now()) / 1000 };
    clogLines.push(line);
    if (clogLines.length > CLOG_MAX) clogLines.shift();
    clogFull.push(line);
    if (clogFull.length > CLOG_FULL_MAX) clogFull.shift();
    renderClog();
  }
  // Render both the MINI panel (recent, decaying) and the FULL scrollable panel (if open).
  function renderClog() {
    var now = (performance.now ? performance.now() : Date.now()) / 1000;
    var mini = document.getElementById("clogBody");
    if (mini) {
      // newest first; only the last CLOG_MINI_SHOW lines, and drop lines older than the decay window
      var out = "", shown = 0;
      for (var i = clogLines.length - 1; i >= 0 && shown < CLOG_MINI_SHOW; i--) {
        var age = now - (clogLines[i].t || now);
        if (age > CLOG_DECAY_S) break;                       // older ones have decayed away
        var fade = age > CLOG_DECAY_S * 0.5 ? (1 - (age - CLOG_DECAY_S * 0.5) / (CLOG_DECAY_S * 0.5)) : 1;
        out += '<div class="ln ' + clogLines[i].kind + '" style="opacity:' + fade.toFixed(2) + '">' +
               clogLines[i].html + "</div>";
        shown++;
      }
      mini.innerHTML = out || '<div class="ln" style="opacity:.4">\u2014</div>';
    }
    var full = document.getElementById("clogFullBody");
    if (full && document.getElementById("clogFull") && document.getElementById("clogFull").style.display !== "none") {
      var fout = "";
      for (var j = clogFull.length - 1; j >= 0; j--)
        fout += '<div class="ln ' + clogFull[j].kind + '">' + clogFull[j].html + "</div>";
      full.innerHTML = fout;
    }
  }

  // Generate a short WebAudio "boom" (fire) or "thud" (impact). No asset files. Gated by soundOn.
  function playSfx(kind) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var now = audioCtx.currentTime;
      if (kind === "fire") {
        // low oscillator burst + noise transient = a muffled gun "boom"
        var osc = audioCtx.createOscillator(); var g = audioCtx.createGain();
        osc.type = "sawtooth"; osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(46, now + 0.18);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.connect(g).connect(audioCtx.destination); osc.start(now); osc.stop(now + 0.24);
        addNoiseBurst(now, 0.10, 0.07);
      } else { // impact thud
        var o2 = audioCtx.createOscillator(); var g2 = audioCtx.createGain();
        o2.type = "square"; o2.frequency.setValueAtTime(90, now);
        o2.frequency.exponentialRampToValueAtTime(38, now + 0.12);
        g2.gain.setValueAtTime(0.0001, now);
        g2.gain.exponentialRampToValueAtTime(0.11, now + 0.008);
        g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        o2.connect(g2).connect(audioCtx.destination); o2.start(now); o2.stop(now + 0.18);
        addNoiseBurst(now, 0.06, 0.05);
      }
    } catch (e) { /* audio unavailable — ignore */ }
  }
  function addNoiseBurst(now, dur, vol) {
    var n = Math.floor(audioCtx.sampleRate * dur);
    var buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = audioCtx.createBufferSource(); src.buffer = buf;
    var g = audioCtx.createGain(); g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(g).connect(audioCtx.destination); src.start(now);
  }

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
    [terrainMesh, buildingsGroup, roadsGroup, unitsGroup, overlayGroup, wireMesh, windGroup, rainGroup, suburbGroup, suburbNameGroup, fireGroup,
     compassGroup, cmd.flagGroup, cmd.orderGroup, cmd.fxGroup].forEach(function (o) {
      if (o) { scene.remove(o); }
    });
    terrainMesh = buildingsGroup = roadsGroup = unitsGroup = overlayGroup = wireMesh = null;
    windGroup = rainGroup = suburbGroup = suburbNameGroup = fireGroup = compassGroup = null;
    suburbMarkers = [];
    cmd.flagGroup = cmd.orderGroup = cmd.fxGroup = null;
    cmd.flagship = null; cmd.selectedSet = []; cmd.objective = null;
    buildingMeshes = []; buildingChunks = [];
    units = []; selected = null;
    document.getElementById("unit").style.display = "none";
  }

  var vshed = null; // viewshed visibility array (0..1 per vertex)

  function buildScene() {
    clearScene();
    var t = map.terrain, res = t.res, cell = t.cell_m;
    var W = map.size_m[0], L = map.size_m[1];
    // A1 FIX — EAST-WEST MIRROR. The source frame is +X=east/+Z=north/+Y=up (right-handed), which
    // renders a north-up map with EAST on the LEFT (compass reads N-W-S-E, wrong). We mirror the
    // terrain HEIGHTMAP columns ONCE here so every grid consumer (mesh, topo texture, heightAt,
    // viewshed, LOS, canHit, slope) flips together; then world-placed entities (units, suburbs,
    // roads, buildings, flags) flip their world-X via MX(), and bearings negate east. Net result:
    // north-up map now reads N-E-S-W clockwise, east on the RIGHT — true map convention.
    if (!t._mirrored) {
      var src = t.heights, Hm = new Float32Array(src.length);
      for (var zz = 0; zz < res; zz++)
        for (var xx = 0; xx < res; xx++)
          Hm[zz * res + xx] = src[zz * res + (res - 1 - xx)];
      t.heights = Hm; t._mirrored = true;
      // mirror geo-anchored X of buildings + roads ONCE to match (idempotent via the flag).
      if (map.buildings) for (var bi = 0; bi < map.buildings.length; bi++) {
        var bp = map.buildings[bi].poly; if (bp) for (var vi = 0; vi < bp.length; vi++) bp[vi][0] = W - bp[vi][0];
      }
      if (map.roads) for (var ri = 0; ri < map.roads.length; ri++) {
        var rp = map.roads[ri].path;
        if (rp) for (var pi = 0; pi < rp.length; pi++) rp[pi][0] = W - rp[pi][0];
      }
    }
    var H = t.heights;
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

    // ----- roads (OSM highways draped on the terrain) -----
    buildRoads();

    // ----- weather overlays (wind arrows, rain) + readout -----
    buildWeather();

    // ----- suburb / locality overlay (labels + boundary markers) -----
    buildSuburbs();

    // ----- TRUE-NORTH compass edge labels (N/S/E/W at the map edges) -----
    buildCompass();

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

    // FREE/FLY CAM ON BY DEFAULT (all modes incl. scenarios) so WASD + wheel-zoom work immediately.
    // ?fly=0 keeps orbit-by-default (e.g. some screenshots want a fixed framing).
    if (QS.get("fly") !== "0" && !flyBootDone) {
      flyBootDone = true;
      setFly(true);
    }

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

  // ----- ROADS: OSM highways draped over the terrain -----
  // Bigger roads (motorway/trunk/primary) draw wider & brighter; residential thin & dim.
  var ROAD_STYLE = {
    motorway:      { w: 26, c: 0xc8a24a }, "motorway_link": { w: 16, c: 0xc8a24a },
    trunk:         { w: 22, c: 0xc09a48 }, "trunk_link":    { w: 14, c: 0xc09a48 },
    primary:       { w: 18, c: 0xb08a40 }, "primary_link":  { w: 12, c: 0xb08a40 },
    secondary:     { w: 13, c: 0x9a8048 }, "secondary_link":{ w: 10, c: 0x9a8048 },
    tertiary:      { w: 9,  c: 0x86764a }, "tertiary_link": { w: 8,  c: 0x86764a },
    residential:   { w: 5,  c: 0x6f6a52 }, unclassified:    { w: 5, c: 0x6f6a52 },
    living_street: { w: 4,  c: 0x645f4c }
  };
  function buildRoads() {
    roadsGroup = new THREE.Group();
    var roads = map.roads || [];
    if (!roads.length) { roadsGroup.visible = false; scene.add(roadsGroup); return; }
    // One mesh per style (group thin/wide) using ribbon strips draped on the terrain.
    var byStyle = {};
    for (var i = 0; i < roads.length; i++) {
      var rd = roads[i];
      var st = ROAD_STYLE[rd.kind] || ROAD_STYLE.residential;
      var key = rd.kind;
      if (!byStyle[key]) byStyle[key] = { verts: [], st: st };
      ribbon(rd.path, st.w, byStyle[key].verts);
    }
    Object.keys(byStyle).forEach(function (k) {
      var s = byStyle[k];
      if (!s.verts.length) return;
      var g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(s.verts, 3));
      g.computeVertexNormals();
      var m = new THREE.MeshBasicMaterial({ color: s.st.c, transparent: true, opacity: 0.85,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      roadsGroup.add(new THREE.Mesh(g, m));
    });
    roadsGroup.visible = show.roads;
    scene.add(roadsGroup);

    // Build a flat ribbon (two triangles per segment) along a polyline, draped +1.5m on terrain.
    function ribbon(path, width, out) {
      var hw = width * 0.5;
      for (var j = 0; j < path.length - 1; j++) {
        var ax = path[j][0], az = path[j][1], bx = path[j + 1][0], bz = path[j + 1][1];
        // skip segments entirely outside the map
        if ((ax < -50 && bx < -50) || (ax > map.size_m[0] + 50 && bx > map.size_m[0] + 50)) continue;
        var dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 0.5) continue;
        var nx = -dz / len * hw, nz = dx / len * hw;   // perpendicular offset
        var aly = heightAt(ax, az) + 1.5, bly = heightAt(bx, bz) + 1.5;
        var p1 = [ax + nx, aly, az + nz], p2 = [ax - nx, aly, az - nz];
        var p3 = [bx + nx, bly, bz + nz], p4 = [bx - nx, bly, bz - nz];
        out.push(p1[0],p1[1],p1[2], p2[0],p2[1],p2[2], p3[0],p3[1],p3[2]);
        out.push(p2[0],p2[1],p2[2], p4[0],p4[1],p4[2], p3[0],p3[1],p3[2]);
      }
    }
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
    return dirs[Math.round((((deg % 360) + 360) % 360 / 22.5)) % 16];
  }

  // ---------- COMPASS / BEARING HELPERS ----------
  // World frame: +X = EAST, +Z = NORTH, -X = WEST, -Z = SOUTH (true to real geography).
  // Bearing from a direction vector (dx = east component, dz = north component):
  //   bearing = (atan2(east, north) in degrees + 360) % 360 ; 0=N, 90=E, 180=S, 270=W.
  function bearingFromVec(dx, dz) {
    // A1 mirror: world-X now increases WEST on screen, so EAST is -X. Negate dx so bearings stay
    // true (0=N, 90=E, 180=S, 270=W) in the mirrored frame.
    return (Math.atan2(-dx, dz) * 180 / Math.PI + 360) % 360;
  }
  // 8-point compass label from a bearing in degrees (0=N,45=NE,...).
  function compass8(deg) {
    var dirs = ["N","NE","E","SE","S","SW","W","NW"];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }
  function bearingTxt(deg) {
    var b = Math.round(((deg % 360) + 360) % 360);
    return ("00" + b).slice(-3) + " " + compass8(b);
  }

  // ---------- SUBURB / LOCALITY OVERLAY ----------
  // Project the hardcoded SUBURBS list into the map's local-metre frame and place a floating
  // canvas-sprite label + a small ground marker at each locality that falls inside the map.
  // SUBURBS as NEON BORDERS (item E). Each in-map locality gets a small glowing neon ring/disc
  // marker on the terrain (Eva-neon cyan, alternating magenta), plus an optional big NAME label
  // gated behind the separate SUBURB NAMES toggle (suburbNameGroup, default off). The neon ring
  // can show an OBJECTIVE state (amber=HOLD, green=PROTECT) so scenarios can flag a site.
  // suburbMarkers[] keeps a handle to each ring so we can recolour objective state and so the
  // markers PERSIST for the whole session (never wiped by overlay rebuilds — they live in their
  // own groups, separate from overlayGroup).
  var suburbMarkers = [];        // [{name, x, z, ring, glowMat, baseCol, objState}]
  var suburbNameGroup = null;    // big name labels (own toggle)
  function buildSuburbs() {
    suburbGroup = new THREE.Group();
    suburbGroup.visible = show.suburbs;
    scene.add(suburbGroup);
    suburbNameGroup = new THREE.Group();
    suburbNameGroup.visible = show.suburbs && show.subnames;
    scene.add(suburbNameGroup);
    suburbMarkers = [];

    if (!map || !map.bbox) return;
    var west = map.bbox[0], south = map.bbox[1];
    var midlat = (south + map.bbox[3]) / 2;
    var mPerLon = 111320 * Math.cos(midlat * Math.PI / 180);
    var mPerLat = 111320;
    var W = map.size_m[0], L = map.size_m[1];
    var span = Math.max(W, L);
    var lift = Math.max(150, span * 0.024);   // float NAME labels above the terrain
    // neon ring radius: small + tasteful, scales with the map
    var ringR = Math.max(70, span * 0.011);

    // neon palette: cyan + magenta alternate for an Eva-neon read; objective states override.
    var NEON = [0x35e0d0, 0xe65cc8];

    var placed = 0;

    // B1: REAL BOUNDARY POLYGONS. If the map carries suburb boundary rings, draw them as neon
    // OUTLINE loops draped on the terrain (their true admin borders), with the name at the
    // centroid. Falls back to the hardcoded centroid rings only if no polygons are present.
    if (map.suburbs && map.suburbs.length) {
      for (var si = 0; si < map.suburbs.length; si++) {
        var sub = map.suburbs[si];
        var neonC = NEON[placed % 2];
        var drewRing = false;
        for (var ri = 0; ri < sub.rings.length; ri++) {
          var ring = sub.rings[ri];
          var pts = [];
          for (var pi = 0; pi < ring.length; pi++) {
            var rx = MX(ring[pi][0]), rz = ring[pi][1];               // A1 east-mirror
            if (rx < -200 || rx > W + 200 || rz < -200 || rz > L + 200) continue;
            pts.push(new THREE.Vector3(clamp(rx, 0, W), heightAt(clamp(rx, 0, W), clamp(rz, 0, L)) + 8, clamp(rz, 0, L)));
          }
          if (pts.length < 3) continue;
          // bold neon boundary: a bright thin loop + a faint wider glow underlay
          var geo = new THREE.BufferGeometry().setFromPoints(pts);
          suburbGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: neonC, transparent: true, opacity: 0.85, depthTest: false })));
          var geo2 = new THREE.BufferGeometry().setFromPoints(pts.map(function (p) {
            return new THREE.Vector3(p.x, p.y + span * 0.001, p.z); }));
          suburbGroup.add(new THREE.Line(geo2, new THREE.LineBasicMaterial({
            color: neonC, transparent: true, opacity: 0.28, depthTest: false })));
          drewRing = true;
        }
        if (!drewRing) continue;
        // centroid for the name label + objective marker (mirror the stored centroid X)
        var cx = MX(sub.centroid ? sub.centroid[0] : ringMidX(sub));
        var cz = sub.centroid ? sub.centroid[1] : 0;
        cx = clamp(cx, 0, W); cz = clamp(cz, 0, L);
        var cgy = heightAt(cx, cz);
        var spr = makeLabelSprite(sub.name, span);
        spr.position.set(cx, cgy + lift, cz);
        suburbNameGroup.add(spr);
        suburbMarkers.push({ name: sub.name, x: cx, z: cz, ringR: ringR,
          ring: null, glow: null, glowMat: null, ringMat: null, baseCol: neonC, objState: null });
        placed++;
      }
      suburbGroup.userData = { placed: placed };
      return;
    }

    // fallback: hardcoded centroid rings (older maps without boundary polygons)
    for (var i = 0; i < SUBURBS.length; i++) {
      var s = SUBURBS[i];
      var x = MX((s[1] - west) * mPerLon); // east metres -> MIRRORED world-X (A1)
      var z = (s[2] - south) * mPerLat;    // north metres from origin
      if (x < 0 || x > W || z < 0 || z > L) continue;   // outside this map
      var gy = heightAt(x, z);
      var neon = NEON[placed % 2];

      var mk = makeSuburbMarker(x, gy, z, ringR, neon);
      suburbGroup.add(mk.group);

      var spr2 = makeLabelSprite(s[0], span);
      spr2.position.set(x, gy + lift, z);
      suburbNameGroup.add(spr2);

      suburbMarkers.push({ name: s[0], x: x, z: z, ringR: ringR,
        ring: mk.ring, glow: mk.glow, glowMat: mk.glowMat, ringMat: mk.ringMat,
        baseCol: neon, objState: null });
      placed++;
    }
    suburbGroup.userData = { placed: placed };
  }
  function ringMidX(sub) {
    var r = sub.rings[0]; var sx = 0; for (var i = 0; i < r.length; i++) sx += r[i][0]; return sx / r.length;
  }

  // Build one neon suburb marker: a thin glowing ring + a soft inner glow disc + a small
  // upright pip, on the terrain. Returns handles so its colour can switch for objective state.
  function makeSuburbMarker(x, gy, z, ringR, colInt) {
    var grp = new THREE.Group();
    grp.position.set(x, 0, z);
    // thin bright neon ring (two stacked ring meshes for a faux-bloom outline)
    var ringMat = new THREE.MeshBasicMaterial({ color: colInt, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false });
    var ring = new THREE.Mesh(new THREE.RingGeometry(ringR * 0.86, ringR, 40), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = gy + 4; ring.renderOrder = 11;
    grp.add(ring);
    // soft glow halo (wider, faint) — the neon "bloom"
    var glowMat = new THREE.MeshBasicMaterial({ color: colInt, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false });
    var glow = new THREE.Mesh(new THREE.RingGeometry(ringR * 0.55, ringR * 1.5, 40), glowMat);
    glow.rotation.x = -Math.PI / 2; glow.position.y = gy + 3; glow.renderOrder = 10;
    grp.add(glow);
    // tiny centre pip
    var pip = new THREE.Mesh(new THREE.CircleGeometry(ringR * 0.12, 16),
      new THREE.MeshBasicMaterial({ color: colInt, transparent: true, opacity: 0.9, depthWrite: false }));
    pip.rotation.x = -Math.PI / 2; pip.position.y = gy + 5; pip.renderOrder = 12;
    grp.add(pip);
    return { group: grp, ring: ring, ringMat: ringMat, glow: glow, glowMat: glowMat, pip: pip };
  }

  // Mark a suburb as an OBJECTIVE site: state = "hold" (amber) | "protect" (green) | null (neon).
  // Scenarios / command mode can call this to flag a locality as a hold/protect site (item E9).
  function setSuburbObjective(nameOrIdx, state) {
    var m = null;
    if (typeof nameOrIdx === "number") m = suburbMarkers[nameOrIdx];
    else m = suburbMarkers.filter(function (s) { return s.name === nameOrIdx; })[0];
    if (!m) return null;
    m.objState = state;
    var col = state === "hold" ? 0xe8a838 : state === "protect" ? 0x7fe6a0 : m.baseCol;
    if (m.ringMat) {   // centroid-ring markers; polygon-boundary markers have no ring mats
      m.ringMat.color.setHex(col); m.glowMat.color.setHex(col);
      m.ringMat.opacity = state ? 1.0 : 0.95;
      m.glowMat.opacity = state ? 0.30 : 0.16;
    }
    return m;
  }

  // ---------- TRUE-NORTH COMPASS EDGE LABELS ----------
  // Big muted-amber N / S / E / W sprites at the OUTSIDE edge midpoints of the terrain.
  // World frame: +X=EAST (x=W), -X=WEST (x=0), +Z=NORTH (z=L), -Z=SOUTH (z=0). Because the
  // map is built from real lon/lat this is TRUE north — N always marks real geographic north.
  // Sprites billboard, so they stay readable while the camera orbits, but their world positions
  // are fixed, so they correctly track the map's true orientation.
  function buildCompass() {
    compassGroup = new THREE.Group();
    scene.add(compassGroup);
    if (!map) return;
    var W = map.size_m[0], L = map.size_m[1];
    var span = Math.max(W, L);
    var out = span * 0.045;                  // push the label slightly OUTSIDE the map edge
    var lift = Math.max(180, span * 0.030);  // float above the terrain at the edge
    // [text, x, z]  — placed just beyond each edge midpoint
    var marks = [
      ["N", W / 2,      L + out],   // +Z edge = NORTH
      ["S", W / 2,      -out    ],  // -Z edge = SOUTH
      // A1 mirror: world-X increases WEST now, so the +X (x=W) edge is WEST and -X (x=0) is EAST.
      ["W", W + out,    L / 2   ],  // +X edge = WEST
      ["E", -out,       L / 2   ],  // -X edge = EAST
    ];
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      var spr = makeCompassSprite(m[0], span);
      // ground height at the clamped edge point so the label floats a sensible height
      var gx = clamp(m[1], 0, W), gz = clamp(m[2], 0, L);
      spr.position.set(m[1], heightAt(gx, gz) + lift, m[2]);
      compassGroup.add(spr);
      // faint tether down toward the edge so the label reads as "this edge"
      var tg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(m[1], heightAt(gx, gz) + lift, m[2]),
        new THREE.Vector3(m[1], heightAt(gx, gz) + 10, m[2])]);
      compassGroup.add(new THREE.Line(tg, new THREE.LineBasicMaterial({
        color: 0xb0822c, transparent: true, opacity: 0.30 })));
    }
  }

  // Big bold cardinal-letter sprite (muted amber, Eva style). Larger than suburb labels so the
  // N/S/E/W read clearly at the default camera framing.
  function makeCompassSprite(letter, span) {
    var S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    // round-ish dark backing disc with an amber rim
    ctx.beginPath(); ctx.arc(S/2, S/2, S/2 - 10, 0, Math.PI*2);
    ctx.fillStyle = "rgba(13,17,16,0.78)"; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = "rgba(176,130,44,0.85)"; ctx.stroke();
    ctx.font = "bold 168px DejaVu Sans Mono, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = (letter === "N") ? "rgba(232,168,56,0.98)" : "rgba(176,130,44,0.95)";
    ctx.fillText(letter, S/2, S/2 + 8);
    var tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    var spr = new THREE.Sprite(mat);
    spr.renderOrder = 22;
    var sz = Math.max(420, span * 0.060);   // big and clearly visible
    spr.scale.set(sz, sz, 1);
    return spr;
  }

  // ---------- HUD COMPASS ROSE (DOM overlay) ----------
  // A fixed N-up 2D dial in the top-right. A muted-amber needle points the way the CAMERA is
  // looking (its ground heading relative to TRUE north) so the player always knows orientation
  // even zoomed/rotated. Bearing 0=N, 90=E, 180=S, 270=W — consistent with the wind readout.
  function cameraHeadingDeg() {
    // direction the camera is looking, projected onto the ground (x=east, z=north)
    var dir;
    if (fly.on) {
      dir = flyForward();
    } else if (controls) {
      dir = new THREE.Vector3().subVectors(controls.target, camera.position);
    } else { return 0; }
    return bearingFromVec(dir.x, dir.z);
  }
  function drawCompassRose(canvas, headingDeg, opts) {
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height, cx = w/2, cy = h/2, R = Math.min(cx, cy) - 4;
    ctx.clearRect(0, 0, w, h);
    var ringCol = opts && opts.ring || "rgba(120,140,130,0.35)";
    var tickCol = "rgba(120,140,130,0.55)";
    var labCol  = "rgba(176,130,44,0.92)";   // muted amber
    // outer ring
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
    ctx.strokeStyle = ringCol; ctx.lineWidth = 1.5; ctx.stroke();
    // cardinal ticks + letters (N up). The DIAL is fixed; the needle rotates.
    var cards = [["N",0],["E",90],["S",180],["W",270]];
    var fs = Math.max(9, Math.round(R * 0.34));
    ctx.font = "bold " + fs + "px DejaVu Sans Mono, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i][1] * Math.PI/180;          // 0=N -> up
      var sx = cx + Math.sin(a) * R, sy = cy - Math.cos(a) * R;
      var ix = cx + Math.sin(a) * (R - 6), iy = cy - Math.cos(a) * (R - 6);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ix, iy);
      ctx.strokeStyle = tickCol; ctx.lineWidth = 1.5; ctx.stroke();
      var lx = cx + Math.sin(a) * (R - fs*0.8), ly = cy - Math.cos(a) * (R - fs*0.8);
      ctx.fillStyle = (cards[i][0] === "N") ? "rgba(232,168,56,0.98)" : labCol;
      ctx.fillText(cards[i][0], lx, ly);
    }
    // needle pointing along the heading
    var ha = headingDeg * Math.PI/180;
    var nx = cx + Math.sin(ha) * (R - 10), ny = cy - Math.cos(ha) * (R - 10);
    var bx = cx - Math.sin(ha) * (R*0.45), by = cy + Math.cos(ha) * (R*0.45);
    // tail (dim)
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by);
    ctx.strokeStyle = "rgba(93,109,100,0.7)"; ctx.lineWidth = 2; ctx.stroke();
    // head (amber arrow)
    var headCol = opts && opts.needle || "rgba(232,168,56,0.95)";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nx, ny);
    ctx.strokeStyle = headCol; ctx.lineWidth = 2.5; ctx.stroke();
    // arrowhead
    var perp = ha + Math.PI/2, ah = R*0.16;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(nx - Math.sin(ha)*ah + Math.sin(perp)*ah*0.6, ny + Math.cos(ha)*ah - Math.cos(perp)*ah*0.6);
    ctx.lineTo(nx - Math.sin(ha)*ah - Math.sin(perp)*ah*0.6, ny + Math.cos(ha)*ah + Math.cos(perp)*ah*0.6);
    ctx.closePath(); ctx.fillStyle = headCol; ctx.fill();
    // hub
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI*2);
    ctx.fillStyle = "rgba(176,130,44,0.9)"; ctx.fill();
  }
  function updateCompassHud() {
    var hd = cameraHeadingDeg();
    drawCompassRose(document.getElementById("compassCanvas"), hd);
    var el = document.getElementById("compassBrg");
    if (el) el.textContent = ("00" + Math.round(hd)).slice(-3) + "\u00B0 " + compass8(hd);
  }

  // ---------- UNIT-PANEL FACING COMPASS ----------
  // Bearing of the selected unit's facing (g.rotation.y -> ground heading). Also, if the unit has
  // a current order/target, show the bearing+range to it. Consistent with the wind readout.
  function unitFacingDeg(g) {
    // The hull is built with the prow along +Z (local north). rotation.y rotates that facing.
    // A rotation of ry about Y maps local +Z to world (sin ry, cos ry) in (x,z) -> bearing = ry.
    var ry = g.rotation.y || 0;
    return (ry * 180 / Math.PI % 360 + 360) % 360;
  }
  // Find a bearing+range to the unit's current objective flag (command mode) or remembered target.
  function unitTargetInfo(g) {
    var d = g.userData;
    var tx = null, tz = null;
    if (d.cmd && d.cmd.flags && d.cmd.flags.length) {
      var idx = Math.min(d.cmd.targetIdx || 0, d.cmd.flags.length - 1);
      var f = d.cmd.flags[idx].userData;
      tx = f.fx; tz = f.fz;
    } else if (cmd.target && cmd.target !== g) {
      tx = cmd.target.userData.x; tz = cmd.target.userData.z;
    }
    if (tx == null) return null;
    var dx = tx - d.x, dz = tz - d.z;
    var rng = Math.sqrt(dx*dx + dz*dz);
    return { brg: bearingFromVec(dx, dz), rng: rng };
  }
  function updateUnitFacing(g) {
    var faceCanvas = document.getElementById("uFaceCanvas");
    var faceEl = document.getElementById("uFacing");
    var tgtRow = document.getElementById("uTgtRow");
    var tgtEl  = document.getElementById("uTgtBrg");
    if (!g) return;
    var fdeg = unitFacingDeg(g);
    if (faceEl) faceEl.textContent = ("00" + Math.round(fdeg)).slice(-3) + "\u00B0 " + compass8(fdeg);
    var ti = unitTargetInfo(g);
    if (tgtRow) tgtRow.style.display = ti ? "block" : "none";
    if (ti && tgtEl) tgtEl.textContent = bearingTxt(ti.brg) + ", " + (ti.rng/1000).toFixed(1) + "km";
    // draw the dial: amber needle = facing; teal arrow = bearing to target (if any)
    if (faceCanvas) {
      drawCompassRose(faceCanvas, fdeg);
      if (ti) {
        // overlay a teal target-bearing tick on the same dial
        var ctx = faceCanvas.getContext("2d");
        var w = faceCanvas.width, h = faceCanvas.height, cx = w/2, cy = h/2, R = Math.min(cx,cy)-4;
        var a = ti.brg * Math.PI/180;
        var nx = cx + Math.sin(a)*(R-8), ny = cy - Math.cos(a)*(R-8);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(nx, ny);
        ctx.strokeStyle = "rgba(95,214,198,0.9)"; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.beginPath(); ctx.arc(nx, ny, 2.4, 0, Math.PI*2);
        ctx.fillStyle = "rgba(95,214,198,0.95)"; ctx.fill();
      }
    }
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
    // supersample the texture above grid res for crisp, clean topographic contours (item D).
    // 513-res grid -> up to 4096px bake (8x grid) for thin, anti-aliased contour lines.
    // ?tex=2048|3072|4096 overrides (lower = faster on weak GPUs / headless screenshots).
    var texQS = parseInt(QS.get("tex"), 10);
    var TSmax = (texQS === 2048 || texQS === 3072 || texQS === 4096) ? texQS : 4096;
    var TS = Math.min(TSmax, (res - 1) * 8);
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
    var contourStep = 10;                       // metres between contour lines
    var texelM = (res - 1) * cell / (TS - 1);   // ground metres per output texel
    // line half-width in METRES of elevation, i.e. how close (in height) a texel must be to a
    // contour multiple to be drawn. Using a CONSTANT screen-space width (gradient-normalised)
    // gives uniformly thin, crisp lines instead of fat fuzzy bands on steep ground.
    var lineTexels = 1.05;                       // ~1px thin contour at full bake
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
          shade = 0.42 + 0.92*shade;   // light/shadow spread
          col=[col[0]*shade, col[1]*shade, col[2]*shade];
          // ---- CRISP CONTOURS ----
          // distance (in metres of elevation) to the nearest contour multiple
          var band = Math.abs(((h % contourStep)+contourStep)%contourStep);
          var near = Math.min(band, contourStep-band);
          // local elevation change PER TEXEL = |grad| * texelM. Convert the desired pixel
          // line-width into the equivalent elevation band so the line stays ~constant on screen.
          var gradM = Math.hypot(hx, hz) / (2 * e * cell);     // rise/run (dimensionless)
          var dHperTexel = gradM * texelM + 1e-4;              // metres of height per output texel
          var halfBandM = lineTexels * dHperTexel * 0.5;
          // anti-alias: smooth ramp across ~1 texel of the line edge
          var aa = dHperTexel * 0.9;
          var lineAmt = 1 - clamp((near - halfBandM) / Math.max(aa, 1e-4), 0, 1);
          if (lineAmt > 0.01) {
            var major = Math.round(h/contourStep)%5===0;   // index line every 50 m
            // darken toward a contour ink colour; major lines a touch darker/thicker
            var ink = major ? 0.34 : 0.60;
            var f = 1 - lineAmt * (1 - ink);
            col=[col[0]*f, col[1]*f, col[2]*f];
          }
        }
        var o=(py*TS+px)*4;
        d[o]=col[0]|0; d[o+1]=col[1]|0; d[o+2]=col[2]|0; d[o+3]=255;
      }
    }
    ctx.putImageData(img,0,0);
    var tex=new THREE.CanvasTexture(cv);
    tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
    var maxAniso = (renderer && renderer.capabilities) ? renderer.capabilities.getMaxAnisotropy() : 8;
    tex.anisotropy = Math.min(16, maxAniso || 8);
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.needsUpdate=true;
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
    var o = overlayOrigin(u);                                       // CURRENT or ARRIVAL origin
    var ex = o.x, ez = o.z, ey = o.eye + 8;
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

  // F2: closed-form ballistic firing solution (vacuum model, matches the game's Ballistics).
  //   Muzzle speed v hits horizontal range R at two elevations: sin(2θ)=Rg/v². The LOW root is
  //   direct/indirect flat fire; the HIGH root (90-θ_low) is high-angle/mortar. Returns the gun
  //   quadrant elevation (QE), time of flight, apex height, angle of fall and a "charge" band.
  var G = 9.81;
  function fireSolution(v, rangeM, highAngle) {
    var s = clamp(rangeM * G / (v * v), 0, 1);      // sin(2θ)
    var thLow = 0.5 * Math.asin(s);                 // low elevation root (rad)
    var th = highAngle ? (Math.PI / 2 - thLow) : thLow;
    var tof = (2 * v * Math.sin(th)) / G;           // time of flight (s)
    var apex = (v * Math.sin(th)) * (v * Math.sin(th)) / (2 * G);   // max ordinate (m)
    return {
      elevDeg: th * 180 / Math.PI,                  // gun quadrant elevation (QE)
      fallDeg: th * 180 / Math.PI,                  // angle of fall (symmetric in vacuum)
      tof: tof, apex: apex, v: v,
      chargeBand: chargeForRange(rangeM)            // propellant zone label
    };
  }
  // A coarse "charge / propellant zone" label from the fraction of max range (like real zone charges).
  function chargeForRange(rangeM) {
    return null;   // filled per-unit in the panel (needs the gun's max range)
  }
  function chargeZone(frac) {
    return frac > 0.8 ? "CHARGE 7 (full)" : frac > 0.6 ? "CHARGE 5" : frac > 0.4 ? "CHARGE 4"
         : frac > 0.2 ? "CHARGE 3" : "CHARGE 2 (low)";
  }
  // Build the world-space parabola points from a firing unit to a target point, on the chosen arc.
  // Returns an array of THREE.Vector3 along the trajectory (draped over its true arc height).
  function trajectoryPoints(sx, sy, sz, tx, ty, tz, highAngle, steps) {
    steps = steps || 26;
    var dx = tx - sx, dz = tz - sz, horiz = Math.hypot(dx, dz);
    var out = [];
    // parabola: y follows chord + a bow; bow from the solved apex if we can, else a fraction of range.
    var d = terrainField;
    var rangeM = horiz;
    var v = muzzleSpeed(Math.max(rangeM, 500));
    var sol = fireSolution(v, rangeM, highAngle);
    var apex = Math.min(sol.apex, rangeM * (highAngle ? 0.9 : 0.28)) || rangeM * 0.2;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var px = sx + dx * t, pz = sz + dz * t;
      var chordY = sy + (ty - sy) * t;
      var bowY = 4 * apex * t * (1 - t);            // parabolic bow above the chord
      out.push(new THREE.Vector3(px, chordY + bowY, pz));
    }
    return out;
  }

  // Per-trajectory tuning.  min-range fraction = inner dead zone for high-angle lobbers.
  function trajParams(mode) {
    // Doctrinal trajectories (ref docs/wiki/ref/ARTILLERY_DOCTRINE.md §1–2):
    //   DIRECT    flat, needs LOS, LARGE dead space behind crests.
    //   INDIRECT  arced howitzer, needs a spotter, SMALLER dead space, full range.
    //   HIGH-ANGLE/MORTAR  steep near-vertical lob: MINIMAL dead space (drops into defilade)
    //                      but MUCH SHORTER max range (E2) — a short-reach specialist.
    if (mode === "mortar" || mode === "highangle")
                            return { minFrac: 0.04, reachMul: 0.45, high: true,  arcGain: 1.10, label: "HIGH-ANGLE / MORTAR" };
    if (mode === "indirect" || mode === "oblique")
                            return { minFrac: 0.02, reachMul: 0.96, high: true,  arcGain: 0.07, label: "INDIRECT" };
    return                         { minFrac: 0.00, reachMul: 0.90, high: false, arcGain: 0.00, label: "DIRECT" };
  }

  // Can a shell of muzzle speed v, fired on the chosen arc, reach (clear all intervening
  // terrain to) the target cell?  Returns true = hittable.
  //   DIRECT  : flat LOS must be clear (exactly the viewshed test) -> big dead space.
  //   OBLIQUE : parabolic arc rising then falling; terrain must stay UNDER the arc. The arc
  //             apex is raised by arcGain so it clears low ridges the flat shot can't, but a
  //             tall close mask still blocks it -> some dead space remains.
  //   MORTAR  : near-vertical plunge; only the launch corridor near the gun + the cell column
  //             matter, so almost nothing masks it -> dead space ~ 0 (only min/max range).
  function canHit(ex, ez, ey, tx, tz, ty, res, H, cell, rz, v, p, maxRangeM) {
    var dx = tx - ex, dz = tz - ez;
    var horiz = Math.hypot(dx, dz);
    if (horiz < cell) return true;

    // HARD MAX-RANGE CAP (item C4): no trajectory — direct, oblique or mortar — can reach
    // beyond the gun's max range. Indirect fire only changes the ARC to clear terrain WITHIN
    // range; it never increases the maximum distance. A target beyond range is simply unreachable.
    if (maxRangeM != null && horiz > maxRangeM) return false;

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
          var ok = canHit(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz, v, p, (d.rangeM > 0 ? d.rangeM : 14000));
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
    var o = overlayOrigin(u);                            // CURRENT or ARRIVAL origin
    var ex = o.x, ez = o.z, ey = o.eye + 8;
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
          var ok = canHit(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz, v, p, (d.rangeM > 0 ? d.rangeM : 14000));
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

  // ---------- PREVIEW POSITION (CURRENT vs ARRIVAL) ----------
  // Returns the {x, z, eye} the overlays should be computed FROM for a unit. In ARRIVAL mode we
  // use the unit's current MOVE-flag DESTINATION (last flag) + its eye height there, so the
  // player can preview what it'll see / hit on arrival (item F11). CURRENT = where it stands now.
  function overlayOrigin(u) {
    var d = u.userData;
    if (previewMode === "arrival" && d.cmd && d.cmd.flags && d.cmd.flags.length) {
      var f = d.cmd.flags[d.cmd.flags.length - 1].userData;
      var ax = clamp(f.fx, 0, map.size_m[0]), az = clamp(f.fz, 0, map.size_m[1]);
      var ay = heightAt(ax, az) + (d._eyeOff || 8);
      return { x: ax, z: az, eye: ay, arrival: true };
    }
    return { x: d.x, z: d.z, eye: d.eye, arrival: false };
  }

  // ---------- SHADE OUT OF RANGE (item F10) ----------
  // For the selected unit, HEAVILY dim everything OUTSIDE its gun range so the in-range area
  // stands out. Combined with dead-zones: in-range + hittable = green, in-range + masked = red,
  // out-of-range = heavy dim. Honours the CURRENT/ARRIVAL preview origin.
  function computeShadeOutOfRange(u) {
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var colors = terrainMesh.geometry.attributes.color;
    var d = u.userData;
    if (!(d.rangeM > 0)) { if (show.los) computeViewshed(u); else clearViewshed(); return; }
    var p = trajParams("direct");
    var o = overlayOrigin(u);
    var maxR = d.rangeM * fogFactor();
    var v = muzzleSpeed(d.rangeM);
    var ex = o.x, ez = o.z, ey = o.eye + 8;
    var rz = (map.size_m[1] / (res - 1));
    var inRange = 0, hit = 0;
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        var wx = xi * cell, wz = zi * rz;
        var dist = Math.hypot(wx - ex, wz - ez);
        var r, gg, bb;
        if (dist > maxR) {
          // OUT OF RANGE: heavy shade-out (dark, cold) so the in-range area pops
          r = 0.16; gg = 0.18; bb = 0.21;
        } else {
          inRange++;
          var ok = canHit(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz, v, p, d.rangeM);
          if (ok) {
            hit++;
            var near = clamp(1 - dist / maxR, 0, 1);
            r = 0.42 + near * 0.16; gg = 0.76 + near * 0.30; bb = 0.48 + near * 0.12;
          } else {
            r = 1.05; gg = 0.34; bb = 0.30;     // in-range but masked = dead zone red
          }
        }
        colors.setXYZ(idx, r, gg, bb);
      }
    }
    colors.needsUpdate = true;
    var deadPct = inRange > 0 ? Math.round((1 - hit / inRange) * 100) : 0;
    lastDeadStats = { deadPct: deadPct, inRange: inRange, hit: hit, maxR: maxR };
  }

  // ---------- NET LINE OF SIGHT (collective, item F12) ----------
  // Shade terrain by the COMBINED LOS of ALL friendly units ON THE COMMS NET: a cell is SEEN if
  // ANY on-net friendly has clear LOS to it within its sight range. The shared force fog-of-war —
  // distinct from a single unit's viewshed. Off-net friendlies don't contribute (no shared intel).
  function computeNetLos() {
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var colors = terrainMesh.geometry.attributes.color;
    var rz = (map.size_m[1] / (res - 1));
    // gather on-net friendlies (fall back to ALL alive friendlies if comms overlay isn't computing)
    var friends = units.filter(function (g) {
      return g.userData.side === "friend" && !(g.userData.cmd && g.userData.cmd.ko);
    });
    var contributors = friends.filter(function (g) {
      return (g.userData._onNet === undefined) ? true : !!g.userData._onNet;
    });
    if (!contributors.length) contributors = friends;
    // precompute each contributor's eye + sight reach (use ARRIVAL origin if previewing)
    var srcs = contributors.map(function (g) {
      var o = overlayOrigin(g);
      var d = g.userData;
      var sightM = (d.rangeM > 0 ? Math.max(d.rangeM, 6000) : 9000) * fogFactor();
      return { x: o.x, z: o.z, eye: o.eye + 8, sight: sightM };
    });
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        var wx = xi * cell, wz = zi * rz, wy = H[idx] + 1;
        var seen = false, bestNear = 0;
        for (var s = 0; s < srcs.length; s++) {
          var sc = srcs[s];
          var dist = Math.hypot(wx - sc.x, wz - sc.z);
          if (dist > sc.sight) continue;
          if (losGrid(sc.x, sc.z, sc.eye, wx, wz, wy, res, H, cell, rz)) {
            seen = true;
            var near = clamp(1 - dist / sc.sight, 0, 1);
            if (near > bestNear) bestNear = near;
          }
        }
        var r, gg, bb;
        if (seen) {
          // SEEN by the force: bright, faint teal lift (shared intel)
          r = 0.92 + bestNear * 0.22; gg = 1.02 + bestNear * 0.26; bb = 0.96 + bestNear * 0.18;
        } else {
          // UNSEEN: shared fog — strongly shaded out / cold
          r = 0.24; gg = 0.27; bb = 0.33;
        }
        colors.setXYZ(idx, r, gg, bb);
      }
    }
    colors.needsUpdate = true;
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

    // IMMUNITY ZONE band vs the chosen THREAT gun (G1/G2): the range band where the enemy gun
    // can defeat NEITHER our side (too far for flat pen) NOR our deck (too close for plunging pen).
    //   inner edge = range beyond which enemy SIDE pen <= our side armour
    //   outer edge = range beyond which enemy TOP (plunging) pen  >  our deck armour
    // The threat gun's reach comes from the THREAT dropdown (immunityThreat), else the enemy on-map.
    var er = immunityThreat.rangeM;
    if (!(er > 0)) {
      var enemy = units.filter(function (g) { return g.userData.side === "hostile" && g.userData.rangeM > 0; })[0];
      er = enemy ? enemy.userData.rangeM : 0;
    }
    if (er > 0) {
      var innerEdge = er * 0.34, outerEdge = er * 0.82;
      if (outerEdge > innerEdge) {
        // BOLD immune band: stronger amber fill + bold edge rings so it clearly reads as its own thing.
        var g2 = new THREE.RingGeometry(innerEdge, outerEdge, 96, 1);
        g2.rotateX(-Math.PI / 2);
        var mband = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({
          color: 0x3ea0c8, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false }));
        mband_place(mband, d);
        fireGroup.add(mband);
        ring(innerEdge, 0x5fd6e6, 0.95);   // bold cyan inner edge
        ring(outerEdge, 0x5fd6e6, 0.95);   // bold cyan outer edge
        // label the band
        var lbl = makeTagSprite("IMMUNE vs " + (immunityThreat.name || "ENEMY GUN"), 0x5fd6e6, Math.max(map.size_m[0], map.size_m[1]));
        lbl.position.set(d.x, heightAt(d.x, d.z) + Math.max(120, (outerEdge) * 0.05), d.z + (innerEdge + outerEdge) / 2);
        lbl.material.depthTest = false; lbl.renderOrder = 25; fireGroup.add(lbl);
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
      ? "High-angle plunges into defilade — almost no dead space, but SHORT range."
      : (fireMode === "indirect")
        ? "Indirect arced fire clears low ridges; tall close masks still leave dead space."
        : "Direct flat fire is blocked by every crest — large dead-space pockets behind hills.";
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
      [0.80, 1.02, 0.86],   // gentle  - desaturated green wash
      [1.28, 1.06, 0.40],   // moderate- amber
      [1.50, 0.66, 0.26],   // steep   - strong orange
      [2.10, 0.16, 0.14],   // cliff   - BRIGHT saturated red (impassable, item D6)
    ];
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        if (H[idx] <= wlevel) { colors.setXYZ(idx, 1, 1, 1); continue; }  // water: neutral
        var g = gradientAt(H, res, xi, zi, cell, rz);
        var b = slopeBin(g);
        var c = BIN[b];
        if (b === 3) {
          // CLIFF / IMPASSABLE: blazing red with a diagonal HATCH so it reads instantly as
          // "you cannot go here" — brighter on hatch stripes, distinctly different from steep.
          var hatch = ((xi + zi) % 4 < 2) ? 1.0 : 0.62;
          colors.setXYZ(idx, c[0] * hatch, c[1] * hatch, c[2] * hatch);
        } else if (b === 2) {
          // STEEP: orange, brighten a touch with severity so ridgelines pop (but clearly < cliff)
          var sev = clamp((g - SLOPE_T.steep) / (SLOPE_T.cliff - SLOPE_T.steep), 0, 1);
          colors.setXYZ(idx, c[0] + sev * 0.12, c[1], c[2]);
        } else {
          colors.setXYZ(idx, c[0], c[1], c[2]);
        }
      }
    }
    colors.needsUpdate = true;
  }
  // A1 mirror: convert a raw DATA east-metre (from lon) to the MIRRORED world-X. Terrain heights
  // were column-flipped in buildScene, so geo-anchored content (suburbs/roads/buildings) must place
  // at W-x to stay aligned with the mirrored terrain. Units/flags use world coords already in the
  // mirrored frame, so they do NOT go through MX.
  function MX(x) { return (map ? map.size_m[0] : 0) - x; }
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
    // Gun ranges are PER-GUN and tuned to be meaningful on this ~11km theatre: a small recon
    // gun (76mm) reaches only a few km, a line gun (120/155mm) a fair chunk, the 305mm siege gun
    // dominates much of the map. They must NOT all blanket the whole map (item C).
    //   SR-76  76mm  ~2.8km   (recon, short)
    //   BR-120 120mm ~5.0km   (line)
    //   BR-155 155mm ~6.5km   (line, command)
    //   SG-305 305mm ~9.5km   (siege, dominates)
    addUnit("ANZAC-01", "friend", "Line",  "BR-155", 6500, W * 0.40, L * 0.30, "Hoplite-class. Holding the ridge line. COMMAND NODE.");
    addUnit("ANZAC-02", "friend", "Siege", "SG-305", 9500, W * 0.52, L * 0.22, "Leviathan dreadnought-crab. 305mm siege gun — dominates the theatre.");
    addUnit("ANZAC-03", "friend", "Recon", "SR-76",  2800, W * 0.66, L * 0.40, "Forward scout-crab. Light 76mm — short reach, relays the net.");
    addUnit("ANZAC-04", "friend", "Line",  "BR-120", 5000, W * 0.78, L * 0.78, "Flanking element - pushing into the far valley.");
    addUnit("CONTACT-7", "hostile", "Line", "?-130 (unidentified)", 5500, W * 0.60, L * 0.66, "IDENT UNCERTAIN - too far to confirm class.");
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
    // I1: SMALLER markers, closer to the unit (scaled by markerScale, adjustable/off via view button)
    var mkSize = Math.max(150, span * 0.030) * markerScale;
    marker.scale.set(mkSize, mkSize, 1);
    marker.position.y = unitLen * 1.2 + mkSize * 0.5;
    marker.renderOrder = 20;
    g.add(marker);

    // I3: SELECTION outline — yellow/black ring, shown only for the selected unit.
    var selMat = new THREE.SpriteMaterial({ map: makeOutlineRingTexture(0xf5c518, 0x101010), transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    var selRing = new THREE.Sprite(selMat);
    selRing.scale.set(mkSize * 1.5, mkSize * 1.5, 1);
    selRing.position.copy(marker.position); selRing.renderOrder = 19; g.add(selRing);

    // I4: FIRED-ON outline — red ring, shown when this unit is currently being fired on.
    var firedMat = new THREE.SpriteMaterial({ map: makeOutlineRingTexture(0xe8402c, 0x2a0a08), transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    var firedRing = new THREE.Sprite(firedMat);
    firedRing.scale.set(mkSize * 1.9, mkSize * 1.9, 1);
    firedRing.position.copy(marker.position); firedRing.renderOrder = 18; g.add(firedRing);

    // selection halo behind the marker (hidden until selected; pulses in animate())
    var haloTex = makeHaloTexture(mkCol);
    var haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    var halo = new THREE.Sprite(haloMat);
    halo.scale.set(mkSize * 2.0, mkSize * 2.0, 1);
    halo.position.copy(marker.position);
    halo.renderOrder = 17;
    g.add(halo);

    // I5: STATUS strip — ammo bar + status glyph (KO/FIRE), a small canvas sprite under the marker.
    var statMat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    var statusSprite = new THREE.Sprite(statMat);
    statusSprite.scale.set(mkSize * 1.4, mkSize * 0.42, 1);
    statusSprite.position.y = marker.position.y - mkSize * 0.7;
    statusSprite.renderOrder = 22; g.add(statusSprite);

    // name label above the marker
    var label = makeLabelSprite(name, span);
    label.position.y = marker.position.y + mkSize * 0.7;
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
                   selRing: selRing, selMat: selMat, firedRing: firedRing, firedMat: firedMat,
                   statusSprite: statusSprite, statMat: statMat, _statusKey: "",
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

  // I3/I4: a bold outline RING (coloured ring with a dark inner border) for selection / fired-on.
  function makeOutlineRingTexture(colInt, darkInt) {
    var S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d"), c2 = S / 2;
    var col = "#" + ("000000" + colInt.toString(16)).slice(-6);
    var dark = "#" + ("000000" + (darkInt || 0x101010).toString(16)).slice(-6);
    // dark halo first (so the bright ring reads on any background), then the bright ring
    ctx.lineWidth = 16; ctx.strokeStyle = dark;
    ctx.beginPath(); ctx.arc(c2, c2, c2 - 14, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 9; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(c2, c2, c2 - 14, 0, Math.PI * 2); ctx.stroke();
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }
  // I5: draw the ammo bar + status glyph strip for a unit (cached by a key to avoid re-drawing).
  function updateStatusSprite(g) {
    var d = g.userData, c = d.cmd; if (!d.statMat) return;
    var ammo = c && c.ammoMax ? clamp(c.ammo / c.ammoMax, 0, 1) : 1;
    var st = c && c.ko ? "KO" : (c && c.onFire ? "FIRE" : "");
    var key = (ammo * 100 | 0) + "|" + st;
    if (d._statusKey === key) return; d._statusKey = key;
    var W = 128, H = 40, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    // ammo bar
    ctx.fillStyle = "rgba(10,14,12,0.85)"; ctx.fillRect(6, 22, 116, 12);
    ctx.fillStyle = ammo > 0.3 ? "#c8a24a" : "#d75a52"; ctx.fillRect(7, 23, 114 * ammo, 10);
    ctx.strokeStyle = "rgba(160,180,170,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(6, 22, 116, 12);
    // status glyph
    if (st) {
      ctx.font = "bold 20px DejaVu Sans Mono, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = st === "KO" ? "#9a3a33" : "#e8802c";
      ctx.fillText(st === "KO" ? "\u2716 KO" : "\u25B2 FIRE", W / 2, 11);
    }
    if (d.statMat.map) d.statMat.map.dispose();
    d.statMat.map = new THREE.CanvasTexture(cv); d.statMat.map.needsUpdate = true;
    d.statusSprite.visible = markersOn;
  }

  // I1: apply the current markerScale / markersOn to every unit's marker + rings + label + status.
  function applyMarkerScale() {
    var span = map ? Math.max(map.size_m[0], map.size_m[1]) : 10000;
    units.forEach(function (g) {
      var d = g.userData; if (!d.marker) return;
      var base = Math.max(150, span * 0.030) * markerScale;
      d.mkSize = base;
      var y = (d._eyeOff ? d._eyeOff / 0.3 * 1.2 : 12) + base * 0.5;   // approx marker height
      d.marker.scale.set(base, base, 1); d.marker.position.y = d.baseMkY;
      if (d.selRing)  d.selRing.scale.set(base * 1.5, base * 1.5, 1);
      if (d.firedRing) d.firedRing.scale.set(base * 1.9, base * 1.9, 1);
      if (d.halo)     d.halo.scale.set(base * 2.0, base * 2.0, 1);
      if (d.statusSprite) d.statusSprite.scale.set(base * 1.4, base * 0.42, 1);
      // visibility
      d.marker.visible = markersOn;
      if (d.label) d.label.visible = markersOn;
      if (d.statusSprite) d.statusSprite.visible = markersOn;
      if (!markersOn) { if (d.selMat) d.selMat.opacity = 0; if (d.firedMat) d.firedMat.opacity = 0; }
      else if (d.selMat && g === selected) d.selMat.opacity = 1;
    });
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

    // =========================================================================
    // TERRAIN OVERLAY PRIORITY (item F12) — only ONE shader colours the terrain at a time.
    // Highest priority first:
    //   1. SLOPE / gradient            (trafficability — where you can/can't go)
    //   2. FIRE ANALYSIS               (trajectory-aware can-hit / dead-space)
    //   3. DEAD ZONES / SHADE-RANGE    (selected unit's fire picture + out-of-range shade)
    //   4. NET LINE OF SIGHT           (collective on-net fog-of-war)
    //   5. ARRIVAL PREVIEW + single-unit VIEWSHED (what THIS unit sees, current or on arrival)
    // (ARRIVAL is not its own shader — it changes the ORIGIN used by 3/4/5 via overlayOrigin().)
    // =========================================================================
    if (show.slope) {
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      computeSlopeOverlay();
      updateFireReadout(null);   // hide fire panel if it was open
    } else if (show.fire) {
      // FIRE ANALYSIS takes over the terrain shading when active (replaces plain viewshed).
      computeFireAnalysis(u);
      buildFireRings(u);
      updateFireReadout(u);
    } else if (show.shaderange) {
      // SHADE OUT OF RANGE: heavy-dim everything outside the selected unit's gun range.
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      updateFireReadout(null);
      computeShadeOutOfRange(u);
      updateDeadReadout(u);
    } else if (show.deadzones) {
      // FIRE PICTURE: shade the SELECTED unit's direct-fire dead zones (red) vs hittable (green).
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      updateFireReadout(null);          // keep the separate fire-analysis panel hidden
      if (u.userData.rangeM > 0) computeDeadZones(u);
      else if (show.los) computeViewshed(u); else clearViewshed();   // unarmed unit: fall back to viewshed
      updateDeadReadout(u);
    } else if (show.netlos) {
      // NET LINE OF SIGHT: collective on-net fog-of-war (combined LOS of all on-net friendlies).
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      updateFireReadout(null);
      computeNetLos();
      updateDeadReadout(u);
    } else {
      if (fireGroup) { scene.remove(fireGroup); fireGroup = null; }
      // VIEWSHED light-cast: highlight everything this unit can see (current or arrival origin).
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
    d.offNet = off;                     // O1: used by hasSpotter (off-net units can't relay corrections)
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
  // Crabs are tiny on an 11 km map, so a pixel-exact mesh raycast makes selection finicky.
  // pickUnit() first tries a precise ray hit, then falls back to the NEAREST unit whose
  // screen position is within PICK_PX pixels of the click — so "click near a crab" just works.
  var PICK_PX = 34;
  function pickUnit(e) {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObjects(units, true);
    if (hits.length) {
      var g = hits[0].object; while (g.parent && units.indexOf(g) < 0) g = g.parent;
      if (units.indexOf(g) >= 0) return g;
    }
    // proximity fallback: project each unit to screen space, pick the closest within PICK_PX.
    var best = null, bestD = PICK_PX * PICK_PX, v = new THREE.Vector3();
    for (var i = 0; i < units.length; i++) {
      var u = units[i], d = u.userData;
      v.set(d.x, (d.eye || 0), d.z).project(camera);
      if (v.z > 1) continue;                       // behind the camera
      var sx = (v.x * 0.5 + 0.5) * innerWidth;
      var sy = (-v.y * 0.5 + 0.5) * innerHeight;
      var dd = (sx - e.clientX) * (sx - e.clientX) + (sy - e.clientY) * (sy - e.clientY);
      if (dd < bestD) { bestD = dd; best = u; }
    }
    return best;
  }
  function onClick(e) {
    var g = pickUnit(e);
    if (g) {
      {
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
        // F1: CTRL/ALT-click a hostile designates it as a FIRE MISSION target for the selected gun
        if (cmd.on && (e.ctrlKey || e.altKey) && g.userData.side === "hostile" && selected && selected.userData.side === "friend") {
          cmd.fireTarget = { x: g.userData.x, z: g.userData.z };
          document.getElementById("status").textContent = "FIRE MISSION: " + g.userData.name;
          updateFirePanel(selected); drawTrajectories();
          return;
        }
        if (!e.shiftKey) cmd.selectedSet = [g];
        selectUnit(g);
      }
    } else if (cmd.on && (e.ctrlKey || e.altKey) && selected && selected.userData.side === "friend" && terrainMesh) {
      // F1: CTRL/ALT-click empty GROUND designates a grid fire mission (fire at that point)
      mouse.x = (e.clientX / innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var th = raycaster.intersectObject(terrainMesh, false);
      if (th.length) {
        cmd.fireTarget = { x: clamp(th[0].point.x, 0, map.size_m[0]), z: clamp(th[0].point.z, 0, map.size_m[1]) };
        document.getElementById("status").textContent = "FIRE MISSION: GRID";
        updateFirePanel(selected); drawTrajectories();
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

  // Infer calibre (mm) from a gun designation. Game gun names embed the calibre as the
  // trailing number group, e.g. "BR-155" -> 155, "SG-305" -> 305, "SR-90" -> 90, "BR-120" -> 120.
  // Returns null if no plausible calibre can be read (e.g. "unarmed", "light", "?").
  function parseCalibre(gun) {
    if (!gun) return null;
    var m = String(gun).match(/(\d{2,3})\s*mm/i);   // explicit "155mm"
    if (m) return parseInt(m[1], 10);
    m = String(gun).match(/[A-Z]{1,3}-?(\d{2,3})/);  // designation like BR-155 / SG305
    if (m) { var c = parseInt(m[1], 10); if (c >= 40 && c <= 460) return c; }
    return null;
  }

  // ARMAMENT readout (item B): list the unit's fitted gun(s) — name, calibre, MAX RANGE in km.
  // Demo units carry a single .gun string + .rangeM; a unit may declare extra mounts via
  // userData.guns = [{name, rangeM}]. We render each as a bordered "gunrow".
  function renderArmament(d) {
    var box = document.getElementById("uArm"); if (!box) return;
    box.innerHTML = "";
    var mounts = [];
    if (Array.isArray(d.guns) && d.guns.length) {
      d.guns.forEach(function (gm) { mounts.push({ name: gm.name, rangeM: gm.rangeM }); });
    } else if (d.rangeM > 0) {
      // strip a trailing "(18km)" range tag from the display gun name for the readout
      var nm = String(d.gun || "GUN").replace(/\s*\([^)]*\)\s*$/, "").trim() || "MAIN GUN";
      mounts.push({ name: nm, rangeM: d.rangeM });
    }
    if (!mounts.length) {
      box.innerHTML = '<div class="none">UNARMED &middot; do not engage</div>';
      return;
    }
    mounts.forEach(function (gm) {
      var cal = parseCalibre(gm.name);
      var row = document.createElement("div");
      row.className = "gunrow";
      var km = (gm.rangeM / 1000).toFixed(gm.rangeM >= 10000 ? 0 : 1);
      row.innerHTML = '<span class="gn">' + escapeHtml(gm.name) + '</span>' +
        (cal ? '<span class="cal">' + cal + 'mm</span>' : '') +
        '<span class="rng">' + km + ' km</span>';
      box.appendChild(row);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---------- TARGETING COMPUTER ----------
  // For the selected FRIENDLY gun, work out the firing solution it has on every HOSTILE crab:
  //   range vs the gun's max range, and which trajectory (DIRECT / OBLIQUE / MORTAR) can actually
  //   reach it through terrain (reusing canHit). Reports bearing + the best solution per target.
  // This is the tactical read of "who can I shoot right now, and how" the player asked for.
  // Returns a sorted list (firing solutions first, then masked, then out-of-range), best at top.
  function computeFiringSolutions(g) {
    var d = g.userData;
    if (!(d.rangeM > 0)) return [];
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var rz = (map.size_m[1] / (res - 1));
    var ex = d.x, ez = d.z, ey = d.eye + 8;
    var maxRangeM = d.rangeM;                       // the gun's flat max range
    // Trajectories tried in order of preference: a flat DIRECT shot is best (fast, accurate),
    // then INDIRECT to clear a crest, then HIGH-ANGLE/MORTAR to plunge into defilade (short range).
    var modes = ["direct", "indirect", "mortar"];
    var out = [];
    for (var i = 0; i < units.length; i++) {
      var e = units[i]; if (e === g) continue;
      var ed = e.userData;
      if (ed.side !== "hostile") continue;
      if (ed.cmd && ed.cmd.struct <= 0) continue;   // already knocked out
      var dx = ed.x - ex, dz = ed.z - ez;
      var rng = Math.hypot(dx, dz);
      var ty = ed.eye ? heightAt(ed.x, ed.z) + ed.eye * 0.5 : heightAt(ed.x, ed.z) + 2;
      var sol = null;                                // {mode,label} of the first trajectory that reaches
      for (var m = 0; m < modes.length; m++) {
        var p = trajParams(modes[m]);
        var modeMaxR = maxRangeM * p.reachMul;       // HIGH-ANGLE reaches much less than the flat max
        if (rng > modeMaxR) continue;                // this trajectory can't reach that far
        var v = muzzleSpeed(d.rangeM);
        if (canHit(ex, ez, ey, ed.x, ed.z, ty, res, H, cell, rz, v, p, modeMaxR)) {
          sol = { mode: modes[m], label: p.label.split(" / ")[0] };  // DIRECT / INDIRECT / HIGH-ANGLE
          break;
        }
      }
      // in "range" if ANY trajectory could reach (i.e. within the flat max); else out of range.
      var state = rng > maxRangeM ? "oor" : (sol ? "fire" : "masked");
      out.push({ unit: e, name: ed.name, rng: rng, brg: bearingFromVec(dx, dz),
                 inRange: rng <= maxRangeM, sol: sol, state: state });
    }
    // sort: firing first, then masked, then OOR; within a group, nearest first.
    var order = { fire: 0, masked: 1, oor: 2 };
    out.sort(function (a, b) {
      if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
      return a.rng - b.rng;
    });
    return out;
  }

  // F2: populate the maths FIRE SOLUTION panel for the selected gun's current/nearest target.
  function updateFirePanel(g) {
    var panel = document.getElementById("firesol");
    if (!panel || !g) return;
    var d = g.userData;
    if (!cmd.on || d.side !== "friend" || !(d.rangeM > 0)) { panel.style.display = "none"; return; }
    // pick the target: current firing target, else designated fire point, else nearest hostile in range
    var tgtName = "—", tx = null, tz = null, ty = null;
    if (d.cmd && d.cmd.firingTo && !d.cmd.firingTo.userData.cmd.ko) {
      var t = d.cmd.firingTo.userData; tx = t.x; tz = t.z; ty = t.eye; tgtName = t.name;
    } else if (cmd.fireTarget) {
      tx = cmd.fireTarget.x; tz = cmd.fireTarget.z; ty = heightAt(tx, tz) + 2; tgtName = "GRID " + Math.round(tx) + "," + Math.round(tz);
    } else {
      var best = null, bd = Infinity;
      units.forEach(function (e) {
        var ed = e.userData; if (ed.side !== "hostile" || (ed.cmd && ed.cmd.ko)) return;
        var rr = Math.hypot(ed.x - d.x, ed.z - d.z);
        if (rr < bd) { bd = rr; best = e; }
      });
      if (best) { tx = best.userData.x; tz = best.userData.z; ty = best.userData.eye; tgtName = best.userData.name; }
    }
    if (tx == null) { panel.style.display = "none"; return; }
    var rangeM = Math.hypot(tx - d.x, tz - d.z);
    var high = fireModeIsHigh(d, { x: tx, z: tz, eye: ty });
    var v = muzzleSpeed(d.rangeM);
    var sol = fireSolution(v, Math.min(rangeM, d.rangeM), high);
    var frac = rangeM / d.rangeM;
    panel.style.display = "block";
    document.getElementById("fsMode").textContent = "// " + (high ? "HIGH-ANGLE / INDIRECT" : "DIRECT");
    document.getElementById("fsTgt").textContent = tgtName;
    document.getElementById("fsRange").textContent = (rangeM / 1000).toFixed(2) + " km";
    document.getElementById("fsVel").textContent = Math.round(v) + " m/s";
    document.getElementById("fsElev").textContent = sol.elevDeg.toFixed(1) + "\u00B0";
    document.getElementById("fsFall").textContent = sol.fallDeg.toFixed(1) + "\u00B0";
    document.getElementById("fsTof").textContent = sol.tof.toFixed(1) + " s";
    document.getElementById("fsApex").textContent = Math.round(sol.apex) + " m";
    document.getElementById("fsCharge").textContent = chargeZone(clamp(frac, 0, 1));
    document.getElementById("fsZone").textContent = hitZone(rangeM, d.rangeM);
    document.getElementById("fsHint").textContent = rangeM > d.rangeM
      ? "TARGET BEYOND MAX RANGE — cannot reach."
      : (high ? "Lobbed over terrain; steep fall strikes the DECK." : "Flat, fast; shallow fall strikes the SIDE/GLACIS.");
  }

  function renderTargetingComputer(g) {
    var box = document.getElementById("uTgtComp");
    var body = document.getElementById("tgtBody");
    var modeEl = document.getElementById("tgtMode");
    if (!box || !body) return;
    var d = g.userData;
    // Only show for armed FRIENDLY crabs (you target with your own guns).
    if (d.side !== "friend" || !(d.rangeM > 0)) { box.style.display = "none"; return; }
    var sols = computeFiringSolutions(g);
    box.style.display = "block";
    if (modeEl) modeEl.textContent = "// LOS fire-control";
    body.innerHTML = "";
    if (!sols.length) {
      body.innerHTML = '<div class="none">no hostiles in theatre</div>';
      return;
    }
    sols.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "trow " + (s.state === "fire" ? "firing" : s.state === "masked" ? "masked" : "oor");
      var km = (s.rng / 1000).toFixed(s.rng >= 10000 ? 0 : 1);
      var solTxt, solCls;
      if (s.state === "oor")        { solTxt = "OUT OF RANGE"; solCls = "oor"; }
      else if (s.state === "masked"){ solTxt = "NO SOLUTION (masked)"; solCls = "mask"; }
      else                          { solTxt = s.sol.label + " \u2014 FIRING SOLUTION"; solCls = "fire"; }
      row.innerHTML =
        '<span class="tn">' + escapeHtml(s.name) + '</span>' +
        '<span class="trng">' + km + ' km</span>' +
        '<br><span class="tbrg">BRG ' + bearingTxt(s.brg) + '</span> ' +
        '<span class="tsol ' + solCls + '">' + solTxt + '</span>';
      // make the row a real flex-wrap so the second line sits under the name
      row.style.flexWrap = "wrap";
      row.onclick = function () { selectUnit(s.unit); focusUnit(s.unit); };
      body.appendChild(row);
    });
  }

  function selectUnit(g) {
    // I3: move the yellow/black selection ring to the newly-selected unit
    units.forEach(function (u) { if (u.userData.selMat) u.userData.selMat.opacity = 0; });
    selected = g; var d = g.userData;
    if (d.selMat) d.selMat.opacity = markersOn ? 1 : 0;
    var p = document.getElementById("unit"); p.style.display = "block";
    document.getElementById("uName").textContent = d.name;
    document.getElementById("uClass").textContent = d.cls;
    var ident = d.side === "hostile" ? "HOSTILE (uncertain)" : d.side === "civ" ? "CIVILIAN" : "FRIENDLY";
    var ie = document.getElementById("uIdent"); ie.textContent = ident;
    ie.className = d.side === "hostile" ? "warn" : "k";
    document.getElementById("uStruct").style.width = (d.cmd ? Math.round(d.cmd.struct) : 100) + "%";
    renderArmament(d);
    document.getElementById("uRange").textContent = d.rangeM ? (d.rangeM / 1000).toFixed(1) + " km" : "n/a";
    document.getElementById("uNote").textContent = d.note;
    updateUnitFacing(g);
    renderTargetingComputer(g);
    updateFirePanel(g);
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
    // Camera SOUTH of centre looking NORTH -> NORTH-UP. With the A1 east-mirror this gives the
    // true map compass: N top, E right, S bottom, W left (N-E-S-W clockwise).
    camera.position.set(W / 2, span * 1.14, L / 2 - span * 0.74);
    controls.update();
  }

  // ---------- UI ----------
  var deadSync = function () {};   // set in bindUI; lets fire/slope toggles refresh DEAD ZONES btn
  function bindUI() {
    tog("tLOS", "los"); tog("tRange", "range"); tog("tBld", "bld"); tog("tRoads", "roads"); tog("tWire", "wire");
    document.getElementById("tRoads").classList.toggle("on", show.roads);
    tog("tWind", "wind"); tog("tRain", "rain");
    tog("tSub", "suburbs"); tog("tFogCull", "fogcull");
    document.getElementById("tSub").classList.toggle("on", show.suburbs);
    document.getElementById("tFogCull").classList.toggle("on", show.fogcull);
    document.getElementById("tFly").onclick = function () { setFly(!fly.on); };

    // ---- THREAT GUN dropdown for the immunity band (G2) ----
    var threatSel = document.getElementById("threatSel");
    if (threatSel && !threatSel._built) {
      threatSel._built = true;
      THREAT_GUNS.forEach(function (tg, i) {
        var o = document.createElement("option"); o.value = i; o.textContent = tg.name; threatSel.appendChild(o);
      });
      threatSel.onchange = function () {
        immunityThreat = THREAT_GUNS[parseInt(threatSel.value, 10)] || THREAT_GUNS[0];
        rebuildOverlays();
      };
    }

    // ---- COMBAT VIEW (L1) toggle ----
    var povBtn = document.getElementById("tPov");
    if (povBtn) {
      povBtn.classList.toggle("on", povOn);
      povBtn.onclick = function () { povOn = !povOn; povBtn.classList.toggle("on", povOn); };
    }

    // ---- MARKERS view button: cycle FULL -> SMALL -> OFF (I1) ----
    var mkBtn = document.getElementById("tMarkers");
    if (mkBtn) {
      mkBtn.onclick = function () {
        // cycle state
        if (markersOn && markerScale > 0.75) { markerScale = 0.6; markersOn = true; mkBtn.textContent = "MARKERS: SMALL"; }
        else if (markersOn) { markersOn = false; mkBtn.textContent = "MARKERS: OFF"; }
        else { markersOn = true; markerScale = 1.0; mkBtn.textContent = "MARKERS: FULL"; }
        mkBtn.classList.toggle("on", markersOn);
        applyMarkerScale();
      };
    }

    // ---- COMBAT LOG: open/close the full scrollable history panel ----
    var clogHdr = document.getElementById("clogHdr"), clogFull = document.getElementById("clogFull"),
        clogFullHdr = document.getElementById("clogFullHdr");
    if (clogHdr && clogFull) {
      clogHdr.onclick = function () {
        clogFull.style.display = clogFull.style.display === "none" ? "block" : "none";
        renderClog();
      };
    }
    if (clogFullHdr && clogFull) clogFullHdr.onclick = function () { clogFull.style.display = "none"; };

    // ---- CONDITIONS panel HIDE/SHOW (collapse its body) ----
    var wxHdr = document.getElementById("wxHdr"), wxPanel = document.getElementById("wx"),
        wxTog = document.getElementById("wxToggle");
    if (wxHdr && wxPanel) {
      wxHdr.onclick = function () {
        var col = wxPanel.classList.toggle("collapsed");
        if (wxTog) wxTog.textContent = col ? "[ SHOW ]" : "[ HIDE ]";
      };
    }

    // ---- SUBURB NAMES toggle (big floating name labels; separate from the neon markers) ----
    var subNamesBtn = document.getElementById("tSubNames");
    if (subNamesBtn) {
      subNamesBtn.classList.toggle("on", show.subnames);
      subNamesBtn.onclick = function () {
        show.subnames = !show.subnames;
        subNamesBtn.classList.toggle("on", show.subnames);
        if (suburbNameGroup) suburbNameGroup.visible = show.suburbs && show.subnames;
      };
    }

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
        show.shaderange = false; show.netlos = false;
        syncShadeNet();
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
      [["fDirect","direct"],["fIndirect","indirect"],["fMortar","mortar"]].forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (el) el.classList.toggle("on", fireMode === pair[1]);
      });
      // LOS toggle reflects that fire-analysis suppresses the plain viewshed
      document.getElementById("tLOS").classList.toggle("on", show.los && !show.fire);
    }
    document.getElementById("tFire").onclick = function () {
      show.fire = !show.fire;
      if (show.fire) { show.los = false; show.slope = false; show.deadzones = false; show.shaderange = false; show.netlos = false; syncSlopeUI(); deadSync(); syncShadeNet(); }  // fire shading replaces viewshed/slope/deadzones/shade/net
      else { show.los = true; }
      document.getElementById("fire").style.display = show.fire ? "block" : "none";
      syncFireUI(); rebuildOverlays();
    };
    function setTraj(m) {
      fireMode = m;
      if (!show.fire) { show.fire = true; show.los = false; show.slope = false; show.deadzones = false; show.shaderange = false; show.netlos = false; syncSlopeUI(); deadSync(); syncShadeNet(); document.getElementById("fire").style.display = "block"; }
      syncFireUI(); rebuildOverlays();
    }
    document.getElementById("fDirect").onclick   = function () { setTraj("direct"); };
    document.getElementById("fIndirect").onclick = function () { setTraj("indirect"); };
    document.getElementById("fMortar").onclick   = function () { setTraj("mortar"); };
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
        show.shaderange = false; show.netlos = false; syncShadeNet();
        document.getElementById("fire").style.display = "none";
      } else {
        show.los = true;                       // restore the default viewshed
      }
      syncSlopeUI(); syncFireUI(); deadSync(); rebuildOverlays();
    };
    syncSlopeUI();

    // ---- SHADE OUT OF RANGE + NET LINE OF SIGHT toggles (item F10/F12) ----
    // Both are exclusive terrain shaders. We clear the competing shaders when turning one on.
    function clearOtherShaders() {
      show.fire = false; show.slope = false; show.deadzones = false;
      document.getElementById("fire").style.display = "none";
      syncFireUI(); syncSlopeUI(); deadSync();
    }
    function syncShadeRangeUI() {
      var b = document.getElementById("tShadeRange");
      if (b) b.classList.toggle("on", show.shaderange);
    }
    function syncNetLosUI() {
      var b = document.getElementById("tNetLos");
      if (b) b.classList.toggle("on", show.netlos);
    }
    function syncShadeNet() { syncShadeRangeUI(); syncNetLosUI(); }
    var shadeBtn = document.getElementById("tShadeRange");
    if (shadeBtn) shadeBtn.onclick = function () {
      show.shaderange = !show.shaderange;
      if (show.shaderange) { show.netlos = false; show.los = false; clearOtherShaders(); }
      else { show.los = true; }
      syncShadeRangeUI(); syncNetLosUI(); rebuildOverlays();
    };
    var netLosBtn = document.getElementById("tNetLos");
    if (netLosBtn) netLosBtn.onclick = function () {
      show.netlos = !show.netlos;
      if (show.netlos) {
        show.shaderange = false; show.los = false; clearOtherShaders();
        // net-LOS needs the comms net computed to know who's on net; enable it
        if (!show.comms) { show.comms = true;
          document.getElementById("tComms").classList.toggle("on", true);
          document.getElementById("commsLeg").style.display = "block"; }
      } else { show.los = true; }
      syncNetLosUI(); syncShadeRangeUI(); rebuildOverlays();
    };
    syncShadeRangeUI(); syncNetLosUI();

    // ---- PREVIEW: FROM CURRENT / FROM ARRIVAL (item F11) ----
    function syncPrevUI() {
      var c = document.getElementById("tPrevCur"), a = document.getElementById("tPrevArr");
      if (c) c.classList.toggle("on", previewMode === "current");
      if (a) a.classList.toggle("on", previewMode === "arrival");
    }
    var prevCur = document.getElementById("tPrevCur"), prevArr = document.getElementById("tPrevArr");
    if (prevCur) prevCur.onclick = function () { previewMode = "current"; syncPrevUI(); rebuildOverlays(); };
    if (prevArr) prevArr.onclick = function () { previewMode = "arrival"; syncPrevUI(); rebuildOverlays(); };
    syncPrevUI();

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
        else if (key === "roads" && roadsGroup) roadsGroup.visible = show.roads;
        else if (key === "wire" && wireMesh) wireMesh.visible = show.wire;
        else if (key === "wind" && windGroup) windGroup.visible = show.wind;
        else if (key === "rain" && rainGroup) rainGroup.visible = show.rain;
        else if (key === "suburbs") {
          if (suburbGroup) suburbGroup.visible = show.suburbs;
          if (suburbNameGroup) suburbNameGroup.visible = show.suburbs && show.subnames;
        }
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

    // ---- SPEED control (preset buttons + slider + keys) + SOUND toggle ----
    SPEED_BTNS.forEach(function (id) {
      var b = document.getElementById(id); if (!b) return;
      b.onclick = function () { setSimSpeed(parseFloat(b.getAttribute("data-s"))); };
    });
    // speed SLIDER (continuous 0.25x .. 8x) + live readout
    var slider = document.getElementById("spdSlider");
    if (slider) {
      slider.value = simSpeed;
      slider.oninput = function () { setSimSpeed(parseFloat(slider.value)); };
    }
    updateSpeedUI();
    var sb = document.getElementById("tSound");
    if (sb) {
      sb.classList.toggle("on", soundOn);
      sb.onclick = function () {
        soundOn = !soundOn;
        sb.classList.toggle("on", soundOn);
        if (soundOn) { try { if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); if (audioCtx.state==="suspended") audioCtx.resume(); playSfx("impact"); } catch(e){} }
        document.getElementById("status").textContent = soundOn ? "SOUND ON" : "SOUND OFF";
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
      // , / . cycle the selected unit (previous / next friendly crab). Skip if typing in the <select>.
      if ((e.key === "," || e.key === ".") && (!document.activeElement || document.activeElement.tagName !== "SELECT")) {
        cycleUnit(e.key === "," ? -1 : 1); e.preventDefault(); return;
      }
      // = / + speeds the sim up, - / _ slows it (0.25x .. 8x). Fine step of 0.25.
      if (e.key === "=" || e.key === "+") { setSimSpeed(simSpeed + 0.25); e.preventDefault(); return; }
      if (e.key === "-" || e.key === "_") { setSimSpeed(simSpeed - 0.25); e.preventDefault(); return; }
      // ARROW keys also cycle the selected unit (Left/Up = prev, Right/Down = next).
      if ((e.key === "ArrowLeft" || e.key === "ArrowUp") && (!document.activeElement || document.activeElement.tagName !== "SELECT")) {
        cycleUnit(-1); e.preventDefault(); return;
      }
      if ((e.key === "ArrowRight" || e.key === "ArrowDown") && (!document.activeElement || document.activeElement.tagName !== "SELECT")) {
        cycleUnit(1); e.preventDefault(); return;
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
    // MOUSE WHEEL = ZOOM in fly mode: dolly the camera along its look direction (in/out).
    // SHIFT+wheel adjusts fly *speed* instead. (In orbit mode OrbitControls handles wheel zoom.)
    dom.addEventListener("wheel", function (e) {
      if (!fly.on) return;
      e.preventDefault();
      if (e.shiftKey) {
        var f = e.deltaY < 0 ? 1.15 : 0.87;
        fly.speed = clamp(fly.speed * f, 30, 60000);
        return;
      }
      // dolly: step a fraction of the current altitude so zoom feels consistent at any height.
      var step = Math.max(60, (camera.position.y || 1000) * 0.14);
      var dir = flyForward().multiplyScalar(e.deltaY < 0 ? step : -step);
      camera.position.add(dir);
      if (terrainField) {
        var minY = heightAt(camera.position.x, camera.position.z) + 6;
        if (camera.position.y < minY) camera.position.y = minY;
      }
      camera.lookAt(new THREE.Vector3().addVectors(camera.position, flyForward()));
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
      // speed scales with map size: controllable cruise (~cross 11km in ~20s at base),
      // ~7s on shift-boost. Tuned down from earlier so the fly cam is easy to drive (item A).
      var span = map ? Math.max(map.size_m[0], map.size_m[1]) : 11000;
      fly.speed = span * 0.052;    // units/sec
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
    // strafe RIGHT = up x forward (Three.js right-handed): cross(fwd,up) would give LEFT, so
    // D would strafe the wrong way. up x fwd gives the true camera-right vector.
    var up = new THREE.Vector3(0, 1, 0);
    var right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    var move = new THREE.Vector3();
    var k = fly.keys;
    if (k.w) move.add(fwd);
    if (k.s) move.sub(fwd);
    if (k.d) move.add(right);
    if (k.a) move.sub(right);
    if (k.r || k.e) move.add(up);     // up
    if (k.q) move.sub(up);            // down  (F is reserved as the fly-mode toggle)
    var spd = fly.speed * (k.shift ? 3.2 : 1.0);
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

  // class -> ground speed (m/s). MUCH SLOWER by default (item G13) so the battle plays at a
  // satisfying, watchable pace — a Line crab crossing ~11km now takes minutes at 1x, not seconds.
  // The SPEED control (1x/2x/3x/4x) multiplies this via simSpeed in stepCommandSim.
  function classSpeed(cls) {
    return cls === "Recon" ? 42 : cls === "Line" ? 30 : cls === "Siege" ? 18 :
           cls === "Convoy" ? 13 : 32;
  }

  // SIM SPEED control — shared by the 1x/2x/3x/4x buttons, the =/- keys and the slider.
  // Continuous 0.25x .. 8x; the buttons snap to whole steps, the slider/keys are fine-grained.
  function setSimSpeed(v) {
    simSpeed = clamp(v, 0.25, 8);
    updateSpeedUI();
    document.getElementById("status").textContent = "SIM SPEED " + fmtSpeed(simSpeed) + "x";
  }
  function fmtSpeed(v) { return (v % 1 === 0) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); }
  var SPEED_BTNS = ["spdH", "spd1", "spd2", "spd3", "spd4", "spd6", "spd8"];
  function updateSpeedUI() {
    SPEED_BTNS.forEach(function (id) {
      var e = document.getElementById(id);
      if (e) e.classList.toggle("on", Math.abs(parseFloat(e.getAttribute("data-s")) - simSpeed) < 0.01);
    });
    var sl = document.getElementById("spdSlider"); if (sl && Math.abs(parseFloat(sl.value) - simSpeed) > 0.001) sl.value = simSpeed;
    var rd = document.getElementById("spdRead"); if (rd) rd.textContent = fmtSpeed(simSpeed) + "\u00D7";
  }

  // Per-unit command state. Called once after units are placed.
  function initCommand() {
    cmd.flagGroup  = new THREE.Group(); scene.add(cmd.flagGroup);
    cmd.orderGroup = new THREE.Group(); scene.add(cmd.orderGroup);
    cmd.fxGroup    = new THREE.Group(); scene.add(cmd.fxGroup);
    cmd.trajGroup  = new THREE.Group(); scene.add(cmd.trajGroup);   // F3/F5: parabolic fire arcs
    cmd.flagship = null; cmd.selectedSet = []; cmd.objective = null;
    units.forEach(function (g) {
      var d = g.userData;
      var ammoMax = d.cls === "Siege" ? 40 : d.cls === "Convoy" ? 200 : 80;   // E4: finite rounds
      d.cmd = { flags: [], targetIdx: 0, struct: d.struct != null ? d.struct : 100,
                ko: false, speed: classSpeed(d.cls), firingTo: null, fireLine: null,
                fireTimer: 0, aiTarget: null, ammo: ammoMax, ammoMax: ammoMax, onFire: false };
    });
    syncCommandPanel();
  }

  function setCommandMode(on) {
    cmd.on = on;
    var p = document.getElementById("cmd");      if (p) p.style.display = on ? "block" : "none";
    // cmdHint duplicates the C&C panel + bottom controls and crowds the unit panel — keep hidden.
    var h = document.getElementById("cmdHint");  if (h) h.style.display = "none";
    var s = document.getElementById("scenSel");  if (s) s.style.display = on ? "block" : "none";
    var b = document.getElementById("tCmd");     if (b) b.classList.toggle("on", on);
    if (cmd.flagGroup)  cmd.flagGroup.visible  = on;
    if (cmd.orderGroup) cmd.orderGroup.visible  = on;
    if (cmd.fxGroup)    cmd.fxGroup.visible     = on;
    var cl = document.getElementById("clog");   if (cl) cl.style.display = on ? "block" : "none";
    var sc = document.getElementById("simctl"); if (sc) sc.style.display = on ? "flex" : "none";
    var hn = document.querySelector(".hint");   if (hn) hn.style.display = on ? "none" : "block";
    if (on && !clogLines.length) combatLog('<span class="dim">— command net online —</span>');
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

  // Redraw the order/path lines for ALL friendly units (cheap; few units). Brighter/thicker
  // dashed TEAL line from each unit to its flag, with a SMALL label naming the owning unit at
  // the destination flag (item G15).
  // F3/F5: draw a parabolic fire arc for every actively-firing unit (visible even when the firing
  // unit is NOT selected). Friendly arcs = warm amber, hostile = red. Cheap: few units, redrawn
  // as combat state changes. Also used for a designated fire-mission preview from the selected unit.
  function drawTrajectories() {
    if (!cmd.trajGroup) return;
    while (cmd.trajGroup.children.length) {
      var ch = cmd.trajGroup.children[0];
      cmd.trajGroup.remove(ch); if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose();
    }
    if (!cmd.on) return;
    units.forEach(function (g) {
      var d = g.userData, c = d.cmd;
      if (!c || c.ko || !c.firingTo || c.firingTo.userData.cmd.ko) return;
      var tgt = c.firingTo.userData;
      // use the actual engagement trajectory if known, else fall back to the LOS heuristic
      var high = c.fireSol ? (c.fireSol.mode !== "direct") : fireModeIsHigh(d, tgt);
      var pts = trajectoryPoints(d.x, d.eye + 6, d.z, tgt.x, tgt.eye + 4, tgt.z, high, 26);
      var col = d.side === "friend" ? 0xe8a838 : 0xd75a52;
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthTest: false });
      var ln = new THREE.Line(geo, mat); ln.renderOrder = 15; cmd.trajGroup.add(ln);
    });
    // designated fire-mission preview arc from the selected unit to its designated target point
    if (cmd.fireTarget && selected && selected.userData.cmd && !selected.userData.cmd.ko) {
      var sd = selected.userData, ft = cmd.fireTarget;
      var high2 = fireMode === "mortar";
      var pp = trajectoryPoints(sd.x, sd.eye + 6, sd.z, ft.x, heightAt(ft.x, ft.z) + 2, ft.z, high2, 30);
      var g2 = new THREE.BufferGeometry().setFromPoints(pp);
      var m2 = new THREE.LineDashedMaterial({ color: 0x7fe6a0, dashSize: 90, gapSize: 50, transparent: true, opacity: 0.95, depthTest: false });
      var l2 = new THREE.Line(g2, m2); l2.computeLineDistances(); l2.renderOrder = 16; cmd.trajGroup.add(l2);
    }
  }
  // Decide if a firing pair uses a high-angle arc: if flat DIRECT is masked by terrain, lob it.
  function fireModeIsHigh(d, tgt) {
    if (!terrainField) return false;
    return !hasLOS(d.x, d.z, d.eye, tgt.x, tgt.z, tgt.eye);   // no LOS -> indirect/high arc
  }

  function drawOrderLines(_changed) {
    if (!cmd.orderGroup) return;
    while (cmd.orderGroup.children.length) cmd.orderGroup.remove(cmd.orderGroup.children[0]);
    var span = Math.max(map.size_m[0], map.size_m[1]);
    units.forEach(function (g) {
      var d = g.userData, c = d.cmd;
      if (!c || !c.flags.length || c.ko) return;
      // live (not-yet-reached, non-null) flags only
      var live = c.flags.filter(function (f) { return f; });
      if (!live.length) return;
      // MOVEMENT/ORDER lines are DARK SOLID BLUE (H1) — clearly distinct from teal comms links.
      // Keep the flag-TYPE tint only as a subtle accent on the label, not the path colour.
      var MOVE_LINE = 0x2c58c8;   // deep blue
      var col = MOVE_LINE;
      // chain: unit -> flag[target] -> flag[...] in order
      var pts = [new THREE.Vector3(d.x, heightAt(d.x, d.z) + 18, d.z)];
      for (var i = c.targetIdx; i < c.flags.length; i++) {
        var f = c.flags[i]; if (!f) continue;
        var fu = f.userData;
        pts.push(new THREE.Vector3(fu.fx, heightAt(clamp(fu.fx,0,map.size_m[0]), clamp(fu.fz,0,map.size_m[1])) + 18, fu.fz));
      }
      if (pts.length < 2) return;
      // bold SOLID band: stack two slightly-offset solid lines (no dashes) so it reads as a route.
      for (var s = 0; s < 2; s++) {
        var p2 = s === 0 ? pts : pts.map(function (p) { return new THREE.Vector3(p.x, p.y + span * 0.0016, p.z); });
        var geo = new THREE.BufferGeometry().setFromPoints(p2);
        var mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: s === 0 ? 0.95 : 0.5,
          depthTest: false });
        var ln = new THREE.Line(geo, mat); ln.renderOrder = 14 + s;
        cmd.orderGroup.add(ln);
      }
      // small unit-name label at the destination flag
      var dest = live[live.length - 1].userData;
      var lblPt = new THREE.Vector3(dest.fx, heightAt(clamp(dest.fx,0,map.size_m[0]), clamp(dest.fz,0,map.size_m[1])) + span * 0.020, dest.fz);
      var tag = makeTagSprite(d.name, col, span);
      tag.position.copy(lblPt); tag.material.depthTest = false; tag.renderOrder = 24;
      tag.scale.multiplyScalar(0.7);
      cmd.orderGroup.add(tag);
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
  // Terrain gradient (rise/run) sampled at a WORLD (x,z) point — used to slow crabs on grades.
  function gradientAtWorld(wx, wz) {
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var rz = (map.size_m[1] / (res - 1));
    var xi = clamp(Math.round(wx / cell), 0, res - 1);
    var zi = clamp(Math.round(wz / rz), 0, res - 1);
    return gradientAt(H, res, xi, zi, cell, rz);
  }
  // Per-step travel distance for a unit, slowed by terrain grade (steep = slow, cliff = crawl)
  // and by precipitation. Shared by player and AI movement so both obey the terrain.
  function moveStep(d, c, dx, dz, dist, dt) {
    var midx = d.x + dx * 0.5, midz = d.z + dz * 0.5;        // sample ahead (toward the step)
    var g = gradientAtWorld(clamp(midx, 0, map.size_m[0]), clamp(midz, 0, map.size_m[1]));
    var terr = g >= SLOPE_T.cliff ? 0.12 : g >= SLOPE_T.steep ? 0.4 : g >= SLOPE_T.moderate ? 0.7 : 1.0;
    var step = c.speed * dt * terr;
    if (step > dist) step = dist;
    return step;
  }

  // ---------- ENEMY AI (maneuvering opponent) ----------
  // Hostiles are no longer stationary turrets. On a slow cadence each hostile picks a move target
  // by STANCE: advance on the objective / nearest foe, but stop at a stand-off just inside its own
  // gun range with line of sight, so it fights from good ground instead of walking into point blank.
  // Cheap: runs every AI_PERIOD sim-seconds, straight-line targets (no full pathfinder), which is
  // plenty for a readable demo battle.
  var AI_PERIOD = 1.6;
  function enemyAI(dt) {
    cmd._aiTimer = (cmd._aiTimer || 0) + dt;
    if (cmd._aiTimer < AI_PERIOD) return;
    cmd._aiTimer = 0;
    // objective point the enemy contests (defends/attacks the player's objective flag)
    var obj = cmd.objective ? cmd.objective.userData : null;
    units.forEach(function (g) {
      var d = g.userData, c = d.cmd;
      if (!c || c.ko || d.side !== "hostile" || d.rangeM <= 0) return;
      // nearest living friendly = primary threat/target
      var foe = null, foeD = Infinity;
      units.forEach(function (e) {
        var ed = e.userData;
        if (ed.side !== "friend" || !ed.cmd || ed.cmd.ko) return;
        var dd = Math.hypot(ed.x - d.x, ed.z - d.z);
        if (dd < foeD) { foeD = dd; foe = e; }
      });
      if (!foe) { c.aiTarget = null; return; }
      var fd = foe.userData;
      var standoff = d.rangeM * 0.75;                 // fight from ~75% of max range
      var haveLOS = hasLOS(d.x, d.z, d.eye, fd.x, fd.z, fd.eye);
      // If already in range AND with LOS, hold position and shoot (stepEngage does the firing).
      if (foeD <= d.rangeM && haveLOS) { c.aiTarget = null; return; }
      // Otherwise move to a stand-off point toward the foe (or toward the objective if defending).
      var tx, tz;
      var anchorX = obj ? obj.fx : fd.x, anchorZ = obj ? obj.fz : fd.z;
      // aim for a point 'standoff' metres from the foe, along the foe->self direction (keep distance)
      var vx = d.x - fd.x, vz = d.z - fd.z, vlen = Math.hypot(vx, vz) || 1;
      tx = fd.x + vx / vlen * standoff;
      tz = fd.z + vz / vlen * standoff;
      // blend a little toward the objective so defenders converge on the contested ground
      if (obj) { tx = tx * 0.7 + anchorX * 0.3; tz = tz * 0.7 + anchorZ * 0.3; }
      c.aiTarget = { x: clamp(tx, 0, map.size_m[0]), z: clamp(tz, 0, map.size_m[1]) };
    });
  }

  var ARRIVE_M = 50;
  function stepCommandSim(dt) {
    if (!cmd.on || !cmd.playing) return;
    dt = Math.min(dt, 0.1) * simSpeed;   // SPEED control scales movement + combat rate (item G13)
    var moved = false;
    enemyAI(dt);   // hostiles think + set their own move targets (maneuvering opponent)
    units.forEach(function (g) {
      var d = g.userData, c = d.cmd;
      if (!c || c.ko) return;
      // --- MOVEMENT toward current flag (player units) ---
      if (c.flags.length && c.targetIdx < c.flags.length) {
        var f = c.flags[c.targetIdx].userData;
        var dx = f.fx - d.x, dz = f.fz - d.z;
        var dist = Math.hypot(dx, dz);
        if (dist <= ARRIVE_M) {
          // reached this flag: remove it from the world (I6 — flags disappear on arrival),
          // then advance to the next waypoint. When the last one is consumed, orders are done.
          if (cmd.flagGroup && c.flags[c.targetIdx]) cmd.flagGroup.remove(c.flags[c.targetIdx]);
          c.flags[c.targetIdx] = null;
          c.targetIdx++;
          if (c.targetIdx >= c.flags.length) {
            c.flags = []; c.targetIdx = 0; c.firingTo = c.firingTo;   // clear consumed order chain
            moved = true;
          }
          drawOrderLines();
        } else {
          var step = moveStep(d, c, dx, dz, dist, dt);
          d.x += dx / dist * step; d.z += dz / dist * step;
          var ny = heightAt(clamp(d.x,0,map.size_m[0]), clamp(d.z,0,map.size_m[1]));
          g.position.set(d.x, ny, d.z);
          d.eye = ny + d._eyeOff;
          g.rotation.y = Math.atan2(dx, dz);   // face travel direction
          moved = true;
        }
      // --- MOVEMENT toward AI target (hostile units) ---
      } else if (c.aiTarget) {
        var ax = c.aiTarget.x - d.x, az = c.aiTarget.z - d.z;
        var adist = Math.hypot(ax, az);
        if (adist > ARRIVE_M) {
          var astep = moveStep(d, c, ax, az, adist, dt);
          d.x += ax / adist * astep; d.z += az / adist * astep;
          var any = heightAt(clamp(d.x,0,map.size_m[0]), clamp(d.z,0,map.size_m[1]));
          g.position.set(d.x, any, d.z);
          d.eye = any + d._eyeOff;
          g.rotation.y = Math.atan2(ax, az);
          moved = true;
        }
      }
      // --- ENGAGEMENT ---
      stepEngage(g, dt);
    });
    if (cmd._warmup) return;   // fast-forward: skip per-step redraws/overlays/fx
    if (moved) { drawOrderLines(); }
    // keep the selected unit's overlays roughly current without thrashing every frame
    cmd._ovTimer = (cmd._ovTimer || 0) + dt;
    if (moved && cmd._ovTimer > 0.5) {
      cmd._ovTimer = 0;
      if (selected) { rebuildOverlays(); renderTargetingComputer(selected); }  // firing solutions follow movement
    }
    updateFiringFx();
    drawTrajectories();      // F3/F5: parabolic fire arcs for all engaging units
    checkFlagshipNet();
    evalObjective(dt);
    if (selected) updateFirePanel(selected);   // F2: live maths readout for the selected gun
  }

  // ---------- OBJECTIVE RESOLUTION (web demo win/lose) ----------
  // Mirrors the Unity ObjectiveSystem: per scenario, decide victory/defeat each step and surface
  // progress (hold timer / convoy distance / kills) in the OBJECTIVE readout, then freeze on result.
  function aliveCount(side) {
    var n = 0; units.forEach(function (g) {
      if (g.userData.side === side && g.userData.cmd && !g.userData.cmd.ko) n++;
    }); return n;
  }
  function nearObjective(side) {
    if (!cmd.objective) return false;
    var o = cmd.objective.userData, hit = false;
    units.forEach(function (g) {
      var d = g.userData;
      if (d.side === side && d.cmd && !d.cmd.ko &&
          Math.hypot(d.x - o.fx, d.z - o.fz) < cmd.objCapM) hit = true;
    }); return hit;
  }
  function unitByNamePart(part) {
    for (var i = 0; i < units.length; i++)
      if (units[i].userData.name && units[i].userData.name.indexOf(part) >= 0) return units[i];
    return null;
  }
  function setObjReadout(txt) {
    var co = document.getElementById("cObj"); if (co) co.textContent = txt;
  }
  function evalObjective(dt) {
    if (!cmd.on || cmd.outcome || !cmd.objWin) return;
    var friend = aliveCount("friend"), enemy = aliveCount("hostile");
    if (friend === 0) { return objectiveOutcome("lose", "FORCE ELIMINATED"); }

    if (cmd.objWin === "eliminate") {
      if (enemy === 0) return objectiveOutcome("win", "ENEMY ELIMINATED");
      setObjReadout((cmd._objName || "ELIMINATE") + " — " + enemy + " left");

    } else if (cmd.objWin === "hold") {
      var held = nearObjective("friend"), contested = nearObjective("hostile");
      if (held && !contested) cmd.objHold += dt;
      else cmd.objHold = Math.max(0, cmd.objHold - dt * 0.5);
      setObjReadout("HOLD " + Math.floor(cmd.objHold) + "/" + cmd.objHoldReq + "s" +
                    (contested ? " (CONTESTED)" : held ? "" : " (UNHELD)"));
      if (cmd.objHold >= cmd.objHoldReq) return objectiveOutcome("win", "OBJECTIVE SECURED");
      if (enemy === 0) return objectiveOutcome("win", "ENEMY ELIMINATED");

    } else if (cmd.objWin === "escort") {
      var convoy = unitByNamePart("CONVOY");
      if (!convoy || convoy.userData.cmd.ko) return objectiveOutcome("lose", "CONVOY LOST");
      if (cmd.objective) {
        var o = cmd.objective.userData;
        var dist = Math.hypot(convoy.userData.x - o.fx, convoy.userData.z - o.fz);
        if (dist < cmd.objCapM) return objectiveOutcome("win", "CONVOY REACHED EXIT");
        setObjReadout("CONVOY " + (dist / 1000).toFixed(1) + "km FROM EXIT");
      }
    }
  }
  function objectiveOutcome(result, msg) {
    cmd.outcome = result;
    showObjectiveBanner(result, msg);
    setPlaying(false);                          // freeze the battle on a result
    combatLog('<span class="' + (result === "win" ? "a" : "h") + '">' +
              (result === "win" ? "VICTORY" : "DEFEAT") + " — " + msg + '</span>',
              result === "win" ? "hit" : "ko");
  }
  function showObjectiveBanner(result, msg) {
    var b = document.getElementById("objBanner");
    if (!b) {
      b = document.createElement("div"); b.id = "objBanner";
      document.body.appendChild(b);
    }
    b.className = result;                        // .win / .lose styles colour it
    b.innerHTML = '<div class="bt">' + (result === "win" ? "VICTORY" : "DEFEAT") +
                  '</div><div class="bs">' + msg + '</div>';
    b.style.display = "block";
  }
  function hideObjectiveBanner() {
    var b = document.getElementById("objBanner"); if (b) b.style.display = "none";
  }

  // Decide a unit's combat target and resolve damage over time. Units FIRE WHILE MOVING
  // (item G14): any armed unit with an enemy in range + LOS engages it, even en route to a flag.
  // A HOLD order makes a unit hold fire (overwatch only fires if attacked); everything else fires
  // reactively. dps is much lower now (item G13) so kills take a satisfying time.
  // O1: does the SHOOTER have a working firing solution on the TARGET, and by which trajectory?
  // Returns { mode, dmgMult } or null. DIRECT needs direct LOS; INDIRECT needs an arc that clears
  // terrain AND a spotter (any on-net friendly of the shooter's side with LOS to the target);
  // HIGH-ANGLE needs the (shorter) lob arc to reach. Damage scales down for indirect/high-angle
  // (looser than aimed direct fire — ref doctrine accuracy ladder).
  function engagementSolution(shooter, tgt, dist) {
    if (!terrainField) return { mode: "direct", dmgMult: 1 };
    var t = map.terrain, res = t.res, H = t.heights, cell = t.cell_m;
    var rz = map.size_m[1] / (res - 1);
    var ex = shooter.x, ez = shooter.z, ey = shooter.eye + 6;
    var tx = tgt.x, tz = tgt.z, ty = tgt.eye + 3;
    var v = muzzleSpeed(shooter.rangeM);
    // 1) DIRECT — flat, needs true LOS
    if (hasLOS(shooter.x, shooter.z, shooter.eye, tgt.x, tgt.z, tgt.eye)) {
      var pd = trajParams("direct");
      if (canHit(ex, ez, ey, tx, tz, ty, res, H, cell, rz, v, pd, shooter.rangeM * pd.reachMul))
        return { mode: "direct", dmgMult: 1.0 };
    }
    // 2) INDIRECT — arced; needs a spotter (on-net friendly seeing the target) + arc clears terrain
    var pi = trajParams("indirect");
    if (dist <= shooter.rangeM * pi.reachMul && hasSpotter(shooter, tgt) &&
        canHit(ex, ez, ey, tx, tz, ty, res, H, cell, rz, v, pi, shooter.rangeM * pi.reachMul))
      return { mode: "indirect", dmgMult: 0.7 };
    // 3) HIGH-ANGLE / MORTAR — short range plunge into defilade; needs a spotter too
    var pm = trajParams("mortar");
    if (dist <= shooter.rangeM * pm.reachMul && hasSpotter(shooter, tgt) &&
        canHit(ex, ez, ey, tx, tz, ty, res, H, cell, rz, v, pm, shooter.rangeM * pm.reachMul))
      return { mode: "mortar", dmgMult: 0.55 };
    return null;
  }
  // A spotter = the shooter itself has LOS, OR any living on-net friendly of the same side has LOS
  // to the target (so indirect fire can be observed & corrected).
  function hasSpotter(shooter, tgt) {
    if (hasLOS(shooter.x, shooter.z, shooter.eye, tgt.x, tgt.z, tgt.eye)) return true;
    for (var i = 0; i < units.length; i++) {
      var od = units[i].userData;
      if (od === shooter || od.side !== shooter.side || !od.cmd || od.cmd.ko) continue;
      if (od.offNet) continue;                          // off the comms net -> can't relay a correction
      if (hasLOS(od.x, od.z, od.eye, tgt.x, tgt.z, tgt.eye)) return true;
    }
    return false;
  }

  function stepEngage(g, dt) {
    var d = g.userData, c = d.cmd;
    if (d.side === "civ" || d.rangeM <= 0) { stopFiring(g); return; }
    // a pure HOLD posture holds fire unless already engaged this exchange
    var lastFlag = c.flags.length ? c.flags[c.targetIdx >= c.flags.length ? c.flags.length-1 : c.targetIdx].userData : null;
    var holdFire = (lastFlag && lastFlag.type === "hold") && !d._engageAll;
    // friendly engages hostiles; hostile engages friendlies (so the demo fights back)
    var enemySide = d.side === "friend" ? "hostile" : "friend";
    // O1: BALLISTIC engageability — a unit can engage only if some trajectory actually reaches the
    // target through terrain: DIRECT (needs LOS), INDIRECT (arced, needs a spotter on the net with
    // LOS), or HIGH-ANGLE/MORTAR (short range, plunges into defilade). Flat-LOS-only is gone.
    var target = null, bestD = Infinity, bestSol = null;
    units.forEach(function (e) {
      if (e === g) return;
      var ed = e.userData;
      if (ed.side !== enemySide || ed.cmd.ko) return;
      var dist = Math.hypot(ed.x - d.x, ed.z - d.z);
      if (dist > d.rangeM) return;                       // OUT OF RANGE: cannot engage
      var sol = engagementSolution(d, ed, dist);
      if (!sol) return;                                  // masked / no arc reaches / no spotter
      if (dist < bestD) { bestD = dist; target = e; bestSol = sol; }
    });
    if (target && !holdFire) {
      c.fireSol = bestSol;                               // remember trajectory used (for arcs/log)
      var firstShot = (c.firingTo !== target);
      c.firingTo = target;
      target.userData._firedOn = true;            // I4: mark target as being fired on this frame
      // hit model: damage rate scales with closeness within range AND the trajectory's accuracy
      // (direct is tightest; indirect/high-angle are looser — ref doctrine accuracy ladder).
      var rangeFrac = bestD / d.rangeM;            // 0=point blank, 1=max range
      var solMult = (bestSol && bestSol.dmgMult) ? bestSol.dmgMult : 1;
      var dps = (1.2 + 3.0 * (1 - rangeFrac)) * solMult;   // SLOW so battles last long enough to watch
      var td = target.userData.cmd;
      var before = td.struct;
      td.struct -= dps * dt;
      if (c.ammo != null) c.ammo = Math.max(0, c.ammo - dps * dt * 0.4);   // consume ammunition
      // FIRE cadence: a discrete "shot" muzzle flash + boom + impact + log roughly every ~0.7s
      c.fireTimer = (c.fireTimer || 0) + dt;
      if (firstShot || c.fireTimer >= 0.7) {
        c.fireTimer = 0;
        if (!cmd._warmup) { spawnMuzzleFlash(d); spawnImpact(target.userData); playSfx("fire"); }
        var gun = gunLabel(d);                        // which armament fired
        var shooterCls = d.side === "friend" ? "a" : "h";
        var tgtCls = target.userData.side === "friend" ? "a" : "h";
        var trajTxt = c.fireSol ? (c.fireSol.mode === "direct" ? "DIRECT" : c.fireSol.mode === "indirect" ? "INDIRECT" : "HIGH-ANGLE") : "";
        if (firstShot) {
          combatLog('<span class="' + shooterCls + '">' + d.name + '</span> engages <span class="' +
                    tgtCls + '">' + target.userData.name + '</span> <span class="dim">[' + gun + (trajTxt ? " \u00B7 " + trajTxt : "") + ']</span>',
                    d.side === "friend" ? "friend" : "");
        } else if (Math.floor(before / 20) !== Math.floor(td.struct / 20)) {
          // K1/K2: log WHO hit WHAT with WHICH gun; for FRIENDLY fire record the impact ZONE.
          var zone = hitZone(bestD, d.rangeM);       // SIDE / DECK / GLACIS from range (angle of fall)
          var zoneTxt = d.side === "friend" ? ' <span class="dim">on ' + zone + '</span>' : '';
          combatLog('<span class="' + shooterCls + '">' + d.name + '</span> hits <span class="' + tgtCls +
                    '">' + target.userData.name + '</span> <span class="dim">[' + gun + ']</span>' + zoneTxt +
                    ' &middot; struct ' + Math.max(0, Math.round(td.struct)) + '%', "hit");
        }
      }
      if (td.struct <= 0) { td.struct = 0; knockOut(target); }
      updateStructBar(target);
    } else {
      stopFiring(g);
    }
  }
  function stopFiring(g) {
    var c = g.userData.cmd; if (c) { c.firingTo = null; c.fireTimer = 0; c.fireSol = null; }
  }
  // A short armament label for the combat log (strips any trailing "(18km)" range tag).
  function gunLabel(d) {
    var g = String(d.gun || "GUN").replace(/\s*\([^)]*\)\s*$/, "").trim();
    return g || "MAIN GUN";
  }
  // Which armour face a shot strikes, from range as a proxy for angle of fall (ref ARTILLERY
  // doctrine §4): short range = shallow fall = SIDE/GLACIS; long range = steep fall = DECK (top).
  function hitZone(dist, maxR) {
    var f = maxR > 0 ? dist / maxR : 0;
    return f > 0.75 ? "DECK" : f > 0.45 ? "SIDE" : "GLACIS";
  }

  function knockOut(g) {
    var c = g.userData.cmd; if (c.ko) return;
    c.ko = true; c.firingTo = null;
    combatLog('<span class="h">' + g.userData.name + '</span> KNOCKED OUT', "ko");
    if (!cmd._warmup) playSfx("impact");
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

  // ---- FIRE EFFECTS: muzzle flash + impact spark (item G16) --------------------
  // Short-lived additive sprites in cmd.fxGroup. Each carries {born, life} in userData;
  // updateFxSprites() fades + removes them. Cheap point-like flashes, Eva-warm.
  var fxFlashTex = null, fxSparkTex = null;
  function flashTexture(inner, outer) {
    var S = 64, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    var g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
    g.addColorStop(0, inner); g.addColorStop(0.4, outer); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    var tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true; return tex;
  }
  function spawnFx(x, y, z, tex, size, life) {
    if (!cmd.fxGroup) return;
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 }));
    spr.scale.set(size, size, 1); spr.position.set(x, y, z); spr.renderOrder = 30;
    spr.userData = { born: performance.now(), life: life, size0: size };
    cmd.fxGroup.add(spr);
  }
  function spawnMuzzleFlash(d) {
    if (!fxFlashTex) fxFlashTex = flashTexture("rgba(255,236,170,1)", "rgba(255,150,40,0.7)");
    var span = Math.max(map.size_m[0], map.size_m[1]);
    spawnFx(d.x, d.eye + 4, d.z, fxFlashTex, span * 0.012, 180);
  }
  function spawnImpact(td) {
    if (!fxSparkTex) fxSparkTex = flashTexture("rgba(255,210,150,1)", "rgba(220,80,50,0.7)");
    var span = Math.max(map.size_m[0], map.size_m[1]);
    spawnFx(td.x, td.eye + 6, td.z, fxSparkTex, span * 0.010, 260);
  }
  // Per-frame: fade and retire FX sprites.
  function updateFxSprites() {
    if (!cmd.fxGroup) return;
    var now = performance.now(), rm = [];
    cmd.fxGroup.children.forEach(function (o) {
      if (!o.userData || !o.userData.life) return;
      var t = (now - o.userData.born) / o.userData.life;
      if (t >= 1) { rm.push(o); return; }
      o.material.opacity = (1 - t);
      var s = o.userData.size0 * (1 + t * 0.8);
      o.scale.set(s, s, 1);
    });
    rm.forEach(function (o) { cmd.fxGroup.remove(o); if (o.material.map) {} o.material.dispose(); });
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
    d.cmd.struct = 100; d.cmd.ko = false; d.cmd.speed = classSpeed(cls); d.cmd.aiTarget = null;
    d.cmd.ammoMax = cls === "Siege" ? 40 : cls === "Convoy" ? 200 : 80; d.cmd.ammo = d.cmd.ammoMax;
    d.cmd.onFire = false; d._statusKey = "";
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
    clearSuburbObjectives();
    units.forEach(function (g) { clearOrders(g); });
    // reset objective resolution for the new scenario
    cmd.objHold = 0; cmd.outcome = ""; hideObjectiveBanner();
    cmd.objWin = key === "harbour_crossing" ? "hold"
              : key === "ridge_defence"    ? "eliminate"
              : key === "convoy_escort"    ? "escort" : "";
    var u = units;   // 6 demo units
    var objName = "—";
    if (key === "harbour_crossing") {
      // friendlies south of harbour, objective on far north shore, 2 enemies defending
      relabelUnit(u[0], "ANZAC-01", "friend", "Line",  "BR-155", 6500, W*0.42, L*0.14, "Assault element. Crossing the harbour to seize the north shore.");
      relabelUnit(u[1], "ANZAC-02", "friend", "Siege", "SG-305", 9500, W*0.55, L*0.10, "Siege support. Flagship — directs the crossing.");
      relabelUnit(u[2], "ANZAC-03", "friend", "Recon", "SR-76",  2800, W*0.66, L*0.18, "Amphibious scout. Leads the water crossing.");
      relabelUnit(u[3], "ANZAC-04", "friend", "Line",  "BR-120", 5000, W*0.34, L*0.18, "Flank guard.");
      relabelUnit(u[4], "DEFENDER-1", "hostile", "Line", "?-150 (defending)", 6000, W*0.46, L*0.86, "Dug in on the north shore objective.");
      relabelUnit(u[5], "DEFENDER-2", "hostile", "Line", "?-130 (defending)", 5000, W*0.58, L*0.88, "Second defender covering the objective.");
      placeObjective(W*0.50, L*0.90, "NORTH SHORE — far harbour bank");
      flagNearestSuburb(W*0.50, L*0.90, "hold");     // mark the north-shore suburb as a hold site
      objName = "SEIZE NORTH SHORE";
      setFlagship(u[1]);
    } else if (key === "ridge_defence") {
      // friendlies on high ground, enemies attacking from low, HOLD flag on crest
      relabelUnit(u[0], "ANZAC-01", "friend", "Line",  "BR-155", 6500, 1084, 8801, "Holding the high crest. Flagship.");
      relabelUnit(u[1], "ANZAC-02", "friend", "Siege", "SG-305", 9500, 1500, 8500, "Siege gun on the ridge — dominates the approaches.");
      relabelUnit(u[2], "ANZAC-03", "friend", "Recon", "SR-76",  2800,  800, 9100, "Spotter on the flank of the ridge.");
      relabelUnit(u[3], "ANZAC-04", "friend", "Line",  "BR-120", 5000, 1300, 9200, "Reserve, just behind the crest.");
      relabelUnit(u[4], "RAIDER-1", "hostile", "Line", "?-150 (attacking)", 5500, 3200, 7000, "Attacking uphill from the low ground.");
      relabelUnit(u[5], "RAIDER-2", "hostile", "Line", "?-150 (attacking)", 5500, 2400, 6400, "Second attacker pushing the ridge.");
      placeObjective(1084, 8801, "HOLD THE CREST");
      flagNearestSuburb(1084, 8801, "hold");
      objName = "HOLD THE CREST";
      setFlagship(u[0]);
    } else if (key === "convoy_escort") {
      // a slow convoy must reach an exit flag; raiders intercept
      relabelUnit(u[0], "CONVOY-LEAD", "friend", "Convoy", "MG-30", 1500, W*0.12, L*0.30, "Slow convoy. Must reach the EXIT. Flagship.");
      relabelUnit(u[1], "ESCORT-1", "friend", "Line",  "BR-120", 5000, W*0.16, L*0.36, "Close escort.");
      relabelUnit(u[2], "ESCORT-2", "friend", "Recon", "SR-76",  2800, W*0.10, L*0.24, "Outrider — screens ahead.");
      relabelUnit(u[3], "ESCORT-3", "friend", "Line",  "BR-155", 6500, W*0.18, L*0.30, "Rear guard.");
      relabelUnit(u[4], "RAIDER-1", "hostile", "Recon", "?-90 (raider)", 3200, W*0.55, L*0.55, "Fast raider trying to intercept the convoy.");
      relabelUnit(u[5], "RAIDER-2", "hostile", "Line",  "?-120 (raider)", 5000, W*0.72, L*0.40, "Second raider closing on the route.");
      placeObjective(W*0.88, L*0.62, "CONVOY EXIT");
      flagNearestSuburb(W*0.88, L*0.62, "protect");
      objName = "GET CONVOY TO EXIT";
      setFlagship(u[0]);
    }
    // ensure the neon suburb markers are visible so the flagged objective site reads
    if (!show.suburbs) { show.suburbs = true;
      if (suburbGroup) suburbGroup.visible = true;
      var sb = document.getElementById("tSub"); if (sb) sb.classList.add("on");
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

  // Flag the suburb marker nearest a map point as an objective site (item E9). state =
  // "hold"|"protect". Returns the marker (or null). Used by scenarios to colour a neon ring.
  function flagNearestSuburb(x, z, state) {
    if (!suburbMarkers || !suburbMarkers.length) return null;
    var best = null, bd = Infinity;
    suburbMarkers.forEach(function (m) {
      var dd = (m.x - x) * (m.x - x) + (m.z - z) * (m.z - z);
      if (dd < bd) { bd = dd; best = m; }
    });
    if (best) return setSuburbObjective(best.name, state);
    return null;
  }
  // Reset all suburb objective states back to plain neon (called when a scenario reloads).
  function clearSuburbObjectives() {
    (suburbMarkers || []).forEach(function (m) { if (m.objState) setSuburbObjective(m.name, null); });
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
    // nudge everyone forward a bit so the screenshot shows motion + tracers immediately.
    // Warm the sim a while so units close to contact and exchange fire (slow speeds now).
    units.forEach(function (g) { g.userData._engageAll = true; });
    // run the sim forward enough wall-time that attackers close to contact and exchange fire
    // (slow speeds now). This is headless setup only — it primes the screenshot with combat.
    // cmd._warmup suppresses per-shot FX/sound spam while fast-forwarding.
    var savedSpeed = simSpeed; simSpeed = 1; cmd._warmup = true;
    for (var i = 0; i < 2100; i++) stepCommandSim(0.1);
    cmd._warmup = false; simSpeed = savedSpeed;
    drawOrderLines(); if (selected) rebuildOverlays();
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
    if (cmd.on) updateFxSprites();       // fade muzzle/impact flashes

    // decay the mini combat log over real time (re-render ~4x/sec even with no new lines)
    _clogDecayT = (_clogDecayT || 0) + dt;
    if (cmd.on && _clogDecayT > 0.25) { _clogDecayT = 0; renderClog(); }

    // I4/I5: per-frame marker upkeep — fired-on red ring + ammo/status strip.
    if (cmd.on) {
      for (var mi = 0; mi < units.length; mi++) {
        var mu = units[mi], md = mu.userData;
        if (md.firedMat) {
          var want = (cmd.playing && md._firedOn && markersOn) ? (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() * 0.012))) : 0;
          md.firedMat.opacity = want;
        }
        md._firedOn = false;                 // cleared; re-set by stepEngage if still targeted
        updateStatusSprite(mu);
      }
    }

    // HUD compass rose: follow the live camera heading vs TRUE north
    updateCompassHud();
    // refresh the selected unit's facing dial (it rotates as it moves under command sim)
    if (selected && document.getElementById("unit").style.display !== "none") updateUnitFacing(selected);

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
    renderCombatPOV();      // L1: picture-in-picture down the firing unit's LOS to its target
    renderPortrait();       // J1: mini live render of the selected crab in the unit panel
  }

  // ---------- J1: SELECTED-UNIT PORTRAIT ----------
  var portraitCam = null;
  function renderPortrait() {
    var wrap = document.getElementById("uPortraitWrap");
    var panel = document.getElementById("unit");
    if (!wrap || !panel || panel.style.display === "none" || !selected) return;
    var d = selected.userData; if (d.x == null) return;
    if (!portraitCam) portraitCam = new THREE.PerspectiveCamera(38, 74 / 60, 1, 100000);
    // slow auto-orbit around the crab hull so you can see its shape + facing
    var ang = performance.now() * 0.0006;
    var ground = heightAt(d.x, d.z);
    var bodyH = (d._eyeOff || 6) * 1.2;                 // approx hull mid height
    var center = new THREE.Vector3(d.x, ground + bodyH, d.z);
    var rad = Math.max(28, (d._eyeOff || 6) * 6);       // close framing on the crab
    portraitCam.position.set(d.x + Math.cos(ang) * rad, ground + bodyH + rad * 0.45, d.z + Math.sin(ang) * rad);
    portraitCam.lookAt(center);
    var r = wrap.getBoundingClientRect();
    var glH = renderer.domElement.clientHeight, pr = renderer.getPixelRatio();
    // convert CSS top-left rect to GL bottom-left viewport
    var vx = r.left, vy = glH - r.bottom, vw = r.width, vh = r.height;
    if (vw < 4 || vh < 4) return;
    // hide the markers of the selected unit briefly so the portrait shows the model, not the billboard
    var hid = [d.marker, d.label, d.selRing, d.firedRing, d.halo, d.statusSprite, d.offTag];
    hid.forEach(function (o) { if (o) o.visible = false; });
    renderer.setScissorTest(true);
    renderer.setViewport(vx * pr, vy * pr, vw * pr, vh * pr);
    renderer.setScissor(vx * pr, vy * pr, vw * pr, vh * pr);
    portraitCam.aspect = vw / vh; portraitCam.updateProjectionMatrix();
    renderer.render(scene, portraitCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, renderer.domElement.clientWidth * pr, glH * pr);
    hid.forEach(function (o) { if (o) o.visible = (o === d.marker || o === d.label || o === d.statusSprite) ? markersOn : o.visible; });
    if (d.selRing && d.selMat) d.selMat.opacity = markersOn ? 1 : 0;   // restore selection ring
  }

  // ---------- L1: COMBAT POV VIEWER ----------
  // A small inset that looks from a firing crab down its line of sight to the target it's engaging.
  // Prefers the SELECTED unit's target; else any active friendly engagement. Toggle with the
  // COMBAT VIEW button; auto-hides when nothing is firing.
  var povCamera = null, povOn = true;
  function pickPovPair() {
    // selected friendly firing?
    if (selected && selected.userData.cmd && selected.userData.cmd.firingTo &&
        !selected.userData.cmd.firingTo.userData.cmd.ko)
      return { from: selected.userData, to: selected.userData.cmd.firingTo.userData };
    // else first friendly engagement, else any engagement
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < units.length; i++) {
        var d = units[i].userData, c = d.cmd;
        if (!c || c.ko || !c.firingTo || c.firingTo.userData.cmd.ko) continue;
        if (pass === 0 && d.side !== "friend") continue;
        return { from: d, to: c.firingTo.userData };
      }
    }
    return null;
  }
  function renderCombatPOV() {
    var host = document.getElementById("povView");
    if (!cmd.on || !povOn) { if (host) host.style.display = "none"; return; }
    var pair = pickPovPair();
    if (!pair) { if (host) host.style.display = "none"; return; }
    if (host) host.style.display = "block";
    if (!povCamera) povCamera = new THREE.PerspectiveCamera(35, 1.6, 1, Math.max(map.size_m[0], map.size_m[1]) * 3);
    var f = pair.from, t = pair.to;
    // eye just above/behind the gun, looking at the target
    var eye = new THREE.Vector3(f.x, f.eye + 14, f.z);
    var tgt = new THREE.Vector3(t.x, t.eye + 4, t.z);
    // pull back slightly behind the gun along the reverse LOS so we see our own muzzle
    var dir = new THREE.Vector3().subVectors(tgt, eye).normalize();
    eye.addScaledVector(dir, -70);
    povCamera.position.copy(eye);
    povCamera.lookAt(tgt);
    // viewport rectangle (bottom-right, above the conditions panel), in device pixels
    var W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    var pw = Math.min(320, W * 0.24), ph = pw / 1.6;
    var px = W - pw - 14, py = 150;   // from bottom-left origin of the GL viewport
    // size the DOM frame to match
    host.style.width = pw + "px"; host.style.height = ph + "px";
    var pr = renderer.getPixelRatio();
    renderer.setScissorTest(true);
    renderer.setViewport(px * pr, py * pr, pw * pr, ph * pr);
    renderer.setScissor(px * pr, py * pr, pw * pr, ph * pr);
    povCamera.aspect = pw / ph; povCamera.updateProjectionMatrix();
    renderer.render(scene, povCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W * pr, H * pr);
    var lbl = document.getElementById("povLabel");
    if (lbl) lbl.textContent = f.name + " \u2192 " + t.name;
  }

  init();
})();
