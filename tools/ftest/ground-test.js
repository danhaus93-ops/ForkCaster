const __FCROOT = require("path").resolve(__dirname, "..", "..");
// v0.9.36 grounded itemization — stub FDC, real server, exact arithmetic.
// The raspberry rule, promoted: 170 g at USDA 52 kcal/100g MUST return 88 cal, named and traceable.
const http = require('http');
const { execSync, spawn } = require('child_process');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const RASP={description:'Raspberries, raw',fdcId:167755,foodNutrients:[
  {nutrientId:1008,value:52},{nutrientId:1003,value:1.2},{nutrientId:1005,value:11.9},
  {nutrientId:1004,value:0.65},{nutrientId:1079,value:6.5}]};
const JAM={description:'Raspberry jam',fdcId:999001,foodNutrients:[{nutrientId:1008,value:250},{nutrientId:1003,value:0.3},{nutrientId:1005,value:65},{nutrientId:1004,value:0.1},{nutrientId:1079,value:1}]};
const fdc=http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
  const query=(JSON.parse(b||'{}').query||'').toLowerCase();
  r.writeHead(200,{'Content-Type':'application/json'});
  r.end(JSON.stringify({foods:query.includes('raspberr')?[JAM,RASP]:[]}));});});
(async()=>{
  await new Promise(r=>fdc.listen(8131,r));
  execSync('rm -rf /tmp/fc-ground && mkdir -p /tmp/fc-ground');
  const p=spawn('node',['server/server.js'],{cwd:__FCROOT,env:{...process.env,PORT:'3997',DATA_DIR:'/tmp/fc-ground',FDC_BASE:'http://127.0.0.1:8131'},stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1200));
  try{
    const post=(body)=>fetch('http://127.0.0.1:3997/api/food/ground',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json());
    const d=await post({items:[{item:'raspberries, raw',grams:170},{item:'unicorn dust',grams:10}]});
    const a=d.rows[0],b2=d.rows[1];
    ok(a&&a.grounded===true,'known food grounds');
    ok(/raspberries, raw/i.test(a.matched)&&a.fdcId===167755,'match scoring picks the raw berries over the jam: '+(a&&a.matched));
    ok(a.calories===88,'170 g x 52/100 = 88 cal exactly (got '+(a&&a.calories)+')');
    ok(a.fiber===11,'fiber computes from the row (11 g)');
    ok(b2&&b2.grounded===false,'unknown food falls back honestly (grounded:false)');
    const d2=await post({items:[{item:'raspberries, raw',grams:100}]});
    ok(d2.rows[0].calories===52,'100 g returns the row itself (per-100g identity)');
    const d3=await post({items:[{item:'raspberries, raw',grams:0}]});
    ok(d3.rows[0].grounded===false,'zero grams cannot ground');
  } finally { p.kill(); fdc.close(); }
  console.log('\nGROUND: '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
