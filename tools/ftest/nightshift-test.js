const __FCROOT = require("path").resolve(__dirname, "..", "..");
// The one clock: dayKeyAt drives todayISO and every date stamp. These tests inject fixed
// clocks — the UTC bug this replaced (day rolling at 7 PM Central) must stay dead.
const fs = require('fs');
const { slice, build } = require('./lib.js');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const SRC = fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
const M = build(slice('function dayKeyAt(','let _dayPrefs'), ['dayKeyAt']);
const at = (y,mo,d,h) => new Date(y,mo-1,d,h,30); // LOCAL times

// days mode: local midnight boundary, not UTC
ok(M.dayKeyAt(at(2026,7,26,23), {})==='2026-07-26','11 PM local still belongs to the 26th (UTC would say 27th)');
ok(M.dayKeyAt(at(2026,7,26,0), {})==='2026-07-26','midnight starts the new local day');
ok(M.dayKeyAt(at(2026,7,27,3), { rolloverHour: 4 })==='2026-07-26','rolloverHour 4: 3 AM still yesterday');
ok(M.dayKeyAt(at(2026,7,27,5), { rolloverHour: 4 })==='2026-07-27','rolloverHour 4: 5 AM is today');

// nights (fixed): previous date owns the morning until nightRollHour, EVERY day
const N = { shiftMode: 'nights' };
ok(M.dayKeyAt(at(2026,7,27,3), N)==='2026-07-26','nights: 3 AM belongs to the shift that started the 26th');
ok(M.dayKeyAt(at(2026,7,27,10), N)==='2026-07-26','nights: 10 AM still the 26th (default roll 11)');
ok(M.dayKeyAt(at(2026,7,27,12), N)==='2026-07-27','nights: noon starts the new day');
ok(M.dayKeyAt(at(2026,7,27,9,), { shiftMode:'nights', nightRollHour: 9 })==='2026-07-27','custom roll hour respected');

// varies: shifted ONLY when the previous date is a marked work night
const V = { shiftMode: 'varies', workNights: ['2026-07-26'] };
ok(M.dayKeyAt(at(2026,7,27,3), V)==='2026-07-26','varies: 3 AM after a MARKED night counts to the shift day');
ok(M.dayKeyAt(at(2026,7,28,3), V)==='2026-07-28','varies: 3 AM after an UNMARKED night is a normal day');
ok(M.dayKeyAt(at(2026,7,27,13), V)==='2026-07-27','varies: past the roll hour the new day starts even on a marked run');
ok(M.dayKeyAt(at(2026,7,26,22), V)==='2026-07-26','varies: evening of the marked night itself is unaffected');

// wiring: todayISO delegates, the bridge exists, and the old UTC boundary is gone
ok(/const todayISO = \(\) => dayKeyAt\(Date\.now\(\), _dayPrefs\)/.test(SRC),'todayISO delegates to the one clock');
ok(/useEffect\(\(\) => \{ setDayPrefs\(prefs\); \}, \[prefs\]\)/.test(SRC),'component keeps the bridge current');
ok(!/const todayISO = \(\) => new Date\(\)\.toISOString/.test(SRC),'the UTC day boundary is dead');
ok(/eatenDate: dayKeyAt\(Date\.now\(\), prefs\)/.test(SRC),'eaten reset stamps through the one clock');
ok(!/dayISOAt\(prefs\.rolloverHour\)/.test(SRC),'no consumer bypasses the clock with the old helper');

// prefs fields exist with safe defaults; doses stay calendar-anchored
ok(/shiftMode: "days"/.test(SRC) && /workNights: \[\]/.test(SRC) && /nightRollHour: 11/.test(SRC),'defaults ship for all three fields');
ok(/Doses and the PK chart stay calendar-anchored/.test(SRC),'the medical-record boundary is documented in the code');

// schedule steering: nights and the recovery day join the easing set
ok(/d\.dose \|\| d\.after \|\| d\.night \|\| d\.postNights/.test(SRC),'scheduleWeek eases night + recovery days');
ok(/Post-nights recovery — sleep first/.test(SRC),'recovery day carries its own words');
ok(/Work night — if you train, make it before shift/.test(SRC),'work night carries its own words');
ok(/NIGHT DAY · counts toward/.test(SRC),'the Today header shows which day the moment counts toward');
ok(/Tap the nights you work/.test(SRC),'the rotating tap strip exists');
ok(/\[\"nights\", \"Nights — fixed\"\], \[\"varies\", \"Nights — rotating\"\]/.test(SRC),'the three-mode selector exists');

// timezone honesty: no week-strip or lookback may build its label in UTC
ok(!/const iso = t\.toISOString\(\)\.slice\(0, 10\)/.test(SRC),'Train week strip labels are local');
ok(!/const iso2 = dt\.toISOString\(\)\.slice\(0, 10\)/.test(SRC),'Today week strip labels are local');
ok((SRC.match(/toLocaleDateString\("sv-SE"\)/g)||[]).length>=8,'local date construction is the convention');

console.log('\nNIGHTSHIFT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
