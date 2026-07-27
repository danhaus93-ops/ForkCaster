const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const {slice,build}=require('./lib.js');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const M=build(slice('const ISO_CORE =','const LEG_GROUPS ='),['isIsoCore','coreScheme','coreCircuit','prescription','buildRoutine']);
const cat=JSON.parse(fs.readFileSync(__FCROOT + '/server/exercises.json','utf8')).exercises;

// 1. classification — statics only, and dynamic variants of a static name stay reps
for(const n of ['Plank','Side Plank','Hollow Hold','L-Sit','Wall Sit','Isometric Wipers'])
  ok(M.isIsoCore(n), n+' should be a HOLD');
for(const n of ['Barbell Ab Rollout','Ab Wheel Rollout','Dead Bug','Bird Dog','Tuck Crunch','Hanging Leg Raise','Russian Twist','Air Bike','Plank Jacks','Plank Shoulder Taps','Plank Row'])
  ok(!M.isIsoCore(n), n+' should be REPS (it travels)');

// 2. EVERY core movement is timed — the whole point of the format
for(const n of ['Plank','Tuck Crunch','Flutter Kicks','Russian Twist','Hanging Leg Raise','Air Bike','Bent Knee Windshield Wipers','Scissor V Ups']){
  const sc=M.coreScheme(n);
  ok(sc.workLow!=null&&sc.workHigh!=null,n+' must be prescribed in SECONDS: '+JSON.stringify(sc));
  ok(sc.repLow==null&&sc.repHigh==null,n+' must NOT carry a rep range: '+JSON.stringify(sc));
  ok(sc.workLow>=20&&sc.workHigh<=70,n+' interval must sit in the 20-70s window, got '+sc.workLow+'-'+sc.workHigh);
  ok(sc.workLow<sc.workHigh,n+' band ascends');
  ok(sc.restSec>0&&sc.sets>0,n+' has sets and rest');
}
// statics get the longer ceiling, dynamic the shorter — band only, never reps
ok(M.coreScheme('Plank').workHigh===60,'a static can run to 60s');
ok(M.coreScheme('Tuck Crunch').workHigh===45,'dynamic tops out at 45s');
ok(M.coreScheme('Plank').hold===true&&M.coreScheme('Tuck Crunch').hold===false,'hold flag drives wording only');

// 3. circuit: rounds ARE the set count, so the banner can never contradict the exercise rows
ok(M.coreCircuit(3,2).rounds===2,'3 moves / 2 sets -> 2 rounds');
ok(M.coreCircuit(3,4).rounds===4,'rounds track sets');
ok(M.coreCircuit(2,2)===null,'fewer than 3 movements is not a circuit');
ok(M.coreCircuit(3,1)===null,'a single set is not a circuit');

// 4. the real routine
const r=M.buildRoutine(cat,{days:5,minutes:45,goal:'preserve'});
const coreDays=r.days_.filter(d=>d.exercises.some(x=>x.group==='core'));
ok(coreDays.length>=3,'at least 3 core days, got '+coreDays.length);
for(const d of coreDays){
  const core=d.exercises.filter(x=>x.group==='core');
  ok(core.length>=3,d.name+' has 3+ core movements, got '+core.length);
  ok(!!d.coreCircuit,d.name+' carries a circuit');
  ok(d.coreCircuit.rounds===Math.min(...core.map(x=>x.sets)),d.name+' rounds match the set count');
}
// THE BUG HE CAUGHT: not one core movement may carry reps
const coreInReps=r.days_.flatMap(d=>d.exercises).filter(e=>e.group==='core'&&e.repLow!=null);
ok(coreInReps.length===0,'NO core movement prescribed in reps: '+coreInReps.map(e=>e.name).join(', '));
const coreTimed=r.days_.flatMap(d=>d.exercises).filter(e=>e.group==='core');
ok(coreTimed.every(e=>e.workLow!=null),'every core movement carries a work interval');
// non-core lifts keep their goal scheme untouched
const lifts=r.days_.flatMap(d=>d.exercises).filter(e=>e.group!=='core');
ok(lifts.every(e=>e.repLow===6&&e.repHigh===10),'preserve-goal lifts still 6-10 reps');
ok(lifts.every(e=>e.workLow==null),'no non-core lift got a work interval');

