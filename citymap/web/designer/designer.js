/* CITY BATTLE - Crab Foundry (mecha designer). RtW-style ship designer respecced for crabs.
   Loads the REAL game data (chassis/guns/armor CSVs), lets you pick a chassis, allocate per-zone
   armour, fit guns on mounts and modules on utility slots, and shows a LIVE 3D crab model + a
   weight/cost budget validation - exactly the Rule the Waves design loop. */
(function () {
  "use strict";
  var T = window.THREE;
  var DATA = "../../../Assets/Resources/CSV/";  // game CSVs (served from project root)

  var DB = { chassis: [], guns: [], armor: [] };
  var design = null, year = 2035;
  var scene, cam, renderer, controls, crab = null, gridHelper;

  // ---------- CSV ----------
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

  function loadData() {
    return Promise.all([
      fetch(DATA + "chassis.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "guns.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "armor.csv").then(function (r) { return r.text(); }),
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
    });
  }

  // ---------- design model ----------
  function newDesign(chassis) {
    var c = chassis || DB.chassis.find(function (x) { return x.cls === "Line"; });
    design = {
      chassisId: c.id, armorId: DB.armor[0].id,
      zones: { carapace: 40, glacis: 150, flank: 100, legs: 50, cupola: 80, mantlet: 120 },
      guns: [], modules: 0, name: document.getElementById("designName").value
    };
    // default-fit a sensible gun
    var g = bestGunFor(c);
    if (g) for (var i = 0; i < Math.min(c.wMounts, 1); i++) design.guns.push(g.id);
  }
  function chassis() { return DB.chassis.find(function (c) { return c.id === design.chassisId; }); }
  function armorMat() { return DB.armor.find(function (a) { return a.id === design.armorId; }); }
  function bestGunFor(c) {
    var avail = DB.guns.filter(function (g) { return g.year <= year && g.cal <= c.maxCal; });
    avail.sort(function (a, b) { return b.cal - a.cal; });
    return avail[0];
  }

  // ---------- weight/cost (RtW-style budget) ----------
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
  function gunMassT() { return design.guns.reduce(function (s, id) { return s + (DB.guns.find(function (g) { return g.id === id; }).weight); }, 0); }
  function moduleMassT() { return design.modules * 2.0; }
  function totalMass() { return armorMassT() + gunMassT() + moduleMassT(); }
  function totalCost() {
    var c = chassis(), a = armorMat();
    var cost = c.cost + armorMassT() * a.costPerT + design.modules * 1500;
    design.guns.forEach(function (id) { cost += DB.guns.find(function (g) { return g.id === id; }).cost; });
    return cost;
  }
  function validate() {
    var c = chassis(), errs = [], warns = [];
    var mass = totalMass();
    if (mass > c.mass) errs.push("OVERWEIGHT: " + mass.toFixed(0) + "t / " + c.mass + "t budget");
    if (design.guns.length > c.wMounts) errs.push("Too many guns: " + design.guns.length + "/" + c.wMounts + " mounts");
    if (design.modules > c.uMounts) errs.push("Too many modules: " + design.modules + "/" + c.uMounts);
    if (c.year > year) errs.push(c.name + " not available until " + c.year);
    design.guns.forEach(function (id) {
      var g = DB.guns.find(function (x) { return x.id === id; });
      if (g.cal > c.maxCal) errs.push(g.name + " (" + g.cal + "mm) exceeds " + c.name + " mount limit " + c.maxCal + "mm");
      if (g.year > year) warns.push(g.name + " not available until " + g.year);
      if ((g.type === "rail" || g.type === "coil") && c.power < g.cal * 1.5) warns.push(g.name + " strains powerplant");
    });
    if (mass < c.mass * 0.5) warns.push("Under-utilised: >half the mass budget unused");
    if (design.guns.length === 0) warns.push("Unarmed");
    return { ok: errs.length === 0, errs: errs, warns: warns, mass: mass, budget: c.mass };
  }

  // ---------- 3D ----------
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
    // ground grid (muted)
    gridHelper = new T.GridHelper(120, 24, 0x2a342e, 0x1a221d); scene.add(gridHelper);
    addEventListener("resize", onResize);
    animate();
  }
  function rebuildModel() {
    if (crab) { scene.remove(crab.group); }
    var c = chassis();
    var lenByClass = { Recon: 16, Skirmisher: 22, Line: 28, Spider: 34, Siege: 44, Carrier: 38 };
    var spec = {
      chassisClass: c.cls, lengthM: lenByClass[c.cls] || 28,
      mounts: design.guns.map(function (id) { var g = DB.guns.find(function (x) { return x.id === id; }); return { caliberMm: g.cal, arc: 360 }; }),
      modules: design.modules, team: "friend"
    };
    crab = window.CrabModel.build(spec);
    scene.add(crab.group);
    // frame camera to model length
    var L = spec.lengthM;
    controls.target.set(0, L * 0.25, 0);
    cam.position.set(L * 1.1, L * 0.8, L * 1.5);
    controls.update();
  }
  function onResize() { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
  var spin = 0;
  function animate() {
    requestAnimationFrame(animate);
    if (crab) crab.group.rotation.y += 0.0025;
    controls.update(); renderer.render(scene, cam);
  }

  // ---------- UI rendering ----------
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function renderAll() {
    renderChassis(); renderArmor(); renderArmorScheme(); renderMounts(); renderModules(); renderAnalysis();
    rebuildModel();
  }

  function renderChassis() {
    var box = document.getElementById("chassisList"); box.innerHTML = "";
    DB.chassis.forEach(function (c) {
      var avail = c.year <= year;
      var o = el("div", "opt" + (c.id === design.chassisId ? " sel" : ""));
      o.innerHTML = '<span class="nm">' + c.name + '</span><span class="sub">' + c.cls + (avail ? "" : " &middot;" + c.year) + '</span>';
      o.onclick = function () { newDesign(c); renderAll(); };
      box.appendChild(o);
      if (c.id === design.chassisId) {
        var d = el("div"); d.style.cssText = "padding:4px 6px;color:var(--dim);font-size:10px;line-height:1.6";
        d.innerHTML = "MASS " + c.mass + "t &middot; SPD " + c.speed + "km/h &middot; LEGS " + c.legs + "<br>MOUNTS " + c.wMounts + "W/" + c.uMounts + "U &middot; MAXCAL " + c.maxCal + "mm &middot; CREW " + c.crew;
        box.appendChild(d);
      }
    });
  }
  function renderArmor() {
    var box = document.getElementById("armorList"); box.innerHTML = "";
    DB.armor.forEach(function (a) {
      var avail = a.year <= year;
      var o = el("div", "opt" + (a.id === design.armorId ? " sel" : ""));
      o.innerHTML = '<span class="nm">' + a.name + '</span><span class="sub">Q' + a.quality.toFixed(2) + (avail ? "" : " &middot;" + a.year) + '</span>';
      o.onclick = function () { design.armorId = a.id; renderAll(); };
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
      minus.onclick = function () { design.zones[z[0]] = Math.max(0, design.zones[z[0]] - 10); renderAnalysis(); val.textContent = design.zones[z[0]] + "mm"; };
      plus.onclick = function () { design.zones[z[0]] += 10; renderAnalysis(); val.textContent = design.zones[z[0]] + "mm"; };
      s.appendChild(minus); s.appendChild(val); s.appendChild(plus);
      box.appendChild(s);
    });
  }
  function renderMounts() {
    var box = document.getElementById("mountList"); box.innerHTML = "";
    var c = chassis();
    for (var i = 0; i < c.wMounts; i++) {
      (function (idx) {
        var m = el("div", "mount");
        var sel = el("select");
        var none = el("option", null, "&mdash; EMPTY &mdash;"); none.value = ""; sel.appendChild(none);
        DB.guns.filter(function (g) { return g.cal <= c.maxCal; }).forEach(function (g) {
          var op = el("option", null, g.name + " (" + g.cal + "mm, " + (g.range / 1000) + "km)" + (g.year > year ? " *" : ""));
          op.value = g.id; if (design.guns[idx] === g.id) op.selected = true; sel.appendChild(op);
        });
        sel.onchange = function () {
          var v = sel.value;
          if (v === "") design.guns.splice(idx, 1);
          else design.guns[idx] = +v;
          design.guns = design.guns.filter(function (x) { return x != null; });
          renderAll();
        };
        m.appendChild(el("span", null, (idx + 1) + ".")); m.appendChild(sel);
        box.appendChild(m);
      })(i);
    }
  }
  function renderModules() {
    var box = document.getElementById("moduleList"); box.innerHTML = "";
    var c = chassis();
    var s = el("div", "stepper");
    s.innerHTML = '<span class="nm">utility modules</span>';
    var minus = el("button", "sbtn", "&minus;"), val = el("span", "sval", design.modules + "/" + c.uMounts), plus = el("button", "sbtn", "+");
    minus.onclick = function () { design.modules = Math.max(0, design.modules - 1); renderAll(); };
    plus.onclick = function () { design.modules = Math.min(c.uMounts, design.modules + 1); renderAll(); };
    s.appendChild(minus); s.appendChild(val); s.appendChild(plus);
    box.appendChild(s);
    box.appendChild(el("div", null, '<span class="sub" style="color:var(--dim);font-size:10px">sensors / EW / drone bays (' + c.uMounts + ' slots)</span>'));
  }
  function renderAnalysis() {
    var c = chassis(), v = validate(), a = armorMat();
    var box = document.getElementById("analysis"); box.innerHTML = "";
    function row(k, val, cls) { var r = el("div", "row" + (cls ? " " + cls : "")); r.innerHTML = '<span class="k">' + k + '</span><span class="v">' + val + '</span>'; box.appendChild(r); }
    // mass bar
    var massFrac = v.mass / v.budget;
    var bar = el("div", "bar" + (massFrac > 1 ? " over" : "")); var ib = el("i"); ib.style.width = Math.min(100, massFrac * 100) + "%"; bar.appendChild(ib); box.appendChild(bar);
    row("MASS", v.mass.toFixed(0) + " / " + v.budget + " t", massFrac > 1 ? "warn" : "good");
    row("COST", totalCost().toLocaleString() + "");
    row("WEAPONS", design.guns.length + " / " + c.wMounts);
    row("MODULES", design.modules + " / " + c.uMounts);
    // derived combat stats
    var topSpeed = c.speed, maxRange = 0, firepower = 0;
    design.guns.forEach(function (id) { var g = DB.guns.find(function (x) { return x.id === id; }); maxRange = Math.max(maxRange, g.range); firepower += g.cal * g.rof / 60; });
    row("TOP SPEED", topSpeed + " km/h");
    row("MAX RANGE", (maxRange / 1000).toFixed(1) + " km");
    row("FIREPOWER", firepower.toFixed(0) + " idx");
    row("ARMOUR top/front/side", design.zones.carapace + "/" + design.zones.glacis + "/" + design.zones.flank + " mm");
    row("ARMOUR EFF (xQ)", (design.zones.glacis * a.quality).toFixed(0) + " mm front");
    // banner + messages
    var banner = document.getElementById("validBanner");
    banner.className = "banner " + (v.ok ? "ok" : "bad");
    banner.textContent = v.ok ? "VALID DESIGN" : "INVALID DESIGN";
    var msg = document.getElementById("messages"); msg.innerHTML = "";
    v.errs.forEach(function (e) { msg.appendChild(el("div", "err", "\u2716 " + e)); });
    v.warns.forEach(function (w) { msg.appendChild(el("div", "warnmsg", "\u26a0 " + w)); });
    document.getElementById("yearVal").textContent = year;
  }

  // ---------- year control ----------
  function setYear(y) {
    year = Math.max(2025, Math.min(2070, y));
    document.getElementById("yearLbl").textContent = "DESIGN YEAR " + year;
    document.getElementById("yrShow").textContent = year;
    renderAll();
  }

  // ---------- boot ----------
  init3D();
  loadData().then(function () {
    newDesign();
    document.getElementById("designName").oninput = function () { design.name = this.value; };
    document.getElementById("yrUp").onclick = function () { setYear(year + 1); };
    document.getElementById("yrDown").onclick = function () { setYear(year - 1); };
    renderAll();
  }).catch(function (e) {
    document.getElementById("analysis").innerHTML = '<div class="err">DATA LOAD FAILED: ' + e + '<br>Serve from project root so ../../../Assets/Resources/CSV is reachable.</div>';
    console.error(e);
  });
})();
