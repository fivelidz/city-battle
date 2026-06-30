/* ============================================================================
 * CITY BATTLE // ARTILLERY ACADEMY — tutorial card deck
 * Pure vanilla. Each card = {n, key, title, tag, html, svg}. SVG is hand-drawn
 * line art in the Eva-muted palette (amber/teal/green/red on near-black).
 * Source content: docs/wiki/01_FIRE_AND_BALLISTICS.md + ref/ARTILLERY_DOCTRINE.md
 * ========================================================================== */

/* palette (mirror of CSS :root) */
var C = {
  bg:'#0b0d0c', ink:'#9eb0a5', dim:'#5d6d64', amber:'#b0822c', orange:'#9e5420',
  red:'#9a3a33', teal:'#3e7a74', good:'#6f9e6a', hair:'rgba(120,140,130,.30)'
};

/* ---- tiny SVG builder helpers (return string fragments) ----------------- */
function svgOpen(w,h){ return '<svg viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'; }
function gridFloor(x0,y,x1){ // faint baseline / ground tick row
  var s='<line x1="'+x0+'" y1="'+y+'" x2="'+x1+'" y2="'+y+'" stroke="'+C.hair+'" stroke-width="1"/>';
  return s;
}
function txt(x,y,s,col,size,anchor,extra){
  return '<text x="'+x+'" y="'+y+'" fill="'+(col||C.dim)+'" font-size="'+(size||10)+'"'+
    (anchor?' text-anchor="'+anchor+'"':'')+(extra||'')+'>'+s+'</text>';
}
/* a small top-down/side crab glyph (side profile body + carapace + 6 legs) */
function crabSide(cx,baseY,scale,col){
  scale = scale||1;
  var w=46*scale, h=18*scale, bodyTop=baseY-h, carH=7*scale;
  var s='<g stroke="'+col+'" stroke-width="1.4" fill="none">';
  // hull body (rounded box)
  s+='<rect x="'+(cx-w/2)+'" y="'+bodyTop+'" width="'+w+'" height="'+h+'" rx="3"/>';
  // carapace (top deck, slightly domed)
  s+='<path d="M'+(cx-w/2+3*scale)+' '+bodyTop+' Q'+cx+' '+(bodyTop-carH)+' '+(cx+w/2-3*scale)+' '+bodyTop+'"/>';
  // legs
  for(var i=-2;i<=2;i++){
    var lx=cx+i*(w/5);
    s+='<line x1="'+lx+'" y1="'+baseY+'" x2="'+(lx-5*scale)+'" y2="'+(baseY+9*scale)+'"/>';
  }
  s+='</g>';
  return s;
}

/* arrowhead marker defs (reused) */
var DEFS = '<defs>'+
  '<marker id="ahA" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">'+
    '<path d="M0,0 L6,3 L0,6 Z" fill="'+C.amber+'"/></marker>'+
  '<marker id="ahT" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">'+
    '<path d="M0,0 L6,3 L0,6 Z" fill="'+C.teal+'"/></marker>'+
  '<marker id="ahR" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">'+
    '<path d="M0,0 L6,3 L0,6 Z" fill="'+C.red+'"/></marker>'+
  '<marker id="ahG" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">'+
    '<path d="M0,0 L6,3 L0,6 Z" fill="'+C.good+'"/></marker>'+
'</defs>';

/* a hill/ridge cross-section path between x0..x1, peak at px, peak height ph above baseY */
function hill(x0,baseY,px,ph,x1,fill,stroke){
  var d='M'+x0+' '+baseY+
    ' Q'+((x0+px)/2)+' '+baseY+' '+px+' '+(baseY-ph)+
    ' Q'+((px+x1)/2)+' '+baseY+' '+x1+' '+baseY+' Z';
  return '<path d="'+d+'" fill="'+(fill||'rgba(60,72,66,.30)')+'" stroke="'+(stroke||C.dim)+'" stroke-width="1.2"/>';
}

/* ===================================================================== */
/* CARD DIAGRAMS                                                          */
/* ===================================================================== */

/* 1. Direct vs Indirect ------------------------------------------------ */
function d1(){
  var W=440,H=300,base=250;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(20,base,420);
  // gun left
  s+=crabSide(60,base,1,C.teal);
  s+=txt(60,base+34,'YOUR GUN','#9eb0a5',10,'middle');
  // target right
  s+=crabSide(380,base,1,C.red);
  s+=txt(380,base+34,'TARGET','#9a3a33',10,'middle');
  // DIRECT: straight LOS shot
  s+='<line x1="84" y1="'+(base-14)+'" x2="356" y2="'+(base-14)+'" stroke="'+C.amber+'" stroke-width="2" marker-end="url(#ahA)"/>';
  s+=txt(220,base-22,'DIRECT — straight, you SEE it',C.amber,11,'middle');
  // INDIRECT: arced lob over (no LOS needed)
  s+='<path d="M84 '+(base-20)+' Q220 60 356 '+(base-26)+'" stroke="'+C.teal+'" stroke-width="2" fill="none" marker-end="url(#ahT)"/>';
  s+=txt(220,72,'INDIRECT — arced lob',C.teal,11,'middle');
  // spotter
  s+='<g stroke="'+C.good+'" stroke-width="1.4" fill="none"><circle cx="300" cy="120" r="9"/>'+
     '<line x1="300" y1="129" x2="300" y2="150"/></g>';
  s+=txt(300,110,'SPOTTER',C.good,9,'middle');
  s+='<line x1="300" y1="129" x2="372" y2="'+(base-24)+'" stroke="'+C.good+'" stroke-width="1" stroke-dasharray="3 3"/>';
  s+=txt(348,150,'sees target',C.good,8.5,'middle');
  s+='</svg>';
  return s;
}

