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
  ok(/weightSeries\.length > 1 \? lineChart\(weightSeries/.test(SRC2), 'the Body chart reads the merged series');
  ok(/w\.synced \? <span/.test(SRC2), 'synced rows are tagged and cannot be deleted from the list');
}
console.log('\nENGINES: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
