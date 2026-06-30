/* ============================================================================
   CITY BATTLE // HIGH COMMAND  -- strategic / campaign console
   RtW3-faithful model: prestige (stay in power) + victory points (win wars)
   + tension (0-13, road to war) + monthly budget + production + events/missions.
   Vanilla JS, localStorage persisted. Data: nations.csv / chassis.csv.
   ============================================================================ */

const SAVE_KEY = "citybattle_command_v1";
const CSV_DIR  = "../../../Assets/Resources/CSV/";
const CITIES   = ["Verdance","Cinderhal","Tallow Reach","Greyspan","Karst Hollow",
                  "Saltmarsh","Ironmoor","Pale Junction","Drossgate","Ashfen"];

let NATIONS = [];      // parsed nations.csv
let CHASSIS = [];      // parsed chassis.csv
let S = null;          // campaign state

/* ----------------------------- CSV parsing ------------------------------- */
function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const head  = lines[0].split(",");
  return lines.slice(1).filter(l=>l.trim()).map(line=>{
    const cells = line.split(",");
    const o = {};
    head.forEach((h,i)=> o[h.trim()] = (cells[i]||"").trim());
    return o;
  });
}

async function loadData(){
  const [nt, ct] = await Promise.all([
    fetch(CSV_DIR+"nations.csv").then(r=>r.text()),
    fetch(CSV_DIR+"chassis.csv").then(r=>r.text())
  ]);
  NATIONS = parseCSV(nt).map(n=>({
    id:+n.id, name:n.name,
    accuracy:+n.accuracy, damage_control:+n.damage_control,
    armor_quality:+n.armor_quality, fire_control:+n.fire_control,
    drone_doctrine:+n.drone_doctrine, ew_strength:+n.ew_strength,
    fabrication_efficiency:+n.fabrication_efficiency, research_speed:+n.research_speed,
    starting_year:+n.starting_year, traits:n.traits.split(";")
  }));
  CHASSIS = parseCSV(ct).map(c=>({
    id:+c.id, name:c.name, cls:c.class, mass:+c.mass_budget_t,
    cost:+c.cost, maintenance:+c.maintenance, year:+c.year_available,
    crew:+c.crew, speed:+c.base_speed_kmh, mounts:+c.num_weapon_mounts
  }));
}