/* 2. Trajectory: flat vs arced vs mortar ------------------------------- */
function d2(){
  var W=440,H=300,base=250;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(20,base,420);
  s+=crabSide(55,base,.9,C.dim);
  // gun (flat, far)
  s+='<path d="M78 '+(base-16)+' Q230 '+(base-44)+' 410 '+(base-6)+'" stroke="'+C.amber+'" stroke-width="2" fill="none" marker-end="url(#ahA)"/>';
  s+=txt(412,base-2,'',C.amber,9,'end');
  s+=txt(300,base-46,'GUN — flat &amp; FAR',C.amber,11,'middle');
  // howitzer (medium arc)
  s+='<path d="M78 '+(base-22)+' Q210 70 320 '+(base-6)+'" stroke="'+C.teal+'" stroke-width="2" fill="none" marker-end="url(#ahT)"/>';
  s+=txt(150,90,'HOWITZER — selectable arc',C.teal,11,'start');
  // mortar (near-vertical, short)
  s+='<path d="M78 '+(base-26)+' Q110 30 168 '+(base-6)+'" stroke="'+C.red+'" stroke-width="2" fill="none" marker-end="url(#ahR)"/>';
  s+=txt(120,46,'MORTAR',C.red,11,'middle');
  s+=txt(120,60,'steep &amp; near',C.red,9,'middle');
  s+=txt(220,base+30,'higher velocity  →  flatter &amp; farther',C.dim,9.5,'middle');
  s+='</svg>';
  return s;
}

/* 3. Line of sight & masking ------------------------------------------- */
function d3(){
  var W=440,H=300,base=250;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(20,base,420);
  // crest in the middle
  s+=hill(170,base,250,140,330,'rgba(60,72,66,.34)',C.dim);
  s+=txt(250,base-150,'CREST',C.dim,10,'middle');
  s+=crabSide(70,base,.9,C.teal);
  s+=txt(70,base+30,'GUN',C.teal,10,'middle');
  s+=crabSide(395,base,.9,C.red);
  s+=txt(395,base+30,'TARGET',C.red,9,'middle');
  // flat shot strikes the crest (masked)
  s+='<line x1="92" y1="'+(base-14)+'" x2="232" y2="'+(base-118)+'" stroke="'+C.amber+'" stroke-width="2" marker-end="url(#ahA)"/>';
  // impact burst on crest
  s+='<g stroke="'+C.red+'" stroke-width="1.6">'+
     '<line x1="232" y1="'+(base-118)+'" x2="222" y2="'+(base-132)+'"/>'+
     '<line x1="232" y1="'+(base-118)+'" x2="244" y2="'+(base-130)+'"/>'+
     '<line x1="232" y1="'+(base-118)+'" x2="218" y2="'+(base-110)+'"/></g>';
  s+=txt(150,base-86,'MASKED —',C.red,11,'middle');
  s+=txt(150,base-72,'crest blocks it',C.red,10,'middle');
  // blocked LOS dotted to target
  s+='<line x1="92" y1="'+(base-16)+'" x2="378" y2="'+(base-16)+'" stroke="'+C.dim+'" stroke-width="1" stroke-dasharray="4 4"/>';
  s+=txt(360,base-22,'no LOS',C.dim,9,'end');
  s+='</svg>';
  return s;
}

/* 4. DEAD SPACE — the key card (ATP 3-21.90 Fig 5-1 concept) ----------- */
function d4(){
  var W=460,H=330,base=275;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,444);
  // the hill (peak around x=225)
  s+=hill(145,base,225,150,345,'rgba(60,72,66,.34)',C.dim);
  s+=txt(225,base-158,'HILL / CREST',C.dim,10,'middle');
  // DEAD SPACE pocket on the back (right) slope — shaded red region
  s+='<path d="M225 '+(base-150)+' Q288 '+base+' 345 '+base+' L300 '+base+' Q278 '+(base-58)+' 225 '+(base-150)+' Z" '+
     'fill="rgba(154,58,51,.22)" stroke="'+C.red+'" stroke-width="1" stroke-dasharray="3 3"/>';
  s+=txt(302,base-78,'DEAD',C.red,11,'middle');
  s+=txt(302,base-64,'SPACE',C.red,11,'middle');
  // FLAT GUN — gun glyph + flat arc that sails OVER the back slope
  s+=crabSide(58,base,.85,C.amber);
  s+=txt(58,base+30,'FLAT GUN',C.amber,9.5,'middle');
  s+='<path d="M78 '+(base-14)+' Q225 '+(base-188)+' 430 '+(base-6)+'" stroke="'+C.amber+'" stroke-width="2" fill="none" marker-end="url(#ahA)"/>';
  s+=txt(410,base-22,'lands FAR',C.amber,9,'end');
  s+=txt(120,42,'flat shell flies over the pocket',C.amber,9.5,'start');
  // MORTAR — steep arc plunging INTO the dead space
  s+='<path d="M82 '+(base-18)+' Q165 46 300 '+(base-6)+'" stroke="'+C.red+'" stroke-width="2" fill="none" marker-end="url(#ahR)"/>';
  s+=txt(150,76,'MORTAR plunges IN',C.red,10,'start');
  // target hiding in dead space
  s+=crabSide(300,base,.62,C.good);
  s+=txt(300,base+22,'hidden',C.good,8.5,'middle');
  s+='</svg>';
  return s;
}

