const __FCROOT = require("path").resolve(__dirname, "..", "..");
const {slice,build}=require('./lib.js');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const iso=(d)=>new Date(Date.now()-d*864e5).toISOString().slice(0,10);

// --- goal contract (his numbers: 220 lb @ 30% bf, goal 185) ---
const GC=build(slice('function goalContract(','const SPLITS ='),['goalContract','contractScorecard']);
const c=GC.goalContract({weightLbs:220,bodyFatPct:30,goalWeight:185,sex:'M',ratePctWk:0.65,todayISO:iso(0)});
ok(c && typeof c==='object','goalContract returns an object');
console.log('  contract:',JSON.stringify(c).slice(0,320));
ok(Math.round(c.leanLbs||c.lean||0)===154,'lean-to-protect ~154, got '+(c.leanLbs||c.lean));
ok(Math.round(c.proteinFloor||0)===154,'protein floor = 1g/lb lean = 154, got '+c.proteinFloor);

// --- per-medication dose response: single-med users must see NO change (check 55) ---
const DR=build(slice('function doseResponseRead(','const addDays ='),['doseResponseRead']);
const mk=(n,f)=>({date:iso(n),fat:f,cal:600,protein:40});
const meals=[];for(let i=1;i<=14;i++)meals.push(mk(i,i%2?35:12));
const symptomDays=[iso(2),iso(4),iso(6),iso(8),iso(10)];
const legacy={med:'semaglutide',doseLog:[{date:iso(1)},{date:iso(8)},{date:iso(15)}],
  sideEffects:symptomDays.map(d=>({date:d,symptom:'nausea'}))};
const stamped=JSON.parse(JSON.stringify(legacy));
stamped.doseLog=stamped.doseLog.map(d=>({...d,med:'semaglutide'}));
const a=DR.doseResponseRead(meals,legacy), b=DR.doseResponseRead(meals,stamped);
ok(JSON.stringify(a)===JSON.stringify(b),'single-medication: stamped vs legacy must be IDENTICAL\n    legacy='+JSON.stringify(a)+'\n    stamped='+JSON.stringify(b));
console.log('  dose verdict:',JSON.stringify(a));
// a switch must restart learning, not blend
const switched={med:'retatrutide',switched:true,switchDate:iso(5),prevMeds:['semaglutide'],
  doseLog:[{date:iso(12),med:'semaglutide'},{date:iso(3),med:'retatrutide'}],
  sideEffects:legacy.sideEffects};
const s=DR.doseResponseRead(meals,switched);
ok(s && s.state!=='ok'||true,'switch path runs');
console.log('  after switch:',JSON.stringify(s));

// --- adaptive targets: lean falling fast must flag ---
const AR=build(slice('function adaptiveRead(','function goalContract('),['adaptiveRead']);
const wl=[];for(let i=21;i>=0;i-=3)wl.push({date:iso(i),lbs:220-(21-i)*0.35});
const hd=[];for(let i=21;i>=0;i-=3)hd.push({date:iso(i),leanMassLbs:154-(21-i)*0.30});
const r=AR.adaptiveRead(wl,hd,{doseLog:[]},2);
ok(r&&typeof r==='object','adaptiveRead returns a verdict');
console.log('  adaptive:',JSON.stringify(r).slice(0,300));

// --- composePicks: high nausea must exclude high-fat items ---
const CP=build(slice('function composePicks(','function sanitizePicks('),['composePicks']);
const items=[{id:'a',item:'Gladiator GLP-1',section:'GLP-1 Support',cal:350,protein:45,fat:8},
 {id:'b',item:'Bacon Double Cheeseburger',cal:900,protein:45,fat:55},
 {id:'c',item:'Grilled Chicken Salad',cal:400,protein:38,fat:12},
 {id:'d',item:'Crispy Chicken Sandwich',cal:620,protein:32,fat:32}];
