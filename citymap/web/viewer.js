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

  var COL = {
    bg: 0x0b0d0c, water: 0x16302e, los: 0x6db48f, range: 0xb0822c,
    friend: 0x3e7a74, hostile: 0x9a3a33, civ: 0x7a6a3a,
  };

  var viewMode = (new URLSearchParams(location.search).get("mode") === "elevation") ? "elevation" : "shaded";

  var scene, camera, renderer, controls, raycaster, mouse;
  var map = null, terrainMesh = null, terrainField = null, buildingsGroup = null;
  var unitsGroup = null, overlayGroup = null, wireMesh = null;
  var windGroup = null, rainGroup = null;
  var units = [], selected = null;
  var show = { los: true, range: true, bld: true, wire: false, wind: false, rain: false };

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

    buildCitySelect();
    bindUI();
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
    [terrainMesh, buildingsGroup, unitsGroup, overlayGroup, wireMesh, windGroup, rainGroup].forEach(function (o) {
      if (o) { scene.remove(o); }
    });
    terrainMesh = buildingsGroup = unitsGroup = overlayGroup = wireMesh = null;
    windGroup = rainGroup = null;
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

  function buildBuildings() {
    buildingsGroup = new THREE.Group();
    var matLow = new THREE.MeshStandardMaterial({ color: 0x4b524b, roughness: 0.9, metalness: 0 });
    var matMid = new THREE.MeshStandardMaterial({ color: 0x565d54, roughness: 0.88 });
    var matHigh = new THREE.MeshStandardMaterial({ color: 0x646b60, roughness: 0.85 });
    var n = map.buildings.length;
    for (var i = 0; i < n; i++) {
      var b = map.buildings[i];
      var mesh = extrude(b);
      if (mesh) buildingsGroup.add(mesh);
    }
    buildingsGroup.visible = show.bld;
    scene.add(buildingsGroup);

    function extrude(b) {
      var p = b.poly; if (!p || p.length < 3) return null;
      var shape = new THREE.Shape();
      shape.moveTo(p[0][0], p[0][1]);
      for (var k = 1; k < p.length; k++) shape.lineTo(p[k][0], p[k][1]);
      var h = Math.max(3, b.h || 8);
      var g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);              // extrude up Y
      var m = h > 60 ? matHigh : (h > 20 ? matMid : matLow);
      var mesh = new THREE.Mesh(g, m);
      mesh.position.y = b.base_m || 0;       // sit on terrain
      return mesh;
    }
  }

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
    // The terrain texture is ALWAYS clearly readable. The viewshed is a SUBTLE overlay:
    //   - VISIBLE areas         -> gentle warm gold lift     (vcol ~1.0 .. 1.18)
    //   - HIDDEN-but-in-range    -> very slightly dimmed cool (vcol ~0.86)
    //   - OUT-OF-RANGE          -> a touch dimmer still       (vcol ~0.78, still very legible)
    for (var zi = 0; zi < res; zi++) {
      for (var xi = 0; xi < res; xi++) {
        var idx = zi * res + xi;
        var wx = xi * cell, wz = zi * rz;
        var dist = Math.hypot(wx - ex, wz - ez);
        var r, gg, bb;
        if (dist > sightM) {
          // beyond sight: keep the map fully readable, only the faintest cool dim
          r = 0.80; gg = 0.81; bb = 0.84;
        } else {
          var clear = losGrid(ex, ez, ey, wx, wz, H[idx] + 1, res, H, cell, rz);
          if (clear) {
            // warm highlight that fades with distance but never washes the detail out
            var lit = clamp(1 - (dist / sightM) * 0.7, 0.25, 1);  // strength of the glow
            r = 1.0 + lit * 0.20; gg = 0.98 + lit * 0.16; bb = 0.86 + lit * 0.06;
          } else {
            // in range but blocked by terrain: only a gentle cool dim (NOT a black mask)
            r = 0.84; gg = 0.85; bb = 0.88;
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

    // VIEWSHED light-cast: highlight everything this unit can see.
    if (show.los) computeViewshed(u); else clearViewshed();

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
        if (key === "bld" && buildingsGroup) buildingsGroup.visible = show.bld;
        else if (key === "wire" && wireMesh) wireMesh.visible = show.wire;
        else if (key === "wind" && windGroup) windGroup.visible = show.wind;
        else if (key === "rain" && rainGroup) rainGroup.visible = show.rain;
        else rebuildOverlays();
      };
    }
  }
  function dolly(f) {
    var dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    dir.multiplyScalar(f); camera.position.copy(controls.target).add(dir); controls.update();
  }

  // ---------- util ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
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