// 5. the shared formatter — both views use it, so they cannot drift
ok(M.prescription({workLow:30,workHigh:60,hold:true})==='30\u201360s hold','formats a static: '+M.prescription({workLow:30,workHigh:60,hold:true}));
ok(M.prescription({workLow:30,workHigh:45})==='30\u201345s','formats a timed dynamic set without saying hold: '+M.prescription({workLow:30,workHigh:45}));
ok(M.prescription({holdLow:20,holdHigh:45}).includes('45s'),'v0.9.0 saved routines still render: '+M.prescription({holdLow:20,holdHigh:45}));
ok(M.prescription({repLow:10,repHigh:20}).includes('20 reps'),'pre-v0.9.0 saved routines still render as reps');
ok(M.prescription({}).includes('reps'),'a legacy saved exercise with neither field still renders as reps');
// the definition is `const prescription = (e) =>` so it does NOT match `prescription(` — count CALL sites
ok((SRC.match(/\{prescription\(/g)||[]).length>=2,'both render sites call the shared formatter, got '+(SRC.match(/\{prescription\(/g)||[]).length);
ok(!/\{e\.repLow\}–\{e\.repHigh\} reps/.test(SRC)&&!/\{x\.repLow\}–\{x\.repHigh\}/.test(SRC),'no render site hardcodes a rep range any more');

// --- progressionAdvice must not throw on ANY plan shape (the v0.9.0/v0.9.1 TDZ crash) ---
{
  // progressionAdvice leans on two module-level names declared elsewhere — pull them in with it
  const P=build(slice('const LOWER_GROUPS =','const CARDIO_TYPES =')+'\n'+slice('const est1RM =','function weeklySets('),['progressionAdvice']);
  const hist=[{sets:[{w:0,reps:0,secs:35}]},{sets:[{w:0,reps:0,secs:40}]}];
  const plans=[
    ['timed dynamic',{workLow:30,workHigh:45,hold:false}],
    ['timed static',{workLow:30,workHigh:60,hold:true}],
    ['v0.9.0 legacy hold',{holdLow:20,holdHigh:45}],
    ['classic reps',{repLow:6,repHigh:10,group:'chest'}],
    ['lower body reps',{repLow:6,repHigh:10,group:'quads'}],
    ['empty plan',{}],
    ['null plan',null],
  ];
  for(const [label,plan] of plans){
    for(const [hLabel,h] of [['with history',hist],['no history',[]],['null entries',null]]){
      let r=null,err=null;
      try{ r=P.progressionAdvice(h,plan); }catch(e){ err=e; }
      ok(!err,label+' / '+hLabel+' must not throw: '+(err&&err.message));
      ok(r&&typeof r.action==='string'&&typeof r.text==='string',label+' / '+hLabel+' returns an action and text');
    }
  }
  // and the timed branch actually advises on the clock
  const t=P.progressionAdvice(hist,{workLow:30,workHigh:45,hold:false});
  ok(/add-time|harder/.test(t.action),'timed plan with history advises on time, got '+t.action);
  ok(!/lb\b/.test(t.text),'timed advice must never mention pounds: '+t.text);
  const s0=P.progressionAdvice([],{workLow:30,workHigh:45,hold:true});
  ok(/Hold/.test(s0.text),'a static with no history says Hold: '+s0.text);
  const d0=P.progressionAdvice([],{workLow:30,workHigh:45,hold:false});
  ok(/Work/.test(d0.text),'a dynamic with no history says Work: '+d0.text);
  // reps path untouched
  const rp=P.progressionAdvice([{sets:[{w:135,reps:10,rir:1}]}],{repLow:6,repHigh:10,group:'chest'});
  ok(rp.action==='add-weight','classic rep progression still advises weight, got '+rp.action);
}

// --- the 6 Pack Promise escape hatch ---
{
  const S=build(slice('const SIXPACK = {','const coreCircuit ='),['SIXPACK','sixpackUrl','sixpackFallbackDelay']);
  // primary: the documented Shortcuts scheme, since the app registers no scheme of its own
  const u=S.sixpackUrl();
  ok(u.startsWith('shortcuts://run-shortcut?name='),'primary is the Shortcuts run-shortcut scheme: '+u);
  ok(u.includes(encodeURIComponent(S.SIXPACK.shortcut)),'carries the shortcut name, encoded');
  ok(S.SIXPACK.shortcut.length>0,'a shortcut name is configured');
  // a name with a space must survive encoding
  const enc=`shortcuts://run-shortcut?name=${encodeURIComponent('Ab Circuit')}`;
  ok(enc.includes('%20')&&!/ /.test(enc),'a spaced shortcut name encodes cleanly');
  // fallback: store, and only when the page did NOT get taken over
  ok(/apps\.apple\.com\/app\/id633815621$/.test(S.SIXPACK.store),'store fallback shape: '+S.SIXPACK.store);
  ok(S.SIXPACK.store.startsWith('https://'),'store fallback is https');
  ok(S.sixpackFallbackDelay(true)===0,'page already hidden -> app took over -> NO store bounce');
  ok(S.sixpackFallbackDelay(false)>0,'page still visible -> bounce to the store');
  ok(S.sixpackFallbackDelay(false)>=1000&&S.sixpackFallbackDelay(false)<=3000,'delay is a sane 1-3s, got '+S.sixpackFallbackDelay(false));
  // rendered on BOTH core headers, and the fallback is always armed with a cancel
  const anchors=(SRC.match(/href=\{sixpackUrl\(\)\}/g)||[]).length;
  ok(anchors===2,'link renders beside both CORE headers, got '+anchors);
  ok((SRC.match(/sixpackFallbackDelay\(document\.hidden\)/g)||[]).length===2,'both anchors arm the fallback');
  ok((SRC.match(/visibilitychange/g)||[]).length>=2&&(SRC.match(/pagehide/g)||[]).length>=2,'both cancel the fallback when the app takes over');
  ok(!/clearTimeout/.test(SRC)===false,'the fallback timer is cleared, not leaked');
  // the label must not have gone stale again
  ok(!/CORE · higher reps/.test(SRC),'the pre-v0.9.1 "higher reps" core label is gone');
  ok(/CORE · timed circuit/.test(SRC),'core label matches the timed prescription');
}

// --- HIS BUG REPORT: core twice on one day, missing entirely on 5- and 6-day splits ---
{
  for(const days of [3,4,5,6]){
    const r=M.buildRoutine(cat,{days,minutes:60,goal:'preserve'});
    const seen=new Set();
    for(const d of r.days_){
      const core=d.exercises.filter(e=>e.group==='core');
      ok(core.length===6,days+'-day '+d.name+' must carry 6 core movements, got '+core.length);
      // ONE contiguous block — a split block made the UI draw the CORE heading twice
      const flags=d.exercises.map(e=>e.group==='core'?'C':'.').join('');
      const runs=flags.split(/\.+/).filter(Boolean).length;
      ok(runs===1,days+'-day '+d.name+' core must be one block, got '+runs+' ('+flags+')');
      // core sits at the END, after the lifts
      ok(/^\.*C+$/.test(flags),days+'-day '+d.name+' core must come last: '+flags);
      core.forEach(e=>seen.add(e.name));
      // and every core item is timed, never reps
      ok(core.every(e=>e.workLow!=null&&e.repLow==null),days+'-day '+d.name+' core all timed');
    }
    ok(r.days_.every(d=>d.exercises.some(e=>e.group==='core')),days+'-day: EVERY day has core — min(3,days) left half a 6-day week with none');
    // 36 slots on a 6-day week from a 91-movement pool: a couple of repeats is the pattern-variety
// rule doing its job, not a bug. Assert NEAR-total variety, not perfection.
    ok(seen.size>=days*6-2,days+'-day: core stays varied across the week, '+seen.size+' distinct of '+(days*6));
  }
  // the cap that caused it must not come back
  ok(/const CORE_TARGET = days;/.test(SRC),'CORE_TARGET is days, not min(3, days)');
  ok(!/CORE_TARGET = Math\.min\(3, days\)/.test(SRC),'the 3-day cap is gone');
  ok(/const CORE_PER_DAY = 6;/.test(SRC),'six core movements per day');
  ok(/const groupCore = \(d\) =>/.test(SRC),'a pass groups core into one block');
  ok(/out\.forEach\(groupCore\)/.test(SRC),'grouping actually runs');
  ok(SRC.indexOf('out.forEach(groupCore)')<SRC.indexOf('out.forEach(attachCircuit)'),'core is grouped BEFORE the circuit is attached, or the round count is computed on a scattered block');
}

// --- HIS BUG: core doubled on one day, missing entirely on others ---
// (1) CORE_TARGET was min(3, days) so a 6-day split trained trunk on HALF its sessions;
// (2) the split's own group rotation could drop a core movement mid-list while addCore appended
//     more at the end, giving two runs of core and TWO "CORE" headings with a lift between them;
// (3) only 3 movements per block.
for (const days of [3, 4, 5, 6]) {
  const rt = M.buildRoutine(cat, { days, minutes: 45, goal: 'preserve' });
  const dl = rt.days_;
  ok(dl.length === days, days + '-day split builds ' + days + ' days, got ' + dl.length);
  for (const d of dl) {
    const core = d.exercises.filter((e) => e.group === 'core');
    ok(core.length === 6, days + '-day ' + d.name + ' must carry 6 core movements, got ' + core.length);
    // ONE contiguous block, and it must be LAST
    const flags = d.exercises.map((e) => e.group === 'core' ? 'C' : '.').join('');
    const runs = flags.split(/\.+/).filter(Boolean).length;
    ok(runs === 1, days + '-day ' + d.name + ' core must be one block, got ' + runs + ' (' + flags + ')');
    ok(/C+$/.test(flags), days + '-day ' + d.name + ' core must sit at the END: ' + flags);
    // no repeats inside a day
    ok(new Set(core.map((e) => e.name)).size === core.length, days + '-day ' + d.name + ' repeats a core movement');
    // every core movement is timed, never reps
    ok(core.every((e) => e.workLow != null && e.repLow == null), days + '-day ' + d.name + ' core must be timed');
  }
  // every training day, not a subset
  ok(dl.every((d) => d.exercises.some((e) => e.group === 'core')), days + '-day: EVERY day gets core');
  ok(dl.every((d) => d.coreCircuit), days + '-day: every core block carries a circuit');
  // weekly variety
  const all = dl.flatMap((d) => d.exercises.filter((e) => e.group === 'core').map((e) => e.name));
  ok(new Set(all).size >= all.length - 2, days + '-day: core stays varied across the week, ' + new Set(all).size + ' distinct of ' + all.length);
}
// the constants themselves, so a future edit cannot quietly re-cap them
ok(/const CORE_TARGET = days;/.test(SRC), 'CORE_TARGET is every training day, not min(3, days)');
ok(!/CORE_TARGET = Math\.min\(3, days\)/.test(SRC), 'the 3-day cap is gone');
ok(/const CORE_PER_DAY = 6;/.test(SRC), 'six core movements per block');
ok(/const groupCore = \(d\) =>/.test(SRC), 'a pass groups core into one contiguous block');
ok(/out\.forEach\(groupCore\);/.test(SRC), 'that pass actually runs');

console.log('\nTRAIN: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
