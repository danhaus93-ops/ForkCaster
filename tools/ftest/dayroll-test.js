const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs'); const SRC=fs.readFileSync(__FCROOT+'/src/App.jsx','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
// extract dayKeyAt and prove the roll boundaries the reset depends on
const m=SRC.slice(SRC.indexOf('function dayKeyAt'),SRC.indexOf('function dayISOAt'));
const dayKeyAt=new Function('now','prefsLike',m.replace(/^function dayKeyAt\([^)]*\)\s*\{/,'').replace(/\}\s*$/,''));
const at=(iso)=>new Date(iso).getTime();
// days mode, 4am rollover: 3:59am belongs to yesterday, 4:01am to today
ok(dayKeyAt(at('2026-08-01T03:59:00'),{shiftMode:'days',rolloverHour:4})==='2026-07-31','days: 3:59am counts to Jul 31');
ok(dayKeyAt(at('2026-08-01T04:01:00'),{shiftMode:'days',rolloverHour:4})==='2026-08-01','days: 4:01am counts to Aug 1');
// nights mode, 11am roll: 6:33am still yesterday, 11:01am today
ok(dayKeyAt(at('2026-08-01T06:33:00'),{shiftMode:'nights'})==='2026-07-31','nights: 6:33am counts to Jul 31');
ok(dayKeyAt(at('2026-08-01T11:01:00'),{shiftMode:'nights'})==='2026-08-01','nights: 11:01am counts to Aug 1');
// the watcher must exist and must zero every counter field
ok(/const eatenDayRef = useRef/.test(SRC),'eatenDayRef exists');
ok(/const rollDayIfNeeded = \(\) => \{/.test(SRC),'rollDayIfNeeded exists');
ok(/setInterval\(rollDayIfNeeded, 60000\)/.test(SRC),'minute tick wired');
ok(/rollDayIfNeeded\(\);/.test(SRC.slice(SRC.indexOf('setFgTick((t) => t + 1)'))),'resume path calls it');
const body=SRC.slice(SRC.indexOf('const rollDayIfNeeded'),SRC.indexOf('const rollDayIfNeeded')+1200);
for(const f of ['protein','calories','carbs','fat','waterOz','fiber','steps','exerciseCal'])
  ok(new RegExp(f+':\\s*0').test(body),'roll zeroes '+f);
ok(/if \(!eatenDayRef\.current\)/.test(body),'first run seeds the ref instead of wiping');
// v0.9.92: the Now tab must state which day the counters belong to — an invisible
// night-day roll is indistinguishable from a broken reset, which is what he hit.
ok(/counts toward/.test(SRC),'Now states which day the counters belong to');
ok(/Night day/.test(SRC),'night days are named as such');
ok(/resets \$\{h12\(rollAt\)\}|resets \{h12\(rollAt\)\}/.test(SRC),'the roll hour is shown');
ok(!/setSettingsTab/.test(SRC),'no handler that does not exist');


// v0.9.94: THE WELD. The save stamped eatenDate with "now", so an autosave after midnight
// wrote today's date onto yesterday's totals and the load check matched forever.
const LOAD=SRC.slice(SRC.indexOf('if (s.eaten) { const k0'), SRC.indexOf('if (s.allergies) setAllergies'));
ok(!/eatenDate: dayKeyAt\(Date\.now\(\), prefs\)/.test(SRC),'save no longer stamps eatenDate with now');
ok(/eatenDate: eatenDayRef\.current/.test(SRC),'save writes the tracked day');
ok(/eatenAt: eatenAtRef\.current/.test(SRC),'save records when the counters last changed');
ok(/dayKeyAt\(new Date\(s\.eatenAt\)\.getTime\(\), roll\) !== k0/.test(LOAD),'load trusts the instant over the stamp');
ok(/mlog\.some\(\(m\) => m\.date === k0\)/.test(LOAD),'legacy heal looks for a meal logged today');
ok(/mlog\.some\(\(m\) => m\.date && m\.date < k0\)/.test(LOAD),'legacy heal requires evidence of an earlier day');
ok(/someEaten/.test(LOAD),'legacy heal only fires when totals are non-zero');
// simulate the three states the load must distinguish
const sim=(st,k0)=>{
  const ZERO={protein:0,calories:0,carbs:0,fat:0,waterOz:0,fiber:0,steps:0,exerciseCal:0};
  const someEaten=Object.keys(ZERO).some(f=>+(st.eaten[f]||0)>0);
  let stale;
  if(st.eatenAt){ stale = st.eatenAtDay !== k0; }
  else if(someEaten){ const m=st.mealLog||[]; stale=!m.some(x=>x.date===k0)&&m.some(x=>x.date&&x.date<k0); }
  else stale = st.eatenDate!==k0;
  return stale;
};
ok(sim({eaten:{protein:163},eatenAt:'x',eatenAtDay:'2026-07-31',eatenDate:'2026-08-01'},'2026-08-01')===true,
   'welded state with an instant is detected stale');
ok(sim({eaten:{protein:163},eatenDate:'2026-08-01',mealLog:[{date:'2026-07-31'}]},'2026-08-01')===true,
   'welded LEGACY state (his node) is healed');
ok(sim({eaten:{protein:40},eatenDate:'2026-08-01',mealLog:[{date:'2026-08-01'}]},'2026-08-01')===false,
   'a real meal logged today is never wiped');
ok(sim({eaten:{protein:40},eatenAt:'x',eatenAtDay:'2026-08-01',eatenDate:'2026-08-01'},'2026-08-01')===false,
   'same-day hand entry survives once the instant exists');


// v0.9.193: a key change is not proof a day ended.
{
  const body2=SRC.slice(SRC.indexOf('const rollDayIfNeeded'), SRC.indexOf('const rollDayIfNeeded')+1200);
  ok(/if \(k < eatenDayRef\.current\) \{ eatenDayRef\.current = k; return; \}/.test(body2),
     'the watcher only clears when the clock moved FORWARD past the tracked day');
  // prefs load in two steps, so the key also moves when settings arrive — that renamed his day and
  // wiped 117g of logged protein at 19:38 on a day that had not ended
  ok(/prefs arrive after the first render/.test(body2),'and the reason is written where the next person will read it');
}
// and the counters can be rebuilt from the log, because the log is the record
ok(/const _mealsToday = \(s\.mealLog \|\| \[\]\)\.filter/.test(SRC),'load rebuilds the day from the meal log');
ok(/const _short = _mealsToday\.length > 0 && \(\+_base\.protein \|\| 0\) < _fromLog\.protein;/.test(SRC),
   'when the counter holds less than the log for that day, the log wins');
ok(/setEaten\(_short \? \{ \.\.\._base, \.\.\._fromLog \} : _base\)/.test(SRC),
   'and water, steps and exercise survive, since they are not on a meal');

console.log('\nDAYROLL: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
