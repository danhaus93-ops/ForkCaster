const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
const SRV=fs.readFileSync(__FCROOT + '/server/server.js','utf8');
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};

// CHECK 47 — every key name the CLIENT can send must be in the server's KNOWN_KEYS
const knownSet=new Set([...(SRV.match(/const KNOWN_KEYS = \[(.*?)\];/s)||['',''])[1].matchAll(/"([A-Z0-9_]+)"/g)].map(m=>m[1]));
ok(knownSet.size===8,'KNOWN_KEYS parsed, got '+knownSet.size+': '+[...knownSet].join(', '));
const clientKeys=new Set([...SRC.matchAll(/body\.([A-Z][A-Z0-9_]{5,})\s*=/g)].map(m=>m[1])
  .filter(k=>/_KEY$|_API_KEY$|_CLIENT_(ID|SECRET)$/.test(k)));
ok(clientKeys.size>0,'client key names found: '+[...clientKeys].join(', '));
for(const k of clientKeys) ok(knownSet.has(k),'client sends "'+k+'" but server KNOWN_KEYS lacks it — silently discarded');

// CHECK 51 — every field in stateBlob must be read back in the load handler
const blob=(SRC.match(/const stateBlob = JSON\.stringify\(\{(.*?)\}\);/s)||['',''])[1];
const fields=[...blob.matchAll(/(?:^|,)\s*([a-zA-Z_$][\w$]*)\s*(?=[,:}]|$)/g)].map(m=>m[1])
  .filter(f=>!['true','saved'].includes(f));
ok(fields.length>15,'stateBlob fields parsed: '+fields.length);
const missing=fields.filter(f=>!new RegExp('s\\.'+f+'\\b').test(SRC));
ok(missing.length===0,'stateBlob fields never read back on load: '+missing.join(', '));
console.log('  stateBlob ('+fields.length+' fields) all round-trip: '+fields.join(' '));

// negative-test the round-trip check itself: delete a loader and it MUST fail
{
  const broken=SRC.replace(/s\.routine\b/g,'s.__gone__');
  const stillOk=fields.filter(f=>!new RegExp('s\\.'+f+'\\b').test(broken));
  ok(stillOk.includes('routine'),'NEGATIVE TEST: removing the routine loader must be detected');
}

