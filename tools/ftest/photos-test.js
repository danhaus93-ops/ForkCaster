const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};

// ONE array with a view tag — the persisted shape of `photos` must not change
ok(/const stateBlob = JSON\.stringify\(\{[^}]*photos[,}]/.test(SRC),'photos still in stateBlob');
ok(!/photosBack|backPhotos/.test(SRC),'no second persisted photo array was introduced');
ok(/const viewOf = \(p\) =>[\s\S]{0,80}"back" \? "back" : "front"/.test(SRC),'untagged photos default to front');
ok(/date: todayISO\(\), view \}/.test(SRC),'uploads carry their view');
ok(/addPhotos\(e, view = "front"\)/.test(SRC),'addPhotos defaults to front');
// ONE call site by design — both sections share photoPanes, which passes its own `view` parameter.
// That is why front and back cannot drift apart; two copies would be the bug.
ok((SRC.match(/addPhotos\(e, view\)/g)||[]).length===1,'the shared renderer passes its own view, got '+(SRC.match(/addPhotos\(e, view\)/g)||[]).length);
ok(/onChange=\{\(e\) => addPhotos\(e, view\)\}/.test(SRC),'the file input is wired to the section it sits in');

// compare indices for back are transient, not persisted
for(const f of ['compareABack','compareBBack','activeSideBack','simSelBack'])
  ok(new RegExp('useState').test(SRC)&&SRC.includes(f),f+' exists');
for(const f of ['compareABack','compareBBack','activeSideBack','simSelBack'])
  ok(!new RegExp('stateBlob = JSON\\.stringify\\(\\{[^}]*'+f).test(SRC),f+' must NOT be persisted');

// one renderer drives both sections so they cannot drift apart
ok(/const photoPanes = \(view, label/.test(SRC),'a single pane renderer exists');
ok((SRC.match(/\{photoPanes\(/g)||[]).length===2,'called once per view, got '+(SRC.match(/\{photoPanes\(/g)||[]).length);
ok(/photoPanes\("front", "Front"/.test(SRC)&&/photoPanes\("back", "Back"/.test(SRC),'front and back sections both render');
// each strip only offers its own view
ok(/const list = photosOf\(view\)/.test(SRC),'each section lists only its own view');
ok(/inView = \(i\) => photos\[i\] && viewOf\(photos\[i\]\) === view/.test(SRC),'a pane refuses to show a photo from the other view');
// sharing is per-pair, not hardcoded to the front indices
ok(/shareComparison\(ai = compareA, bi = compareB\)/.test(SRC),'shareComparison takes the pair it is given');
ok(/shareComparison\(a, b\)/.test(SRC),'sections share their own pair');

// PAIRED forecast
ok(/pairId/.test(SRC),'forecast sets carry a pairId');
ok(/view: "front", pairId/.test(SRC)&&/view: "back", pairId/.test(SRC),'both angles are tagged and linked');
ok(/for \(const j of made\)/.test(SRC),'a failed pair rolls back whatever already rendered');
ok(/lf\.pairId === lb\.pairId/.test(SRC),'the UI checks the two shots are actually a set');
ok(/forecast separately, not as a set/.test(SRC),'a mismatched pair is called out rather than shown as complete');
ok(/simSelBack >= 0 \? photos\[simSelBack\] : null/.test(SRC),'back source is optional');

// --- HIS BUG: panes rendered empty / both sides showed one photo ---
// compareA/B are indices into the SHARED array but each view defaulted them to 0, so a back pane
// could point at a front photo (empty) and a front pair could sit on the same index (duplicate).
ok(/setA\(mine\[0\]\.i\); setB\(mine\[mine\.length - 1\]\.i\)/.test(SRC),'adding a photo sets that view pair to oldest -> Before, newest -> After');
ok(/const mine = all\.map\(\(x, i\) => \(\{ x, i \}\)\)\.filter/.test(SRC),'the pair is computed from that view only');
ok(!/\(view === "back" \? setCompareBBack : setCompareB\)\(all\.length - 1\)/.test(SRC),'the old newest-goes-to-After-only assignment is gone');
ok(/const has = \(i\) => list\.some\(\(e\) => e\.i === i\)/.test(SRC),'a repair pass checks each index belongs to its own view');
ok(/if \(list\.length > 1 && a === b\) setA\(list\[0\]\.i\)/.test(SRC),'both sides on one photo is repaired once a second exists');
ok(/}, \[photos\]\);/.test(SRC),'the repair runs when photos change');
// the repair must not clobber a manual choice
ok(/if \(!has\(a\)\) setA/.test(SRC)&&/if \(!has\(b\)\) setB/.test(SRC),'only INVALID indices are repaired, so a hand-picked pane survives');

// behaviour replay of his exact sequence
{
  const viewOf=p=>(p&&p.view)==='back'?'back':'front';
  const of=(ph,v)=>ph.map((x,i)=>({x,i})).filter(e=>viewOf(e.x)===v);
  let photos=[{id:'f1'}],A=0,B=0,Ab=0,Bb=0;
  const fix=()=>{for(const [v,ga,sa,gb,sb] of [['front',()=>A,x=>A=x,()=>B,x=>B=x],['back',()=>Ab,x=>Ab=x,()=>Bb,x=>Bb=x]]){
    const l=of(photos,v); if(!l.length) continue; const has=i=>l.some(e=>e.i===i);
    if(!has(ga()))sa(l[0].i); if(!has(gb()))sb(l[l.length-1].i); if(l.length>1&&ga()===gb())sa(l[0].i);}};
  const add=(id,v)=>{photos=[...photos,{id,view:v}];const l=of(photos,v);if(v==='back'){Ab=l[0].i;Bb=l[l.length-1].i;}else{A=l[0].i;B=l[l.length-1].i;}fix();};
  const pane=(i,v)=>photos[i]&&viewOf(photos[i])===v?photos[i].id:null;
  fix();
  add('b1','back');
  ok(pane(Ab,'back')==='b1','a first back photo lands in the back panes, not empty');
  ok(pane(A,'front')==='f1','adding a back photo does not blank the front pane');
  add('f2','front');
  ok(pane(A,'front')==='f1'&&pane(B,'front')==='f2','oldest front is Before, newest is After');
  ok(pane(Ab,'back')==='b1','the front add left the back pair alone');
  add('b2','back');
  ok(pane(Ab,'back')==='b1'&&pane(Bb,'back')==='b2','back follows the same oldest/newest rule');
  ok(pane(A,'front')==='f1'&&pane(B,'front')==='f2','the back add left the front pair alone');
}

console.log('\nPHOTOS: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
