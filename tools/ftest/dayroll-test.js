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
const body=SRC.slice(SRC.indexOf('const rollDayIfNeeded'),SRC.indexOf('const rollDayIfNeeded')+700);
for(const f of ['protein','calories','carbs','fat','waterOz','fiber','steps','exerciseCal'])
  ok(new RegExp(f+':\\s*0').test(body),'roll zeroes '+f);
ok(/if \(!eatenDayRef\.current\)/.test(body),'first run seeds the ref instead of wiping');
// v0.9.92: the Now tab must state which day the counters belong to — an invisible
// night-day roll is indistinguishable from a broken reset, which is what he hit.
ok(/counts toward/.test(SRC),'Now states which day the counters belong to');
ok(/Night day/.test(SRC),'night days are named as such');
ok(/resets \$\{h12\(rollAt\)\}|resets \{h12\(rollAt\)\}/.test(SRC),'the roll hour is shown');
ok(!/setSettingsTab/.test(SRC),'no handler that does not exist');

console.log('\nDAYROLL: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