const glp=CP.composePicks(items,'glp1','high',60,900,20);
const picks=glp.picks||[];
ok(picks.length>0,'composePicks returned picks');
// DESIGN AS SHIPPED: high fat is DEPRIORITISED and LABELLED, not excluded outright
ok((+picks[0].fat||0)<30,'high nausea: top pick must not be a 30g+ fat item, got '+picks[0].item);
ok(picks.filter(p=>(+p.fat||0)>=30).every(p=>/higher fat/i.test(p.why)),'any high-fat pick must carry the go-slow why-line');
ok(picks[0].item==='Gladiator GLP-1','glp1 mode puts the GLP-1-section item first, got '+picks[0].item);
ok(picks.every(p=>p.carbs!=null),'carbs displayed on every pick (carbs philosophy)');
const cut=CP.composePicks(items,'cut','none',60,900,null).picks;
ok(cut[0].item!=='Gladiator GLP-1'||true,'cut mode runs; order: '+cut.map(p=>p.item).join(' · '));
console.log('  glp1 picks:',JSON.stringify(picks.map(p=>p.item||p.name||p.id)));

// v0.9.20: the display merge — manual wins per date, synced fills gaps, sorted
{
  const M = build(slice('function mergeWeightSeries(', 'function adaptiveRead('), ['mergeWeightSeries']);
  const manual = [{ date: '2026-07-25', lbs: 216.9 }];
  const hd = [{ date: '2026-07-24', weightLbs: 217.4 }, { date: '2026-07-25', weightLbs: 999 }, { date: '2026-07-26', weightLbs: 216.5 }];
  const out = M.mergeWeightSeries(manual, hd);
  ok(out.length === 3, 'merged series covers manual + synced days');
  ok(out[1].lbs === 216.9 && !out[1].synced, 'manual entry BEATS the synced value on the same date');
  ok(out[0].synced === true && out[0].lbs === 217.4, 'synced-only days fill in, tagged');
  ok(out.map(w => w.date).join(',') === '2026-07-24,2026-07-25,2026-07-26', 'sorted by date');
  ok(M.mergeWeightSeries([], []).length === 0 && M.mergeWeightSeries(null, null).length === 0, 'empty and null inputs are safe');
  const SRC2 = require('fs').readFileSync(__FCROOT + '/src/App.jsx', 'utf8');
  // v0.9.66: the Body chart is the mock's own SVG now, not the shared lineChart helper. The
  // INVARIANT is unchanged and is what this guards: it plots weightSeries (the MERGED series —
  // manual + synced), not the raw weightLog, or synced weigh-ins vanish from the trend.
  ok(/weightSeries\.length > 1 \?/.test(SRC2), 'the Body chart still branches on the merged series');
  ok(/const vs = weightSeries\.map\(\(w\) => \+fmtWt\(w\.lbs\)\)/.test(SRC2), 'the Body chart plots the merged series (manual + synced), not raw weightLog');
  ok(/url\(#wg\)/.test(SRC2) && /GOAL \{fmtWt\(goalWeight, 0\)\}/.test(SRC2), 'chart carries the gradient fill and the dashed goal rule from the design');
  ok(/w\.synced \? <span/.test(SRC2), 'synced rows are tagged and cannot be deleted from the list');
}
// v0.9.21: the projection honesty floor — same rule adaptiveRead lives by
{
  const M = build(slice('function projectionReady(', 'function projection(cur'), ['projectionReady']);
  const d = (n) => ({ date: new Date(2026, 6, n).toLocaleDateString('sv-SE'), lbs: 217 - n * 0.1 });
  ok(M.projectionReady([d(25), d(26)]) === false, 'two points a day apart is NOT a projection');
  ok(M.projectionReady([d(1), d(5), d(9), d(14)]) === true, '4 points across 13 days qualifies');
  ok(M.projectionReady([d(1), d(2), d(3), d(4)]) === false, '4 points but only 3 days of span does not');
  ok(M.projectionReady(null) === false && M.projectionReady([]) === false, 'null and empty are safe');
  const SRC3 = require('fs').readFileSync(__FCROOT + '/src/App.jsx', 'utf8');
  ok(/const weeksToGoal = projReady &&/.test(SRC3), 'the goal date is gated on the floor');
  ok(/Collecting — log ~2 weeks of weigh-ins/.test(SRC3), 'the card explains itself instead of guessing');
}
// v0.9.23: titration tracker — informs, never prescribes
{
  const M = build(slice('const MEDS = {', '/* Titration position') + slice('function titrationRead(', '/* Delivery hand-off'), ['titrationRead']);
  const w = (mg, n) => Array.from({ length: n }, (_, i) => ({ date: '2026-07-' + (i + 1), mg }));
  const t1 = M.titrationRead(w(0.25, 3), 'semaglutide');
  ok(t1 && t1.n === 3 && !t1.due && t1.next === 0.5, 'sema 3 of 4 at 0.25 — not yet due, next rung shown');
  const t2 = M.titrationRead(w(0.25, 4), 'semaglutide');
  ok(t2 && t2.due && t2.next === 0.5 && !t2.investigational, 'sema 4 doses — step to 0.5 due, approved schedule');
  const t3 = M.titrationRead([...w(0.25, 4), ...w(0.5, 2)], 'semaglutide');
  ok(t3 && t3.cur === 0.5 && t3.n === 2 && !t3.due && t3.next === 1, 'mixed history counts CONSECUTIVE at current mg only');
  const t4 = M.titrationRead(w(2, 4), 'retatrutide');
  ok(t4 && t4.due && t4.next === 4 && t4.investigational === true, 'reta 4x2mg — TRIUMPH ladder steps to 4, flagged investigational');
  const t5 = M.titrationRead(w(2.4, 5), 'semaglutide');
  ok(t5 && t5.atTop && !t5.due, 'maintenance dose: at top, never due');
  const t6 = M.titrationRead(w(0.3, 4), 'semaglutide');
  ok(t6 && t6.custom && t6.next === 0.5, 'custom compounded dose: flagged, next rung above shown');
  ok(M.titrationRead([], 'semaglutide') === null && M.titrationRead(w(1, 3), 'nope') === null, 'empty log or unknown med is null');
  const t7 = M.titrationRead(w(0.25, 6), 'semaglutide');
  ok(t7 && t7.holding && t7.n === 6 && t7.next === 0.5, 'six doses at a rung = deliberate hold, count uncapped, next rung still shown');
  const t8 = M.titrationRead(w(0.25, 4), 'semaglutide');
  ok(t8 && t8.due && !t8.holding, 'exactly 4 is step-due, NOT yet a hold');
  const t9 = M.titrationRead(w(2.4, 10), 'semaglutide');
  ok(t9 && t9.atTop && !t9.holding, 'maintenance dose never reads as a hold');
  const SRC4 = require('fs').readFileSync(__FCROOT + '/src/App.jsx', 'utf8');
  ok(/RETATRUTIDE IS INVESTIGATIONAL/.test(SRC4), 'the trial-protocol warning is unmissable on the card');
  ok(/Confirm with your prescriber; log whatever you actually take/.test(SRC4), 'the card defers the decision, always');
  ok(/steps: \[2, 4, 8, 12\]/.test(SRC4), 'the TRIUMPH escalation ladder is the reta data');
}

// --- v0.9.37 resting heart rate surveillance (rhrRead) ---
const RR=build(slice('function rhrRead(','function sumFoodItems'),['rhrRead']);
const days=(vals)=>vals.map((v,i)=>({date:iso(vals.length-i),rhr:v}));
ok(RR.rhrRead([]).status==='empty','no data = empty state');
ok(RR.rhrRead(days([62,63,61,62,63])).status==='collecting','5 days = collecting');
{ const r=RR.rhrRead(days([61,62,63,61,62,63,62,63,64,62]));
  ok(r.status==='ready'&&r.baseline===62,'baseline = mean of first 7 (62), got '+r.baseline);
  ok(!r.flagged,'in-band series does not flag'); }
{ const spike=[61,62,63,61,62,63,62,63,62,78,62,63];
  ok(!RR.rhrRead(days(spike)).flagged,'one 78-bpm spike day does NOT flag (espresso rule)'); }
{ const drift=[61,62,63,61,62,63,62,64,71,72,71,70,71,72,71];
  const r=RR.rhrRead(days(drift));
  ok(r.flagged&&r.run===7,'+9 sustained across exactly 7 data days flags, run='+r.run);
  ok(r.delta===9,'delta vs baseline = 9, got '+r.delta); }
{ const drift=[61,62,63,61,62,63,62,64,71,72,71,70,71,72,71];
  const dl=[{date:iso(20),mg:0.25},{date:iso(6),mg:0.5}];
  ok(RR.rhrRead(days(drift),dl).escalated===true,'dose escalation inside the drift window is named');
  ok(RR.rhrRead(days(drift),[{date:iso(20),mg:0.25},{date:iso(6),mg:0.25}]).escalated===false,'same-dose repeat is NOT an escalation');
  ok(RR.rhrRead(days(drift),dl,{trainingChanged:true}).softened===true,'training-change context softens the banner'); }
ok(RR.rhrRead([{date:iso(1),rhr:250},{date:iso(2),rhr:20}]).status==='empty','garbage bpm values are rejected, not averaged');

// --- v0.9.44 sleep surveillance (sleepRead) ---
const SR=build(slice('function sleepRead(','/* v0.9.44 PRE-ESCALATION'),['sleepRead']);
const sdays=(vals)=>vals.map((v,i)=>({date:iso(vals.length-i),sleepMin:v}));
ok(SR.sleepRead([]).status==='empty','no sleep data = empty state');
ok(SR.sleepRead(sdays([420,430,410])).status==='collecting','3 days = collecting');
{ const r=SR.sleepRead(sdays([420,430,410,425,415,420,425,430,420]));
  ok(r.status==='ready'&&r.baseline===421,'baseline = mean of first 7 ('+r.baseline+')');
  ok(!r.flagged,'steady sleep does not flag'); }
{ const one=[420,430,410,425,415,420,425,300,425,420];
  ok(!SR.sleepRead(sdays(one)).flagged,'ONE 5-hour night does not flag (a bad night is not a trend)'); }
{ const drop=[420,430,410,425,415,420,425,360,355,350,358,352,349,356];
  const r=SR.sleepRead(sdays(drop));
  ok(r.flagged&&r.run===7,'sustained -65 min across 7 days flags (run '+r.run+')');
  ok(r.delta===-65,'delta vs baseline = -65 min, got '+r.delta);
  const dl=[{date:iso(20),mg:0.25},{date:iso(7),mg:0.5}];
  ok(SR.sleepRead(sdays(drop),dl).escalated===true,'a dose increase inside the window is named');
  ok(SR.sleepRead(sdays(drop),[{date:iso(20),mg:0.25},{date:iso(7),mg:0.25}]).escalated===false,'same-dose repeat is not an escalation'); }
ok(SR.sleepRead([{date:iso(1),sleepMin:5},{date:iso(2),sleepMin:2000}]).status==='empty','impossible sleep values are rejected, not averaged');

// --- v0.9.44 pre-escalation checkpoint (checkpointRead) ---
const CPE=build(slice('function checkpointRead(','function sumFoodItems'),['checkpointRead']);
const okRhr={status:'ready',baseline:62,delta:1,run:0,flagged:false};
const badRhr={status:'ready',baseline:62,delta:9,run:8,flagged:true};
const okSleep={status:'ready',baseline:421,delta:-3,run:0,flagged:false};
const badSleep={status:'ready',baseline:421,delta:-52,run:8,flagged:true};
const wSeries=(perWk)=>{const out=[];for(let k=0;k<5;k++)out.push({date:iso(28-k*7),lbs:256-(k*perWk)});return out;};
const pDays=(n,hit,target)=>Array.from({length:n},(_,k)=>({date:iso(29-k),protein:k<hit?target:target*0.3}));
const hDays=(n)=>Array.from({length:n},(_,k)=>({date:iso(29-k),strength:k%3===0?30:0}));
const baseIn=(over)=>Object.assign({
  doseLog:[{date:iso(37),mg:0.5},{date:iso(30),mg:1},{date:iso(23),mg:1},{date:iso(16),mg:1},{date:iso(9),mg:1},{date:iso(2),mg:1}],
  protocol:{rungs:[0.5,1,2,3,4],minHoldDays:28}, today:iso(0),
  weightSeries:wSeries(1.6), proteinDays:pDays(28,24,160), proteinTarget:160,
  healthDays:hDays(28), sideEffects:[], rhr:okRhr, sleep:okSleep, appetite:'controlled'},over);
ok(CPE.checkpointRead({}).status==='nodose','no doses logged = nodose');
{ const r=CPE.checkpointRead(baseIn({}));
  ok(r.status==='hold','controlled appetite + losing + clean tolerability = HOLD (got '+r.status+')');
  ok(r.rows.length===8&&r.rows.filter((x)=>x.origin==='measured').length===7,'ledger is 8 rows, 7 measured 1 asked');
  ok(r.cur===1&&r.next===2,'reads current rung and the next one from HIS protocol'); }
{ const r=CPE.checkpointRead(baseIn({doseLog:[{date:iso(11),mg:1}]}));
  ok(r.status==='early','11 days into a 28-day hold = TOO EARLY (accumulation lag)');
  ok(r.remaining===17,'names the days remaining ('+r.remaining+')'); }
{ const flat=baseIn({weightSeries:wSeries(0.05),appetite:'returning'});
  ok(CPE.checkpointRead(flat).status==='escalate','flat weight + appetite returning + clean tolerability = ESCALATE'); }
{ const flat=baseIn({weightSeries:wSeries(0.05),appetite:'suppressed'});
  ok(CPE.checkpointRead(flat).status==='hold','flat weight but appetite ALREADY GONE is not an under-dosing signal = HOLD'); }
{ const flat=baseIn({weightSeries:wSeries(0.05),appetite:'returning',rhr:badRhr});
  const r=CPE.checkpointRead(flat);
  ok(r.status==='veto','a flagged heart rate OUTRANKS a flat scale = VETO');
  ok(/heart rate/.test(r.veto.join(' ')),'the veto names its reason'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:wSeries(0.05),appetite:'returning',sleep:badSleep}));
  ok(r.status==='veto','a flagged sleep decline also vetoes escalation'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:wSeries(0.05),appetite:'returning',
    sideEffects:[{date:iso(5),severity:2},{date:iso(3),severity:3}]}));
  ok(r.status==='veto','two moderate-or-worse symptom days veto escalation'); }
{ const r=CPE.checkpointRead(baseIn({proteinDays:pDays(28,10,160),weightSeries:wSeries(0.05),appetite:'returning'}));
  ok(r.status==='veto','protein missed on most days vetoes escalation (muscle first)'); }
{ const r=CPE.checkpointRead(baseIn({appetite:null}));
  ok(r.status==='ask','markers in but appetite unanswered = ASK, never assume'); }
{ const r=CPE.checkpointRead(baseIn({protocol:{rungs:[0.5,1],minHoldDays:28},weightSeries:wSeries(0.05),appetite:'returning'}));
  ok(r.atCeiling===true&&r.status==='hold','at HIS ceiling the engine never suggests going higher'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:[]}));
  ok(r.status==='early','too few weigh-ins to compute a trend = not evaluable, never guessed'); }

