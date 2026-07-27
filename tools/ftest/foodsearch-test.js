const __FCROOT = require("path").resolve(__dirname, "..", "..");
// End-to-end against stub sources via the FDC_BASE/OFF_BASE overrides — the same pattern the
// Spoonacular/YouTube/FatSecret stubs use. His live symptom: "No matches — try fewer words" on
// EVERY query, because the old catch returned a genuine-no-match shape on any failure.
const http = require('http');
const { execSync, spawn } = require('child_process');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const fs=require('fs');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
const SRV=fs.readFileSync(__FCROOT + '/server/server.js','utf8');

let fdcMode='ok', offMode='ok';
const fdc=http.createServer((q,r)=>{
  if(fdcMode==='down'){r.writeHead(500);return r.end('boom');}
  if(fdcMode==='empty'){r.writeHead(200,{'Content-Type':'application/json'});return r.end(JSON.stringify({foods:[]}));}
  r.writeHead(200,{'Content-Type':'application/json'});
  r.end(JSON.stringify({foods:[{description:'Chicken breast, roasted',brandOwner:'',foodNutrients:[{nutrientId:1008,value:165},{nutrientId:1003,value:31},{nutrientId:1005,value:0},{nutrientId:1004,value:3.6},{nutrientId:1079,value:0}]}]}));
});
const off=http.createServer((q,r)=>{
  if(offMode==='down'){r.writeHead(429);return r.end('<html>rate limited</html>');}
  if(offMode==='empty'){r.writeHead(200,{'Content-Type':'application/json'});return r.end(JSON.stringify({products:[]}));}
  r.writeHead(200,{'Content-Type':'application/json'});
  r.end(JSON.stringify({products:[{product_name:'Canned Chicken Breast',brands:'BrandCo',nutriments:{'energy-kcal_100g':120,proteins_100g:26,carbohydrates_100g:0,fat_100g:2,fiber_100g:0}}]}));
});

