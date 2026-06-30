/* CITY BATTLE // TECH DEVELOPMENT - Rule-the-Waves-style research tech-tree + simulator.
   Loads the REAL game data (tech.csv + chassis/guns/armor/drones/ew) and models the RtW
   stochastic, year-gated research process:
     - Research split into BRANCHES, each funded with a per-branch PRIORITY (High/Med/Low).
     - A calendar year that ADVANCES; techs cannot complete before their listed `year`.
     - Player FUNDS specific available techs. Each advance distributes the RP budget across
       funded techs (weighted by branch priority), every funded tech rolls its `chance%`
       to make progress this turn (stochastic skip), RP accumulates toward `cost`, and when
       cost is reached the tech completes (DONE) and its effect applies.
     - Year-gating: pre-year techs cannot complete; "starting=1" techs begin already DONE.
     - Cross-references the component CSVs to show what becomes buildable (the Foundry link).

   Pure vanilla JS, no build step, no frameworks.  Served from project root @ :9300, so the
   CSVs live at ../../../Assets/Resources/CSV/ relative to this tech/ folder. */
(function () {
  "use strict";
  var DATA = "../../../Assets/Resources/CSV/";

  // ------------------------------------------------------------------ state
  var DB = { tech: [], chassis: [], guns: [], armor: [], drones: [], ew: [] };
  var S = {
    year: 2025,          // current research calendar year
    rpBase: 150,         // RP generated per year
    selectedBranch: "ALL",
    branchPriority: {},  // branch -> "High"|"Med"|"Low"
    funded: {},          // tech_id -> true
    progress: {},        // tech_id -> accumulated RP
    done: {},            // tech_id -> true (researched)
    log: [],             // research log lines
    rpFundedThisTurn: 0, // RP allocated last advance
  };

  var PRIORITY_W = { High: 3, Med: 1.6, Low: 0.7 };
  var BRANCH_ORDER = ["Machinery", "Armour", "Hull / Chassis", "Fire Control",
    "Damage Control", "Mountings", "Guns & AP", "Sensors", "DRONES", "Electronic Warfare"];

  var ERAS = [
    { name: "Dreadnought Crabs", y0: 2025, y1: 2035, theme: "big slow gun-mechas, crude FC" },
    { name: "Fire-Control Era", y0: 2035, y1: 2045, theme: "directors, stabilisation, better AP" },
    { name: "Sensor & Network Era", y0: 2045, y1: 2055, theme: "radar/LIDAR, datalink, computed" },
    { name: "Drone Dawn", y0: 2055, y1: 2063, theme: "drones as the late asymmetric unlock" },
    { name: "EW & Autonomy", y0: 2063, y1: 2070, theme: "jamming, fibre-optic, swarm AI, C-UAS" },
  ];

  // ------------------------------------------------------------------ CSV
  function parseCSV(text) {
    var lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    var head = lines[0].split(",");
    return lines.slice(1).map(function (l) {
      var c = splitLine(l), o = {};
      head.forEach(function (h, i) { o[h] = c[i]; });
      return o;
    });
  }
  // tech.csv effect text has no embedded commas, but be defensive
  function splitLine(l) { return l.split(","); }
  function num(v) { return parseFloat(v) || 0; }

  function loadData() {
    return Promise.all([
      fetch(DATA + "tech.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "chassis.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "guns.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "armor.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "drones.csv").then(function (r) { return r.text(); }),
      fetch(DATA + "ew.csv").then(function (r) { return r.text(); }),
    ]).then(function (res) {
      DB.tech = parseCSV(res[0]).map(function (r) {
        return {
          id: +r.tech_id, branch: r.branch.trim(), name: r.name, year: +r.year,
          starting: +r.starting === 1, chance: num(r.chance_pct), cost: num(r.cost),
          effect: r.effect || ""
        };
      });
      DB.chassis = parseCSV(res[1]).map(function (r) {
        return { name: r.name, cls: r.class, year: +r.year_available, cal: num(r.max_mount_caliber_mm) };
      });
      DB.guns = parseCSV(res[2]).map(function (r) {
        return { name: r.name, cal: num(r.caliber_mm), year: +r.year_available, type: r.type };
      });
      DB.armor = parseCSV(res[3]).map(function (r) {
        return { name: r.name, year: +r.year_available, quality: num(r.quality_factor) };
      });
      DB.drones = parseCSV(res[4]).map(function (r) {
        return { name: r.name, role: r.role, year: +r.year_available, payload: r.payload_type };
      });
      DB.ew = parseCSV(res[5]).map(function (r) {
        return { name: r.name, type: r.type, year: +r.year_available };
      });
    });
  }

  // ------------------------------------------------------------------ helpers
  function branches() {
    var seen = {}, list = [];
    DB.tech.forEach(function (t) { if (!seen[t.branch]) { seen[t.branch] = 1; list.push(t.branch); } });
    // stable order by BRANCH_ORDER then discovery
    list.sort(function (a, b) {
      var ia = BRANCH_ORDER.indexOf(a), ib = BRANCH_ORDER.indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib;
    });
    return list;
  }
  function techsInBranch(br) {
    return DB.tech.filter(function (t) { return t.branch === br; })
      .sort(function (a, b) { return a.year - b.year || a.id - b.id; });
  }
  // status: done | prog | avail | locked
  function statusOf(t) {
    if (S.done[t.id]) return "done";
    if (t.year > S.year) return "locked";
    if (S.funded[t.id] && (S.progress[t.id] || 0) > 0) return "prog";
    if (S.funded[t.id]) return "prog";
    return "avail";
  }
  function currentEra() {
    for (var i = 0; i < ERAS.length; i++) {
      if (S.year >= ERAS[i].y0 && S.year < ERAS[i].y1) return ERAS[i];
    }
    return S.year >= 2070 ? ERAS[ERAS.length - 1] : ERAS[0];
  }
  function knownCount() {
    var n = 0; DB.tech.forEach(function (t) { if (S.done[t.id]) n++; }); return n;
  }

  // what a completed/available tech unlocks: scan component CSVs whose name/keyword
  // appears in the tech effect text, plus the era-curve rules from the wiki.
  function unlocksForTech(t) {
    var eff = t.effect.toLowerCase(), out = [];
    function add(label) { if (out.indexOf(label) < 0) out.push(label); }
    // direct chassis unlocks
    DB.chassis.forEach(function (c) {
      if (eff.indexOf(c.cls.toLowerCase()) >= 0 && eff.indexOf("chassis") >= 0)
        add("chassis:" + c.name + " (" + c.cls + ")");
    });
    // armour tier unlocks ("Unlocks <Tier> tier")
    if (eff.indexOf("unlocks") >= 0 && eff.indexOf("tier") >= 0) {
      DB.armor.forEach(function (a) {
        var key = a.name.split(" ")[0].toLowerCase();
        if (eff.indexOf(key) >= 0) add("armour:" + a.name + " (q" + a.quality.toFixed(2) + ")");
      });
    }
    // gun families
    if (eff.indexOf("203mm") >= 0 || eff.indexOf("305mm") >= 0 || eff.indexOf("siege gun") >= 0)
      add("guns:203mm / 305mm siege");
    if (eff.indexOf("coil gun") >= 0 || eff.indexOf("coilgun") >= 0) add("guns:coil guns");
    if (eff.indexOf("rail gun") >= 0 || eff.indexOf("railgun") >= 0) add("guns:rail guns");
    if (eff.indexOf("20-305mm") >= 0 || eff.indexOf("conventional gun") >= 0) add("guns:conventional 20-305mm");
    // mounts
    if (eff.indexOf("twin mount") >= 0) add("mount:twin mounts");
    if (eff.indexOf("triple mount") >= 0) add("mount:triple mounts");
    if (eff.indexOf("rail and coil") >= 0) add("mount:rail/coil mount rails");
    // drones
    if (eff.indexOf("recon drone") >= 0) add("drone:recon drones");
    if (eff.indexOf("loiter") >= 0) add("drone:loiter-munition drones");
    if (eff.indexOf("strike drone") >= 0) add("drone:strike drones");
    if (eff.indexOf("swarm drone") >= 0) add("drone:swarm drones");
    if (eff.indexOf("emp drone") >= 0) add("drone:EMP payload drones");
    if (eff.indexOf("thermobaric drone") >= 0) add("drone:thermobaric drones");
    // EW
    if (eff.indexOf("jammer module") >= 0 || eff.indexOf("wideband jammer") >= 0) add("ew:jammer module");
    if (eff.indexOf("spoofer") >= 0) add("ew:spoofer module");
    if (eff.indexOf("drone detector") >= 0) add("ew:drone detector");
    if (eff.indexOf("cuas turret") >= 0) add("ew:C-UAS turret");
    if (eff.indexOf("hardened link") >= 0) add("ew:hardened datalink");
    if (eff.indexOf("freq-hop") >= 0) add("ew:frequency hopping");
    // sensors
    if (eff.indexOf("radar") >= 0 && eff.indexOf("enables") >= 0) add("sensor:search radar");
    return out;
  }

  // ------------------------------------------------------------------ init / persistence
  function initBranchPriorities() {
    branches().forEach(function (b) { if (!S.branchPriority[b]) S.branchPriority[b] = "Med"; });
  }
  function applyStartingTechs() {
    DB.tech.forEach(function (t) { if (t.starting) { S.done[t.id] = true; } });
  }
  function resetCampaign() {
    S.year = 2025; S.funded = {}; S.progress = {}; S.done = {}; S.log = [];
    S.rpFundedThisTurn = 0; S.rpBase = 150;
    branches().forEach(function (b) { S.branchPriority[b] = "Med"; });
    applyStartingTechs();
    logLine("adv", "Campaign reset to 2025. Starting techs granted.");
    save(); renderAll();
  }
  function save() {
    try {
      localStorage.setItem("cb_tech_state", JSON.stringify({
        year: S.year, rpBase: S.rpBase, branchPriority: S.branchPriority,
        funded: S.funded, progress: S.progress, done: S.done, log: S.log.slice(0, 60),
        selectedBranch: S.selectedBranch
      }));
    } catch (e) {}
  }
  function restore() {
    try {
      var raw = localStorage.getItem("cb_tech_state");
      if (!raw) return false;
      var o = JSON.parse(raw);
      S.year = o.year || 2025; S.rpBase = o.rpBase || 150;
      S.branchPriority = o.branchPriority || {}; S.funded = o.funded || {};
      S.progress = o.progress || {}; S.done = o.done || {}; S.log = o.log || [];
      S.selectedBranch = o.selectedBranch || "ALL";
      return true;
    } catch (e) { return false; }
  }

  function logLine(kind, msg) {
    S.log.unshift({ kind: kind, msg: "[" + S.year + "] " + msg });
    if (S.log.length > 80) S.log.length = 80;
  }

  // ------------------------------------------------------------------ SIMULATION
  // Distribute this year's RP across funded+available techs weighted by branch priority,
  // each rolls chance% to "progress" (stochastic skip), accumulate toward cost, complete
  // when reached.  Pre-year techs can't be funded; reduced-RP note is handled by gating.
  function advanceYear() {
    S.year += 1;

    // collect fundable techs this turn: funded, not done, year reached
    var fundable = DB.tech.filter(function (t) {
      return S.funded[t.id] && !S.done[t.id] && t.year <= S.year;
    });

    // any funded tech that is still year-locked: note it generates reduced (groundwork) RP
    var pre = DB.tech.filter(function (t) { return S.funded[t.id] && !S.done[t.id] && t.year > S.year; });
    pre.forEach(function (t) {
      // reduced groundwork progress: 25% effective, still gated from completion
      S.progress[t.id] = (S.progress[t.id] || 0) + t.cost * 0.0; // no real progress pre-year
    });
    if (pre.length) logLine("adv", pre.length + " funded tech(s) still year-locked \u2014 reduced groundwork RP only.");

    if (!fundable.length) {
      S.rpFundedThisTurn = 0;
      logLine("adv", "Advanced to " + S.year + ". No funded, in-year techs \u2014 RP banked.");
      save(); renderAll(); return;
    }

    // weights by branch priority
    var totalW = 0, weights = {};
    fundable.forEach(function (t) {
      var w = PRIORITY_W[S.branchPriority[t.branch] || "Med"] || 1;
      weights[t.id] = w; totalW += w;
    });

    var budget = S.rpBase;
    S.rpFundedThisTurn = budget;
    var completedThisTurn = [];

    fundable.forEach(function (t) {
      var alloc = budget * (weights[t.id] / totalW);
      // stochastic skip-chance: roll chance% -> success applies full alloc + a breakthrough
      // bonus; failure carries forward HALF the alloc (invested points carry forward).
      var roll = Math.random() * 100;
      var hit = roll < effectiveChance(t);
      var gain;
      if (hit) {
        gain = alloc + t.cost * 0.10; // breakthrough accelerates
        logLine("win", t.name + " \u2014 breakthrough roll \u2713 (+" + Math.round(gain) + " RP)");
      } else {
        gain = alloc * 0.5;           // invested points carry forward
        logLine("skip", t.name + " \u2014 roll missed (" + Math.round(roll) + "\u2265" + Math.round(effectiveChance(t)) + "%), carry forward");
      }
      S.progress[t.id] = (S.progress[t.id] || 0) + gain;
      if (S.progress[t.id] >= t.cost) {
        S.done[t.id] = true;
        S.progress[t.id] = t.cost;
        completedThisTurn.push(t);
      }
    });

    completedThisTurn.forEach(function (t) {
      var unl = unlocksForTech(t);
      logLine("win", "\u25C6 RESEARCHED: " + t.name + (unl.length ? " \u2014 UNLOCKS " + unl.map(stripPrefix).join(", ") : ""));
    });

    save(); renderAll();
  }

  function stripPrefix(s) { return s.indexOf(":") >= 0 ? s.split(":")[1] : s; }

  // effective chance raised by branch priority (High focuses, Low slows) - RtW "focus"
  function effectiveChance(t) {
    var p = S.branchPriority[t.branch] || "Med";
    var mult = p === "High" ? 1.5 : (p === "Low" ? 0.6 : 1.0);
    return Math.min(95, t.chance * mult);
  }

  function runYears(n) {
    for (var i = 0; i < n; i++) advanceYear();
  }

  // auto-fund: for each branch, fund the earliest available not-done tech (respecting year)
  function autoFundByPriority() {
    branches().forEach(function (br) {
      var avail = techsInBranch(br).filter(function (t) {
        return !S.done[t.id] && t.year <= S.year;
      });
      // fund a number of techs proportional to priority
      var p = S.branchPriority[br] || "Med";
      var count = p === "High" ? 2 : (p === "Med" ? 1 : 0);
      avail.slice(0, count).forEach(function (t) { S.funded[t.id] = true; });
    });
    logLine("adv", "Auto-funded available techs by branch priority.");
    save(); renderAll();
  }

  function toggleFund(id) {
    var t = DB.tech.find(function (x) { return x.id === id; });
    if (!t || S.done[id] || t.year > S.year) return;
    S.funded[id] = !S.funded[id];
    if (!S.funded[id]) { /* keep accumulated progress as carry-forward */ }
    save(); renderAll();
  }

  // ------------------------------------------------------------------ RENDER
  function el(id) { return document.getElementById(id); }

  function renderAll() {
    el("yearLbl").textContent = S.year;
    el("yrShow").textContent = S.year;
    el("rpShow").textContent = S.rpBase;
    el("rpBase").textContent = S.rpBase;
    el("rpFunded").textContent = Math.round(S.rpFundedThisTurn);
    var pct = S.rpBase ? Math.min(100, (S.rpFundedThisTurn / S.rpBase) * 100) : 0;
    el("rpBar").firstElementChild.style.width = pct + "%";
    renderBranches();
    renderTree();
    renderSummary();
    renderEra();
    renderUnlocks();
    renderLog();
  }

  function renderBranches() {
    var host = el("branchList"); host.innerHTML = "";
    // "ALL" pseudo branch
    var allDiv = document.createElement("div");
    allDiv.className = "branch" + (S.selectedBranch === "ALL" ? " sel" : "");
    allDiv.innerHTML = '<span class="nm">ALL BRANCHES</span><span class="cnt">' +
      knownCount() + "/" + DB.tech.length + "</span>";
    allDiv.onclick = function () { S.selectedBranch = "ALL"; save(); renderAll(); };
    host.appendChild(allDiv);

    branches().forEach(function (br) {
      var ts = techsInBranch(br);
      var done = ts.filter(function (t) { return S.done[t.id]; }).length;
      var div = document.createElement("div");
      div.className = "branch" + (S.selectedBranch === br ? " sel" : "");
      var pr = S.branchPriority[br] || "Med";
      var pribtns = '<span class="pribtns">' +
        ["High", "Med", "Low"].map(function (p) {
          return '<button data-p="' + p + '" class="' + (pr === p ? "on" : "") +
            '">' + p[0] + '</button>';
        }).join("") + '</span>';
      div.innerHTML = '<span class="nm" title="' + br + '">' + br + '</span>' +
        '<span class="cnt">' + done + "/" + ts.length + "</span>" + pribtns;
      div.querySelector(".nm").onclick = function () { S.selectedBranch = br; save(); renderAll(); };
      div.querySelector(".cnt").onclick = function () { S.selectedBranch = br; save(); renderAll(); };
      div.querySelectorAll(".pribtns button").forEach(function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          S.branchPriority[br] = b.getAttribute("data-p");
          save(); renderAll();
        };
      });
      host.appendChild(div);
    });
  }

  function renderTree() {
    var host = el("cols"); host.innerHTML = "";
    el("treeTitle").textContent = S.selectedBranch === "ALL" ? "TECH TREE \u2014 ALL BRANCHES" : "TECH TREE \u2014 " + S.selectedBranch.toUpperCase();
    var brs = S.selectedBranch === "ALL" ? branches() : [S.selectedBranch];
    brs.forEach(function (br) {
      var col = document.createElement("div");
      col.className = "col";
      var ts = techsInBranch(br);
      var done = ts.filter(function (t) { return S.done[t.id]; }).length;
      var hdr = document.createElement("div");
      hdr.className = "colhdr";
      hdr.innerHTML = "<span>" + br + "</span><span class='pr'>" +
        (S.branchPriority[br] || "Med") + " \u00b7 " + done + "/" + ts.length + "</span>";
      col.appendChild(hdr);
      ts.forEach(function (t) { col.appendChild(techCard(t)); });
      host.appendChild(col);
    });
  }

  function techCard(t) {
    var st = statusOf(t);
    var div = document.createElement("div");
    div.className = "tech s-" + st + (S.funded[t.id] ? " funded" : "");
    var prog = S.progress[t.id] || 0;
    var pp = t.cost ? Math.min(100, (prog / t.cost) * 100) : 100;

    var stLabel = { done: "DONE", prog: "FUNDED", avail: "AVAILABLE", locked: "LOCKED" }[st];
    var html = '<div class="th"><span class="nm">' + t.name + '</span>' +
      '<span class="yr">' + t.year + (t.starting ? " \u2605" : "") + '</span></div>';
    html += '<div class="meta">' +
      '<span>COST <b>' + (t.cost ? t.cost + " RP" : "\u2014") + '</b></span>' +
      '<span>CHANCE <b>' + (t.chance) + '%</b></span>' +
      '<span class="st st-' + st + '">' + stLabel + '</span></div>';
    html += '<div class="eff">' + t.effect + '</div>';

    if (st === "locked") {
      html += '<div class="unl" style="color:var(--dim)">\uD83D\uDD12 unlocks ~' + t.year + '</div>';
    } else if (st === "done" || st === "prog" || st === "avail") {
      var unl = unlocksForTech(t);
      if (unl.length) html += '<div class="unl">UNLOCKS: ' + unl.map(stripPrefix).join(" \u00b7 ") + '</div>';
    }

    // progress bar for funded (or done) in-year techs
    if ((st === "prog" || st === "done") && t.cost > 0) {
      html += '<div class="pbar' + (st === "done" ? " done" : "") + '"><i style="width:' + pp + '%"></i></div>';
      html += '<div class="meta"><span>' + Math.round(prog) + " / " + t.cost + " RP</span>" +
        (st === "done" ? "<span class='st-done'>COMPLETE</span>" : "") + "</div>";
    }

    // fund toggle (only for available/funded non-done in-year)
    if (st === "avail" || st === "prog") {
      var fb = '<span class="fundbtn' + (S.funded[t.id] ? " on" : "") + '">' +
        (S.funded[t.id] ? "FUNDED \u2713" : "FUND \u25B8") + '</span>';
      html += fb;
    }

    div.innerHTML = html;
    var fbEl = div.querySelector(".fundbtn");
    if (fbEl) fbEl.onclick = function (e) { e.stopPropagation(); toggleFund(t.id); };
    div.onclick = function () { if (st === "avail" || st === "prog") toggleFund(t.id); };
    return div;
  }

  function renderSummary() {
    var host = el("summary"); host.innerHTML = "";
    var era = currentEra();
    var rows = [
      ["Known techs", knownCount() + " / " + DB.tech.length, "good"],
      ["Research year", S.year, ""],
      ["RP / year", S.rpBase, ""],
      ["Era", era.name, "warn"],
      ["Era window", era.y0 + "\u2013" + era.y1, ""],
      ["Funded techs", Object.keys(S.funded).filter(function (k) { return S.funded[k] && !S.done[k]; }).length, ""],
    ];
    rows.forEach(function (r) {
      var d = document.createElement("div");
      d.className = "row" + (r[2] ? " " + r[2] : "");
      d.innerHTML = '<span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span>';
      host.appendChild(d);
    });
    var note = document.createElement("div");
    note.className = "lbl"; note.style.marginTop = "6px"; note.style.lineHeight = "1.5";
    note.textContent = era.theme;
    host.appendChild(note);
  }

  function renderEra() {
    var host = el("eraBand"); host.innerHTML = "";
    var cur = currentEra();
    ERAS.forEach(function (e) {
      var d = document.createElement("div");
      d.className = "era" + (e === cur ? " cur" : "");
      d.innerHTML = '<span>' + e.name + '</span><span class="yrs">' + e.y0 + "\u2013" + e.y1 + "</span>";
      host.appendChild(d);
    });
  }

  // unlocks panel: list components (guns/chassis/armour/drones/ew) available by current year.
  function renderUnlocks() {
    var host = el("unlocks"); host.innerHTML = "";
    function group(title, items, fmt) {
      var avail = items.filter(function (i) { return i.year <= S.year; })
        .sort(function (a, b) { return a.year - b.year; });
      if (!avail.length) return;
      var g = document.createElement("div"); g.className = "ulgroup";
      g.innerHTML = '<div class="gh">' + title + " (" + avail.length + ")</div>";
      avail.forEach(function (i) {
        var d = document.createElement("div");
        var isNew = i.year === S.year;
        d.className = "unlock" + (isNew ? " new" : "");
        d.innerHTML = fmt(i);
        g.appendChild(d);
      });
      host.appendChild(g);
    }
    group("Chassis", DB.chassis, function (c) {
      return '<span class="un">' + c.name + '</span> <span class="uy">' + c.year + '</span>' +
        '<div class="ut">' + c.cls + " \u00b7 \u2264" + c.cal + "mm</div>";
    });
    group("Guns", DB.guns, function (g) {
      return '<span class="un">' + g.name + '</span> <span class="uy">' + g.year + '</span>' +
        '<div class="ut">' + g.cal + "mm \u00b7 " + g.type + "</div>";
    });
    group("Armour", DB.armor, function (a) {
      return '<span class="un">' + a.name + '</span> <span class="uy">' + a.year + '</span>' +
        '<div class="ut">quality ' + a.quality.toFixed(2) + "</div>";
    });
    group("Drones", DB.drones, function (d) {
      return '<span class="un">' + d.name + '</span> <span class="uy">' + d.year + '</span>' +
        '<div class="ut">' + d.role + " \u00b7 " + d.payload + "</div>";
    });
    group("Electronic Warfare", DB.ew, function (e) {
      return '<span class="un">' + e.name + '</span> <span class="uy">' + e.year + '</span>' +
        '<div class="ut">' + e.type + "</div>";
    });
    if (!host.children.length) host.innerHTML = '<div class="lbl">Nothing buildable yet.</div>';
  }

  function renderLog() {
    var host = el("log"); host.innerHTML = "";
    if (!S.log.length) { host.innerHTML = '<div class="e">No research activity yet. Fund techs and ADVANCE.</div>'; return; }
    S.log.forEach(function (l) {
      var d = document.createElement("div");
      d.className = "e " + (l.kind || "");
      d.textContent = l.msg;
      host.appendChild(d);
    });
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    el("yrUp").onclick = function () { S.year++; save(); renderAll(); };
    el("yrDown").onclick = function () { if (S.year > 2025) S.year--; save(); renderAll(); };
    el("rpUp").onclick = function () { S.rpBase += 10; save(); renderAll(); };
    el("rpDown").onclick = function () { if (S.rpBase > 10) S.rpBase -= 10; save(); renderAll(); };
    el("advBtn").onclick = function () { advanceYear(); };
    el("run5Btn").onclick = function () { runYears(5); };
    el("autoBtn").onclick = function () { autoFundByPriority(); };
    el("resetBtn").onclick = function () { resetCampaign(); };
  }

  // demo driver: ?demo=N fast-forwards a sample funded campaign N years (for showcase/test)
  function runDemo(years) {
    S.year = 2025; S.funded = {}; S.progress = {}; S.done = {}; S.log = [];
    applyStartingTechs();
    // bias a couple of branches high, fund early techs in several branches
    S.branchPriority["Machinery"] = "High";
    S.branchPriority["Hull / Chassis"] = "High";
    S.branchPriority["Guns & AP"] = "Med";
    ["Machinery", "Armour", "Hull / Chassis", "Fire Control", "Guns & AP", "Mountings"].forEach(function (br) {
      var avail = techsInBranch(br).filter(function (t) { return !S.done[t.id] && t.year <= S.year + years; });
      avail.slice(0, 3).forEach(function (t) { S.funded[t.id] = true; });
    });
    for (var i = 0; i < years; i++) {
      advanceYearNoRender();
      // re-fund next available techs each year
      autoFundSilent();
    }
  }
  function advanceYearNoRender() { var r = renderAll; renderAll = function () {}; advanceYear(); renderAll = r; }
  function autoFundSilent() {
    branches().forEach(function (br) {
      var avail = techsInBranch(br).filter(function (t) { return !S.done[t.id] && t.year <= S.year; });
      var p = S.branchPriority[br] || "Med";
      var count = p === "High" ? 2 : (p === "Med" ? 1 : 0);
      avail.slice(0, count).forEach(function (t) { S.funded[t.id] = true; });
    });
  }

  // ------------------------------------------------------------------ boot
  loadData().then(function () {
    initBranchPriorities();
    var demo = new URLSearchParams(location.search).get("demo");
    if (demo) {
      // demo mode: ignore saved state, fast-forward a sample campaign
      runDemo(parseInt(demo, 10) || 20);
      wire();
      renderAll();
      return;
    }
    var had = restore();
    if (!had) { applyStartingTechs(); logLine("adv", "Bureau initialised \u2014 starting techs granted."); }
    else { initBranchPriorities(); } // ensure any new branches have a priority
    wire();
    renderAll();
  }).catch(function (e) {
    document.getElementById("cols").innerHTML =
      '<div style="color:#9a3a33;padding:20px">Failed to load tech data: ' + e + '</div>';
    console.error(e);
  });
})();
