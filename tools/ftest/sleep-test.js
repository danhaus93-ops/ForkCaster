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
console.log('\nSLEEP: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
