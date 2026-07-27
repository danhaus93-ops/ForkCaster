const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const {slice,build}=require('./lib.js');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const M=build(slice('const DELIVERY_APPS = [','const uid ='),['DELIVERY_APPS']);
const A=M.DELIVERY_APPS;

ok(A.length===3,'three delivery apps, got '+A.length);
ok(A.map(a=>a.label).join(',')==='DOORDASH,Uber Eats,GRUBHUB','labels in order: '+A.map(a=>a.label).join(','));
// brand theming — published hex values, and legible contrast on each
const BRAND={DOORDASH:['#FF3008','#FFFFFF'],'Uber Eats':['#06C167','#000000'],GRUBHUB:['#ED622B','#FFFFFF']};
const lum=(h)=>{const c=[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
for(const a of A){
  const [bg,fg]=BRAND[a.label];
  ok(a.bg===bg,a.label+' background must be '+bg+', got '+a.bg);
  ok(a.fg===fg,a.label+' text must be '+fg+', got '+a.fg);
  const L1=Math.max(lum(a.bg),lum(a.fg)),L2=Math.min(lum(a.bg),lum(a.fg));
  const ratio=(L1+0.05)/(L2+0.05);
  ok(ratio>=3,a.label+' contrast must clear 3:1 for large bold text, got '+ratio.toFixed(2)+':1');
}
ok(A.every(a=>typeof a.weight==='number'&&typeof a.spacing==='number'&&typeof a.size==='number'),'every chip carries its own type styling');
for(const a of A){
  const u=a.url("Raising Cane's Chicken Fingers");
  ok(u.startsWith('https://'),a.label+' must be an https universal link, got '+u);
  ok(!/\s/.test(u),a.label+' url must be encoded, got '+u);
  ok(u.includes('Raising')&&u.includes('Cane'),a.label+' must carry the venue name: '+u);
  // an apostrophe is a legal URL sub-delim (RFC 3986) — encodeURIComponent leaves it on purpose.
  // What matters is that the URL PARSES and the query survives the round trip.
  let parsed=null; try{parsed=new URL(u);}catch{}
  ok(!!parsed,a.label+' must parse as a URL: '+u);
  if(parsed){
    const back=decodeURIComponent(parsed.search?parsed.searchParams.get('q')||parsed.searchParams.get('queryText')||'':parsed.pathname.split('/').filter(Boolean).pop());
    ok(back==="Raising Cane's Chicken Fingers",a.label+' venue name must survive the round trip, got '+JSON.stringify(back));
  }
  console.log('  '+a.label.padEnd(10)+u);
}
// encoding of the characters that actually show up in venue names
ok(A[0].url('A & W').includes('%26'),'ampersand encoded');
ok(A[1].url('Panda Express').includes('q=Panda%20Express')||A[1].url('Panda Express').includes('q=Panda+Express'),'uber q param: '+A[1].url('Panda Express'));

// --- the iOS rule: these MUST be anchors, never a JS-opened button ---
const blk=SRC.slice(SRC.indexOf('DELIVERY_APPS.map'), SRC.indexOf('DELIVERY_APPS.map')+700);
ok(/<a\b/.test(blk),'rendered as an <a> element (universal links ignore JS navigation)');
ok(!/window\.open|window\.location/.test(blk),'no window.open / window.location in the delivery block');
ok(!/target=/.test(blk),'no target=_blank — it can break universal-link interception');
ok(!/preventDefault/.test(blk),'click handler must not preventDefault or the navigation dies');
// and nowhere else should a delivery url be opened programmatically
ok(!/window\.open\([^)]*doordash|window\.open\([^)]*ubereats|window\.open\([^)]*grubhub/i.test(SRC),'no delivery URL opened via window.open anywhere');
// the old overpromising copy is gone
ok(!/with the order pre-built/.test(SRC),'the "order pre-built" claim is gone');
ok(!/to a delivery app/.test(SRC),'the dead single button is gone');

console.log('\nDELIVERY: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