/* 4b. Why mortars reach defilade (contrast: arc vs dead space) --------- */
function d4b(){
  var W=440,H=300,base=255;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  s+=hill(150,base,230,140,320,'rgba(60,72,66,.34)',C.dim);
  // pocket
  s+='<path d="M230 '+(base-140)+' Q278 '+base+' 320 '+base+' L284 '+base+' Q268 '+(base-54)+' 230 '+(base-140)+' Z" '+
     'fill="rgba(154,58,51,.16)" stroke="'+C.red+'" stroke-width="1" stroke-dasharray="3 3"/>';
  s+=txt(296,base-24,'defilade',C.red,9,'middle');
  // flat — overshoots (greyed)
  s+='<path d="M40 '+(base-14)+' Q230 '+(base-190)+' 412 '+(base-6)+'" stroke="'+C.dim+'" stroke-width="1.6" fill="none" stroke-dasharray="5 4"/>';
  s+=txt(360,base-60,'flat → overshoots',C.dim,9,'middle');
  // howitzer — smaller dead space, edge of pocket (amber)
  s+='<path d="M44 '+(base-18)+' Q170 60 296 '+(base-8)+'" stroke="'+C.amber+'" stroke-width="1.8" fill="none" marker-end="url(#ahA)"/>';
  s+=txt(120,76,'howitzer → smaller shadow',C.amber,9,'start');
  // mortar — near vertical INTO pocket (red, solid)
  s+='<path d="M70 '+(base-22)+' Q150 24 286 '+(base-10)+'" stroke="'+C.red+'" stroke-width="2.2" fill="none" marker-end="url(#ahR)"/>';
  s+=txt(150,40,'MORTAR drops STRAIGHT in',C.red,10,'middle');
  s+=crabSide(286,base,.7,C.good);
  s+='</svg>';
  return s;
}

/* 5. Defilade / hull-down / reverse slope ------------------------------ */
function d5(){
  var W=440,H=300,base=255;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  // ridge
  s+=hill(120,base,250,150,400,'rgba(60,72,66,.34)',C.dim);
  s+=txt(250,base-158,'RIDGE',C.dim,10,'middle');
  // enemy on left firing flat
  s+=crabSide(60,base,.8,C.red);
  s+=txt(60,base+30,'ENEMY',C.red,9,'middle');
  // crab hull-down just behind crest — only carapace exposed
  // place near crest on right slope, top peeking over
  var hx=296, hy=base-92;
  // body hidden behind slope (clip impression): draw body partly, carapace above terrain line
  s+='<g stroke="'+C.good+'" stroke-width="1.5" fill="none">'+
     '<rect x="'+(hx-20)+'" y="'+(hy)+'" width="40" height="16" rx="3"/>'+
     '<path d="M'+(hx-17)+' '+hy+' Q'+hx+' '+(hy-7)+' '+(hx+17)+' '+hy+'"/></g>';
  // mask the lower body with terrain-colour overlay to suggest hull-down
  s+='<path d="M'+(hx-26)+' '+(hy+9)+' L'+(hx+26)+' '+(hy+9)+' L'+(hx+40)+' '+base+' L'+(hx-40)+' '+base+' Z" '+
     'fill="rgba(60,72,66,.55)" stroke="none"/>';
  s+=txt(hx,hy-14,'HULL-DOWN',C.good,10,'middle');
  s+=txt(hx,base-20,'body hidden',C.good,8.5,'middle');
  // enemy flat shot stopped by crest
  s+='<line x1="82" y1="'+(base-12)+'" x2="206" y2="'+(base-122)+'" stroke="'+C.red+'" stroke-width="1.8" marker-end="url(#ahR)"/>';
  s+=txt(150,base-78,'flat fire blocked',C.red,9,'middle');
  s+=txt(360,base+24,'only the carapace (top) peeks over',C.good,9,'end');
  s+='</svg>';
  return s;
}

/* 6. Angle of fall = where it hits ------------------------------------- */
function d6(){
  var W=440,H=320,base=250;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  // big crab in the middle, side profile, labelled faces
  var cx=230;
  s+=crabSide(cx,base,1.7,C.ink);
  // label thick front/side
  s+='<line x1="'+(cx-40)+'" y1="'+(base-15)+'" x2="'+(cx-78)+'" y2="'+(base-15)+'" stroke="'+C.amber+'" stroke-width="1"/>';
  s+=txt(cx-82,base-12,'THICK',C.amber,10,'end');
  s+=txt(cx-82,base+1,'side/glacis',C.amber,8.5,'end');
  // label thin top
  s+='<line x1="'+(cx)+'" y1="'+(base-40)+'" x2="'+(cx+70)+'" y2="'+(base-70)+'" stroke="'+C.teal+'" stroke-width="1"/>';
  s+=txt(cx+74,base-72,'THIN top/carapace',C.teal,9,'start');
  // FLAT shell → strikes the side/glacis (shallow)
  s+='<line x1="40" y1="'+(base-22)+'" x2="'+(cx-44)+'" y2="'+(base-15)+'" stroke="'+C.amber+'" stroke-width="2" marker-end="url(#ahA)"/>';
  s+=txt(80,base-30,'FLAT → hits SIDE',C.amber,10,'middle');
  // PLUNGING shell → strikes the top (steep)
  s+='<path d="M360 40 Q330 90 '+(cx+28)+' '+(base-46)+'" stroke="'+C.red+'" stroke-width="2" fill="none" marker-end="url(#ahR)"/>';
  s+=txt(372,44,'PLUNGING',C.red,10,'end');
  s+=txt(372,58,'→ hits TOP',C.red,10,'end');
  s+=txt(230,base+34,'angle of fall decides the face',C.dim,9.5,'middle');
  s+='</svg>';
  return s;
}