(async()=>{
  await new Promise(r=>fdc.listen(8121,r)); await new Promise(r=>off.listen(8122,r));
  execSync('rm -rf /tmp/fsd && mkdir -p /tmp/fsd');
  const p=spawn('node',['server/server.js'],{cwd:__FCROOT,env:{...process.env,PORT:'3996',DATA_DIR:'/tmp/fsd',FDC_BASE:'http://127.0.0.1:8121',OFF_BASE:'http://127.0.0.1:8122'},stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1200));
  const q=(s)=>fetch('http://127.0.0.1:3996/api/foodsearch?q='+encodeURIComponent(s)).then(r=>r.json());

  // 1) FDC healthy — generic food comes from the right database
  let j=await q('chicken breast');
  ok(j.results.length===1,'FDC path returns results, got '+j.results.length);
  ok(j.results[0].source==='USDA FoodData Central','generic query served by FDC: '+j.results[0].source);
  ok(j.results[0].protein===31&&j.results[0].calories===165,'nutrient IDs mapped: '+JSON.stringify(j.results[0]));
  ok(!j.error,'healthy path carries no error');

  // 2) FDC down — OFF fallback serves
  fdcMode='down'; j=await q('chicken breast');
  ok(j.results.length===1&&j.results[0].source==='Open Food Facts','falls back to OFF when FDC fails: '+JSON.stringify(j.results[0]&&j.results[0].source));
  ok(!j.error,'a served fallback is not an error');

  // 3) BOTH down — HIS SYMPTOM. Must be an ERROR, never a no-match.
  offMode='down'; j=await q('chicken breast');
  ok(j.results.length===0,'both down returns empty');
  ok(j.error==='unreachable','both down is flagged unreachable, got '+JSON.stringify(j.error));
  ok(/FDC: /.test(j.detail)&&/OFF: /.test(j.detail),'detail names both failures: '+j.detail);

  // 4) genuinely no match — empty WITHOUT an error flag
  fdcMode='empty'; offMode='empty'; j=await q('zzzz not a food');
  ok(j.results.length===0&&!j.error,'a real no-match carries no error flag');

  // v0.9.25: optimistic concurrency — a stale writer must BOUNCE, never clobber (the Jul 27 symptom-eater)
  {
    const post = (body, q) => fetch('http://127.0.0.1:3996/api/state' + (q || ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    const r0 = (await fetch('http://127.0.0.1:3996/api/state').then(r => r.json())._rev) || (await fetch('http://127.0.0.1:3996/api/state').then(r => r.json()))._rev || 0;
    const j1 = await post({ saved: true, note: 'first' });                       // legacy client: no _baseRev
    ok(j1.ok === true && j1.rev === r0 + 1, 'no-baseRev write accepted (mid-update compat), rev increments');
    const j2 = await post({ _baseRev: r0 + 1, saved: true, note: 'second' });
    ok(j2.ok === true && j2.rev === r0 + 2, 'correct baseRev accepted, rev increments again');
    const j3 = await post({ _baseRev: r0 + 1, saved: true, note: 'STALE CLOBBER' });
    ok(j3.ok === false && j3.stale === true && j3.rev === r0 + 2, 'STALE writer rejected with the current rev');
    const cur = await fetch('http://127.0.0.1:3996/api/state').then(r => r.json());
    ok(cur.note === 'second' && cur._rev === r0 + 2, 'the stale write changed NOTHING on disk');
    const j4 = await post({ _baseRev: 99, saved: true, note: 'restore' }, '?force=1');
    ok(j4.ok === true, 'force=1 (backup restore) bypasses the gate deliberately');
  }
  p.kill(); fdc.close(); off.close();

  // 5) the client renders the two states differently
  ok(/j\.error \? \{ error: true \}/.test(SRC),'client keeps the error signal');
  ok(/catch \{ setFoodResults\(\{ error: true \}\); \}/.test(SRC),'a client-side fetch failure is also an error, not a no-match');
  ok(/couldn't reach its sources/.test(SRC),'outage message exists');
  ok(/No matches — try fewer words/.test(SRC),'no-match message still exists');
  ok(/foodResults && foodResults\.error &&/.test(SRC),'the two messages are gated separately');
  // 6) server hygiene: status checked, bases overridable
  ok(/if \(!r\.ok\) throw new Error\(`FDC \$\{r\.status\}`\)/.test(SRV),'FDC status is checked (an HTML 429 no longer masquerades as no-match)');
  ok(/if \(!r\.ok\) throw new Error\(`OFF \$\{r\.status\}`\)/.test(SRV),'OFF status is checked');
  ok(/FDC_BASE = process\.env\.FDC_BASE/.test(SRV)&&/OFF_BASE = process\.env\.OFF_BASE/.test(SRV),'both sources are rig-stubbable');

  // --- HIS CATCH: the server whitelisted USDA_FDC_KEY but Settings never grew the input ---
  // Every user-enterable KNOWN_KEYS entry must appear in the client form: state, submit body, input.
  ok(/fdc: ""/.test(SRC),'keyIn state carries fdc');
  ok(/body\.USDA_FDC_KEY = keyIn\.fdc\.trim\(\)/.test(SRC),'submit body sends USDA_FDC_KEY');
  ok(/USDA FoodData Central key \(optional\)/.test(SRC),'the input field exists with an explanation');
  ok(/keyStatus\.usda \? "set" : "DEMO_KEY"/.test(SRC),'status line shows USDA, honest about the DEMO_KEY default');
  // and the whitelist/form can never drift again: every KNOWN_KEYS entry must be sendable from the form
  const known=(SRV.match(/const KNOWN_KEYS = \[([^\]]+)\]/)||[])[1].match(/"[A-Z_]+"/g).map(x=>x.slice(1,-1));
  for(const k of known) ok(new RegExp('body\\.'+k+' = ').test(SRC),'Settings form can send '+k);

  console.log('\nFOODSEARCH: '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