/* --------------------------- event definitions --------------------------- */
/* Each choice trades budget(treasury $) / prestige / tension(named rival or "rand"). */
const EVENTS = [
  { id:"newline", title:"Demand from the Head of State",
    desc:"The head of state demands a prestigious new battle-crab line be laid down at once, regardless of cost.",
    choices:[
      {t:"Comply &mdash; lay down the flagship line", budget:-1800, prestige:+6, tension:0},
      {t:"Stall with a study commission", budget:0, prestige:-1, tension:0},
      {t:"Refuse &mdash; the treasury can't bear it", budget:+600, prestige:-7, tension:0}
    ]},
  { id:"incident", title:"Border Incident",
    desc:"A patrol crab strays into contested ruins and trades fire with a RIVAL picket. The press wants blood.",
    choices:[
      {t:"Issue a defiant statement", budget:0, prestige:+4, tension:+3, rival:1},
      {t:"Apologise quietly", budget:-300, prestige:-3, tension:-2, rival:1},
      {t:"Ignore it", budget:0, prestige:-1, tension:+1, rival:1}
    ]},
  { id:"scandal", title:"Procurement Scandal",
    desc:"An audit finds inflated invoices in the fabrication yards. The opposition smells corruption.",
    choices:[
      {t:"Launch a full purge of the yards", budget:-900, prestige:+5, tension:0},
      {t:"Bury the report", budget:+700, prestige:-8, tension:0},
      {t:"Sacrifice a junior minister", budget:0, prestige:-2, tension:0}
    ]},
  { id:"strike", title:"Fabrication Yard Strike",
    desc:"Crab-yard workers down tools demanding hazard pay. Production stalls until resolved.",
    choices:[
      {t:"Meet their demands", budget:-1100, prestige:+3, tension:0},
      {t:"Break the strike by force", budget:-200, prestige:-5, tension:0},
      {t:"Negotiate a compromise", budget:-500, prestige:+1, tension:0}
    ]},
  { id:"windfall", title:"Resource Windfall",
    desc:"Surveyors strike a rich seam of alloy ore beneath a captured district.",
    choices:[
      {t:"Sell the rights for cash", budget:+2400, prestige:0, tension:0},
      {t:"Nationalise it for the war effort", budget:+1000, prestige:+4, tension:+1, rival:"rand"},
      {t:"Gift it to the populace", budget:0, prestige:+7, tension:0}
    ]},
  { id:"defector", title:"Defecting Engineer",
    desc:"A lead engineer from a RIVAL nation offers blueprints in exchange for asylum and a stipend.",
    choices:[
      {t:"Take them in &mdash; and the secrets", budget:-700, prestige:+3, tension:+4, rival:1},
      {t:"Turn them away to keep the peace", budget:0, prestige:-2, tension:-2, rival:1},
      {t:"Hand them back as a goodwill gesture", budget:+300, prestige:-4, tension:-3, rival:1}
    ]},
  { id:"parade", title:"Victory Parade Proposal",
    desc:"Generals propose a grand parade of the roster through the ruins to rally the public.",
    choices:[
      {t:"Hold the parade", budget:-600, prestige:+8, tension:+1, rival:"rand"},
      {t:"A modest review instead", budget:-150, prestige:+3, tension:0},
      {t:"Cancel &mdash; we're at war, not at festival", budget:0, prestige:-1, tension:0}
    ]},
  { id:"famine", title:"District Famine",
    desc:"A besieged district is starving. Relief convoys would cost money the war planners covet.",
    choices:[
      {t:"Divert convoys to feed them", budget:-1300, prestige:+9, tension:0},
      {t:"Send a token shipment", budget:-400, prestige:+2, tension:0},
      {t:"Let the front take priority", budget:0, prestige:-9, tension:0}
    ]},
  { id:"saboteur", title:"Saboteur in the Yards",
    desc:"A RIVAL agent is caught wiring charges to a half-built crab. The public demands a response.",
    choices:[
      {t:"Expel their diplomats", budget:0, prestige:+5, tension:+4, rival:1},
      {t:"Lodge a formal protest only", budget:0, prestige:0, tension:+1, rival:1},
      {t:"Cover it up to avoid escalation", budget:-200, prestige:-4, tension:-1, rival:1}
    ]},
  { id:"prototype", title:"Prototype Breakthrough",
    desc:"The research bureau reports a fire-control breakthrough &mdash; if you fund the rush programme.",
    choices:[
      {t:"Fund the rush programme", budget:-1500, prestige:+6, tension:0},
      {t:"Fund it at half pace", budget:-700, prestige:+2, tension:0},
      {t:"Shelve it for now", budget:0, prestige:-1, tension:0}
    ]},
  { id:"mutiny", title:"Crew Unrest",
    desc:"A veteran crab crew threatens mutiny over a string of unsupported deployments.",
    choices:[
      {t:"Grant leave and back pay", budget:-800, prestige:+4, tension:0},
      {t:"Court-martial the ringleaders", budget:0, prestige:-6, tension:0},
      {t:"Address them personally", budget:-100, prestige:+2, tension:0}
    ]}
];

/* --------------------------- mission definitions ------------------------- */
const MISSION_TYPES = [
  { type:"Fleet Action",      vp:5, risk:7, desc:"defeat the enemy lance in open engagement" },
  { type:"Convoy Escort",     vp:3, risk:4, desc:"shepherd supply crabs safely across the ruins" },
  { type:"Destroy Emplacement",vp:4, risk:5, desc:"knock out a fixed gun position / fortification" },
  { type:"Crew Rescue",       vp:3, risk:5, desc:"recover a knocked-out crew before the enemy does" },
  { type:"Coastal Raid",      vp:4, risk:6, desc:"hit-and-run against shore targets, then withdraw" },
  { type:"Invasion Support",  vp:6, risk:8, desc:"cover a landing / amphibious crossing" }
];

/* ------------------------------ state init ------------------------------- */
function freshState(natId){
  const others = NATIONS.filter(n=>n.id!==natId);
  const tension = {};
  others.forEach(n=> tension[n.id] = 2 + Math.floor(Math.random()*3)); // start 2-4
  return {
    natId,
    year:2025, month:1,
    prestige:50,
    lastPrestigeDelta:0,
    treasury:8000,
    tension,
    wars:{},                  // natId -> {vpUs, vpThem}
    queue:[],                 // {name,cls,cost,spent,eta}
    roster:[],                // {name,cls,maint,lost}
    alloc:{research:35, construction:40, intelligence:10, reserve:15},
    pendingEvent:null,        // {evIndex}
    pendingMission:null,      // {rivalId, mtIndex, city}
    log:[],
    serial:1
  };
}