/* 7. Range affects everything ------------------------------------------ */
function d7(){
  var W=440,H=300,base=235;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  s+=crabSide(46,base,.8,C.dim);
  // minimum range zone (too close)
  s+='<rect x="64" y="'+(base-8)+'" width="44" height="8" fill="rgba(154,58,51,.25)"/>';
  s+=txt(86,base+22,'MIN',C.red,8.5,'middle');
  s+=txt(86,base+33,'range',C.red,8,'middle');
  // short trajectory (flatter, tight)
  s+='<path d="M70 '+(base-12)+' Q150 '+(base-60)+' 210 '+(base-4)+'" stroke="'+C.teal+'" stroke-width="2" fill="none" marker-end="url(#ahT)"/>';
  s+=txt(150,base-66,'short — flatter, tight',C.teal,9,'middle');
  // long trajectory (steeper drop)
  s+='<path d="M70 '+(base-16)+' Q250 50 390 '+(base-4)+'" stroke="'+C.amber+'" stroke-width="2" fill="none" marker-end="url(#ahA)"/>';
  s+=txt(280,70,'long — steeper drop, looser',C.amber,9,'middle');
  // beaten zone ellipses
  s+='<ellipse cx="208" cy="'+(base-2)+'" rx="16" ry="5" fill="none" stroke="'+C.teal+'" stroke-width="1.2"/>';
  s+='<ellipse cx="386" cy="'+(base-2)+'" rx="34" ry="7" fill="none" stroke="'+C.amber+'" stroke-width="1.2" stroke-dasharray="3 2"/>';
  s+=txt(386,base+22,'bigger scatter',C.amber,8.5,'middle');
  s+='</svg>';
  return s;
}

/* 8. Immunity zone — range axis with green immune band ----------------- */
function d8(){
  var W=440,H=300;
  var s=svgOpen(W,H)+DEFS;
  var ax=40,ay=170,aw=360; // axis
  // axis line
  s+='<line x1="'+ax+'" y1="'+ay+'" x2="'+(ax+aw)+'" y2="'+ay+'" stroke="'+C.dim+'" stroke-width="1.4" marker-end="url(#ahG)"/>';
  s+=txt(ax+aw,ay+18,'RANGE →',C.dim,10,'end');
  s+=txt(ax,ay+18,'close',C.dim,9,'start');
  // segments
  var inner=ax+110, outer=ax+250;
  // close band — side defeated (red)
  s+='<rect x="'+ax+'" y="'+(ay-22)+'" width="'+(inner-ax)+'" height="22" fill="rgba(154,58,51,.20)"/>';
  s+=txt((ax+inner)/2,ay-28,'SIDE pierced',C.red,9.5,'middle');
  // immune band — green
  s+='<rect x="'+inner+'" y="'+(ay-30)+'" width="'+(outer-inner)+'" height="30" fill="rgba(111,158,106,.28)" stroke="'+C.good+'" stroke-width="1.2"/>';
  s+=txt((inner+outer)/2,ay-38,'IMMUNE BAND',C.good,11,'middle');
  s+=txt((inner+outer)/2,ay-13,'neither face pierced',C.good,8.5,'middle');
  // far band — top defeated (red)
  s+='<rect x="'+outer+'" y="'+(ay-22)+'" width="'+(ax+aw-outer-10)+'" height="22" fill="rgba(154,58,51,.20)"/>';
  s+=txt((outer+ax+aw-10)/2,ay-28,'TOP pierced',C.red,9.5,'middle');
  // edge markers
  s+='<line x1="'+inner+'" y1="'+(ay-34)+'" x2="'+inner+'" y2="'+(ay+8)+'" stroke="'+C.good+'" stroke-width="1.2" stroke-dasharray="3 3"/>';
  s+=txt(inner,ay+24,'inner edge',C.good,8.5,'middle');
  s+=txt(inner,ay+36,'(side safe)',C.dim,8,'middle');
  s+='<line x1="'+outer+'" y1="'+(ay-34)+'" x2="'+outer+'" y2="'+(ay+8)+'" stroke="'+C.good+'" stroke-width="1.2" stroke-dasharray="3 3"/>';
  s+=txt(outer,ay+24,'outer edge',C.good,8.5,'middle');
  s+=txt(outer,ay+36,'(top safe)',C.dim,8,'middle');
  // legend crab
  s+=crabSide(W/2,90,.8,C.ink);
  s+=txt(W/2,52,'YOUR CRAB vs one enemy gun',C.ink,10,'middle');
  s+='</svg>';
  return s;
}

