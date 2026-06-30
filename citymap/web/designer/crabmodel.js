/* CITY BATTLE - procedural crab-mecha model builder (shared by designer + map).
   Builds a NARROW, ship-like walking artillery crab as a THREE.Group from a spec:
     { chassisClass, lengthM, beamFrac, legs, mounts:[{caliberMm,arc}], modules:int, team }
   Design ethos: destroyer/cruiser silhouette on legs - long, slim chined hull, pointed
   prow, raised aft superstructure, freeboard plating, splayed insectoid legs (coxa/
   femur/tibia with knees), a sensor mast, and turrets stepped fore-to-aft on the
   centreline. Each chassis class has a recognisable silhouette from afar.
   Returns { group, sockets:[Vector3], turrets:[Mesh], lengthM, beam } for designer.js. */
(function (global) {
  "use strict";
  var T = global.THREE;

  // ---- per-class character ----------------------------------------------------
  // beam   : hull width as a fraction of length (small = narrow, ship-like)
  // height : hull depth (freeboard) as a fraction of length
  // legs   : number of legs (matches chassis.csv)
  // legLen : leg reach as a fraction of standY (taller = more splay / ground clearance)
  // mast   : sensor-mast height multiplier (Recon towers; Spider squats)
  // turrets: number of main turrets fore-to-aft
  // segs   : hull plate segments (more = chunkier, longer ships)
  // tier   : aft superstructure tiers (Siege = multi-tier dreadnought tower)
  // deck   : 1 = flat carrier-style hangar deck instead of a tower
  // splay  : how far legs kick out sideways
  var CLASS_PROFILE = {
    Recon:      { beam: 0.22, height: 0.11, legs: 6,  legLen: 1.05, mast: 1.9, turrets: 1, segs: 3, tier: 1, deck: 0, splay: 1.05, pods: 1 },
    Skirmisher: { beam: 0.24, height: 0.13, legs: 6,  legLen: 0.95, mast: 1.35, turrets: 2, segs: 3, tier: 1, deck: 0, splay: 1.0,  pods: 1 },
    Line:       { beam: 0.27, height: 0.15, legs: 8,  legLen: 0.85, mast: 1.1,  turrets: 4, segs: 4, tier: 2, deck: 0, splay: 0.95, pods: 2 },
    Spider:     { beam: 0.40, height: 0.12, legs: 12, legLen: 1.15, mast: 0.7,  turrets: 4, segs: 4, tier: 1, deck: 0, splay: 1.35, pods: 2 },
    Siege:      { beam: 0.32, height: 0.22, legs: 8,  legLen: 0.72, mast: 0.95, turrets: 3, segs: 5, tier: 4, deck: 0, splay: 0.9,  pods: 3 },
    Carrier:    { beam: 0.36, height: 0.16, legs: 10, legLen: 0.82, mast: 1.5,  turrets: 1, segs: 4, tier: 1, deck: 1, splay: 1.05, pods: 4 },
  };

  var COL = { friend: 0x3e7a74, hostile: 0x9a3a33, civ: 0x7a6a3a, neutral: 0x5a6258 };

  function mat(c, opt) {
    opt = opt || {};
    return new T.MeshStandardMaterial({
      color: c, roughness: opt.r != null ? opt.r : 0.55, metalness: opt.m != null ? opt.m : 0.35,
      emissive: opt.e != null ? opt.e : 0x000000, emissiveIntensity: opt.ei != null ? opt.ei : 0,
      flatShading: opt.flat != null ? opt.flat : true
    });
  }

  // ---- ship-like chined hull: an extruded cross-section along the keel ---------
  // Builds a BufferGeometry hull running along +Z (length), with a flat bottom,
  // angled chine side panels, a flat deck, a pointed prow and a squared transom.
  // beam = full width, ht = freeboard depth. Returns a Mesh centred at origin.
  function buildHull(L, beam, ht, material) {
    var hw = beam * 0.5;           // half beam
    var bottomHW = hw * 0.55;      // narrow flat bottom (the keel pan)
    var deckHW = hw;               // full beam at deck (widest)
    var chineY = ht * 0.42;        // height where the side wall kicks out (the chine)
    var deckY = ht;
    // half cross-section (will be mirrored): list of [x,y] from keel up the side to deck centre
    // Profile points, port side (negative x), going bottom->chine->deck:
    var prof = [
      [0, 0],                 // keel centre bottom
      [bottomHW, 0],          // bottom outer
      [hw * 0.9, chineY],     // chine knuckle (kicks out)
      [deckHW, deckY * 0.78], // freeboard top of side plating
      [deckHW * 0.92, deckY], // deck edge (slight tumblehome)
      [0, deckY]              // deck centre
    ];

    // Stations along the length: prow(taper), fwd, mid, aft, transom.
    // Each station scales the cross-section width and offsets deck height.
    // z in [-L/2 .. +L/2]; +Z = bow.
    var stations = [
      { z:  0.52 * L, s: 0.015, dy: 0.10 }, // sharp ram-prow tip (knife bow)
      { z:  0.44 * L, s: 0.28, dy: 0.06 },  // fine bow
      { z:  0.30 * L, s: 0.66, dy: 0.02 },
      { z:  0.10 * L, s: 0.96, dy: 0.0  },  // widening
      { z: -0.05 * L, s: 1.00, dy: 0.0  },  // widest, midships
      { z: -0.26 * L, s: 0.96, dy: 0.0  },
      { z: -0.44 * L, s: 0.84, dy: 0.02 },
      { z: -0.50 * L, s: 0.80, dy: 0.03 }   // transom (squared stern)
    ];

    var pos = [], idx = [];
    var ringLen = prof.length * 2 - 1; // mirrored ring (centre point shared at top, doubled bottom keel)
    // Build full ring per station: port side reversed deck->keel, then starboard keel->deck.
    function ring(st) {
      var r = [];
      // port (x negative): from deck centre down to keel
      for (var i = prof.length - 1; i >= 0; i--) {
        r.push([-prof[i][0] * st.s, prof[i][1] + st.dy * (1 - prof[i][1] / deckY), st.z]);
      }
      // starboard (x positive): keel up to deck, skip the shared keel-centre (i=0) & deck-centre dup
      for (var j = 1; j < prof.length; j++) {
        r.push([prof[j][0] * st.s, prof[j][1] + st.dy * (1 - prof[j][1] / deckY), st.z]);
      }
      return r;
    }
    var rings = stations.map(ring);
    var ringN = rings[0].length;
    // push vertices
    for (var a = 0; a < rings.length; a++)
      for (var b = 0; b < ringN; b++) {
        var v = rings[a][b]; pos.push(v[0], v[1], v[2]);
      }
    // side quads between consecutive stations
    for (var a2 = 0; a2 < rings.length - 1; a2++) {
      var base0 = a2 * ringN, base1 = (a2 + 1) * ringN;
      for (var b2 = 0; b2 < ringN - 1; b2++) {
        var p0 = base0 + b2, p1 = base0 + b2 + 1, p2 = base1 + b2 + 1, p3 = base1 + b2;
        idx.push(p0, p1, p2, p0, p2, p3);
      }
    }
    // cap the transom (last ring) with a fan to its centroid-ish (deck-centre vertex)
    var lastBase = (rings.length - 1) * ringN;
    var transomCentre = lastBase + Math.floor(ringN / 2);
    for (var c = 0; c < ringN - 1; c++) {
      idx.push(lastBase + c, lastBase + c + 1, transomCentre);
    }

    var geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var m = new T.Mesh(geo, material);
    return m;
  }

  // a small chamfered box (octagon-ish prism) for plated blocks
  function chamferBox(w, h, d, material) {
    return new T.Mesh(new T.BoxGeometry(w, h, d), material);
  }

  // ---- main build -------------------------------------------------------------
  function build(spec) {
    spec = spec || {};
    var cls = spec.chassisClass || "Line";
    var P = CLASS_PROFILE[cls] || CLASS_PROFILE.Line;
    var L = spec.lengthM || 28;
    var beam = L * (spec.beamFrac || P.beam);
    var ht = L * P.height;
    var teamCol = COL[spec.team || "neutral"];

    var hullMat  = mat(teamCol, { r: 0.5, m: 0.32, e: teamCol, ei: 0.05 });
    var plateMat = mat(shade(teamCol, 0.82), { r: 0.62, m: 0.3 });   // freeboard / superstructure
    var darkMat  = mat(0x1c211c, { r: 0.8, m: 0.15 });               // barrels, leg segments
    var steelMat = mat(0x3a4038, { r: 0.55, m: 0.55 });              // joints, masts, feet
    var glowMat  = mat(0x70b0a0, { r: 0.3, m: 0.2, e: 0x4a8a7c, ei: 0.7 }); // sensors

    var g = new T.Group();
    var sockets = [], turrets = [];

    // ground clearance scales with leg reach so big crabs stand tall
    var standY = ht * 0.55 + L * 0.05 * P.legLen;

    // ===================== HULL ==============================================
    var hullGrp = new T.Group(); hullGrp.position.y = standY; g.add(hullGrp);
    var hull = buildHull(L, beam, ht, hullMat); hullGrp.add(hull);

    // freeboard / deck-edge plating rails (thin strakes along the gunwale)
    addGunwale(hullGrp, L, beam, ht, plateMat);

    // segmented deck plate lines (visual plating) - thin raised strakes across deck
    var nseg = P.segs;
    for (var s = 1; s < nseg; s++) {
      var zc = (s / nseg - 0.5) * L * 0.82;
      var w = beam * (0.9 - Math.abs(s / nseg - 0.5) * 0.4);
      var strake = new T.Mesh(new T.BoxGeometry(w, ht * 0.06, L * 0.012), plateMat);
      strake.position.set(0, ht + ht * 0.02, zc); hullGrp.add(strake);
    }

    // ===================== SUPERSTRUCTURE (class-defining) ===================
    var supTopY; // y (world) of the top deck where masts/turrets sit at aft
    if (P.deck) {
      // CARRIER: flat hangar deck + drone bay pods, low bridge island to one side
      var deck = new T.Mesh(new T.BoxGeometry(beam * 0.92, ht * 0.18, L * 0.5), plateMat);
      deck.position.set(0, standY + ht * 1.05, -L * 0.05); g.add(deck);
      // hangar pods (rounded bays) down the deck
      for (var hp = 0; hp < 3; hp++) {
        var bay = new T.Mesh(new T.CylinderGeometry(beam * 0.18, beam * 0.2, L * 0.1, 6, 1, false, 0, Math.PI), plateMat);
        bay.rotation.z = Math.PI / 2; bay.rotation.y = Math.PI / 2;
        bay.position.set(0, standY + ht * 1.18, (-0.18 + hp * 0.18) * L); g.add(bay);
      }
      // bridge island to starboard
      var island = new T.Mesh(new T.BoxGeometry(beam * 0.22, ht * 1.1, L * 0.14), plateMat);
      island.position.set(beam * 0.34, standY + ht * 1.6, -L * 0.18); g.add(island);
      supTopY = standY + ht * 1.6;
    } else {
      // TOWER superstructure: stepped tiers rising toward the stern (warship bridge)
      var tiers = P.tier;
      var baseY = standY + ht * 1.0;
      var twZ = -L * 0.26;
      for (var ti = 0; ti < tiers; ti++) {
        var tw = beam * (0.62 - ti * 0.1);
        var th = ht * (0.7 + (ti === 0 ? 0.2 : 0));
        var td = L * (0.16 - ti * 0.02);
        var blk = new T.Mesh(new T.BoxGeometry(tw, th, td), plateMat);
        blk.position.set(0, baseY + th * 0.5, twZ + ti * L * 0.015);
        g.add(blk);
        baseY += th * 0.92;
      }
      supTopY = baseY;
    }

    // ===================== SENSOR MAST =======================================
    var mastH = L * 0.34 * P.mast;
    var mastBaseY = supTopY;
    var mast = new T.Mesh(new T.CylinderGeometry(beam * 0.025, beam * 0.05, mastH, 6), steelMat);
    mast.position.set(0, mastBaseY + mastH * 0.5, -L * 0.26); g.add(mast);
    // radar dish / sensor at the top
    var dish = new T.Mesh(new T.SphereGeometry(beam * 0.1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), glowMat);
    dish.position.set(0, mastBaseY + mastH, -L * 0.26); g.add(dish);
    // cross-spars on the mast (warship yardarm look)
    var spar = new T.Mesh(new T.BoxGeometry(beam * 0.4, mastH * 0.04, mastH * 0.04), steelMat);
    spar.position.set(0, mastBaseY + mastH * 0.7, -L * 0.26); g.add(spar);
    // Recon gets a tall secondary whip antenna
    if (cls === "Recon") {
      var whip = new T.Mesh(new T.CylinderGeometry(beam * 0.012, beam * 0.012, mastH * 0.9, 4), steelMat);
      whip.position.set(beam * 0.12, mastBaseY + mastH * 0.45, -L * 0.26); g.add(whip);
    }
    // Carrier gets extra antennae forest on the island
    if (P.deck) {
      for (var an = 0; an < 4; an++) {
        var ant = new T.Mesh(new T.CylinderGeometry(beam * 0.01, beam * 0.01, L * (0.12 + an * 0.03), 4), steelMat);
        ant.position.set(beam * (0.28 + an * 0.03), standY + ht * 2.1 + L * 0.06 * an, -L * 0.18); g.add(ant);
      }
    }

    // ===================== TURRETS (centreline, fore->aft) ===================
    var mounts = spec.mounts && spec.mounts.length ? spec.mounts : defaultMounts(cls, P.turrets);
    var nT = Math.min(mounts.length, P.turrets);
    var deckY = standY + ht * 1.02;
    // Siege = battleship layout: superfiring forward turrets (A over B), stepped up.
    // Others = even spread along the forward 2/3 of the deck.
    var siege = cls === "Siege";
    for (var i = 0; i < nT; i++) {
      var frac, riser;
      if (siege) {
        // cluster all guns on the foredeck, ahead of the tower, stepped up toward the bow
        frac = 0.36 - i * 0.16;
        riser = (nT - 1 - i) * ht * 0.5; // aft of the cluster sits higher (superfiring)
      } else {
        frac = nT === 1 ? 0.12 : (0.32 - (i / (nT - 1)) * 0.58);
        riser = 0;
      }
      var tz = frac * L;
      var cal = mounts[i] ? mounts[i].caliberMm : 105;
      var calN = Math.min(cal, 305) / 305;
      var tSize = beam * (0.34 + calN * 0.34);
      var tg = new T.Group(); tg.position.set(0, deckY + riser, tz); g.add(tg);
      // barbette base
      var bar = new T.Mesh(new T.CylinderGeometry(tSize * 0.42, tSize * 0.48, ht * 0.24, 8), plateMat);
      bar.position.y = ht * 0.12; tg.add(bar);
      // faceted turret box (chamfered, low)
      var tTopY = ht * (0.4 + calN * 0.15);
      var turret = new T.Mesh(new T.BoxGeometry(tSize, ht * (0.4 + calN * 0.3), tSize * 1.25), hullMat);
      turret.position.y = tTopY; tg.add(turret);
      // barrel(s): length & thickness scale with calibre; twin barrels for big guns
      var barLen = L * (0.16 + calN * 0.5);
      var barR = beam * (0.022 + calN * 0.06);
      var twin = calN > 0.55;
      var barYs = twin ? [-barR * 1.4, barR * 1.4] : [0];
      for (var bk = 0; bk < barYs.length; bk++) {
        var barrel = new T.Mesh(new T.CylinderGeometry(barR, barR * 0.9, barLen, 8), darkMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(barYs[bk], tTopY, tSize * 0.5 + barLen * 0.45);
        tg.add(barrel);
        // muzzle ring
        var muz = new T.Mesh(new T.CylinderGeometry(barR * 1.3, barR * 1.3, barLen * 0.05, 8), steelMat);
        muz.rotation.x = Math.PI / 2;
        muz.position.set(barYs[bk], tTopY, tSize * 0.5 + barLen * 0.92);
        tg.add(muz);
      }
      turrets.push(tg);
      sockets.push(new T.Vector3(0, deckY + riser + tTopY, tz));
    }

    // ===================== LEGS (insectoid: coxa / femur / tibia) =============
    buildLegs(g, P, L, beam, standY, darkMat, steelMat);

    // ===================== UTILITY / DRONE PODS ==============================
    var nMod = spec.modules != null ? spec.modules : P.pods;
    nMod = Math.min(nMod, 6);
    for (var mI = 0; mI < nMod; mI++) {
      var col = mI % 2 ? 1 : -1;
      var rowi = Math.floor(mI / 2);
      var pod = new T.Mesh(new T.BoxGeometry(beam * 0.16, ht * 0.4, L * 0.07), steelMat);
      pod.position.set(col * beam * 0.3, standY + ht * 1.18, -L * (0.0 + rowi * 0.09)); g.add(pod);
      // small nav light on each pod
      var lt = new T.Mesh(new T.SphereGeometry(beam * 0.03, 5, 4), glowMat);
      lt.position.set(col * beam * 0.3, standY + ht * 1.42, -L * (0.0 + rowi * 0.09)); g.add(lt);
    }

    // prow nav light
    var prowLt = new T.Mesh(new T.SphereGeometry(beam * 0.035, 6, 5), glowMat);
    prowLt.position.set(0, standY + ht * 0.55, L * 0.49); g.add(prowLt);

    return { group: g, sockets: sockets, turrets: turrets, lengthM: L, beam: beam };
  }

  // gunwale / freeboard rails running the length on each side
  function addGunwale(hullGrp, L, beam, ht, m) {
    for (var sd = -1; sd <= 1; sd += 2) {
      var rail = new T.Mesh(new T.BoxGeometry(beam * 0.04, ht * 0.16, L * 0.86), m);
      rail.position.set(sd * beam * 0.46, ht * 0.96, -L * 0.02);
      hullGrp.add(rail);
    }
  }

  // insectoid splayed legs in pairs, evenly spaced along the hull
  function buildLegs(g, P, L, beam, standY, segMat, jointMat) {
    var legPairs = Math.floor(P.legs / 2);
    var splay = P.splay;
    var legR = L * 0.011;
    for (var side = -1; side <= 1; side += 2) {
      for (var li = 0; li < legPairs; li++) {
        var t = legPairs === 1 ? 0.5 : li / (legPairs - 1);
        var lz = (t - 0.5) * L * 0.78;
        // hip socket on the hull flank
        var hipX = side * beam * 0.5;
        var hipY = standY * 0.92;

        var legGrp = new T.Group(); g.add(legGrp);

        // COXA: short outward stub from the hull
        var coxaLen = standY * 0.25 * splay;
        var coxa = new T.Mesh(new T.CylinderGeometry(legR * 1.2, legR * 1.1, coxaLen, 6), segMat);
        coxa.position.set(hipX + side * coxaLen * 0.5, hipY, lz);
        coxa.rotation.z = side * Math.PI / 2;
        legGrp.add(coxa);
        var coxaEndX = hipX + side * coxaLen;

        // shoulder joint
        addJoint(legGrp, coxaEndX, hipY, lz, legR * 1.5, jointMat);

        // FEMUR: angles up-and-out to the knee (the high crab-knee)
        var kneeOutX = coxaEndX + side * standY * 0.55 * splay;
        var kneeY = hipY + standY * 0.28;     // knee rises above the hip (crab posture)
        var femur = strut(coxaEndX, hipY, lz, kneeOutX, kneeY, lz, legR, segMat);
        legGrp.add(femur);

        // knee joint
        addJoint(legGrp, kneeOutX, kneeY, lz, legR * 1.4, jointMat);

        // TIBIA: drops down-and-out to a pointed foot on the ground
        var footX = kneeOutX + side * standY * 0.32 * splay;
        var tibia = strut(kneeOutX, kneeY, lz, footX, 0.0, lz, legR * 0.85, segMat);
        legGrp.add(tibia);

        // pointed foot (cone) digging into ground
        var foot = new T.Mesh(new T.ConeGeometry(legR * 2.0, standY * 0.18, 5), jointMat);
        foot.position.set(footX, standY * 0.05, lz);
        legGrp.add(foot);
      }
    }
  }

  // a cylinder strut between two points (a,b)
  function strut(ax, ay, az, bx, by, bz, r, m) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var mesh = new T.Mesh(new T.CylinderGeometry(r, r * 0.9, len, 6), m);
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    // orient +Y axis along (dx,dy,dz)
    var up = new T.Vector3(0, 1, 0);
    var dir = new T.Vector3(dx, dy, dz).normalize();
    var q = new T.Quaternion().setFromUnitVectors(up, dir);
    mesh.quaternion.copy(q);
    return mesh;
  }

  function addJoint(parent, x, y, z, r, m) {
    var j = new T.Mesh(new T.SphereGeometry(r, 6, 5), m);
    j.position.set(x, y, z); parent.add(j);
  }

  // darken/lighten a hex colour by factor (0..1+ )
  function shade(hex, f) {
    var r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    r = Math.min(255, r * f) | 0; g = Math.min(255, g * f) | 0; b = Math.min(255, b * f) | 0;
    return (r << 16) | (g << 8) | b;
  }

  function defaultMounts(cls, n) {
    var cal = cls === "Siege" ? 305 : cls === "Spider" ? 203 : cls === "Line" ? 155 :
              cls === "Skirmisher" ? 90 : cls === "Carrier" ? 127 : 57;
    var out = []; for (var i = 0; i < n; i++) out.push({ caliberMm: cal, arc: 360 });
    return out;
  }

  global.CrabModel = { build: build, CLASS_PROFILE: CLASS_PROFILE, COL: COL };
})(window);