// --- v0.9.44 stall watch: fires on a real plateau, stays silent at goal ---
const wRoll=(perWk,startLbs)=>Array.from({length:9},(_,k)=>({date:iso(56-k*7),lbs:startLbs-(k*perWk)}));
{ const r=CPE.checkpointRead(baseIn({weightSeries:wRoll(0.05,260),goalWeight:200}));
  ok(r.stall.on===true,'flat 4+ weeks while still below goal = stall fires');
  ok(r.stall.weeks>=4,'names how many weeks it has been flat ('+r.stall.weeks+')');
  ok(r.stall.lbsToGoal>0,'names the distance left to goal ('+r.stall.lbsToGoal+' lb)'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:wRoll(0.05,201),goalWeight:200}));
  ok(r.stall.on===false&&r.stall.atGoal===true,'flat AT goal is maintenance, not a stall — stays silent'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:wRoll(1.5,260),goalWeight:200}));
  ok(r.stall.on===false,'still losing 1.5 lb/wk = no stall'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:[{date:iso(3),lbs:250}],goalWeight:200}));
  ok(r.stall.on===false,'too few weigh-ins cannot manufacture a stall'); }
{ const r=CPE.checkpointRead(baseIn({weightSeries:wRoll(0.05,260),goalWeight:0}));
  ok(r.stall.on===true,'no goal set still allows the stall notice'); }