/* 9. Spotting & adjusting fire ----------------------------------------- */
function d9(){
  var W=440,H=300,base=245;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  // observer/drone left-high
  s+='<g stroke="'+C.good+'" stroke-width="1.5" fill="none">'+
     '<circle cx="70" cy="70" r="11"/>'+
     '<line x1="59" y1="64" x2="48" y2="58"/><line x1="81" y1="64" x2="92" y2="58"/></g>';
  s+=txt(70,46,'RECON DRONE / FO',C.good,9.5,'middle');
  // target
  s+=crabSide(360,base,.9,C.red);
  s+=txt(360,base+30,'TARGET',C.red,9,'middle');
  // shots walking onto target: short, over, on
  s+='<g stroke="'+C.dim+'" stroke-width="1.4">'+
     '<line x1="290" y1="'+(base-4)+'" x2="282" y2="'+(base+4)+'"/><line x1="290" y1="'+(base-4)+'" x2="298" y2="'+(base+4)+'"/></g>';
  s+=txt(290,base+22,'1 short',C.dim,8.5,'middle');
  s+='<g stroke="'+C.amber+'" stroke-width="1.4">'+
     '<line x1="416" y1="'+(base-4)+'" x2="408" y2="'+(base+4)+'"/><line x1="416" y1="'+(base-4)+'" x2="424" y2="'+(base+4)+'"/></g>';
  s+=txt(416,base+22,'2 over',C.amber,8.5,'middle');
  s+='<g stroke="'+C.red+'" stroke-width="2">'+
     '<line x1="356" y1="'+(base-22)+'" x2="346" y2="'+(base-34)+'"/><line x1="356" y1="'+(base-22)+'" x2="368" y2="'+(base-32)+'"/>'+
     '<line x1="356" y1="'+(base-22)+'" x2="344" y2="'+(base-14)+'"/><line x1="356" y1="'+(base-22)+'" x2="370" y2="'+(base-12)+'"/></g>';
  s+=txt(356,base-44,'3 ON → FIRE FOR EFFECT',C.red,9.5,'middle');
  // drone sight lines
  s+='<line x1="78" y1="78" x2="356" y2="'+(base-20)+'" stroke="'+C.good+'" stroke-width="1" stroke-dasharray="3 3"/>';
  s+=txt(140,base-86,'observer corrects: "add 100, on target"',C.good,9,'start');
  s+='</svg>';
  return s;
}

/* 10. Beaten zone / dispersion ----------------------------------------- */
function d10(){
  var W=440,H=300,base=240;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  s+=crabSide(50,base,.8,C.teal);
  // gun-target line
  s+='<line x1="74" y1="'+(base-10)+'" x2="380" y2="'+(base-10)+'" stroke="'+C.dim+'" stroke-width="1" stroke-dasharray="5 4"/>';
  s+=txt(220,base-18,'gun – target line',C.dim,9,'middle');
  // wide ellipse (unregistered) along the line
  s+='<ellipse cx="320" cy="'+(base-10)+'" rx="80" ry="22" fill="rgba(176,130,44,.10)" stroke="'+C.amber+'" stroke-width="1.4"/>';
  s+=txt(320,base-40,'BEATEN ZONE — long &amp; narrow',C.amber,9.5,'middle');
  // scatter dots
  var pts=[[280,-6],[300,-16],[330,-4],[350,-14],[315,-8],[295,-2],[345,-2],[365,-10]];
  for(var i=0;i<pts.length;i++){
    s+='<circle cx="'+(pts[i][0])+'" cy="'+(base+pts[i][1])+'" r="2.2" fill="'+C.amber+'"/>';
  }
  // tight ellipse after registration
  s+='<ellipse cx="320" cy="'+(base-10)+'" rx="32" ry="11" fill="none" stroke="'+C.good+'" stroke-width="1.4"/>';
  s+=txt(320,base+30,'registered/observed → tightens',C.good,9,'middle');
  s+=txt(220,base+50,'range error &gt;&gt; deflection error',C.dim,9,'middle');
  s+='</svg>';
  return s;
}

/* 11. Counter-battery & shoot-and-move --------------------------------- */
function d11(){
  var W=440,H=300,base=250;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  // your gun firing
  s+=crabSide(70,base,.9,C.teal);
  s+=txt(70,base+30,'YOUR GUN',C.teal,9,'start');
  // outgoing arc
  s+='<path d="M92 '+(base-16)+' Q230 60 380 '+(base-8)+'" stroke="'+C.teal+'" stroke-width="1.8" fill="none" marker-end="url(#ahT)"/>';
  // enemy counter-battery radar traces it BACK
  s+='<path d="M380 '+(base-12)+' Q250 70 100 '+(base-18)+'" stroke="'+C.red+'" stroke-width="1.4" fill="none" stroke-dasharray="5 4" marker-end="url(#ahR)"/>';
  s+=txt(240,52,'enemy traces the shell back to YOU',C.red,9.5,'middle');
  // enemy gun right
  s+=crabSide(380,base,.9,C.red);
  s+=txt(380,base+30,'ENEMY CB',C.red,9,'middle');
  // move arrow
  s+='<line x1="120" y1="'+(base+18)+'" x2="200" y2="'+(base+18)+'" stroke="'+C.good+'" stroke-width="2" marker-end="url(#ahG)"/>';
  s+=txt(230,base+34,'SHOOT &amp; MOVE — don\'t sit still',C.good,9.5,'middle');
  s+='</svg>';
  return s;
}