function load(){
  try{ const raw = localStorage.getItem(SAVE_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  return null;
}
function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){} }

/* ------------------------------ helpers ---------------------------------- */
function nation(){ return NATIONS.find(n=>n.id===S.natId); }
function others(){ return NATIONS.filter(n=>n.id!==S.natId); }
function dateStr(){ return S.year + "." + S.month; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

function logEvt(msg, cls){
  S.log.unshift({d:dateStr(), m:msg, c:cls||""});
  if(S.log.length>120) S.log.length=120;
}

function changePrestige(d, reason){
  S.prestige = clamp(S.prestige + d, 0, 100);
  S.lastPrestigeDelta = d;
  if(reason && d!==0) logEvt((d>0?"+":"")+d+" prestige &mdash; "+reason, d>0?"win":"bad");
}

/* ------------------------ economy / budget model ------------------------- */
function economyIncome(){
  // base scales with era; tension across rivals adds an "emergency budget" uplift
  const yearsIn = (S.year-2025) + (S.month-1)/12;
  const base = 1400 + yearsIn*40;
  let tensionSum = 0;
  others().forEach(n=> tensionSum += S.tension[n.id]||0);
  const emergency = tensionSum * 38;                       // RtW: tension gates budget
  const colonies = S.roster.filter(r=>!r.lost).length * 30; // held ground
  return Math.round(base + emergency + colonies);
}
function maintenanceCost(){
  return S.roster.filter(r=>!r.lost).reduce((s,r)=>s+r.maint,0);
}
function expenses(){
  const maint = maintenanceCost();
  const disc  = Math.round(economyIncome()*0.55); // discretionary pool
  return {
    maintenance: maint,
    research:    Math.round(disc * S.alloc.research/100),
    construction:Math.round(disc * S.alloc.construction/100),
    intelligence:Math.round(disc * S.alloc.intelligence/100),
    reserve:     Math.round(disc * S.alloc.reserve/100)
  };
}
function monthlyBalance(){
  const inc = economyIncome();
  const ex  = expenses();
  const out = ex.maintenance + ex.research + ex.construction + ex.intelligence;
  return inc - out; // reserve stays as treasury growth, so not subtracted
}

/* --------------------------- the month tick ------------------------------ */
function advanceMonth(){
  if(S.prestige<=0) return;
  if(S.pendingEvent || S.pendingMission){
    flashResolveFirst();
    return;
  }

  // 1. calendar
  S.month++;
  if(S.month>12){ S.month=1; S.year++; }

  // 2. budget settle
  const bal = monthlyBalance();
  S.treasury = Math.round(S.treasury + bal);
  if(bal < 0){
    logEvt("monthly deficit "+bal+" &mdash; treasury "+S.treasury, "bad");
    if(S.treasury < 0){ changePrestige(-3, "sustained debt"); }
    else changePrestige(-1, "running a deficit");
  } else {
    logEvt("month settled +"+bal+" &mdash; treasury "+S.treasury, "adv");
  }

  // 3. production progress (construction budget feeds the queue)
  let constr = expenses().construction;
  const eff  = nation().fabrication_efficiency;
  S.queue.forEach(q=>{
    if(q.spent < q.cost){
      const put = Math.min(q.cost - q.spent, constr * eff);
      q.spent += put; constr = Math.max(0, constr - put/eff);
    }
  });
  // deliver finished
  const done = S.queue.filter(q=>q.spent>=q.cost);
  done.forEach(q=>{
    S.roster.push({name:q.name, cls:q.cls, maint:q.maint, lost:false, serial:S.serial++});
    logEvt("DELIVERED "+q.name+" ("+q.cls+") to the roster", "win");
    changePrestige(+1, "new crab fielded");
  });
  S.queue = S.queue.filter(q=>q.spent<q.cost);

  // 4. tension drift
  others().forEach(n=>{
    if(S.tension[n.id]>=13) return;
    if(Math.random()<0.35){
      const d = Math.random()<0.55 ? 1 : -1;
      S.tension[n.id] = clamp(S.tension[n.id]+d, 0, 13);
    }
    if(S.tension[n.id]>=13 && !S.wars[n.id]){
      declareWar(n.id);
    }
  });

  // 5. maybe an event (45% chance)
  if(Math.random()<0.45){
    S.pendingEvent = { evIndex: Math.floor(Math.random()*EVENTS.length) };
  }

  // 6. maybe a mission if at war (60% chance per active war, pick one)
  const warIds = Object.keys(S.wars).map(Number);
  if(!S.pendingEvent && warIds.length && Math.random()<0.6){
    const rivalId = warIds[Math.floor(Math.random()*warIds.length)];
    const mtIndex = Math.floor(Math.random()*MISSION_TYPES.length);
    const city = CITIES[Math.floor(Math.random()*CITIES.length)];
    S.pendingMission = { rivalId, mtIndex, city };
  }

  save(); render();
}

function declareWar(rivalId){
  S.wars[rivalId] = { vpUs:0, vpThem:0 };
  const nm = NATIONS.find(n=>n.id===rivalId).name;
  logEvt("WAR DECLARED with "+nm+" &mdash; tension at 13", "bad");
}

/* ------------------------- fleet strength (for missions) ----------------- */
function fleetStrength(){
  const n = nation();
  const base = S.roster.filter(r=>!r.lost).length;
  const mod = (n.accuracy + n.fire_control + n.armor_quality + n.damage_control)/4;
  return base * mod + 0.5; // +0.5 so a roster of 0 still has a tiny chance
}

/* ---------------------------- event resolve ------------------------------ */
function resolveEvent(choiceIdx){
  const ev = EVENTS[S.pendingEvent.evIndex];
  const c  = ev.choices[choiceIdx];
  S.treasury = Math.round(S.treasury + (c.budget||0));
  changePrestige(c.prestige||0, "event: "+ev.title);
  if(c.tension){
    let rid;
    if(c.rival==="rand"){ const o=others(); rid=o[Math.floor(Math.random()*o.length)].id; }
    else { // map abstract "1" to highest-tension rival
      rid = others().sort((a,b)=>(S.tension[b.id]||0)-(S.tension[a.id]||0))[0].id;
    }
    S.tension[rid] = clamp((S.tension[rid]||0)+c.tension, 0, 13);
    if(S.tension[rid]>=13 && !S.wars[rid]) declareWar(rid);
  }
  logEvt("event \u201c"+ev.title+"\u201d \u2192 "+stripTags(c.t), "ev");
  S.pendingEvent = null;
  save(); render();
}

/* --------------------------- mission resolve ----------------------------- */
function resolveMission(accept){
  const m  = S.pendingMission;
  const mt = MISSION_TYPES[m.mtIndex];
  const war= S.wars[m.rivalId];
  const rivalNation = NATIONS.find(n=>n.id===m.rivalId);
  const rivalNm = rivalNation.name;

  if(!accept){
    // refusing costs VP + prestige
    if(war) war.vpThem += Math.ceil(mt.vp/2);
    changePrestige(-4, "refused "+mt.type);
    logEvt("REFUSED "+mt.type+" near "+m.city+" &mdash; enemy gains ground", "bad");
    S.pendingMission = null; save(); render(); return;
  }

  // resolve: strength vs rival doctrine + luck
  const us   = fleetStrength();
  const them = (rivalNation.accuracy+rivalNation.fire_control)/2 *
               (1 + S.tension[m.rivalId]/13) + Math.random()*1.5;
  const roll = us + Math.random()*2.5;
  const win  = roll >= them;

  if(win){
    if(war) war.vpUs += mt.vp;
    changePrestige(+mt.vp, "won "+mt.type);
    logEvt("VICTORY \u2014 "+mt.type+" on "+m.city+" map (+"+mt.vp+" VP)", "win");
    // chance an enemy crab is knocked out (no sinking, just KO)
    if(Math.random()<0.4 && war) war.vpUs += 1;
  } else {
    if(war) war.vpThem += Math.ceil(mt.vp*0.7);
    changePrestige(-Math.ceil(mt.risk/2), "lost "+mt.type);
    logEvt("DEFEAT \u2014 "+mt.type+" on "+m.city+" map", "bad");
    // chance we lose a crab
    const live = S.roster.filter(r=>!r.lost);
    if(live.length && Math.random()<0.45){
      const victim = live[Math.floor(Math.random()*live.length)];
      victim.lost = true;
      changePrestige(-3, "lost crab "+victim.name);
      logEvt(victim.name+" knocked out in action", "bad");
    }
  }

  // check war decided (first to 25 VP, or a 15-pt lead after 10 total)
  if(war){
    const total = war.vpUs + war.vpThem;
    if(war.vpUs>=25 || (total>=10 && war.vpUs-war.vpThem>=15)){
      endWar(m.rivalId, true);
    } else if(war.vpThem>=25 || (total>=10 && war.vpThem-war.vpUs>=15)){
      endWar(m.rivalId, false);
    }
  }

  S.pendingMission = null; save(); render();
}

function endWar(rivalId, won){
  const nm = NATIONS.find(n=>n.id===rivalId).name;
  delete S.wars[rivalId];
  S.tension[rivalId] = won ? 3 : 6; // peace settles tension
  if(won){ changePrestige(+12, "WON the war with "+nm); logEvt("WAR WON \u2014 peace with "+nm, "win"); }
  else   { changePrestige(-12, "LOST the war with "+nm); logEvt("WAR LOST \u2014 humiliating terms with "+nm, "bad"); }
}

/* ----------------------------- production -------------------------------- */
function queueBuild(chassisId){
  const ch = CHASSIS.find(c=>c.id===chassisId);
  if(!ch) return;
  const eff = nation().fabrication_efficiency;
  const cost = Math.round(ch.cost / eff);
  S.queue.push({
    name: ch.name+" "+romanSerial(),
    cls: ch.cls, cost, spent:0,
    maint: Math.round(ch.maintenance/eff)
  });
  logEvt("laid down "+ch.name+" ("+ch.cls+") &mdash; cost "+cost, "adv");
  save(); render();
}
let serialN = 0;
function romanSerial(){
  const r=["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];
  return r[(serialN++)%r.length];
}

/* ============================ RENDER ===================================== */
function render(){
  const n = nation();
  document.getElementById("natTop").textContent = n.name;
  document.getElementById("dateTop").textContent = dateStr();
  document.getElementById("dateVal").textContent = dateStr();

  renderNation();
  renderPrestige();
  renderVP();
  renderTension();
  renderEvent();
  renderMission();
  renderBudget();
  renderAlloc();
  renderProduction();
  renderRoster();
  renderLog();

  document.getElementById("gameover").classList.toggle("show", S.prestige<=0);
  if(S.prestige<=0){
    document.getElementById("goText").innerHTML =
      "Your prestige reached zero. The "+n.name+" leadership has stripped you of command in "
      +dateStr()+".<br>Wars won: tracked in the log. Choose a new nation and begin again.";
  }
  save();
}

function renderNation(){
  const n = nation();
  document.getElementById("natTraits").innerHTML =
    n.traits.map(t=>"<span class='pill'>"+t+"</span>").join(" ");
  const fmtMod = v => (v>=1?"+":"")+Math.round((v-1)*100)+"%";
  const st = document.getElementById("natStats");
  st.innerHTML = `
    <div class="row"><span class="k">Accuracy</span><span class="v">${fmtMod(n.accuracy)}</span></div>
    <div class="row"><span class="k">Fire Control</span><span class="v">${fmtMod(n.fire_control)}</span></div>
    <div class="row"><span class="k">Armour Quality</span><span class="v">${fmtMod(n.armor_quality)}</span></div>
    <div class="row"><span class="k">Damage Control</span><span class="v">${fmtMod(n.damage_control)}</span></div>
    <div class="row"><span class="k">Fabrication</span><span class="v">${fmtMod(n.fabrication_efficiency)}</span></div>
    <div class="row"><span class="k">Research Speed</span><span class="v">${fmtMod(n.research_speed)}</span></div>`;
}

function renderPrestige(){
  const p = S.prestige;
  const el = document.getElementById("prVal");
  el.textContent = p;
  el.className = "heroval " + (p>=60?"good":p>=25?"warn":"bad");
  const bar = document.getElementById("prBar");
  bar.className = "bigbar " + (p>=60?"":p>=25?"warn":"bad");
  bar.querySelector("i").style.width = p+"%";
  const d = S.lastPrestigeDelta;
  const dd = document.getElementById("prDelta");
  dd.textContent = d===0 ? "no change last action" : (d>0?"▲ +"+d+" last action":"▼ "+d+" last action");
  dd.className = "delta " + (d>0?"up":d<0?"down":"");
  document.getElementById("prTenure").textContent =
    p>=60?"SECURE":p>=25?"UNDER PRESSURE":p>0?"CRISIS — NEAR REMOVAL":"REMOVED";
}

function renderVP(){
  const box = document.getElementById("vpBox");
  const warIds = Object.keys(S.wars).map(Number);
  if(!warIds.length){
    box.innerHTML = `<div class="nochoice">No active war. VP is the war scoreboard &mdash; you earn it by
      winning missions (battles, convoys, raids) and lose it by refusing or losing them. When tension with a
      rival hits 13, war begins and a VP race opens here.</div>`;
    return;
  }
  box.innerHTML = warIds.map(id=>{
    const nm = NATIONS.find(x=>x.id===id).name;
    const w = S.wars[id];
    const tot = Math.max(1, w.vpUs+w.vpThem);
    return `<div style="margin-bottom:8px">
      <div class="lbl">WAR vs ${nm} &mdash; first to 25 VP</div>
      <div class="vpwrap">
        <div class="side"><div class="v">${w.vpUs}</div><div class="l">Our VP</div></div>
        <div class="vs">VS</div>
        <div class="side enemy"><div class="v">${w.vpThem}</div><div class="l">Enemy VP</div></div>
      </div>
      <div class="bar good"><i style="width:${Math.round(w.vpUs/tot*100)}%"></i></div>
    </div>`;
  }).join("");
}

function renderTension(){
  const box = document.getElementById("tensionList");
  box.innerHTML = others().map(n=>{
    const t = S.tension[n.id]||0;
    const war = t>=13;
    const near = t>=10 && t<13;
    const col = war?"var(--red)":near?"var(--amber)":t>=6?"var(--orange)":"var(--teal)";
    const cls = war?"war":near?"near":"";
    const lbl = war?"WAR":near?"NEAR WAR":t+"/13";
    return `<div class="tnrow ${cls}">
      <span class="nm">${n.name}</span>
      <span class="tb"><i style="width:${Math.round(t/13*100)}%;background:${col}"></i></span>
      <span class="tv">${lbl}</span></div>`;
  }).join("");
}

function renderEvent(){
  const area = document.getElementById("eventArea");
  if(!S.pendingEvent){ area.innerHTML=""; return; }
  const ev = EVENTS[S.pendingEvent.evIndex];
  area.innerHTML = `<div class="card">
    <div class="ct">EVENT &mdash; ${ev.title}</div>
    <div class="cd">${ev.desc}</div>
    ${ev.choices.map((c,i)=>`<button class="choice" data-ev="${i}">${c.t}
      <span class="eff">${effLabel(c)}</span></button>`).join("")}
  </div>`;
  area.querySelectorAll(".choice").forEach(b=>
    b.onclick=()=>resolveEvent(+b.dataset.ev));
}

function effLabel(c){
  const parts=[];
  if(c.budget) parts.push(spanNum(c.budget,"$",c.budget>0));
  if(c.prestige) parts.push(spanNum(c.prestige," prestige",c.prestige>0));
  if(c.tension) parts.push(spanNum(c.tension," tension",c.tension<0)); // lower tension = good
  return parts.join("  ");
}
function spanNum(v,unit,good){
  const cls = good?"p":"n";
  return `<span class="${cls}">${v>0?"+":""}${v}${unit}</span>`;
}

function renderMission(){
  const area = document.getElementById("missionArea");
  if(!S.pendingMission){ area.innerHTML=""; return; }
  const m = S.pendingMission;
  const mt= MISSION_TYPES[m.mtIndex];
  const nm= NATIONS.find(n=>n.id===m.rivalId).name;
  area.innerHTML = `<div class="card mission">
    <div class="ct">MISSION &mdash; ${mt.type}</div>
    <div class="cd">High command tasks you against <b>${nm}</b>: ${mt.desc}.
      To be fought on the <b>${m.city}</b> map (tactical battle resolves in the Unity game).</div>
    <button class="choice" data-acc="1">ACCEPT &mdash; deploy the roster
      <span class="eff"><span class="p">+${mt.vp} VP</span> on win &middot; <span class="n">prestige risk ${mt.risk}/10</span></span></button>
    <button class="choice" data-acc="0">REFUSE &mdash; hold our crabs back
      <span class="eff"><span class="n">-4 prestige</span> &middot; <span class="n">+${Math.ceil(mt.vp/2)} enemy VP</span></span></button>
  </div>`;
  area.querySelectorAll(".choice").forEach(b=>
    b.onclick=()=>resolveMission(b.dataset.acc==="1"));
}

function renderBudget(){
  const inc = economyIncome();
  const ex  = expenses();
  const bal = monthlyBalance();
  const box = document.getElementById("budgetBox");
  box.innerHTML = `
    <div class="lbl">Income</div>
    <div class="row"><span class="k">economy + era</span><span class="v">${Math.round(inc*0.7)}</span></div>
    <div class="row"><span class="k">tension / war uplift</span><span class="v good">${Math.round(inc*0.3)}</span></div>
    <div class="row good" style="border-top:1px solid var(--hair);margin-top:3px;padding-top:3px"><span class="k">TOTAL INCOME</span><span class="v">${inc}</span></div>
    <div class="lbl" style="margin-top:8px">Expenses</div>
    <div class="row"><span class="k">crab maintenance</span><span class="v">${ex.maintenance}</span></div>
    <div class="row"><span class="k">construction</span><span class="v">${ex.construction}</span></div>
    <div class="row"><span class="k">research</span><span class="v">${ex.research}</span></div>
    <div class="row"><span class="k">intelligence</span><span class="v">${ex.intelligence}</span></div>
    <div class="row ${bal<0?'bad':'good'}" style="border-top:1px solid var(--hair);margin-top:3px;padding-top:3px">
      <span class="k">MONTHLY BALANCE</span><span class="v">${bal>0?"+":""}${bal}</span></div>
    <div class="row"><span class="k">TREASURY</span><span class="v ${S.treasury<0?'bad':''}">${S.treasury}</span></div>`;
}

function renderAlloc(){
  const box = document.getElementById("allocBox");
  const keys = [["research","Research"],["construction","Construction"],
                ["intelligence","Intelligence"],["reserve","Reserve"]];
  box.innerHTML = keys.map(([k,lbl])=>`
    <div class="stepper">
      <span class="nm">${lbl}</span>
      <button class="sbtn" data-alloc="${k}" data-d="-5">&minus;</button>
      <span class="sval">${S.alloc[k]}%</span>
      <button class="sbtn" data-alloc="${k}" data-d="5">+</button>
    </div>`).join("") +
    `<div class="lbl" style="margin-top:6px;line-height:1.5">Allocates the discretionary half of income. Steppers re-balance against <b>Reserve</b>. Sustained deficits cost prestige.</div>`;
  box.querySelectorAll(".sbtn").forEach(b=> b.onclick=()=>{
    const k=b.dataset.alloc, d=+b.dataset.d;
    const nv = clamp(S.alloc[k]+d, 0, 100);
    const diff = nv - S.alloc[k];
    // pull/push from reserve (or research if adjusting reserve)
    const sink = k==="reserve" ? "research" : "reserve";
    if(S.alloc[sink]-diff < 0) return;
    S.alloc[k]=nv; S.alloc[sink]-=diff;
    save(); render();
  });
}

function renderProduction(){
  const box = document.getElementById("queueBox");
  document.getElementById("queueCount").textContent = S.queue.length+" in build";
  if(!S.queue.length){ box.innerHTML=`<div class="nochoice">Queue empty. Pick a chassis above and QUEUE PRODUCTION. Construction budget feeds the queue each month.</div>`; return; }
  box.innerHTML = S.queue.map(q=>{
    const pct = clamp(Math.round(q.spent/q.cost*100),0,100);
    return `<div class="item ${pct>=100?'ready':''}">
      <div class="ih"><span class="nm">${q.name}</span><span class="cls">${q.cls}</span></div>
      <div class="meta"><span>cost ${q.cost}</span><span>maint ${q.maint}/mo</span><span>${pct}%</span></div>
      <div class="pbar"><i style="width:${pct}%"></i></div></div>`;
  }).join("");
}

function renderRoster(){
  const box = document.getElementById("rosterBox");
  const live = S.roster.filter(r=>!r.lost).length;
  document.getElementById("rosterCount").textContent = live+" active";
  if(!S.roster.length){ box.innerHTML=`<div class="nochoice">No crabs delivered yet. Build crabs and advance months to grow the roster.</div>`; return; }
  box.innerHTML = S.roster.slice().reverse().map(r=>`
    <div class="item ${r.lost?'lost':''}">
      <div class="ih"><span class="nm">${r.name}</span><span class="cls">${r.cls}</span></div>
      <div class="meta"><span>${r.lost?'KNOCKED OUT':'operational'}</span><span>maint ${r.maint}/mo</span></div>
    </div>`).join("");
}

function renderLog(){
  document.getElementById("log").innerHTML = S.log.map(e=>
    `<div class="e ${e.c}"><span class="d">${e.d}</span> ${e.m}</div>`).join("");
}

/* --------------------------- selects / controls -------------------------- */
function buildNationSelect(){
  const sel = document.getElementById("natSelect");
  sel.innerHTML = NATIONS.map(n=>`<option value="${n.id}">${n.name}</option>`).join("");
  sel.value = S.natId;
  sel.onchange = ()=>{
    if(+sel.value!==S.natId){
      if(confirm("Switch nation? This starts a NEW campaign.")){
        S = freshState(+sel.value); seedStart(); save(); render();
      } else sel.value = S.natId;
    }
  };
}
function buildChassisSelect(){
  const sel = document.getElementById("buildSelect");
  const eff = nation().fabrication_efficiency;
  sel.innerHTML = CHASSIS.map(c=>{
    const avail = c.year<=S.year;
    const cost = Math.round(c.cost/eff);
    return `<option value="${c.id}" ${avail?'':'disabled'}>${c.name} &middot; ${c.cls} &middot; ${cost}${avail?'':' (unlocks '+c.year+')'}</option>`;
  }).join("");
  updateBuildHint();
  sel.onchange = updateBuildHint;
}
function updateBuildHint(){
  const sel = document.getElementById("buildSelect");
  const c = CHASSIS.find(x=>x.id===+sel.value);
  if(!c){ document.getElementById("buildHint").textContent=""; return; }
  const eff = nation().fabrication_efficiency;
  document.getElementById("buildHint").innerHTML =
    `<b>${c.name}</b> (${c.cls}) &mdash; mass ${c.mass}t, ${c.mounts} mounts, ${c.crew} crew, ${c.speed} km/h. `+
    `Cost ${Math.round(c.cost/eff)}, maintenance ${Math.round(c.maintenance/eff)}/mo.`;
}

function seedStart(){
  logEvt("campaign begins &mdash; "+nation().name+" high command takes office", "adv");
}

function flashResolveFirst(){
  const area = S.pendingEvent ? document.getElementById("eventArea")
                              : document.getElementById("missionArea");
  area.style.outline = "2px solid var(--amber)";
  setTimeout(()=>area.style.outline="", 500);
}

/* ------------------------------- wiring ---------------------------------- */
function wire(){
  document.getElementById("advBtn").onclick = advanceMonth;
  document.getElementById("buildBtn").onclick = ()=>{
    const sel = document.getElementById("buildSelect");
    const c = CHASSIS.find(x=>x.id===+sel.value);
    if(c && c.year<=S.year) queueBuild(c.id);
  };
  const doReset = ()=>{
    if(confirm("Start a NEW campaign? Current progress is erased.")){
      S = freshState(S?S.natId:NATIONS[0].id); serialN=0; seedStart(); save();
      buildNationSelect(); buildChassisSelect(); render();
    }
  };
  document.getElementById("resetBtn").onclick = doReset;
  document.getElementById("goReset").onclick = ()=>{
    S = freshState(S.natId); serialN=0; seedStart(); save();
    buildNationSelect(); buildChassisSelect(); render();
  };
}

/* -------------------------------- boot ----------------------------------- */
(async function(){
  await loadData();
  S = load();
  if(!S || !NATIONS.find(n=>n.id===S.natId)){
    S = freshState(NATIONS[0].id);
    seedStart();
  }
  // backfill any missing tension entries (in case nations changed)
  others().forEach(n=>{ if(S.tension[n.id]===undefined) S.tension[n.id]=2; });

  // ?demo=1 seeds a representative mid-campaign state (war + event) for screenshots
  if(new URLSearchParams(location.search).get("demo")==="1"){
    S = freshState(NATIONS[0].id); serialN=0;
    S.year=2027; S.month=4; S.prestige=63; S.lastPrestigeDelta=+5; S.treasury=11240;
    S.tension[2]=13; S.tension[3]=10; S.tension[4]=6;
    S.wars[2]={vpUs:14, vpThem:9};
    S.roster=[
      {name:"Hoplite III",cls:"Line",maint:320,lost:false,serial:1},
      {name:"Jackal V",cls:"Skirmisher",maint:150,lost:false,serial:2},
      {name:"Bastion II",cls:"Spider",maint:640,lost:true,serial:3}
    ];
    S.queue=[{name:"Phalanx VII",cls:"Line",cost:5200,spent:2300,maint:440},
             {name:"Leviathan I",cls:"Siege",cost:13500,spent:1100,maint:1150}];
    S.pendingMission={rivalId:2, mtIndex:0, city:"Cinderhal"};
    S.log=[{d:"2027.4",m:"VICTORY \u2014 Convoy Escort on Greyspan map (+3 VP)",c:"win"},
           {d:"2027.3",m:"WAR DECLARED with Nordmark Union \u2014 tension at 13",c:"bad"},
           {d:"2027.2",m:"DELIVERED Hoplite III (Line) to the roster",c:"win"}];
  }
  buildNationSelect();
  buildChassisSelect();
  wire();
  render();
})();

function stripTags(s){ return s.replace(/<[^>]*>/g,"").replace(/&mdash;/g,"\u2014"); }
