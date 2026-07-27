const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const {slice,build}=require('./lib.js');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
const SRV=fs.readFileSync(__FCROOT + '/server/server.js','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
// parseBodyScan falls back to todayISO(), which is module-level at the top of App.jsx — pull it in
const M=build('const todayISO = () => new Date().toISOString().slice(0, 10);\n'+slice('const BODYSCAN_RANGES =','const SIXPACK = {'),['parseBodyScan','BODYSCAN_RANGES','BODYSCAN_SCHEMA','BODYSCAN_ALIASES']);

// HIS REAL REPORT as the fixture
const REAL={date:'2026-07-26',weightLbs:216.9,bodyFatPct:37.4,leanMassLbs:135.8,muscleMassLbs:126.8,
  bodyWaterLbs:99.6,skeletalMuscleLbs:77.2,visceralFat:16,subcutaneousFatPct:26.6,
  segmental:{fat:{leftArm:5.5,rightArm:5.5,trunk:43.2,leftLeg:11.7,rightLeg:11.7},
             muscle:{leftArm:7.7,rightArm:7.7,trunk:59.1,leftLeg:22.3,rightLeg:22.3}}};
const r=M.parseBodyScan(REAL);
ok(r.ok,'his real report parses');
ok(!r.warning,'his real report raises no arithmetic warning: '+r.warning);
ok(r.rejected.length===0,'nothing rejected: '+r.rejected.join(','));
for(const k of ['date','weightLbs','bodyFatPct','leanMassLbs','muscleMassLbs','bodyWaterLbs','skeletalMuscleLbs','visceralFat','subcutaneousFatPct'])
  ok(r.values[k]!=null,k+' captured');
ok(r.values.segmental.fat.trunk===43.2&&r.values.segmental.muscle.trunk===59.1,'segmental captured');

// --- the failure modes vision actually has ---
ok(M.parseBodyScan({...REAL,leanMassLbs:1358}).rejected.includes('leanMassLbs'),'a shifted decimal is range-rejected');
ok(!!M.parseBodyScan({...REAL,bodyFatPct:3.74}).warning,'a shifted decimal INSIDE range is caught by arithmetic');
ok(!!M.parseBodyScan({...REAL,leanMassLbs:180}).warning,'lean that contradicts weight x body fat warns');
ok(!M.parseBodyScan({...REAL,leanMassLbs:138}).warning,'a small honest discrepancy does not nag');
ok(M.parseBodyScan({date:'2026-07-26',bodyFatPct:37.4}).ok,'body fat alone is usable');
ok(M.parseBodyScan({date:'2026-07-26',leanMassLbs:135.8}).ok,'lean alone is usable');
ok(!M.parseBodyScan({date:'2026-07-26',visceralFat:16}).ok,'visceral fat alone is NOT enough to save');
ok(M.parseBodyScan({}).values.dateAssumed===true,'a missing date falls back to today rather than blocking the save');
ok(M.parseBodyScan(null).ok===false,'null input is handled');
ok(M.parseBodyScan({date:'not-a-date',bodyFatPct:37}).values.dateAssumed===true,'an unparseable date falls back to today and is flagged, not rejected');
ok(/^\d{4}-\d{2}-\d{2}$/.test(M.parseBodyScan({date:'not-a-date',bodyFatPct:37}).values.date),'the fallback is always a date the server accepts');
// every range is enforced in BOTH directions
for(const [k,[lo,hi]] of Object.entries(M.BODYSCAN_RANGES)){
  ok(M.parseBodyScan({date:'2026-07-26',[k]:lo-1}).rejected.includes(k),k+' below range rejected');
  ok(M.parseBodyScan({date:'2026-07-26',[k]:hi+1}).rejected.includes(k),k+' above range rejected');
}

// --- discipline: the model proposes, it never saves ---
ok(/setBodyScan\(parsed\)/.test(SRC),'a parsed scan lands in state, not in the store');
ok(/onClick=\{saveBodyScan\}/.test(SRC),'saving requires an explicit tap');
ok(/Check these before saving/.test(SRC),'the confirmation card exists');
const reader=SRC.slice(SRC.indexOf('async function scanBodyReport'),SRC.indexOf('async function saveBodyScan'));
ok(!/api\/health\/manual/.test(reader),'the READ path never writes to the health store');
ok(/parseBodyScan\(raw\)/.test(reader),'model output always goes through parseBodyScan');
ok(/salvageJSONObject\(text\)/.test(reader),'malformed model output is salvaged, not trusted');
ok(/never estimate, never infer/i.test(SRC),'the system prompt forbids inventing numbers');

// --- server endpoint mirrors the client ranges and refuses junk ---
const ep=SRV.slice(SRV.indexOf('app.post("/api/health/manual"'),SRV.indexOf('app.delete("/api/health/data"'));
ok(/need a YYYY-MM-DD date/.test(ep),'server requires a valid date');
ok(/nothing usable in that payload/.test(ep),'server refuses an empty payload');
ok(/source = "scan"/.test(ep),'scan-sourced days are tagged');
for(const k of Object.keys(M.BODYSCAN_RANGES)) ok(ep.includes(k),'server validates '+k);
ok(/h\.days\[d\] = \{ \.\.\.h\.days\[d\], \.\.\.clean \}/.test(ep),'merges into the day the sync already writes, so the engines pick it up unchanged');

// --- HIS LIVE FAILURE: the report plainly had the numbers and the parser reported none ---
// Cause: it accepted only exact schema keys holding bare numbers, but the prompt asks the model to
// transcribe what is PRINTED, so it answers with the report's own labels and the printed units.
const SHAPES = {
  'printed strings':      {date:'2026-07-26',weightLbs:'216.9',bodyFatPct:'37.4%',leanMassLbs:'135.8lb'},
  'units with a space':   {date:'2026-07-26',bodyFatPct:'37.4 %',leanMassLbs:'135.8 lb',muscleMassLbs:'126.8lb'},
  'report-style date':    {date:'Jul 26, 2026',bodyFatPct:37.4,leanMassLbs:135.8},
  'testing time verbatim':{testingTime:'8:43 am, Jul 26, 2026',bodyFat:'37.4%',leanBodyMass:'135.8lb'},
  'grouped like the page':{date:'2026-07-26',otherMetrics:{bodyFat:37.4,leanBodyMass:135.8,muscleMass:126.8,visceralFat:16}},
  'the labels ON the report':{date:'2026-07-26','Body Fat':'37.4%','Lean Body Mass':'135.8lb','Muscle Mass':'126.8lb','Visceral Fat':16},
  'fraction not percent': {date:'2026-07-26',bodyFatPct:0.374,leanMassLbs:135.8},
  'exact schema':         {date:'2026-07-26',bodyFatPct:37.4,leanMassLbs:135.8},
  'thousands separator':  {date:'2026-07-26',bodyFatPct:37.4,leanMassLbs:'135.8',bodyWaterLbs:'99.6'},
};
for(const [label,shape] of Object.entries(SHAPES)){
  const p=M.parseBodyScan(shape);
  ok(p.ok,label+' must parse: '+JSON.stringify(p.values));
  ok(p.values.date==='2026-07-26',label+' must resolve the date, got '+p.values.date);
  ok(p.values.bodyFatPct===37.4,label+' must read body fat 37.4, got '+p.values.bodyFatPct);
  ok(p.values.leanMassLbs===135.8,label+' must read lean 135.8, got '+p.values.leanMassLbs);
}
// a genuine miss still fails, and says what it saw
const miss=M.parseBodyScan({date:'2026-07-26',calories:{jogging:344}});
ok(!miss.ok,'a page with no composition data still fails');
ok(Array.isArray(miss.sawKeys)&&miss.sawKeys.length>0,'a miss reports the keys it read back');
ok(/Read back:/.test(SRC),'the UI surfaces those keys instead of a bare not-found');
// aliases must not swallow the wrong field
ok(M.parseBodyScan({date:'2026-07-26',bodyFat:37.4,visceralFat:16}).values.visceralFat===16,'visceral fat is not eaten by the body-fat alias');
ok(M.parseBodyScan({date:'2026-07-26',muscleMass:126.8,skeletalMuscle:77.2,leanBodyMass:135.8}).values.skeletalMuscleLbs===77.2,'skeletal muscle stays distinct from muscle mass');
// and the arithmetic guard still fires through the alias path
ok(!!M.parseBodyScan({date:'2026-07-26','Weight':'216.9lb','Body Fat':'3.74%','Lean Body Mass':'135.8lb'}).warning,'the cross-check still fires on aliased, unit-suffixed input');

// --- HIS SECOND LIVE FAILURE: values read fine, but the save was blocked on the date ---
// The date went through RAW key names while every number went through the normalised map, so a
// model answering with "Testing time" was missed entirely.
const DATES = {
  'Testing time label':  {'Testing time':'8:43 am, Jul 26, 2026','Body Fat':'37.4%','Weight':'216.9lb'},
  'testingTime camel':   {testingTime:'8:43 am, Jul 26, 2026',bodyFatPct:37.4,weightLbs:216.9},
  'testing_time snake':  {testing_time:'Jul 26, 2026',bodyFatPct:37.4,weightLbs:216.9},
  'buried in a line':    {reportHeader:'Testing time:8:43 am, Jul 26, 2026',bodyFatPct:37.4,weightLbs:216.9},
  'his live result':     {'Testing time':'8:43 am, Jul 26, 2026',weightLbs:216.9,bodyFatPct:37.4,muscleMassLbs:126.8,visceralFat:16},
};
for(const [label,shape] of Object.entries(DATES)){
  const p=M.parseBodyScan(shape);
  ok(p.values.date==='2026-07-26',label+' must resolve the report date, got '+p.values.date);
  ok(!p.values.dateAssumed,label+' must NOT fall back to today');
  ok(!p.rejected.includes('date'),label+' must not reject the date');
}
// an unreadable date must never block a save — it assumes today and SAYS so
const nod=M.parseBodyScan({bodyFatPct:37.4,weightLbs:216.9});
ok(nod.ok,'a missing date does not make the scan unusable');
ok(nod.values.dateAssumed===true,'a missing date is flagged as assumed');
ok(/^\d{4}-\d{2}-\d{2}$/.test(nod.values.date),'the assumed date is still a valid YYYY-MM-DD the server will accept');
ok(/not read — using today/.test(SRC),'the card tells him the date was assumed');
// lean is derived when the scan reads weight and body fat but not lean — the identity the engine uses
const der=M.parseBodyScan({date:'2026-07-26',weightLbs:216.9,bodyFatPct:37.4});
ok(der.values.leanMassLbs===135.8,'lean derived as 135.8 from 216.9 @ 37.4%, got '+der.values.leanMassLbs);
ok(der.values.leanDerived===true,'derived lean is flagged');
ok(/from weight & body fat/.test(SRC),'the card says the lean figure was derived');
const meas=M.parseBodyScan({date:'2026-07-26',weightLbs:216.9,bodyFatPct:37.4,leanMassLbs:135.8});
ok(!meas.values.leanDerived,'a lean value that WAS read is not marked derived');
// the two UI flags must never be posted to the server
ok(/const \{ dateAssumed, leanDerived, \.\.\.payload \}/.test(SRC),'UI-only flags are stripped before the save POST');

console.log('\nBODYSCAN: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
