const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const {slice,build}=require('./lib.js');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const CP=build(slice('function composePicks(','function sanitizePicks('),['composePicks']);

// REAL curated data, lifted from server.js — not a synthetic fixture
const SRV=fs.readFileSync(__FCROOT + '/server/server.js','utf8');
const blk=SRV.match(/const CHAIN_GLP_MENUS = \{[\s\S]*?\n\};/)[0];
const CHAIN=new Function(blk+'\nreturn CHAIN_GLP_MENUS;')();
const sk=CHAIN.smoothieking;
const items=sk.items.map(i=>({...i,section:sk.section}));
ok(items.length===10,'Smoothie King curated menu has 10 items, got '+items.length);

// --- curated chain menu: whole list, ranked, nothing collapsed ---
const fullRes=CP.composePicks(items,'glp1','none',60,900,null,{full:true});
ok(fullRes.picks.length===10,'chain menu shows ALL 10, got '+fullRes.picks.length);
for(const want of ['Chocolate','Vanilla','Strawberry'])
  ok(fullRes.picks.some(p=>p.item.includes('Gladiator')&&p.item.includes(want)),'Gladiator '+want+' survives the family collapse');
ok(fullRes.picks.filter(p=>/Power Meal Slim/.test(p.item)).length===3,'all 3 Power Meal Slim flavors shown');
ok(fullRes.picks.filter(p=>/Keto Champ/.test(p.item)).length===2,'both Keto Champ flavors shown');
ok(fullRes.avoid.length===0,'no "Skip today" list on a curated menu we are recommending from');
const prot=fullRes.picks.map(p=>p.protein);
ok(prot[0]===45,'still RANKED — highest protein leads, got '+prot[0]);
// Order is SCORE-ranked (protein-first but volume-aware), NOT raw protein — a 450 cal item
// misses the <=400 cal small-volume bonus, so it can sit below a leaner 19g pick. By design.
ok(/^Gladiator/.test(fullRes.picks[0].item),'top pick is the 45g Gladiator, got '+fullRes.picks[0].item);
ok(fullRes.picks.slice(0,3).every(p=>/Gladiator/.test(p.item)),'the three 45g Gladiators lead the list');
ok(/Power Meal Slim/.test(fullRes.picks[9].item),'the 19g Power Meal Slim now sits last, not the 24g Keto Champ');
ok(new Set(fullRes.picks.map(p=>p.item)).size===10,'no duplicates');

// --- every other tier is untouched: still best top-3, still family-deduped ---
const norm=CP.composePicks(items,'glp1','none',60,900,null);
ok(norm.picks.length===3,'DEFAULT still top-3, got '+norm.picks.length);
ok(norm.picks.filter(p=>/Gladiator/.test(p.item)).length===1,'default still collapses flavor variants to one card');
ok(norm.avoid.length===2,'default still produces a Skip today list, got '+norm.avoid.length);
// a big non-curated menu must NOT go full just because it is long
const bigMenu=Array.from({length:14},(_,i)=>({item:'Plate '+i,protein:40-i,cal:500,fat:10}));
ok(CP.composePicks(bigMenu,'cut','none',60,900,null).picks.length===3,'a 14-item scraped menu still shows 3');
ok(CP.composePicks(bigMenu,'glp1','none',60,900,null).picks.length===3,'a 14-item menu in glp1 mode still shows 3');

// --- negative test: the flag must be what does the work ---
ok(CP.composePicks(items,'glp1','none',60,900,null,{}).picks.length===3,'NEGATIVE: opts without full behaves exactly like no opts');

// --- volume taper: no cliff at 400 cal ---
const S=sk.section;
const rank=(a,b)=>CP.composePicks([a,b],'glp1','none',60,900,null,{full:true}).picks[0].item;
let lo=0,hi=8;
for(let i=0;i<40;i++){const m=(lo+hi)/2;(rank({item:'A',section:S,protein:24,cal:400,fat:null},{item:'B',section:S,protein:24+m,cal:401,fat:null})==='B')?hi=m:lo=m;}
ok(hi<0.5,'one calorie at the 400 boundary must not cost real protein, costs '+hi.toFixed(3)+'g');
// more protein should win when the volume gap is modest
ok(rank({item:'Keto',section:S,protein:24,cal:450,fat:null},{item:'Power',section:S,protein:19,cal:210,fat:null})==='Keto',
   '24g/450 must outrank 19g/210 after the taper');
const ord=fullRes.picks.map(p=>p.item);
ok(ord.findIndex(x=>/Keto Champ/.test(x))<ord.findIndex(x=>/Power Meal Slim/.test(x)),
   'Keto Champ (24g) now ranks above Power Meal Slim (19g)');
// volume preference is preserved, just continuous: same protein, less volume still wins
ok(rank({item:'Small',section:S,protein:24,cal:200,fat:null},{item:'Big',section:S,protein:24,cal:650,fat:null})==='Small',
   'same protein, smaller volume still wins');
// and it stays monotonic across the old boundary
// <=300 cal is a deliberate plateau (any portion that small is equally fine; protein breaks the tie).
// Above it, volume matters progressively. What must never happen is an INVERSION.
const sc=[350,400,450,500,600,700,800].map(c=>CP.composePicks([{item:'X',section:S,protein:24,cal:c,fat:null},{item:'Ref',section:S,protein:24,cal:200,fat:null}],'glp1','none',60,900,null,{full:true}).picks.findIndex(p=>p.item==='X'));
ok(sc.every(v=>v===1),'above the plateau a heavier item never outranks the same item at lower volume: '+sc.join(','));
const plat=[200,250,300].map(c=>CP.composePicks([{item:'X',section:S,protein:24,cal:c,fat:null},{item:'Ref',section:S,protein:24,cal:200,fat:null}],'glp1','none',60,900,null,{full:true}).picks.findIndex(p=>p.item==='X'));
ok(plat.every(v=>v===0),'<=300 cal plateau ties exactly, no inversion: '+plat.join(','));
// the taper is glp1-only: cut and gain must be untouched
const plates=[{item:'Burger',protein:45,cal:900,fat:55},{item:'Salad',protein:38,cal:400,fat:12},{item:'Steak',protein:42,cal:500,fat:20}];
ok(CP.composePicks(plates,'gain','none',60,900,null).picks[0].item==='Burger','gain mode unaffected by the taper');
ok(CP.composePicks(plates,'cut','none',60,900,null).picks[0].item==='Steak','cut mode unaffected by the taper');

console.log('\nCHAIN: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