/* 12. CITY BATTLE specifics -------------------------------------------- */
function d12(){
  var W=440,H=320,base=250;
  var s=svgOpen(W,H)+DEFS;
  s+=gridFloor(16,base,424);
  // water band
  s+='<rect x="150" y="'+(base-2)+'" width="90" height="22" fill="rgba(62,122,116,.18)" stroke="'+C.teal+'" stroke-width="1"/>';
  s+=txt(195,base+34,'WATER (crabs swim across)',C.teal,9,'middle');
  // amphibious crab crossing
  s+=crabSide(195,base,.7,C.teal);
  // cliff (impassable) right
  s+='<path d="M330 '+base+' L330 '+(base-120)+' L390 '+(base-120)+' L390 '+base+' Z" fill="rgba(94,84,32,.25)" stroke="'+C.orange+'" stroke-width="1.4"/>';
  s+=txt(360,base-130,'CLIFF',C.orange,9.5,'middle');
  s+=txt(360,base-118,'impassable',C.orange,8,'middle');
  // route-around arrow
  s+='<path d="M255 '+(base-6)+' Q300 '+(base-40)+' 318 '+(base-90)+'" stroke="'+C.amber+'" stroke-width="1.6" fill="none" stroke-dasharray="4 3" marker-end="url(#ahA)"/>';
  s+=txt(300,base-58,'route around',C.amber,8.5,'start');
  // rain / fog of war
  s+='<g stroke="'+C.dim+'" stroke-width="1">';
  for(var i=0;i<8;i++){ var rx=40+i*10; s+='<line x1="'+rx+'" y1="36" x2="'+(rx-6)+'" y2="60"/>'; }
  s+='</g>';
  s+=txt(70,28,'PRECIP slows move',C.dim,8.5,'middle');
  // fog of war veil
  s+='<rect x="20" y="70" width="110" height="120" fill="rgba(20,26,23,.55)" stroke="'+C.dim+'" stroke-width="1" stroke-dasharray="4 4"/>';
  s+=txt(75,134,'FOG OF WAR',C.dim,9,'middle');
  s+=txt(75,148,'see only in LOS',C.dim,8,'middle');
  s+=txt(75,160,'/ sensor range',C.dim,8,'middle');
  // crew rescue marker
  s+='<g stroke="'+C.red+'" stroke-width="1.5" fill="none"><circle cx="120" cy="'+(base-10)+'" r="7"/></g>';
  s+=txt(120,base-24,'rescue downed crew',C.red,8,'middle');
  s+='</svg>';
  return s;
}