// v0.7.3 tripwire — a trailing // comment on a line holding more than one loader
const risky=SRC.split('\n').map((l,i)=>[i+1,l]).filter(([,l])=>/\/\//.test(l)&&(l.match(/if \(s\./g)||[]).length>1);
ok(risky.length===0,'line holds >1 loader AND a trailing // comment: '+risky.map(r=>r[0]).join(','));

// --- release.sh: the gate must be an EXACT tag match, not a substring ---
const RS=fs.readFileSync(__FCROOT + '/release.sh','utf8');
ok(!/grep -q "v\$VER"/.test(RS),'gate must not substring-match the bare version (v0.8.1 matches v0.8.10)');
ok(/VER_RE=/.test(RS)&&/sed .s\/\\\.\//.test(RS),'gate escapes dots so they are not regex wildcards');
ok(RS.includes('${VER_RE}')&&/grep -q .*VER_RE/.test(RS),'gate matches on the escaped, quoted tag');
ok(!/SAFE TO TAP[\s\S]{0,200}Registry says: \$TAGS/.test(RS),'success path must not dump the whole tag list');
ok(/Full list: \$TAGS/.test(RS),'failure path still prints the full list — that is when you need it');
ok(/COUNT=/.test(RS),'success path reports a tag count instead');

// --- Ask-this-menu and bottom clearance must NOT depend on the Skip-today list ---
// v0.8.6 emptied `avoid` for curated chain menus; both were nested inside that block and vanished.
{
  const i=SRC.indexOf('(result.avoid || []).length > 0');
  ok(i>0,'found the Skip-today gate');
  const close=SRC.indexOf(')}', SRC.indexOf('result.avoid.map', i));
  const block=SRC.slice(i, close);
  ok(!/Ask about this menu/.test(block),'Ask-this-menu must not be nested inside the Skip-today block');
  ok(!/paddingBottom: 96/.test(block),'the 96px bottom clearance must not be nested inside the Skip-today block');
  const after=SRC.slice(close, close+1600);
  ok(/Ask about this menu/.test(after),'Ask-this-menu renders unconditionally after it');
  // (the per-view 96px clearance is gone — the scroll container now reserves bar height + safe-area)
}
// clearance is now UNIVERSAL: the scroll container reserves bar height + safe-area, so no view
// may carry its own 96px band-aid (they stack into dead space and drift out of sync)
// (flex-basis "0 0 96px" on the severity select is a WIDTH, not clearance — excluded)
ok((SRC.match(/paddingBottom: 96|padding: "[^"]*96px"/g)||[]).length===0,'no per-view 96px clearance remains anywhere');
ok(/padding: "20px 20px calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)"/.test(SRC),'the bottom sheet uses the safe-area pattern like the other sheets');

// --- Skip-today rows: the renderer must read the field the producers emit ---
// composePicks and sanitizePicks both emit {item, reason}; the row read a.name and rendered blank.
// AI-supplied entries may carry `name`, so the row accepts either.
{
  const row=SRC.match(/<span[^>]*>\{a\.[^}]*\}<\/span><span[^>]*>\{a\.reason\}/);
  ok(!!row,'found the Skip-today row');
  if(row){
    ok(/a\.item/.test(row[0]),'row must read a.item — both producers emit it: '+row[0].slice(0,80));
  }
  const prods=[...SRC.matchAll(/reason: (?:\(|`)/g)].length;
  ok(prods>=2,'found both avoid producers ('+prods+')');
  // neither producer may emit ONLY a name field
  ok(!/moved\.push\(\{ name:/.test(SRC)&&!/=> \(\{ name: it\.item/.test(SRC),'no avoid producer emits name-only');
}

// --- no placeholder body measurements may ever ship again ---
{
  const m=SRC.match(/useState\(\{ sex: "male",([^}]*)\}\)/);
  ok(!!m,'found the body state initialiser');
  if(m){
    const init=m[1];
    for(const f of ['heightIn','neck','waist','hip']){
      const v=(init.match(new RegExp(f+':\\s*([0-9]+)'))||[])[1];
      ok(v==='0',f+' must initialise to 0 (unknown), got '+v+' — a non-zero default makes the Navy tile invent a body fat from numbers nobody entered');
    }
  }
  // the formula must refuse to compute on missing inputs
  ok(/if \(!heightIn \|\| !neck \|\| !waist\) return 0;/.test(SRC),'calcBodyFat returns 0 when any measurement is missing');
  // every tile falls back to an em dash rather than a number
  ok(/bmi \? bmi\.toFixed\(1\) : "—"/.test(SRC),'BMI tile shows — when height is unknown');
  // v0.9.122: the three tiles merged into the Composition card. The invariant is unchanged — an
  // unknown renders an em dash, never a zero — but the guard reads != null now rather than truthy,
  // which also stops a real 0.0% being swallowed as "unknown".
  ok(/bfShown != null \? bfShown\.toFixed\(1\) : "—"/.test(SRC),'body fat shows — when nothing is known');
  ok(/leanShown != null \? leanShown\.toFixed\(0\) : "—"/.test(SRC),'lean shows — when nothing is known');
  ok(/bfMeasured \? "measured" : "fat-free mass"/.test(SRC),'the estimate fallback survived the merge');
  ok(/sectionTitle\("Composition"\)/.test(SRC),'the merged card exists');
  ok(!/stat\("BMI"/.test(SRC),'the separate BMI tile is gone');
  // a measured reading must outrank the tape-measure estimate, and be labelled as such
  ok(/const bfShown = bfMeasured \|\| bodyFat/.test(SRC),'measured body fat outranks the Navy estimate');
  ok(/bfMeasured \? "measured"/.test(SRC),'the tile says "measured" when it is');
  ok(/"Navy estimate"/.test(SRC),'an estimate is labelled an estimate, not just a method name');
  ok(!/>Navy method</.test(SRC),'the bare "Navy method" label is gone — it read as a measurement');
  ok(/add height, neck & waist/.test(SRC),'when nothing is entered the tile says what to enter');
}

// --- ONE source for body composition: measured beats the tape-measure estimate EVERYWHERE ---
// The Journey card read 174 lb (Navy) while the LEAN tile beside it read 136 (measured).
{
  ok(/const leanShown = bfShown/.test(SRC),'leanShown derives from bfShown');
  ok(/const bfShown = bfMeasured \|\| bodyFat/.test(SRC),'bfShown prefers the measured reading');
  ok(/const leanMass = leanShown;/.test(SRC),'leanMass IS leanShown — not a second derivation');
  ok(!/const leanMass = bodyFat \?/.test(SRC),'leanMass must never re-derive from the raw estimate');
  ok(/body_fat_pct: bfShown/.test(SRC),'the coach is briefed with the measured value');
  ok(/body_fat_source:/.test(SRC),'the coach is told whether it is measured or estimated');
  ok(/lean_mass_lbs: leanShown/.test(SRC),'the coach gets lean mass too');
  // sweep: nothing else may consume the raw estimate
  // sweep WHOLE LINES — matchAll truncates at the match, so "const bodyFat = calcBodyFat(...)"
  // arrives as "const bodyFat" and slips past a filter looking for the assignment.
  const NOCOMMENT=SRC.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
  const raw=NOCOMMENT.split('\n').filter(l=>/[^a-zA-Z_](bodyFat|leanMass)[^a-zA-Z(]/.test(l))
    .map(l=>l.trim())
    .filter(l=>!/^\/\/|^\*|^\/\*/.test(l))                              // comments
    .filter(l=>!/^const bodyFat = calcBodyFat/.test(l))                  // the definition itself
    .filter(l=>!/^const leanMass = leanShown;/.test(l))                  // the single source
    .filter(l=>!/bfMeasured|bfShown|leanShown/.test(l))                  // already on the right value
    .filter(l=>!/lastBf \?/.test(l))                                      // goalContract: measured first, estimate only as fallback
    .filter(l=>!/\{leanMass \? leanMass\.toFixed/.test(l));               // renders leanShown via leanMass
  ok(raw.length===0,'no consumer reads the raw Navy estimate: '+raw.map(l=>l.slice(0,70)).join(' | '));
}

// --- intake bookkeeping: what ADD puts in, DELETE must take out ---
{
  const del=(SRC.match(/setEaten\(\(e\) => \(\{ \.\.\.e, protein: Math\.max\(0[^;]*\}\)\);/)||[])[0]||'';
  ok(!!del,'found the meal-delete path');
  for(const f of ['protein','calories','carbs','fat','fiber'])
    ok(new RegExp(f+': Math\\.max\\(0').test(del),'delete must subtract '+f+' — it was leaving carbs and fiber on the day forever');
  // every add path carries fiber, or delete can never balance
  const adds=SRC.split('\n').filter(l=>/setEaten\(\(e\) => \(\{ \.\.\.e, protein: e\.protein \+/.test(l));
  ok(adds.length>=2,'found the add paths ('+adds.length+')');
  for(const a of adds) ok(/fiber:/.test(a),'an add path drops fiber: '+a.trim().slice(0,90));
  // tap-to-log
  ok(/const commitQuick =/.test(SRC),'quick-add commit exists');
  // the four tiles share ONE call inside .map, so source occurrences are 4: number, label, calories, tiles
  ok((SRC.match(/openQuick\(/g)||[]).length>=4,'headline, label, calories and the tile map are tappable, got '+(SRC.match(/openQuick\(/g)||[]).length);
  ok(/onClick=\{\(\) => openQuick\(m\.field, m\.short, m\.unit\)\}/.test(SRC),'the tile card itself is the tap target, driven by its own field');
  ok(/openQuick\("protein"/.test(SRC)&&/openQuick\("calories"/.test(SRC),'protein and calories are reachable from the headline');
  for(const f of ['carbs','fat','waterOz','fiber']) ok(new RegExp('field: "'+f+'"').test(SRC),'tile carries field '+f);
  ok(/QUICK_KCAL = \{ protein: 4, carbs: 4, fat: 9 \}/.test(SRC),'macro entries carry their own calories');
  ok(/Tap any number above to log intake by hand/.test(SRC),'the caption says the numbers are tappable');
  ok(/Change today's goals/.test(SRC),'the goals link no longer reads like it edits intake');
}

// --- bottom clearance: content must never hide behind the fixed tab bar ---
// The bar is ~62px PLUS env(safe-area-inset-bottom) (~34px installed on iPhone). A fixed
// paddingBottom covered Safari and clipped the PWA; per-view 96px band-aids papered over it
// inconsistently, which is exactly the screen-by-screen clipping he screenshotted.
ok(/overflowY: "auto", paddingBottom: "calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)"/.test(SRC),'the universal scroll container reserves bar height + safe-area');
ok(!/overflowY: "auto", paddingBottom: 76/.test(SRC),'the fixed 76 is gone');
ok(!/paddingBottom: 96 \}\}>/.test(SRC),'no per-view band-aid paddings remain to stack or drift');
ok(/bottom: "calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\)", zIndex: 300/.test(SRC),'the floating toast clears the bar in installed mode too');
ok(/padding: "8px 6px calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)"/.test(SRC),'the bar itself still pads for the home indicator');

// --- v0.9.15 audit findings, locked in ---
{
  const SRV=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  const DOCK=require('fs').readFileSync(__FCROOT + '/Dockerfile','utf8');
  const PKG=JSON.parse(require('fs').readFileSync(__FCROOT + '/package.json','utf8'));
  const LOCK=JSON.parse(require('fs').readFileSync(__FCROOT + '/package-lock.json','utf8'));
  // every upstream fetch carries a timeout (signal within a 9-line window)
  const lines=SRV.split('\n'); let naked=0;
  lines.forEach((l,i)=>{ if(/await fetch\(/.test(l)&&!/AbortSignal\.timeout|signal:/.test(lines.slice(i,i+9).join('\n'))) naked++; });
  ok(naked===0,'every server fetch carries a timeout, '+naked+' naked');
  // lock and manifest agree on the historically-pinned dep, and Docker pins exactly
  ok(PKG.dependencies['pdf-parse']==='1.1.1','manifest pins pdf-parse exactly');
  ok(LOCK.packages['node_modules/pdf-parse'].version==='1.1.1','lock matches the manifest pin');
  ok(/npm ci --no-audit/.test(DOCK),'build stage installs from the lockfile');
  ok(/COPY package\.json package-lock\.json/.test(DOCK),'the lockfile is actually copied in');
  ok(/express@4\.22\.2 pdf-parse@1\.1\.1 puppeteer-core@25\.3\.0 web-push@3\.6\.7/.test(DOCK),'runtime deps pinned exact');
  // the usage endpoint is honest both sides
  ok(/ok: false, count: null, bytes: null/.test(SRV),'usage failure is failure-shaped');
  ok(/storage unreadable/.test(SRC),'the client renders the failure instead of 0 files');
}
// v0.9.19: the rank cache must be consulted through the synchronous ref, after hydration
{
  const A=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/savedRankRef\.current \|\| savedRank/.test(A),'rank gate reads the ref mirror, not the stale closure');
  ok(/if \(s\.savedRank\) \{ savedRankRef\.current = s\.savedRank;/.test(A),'loader writes the ref synchronously');
  ok(/!hydrated\.current; w\+\+\) await new Promise/.test(A),'ranking waits for hydration when GPS wins the race');
  ok(/savedRankRef\.current = \{ key, at: now, arr \}/.test(A),'saving keeps ref and state in sync');
}
// v0.9.22: no more silent data loss on app close, quick-adds leave records, honest describe-it errors
{
  const A2=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/keepalive: true/.test(A2),'the close-time flush uses keepalive so the POST outlives the page');
  ok(/addEventListener\("pagehide", flush\)/.test(A2) && /visibilitychange/.test(A2),'flush fires on both hide paths');
  ok(/blobRef\.current = stateBlob/.test(A2),'the flush reads a ref kept current by the save effect');
  ok(/Quick add \\u2014/.test(A2) || /Quick add \u2014/.test(A2),'macro quick-adds write a visible row');
  ok(/Couldn't reach the AI/.test(A2),'describe-it distinguishes an outage from a parse failure');
  ok(!/alert\("Couldn't parse that/.test(A2),'the undifferentiated catch-all alert is gone');
}
// v0.9.25: every client writer presents its revision; restore is the one deliberate overwrite
{
  const A3=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok((A3.match(/"_baseRev":\$\{revRef\.current\}/g) || []).length === 1, 'the ONE writer (postState) injects _baseRev — both callers route through it (v0.9.31)');
  ok(/revRef\.current = j\.rev; lastSavedRef\.current = blob;/.test(A3), 'an accepted post advances the rev AND the saved baseline in one place');
  ok(/j\.stale\) \{ console\.warn/.test(A3) && /window\.location\.reload\(\)/.test(A3), 'a stale ACTIVE instance re-syncs instead of fighting');
  ok(/api\/state\?force=1/.test(A3), 'backup restore uses the force path');
  ok(/revRef\.current = \(s && \+s\._rev\) \|\| 0/.test(A3), 'the loader adopts the revision it loaded');
}
// v0.9.26: provenance labeling end to end on the client
{
  const A4=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/synced: true, source: d\.source/.test(A4),'mergeWeightSeries carries the source tag');
  ok(/"apple-health": "APPLE HEALTH", "google-health": "GOOGLE HEALTH"/.test(A4),'the chip names known platforms');
  ok(/: "SYNCED"/.test(A4),'untagged synced days still fall back to the generic SYNCED chip');
}
// v0.9.27: the Today steps tile agrees with Body — shows today's synced count when it beats the manual tap counter
{
  const A5=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/Math\.max\(\+eaten\.steps \|\| 0, syn\)/.test(A5),'the tile shows the larger of manual and synced-today');
  ok(/d\.date === tk/.test(A5) && /dayKeyAt\(Date\.now\(\), prefs\)/.test(A5),'synced lookup uses the unified day clock, not UTC');
  ok(/"synced \\u00b7 goal 10,000"/.test(A5),'the tile says when the number came from sync');
}
// v0.9.28: foreground refresh — resume re-pulls synced health data and re-renders time-dependent surfaces
{
  const A6=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/document\.visibilityState !== "visible"\) return/.test(A6),'refresh fires only on becoming visible, not on hide');
  ok(/setFgTick\(\(t\) => t \+ 1\)/.test(A6),'a tick re-renders clocks even when data is unchanged');
  ok(/setHealthSync\(\(h\) => \(\{ \.\.\.\(h \|\| \{\}\), days: sm\.days \}\)\)/.test(A6),'the summary re-pull keeps the token and replaces days');
  ok(/addEventListener\("pageshow", refresh\)/.test(A6),'iOS back-forward-cache resume is covered too');
}
// v0.9.29: never write unchanged data — the echo save + teardown flush + stale-reload chased each other into a restart loop
{
  const A7=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/lastSavedRef\.current === null\) \{ lastSavedRef\.current = stateBlob; return; \}/.test(A7),'first post-hydration blob is the as-loaded baseline, not a save');
  ok(/if \(stateBlob === lastSavedRef\.current\) return;/.test(A7),'an unchanged blob is never saved');
  ok(/blobRef\.current === lastSavedRef\.current\) return;/.test(A7),'an unchanged blob is never flushed at teardown');
  ok(/revRef\.current = j\.rev; lastSavedRef\.current = blob;/.test(A7),'an accepted save updates BOTH the rev and the saved baseline (via the single writer)');
  ok(/window\.location\.reload\(\)/.test(A7),'genuinely-divergent stale saves still re-sync by reload');
}
// v0.9.30: the flush learns the revision its write produced — edit + quick-background no longer strands the client one rev behind
{
  const A8=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/postState\(blobRef\.current, true\)/.test(A8),'the flush routes through the single writer with keepalive');
  ok(/now - lastRefresh < 2000\) return;/.test(A8),'resume refreshes once, not once per event');
}
// v0.9.31: saves are SERIALIZED — a client can never race itself into an off-by-one stale
{
  const A9=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/if \(saveBusyRef\.current\) \{ pendingSaveRef\.current = stateBlob; return; \}/.test(A9),'a debounced save queues instead of racing an in-flight one');
  ok(/if \(saveBusyRef\.current\) \{ pendingSaveRef\.current = blobRef\.current; return; \}/.test(A9),'the flush queues too instead of racing with an old rev');
  ok(/if \(next && next !== lastSavedRef\.current\) postState\(next, false\);/.test(A9),'the queued newest state ships the moment the line clears, latest wins');
  ok((A9.match(/fetch\("\/api\/state", \{ method: "POST"/g) || []).length === 1,'exactly ONE code path posts state — postState is the single writer');
}
// v0.9.32: GPS jitter stays out of the saved state — location persists at ~110m grid, identity kept when unmoved
{
  const B1=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const r3 = \(n\) => Math\.round\(n \* 1000\) \/ 1000;/.test(B1),'savedGeo rounds to 3 decimals (~110m)');
  ok(/r3\(p\.lat\) === r3\(geo\.lat\) && r3\(p\.lng\) === r3\(geo\.lng\) \? p :/.test(B1),'an unmoved position keeps the SAME object — no blob churn, no save');
}
// v0.9.33: estimates itemize; deterministic summation with a 4/4/9 identity cross-check
{
  const src=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const fn=new Function('return '+src.slice(src.indexOf('function sumFoodItems'), src.indexOf('\n}', src.indexOf('function sumFoodItems'))+2))();
  // the raspberry fixture — his exact evening, USDA per-item
  const t=fn([{item:'raspberries',qty:'6 oz',calories:88,protein:2,carbs:20,fat:1,fiber:11},{item:'chia seeds',qty:'2 tbsp',calories:116,protein:4,carbs:10,fat:7,fiber:8},{item:'water',qty:'8 oz',calories:0,protein:0,carbs:0,fat:0,fiber:0}]);
  ok(t.calories===204 && t.protein===6 && t.carbs===30 && t.fat===8 && t.fiber===19, 'raspberry fixture sums to the true 204/6/30/8/19 (card had said 150)');
  ok(t.adjusted===false, 'honest per-item calories are left alone (within 18% of macro identity)');
  const bad=fn([{item:'x',qty:'',calories:50,protein:10,carbs:10,fat:10}]);
  ok(bad.calories===170 && bad.adjusted===true, 'calories that contradict the macros get recomputed from 4/4/9 and flagged');
  ok(fn(null).calories===0 && fn([{qty:'1'}]).items.length===0, 'garbage in, zeros out — no NaN, nameless rows dropped');
  ok(src.includes('stated quantities are EXACT') && !src.includes('Single combined estimate, conservative'), 'description prompt computes from stated amounts; the conservative lump-sum wording is gone');
  ok(/OTHERWISE itemize every distinct food visible/.test(src) && /do not shade numbers low/.test(src), 'photo prompt itemizes and forbids lowballing (portion realism kept)');
}
// v0.9.34: the Save-keys gate derives from ALL fields — the per-field enumeration that silently
// ignored each newly added key input (his FDC paste, and one before it) is structurally dead
{
  const src=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(src.split('!Object.values(keyIn).some((v) => String(v || \"\").trim())').length===3, 'Save gate (disabled + opacity) derives from Object.values — a ninth key field can never be forgotten');
  ok(!src.includes('!keyIn.a.trim() && !keyIn.g.trim()'), 'the enumerated field chain is gone from the gate');
  ok(src.includes('body.USDA_FDC_KEY = keyIn.fdc.trim()'), 'FDC key crosses the payload hop to the server name the whitelist expects');
}
// v0.9.35: updates must arrive — versioned bundle URLs + no-store HTML; CHECK 46 REBORN
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const srv=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(app.split('Object.values(keyIn).some((v) => String(v || \"\").trim())').length===4, 'ALL THREE key-gate sites (Save disabled, opacity, test-then-save) derive from every field');
  ok(!/if \(keyIn\.a\.trim\(\) \|\| keyIn\.g\.trim\(\)/.test(app), 'the test-then-save enumeration (the v0.6.2 site my v0.9.34 missed) is gone');
  ok(srv.includes('app.js?v=${APP_VERSION}') && srv.includes('"no-store"') && srv.includes('index: false'), 'server stamps the bundle URL with its version and never lets the HTML shell cache — a release IS a new URL');
  // CHECK 46, REBORN (the v0.6.2 tripwire lost in the rig reset): every key field an input renders
  // must be sendable — present in the saveKeys body mapping. A field the form shows but cannot save
  // is the whole family of this bug.
  const fields=[...new Set([...app.matchAll(/value=\{keyIn\.([a-z]+)/g)].map(m=>m[1]))];
  ok(fields.length>=8, 'found the key input fields ('+fields.length+')');
  for (const f of fields) ok(new RegExp('keyIn\\.'+f+'(\\s*\\|\\|\\s*\"\")?\\)?\\.trim\\(\\)\\) body\\.').test(app.replace(/\(keyIn\.([a-z]+) \|\| ""\)\.trim\(\)\) body\./g,'keyIn.$1.trim()) body.')), 'key field \''+f+'\' is sendable — appears in the saveKeys body (check 46)');
}
// v0.9.36 grounded itemization: model weighs, server resolves, code computes
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const srv=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(app.includes('required: [\"item\", \"grams\"'), 'NL schema REQUIRES grams — the model must weigh every item');
  ok(app.split('groundFoodItems(').length>=4, 'both estimate paths (described + photo) ground through the shared helper');
  ok(srv.includes('app.post(\"/api/food/ground\"') && srv.includes('${FDC_BASE}'), 'ground endpoint exists and is stubbable via FDC_BASE');
  ok(srv.includes('return { grounded: false }'), 'no-match and FDC failure fall back honestly, never block');
  ok(app.includes('grounded: true') && app.includes('item: row.matched'), 'grounded lines take FDC values AND display the matched row name');
}
// v0.9.37: RHR wired end to end — ingest (both shapes) -> summary passthrough -> card
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const srv=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(srv.includes('nm === \"resting_heart_rate\"'), 'HAE metric resting_heart_rate is ingested');
  ok(srv.includes('rec.restingHeartRate'), 'flat-shape rhr/restingHeartRate is ingested');
  ok(app.includes('rhrRead((healthSync && healthSync.days) || [], glp.doseLog)'), 'card reads the synced days + dose log');
  ok(app.includes('Resting heart rate') && app.includes('#f05252'), 'card exists and the vital sign line is RED (his call — dose curve stays purple)');
  ok(app.includes('not medical advice') || app.includes('Informational only'), 'flag banner keeps the informs-never-prescribes voice');
}
// v0.9.38: dose curve teaches steady-state; RHR card position is a signal
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(app.includes('doses.concat(virtual)'), 'projection includes scheduled future doses (steady-state build is drawn, not hidden)');
  // v0.9.56: design change on his order — the mock's chart normalizes NOW to CONVERGED STEADY STATE,
  // not the peak reached so far. The invariant moves with it: the denominator must be the 40-cycle
  // converged peak (never a moving in-window max), and the caption must say what steady state means.
  ok(app.includes('level(now) / ssPeak'), 'now-percent anchors to converged steady-state peak (the mock design)');
  ok(app.includes('cadence * 40'), 'steady-state peak comes from a far-horizon run of the same model, not the visible window');
  ok(app.includes('Steady state is the highest of your peak levels'), 'caption defines steady state in plain words');
  // v0.9.120: the projected trough is still named — the label moved OUT of the plot into the cell
  // row, because text placed at a value's own height collides with the steady-state line as the
  // peak approaches it. The invariant is that the number is shown, not where it is drawn.
  ok(/>Next dose</.test(app) && /\{nextVsPeak\}%/.test(app), 'the projected trough is named in the cell row');
  ok(!/% at next dose/.test(app), 'no value label is drawn inside the plot');
  ok(!/>peaks ~\{/.test(app) && !/NOW · \{vsPeak\}%/.test(app), 'the peak and now labels left the plot too');
  ok(app.split('rhrCardFor(_r)').length===3, 'RHR card renders in exactly one of two slots: top when flagged, below the med curve when quiet');
}
// v0.9.39: the X must be a perfect inverse of Add — EVERY meal-entry writer stores EVERY macro
// the delete subtracts. His field find: photo meal deleted, carbs+fiber orphaned on the Now card,
// because two of four entry writers enumerated {fat, protein, calories} and stopped (the picks
// writer and quick-add stored all five — a fix applied to one caller and not its siblings).
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const pushes=[...app.matchAll(/setMealLog\(\(m\) => \[\.\.\.m, \{([^}]*)\}/g)].map(x=>x[1]);
  ok(pushes.length>=3, 'found the inline meal-entry writers ('+pushes.length+')');
  for (const body of pushes) for (const f of ['protein','calories','fat','carbs','fiber'])
    ok(body.includes(f+':'), 'a meal-entry writer stores '+f+' (missing from: '+body.slice(0,60).trim()+'...)');
  ok(app.includes('- (m.carbs || 0)') && app.includes('- (m.fiber || 0)'), 'the X subtracts all five macros');
}
// v0.9.40: every counter can be SET to an exact value, including zero — his order after the
// orphan cleanup proved the tiles could only ADD. Set touches only the tapped number, records a
// reversible correction row (delta may be negative), and blank input means zero.
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(app.includes('commitQuick("set")') && app.includes('>Set</button>'), 'the editor has a Set button beside Add');
  ok(app.includes('const target = Number.isFinite(v) && v >= 0 ? v : 0;'), 'blank or invalid input sets ZERO — zeroing is the primary use');
  ok(app.includes('delta = target - cur'), 'Set computes a delta against the current counter');
  ok(app.includes('adjust: true'), 'corrections are recorded as adjustment rows, X-reversible like any entry');
  ok(!/mode === \"set\"[\s\S]{0,900}kcal \? \{ calories/.test(app.slice(app.indexOf('mode === \"set\"'), app.indexOf('mode === \"set\"')+900)), 'Set moves ONLY the tapped counter — no derived calorie side-effect');
}
// v0.9.41: injection-site sides are ANATOMICAL — his right-abdomen shot was recorded as
// "Abdomen L" because the dot map carried viewer-side coordinates under patient-side names.
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(app.includes('\"Abdomen L\": [belly * 0.8') && app.includes('\"Abdomen R\": [-belly * 0.8'), 'patient-left renders viewer-right: the front view is a mirror, like every medical chart');
  ok(app.includes('\"Thigh L\": [thW + 2.5') && app.includes('\"Arm L\": [sh + lp(7, 10)'), 'all three L/R pairs flipped together — no half-mirrored body');
  ok(app.includes('_siteMirrorFixed'), 'one-time migration flips pre-fix stored sites and flags itself done');
  ok(app.includes('are <b>your</b> left and right'), 'the caption teaches the mirror');
  ok(app.includes('>R</text>') && app.includes('>your right</text>'), 'radiograph-style R/L side markers on the avatar (his ask)');
}
// v0.9.43: the projection and the calendar agree on the next dose
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(app.includes('function MedLevelChart({ C, doseLog, med, dueISO, intervalDays })'), 'chart receives the due date AND the declared interval');
  // v0.9.57: cadence must come from the DECLARED schedule, never inferred from logged gaps when a
  // schedule exists — a Sunday start + Friday dose-day is a 5-day offset, not a 5-day schedule.
  ok(app.includes('const declared = (MEDS[med] && MEDS[med].cadence === "daily") ? 1 : (+intervalDays || 7)'), 'declared schedule wins over median-gap inference');
  ok(app.includes('dueISO={dueISO}'), 'renderGlp passes the SAME dueISO the calendar chip uses');
  ok(app.includes('const firstT = dueT && dueT > lastDose.t ? Math.max(dueT, now)'), 'first projected dose anchors to DUE (clamped to now if overdue), cadence after');
  ok(app.includes('const nextDoseT = (dueT && dueT > lastDose.t'), 'the ~X%-at-next-dose marker uses the same anchor — one screen, one story');
}
// v0.9.44: custom protocol engine + sleep. The app reports whether HIS conditions are met and
// never sets a dose — that boundary is structural, not stylistic, for a compound with no label.
{
  const app=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const srv=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(srv.includes('nm === \"sleep_analysis\"'), 'HAE sleep_analysis is ingested');
  // v0.9.96: the rule is unchanged — one number, hours at or under 24 and minutes above it — but
  // sleep now parses ahead of the qty guard, where the name q is still in its temporal dead zone,
  // so the same expression is written over v. The invariant is the arithmetic, not the letter.
  ok(srv.includes('v <= 24 ? v * 60 : v'), 'sleep accepts hours OR minutes without export-format archaeology');
  ok(srv.indexOf('if (nm === "sleep_analysis"') < srv.indexOf('const q = +pt.qty;'), 'sleep parses before the qty guard that once dropped it');
  ok(srv.includes('clean.sleepMin'), 'sleepMin survives into the stored day and the summary');
  ok(app.includes('function sleepRead(') && app.includes('function checkpointRead('), 'both engines are module-level and testable');
  ok(app.includes('i.appetite === \"returning\"'), 'escalation requires appetite RETURNING — a flat scale with appetite already gone is not an under-dosing signal');
  ok(app.includes('if (veto.length) return { ...base, status: \"veto\" }'), 'tolerability vetoes efficacy — the scale never outranks the heart');
  ok(app.indexOf('status: \"early\"') < app.indexOf('status: \"veto\"'), 'too-early is evaluated BEFORE any verdict (accumulation lag outranks everything)');
  ok(app.includes('checkpointAnswers'), 'the one asked marker is stored per rung, never assumed');
  ok(!/status: \"escalate\"[\s\S]{0,400}(next|target) *mg/.test(app), 'the escalate branch never names a target dose');
  ok(app.includes('never sets a dose'), 'the card says in the UI that it does not set doses');
  ok(app.includes('protocol: { ...(g.protocol || {}), rungs'), 'the user can author his own rungs — not locked to the trial ladder');
  // HIS design: the escalation verdict only speaks when asked, and the button cannot be pressed
  // before the hold completes. That single control replaced a lock + auto-re-arm + periodic review.
  ok(app.includes('Evaluate if a dose increase is suggested'), 'the escalation verdict is user-triggered, never volunteered');
  ok(app.includes('const locked = cp.days < cp.need;'), 'the button is gated on hold completion, not on a status string');
  ok(app.includes('Unlocks in {cp.need - cp.days} days'), 'a locked button says when it opens and why');
  ok(app.indexOf('Tolerability flags right now') < app.indexOf('{locked ?'), 'tolerability surveillance renders BEFORE the gate — safety is never opt-in');
  ok(app.includes('const stall = { on: flatWeeks >= 4 && belowGoal'), 'the stall watch requires being below goal — flat AT goal is maintenance');
  ok(app.includes('rateOver = (wk)'), 'stall uses a ROLLING window, so a long hold cannot smear a recent plateau into invisibility');
  ok(app.includes('worth running the checkpoint'), 'the stall notice INVITES an evaluation rather than delivering a verdict');
  ok(app.includes('goalWeight,'), 'goal weight reaches the engine');
}
// --- v0.9.45: protocol always renders; rungs field is typeable; no bare JSX escapes ---
{
  const app=SRC;
  ok(!app.includes('if (cp.status === "nodose") return null'), 'the nodose early return is gone — configuration never gates on the dose log');
  ok(app.includes('Waiting for your first logged dose'), 'the checkpoint has an honest empty state instead of vanishing');
  ok(app.indexOf('Waiting for your first logged dose') < app.indexOf('Tolerability flags right now'), 'the empty state lives inside the checkpoint card, above the gated content');
  // The rungs input must open a FULL keyboard: a comma-separated field with a number pad is untypeable.
  const rIn = app.slice(app.indexOf('Rungs (mg'), app.indexOf('Minimum hold before a checkpoint'));
  ok(!/inputMode/.test(rIn), 'the rungs input carries no inputMode — full keyboard, commas and spaces typeable');
  ok(app.includes('parseRungs(protoRungs)') && (app.match(/parseRungs\(protoRungs\)/g)||[]).length>=2, 'save AND preview run through the one parser');
  ok(app.includes('"Will save: "'), 'a live preview shows exactly what will parse before the tap');
  ok(app.includes('setProtoRungs(rungs.join(", "))'), 'opening edit seeds the field with the current rungs, never blank');
  // TRIPWIRE: a \uXXXX outside every string/template renders LITERALLY in JSX text (the circled \u00b7).
  // Char-walk the source tracking string state exactly; any escape surviving in code position is JSX text.
  const bare=(src)=>{const st=[];const out=[];for(let i=0;i<src.length;i++){const c=src[i],t=st[st.length-1];
    if(t==='d'){if(c==='\\')i++;else if(c==='"')st.pop();}
    else if(t==='s'){if(c==='\\')i++;else if(c==="'")st.pop();}
    else if(t==='t'){if(c==='\\')i++;else if(c==='`')st.pop();else if(c==='$'&&src[i+1]==='{'){st.push('x');i++;}}
    else{if(c==='/'&&src[i+1]==='/'){while(i<src.length&&src[i]!=='\n')i++;}
      else if(c==='/'&&src[i+1]==='*'){i+=2;while(i<src.length&&!(src[i]==='*'&&src[i+1]==='/'))i++;i++;}
      else if(c==='"')st.push('d');else if(c==="'")st.push('s');else if(c==='`')st.push('t');
      else if(t==='x'&&c==='}')st.pop();
      else if(c==='\\'&&src[i+1]==='u')out.push(i);}}
    return out;};
  const hits=bare(app);
  ok(hits.length===0, 'no bare unicode escapes in JSX text — found '+hits.length+(hits.length?' e.g. ...'+JSON.stringify(app.slice(Math.max(0,hits[0]-30),hits[0]+20)):''));
}
// --- v0.9.46: the dose-response card is honest by construction ---
{
  const app=SRC;
  ok(app.includes('function rungResponseRead('), 'the dose-response engine is module-level and testable');
  ok(app.includes('Your dose-response'), 'the card exists');
  ok(app.indexOf('Decisions stay with your prescriber') < app.indexOf('Your dose-response'), 'it renders BELOW the checkpoint, never inside it');
  ok(app.includes('Starts measuring with your first logged dose'), 'zero doses gets an honest empty state, not a hidden card');
  ok(app.includes('rhrBaseline: rr.status === "ready" ? rr.baseline : null'), 'RHR delta borrows the surveillance baseline only once it is banked');
  ok(app.includes('"PATTERN HOLDING"') && app.includes('"DIRECTIONAL"'), 'every row carries an evidence tier');
  ok(app.includes("Patterns, not prescriptions"), 'the footer keeps the house boundary in words');
}
{
  ok(SRC.includes('function rungCellTone('), 'cell tone is a module-level pure function, not inline styling');
  ok(SRC.includes('const TONE_C = { go: C.go, caution: C.caution, avoid: C.avoid, none: C.faint }'), 'tones map onto the theme palette, so every theme stays legible');
  ok(/rungCellTone\(kind, raw\)/.test(SRC), 'colour is computed from the RAW number, never the formatted string');
  // v0.9.69: labels moved to the chassis mono treatment; the INVARIANT stays: muted, never faint.
  ok(SRC.includes('letterSpacing: 1, color: C.muted, textTransform: "uppercase" }}>{lbl}'), 'column labels use muted, not faint — readable at small size');
}
// --- v0.9.47: symptom + dose instants — the phase-map's raw material starts accruing NOW ---
{
  // Both writers must stamp `at`. A phase-map needs BOTH ends of the hours-post-dose interval,
  // and every entry logged without a time is data that engine can never use.
  const seW = SRC.slice(SRC.indexOf('function addSideEffect()'), SRC.indexOf('function addSideEffect()') + 320);
  ok(/date: todayISO\(\), at: new Date\(\)\.toISOString\(\)/.test(seW), 'the symptom writer stamps date (day-clock bucket) AND at (exact instant)');
  const dW = SRC.slice(SRC.indexOf('doseLog: [...log,'), SRC.indexOf('doseLog: [...log,') + 200);
  ok(/date: today, at: new Date\(\)\.toISOString\(\)/.test(dW), 'the dose writer stamps at too — hours-post-dose has two ends');
  ok(SRC.includes('{s.at ? " " + new Date(s.at).toLocaleTimeString'), 'the row shows the clock time only when the entry carries one — pre-fix entries render unchanged');
}
// --- v0.9.48: the prescriber report knows what the app knows ---
{
  const R = SRV.slice(SRV.indexOf('app.post("/api/report/pdf"'));
  ok(/Measured response at each dose/.test(R), 'the report leads with the per-rung dose-response table');
  ok(R.indexOf('Measured response at each dose') < R.indexOf('What the app has learned'), 'it leads — the unprecedented section is page one, not an appendix');
  ok(/Patient-authored protocol/.test(R) && /Tolerability surveillance/.test(R), 'protocol/checkpoint and surveillance sections exist');
  ok(/DIRECTIONAL/.test(R) && /HOLDING/.test(R), 'evidence tiers survive into print — a clinician sees which rows are provisional');
  ok(/MEASURED|origin === "measured"/.test(R), 'the checkpoint ledger prints per-marker provenance');
  ok(/ADA Standards of Care rec 8\.20/.test(R), 'the guideline framework is named so the prescriber sees the basis');
  ok(/does not recommend a dose/.test(R), 'the report states its own boundary in print');
  ok(/own banked baseline, never a population norm/.test(R), 'surveillance explains it is judged against the patient, not a norm');
  ok(/color:#1a2430;background:#fff/.test(R) && /color-scheme:light only/.test(R), 'the report declares its white paper — a dark-mode viewer can never render ink-on-ink');
  // the client must gather every engine the server templates — server holds NO physiology
  ok(/rungResponse: rungResponseRead\(/.test(SRC) && /checkpoint: checkpointRead\(/.test(SRC), 'client computes the engines once and ships results');
  ok(/surveillance: \{ rhr: _rhrRpt, sleep: _sleepRpt \}/.test(SRC), 'surveillance findings reach the payload');
  ok(!/function (checkpointRead|rungResponseRead|rhrRead|sleepRead)\(/.test(SRV), 'no engine is duplicated server-side — one implementation, one place to be wrong');
}
// --- v0.9.68: Readiness must never invent a signal it does not have ---
// The whole card is only trustworthy if a missing input is EXCLUDED, not defaulted. A zero-filled
// RHR or a guessed sleep would silently drag the score and bend his session for no reason.
{
  const app=SRC;
  ok(/function readinessRead\(/.test(app), 'readiness is a module-level engine, testable like the others');
  ok(/if \(rhr && rhr\.status === "ready"\)/.test(app), 'RHR contributes only once its baseline is banked');
  ok(/if \(sd\.length\) \{/.test(app), 'sleep contributes only when a night is actually synced');
  ok(/if \(c28 > 0\) \{/.test(app), 'load contributes only when there is a chronic baseline to compare against');
  ok(/if \(!parts\.length\) return \{ status: "nodata"/.test(app), 'no measured inputs means no score at all — never a default');
  ok(/parts\.reduce\(\(n, p\) => n \+ p\.score \* p\.w, 0\) \/ wsum/.test(app), 'the score is weighted over PRESENT parts only');
  ok(/rd\.status !== "ok"\) return null/.test(app), 'the card renders nothing rather than an empty gauge');
  // the band describes the SESSION, never the person
  ok(/Top sets held, back-offs trimmed one set/.test(app), 'a gentle day states what changes in the session');
  ok(!/you are (weak|unfit|tired)/i.test(app), 'the copy never characterises the person');
}


// v0.9.103: compact density
{
  const A9=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const _cmp = !!prefs\.compact;/.test(A9),'density reads from one stored preference');
  // v0.9.105: the radii moved a point when the collapsed row landed; the invariant is that ONE
  // helper owns card geometry, not the exact numbers.
  ok(/borderRadius: _cmp \? 1[45] : 18, padding: _cmp \? 1[12] : 16/.test(A9),'the card primitive is the only place geometry changes');
  ok((A9.match(/const cardShell = /g) || []).length === 1,'exactly one card shell draws every card');
  ok(/marginBottom: _cmp \? 7 : 10/.test(A9),'section titles tighten with it');
  ok(!/_cmp \?[^:]*display: "none"/.test(A9),'compact never hides anything');
  ok(!/_cmp \?[^:]*fontSize: [0-9]\b/.test(A9),'compact never shrinks a reading below legibility');
  ok(/row\("Card density"/.test(A9),'the setting is reachable');
}


// v0.9.105: the collapsed row and its sheet
{
  const AA=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  // v0.9.119: children moved from state into a ref re-registered every render. Holding them in
  // state froze the card at open time, so interactive cards — the injection map — went dead.
  ok(/sheetKidsRef\.current\[vd\.id\] = children;/.test(AA),'every render re-registers the card\'s live children');
  ok(/\{sheetKidsRef\.current\[sheetCard\.id\]\}/.test(AA),'the sheet renders the live children, not a captured copy');
  ok(!/setSheetCard\(\{ \.\.\.vd, children \}\)/.test(AA),'children are never stored in state again');
  // v0.9.106: six GLP-1 cards now carry a verdict — three readings, three states.
  // distinct ids, not occurrences — a card may declare a verdict twice (empty state and normal).
  ok(new Set((AA.match(/id: "(?:med|rhr|sleep|cp|tit|se|site|cal)"/g) || [])).size === 8,'exactly eight GLP-1 cards carry a verdict');
  // v0.9.122: Body joins in — composition and photos. The forms, the report action and the
  // Forecaster's two renders stay whole; a card whose content IS an image cannot summarise itself.
  ok(new Set((AA.match(/id: "(?:comp|pho|wt|wk|fc|ah|at|dr)"/g) || [])).size === 8,'the eight Body cards that earn a verdict have one');
  // v0.9.125: the health card names its real source when the sync recorded one. It is titled
  // Health data because the chain is not always Apple — his runs Fitbit through Google into Apple.
  ok(/sectionTitle\("Health data"\)/.test(AA),'the health card is not branded to one platform');
  ok(!/Apple Health · feeds/.test(AA),'the hardcoded Apple Health title is gone');
  ok(/"apple-health": "Apple Health", "google-health": "Google Health"/.test(AA),'the row names whichever platform actually synced');
  ok(!/sectionTitle\("Path to your forecast", C\.muted\)/.test(AA),'the weight card no longer shares the forecast card\'s name');
  // v0.9.123: adherence is computed once. WeeklyCard caps each day at its goal before averaging —
  // a 300g day cannot pay for a 60g one — and the collapsed row must show that same number.
  ok((AA.match(/function weekAdherence/g) || []).length === 1,'one adherence computation exists');
  ok((AA.match(/= weekAdherence\(mealLog, /g) || []).length === 2,'the card and the row both call it');
  ok(/Math\.min\(1, p \/ Math\.max\(1, proteinGoal\)\)/.test(AA),'each day is still capped at its goal');
  ok(!/id: "(?:stats|forecaster|prescriber)"/.test(AA),'the measurement form, the Forecaster and the report stay whole');
  // the collapsed composition row must say WHICH source, or it implies precision it may not have
  const cp3 = AA.slice(AA.indexOf('id: "comp"'), AA.indexOf('id: "comp"') + 600);
  ok(/bfMeasured \? "Measured" : "Estimated"/.test(cp3),'the composition row states measured or estimated');
  ok(/tone: bfMeasured \? C\.go : "none"/.test(cp3),'an estimate shows a hollow dot, not a solid one');
  // the collapsed site map must BE the avatar, not a second drawing of it
  const sr = AA.slice(AA.indexOf('id: "site"') - 1200, AA.indexOf('id: "site"') + 900);
  ok(/spark: \(<div[^>]*>\s*<SiteAvatar/.test(sr.replace(/\n\s*/g, ' ')),'the collapsed site spark renders the real SiteAvatar');
  ok(/pointerEvents: "none"/.test(sr),'the collapsed avatar is inert');
  ok((AA.match(/function siteRotation/g) || []).length === 1,'one rotation board exists');
  // v0.9.116: the destructure grew when the extraction was found to have stranded cyc and sited —
  // pin that the avatar consumes the shared board, not the exact field list.
  ok(/const \{ [^}]*suggested[^}]*\} = siteRotation\(/.test(AA),'the avatar consumes it too');
  ok(/const \{ [^}]*\bcyc\b[^}]*\} = siteRotation\(/.test(AA),'the avatar receives the cycle length it draws with');
  // the calendar row must handle due-today and overdue, not just a countdown
  const cr = AA.slice(AA.indexOf('id: "cal"') - 900, AA.indexOf('id: "cal"') + 700);
  ok(/dueToday/.test(cr) && /overdue/.test(cr),'the calendar row has due-today and overdue states');
  // the med row must read the shared model, never a formula of its own
  ok(/const _M = medLevelModel\(/.test(AA),'the med row calls the same model the chart draws');
  ok(!/0\.35 \+ dl\.length \* 0\.22/.test(AA),'the invented med-level approximation is gone');
  ok((AA.match(/function medLevelModel/g) || []).length === 1,'one med model exists');
  ok(/const M = medLevelModel\(/.test(AA),'the chart consumes it too — one source, not two');
  ok(/id: "cp"/.test(AA) && /id: "tit"/.test(AA) && /id: "se"/.test(AA),'checkpoint, titration and the journal are wired');
  // each must read from its own source, never a literal
  const cp2 = AA.slice(AA.indexOf('id: "cp"') - 700, AA.indexOf('id: "cp"') + 700);
  ok(/cp\.veto/.test(cp2) && /minHoldDays/.test(cp2),'the checkpoint row reads the gate, not a number');
  const ti = AA.slice(AA.indexOf('id: "tit"') - 700, AA.indexOf('id: "tit"') + 500);
  // v0.9.108: the row derives its own ladder rather than borrowing a caller's local — that borrow
  // is exactly what crashed on his phone, so the assertion now pins the self-contained form.
  ok(/glp\.doseLog/.test(ti) && /_rungs9\.findIndex/.test(ti),'the titration row counts his real ladder and doses');
  ok(/const _rungs9 = /.test(ti) && /const _cur9 = /.test(ti),'the titration row declares its own locals');
  const se2 = AA.slice(AA.indexOf('id: "se"') - 900, AA.indexOf('id: "se"') + 500);
  ok(/glp\.sideEffects/.test(se2) && /severity/.test(se2),'the journal row weighs severity, not just a count');
  ok(/tone: !se\.length \? "none"/.test(se2),'no symptoms logged shows a hollow dot, not a green all-clear');
  // v0.9.115: he asked for the calendar and the injection map, so the line moved — but it still
  // exists. The protocol ladder, the on-med nudges and the journey stages stay whole.
  ok(!/id: "(nudge|proto|journey)"/.test(AA),'the ladder, the nudges and the stages are NOT collapsed');
  ok(/id: "site"/.test(AA) && /id: "cal"/.test(AA),'the injection map and the calendar carry verdicts');
  ok(/const _spark = \(vals, col, band\)/.test(AA),'one sparkline helper for every row');
  ok(/if \(v\.length < 2\) return null;/.test(AA),'a single reading draws no sparkline rather than a fake line');
  // the row must read from the engines, never from a literal
  const rhr = AA.slice(AA.indexOf('id: "rhr"'), AA.indexOf('id: "rhr"') + 700);
  ok(/_rr\.current/.test(rhr) && /_rr\.baseline/.test(rhr),'the RHR row reads from rhrRead, not a hardcoded number');
  ok(/_rr\.status !== "ready"/.test(rhr),'a card still learning shows its count, not a verdict');
}


// v0.9.107: overlays must clear the notch and the home indicator. The detail sheet is anchored to
// the TOP, so without a top inset its back button sits under the status bar and is untappable.
{
  const AB=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const sh=AB.slice(AB.indexOf('{sheetCard && ('), AB.indexOf('{sheetCard && (') + 1400);
  ok(/env\(safe-area-inset-top/.test(sh),'the detail sheet header clears the notch');
  ok(/env\(safe-area-inset-bottom/.test(AB.slice(AB.indexOf('{sheetCard && ('), AB.indexOf('{sheetCard && (') + 2000)),'the detail sheet body clears the home indicator');
  ok((AB.match(/padding: "20px 20px calc\(28px \+ env\(safe-area-inset-bottom/g) || []).length === 2,'both bottom sheets clear the home indicator');
}


// v0.9.110: the model lift dropped bindings the chart still used, and a ReferenceError shipped.
// Pin the contract statically: everything the model returns is destructured by the chart.
{
  const AC=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const ret=/\n  return \{ ([^\n]+?) \};\n\}\n/.exec(AC.slice(AC.indexOf('function medLevelModel')));
  const dst=/  const \{ ([^\n]+?) \} = M;/.exec(AC.slice(AC.indexOf('function MedLevelChart')));
  ok(!!ret && !!dst,'model return and chart destructure both found');
  if (ret && dst) {
    const R=new Set(ret[1].split(',').map(x=>x.trim()));
    const D=dst[1].split(',').map(x=>x.trim());
    const missing=D.filter(n=>!R.has(n));
    ok(missing.length===0,'chart destructures nothing the model does not return: '+missing.join(','));
    ok(R.has('scrolls') && R.has('nowY') && R.has('H'),'the bindings the crash exposed are returned');
  }
  // the checkpoint row must use the engine's real field names
  const cpb=AC.slice(AC.indexOf('id: "cp"')-900, AC.indexOf('id: "cp"'));
  ok(/\+cp\.days/.test(cpb),'the checkpoint row reads cp.days');
  ok(!/cp\.daysHeld|cp\.have/.test(cpb),'no invented checkpoint field names remain');
}


// v0.9.118: type scale. Every inline fontSize went up 1px; these are the rows where width is
// actually constrained, measured at mono 0.60em and Inter 0.52em on the narrowest phone (375pt).
{
  const AD=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const MONO=0.60, INTER=0.52;
  const need=(t,size,ls,pad,mono)=>t.length*size*(mono?MONO:INTER)+t.length*ls+pad;
  // v0.9.121: sizes tracked the second bump. The measurement is the pin, not the numbers.
  const rows=[["dose-sync pills",7,315,"Today",10.5,0.2,4,0,true],
              ["calendar day numbers",7,307,"31",11,1.0,5,0,true],
              ["tab bar labels",7,375,"Today",11,0,0,6,false],
              ["readiness 4-slot",4,307,"POST-DOSE",10.5,0.9,9,0,true],
              ["med level cells",4,307,"NEXT DOSE",10.5,1.0,9,0,true],
              ["sleep stage labels",4,307,"LIGHT",10.5,0.6,3,0,true]];
  for (const [nm,n,cw,t,size,ls,gap,pad,mono] of rows) {
    const avail=(cw-gap*(n-1))/n;
    ok(need(t,size,ls,pad,mono)<=avail, nm+" fits on one line at the current type size");
  }
  // the smallest readable size in the app — nothing may go below it
  const sizes=(AD.match(/fontSize: ([0-9.]+)/g)||[]).map(x=>parseFloat(x.split(': ')[1]));
  ok(Math.min(...sizes)>=10.5,'the smallest type in the app is 10.5px');
  ok(sizes.filter(v=>v<10.5).length===0,'nothing renders below 10.5px anywhere in the app');
}


// v0.9.124: stacking. The detail sheet is a page and every modal must be able to open ON TOP of it.
{
  const AE=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const sheetZ=/zIndex: (\d+), overflowY: "auto", WebkitOverflowScrolling/.exec(AE);
  ok(!!sheetZ,'the detail sheet declares a z-index');
  const z=sheetZ?+sheetZ[1]:0;
  ok(z>45,'the sheet covers the sticky header');
  for (const m of ['logOpen','simOpen','settingsOpen']) {
    const i=AE.indexOf('{'+m+' && (');
    const mz=/zIndex: (\d+)/.exec(AE.slice(i, i+420));
    ok(mz && +mz[1]>z, m+' opens above the sheet, not behind it');
  }
}

console.log('\nSTRUCT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
