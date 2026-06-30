/* CITY BATTLE // CRAB FOUNDRY - Rule-the-Waves-style mecha designer.
   Loads the REAL game data (chassis/guns/armor/drones/ew + verpen/horpen penetration
   tables), lets you pick a chassis, allocate per-zone armour, fit guns at POSITIONED
   turret stations (A/B/X/Y centreline + P/S wings) with CONES OF FIRE, fit modules into
   selectable utility slots, and shows a LIVE 3D crab + immunity-zone + broadside readout.
   Auto-derives an RtW class code from the finished stats. Pure Three.js r128 + vanilla JS.

   FRAME (CRAB_CONVENTIONS.md): bow=+Z fore, stern=-Z aft, starboard=+X, port=-X.
   Bearing convention used for arcs: 0deg = dead ahead (bow), +90 = starboard beam,
   180 = astern, 270 (= -90) = port beam. Measured clockwise viewed from above. */
(function () {
  "use strict";
  var T = window.THREE;
  var DATA = "../../../Assets/Resources/CSV/";  // game CSVs (served from project root)

  var DB = { chassis: [], guns: [], armor: [], drones: [], ew: [], verpen: null, horpen: null };
  var design = null, year = 2035;
  var enemyBore = 155;                 // reference enemy gun for immunity-zone readout
  var scene, cam, renderer, controls, crab = null, gridHelper;

  // ===================================================================== CSV ====
  function parseCSV(text) {
    var lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    var head = lines[0].split(",");
    return lines.slice(1).map(function (l) {
      var c = l.split(","), o = {};
      head.forEach(function (h, i) { o[h] = c[i]; });
      return o;
    });
  }
  function num(v) { return parseFloat(v) || 0; }
  // penetration table: header row = ranges (m), each row = caliber -> mm by range
  function parsePenTable(text) {
    var lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    var ranges = lines[0].split(",").slice(1).map(Number);
    var rows = {};
    lines.slice(1).forEach(function (l) {
      var c = l.split(",").map(Number);
      rows[c[0]] = c.slice(1);
    });
    return { ranges: ranges, rows: rows };
  }
  // linear interp of a pen table for a caliber at an arbitrary range (m), mm result
  function penAt(table, cal, rangeM) {
    if (!table) return 0;
    var cals = Object.keys(table.rows).map(Number).sort(function (a, b) { return a - b; });
    // nearest available caliber row (clamp)
    var c = cals[0];
    for (var i = 0; i < cals.length; i++) { if (cals[i] <= cal) c = cals[i]; }
    if (cal > cals[cals.length - 1]) c = cals[cals.length - 1];
    var row = table.rows[c], R = table.ranges;
    if (rangeM <= R[0]) return row[0];
    if (rangeM >= R[R.length - 1]) return row[R.length - 1];
    for (var j = 0; j < R.length - 1; j++) {
      if (rangeM >= R[j] && rangeM <= R[j + 1]) {
        var f = (rangeM - R[j]) / (R[j + 1] - R[j]);
        return row[j] + (row[j + 1] - row[j]) * f;
      }
    }
    return row[row.length - 1];
  }

  function loadData() {
    return Promise.all([
      fetch(DATA + "chassis.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "guns.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "armor.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "drones.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "ew.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "verpen.csv").then(function (r) { return r.text(); }).catch(function () { return ""; }),
      fetch(DATA + "horpen.csv").then(function (r) { return r.text(); }).catch(function () { return ""; }),
    ]).then(function (res) {
      DB.chassis = parseCSV(res[0]).map(function (r) {
        return { id: +r.id, name: r.name, cls: r.class, mass: num(r.mass_budget_t),
          armorBudget: num(r.base_armor_budget_t), legs: +r.num_legs, speed: num(r.base_speed_kmh),
          turn: num(r.turn_rate_dps), wMounts: +r.num_weapon_mounts, uMounts: +r.num_utility_mounts,
          cost: num(r.cost), maint: num(r.maintenance), year: +r.year_available,
          maxCal: num(r.max_mount_caliber_mm), crew: +r.crew, power: num(r.power_output) };
      });
      DB.guns = parseCSV(res[1]).map(function (r) {
        return { id: +r.id, name: r.name, cal: num(r.caliber_mm), shell: num(r.shell_weight_kg),
          rof: num(r.rof_rpm), range: num(r.max_range_m), vel: num(r.muzzle_velocity_ms),
          weight: num(r.weight_t), cost: num(r.cost), year: +r.year_available, type: r.type };
      });
      DB.armor = parseCSV(res[2]).map(function (r) {
        return { id: +r.id, name: r.name, year: +r.year_available, density: num(r.density_kg_per_m2_per_mm),
          quality: num(r.quality_factor), costPerT: num(r.cost_per_t) };
      });
      DB.drones = parseCSV(res[3]).map(function (r) {
        return { id: "D" + r.id, kind: "drone", name: r.name, role: r.role, year: +r.year_available,
          weight: Math.max(1.2, num(r.payload_kg) / 200 + 1.0), cost: num(r.cost), tag: r.payload_type };
      });
      DB.ew = parseCSV(res[4]).map(function (r) {
        return { id: "E" + r.id, kind: "ew", name: r.name, role: r.type, year: +r.year_available,
          weight: num(r.weight_t), cost: num(r.cost), tag: (num(r.radius_m) ? (num(r.radius_m) / 1000) + "km" : "passive") };
      });
      // built-in sensor modules (not in a CSV; classic RtW fire-control / detection fits)
      DB.sensors = [
        { id: "S1", kind: "sensor", name: "Optical Rangefinder", role: "fire_control", year: 2025, weight: 0.6, cost: 600, tag: "ranging" },
        { id: "S2", kind: "sensor", name: "Radar / LIDAR Array", role: "detection", year: 2038, weight: 1.4, cost: 2200, tag: "all-weather" },
        { id: "S3", kind: "sensor", name: "Thermal Imager", role: "detection", year: 2034, weight: 0.8, cost: 1400, tag: "night" },
        { id: "S4", kind: "sensor", name: "Datalink Node", role: "network", year: 2046, weight: 0.7, cost: 1900, tag: "share/drones" },
        { id: "S5", kind: "sensor", name: "Ballistic Computer", role: "fire_control", year: 2042, weight: 1.0, cost: 2600, tag: "computed" },
      ];
      DB.verpen = res[5] ? parsePenTable(res[5]) : null;  // vertical (belt/side) pen mm
      DB.horpen = res[6] ? parsePenTable(res[6]) : null;  // horizontal (deck/top) pen mm
    });
  }

  // module library: everything fittable in a utility slot
  function moduleLib() { return DB.sensors.concat(DB.drones).concat(DB.ew); }
  function findModule(id) { return moduleLib().find(function (m) { return m.id === id; }); }

  // ============================================================ TURRET POSITIONS ==
  // RtW positions adapted to the crab. Each has a hull location (z-frac fore/aft,
  // x-frac port..stbd), a "tier" (riser for superfiring), a bearing-arc and a kind.
  //  A = fore centreline low   B = fore centreline superfiring (over A)
  //  X = aft  centreline superfiring   Y = aft centreline low
  //  P = port wing (midships)   S = starboard wing (midships)
  // Arc = [centre, halfWidth] in degrees (0=ahead, +90=stbd beam, 180=astern, -90=port).
  // Stations are spread along the hull so even the biggest mains (305mm, long
  // barrels) don't intersect. A/Y sit low at the bow/stern ends pointing out;
  // B/X are superfiring (raised one tier AND set ~0.16*L back toward midships)
  // so their barrels clear the roof of the turret in front. Wings sit clearly
  // outboard at midships, firing to their side.
  var POSDEFS = {
    A: { label: "A (fore low)",       grp: "fore", zf: 0.40,  xf: 0,    tier: 0, arc: [0, 150],   wing: false },
    B: { label: "B (fore superfire)", grp: "fore", zf: 0.24,  xf: 0,    tier: 1, arc: [0, 160],   wing: false },
    X: { label: "X (aft superfire)",  grp: "aft",  zf: -0.24, xf: 0,    tier: 1, arc: [180, 160], wing: false },
    Y: { label: "Y (aft low)",        grp: "aft",  zf: -0.40, xf: 0,    tier: 0, arc: [180, 150], wing: false },
    P: { label: "P (port wing)",      grp: "wing", zf: 0.0,  xf: -0.46, tier: 0, arc: [-90, 70],  wing: true },
    S: { label: "S (stbd wing)",      grp: "wing", zf: 0.0,  xf: 0.46,  tier: 0, arc: [90, 70],   wing: true },
  };
  // Which positions a chassis exposes, by weapon-mount count (centreline first - the
  // RtW preference, since centreline guns help both broadsides). Wings come after.
  function positionsFor(c) {
    var order = ["A", "B", "X", "Y", "P", "S"];          // priority order
    var n = c.wMounts;
    // big multi-mount platforms (Spider/Siege) earn the wing pair sooner
    if (c.wMounts >= 5) order = ["A", "B", "X", "Y", "P", "S"];
    return order.slice(0, Math.max(1, n));
  }
  // angular helpers (degrees, normalised to -180..180)
  function norm180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }
  function arcContains(arc, bearing) {
    var d = Math.abs(norm180(bearing - arc[0]));
    return d <= arc[1] + 0.001;
  }

  // ============================================================== DESIGN MODEL ==
  function newDesign(chassis) {
    var c = chassis || DB.chassis.find(function (x) { return x.cls === "Line"; });
    design = {
      chassisId: c.id, armorId: DB.armor[0].id,
      zones: { carapace: 40, glacis: 150, flank: 100, legs: 50, cupola: 80, mantlet: 120 },
      turrets: {},      // position-code -> gun id
      modules: {},      // slot index -> { id, pos }
      name: document.getElementById("designName").value
    };
    // default-fit a sensible main gun in position A
    var g = bestGunFor(c);
    if (g) design.turrets.A = g.id;
  }
  function chassis() { return DB.chassis.find(function (c) { return c.id === design.chassisId; }); }
  function armorMat() { return DB.armor.find(function (a) { return a.id === design.armorId; }); }
  function bestGunFor(c) {
    var avail = DB.guns.filter(function (g) { return g.year <= year && g.cal <= c.maxCal; });
    avail.sort(function (a, b) { return b.cal - a.cal; });
    return avail[0];
  }
  function fittedGuns() {
    var out = [];
    Object.keys(design.turrets).forEach(function (pos) {
      var g = DB.guns.find(function (x) { return x.id === design.turrets[pos]; });
      if (g) out.push({ pos: pos, gun: g });
    });
    return out;
  }
  function fittedModules() {
    var out = [];
    Object.keys(design.modules).forEach(function (slot) {
      var m = design.modules[slot];
      if (m && m.id) { var def = findModule(m.id); if (def) out.push({ slot: +slot, mod: def, pos: m.pos }); }
    });
    return out;
  }

  // ============================================== weight/cost (RtW-style budget) ==
  function zoneAreas(c) {
    var s = Math.sqrt(c.mass / 100);
    return { carapace: 28 * s, glacis: 16 * s, flank: 14 * s, legs: 10 * s, cupola: 4 * s, mantlet: 6 * s };
  }
  function armorMassT() {
    var c = chassis(), a = armorMat(), ar = zoneAreas(c), z = design.zones;
    var kg = a.density * (ar.carapace * z.carapace + ar.glacis * z.glacis + ar.flank * 2 * z.flank +
      ar.legs * z.legs + ar.cupola * z.cupola + ar.mantlet * z.mantlet);
    return kg / 1000;
  }
  function gunMassT() { return fittedGuns().reduce(function (s, t) { return s + t.gun.weight; }, 0); }
  function moduleMassT() { return fittedModules().reduce(function (s, m) { return s + m.mod.weight; }, 0); }
  function totalMass() { return armorMassT() + gunMassT() + moduleMassT(); }
  function totalCost() {
    var c = chassis(), a = armorMat();
    var cost = c.cost + armorMassT() * a.costPerT;
    fittedGuns().forEach(function (t) { cost += t.gun.cost; });
    fittedModules().forEach(function (m) { cost += m.mod.cost; });
    return cost;
  }
  function maxBore() { return fittedGuns().reduce(function (m, t) { return Math.max(m, t.gun.cal); }, 0); }

  // =================================================== RtW AUTO-DERIVED CLASS ====
  // Map chassis "look" to a base RtW code, then ADJUST by the finished numbers
  // (tonnage, max bore, belt thickness, speed) exactly like RtW derives a label.
  function baseClassCode(cls) {
    return ({ Recon: "Recon", Skirmisher: "DD", Line: "CL", Spider: "CA", Siege: "BB", Carrier: "CV" })[cls] || "CL";
  }
  var CLASS_RANK = { Recon: 0, DD: 1, CL: 2, CA: 3, BC: 4, BB: 5, CV: 3 };
  var CLASS_NAME = {
    Recon: "scout strider", DD: "destroyer-crab", CL: "light cruiser-crab",
    CA: "heavy cruiser-crab", BC: "battlecruiser-crab", BB: "battle-crab (dreadnought)",
    CV: "drone carrier-crab"
  };
  // returns { code, name, note }
  function derivedClass() {
    var c = chassis(), v = totalMass(), bore = maxBore(), belt = design.zones.glacis, spd = c.speed;
    var base = baseClassCode(c.cls);
    var moduleCount = fittedModules().length, gunCount = fittedGuns().length;

    // Carriers / drone-heavy: if the hull is given over to drones & light guns -> CV
    var droneMods = fittedModules().filter(function (m) { return m.mod.kind === "drone"; }).length;
    if (c.cls === "Carrier" || (droneMods >= 2 && bore <= 130 && c.uMounts >= 4)) {
      return { code: "CV", name: CLASS_NAME.CV, note: "hull given to drones + light guns" };
    }

    // Score from tonnage / bore / belt -> a gun-line rank.
    var rank = 1; // start ~DD
    if (v >= 300 || bore >= 280) rank = 5;        // BB territory
    else if (v >= 180 || bore >= 200) rank = 3;   // CA
    else if (v >= 90 || bore >= 150) rank = 2;    // CL
    else rank = 1;                                 // DD
    if (bore >= 240 && v >= 250) rank = 5;
    if (c.cls === "Recon" && bore <= 76) return { code: "Recon", name: CLASS_NAME.Recon, note: "scout/spotter hull" };

    var thinBelt = belt < 120, thickBelt = belt >= 200;
    var fast = spd >= 36, slow = spd <= 26;

    // Battlecruiser test: heavy guns on a FAST, lighter-armoured hull (armour traded
    // for speed) - the RtW "fast wing of the battle line".
    if (bore >= 180 && fast && thinBelt) {
      return { code: "BC", name: CLASS_NAME.BC, note: "heavy guns + speed, light belt (armour traded for speed)" };
    }
    // Up-armour / up-gun a cruiser -> reads heavier.
    if (rank === 2 && (bore >= 180 || thickBelt) && !fast) rank = 3;       // CL -> CA
    if (rank === 3 && bore >= 280 && thickBelt && slow) rank = 5;          // CA -> BB
    // Strip the belt off a heavy hull but keep guns & speed -> BC.
    if (rank >= 5 && thinBelt && fast) {
      return { code: "BC", name: CLASS_NAME.BC, note: "dreadnought guns, belt stripped for speed" };
    }

    var code = ({ 0: "Recon", 1: "DD", 2: "CL", 3: "CA", 5: "BB" })[rank] || "CL";
    // keep within sane distance of the chassis base (a Whippet never becomes a BB)
    if (CLASS_RANK[code] > CLASS_RANK[base] + 2) code = base;

    var note = "";
    if (code !== base) {
      if (CLASS_RANK[code] > CLASS_RANK[base]) note = "up-gunned / up-armoured beyond its " + base + " base";
      else note = "lighter than its " + base + " base";
    } else note = "balanced for its " + base + " hull";
    return { code: code, name: CLASS_NAME[code] || "cruiser-crab", note: note };
  }

  // ============================================= cones of fire / throw-weight ====
  // For a target on a bearing, which fitted turrets can train onto it.
  function gunsBearing(bearing) {
    return fittedGuns().filter(function (t) {
      var def = POSDEFS[t.pos]; return def && arcContains(def.arc, bearing);
    });
  }
  function broadsideCount() {
    // best of port (-90) / starboard (+90) beam
    var s = gunsBearing(90).length, p = gunsBearing(-90).length;
    return Math.max(s, p);
  }
  function aheadCount() { return gunsBearing(0).length; }
  function asternCount() { return gunsBearing(180).length; }
  function throwWeight(list) { return list.reduce(function (s, t) { return s + t.gun.shell * t.gun.rof / 60; }, 0); }

  // ===================================================== IMMUNITY ZONE (RtW) ====
  // Against a reference enemy gun, find the range band where neither side (belt)
  // nor top (deck) armour is penetrated. Uses verpen (vertical->side) & horpen
  // (horizontal->deck) tables; falls back to a simple velocity model if absent.
  function effSide() { return design.zones.flank * armorMat().quality; }
  function effGlacis() { return design.zones.glacis * armorMat().quality; }
  function effDeck() { return design.zones.carapace * armorMat().quality; }
  function immunityZone(bore) {
    var side = effSide(), deck = effDeck();
    var rMin = 500, rMax = 20000, step = 250;
    var inner = null, outer = null;
    for (var r = rMin; r <= rMax; r += step) {
      var vp = DB.verpen ? penAt(DB.verpen, bore, r) : (bore * 1.6 * Math.exp(-r / 9000));
      var hp = DB.horpen ? penAt(DB.horpen, bore, r) : (bore * 0.12 * (r / 4000));
      var sideSafe = vp <= side;   // belt no longer defeated beyond here
      var deckSafe = hp <= deck;   // deck still safe up to here
      if (sideSafe && inner === null) inner = r;    // first range where side is safe
      if (!deckSafe && outer === null && inner !== null) { outer = r; break; }
    }
    if (inner !== null && outer === null) outer = rMax;
    var has = inner !== null && outer !== null && outer > inner;
    return { has: has, inner: inner, outer: outer, side: side, deck: deck, max: rMax };
  }

  // ================================================================== 3D ========
  function init3D() {
    var canvas = document.getElementById("view");
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0x0b0d0c, 1);
    scene = new T.Scene();
    scene.fog = new T.Fog(0x0b0d0c, 120, 320);
    cam = new T.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
    controls = new T.OrbitControls(cam, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.target.set(0, 8, 0);
    scene.add(new T.HemisphereLight(0x9fb3a6, 0x14181a, 0.85));
    var key = new T.DirectionalLight(0xd8d2c0, 1.0); key.position.set(-1, 1.4, 0.8); scene.add(key);
    var rim = new T.DirectionalLight(0x4a7a72, 0.5); rim.position.set(1, 0.4, -1); scene.add(rim);
    gridHelper = new T.GridHelper(120, 24, 0x2a342e, 0x1a221d); scene.add(gridHelper);
    addEventListener("resize", onResize);
    animate();
  }
  function rebuildModel() {
    if (crab) { scene.remove(crab.group); }
    var c = chassis();
    // base hull length per class; build() stretches it further with mount count
    // so the gun stations never crowd (Siege fully loaded → ~52m).
    var lenByClass = { Recon: 16, Skirmisher: 22, Line: 28, Spider: 32, Siege: 46, Carrier: 38 };
    // pass POSITIONED mounts so the model places turrets at A/B/X/Y/P/S
    var mounts = fittedGuns().map(function (t) {
      var d = POSDEFS[t.pos];
      return { caliberMm: t.gun.cal, pos: t.pos, grp: d.grp, zf: d.zf, xf: d.xf, tier: d.tier, wing: d.wing };
    });
    var spec = {
      chassisClass: c.cls, lengthM: lenByClass[c.cls] || 28,
      mounts: mounts, positioned: true,
      modules: fittedModules().length, team: "friend"
    };
    crab = window.CrabModel.build(spec);
    scene.add(crab.group);
    var L = crab.lengthM;   // actual (mount-stretched) length, for correct framing
    controls.target.set(0, L * 0.22, 0);
    cam.position.set(L * 1.15, L * 0.85, L * 1.6);
    controls.update();
  }
  function onResize() { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
  function animate() {
    requestAnimationFrame(animate);
    if (crab) crab.group.rotation.y += 0.0025;
    controls.update(); renderer.render(scene, cam);
  }

  // =========================================================== UI rendering =====
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function renderAll() {
    renderChassis(); renderArmor(); renderArmorScheme(); renderTurrets(); renderModules();
    renderAnalysis();
    rebuildModel();
    drawSchematic();
  }

  // =================================== LOADOUT SCHEMATIC (top-down + arcs) =======
  // Draws the hull bow-up, leg clusters, armour-zone labels, and each fitted turret
  // at its A/B/X/Y/P/S position WITH ITS CONE OF FIRE drawn as a translucent sector.
  function drawSchematic() {
    var cv = document.getElementById("schematic");
    if (!cv) return;
    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var c = chassis();
    var P = (window.CrabModel.CLASS_PROFILE[c.cls] || window.CrabModel.CLASS_PROFILE.Line);

    var cx = W * 0.5;
    var hullLen = H * 0.82;
    var hullW = Math.max(46, Math.min(96, hullLen * P.beam * 1.15));
    var topY = (H - hullLen) / 2, botY = topY + hullLen;
    function zy(frac) { return botY - (frac + 0.5) * hullLen; }   // +0.5=bow=top
    function sx(xfrac) { return cx + xfrac * hullW; }             // -0.5 port .. 0.5 stbd

    // ---- ARCS FIRST (under the hull/turrets) -------------------------------
    // bearing 0=ahead(up/-Y in canvas). canvas angle for bearing b:
    //   dx = sin(b), dy = -cos(b)
    function drawArc(px, py, arc, reach, fill) {
      var c0 = (arc[0] - arc[1]), c1 = (arc[0] + arc[1]);
      // canvas angle (atan2 frame): bearing b -> angle = b - 90 (since up is -Y, ahead)
      var a0 = (c0 - 90) * Math.PI / 180, a1 = (c1 - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, reach, a0, a1, false);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    var guns = fittedGuns();
    // draw the cones underneath, faint
    guns.forEach(function (t) {
      var d = POSDEFS[t.pos];
      var px = sx(d.xf), py = zy(d.zf);
      var reach = hullLen * (0.40 + Math.min(t.gun.range, 40000) / 40000 * 0.32);
      var fill = d.wing ? "rgba(176,130,44,.10)" : "rgba(110,176,160,.085)";
      drawArc(px, py, d.arc, reach, fill);
    });

    // ---- hull silhouette ----
    ctx.beginPath();
    ctx.moveTo(cx, zy(0.52));
    ctx.lineTo(sx(0.5), zy(0.30));
    ctx.lineTo(sx(0.5), zy(-0.42));
    ctx.lineTo(sx(0.4), zy(-0.5));
    ctx.lineTo(sx(-0.4), zy(-0.5));
    ctx.lineTo(sx(-0.5), zy(-0.42));
    ctx.lineTo(sx(-0.5), zy(0.30));
    ctx.closePath();
    ctx.fillStyle = "rgba(38,52,46,.62)";
    ctx.strokeStyle = "rgba(120,140,130,.5)"; ctx.lineWidth = 1.2;
    ctx.fill(); ctx.stroke();

    // ---- armour zone labels ----
    ctx.save();
    ctx.font = "8px 'DejaVu Sans Mono',monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    function zoneLabel(txt, mm, x, y) {
      ctx.fillStyle = "rgba(110,176,160,.85)"; ctx.fillText(txt, x, y);
      ctx.fillStyle = "rgba(93,109,100,.9)"; ctx.fillText(mm + "mm", x, y + 9);
    }
    var Z = design.zones;
    zoneLabel("BOW", Z.glacis, cx, zy(0.46));
    zoneLabel("STERN", Z.flank, cx, zy(-0.44));
    zoneLabel("DECK", Z.carapace, cx, zy(0.0));
    ctx.save(); ctx.translate(sx(-0.5) - 13, zy(-0.20)); ctx.rotate(-Math.PI / 2); zoneLabel("PORT", Z.flank, 0, 0); ctx.restore();
    ctx.save(); ctx.translate(sx(0.5) + 13, zy(-0.20)); ctx.rotate(Math.PI / 2); zoneLabel("STBD", Z.flank, 0, 0); ctx.restore();
    ctx.restore();

    // ---- leg clusters (mirror buildLegs split) ----
    var totalPairs = Math.floor(c.legs / 2);
    var aftPairs = Math.ceil(totalPairs / 2), forePairs = totalPairs - aftPairs;
    if (forePairs === 0 && aftPairs > 1) { forePairs = 1; aftPairs -= 1; }
    drawLegCluster(forePairs, 0.34, 1);
    drawLegCluster(aftPairs, -0.34, -1);
    function drawLegCluster(pairs, zc, dir) {
      ctx.fillStyle = "#2c3a34"; ctx.strokeStyle = "rgba(120,140,130,.45)"; ctx.lineWidth = 1;
      for (var side = -1; side <= 1; side += 2) {
        for (var li = 0; li < pairs; li++) {
          var f = pairs === 1 ? 0 : (li / (pairs - 1) - 0.5);
          var hipFrac = zc + f * 0.18;
          var footFrac = hipFrac + dir * 0.16 + f * 0.11;
          var hx = sx(side * 0.5), hy = zy(hipFrac);
          var fx = sx(side * 0.92), fy = zy(footFrac);
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke();
          ctx.beginPath(); ctx.arc(fx, fy, 2.6, 0, 7); ctx.fill();
        }
      }
    }

    // ---- MODULE pods amidships (one marker per fitted module) ----
    var mods = fittedModules();
    ctx.fillStyle = "#5a6258"; ctx.strokeStyle = "rgba(112,176,160,.5)"; ctx.lineWidth = 1;
    mods.forEach(function (m, i) {
      var posMap = { sensor_head: [0, 0.40], dorsal: [0, 0.06], port: [-0.30, -0.05], stbd: [0.30, -0.05] };
      var pm = posMap[m.pos] || [(i % 2 ? 0.30 : -0.30), -0.12 - Math.floor(i / 2) * 0.08];
      var mx = sx(pm[0]), my = zy(pm[1]);
      ctx.fillRect(mx - 4, my - 5, 8, 10); ctx.strokeRect(mx - 4, my - 5, 8, 10);
    });

    // ---- TURRETS at their positions, on top of arcs ----
    guns.forEach(function (t) {
      var d = POSDEFS[t.pos];
      drawTurret(sx(d.xf), zy(d.zf), t.gun.cal, d.wing, d.arc[0], t.pos, d.tier);
    });
    function drawTurret(px, py, cal, isWing, bearingCentre, code, tier) {
      var calN = Math.min(cal || 60, 305) / 305;
      var r = (isWing ? 4 : 6.5) + calN * 6 + tier * 0.6;
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7);
      ctx.fillStyle = isWing ? "#7d5a2a" : "#3e7a74";
      ctx.strokeStyle = "rgba(20,24,20,.95)"; ctx.lineWidth = tier ? 1.8 : 1; ctx.fill(); ctx.stroke();
      // barrels pointing along the arc centre bearing
      var bl = r + 6 + calN * 10;
      var b = bearingCentre * Math.PI / 180;
      var dx = Math.sin(b), dy = -Math.cos(b);
      var twin = calN > 0.55 && !isWing;
      ctx.strokeStyle = "#11140f"; ctx.lineWidth = twin ? 2.4 : 1.8;
      var off = twin ? 2.2 : 0, perpx = -dy, perpy = dx;
      [-off, off].forEach(function (o) {
        if (o === 0 && off !== 0) return;
        ctx.beginPath();
        ctx.moveTo(px + perpx * o, py + perpy * o);
        ctx.lineTo(px + dx * bl + perpx * o, py + dy * bl + perpy * o);
        ctx.stroke();
      });
      // position code label
      ctx.fillStyle = "rgba(220,210,180,.9)";
      ctx.font = "bold 8px 'DejaVu Sans Mono',monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(code, px, py);
    }

    // ---- header: bow arrow + broadside/ahead tally ----
    ctx.fillStyle = "rgba(176,130,44,.95)";
    ctx.font = "9px 'DejaVu Sans Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("\u25B2 BOW", 6, 12);
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(110,176,160,.95)";
    ctx.fillText("BROADSIDE " + broadsideCount() + " \u00b7 AHEAD " + aheadCount(), W - 6, 12);
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(176,130,44,.95)";
    ctx.fillText("STERN \u25BC", cx, H - 5);
  }

  // ================================================== left-panel: chassis =======
  function renderChassis() {
    var box = document.getElementById("chassisList"); box.innerHTML = "";
    DB.chassis.forEach(function (c) {
      var avail = c.year <= year;
      var o = el("div", "opt" + (c.id === design.chassisId ? " sel" : "") + (avail ? "" : " locked"));
      o.innerHTML = '<span class="nm">' + c.name + '</span><span class="sub">' + c.cls +
        (avail ? "" : ' &middot; \uD83D\uDD12' + c.year) + '</span>';
      if (avail) o.onclick = function () { newDesign(c); renderAll(); };
      else o.title = "LOCKED - research unlocks ~" + c.year + " (availability varies per playthrough)";
      box.appendChild(o);
      if (c.id === design.chassisId) {
        var d = el("div"); d.style.cssText = "padding:4px 6px;color:var(--dim);font-size:10px;line-height:1.6";
        d.innerHTML = "MASS " + c.mass + "t &middot; SPD " + c.speed + "km/h &middot; LEGS " + c.legs +
          "<br>MOUNTS " + c.wMounts + "W/" + c.uMounts + "U &middot; MAXCAL " + c.maxCal + "mm &middot; CREW " + c.crew;
        box.appendChild(d);
      }
    });
  }
  function renderArmor() {
    var box = document.getElementById("armorList"); box.innerHTML = "";
    DB.armor.forEach(function (a) {
      var avail = a.year <= year;
      var o = el("div", "opt" + (a.id === design.armorId ? " sel" : "") + (avail ? "" : " locked"));
      o.innerHTML = '<span class="nm">' + a.name + '</span><span class="sub">Q' + a.quality.toFixed(2) +
        (avail ? "" : ' &middot; \uD83D\uDD12' + a.year) + '</span>';
      if (avail) o.onclick = function () { design.armorId = a.id; renderAll(); };
      else o.title = "LOCKED - research unlocks ~" + a.year + " (availability varies per playthrough)";
      box.appendChild(o);
    });
  }
  function renderArmorScheme() {
    var box = document.getElementById("armorScheme"); box.innerHTML = "";
    var zones = [["carapace", "TOP / carapace"], ["glacis", "FRONT / glacis"], ["flank", "SIDE / flank"],
      ["legs", "LEGS"], ["cupola", "SENSOR"], ["mantlet", "MANTLET"]];
    zones.forEach(function (z) {
      var s = el("div", "stepper");
      s.innerHTML = '<span class="nm">' + z[1] + '</span>';
      var minus = el("button", "sbtn", "&minus;"), val = el("span", "sval", design.zones[z[0]] + "mm"), plus = el("button", "sbtn", "+");
      minus.onclick = function () { design.zones[z[0]] = Math.max(0, design.zones[z[0]] - 10); renderAll(); };
      plus.onclick = function () { design.zones[z[0]] += 10; renderAll(); };
      s.appendChild(minus); s.appendChild(val); s.appendChild(plus);
      box.appendChild(s);
    });
  }

  // ============================== right-panel: POSITIONED turret stations ========
  function gunOption(g, c) {
    var locked = g.year > year;
    var label = g.name + " (" + g.cal + "mm, " + (g.range / 1000) + "km";
    if (g.type !== "conventional") label += ", " + g.type;
    label += ")";
    if (locked) label += "  \uD83D\uDD12" + g.year;
    return { label: label, locked: locked, tooBig: g.cal > c.maxCal };
  }
  function renderTurrets() {
    var box = document.getElementById("mountList"); box.innerHTML = "";
    var c = chassis();
    var positions = positionsFor(c);
    positions.forEach(function (pos) {
      var def = POSDEFS[pos];
      var m = el("div", "mount");
      var tag = el("span", "postag" + (def.wing ? " wing" : ""), pos);
      tag.title = def.label;
      var col = el("div"); col.style.flex = "1";
      var lab = el("div", null, '<span class="poslabel">' + def.label + '</span>');
      var sel = el("select");
      var none = el("option", null, "&mdash; EMPTY &mdash;"); none.value = ""; sel.appendChild(none);
      DB.guns.forEach(function (g) {
        var oo = gunOption(g, c);
        if (oo.tooBig) return;                       // can't mount above chassis max bore
        var op = el("option", null, oo.label);
        op.value = g.id;
        if (oo.locked) op.disabled = true;           // tech-locked: cannot be fitted
        if (design.turrets[pos] === g.id) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = function () {
        var v = sel.value;
        if (v === "") delete design.turrets[pos];
        else design.turrets[pos] = +v;
        renderAll();
      };
      lab.appendChild(sel); col.appendChild(lab);
      m.appendChild(tag); m.appendChild(col);
      box.appendChild(m);
    });
    // arc legend hint
    var hint = el("div", null,
      '<span class="sub" style="color:var(--dim);font-size:9.5px;line-height:1.5">' +
      'A/B fore \u00b7 X/Y aft (centreline = both broadsides) \u00b7 P/S wings (one side). ' +
      'Locked guns \uD83D\uDD12 need research.</span>');
    hint.style.padding = "4px 6px 0";
    box.appendChild(hint);
  }

  // ===================== right-panel: SELECTABLE module slots ====================
  var MOD_POSITIONS = [
    ["sensor_head", "SENSOR HEAD"], ["dorsal", "DORSAL BAY"],
    ["port", "PORT FLANK"], ["stbd", "STBD FLANK"]
  ];
  function renderModules() {
    var box = document.getElementById("moduleList"); box.innerHTML = "";
    var c = chassis();
    var lib = moduleLib();
    for (var i = 0; i < c.uMounts; i++) {
      (function (slot) {
        var cur = design.modules[slot] || {};
        var wrap = el("div", "mount modslot");
        var tag = el("span", "postag mod", "U" + (slot + 1));
        var col = el("div"); col.style.flex = "1";
        // module picker
        var sel = el("select");
        var none = el("option", null, "&mdash; EMPTY &mdash;"); none.value = ""; sel.appendChild(none);
        // group by kind for readability
        [["sensor", "SENSORS"], ["drone", "DRONE BAYS"], ["ew", "ELECTRONIC WARFARE"]].forEach(function (grp) {
          var og = document.createElement("optgroup"); og.label = grp[1];
          lib.filter(function (m) { return m.kind === grp[0]; }).forEach(function (m) {
            var locked = m.year > year;
            var op = el("option", null, m.name + " [" + m.tag + "]" + (locked ? "  \uD83D\uDD12" + m.year : ""));
            op.value = m.id; if (locked) op.disabled = true;
            if (cur.id === m.id) op.selected = true;
            og.appendChild(op);
          });
          sel.appendChild(og);
        });
        sel.onchange = function () {
          if (sel.value === "") delete design.modules[slot];
          else design.modules[slot] = { id: sel.value, pos: (design.modules[slot] && design.modules[slot].pos) || "dorsal" };
          renderAll();
        };
        // position picker (where on the hull this module goes)
        var posSel = el("select"); posSel.style.marginTop = "3px"; posSel.style.fontSize = "10px";
        MOD_POSITIONS.forEach(function (p) {
          var op = el("option", null, p[1]); op.value = p[0];
          if ((cur.pos || "dorsal") === p[0]) op.selected = true;
          posSel.appendChild(op);
        });
        posSel.onchange = function () {
          if (design.modules[slot]) { design.modules[slot].pos = posSel.value; renderAll(); }
        };
        col.appendChild(sel); col.appendChild(posSel);
        wrap.appendChild(tag); wrap.appendChild(col);
        box.appendChild(wrap);
      })(i);
    }
    box.appendChild(el("div", null,
      '<span class="sub" style="color:var(--dim);font-size:9.5px;line-height:1.5">' +
      'Pick a sensor / drone bay / EW module per slot + WHERE it sits. ' +
      'Locked \uD83D\uDD12 need research.</span>'));
  }

  // ===================== validation =====================
  function validate() {
    var c = chassis(), errs = [], warns = [];
    var mass = totalMass();
    var gunCount = fittedGuns().length, modCount = fittedModules().length;
    if (mass > c.mass) errs.push("OVERWEIGHT: " + mass.toFixed(0) + "t / " + c.mass + "t budget");
    if (gunCount > c.wMounts) errs.push("Too many guns: " + gunCount + "/" + c.wMounts + " mounts");
    if (modCount > c.uMounts) errs.push("Too many modules: " + modCount + "/" + c.uMounts);
    if (c.year > year) errs.push(c.name + " not available until " + c.year);
    fittedGuns().forEach(function (t) {
      var g = t.gun;
      if (g.cal > c.maxCal) errs.push(g.name + " (" + g.cal + "mm) exceeds " + c.name + " mount limit " + c.maxCal + "mm");
      if (g.year > year) errs.push(g.name + " (" + t.pos + ") not unlocked until " + g.year);
      if ((g.type === "rail" || g.type === "coil") && c.power < g.cal * 1.5) warns.push(g.name + " strains powerplant");
    });
    fittedModules().forEach(function (m) {
      if (m.mod.year > year) errs.push(m.mod.name + " not unlocked until " + m.mod.year);
    });
    if (mass < c.mass * 0.5) warns.push("Under-utilised: >half the mass budget unused");
    if (gunCount === 0) warns.push("Unarmed");
    // RtW balance hint: broadside should beat ahead, else wings wasted
    if (broadsideCount() === aheadCount() && gunCount > 1) warns.push("Broadside no better than ahead-fire - consider wing/centreline mix");
    return { ok: errs.length === 0, errs: errs, warns: warns, mass: mass, budget: c.mass };
  }

  // ===================== analysis panel =====================
  function renderAnalysis() {
    var c = chassis(), v = validate(), a = armorMat();
    var box = document.getElementById("analysis"); box.innerHTML = "";
    function row(k, val, cls) { var r = el("div", "row" + (cls ? " " + cls : "")); r.innerHTML = '<span class="k">' + k + '</span><span class="v">' + val + '</span>'; box.appendChild(r); }

    // ---- derived RtW class banner ----
    var dc = derivedClass();
    var clsBox = el("div", "classbox");
    clsBox.innerHTML = '<div class="classcode">CLASS: ' + dc.code + '</div>' +
      '<div class="classname">' + dc.name + '</div>' +
      '<div class="classnote">' + dc.note + '</div>';
    box.appendChild(clsBox);

    // mass bar
    var massFrac = v.mass / v.budget;
    var bar = el("div", "bar" + (massFrac > 1 ? " over" : "")); var ib = el("i"); ib.style.width = Math.min(100, massFrac * 100) + "%"; bar.appendChild(ib); box.appendChild(bar);
    row("MASS", v.mass.toFixed(0) + " / " + v.budget + " t", massFrac > 1 ? "warn" : "good");
    row("COST", totalCost().toLocaleString());
    row("WEAPONS", fittedGuns().length + " / " + c.wMounts);
    row("MODULES", fittedModules().length + " / " + c.uMounts);

    // ---- throw-weight / cones of fire readout ----
    var bs = gunsBearing(90).length, ps = gunsBearing(-90).length, beam = Math.max(bs, ps);
    row("BROADSIDE", beam + " guns bear", "good");
    row("AHEAD", aheadCount() + " guns bear");
    row("ASTERN", asternCount() + " guns bear");
    var tw = throwWeight(beam === bs ? gunsBearing(90) : gunsBearing(-90));
    row("BROADSIDE WT", tw.toFixed(1) + " kg/s shell");

    // derived combat stats
    var maxRange = 0; fittedGuns().forEach(function (t) { maxRange = Math.max(maxRange, t.gun.range); });
    row("TOP SPEED", c.speed + " km/h");
    row("MAX RANGE", (maxRange / 1000).toFixed(1) + " km");
    row("MAX BORE", maxBore() + " mm");
    row("ARMOUR top/front/side", design.zones.carapace + "/" + design.zones.glacis + "/" + design.zones.flank + " mm");
    row("ARMOUR EFF (xQ)", "side " + effSide().toFixed(0) + " / deck " + effDeck().toFixed(0) + " mm");

    // ---- IMMUNITY ZONE readout ----
    var iz = immunityZone(enemyBore);
    var izBox = el("div", "izbox");
    var head = el("div", "izhead");
    head.innerHTML = 'IMMUNITY ZONE  vs <select id="enemyBore"></select>mm';
    izBox.appendChild(head);
    var bandWrap = el("div", "izband");
    // draw a band 0..max with immune segment highlighted
    var pct = function (r) { return (r / iz.max * 100); };
    if (iz.has) {
      var seg = el("div", "izseg");
      seg.style.left = pct(iz.inner) + "%";
      seg.style.width = (pct(iz.outer) - pct(iz.inner)) + "%";
      bandWrap.appendChild(seg);
    }
    izBox.appendChild(bandWrap);
    var izTxt = el("div", "iztxt");
    if (iz.has) {
      izTxt.innerHTML = "IMMUNE <b>" + (iz.inner / 1000).toFixed(1) + "\u2013" + (iz.outer / 1000).toFixed(1) +
        " km</b> vs " + enemyBore + "mm<br><span class='izsub'>inner: side safe \u00b7 outer: deck safe</span>";
      izTxt.className = "iztxt good";
    } else {
      izTxt.innerHTML = "NO IMMUNE BAND vs " + enemyBore + "mm<br><span class='izsub'>penetrable at all ranges - rebalance belt/deck</span>";
      izTxt.className = "iztxt bad";
    }
    izBox.appendChild(izTxt);
    box.appendChild(izBox);
    // wire the enemy-bore selector
    var es = document.getElementById("enemyBore");
    [76, 105, 122, 155, 180, 203, 305].forEach(function (b) {
      var op = el("option", null, b); op.value = b; if (b === enemyBore) op.selected = true; es.appendChild(op);
    });
    es.onchange = function () { enemyBore = +es.value; renderAnalysis(); };

    // banner + messages
    var banner = document.getElementById("validBanner");
    banner.className = "banner " + (v.ok ? "ok" : "bad");
    banner.textContent = v.ok ? "VALID DESIGN" : "INVALID DESIGN";
    var msg = document.getElementById("messages"); msg.innerHTML = "";
    v.errs.forEach(function (e) { msg.appendChild(el("div", "err", "\u2716 " + e)); });
    v.warns.forEach(function (w) { msg.appendChild(el("div", "warnmsg", "\u26a0 " + w)); });
    document.getElementById("yearVal").textContent = year;
  }

  // ===================== year / tech control =====================
  function setYear(y) {
    year = Math.max(2025, Math.min(2070, y));
    document.getElementById("yearLbl").textContent = "TECH YEAR " + year;
    document.getElementById("yrShow").textContent = year;
    // drop any now-locked fits so the design stays buildable
    Object.keys(design.turrets).forEach(function (pos) {
      var g = DB.guns.find(function (x) { return x.id === design.turrets[pos]; });
      if (g && g.year > year) delete design.turrets[pos];
    });
    Object.keys(design.modules).forEach(function (slot) {
      var m = findModule(design.modules[slot].id);
      if (m && m.year > year) delete design.modules[slot];
    });
    renderAll();
  }

  // ===================== boot =====================
  // optional demo presets (?demo=heavy|spider) for quick visual verification of the
  // full A/B/X/Y + P/S layout, cones of fire and immunity zone.
  function applyDemo(which) {
    function gid(cal) { var g = DB.guns.find(function (x) { return x.cal === cal && x.year <= year; }); return g ? g.id : null; }
    if (which === "heavy") {            // Leviathan: A+B fore, X+Y aft, all 305mm
      var lev = DB.chassis.find(function (c) { return c.cls === "Siege"; });
      year = 2040; newDesign(lev);
      design.zones = { carapace: 150, glacis: 350, flank: 320, legs: 90, cupola: 140, mantlet: 220 };
      ["A", "B", "X", "Y"].forEach(function (p) { var id = gid(305); if (id) design.turrets[p] = id; });
      design.modules[0] = { id: "S2", pos: "sensor_head" };
    } else if (which === "bc") {        // Phalanx + heavy railguns + thin belt -> BC
      var ph = DB.chassis.find(function (c) { return c.name === "Phalanx"; });
      year = 2055; newDesign(ph);       // railgun era
      design.zones = { carapace: 40, glacis: 90, flank: 80, legs: 40, cupola: 70, mantlet: 110 };
      var bcg = gid(180);               // RG-180 Heavy Railgun
      ["A", "B", "X", "Y"].forEach(function (p) { if (bcg) design.turrets[p] = bcg; });
    } else if (which === "spider") {    // Bastion: A/B/X/Y + P/S wings, mixed bores
      var bas = DB.chassis.find(function (c) { return c.cls === "Spider"; });
      year = 2035; newDesign(bas);
      design.zones = { carapace: 90, glacis: 220, flank: 180, legs: 70, cupola: 120, mantlet: 180 };
      var main = gid(203), sec = gid(105);
      ["A", "B", "X", "Y"].forEach(function (p) { if (main) design.turrets[p] = main; });
      if (sec) { design.turrets.P = sec; design.turrets.S = sec; }
      design.modules[0] = { id: "S2", pos: "sensor_head" };
    }
  }
  init3D();
  loadData().then(function () {
    newDesign();
    var demo = (location.search.match(/demo=(\w+)/) || [])[1];
    if (demo) applyDemo(demo);
    document.getElementById("designName").oninput = function () { design.name = this.value; };
    document.getElementById("yrUp").onclick = function () { setYear(year + 1); };
    document.getElementById("yrDown").onclick = function () { setYear(year - 1); };
    document.getElementById("yearLbl").textContent = "TECH YEAR " + year;
    document.getElementById("yrShow").textContent = year;
    renderAll();
    if (/scroll=1/.test(location.search)) setTimeout(function () { var r = document.getElementById("right"); if (r) r.scrollTop = r.scrollHeight; }, 200);
  }).catch(function (e) {
    document.getElementById("analysis").innerHTML = '<div class="err">DATA LOAD FAILED: ' + e + '<br>Serve from project root so ../../../Assets/Resources/CSV is reachable.</div>';
    console.error(e);
  });
})();