/* ===================================================================== */
/* CARD DATA                                                             */
/* ===================================================================== */
var CARDS = [
{ n:1, key:false, title:'Direct vs Indirect Fire', tag:'fundamentals',
  svg:d1,
  html:
   '<div class="lead">If you can <b>see</b> the target, shoot straight (<b>direct</b>). If you can\'t, '+
   'lob shells over the terrain with a <b>spotter</b> calling corrections (<b>indirect</b>).</div>'+
   '<ul>'+
   '<li><b>Direct</b> needs line of sight; it\'s the most accurate &mdash; but you\'re exposed too.</li>'+
   '<li><b>Indirect</b> needs the target <b>spotted</b> (ally or recon drone) but reaches over hills.</li>'+
   '<li>The bulk of artillery is indirect: hit what you can\'t personally see.</li>'+
   '</ul>'+
   '<div class="note game"><b>City Battle:</b> DIRECT (flat, needs LOS, hits side/glacis) vs '+
   'OBLIQUE/INDIRECT (arced, needs a spotter, hits side at mid / top at long).</div>'
},
{ n:2, key:false, title:'Trajectory: Flat / Arced / Mortar', tag:'fundamentals',
  svg:d2,
  html:
   '<div class="lead">The <b>same range</b> can be reached low &amp; fast or high &amp; slow. '+
   'Guns shoot <b>flat &amp; far</b>, howitzers <b>arc</b>, mortars go <b>near-vertical</b>.</div>'+
   '<ul>'+
   '<li><b>Gun</b> &mdash; high muzzle velocity, flat &amp; far. Good for direct fire.</li>'+
   '<li><b>Howitzer</b> &mdash; selectable elevation, flexible arc.</li>'+
   '<li><b>Mortar</b> &mdash; steep &amp; short, the high-angle specialist.</li>'+
   '</ul>'+
   '<div class="note"><b>Why it matters:</b> the trajectory you pick decides what terrain you clear '+
   'and which armour face the shell ends up striking.</div>'
},
{ n:3, key:false, title:'Line of Sight &amp; Masking', tag:'terrain',
  svg:d3,
  html:
   '<div class="lead">Hills, ridges and buildings <b>block flat shots</b>. A trajectory that would '+
   'strike intervening terrain first is <b>masked</b>.</div>'+
   '<ul>'+
   '<li><b>Line of sight (LOS):</b> a clear straight line from your sensor to the target.</li>'+
   '<li><b>Masking:</b> a crest in the way that the flat shot hits before reaching the target.</li>'+
   '<li><b>Crest clearance:</b> the elevation needed to clear it &mdash; a flat gun may not be able to at all.</li>'+
   '</ul>'+
   '<div class="note"><b>Consequence:</b> if you can\'t clear the crest, you must lob higher (or move).</div>'
},
{ n:4, key:true, title:'DEAD SPACE', tag:'the key idea',
  svg:d4,
  html:
   '<div class="lead">The <b>pocket of ground behind a hill that a flat gun cannot hit</b> &mdash; '+
   'the shell flies right over it and lands far beyond.</div>'+
   '<ul>'+
   '<li><span class="hot">Flat gun</span> &rarr; <b>large</b> dead space.</li>'+
   '<li>Howitzer (higher arc) &rarr; <b>smaller</b> dead space.</li>'+
   '<li><span class="grn">Mortar</span> (near-vertical) &rarr; <b>almost none</b> &mdash; it drops straight in.</li>'+
   '<li>A target in deep defilade can be hit <b>only</b> by high-angle fire &mdash; and only if spotted &amp; in range.</li>'+
   '</ul>'+
   '<div class="note game"><b>City Battle:</b> dead space is a core mechanic. Direct fire shows a wide '+
   'flat shadow behind crests; if the indirect arc can\'t drop steeply enough, the target is untouchable. '+
   '(Ref: ATP&nbsp;3-21.90 Fig&nbsp;5-1.)</div>'
},
{ n:'4b', key:true, title:'Why Mortars Reach Defilade', tag:'the key idea',
  svg:d4b,
  html:
   '<div class="lead">The <b>steeper the arc, the smaller the dead space</b>. A near-vertical mortar '+
   'round plunges straight into the pocket nothing flat can touch.</div>'+
   '<ul>'+
   '<li>Flat shell &rarr; <span class="hot">overshoots</span> the back slope entirely.</li>'+
   '<li>Howitzer &rarr; smaller shadow, reaches the lip.</li>'+
   '<li>Mortar &rarr; <span class="grn">drops in</span> at near-90&deg;.</li>'+
   '</ul>'+
   '<div class="note"><b>Takeaway:</b> to dig an enemy out of a reverse slope you need a high-angle '+
   'weapon, a spotter, and enough range. Bring the right tool.</div>'
},
{ n:5, key:false, title:'Defilade / Hull-down / Reverse Slope', tag:'positioning',
  svg:d5,
  html:
   '<div class="lead">Hide behind a ridge so only your <b>top is exposed</b> &mdash; or sit on the '+
   'far side entirely, safe from flat fire.</div>'+
   '<ul>'+
   '<li><b>Hull-down:</b> only the turret/<b>carapace</b> peeks over; flanks &amp; glacis hidden.</li>'+
   '<li><b>Turret-down:</b> fully hidden; move up to fire.</li>'+
   '<li><b>Reverse slope:</b> far side of a ridge &mdash; enemy must high-angle you or crest the ridge.</li>'+
   '</ul>'+
   '<div class="note game"><b>City Battle:</b> hull-down exposes only the carapace (top), so plunging '+
   'fire is the only threat. Defilade is also how artillery survives counter-battery.</div>'
},
{ n:6, key:true, title:'Angle of Fall = Where It Hits', tag:'the key idea',
  svg:d6,
  html:
   '<div class="lead">Flat shots hit the <b>SIDE / front</b> (thick belt). Steep, plunging shots hit '+
   'the <b>TOP / deck</b> (thin carapace). This one rule ties trajectory, range &amp; armour together.</div>'+
   '<ul>'+
   '<li>Shallow angle of fall &rarr; strikes the <b>vertical face</b> (side/glacis) &mdash; vs <i>verpen</i>.</li>'+
   '<li>Steep angle of fall &rarr; strikes the <b>horizontal face</b> (top/deck) &mdash; vs <i>horpen</i>.</li>'+
   '<li>Angle of fall <b>increases with range</b> and is far steeper for high-angle fire.</li>'+
   '</ul>'+
   '<div class="note game"><b>City Battle:</b> the unifying ballistic rule &mdash; identical to the naval '+
   'belt-vs-deck logic. Short-range flat fire threatens the side; long or lobbed fire threatens the top.</div>'
},
{ n:7, key:false, title:'Range Affects Everything', tag:'gunnery',
  svg:d7,
  html:
   '<div class="lead">Longer range means a <b>steeper drop</b>, <b>less accuracy</b> and a '+
   '<b>bigger scatter</b> &mdash; and there\'s a <b>minimum range</b> too.</div>'+
   '<ul>'+
   '<li>Far targets: steeper angle of fall &rarr; the threat shifts toward the <b>top</b>.</li>'+
   '<li>Far targets: the beaten zone (scatter) grows.</li>'+
   '<li>Too close: below minimum range a lobbing weapon simply can\'t reach.</li>'+
   '</ul>'+
   '<div class="note"><b>Trade-off:</b> closing the range improves accuracy &amp; side-threat &mdash; '+
   'but exposes you. Choose your range deliberately.</div>'
},
{ n:8, key:true, title:'IMMUNITY ZONE', tag:'the key idea',
  svg:d8,
  html:
   '<div class="lead">The <b>range band where neither your side nor your top armour can be pierced</b> '+
   'by a given enemy gun. Fight inside yours, outside theirs.</div>'+
   '<ul>'+
   '<li><b>Inner edge</b> = closer than this, the enemy\'s side (vertical) penetration beats your side.</li>'+
   '<li><b>Outer edge</b> = farther than this, the enemy\'s plunging penetration beats your top.</li>'+
   '<li>Between the edges = <span class="grn">immune</span>. A mismatched scheme can have <b>no</b> immune band.</li>'+
   '</ul>'+
   '<div class="note game"><b>City Battle:</b> the foundry &amp; tactical view <b>display the immunity '+
   'zone</b> for your crabs vs a chosen enemy shell &mdash; position to live in your immune band.</div>'
},
{ n:9, key:false, title:'Spotting &amp; Adjusting Fire', tag:'fire control',
  svg:d9,
  html:
   '<div class="lead">A forward observer or recon drone watches the rounds land and <b>corrects</b> '+
   'until on target &mdash; then calls <b>"fire for effect."</b></div>'+
   '<ul>'+
   '<li><b>Adjust fire:</b> ranging rounds while the spotter corrects ("add 100, right 50").</li>'+
   '<li><b>Fire for effect (FFE):</b> adjustment is good &mdash; fire the full volume now.</li>'+
   '<li><b>Last-known position:</b> lost contact? Fire predicted at where it was &mdash; may miss, denies ground.</li>'+
   '</ul>'+
   '<div class="note game"><b>City Battle:</b> observed (spotter/drone) fire is tightest; predicted/'+
   'registered is mid; last-known-position fire is supported when contact is lost.</div>'
},
{ n:10, key:false, title:'Beaten Zone / Dispersion', tag:'gunnery',
  svg:d10,
  html:
   '<div class="lead">Even a perfectly laid gun scatters its rounds into an <b>ellipse along the '+
   'firing line</b>. Observed/registered fire tightens it.</div>'+
   '<ul>'+
   '<li><b>Range error &gt;&gt; deflection error</b> &mdash; the footprint is long &amp; narrow.</li>'+
   '<li>It <b>grows with range</b> and is wider for high-angle fire.</li>'+
   '<li>A target sitting still gets <b>bracketed</b>; a moving target walks out of it.</li>'+
   '</ul>'+
   '<div class="note"><b>Tip:</b> registration on a known point first, then transfer &mdash; a registered '+
   'shoot is far tighter than a cold predicted one.</div>'
},
{ n:11, key:false, title:'Counter-battery &amp; Shoot-and-Move', tag:'survival',
  svg:d11,
  html:
   '<div class="lead">The enemy can <b>trace your shells back</b> to your position (muzzle flash / '+
   'trajectory). <b>Don\'t sit still.</b></div>'+
   '<ul>'+
   '<li><b>Counter-battery:</b> fire aimed at silencing the enemy\'s guns once located.</li>'+
   '<li><b>Shoot &amp; move:</b> displace after firing so the return rounds hit empty ground.</li>'+
   '<li>Sitting in defilade also helps your guns survive counter-battery.</li>'+
   '</ul>'+
   '<div class="note"><b>Tempo:</b> a battery that fires and relocates outlives one that digs in and '+
   'keeps shooting from the same grid.</div>'
},
{ n:12, key:true, title:'CITY BATTLE Specifics', tag:'this game',
  svg:d12,
  html:
   '<div class="lead">How the doctrine maps onto the crabs, the map and the weather of CITY BATTLE.</div>'+
   '<ul>'+
   '<li><b>Amphibious crabs</b> cross any water &mdash; the shoreline is not a wall.</li>'+
   '<li><b>Cliffs are impassable</b> &mdash; you must route around them.</li>'+
   '<li><b>Precipitation slows movement;</b> weather/night <b>cut spotting</b> &amp; push fights to short range.</li>'+
   '<li><b>Fog of war:</b> you only see what\'s in LOS / sensor range.</li>'+
   '<li><b>Downed crew must be rescued</b> when knocked out.</li>'+
   '</ul>'+
   '<div class="note game"><b>Putting it together:</b> read the terrain, choose a trajectory that reaches '+
   '(beware dead space), position inside your immunity band, spot before you fire for effect, then move.</div>'
}
];

