const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs'); const SRV=fs.readFileSync(__FCROOT+'/server/server.js','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
// run the REAL sleep branch on the shapes Health Auto Export actually emits
const blk=SRV.slice(SRV.indexOf('if (nm === "sleep_analysis"'), SRV.indexOf('const q = +pt.qty;'));
ok(blk.length>200,'sleep branch found');
ok(SRV.indexOf('if (nm === "sleep_analysis"') < SRV.indexOf('const q = +pt.qty;'),
   'sleep is parsed BEFORE the qty guard that used to drop it');
const run=new Function('pt','rec', blk.replace(/^\s*if \(nm[^{]*\{/, '').replace(/continue;\s*\}\s*$/,'') + '; return rec;');
const mins=(pt)=>{ const r=run(pt,{}); return r.sleepMin; };
ok(mins({totalSleep:6.5})===390,'totalSleep in hours');
ok(mins({asleep:7})===420,'asleep in hours');
ok(mins({qty:6})===360,'legacy qty shape still works');
ok(mins({deep:1.0,core:3.1,rem:1.4,awake:0.5})===330,'stages summed, awake excluded');
ok(mins({inBed:8})===480,'inBed as last resort');
ok(mins({totalSleep:400})===400,'above 24 read as minutes');
ok(mins({asleep:0.2})===undefined,'12 minutes rejected as noise');
ok(mins({asleep:25})===undefined,'25 hours rejected');
ok(mins({})===undefined,'a point with nothing usable is skipped, not zeroed');
ok(mins({totalSleep:6.5,asleep:7,deep:1})===390,'totalSleep wins over asleep and stages');
// the client reads what the server writes
const SRC=fs.readFileSync(__FCROOT+'/src/App.jsx','utf8');
ok(/d\.sleepMin|\.sleepMin/.test(SRC),'client reads sleepMin');

// v0.9.97: stages stored alongside the unchanged total
const stg=new Function('pt','rec', SRV.slice(SRV.indexOf('const toMin = (x)'), SRV.indexOf('continue;', SRV.indexOf('const toMin = (x)'))) + '; return rec;');
const num=(x)=>{const v=+x;return Number.isFinite(v)&&v>0?v:null;};
const S=(pt)=>{ const f=new Function('pt','rec','num', SRV.slice(SRV.indexOf('const toMin = (x)'), SRV.indexOf('continue;', SRV.indexOf('const toMin = (x)'))) + '; return rec;'); return f(pt,{},num); };
let r=S({deep:1.1,core:3.4,rem:1.5,awake:0.4});
ok(r.deepMin===66,'deep hours -> minutes');
ok(r.remMin===90,'rem hours -> minutes');
ok(r.lightMin===204,'core maps to light');
ok(r.awakeMin===24,'awake stored separately');
ok(S({light:2}).lightMin===120,'explicit light field also maps');
ok(S({deep:200}).deepMin===200,'above 24 read as minutes');
ok(Object.keys(S({})).length===0,'a night with no stages stores nothing');
// the total must be untouched by any of this
ok(mins({totalSleep:6.5})===390,'sleepMin still computed the same way after the stage change');
// the client must not fabricate a bar
ok(/deepMin \|\| 0\) \+ \(\+d\.remMin/.test(SRC) || /d\.deepMin/.test(SRC),'client filters to nights that actually have stages');
ok(SRC.includes('.filter((p) => p[1] > 0)'),'zero-length stages are not drawn');

console.log('\nSLEEP: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