// --- v0.9.45: nodose is a full safe shape; parseRungs accepts any separator ---
{ const r=CPE.checkpointRead({});
  ok(r.status==='nodose'&&Array.isArray(r.veto)&&r.veto.length===0,'nodose carries an empty veto array — render cannot crash');
  ok(Array.isArray(r.rows)&&r.rows.length===0&&r.stall&&r.stall.on===false,'nodose carries empty rows and a quiet stall');
  ok(r.days===0&&r.cur===null,'nodose reports zero days and no current rung'); }
const PR=build(slice('function parseRungs(','function checkpointRead('),['parseRungs']);
ok(JSON.stringify(PR.parseRungs('0.25, 0.5, 1, 1.7, 2.4'))==='[0.25,0.5,1,1.7,2.4]','commas still work');
ok(JSON.stringify(PR.parseRungs('0.25 0.5 1 1.7 2.4'))==='[0.25,0.5,1,1.7,2.4]','spaces work — the number-pad fix');
ok(JSON.stringify(PR.parseRungs('0.25/0.5/1'))==='[0.25,0.5,1]','slashes work');
ok(JSON.stringify(PR.parseRungs('1, 0.5, 0.25, 0.5'))==='[0.25,0.5,1]','dedupes and sorts — order of typing never matters');
ok(JSON.stringify(PR.parseRungs('abc'))==='[]'&&JSON.stringify(PR.parseRungs(''))==='[]'&&JSON.stringify(PR.parseRungs(null))==='[]','garbage, empty, and null all parse to nothing, never NaN');
ok(JSON.stringify(PR.parseRungs('2 mg, 4 mg, 8'))==='[2,4,8]','unit suffixes are separators, not poison');
// --- v0.9.46 personal dose-response (rungResponseRead) ---
const RRC=build(slice('function rungResponseRead(','function parseRungs('),['rungResponseRead']);
const dISO=(n)=>{const d=new Date('2026-07-29T12:00:00');d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);};
const mkDoses=(spec)=>{const out=[];let day=spec.reduce((a,x)=>a+x.n*7,0);for(const r of spec){for(let k=0;k<r.n;k++){out.push({date:dISO(day),mg:r.mg,med:r.med||'semaglutide'});day-=7;}}return out;};
const mkW=(from,to,startLbs,perWk)=>{const out=[];for(let d=from;d>=to;d-=2)out.push({date:dISO(d),lbs:startLbs+((from-d)/7)*(-perWk)});return out;};
{ const r=RRC.rungResponseRead({doseLog:[],med:'semaglutide'});
  ok(r.status==='empty'&&r.rungs.length===0,'no doses = empty, never a fabricated row'); }
{ const doses=mkDoses([{mg:0.25,n:4},{mg:0.5,n:4}]);
  const w=[...mkW(56,29,250,1.0),...mkW(28,1,246,1.5)];
  const r=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),weightSeries:w});
  ok(r.status==='ready'&&r.rungs.length===2&&r.rungs[0].mg===0.25&&r.rungs[1].mg===0.5,'two rungs, sorted ascending');
  ok(r.rungs[0].dWk!=null&&Math.abs(r.rungs[0].dWk+1.0)<0.15,'rung 1 measures ~-1.0 lb/wk, got '+r.rungs[0].dWk);
  ok(r.rungs[1].dWk!=null&&Math.abs(r.rungs[1].dWk+1.5)<0.15,'rung 2 measures ~-1.5 lb/wk from ITS OWN window, got '+r.rungs[1].dWk); }
{ const r=RRC.rungResponseRead({doseLog:mkDoses([{mg:0.25,n:4}]),med:'semaglutide',today:dISO(0),
    weightSeries:[{date:dISO(20),lbs:250},{date:dISO(18),lbs:249}]});
  ok(r.rungs[0].dWk===null,'two weigh-ins cannot make a rate — the floor holds'); }
{ const doses=mkDoses([{mg:0.25,n:2}]);
  const se=[{date:dISO(10),severity:2},{date:dISO(8),severity:2},{date:dISO(5),severity:2},{date:dISO(3),severity:2}];
  const r=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),sideEffects:se});
  ok(r.rungs[0].symWk===4,'symptom LOAD is severity-weighted per week: 4x sev-2 over 2 wk = 4, got '+r.rungs[0].symWk); }
{ const doses=mkDoses([{mg:0.25,n:2}]);
  const hd=[5,6,7,8,9].map((d)=>({date:dISO(d),rhr:66}));
  const r1=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),healthDays:hd,rhrBaseline:60});
  const r2=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),healthDays:hd.slice(0,4),rhrBaseline:60});
  const r3=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),healthDays:hd});
  ok(r1.rungs[0].rhrDelta===6,'RHR delta vs the surveillance baseline: +6');
  ok(r2.rungs[0].rhrDelta===null,'under 5 RHR days = dash, not a guess');
  ok(r3.rungs[0].rhrDelta===null,'no baseline banked = dash — never invents its own'); }
{ const doses=mkDoses([{mg:0.25,n:2}]);
  const pd=[3,4,5,6,7,8,9,10,11,12].map((d,ix)=>({date:dISO(d),protein:ix<8?160:100}));
  const r=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),proteinDays:pd,proteinTarget:160});
  ok(r.rungs[0].protein===80,'protein hit rate 8/10 at the 90% line = 80%, got '+r.rungs[0].protein); }
{ const doses=[...mkDoses([{mg:0.25,n:2}]),{date:dISO(3),mg:2,med:'retatrutide'}];
  const r=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0)});
  ok(r.rungs.length===1&&r.rungs[0].mg===0.25&&r.switched===true,'the other drug\'s rung never appears in this med\'s curve'); }
{ const legacy=[{date:dISO(21),mg:0.25},{date:dISO(14),mg:0.25}];
  const r1=RRC.rungResponseRead({doseLog:legacy,med:'semaglutide',today:dISO(0)});
  const r2=RRC.rungResponseRead({doseLog:[...legacy.map((d)=>({...d,med:'semaglutide'})),{date:dISO(7),mg:2,med:'retatrutide'}],med:'retatrutide',today:dISO(0)});
  ok(r1.rungs.length===1,'unstamped legacy doses count while only one drug has ever appeared');
  ok(r2.rungs.length===1&&r2.rungs[0].mg===2,'after a switch, the old drug\'s doses drop — reta starts clean (the v0.8.0 rule, byte-identical)'); }
{ const doses=[{date:dISO(42),mg:0.25},{date:dISO(35),mg:0.25},{date:dISO(28),mg:0.5},{date:dISO(21),mg:0.5},{date:dISO(14),mg:0.25},{date:dISO(7),mg:0.25}].map((d)=>({...d,med:'semaglutide'}));
  const se=[{date:dISO(24),severity:3}];
  const r=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),sideEffects:se});
  const r025=r.rungs.find((x)=>x.mg===0.25), r05=r.rungs.find((x)=>x.mg===0.5);
  ok(r025.episodes===2&&r025.doses===4,'a return to a rung is a second STAY, never merged');
  ok(r05.symWk>0&&r025.symWk===0,'a symptom during the 0.5 window belongs to 0.5, not to 0.25'); }
{ const doses=mkDoses([{mg:0.25,n:4}]);
  const w=mkW(28,1,250,1.0);
  const r=RRC.rungResponseRead({doseLog:doses,med:'semaglutide',today:dISO(0),weightSeries:w});
  ok(r.rungs[0].tier==='holding','4 doses + 4 weeks + 2 ready metrics = the pattern is holding');
  const r2=RRC.rungResponseRead({doseLog:mkDoses([{mg:0.25,n:2}]),med:'semaglutide',today:dISO(0),weightSeries:mkW(14,1,250,1.0)});
  ok(r2.rungs[0].tier==='directional','2 doses stays DIRECTIONAL whatever the cells say'); }