/* ===================================================================== */
/* RENDER + PAGER                                                        */
/* ===================================================================== */
var deck = document.getElementById('deck');
var dots = document.getElementById('dots');
var idx = 0;

function buildCard(c,i){
  var el = document.createElement('div');
  el.className = 'card'+(c.key?' keycard':'')+(i===0?' on':'');
  el.id = 'card'+i;
  el.innerHTML =
    '<div class="chead">'+
      '<div class="num">'+c.n+'</div>'+
      '<div class="ttl"><div class="k">'+c.title+'</div><div class="tag">'+c.tag+'</div></div>'+
    '</div>'+
    '<div class="cbody">'+
      '<div class="txt">'+c.html+'</div>'+
      '<div class="diag">'+c.svg()+'</div>'+
    '</div>';
  return el;
}

CARDS.forEach(function(c,i){
  deck.appendChild(buildCard(c,i));
  var d=document.createElement('div');
  d.className='d'+(c.key?' key':'')+(i===0?' on':'');
  d.textContent=c.n;
  d.title=c.title.replace(/<[^>]+>/g,'');
  d.addEventListener('click',function(){ go(i); });
  dots.appendChild(d);
});
// insert a divider in dots after the "key idea" run? keep simple — leave flat.

var cards = deck.querySelectorAll('.card');
var dotEls = dots.querySelectorAll('.d');
var prevBtn = document.getElementById('prevBtn');
var nextBtn = document.getElementById('nextBtn');
var pgnum = document.getElementById('pgnum');

function go(i){
  i = Math.max(0, Math.min(CARDS.length-1, i));
  idx = i;
  cards.forEach(function(c,j){ c.classList.toggle('on', j===i); });
  dotEls.forEach(function(d,j){ d.classList.toggle('on', j===i); });
  prevBtn.disabled = (i===0);
  nextBtn.disabled = (i===CARDS.length-1);
  nextBtn.textContent = (i===CARDS.length-1) ? 'DONE' : 'NEXT \u2192';
  pgnum.innerHTML = '<b>'+(i+1)+'</b> / '+CARDS.length;
  window.scrollTo({top:0,behavior:'smooth'});
}

prevBtn.addEventListener('click',function(){ go(idx-1); });
nextBtn.addEventListener('click',function(){ go(idx+1); });
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowLeft') go(idx-1);
  else if(e.key==='ArrowRight') go(idx+1);
});

// allow deep-link: #card=4 (1-based)
function fromHash(){
  var m = /card=(\d+)/.exec(location.hash);
  return m ? (parseInt(m[1],10)-1) : 0;
}
go(fromHash());
window.addEventListener('hashchange', function(){ go(fromHash()); });
