const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs'); const SRC=fs.readFileSync(__FCROOT+'/src/App.jsx','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const F=SRC.slice(SRC.indexOf('async function findSwaps'), SRC.indexOf('async function fetchSeedBook'));
ok(F.length>200,'findSwaps exists');
// it must reuse the builder's sources, not invent a parallel one
ok(/fetchSeedBook\(\)/.test(F),'uses the cookbook the week builder uses');
ok(/searchSpoon\(/.test(F),'uses searchSpoon, not a new fetch');
ok(!/fetch\(/.test(F),'no hand-rolled fetch inside findSwaps');
// allergies must be honoured — a swap that ignores them is worse than no swap
ok(/allergies\.map/.test(F),'allergy list consulted');
ok(/clean\)/.test(F) || /filter\(clean/.test(F),'candidates filtered by the allergy predicate');
// never offer the meal that is already in the slot
ok(/k === String\(slot\.name/.test(F),'the current meal is excluded from its own swap list');
ok(/slice\(0, 4\)/.test(F),'list capped so the sheet stays scannable');
// applySwap must preserve plan shape
const A=SRC.slice(SRC.indexOf('function applySwap'), SRC.indexOf('function applySwap')+900);
for (const k of ['ingredients','steps','perServing','name'])
  ok(new RegExp(k+':').test(A), 'swap carries '+k);
ok(/logged: false/.test(A),'a swapped meal is not marked logged');
ok(/i !== di \? d/.test(A),'other days untouched');
ok(/j !== si \? sl/.test(A),'other slots untouched');
// UI contract
ok(/Swap this meal/.test(SRC),'button labelled');
ok(/Matched to this slot/.test(SRC),'candidate list is labelled');
ok(/No swap matched/.test(SRC),'honest empty state');
console.log('\nSWAP: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