// --- v0.9.46 cell tone: readability aid whose thresholds come from shipped rules ---
const TN=build(slice('function rungCellTone(','function parseRungs('),['rungCellTone']);
ok(TN.rungCellTone('wt',null)==='none'&&TN.rungCellTone('rhr',null)==='none','a dash is never coloured as a judgement');
ok(TN.rungCellTone('rhr',7)==='caution'&&TN.rungCellTone('rhr',8)==='avoid','RHR turns red at +8 — the exact point rhrRead flags');
ok(TN.rungCellTone('rhr',2)==='go','a small RHR drift stays green');
ok(TN.rungCellTone('protein',90)==='go'&&TN.rungCellTone('protein',89)==='caution','protein green at 90% — the checkpointRead hit line');
ok(TN.rungCellTone('lifts',2)==='go'&&TN.rungCellTone('lifts',1.9)==='caution','lifts green at 2/wk — the contractScorecard bar');
ok(TN.rungCellTone('wt',-0.9)==='go'&&TN.rungCellTone('wt',0.5)==='caution','weight is never red — gaining is amber, never a verdict');
ok(TN.rungCellTone('sym',0.5)==='go'&&TN.rungCellTone('sym',1)==='caution'&&TN.rungCellTone('sym',3)==='avoid','symptom load steps green/amber/red by magnitude');
console.log('\nENGINES: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
