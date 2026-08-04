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
  ok(/color: C\.muted, textTransform: "uppercase"[^>]*\}\}>\{lbl\}/.test(SRC), 'column labels use muted, not faint — readable at small size');
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


// v0.9.126: medication names must never be cut. Three 11-character names need 384px at the old
// padding, in a 307px card — a horizontal scroller hid the third behind the edge.
{
  const AF=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const row=AF.slice(AF.indexOf('Object.entries(MEDS).filter(([, m]) => (m.cadence === "daily" ? "oral" : "inj") === form)') - 220,
                     AF.indexOf('Object.entries(MEDS).filter(([, m]) => (m.cadence === "daily" ? "oral" : "inj") === form)') + 320);
  ok(/flexWrap: "wrap"/.test(row),'the medication chips wrap rather than scroll out of view');
  ok(!/overflowX: "auto"/.test(row),'no horizontal scroller hides a medication name');
  // widest name on the narrowest phone must fit within one row's width
  const w = 11 * 12.5 * 0.60 + 11 * 1.1 + 20;
  ok(w <= 307,'the longest medication chip fits the card on a 375pt phone');
}


// v0.9.127: one card width per tab, and a collapsed row shows a trend when one exists.
{
  const AG=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const tab=AG.slice(AG.indexOf('{tab === "body" && <div>'), AG.indexOf('{renderBody()}'));
  // v0.9.136: one flex column for the whole tab. Two containers meant order could only sort within
  // each, so the engine cards and the rest of Body could never swap places.
  ok(/\{tab === "body" && <div style=\{\{ padding: "0 18px 12px", display: "flex", flexDirection: "column" \}\}>/.test(AG),'the Body tab is a single flex column');
  ok(/const renderBody = \(\) => \(\s*<div style=\{\{ display: "contents" \}\}>/.test(AG),'renderBody joins that column rather than making its own');
  ok(/order: -1/.test(AG),'the heading stays above every card');
  // rows with a real series carry a sparkline; rows still collecting must NOT invent one
  for (const id of ['fc','ah','wt','wk','comp','pho']) {
    const seg=AG.slice(AG.indexOf('id: "'+id+'"'), AG.indexOf('id: "'+id+'"') + 1600);
    ok(/spark:/.test(seg), id+' shows its trend in the collapsed row');
  }
  for (const id of ['at','dr']) {
    const seg=AG.slice(AG.indexOf('id: "'+id+'"'), AG.indexOf('id: "'+id+'"') + 900);
    ok(!/spark:/.test(seg), id+' draws no sparkline while it is still collecting');
  }
  // and the two engines must read the fields their own functions return
  ok(/ar && ar\.pts != null/.test(AG),'adaptive targets reads adaptiveRead.pts');
  ok(/dr && dr\.sym != null/.test(AG),'dose response reads doseResponseRead.sym');
  ok(!/ar\.have|dr\.symDays|dr\.mealDays/.test(AG),'no invented engine field names remain');
}


// v0.9.130: the medication chips share the row equally instead of hugging their text, so the
// leftover space is used. 12px is the largest that still fits RETATRUTIDE inside a 375pt chip.
{
  const AK=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const i=AK.indexOf('flexWrap: "wrap" }}>{Object.entries(MEDS)');
  const row=AK.slice(i, AK.indexOf('</button>', i));
  ok(/flex: "1 1 0"/.test(row),'the chips share the row rather than sizing to their text');
  ok(/textAlign: "center"/.test(row),'and their labels are centred in the space they get');
  ok(!/overflowX: "auto"/.test(row),'no horizontal scroller hides a medication name');
  const chip=(307-16)/3, text=11*12*0.60 + 11*0.4;
  ok(text <= chip-12,'the longest name fits its chip on a 375pt phone');
  ok(11*13*0.60 + 11*0.4 > chip-12,'and 12px is the largest size that does');
  ok(/padding: "0 18px 12px"/.test(AK),'renderBody adds no extra gap under the engine cards');
}


// v0.9.130: the palette check now measures HUE. The previous version compared variable names for
// inequality, so C.gold and C.caution passed as "distinct" while sitting 7 degrees apart and looking
// identical on screen. A test that cannot fail is worse than no test.
{
  const AJ=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const hue=(hex)=>{ const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn; if(!d) return 0;
    let h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4; h*=60; return (h+360)%360; };
  const sep=(a,b)=>{ const d=Math.abs(a-b); return Math.min(d,360-d); };
  const colOf=(id)=>{ const i=AJ.indexOf('id: "'+id+'"'); const m=/_spark\([^,]+, "(#[0-9A-Fa-f]{6})"/.exec(AJ.slice(i, i+1900)); return m?m[1]:null; };
  const ids=['fc','ah','wt','wk','comp'], cols=ids.map(colOf);
  ok(cols.every(Boolean),'every Body sparkline declares a literal colour, not a token');
  if (cols.every(Boolean)) {
    const hs=cols.map(hue);
    let worst=360, pair='';
    for (let i=0;i<hs.length;i++) for (let j=i+1;j<hs.length;j++) {
      const d=sep(hs[i],hs[j]); if (d<worst) { worst=d; pair=ids[i]+'/'+ids[j]; }
    }
    ok(worst>=25,'no two Body sparklines are within 25 degrees of hue: closest '+pair+' at '+Math.round(worst));
    // violet is medication, red is heart rate — neither may appear on a Body chart
    for (const [name,res] of [['violet',253],['red',0]])
      ok(hs.every((h)=>sep(h,res)>=25), 'no Body sparkline strays into '+name);
  }
  const sub=/\{vd\.sub && <div style=\{\{[^}]*\}\}/.exec(AJ);
  ok(sub && !/textOverflow: "ellipsis"/.test(sub[0]),'the collapsed sub wraps instead of truncating');
  const ph=AJ.slice(AJ.indexOf('id: "pho"'), AJ.indexOf('id: "pho"') + 1200);
  ok(/spark: null/.test(ph),'the photos row draws no thumbnail strip');
}


// v0.9.133: the drag faults. Each of these was a silent no-op or an iOS default fighting the
// gesture, and each is now a measurement rather than an assumption.
{
  const AN=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const ARRANGE_TABS = \["today", "body", "glp"\]/.test(AN),'Today, Body and GLP-1 are arrangeable');
  // order only takes effect inside a flex column — Today was not one, so every drag there did nothing
  ok(/const renderToday[\s\S]{0,4000}?return \(\s*<div style=\{\{[^}]*flexDirection: "column"/.test(AN),'Today renders its cards in a flex column');
  ok(/\{tab === "body" && <div style=\{\{ padding: "0 18px 12px", display: "flex", flexDirection: "column" \}\}>/.test(AN),'Body does too, as one column for the whole tab');
  ok(AN.includes('const renderGlp = () => (\n    <div style={{ padding: "18px 18px 12px", display: "flex", flexDirection: "column" }}>'),'and GLP-1');
  // a card inside a wrapper is not a flex child, so it cannot move
  ok(!/<div style=\{\{ marginBottom: \d+ \}\}>\s*\{?\s*card\(/.test(AN),'no card is trapped inside a spacing wrapper');
  ok((AN.match(/<div style=\{\{ display: "contents" \}\}>/g) || []).length >= 25,'those wrappers are transparent instead');
  // making them transparent removed the spacing they used to provide
  ok(/marginBottom: _cmp \? 9 : 14/.test(AN),'the card supplies its own spacing now the wrapper cannot');
  // iOS raises a selection callout on a long press unless told not to
  ok(/WebkitTouchCallout: arrangeable/.test(AN),'holding a card does not raise the selection callout');
  ok(/WebkitUserSelect: arrangeable/.test(AN),'and selects no text');
  // v0.9.134: pan-y was the bug, not the fix — it hands vertical movement to the browser, which
  // then ignores preventDefault and cancels the pointer. Unset until lifted, none while dragging.
  ok(/touchAction: lifted \? "none" : undefined/.test(AN),'the page scrolls normally until a card is lifted');
  ok(!/touchAction[^\n]*pan-y/.test(AN),'nothing declares pan-y on a draggable card');
  ok(/document\.addEventListener\("touchmove", onDocMove, \{ passive: false \}\)/.test(AN),'the drag is driven by a non-passive listener the browser cannot cancel');
  ok(/> 12\) clearTimeout\(holdRef\.current\)/.test(AN),'only real movement cancels the hold, not finger jitter');
  ok(/d\.startY \+= \(after - before\)/.test(AN),'the card rebases on reorder so it stays under the finger');
  ok(/dragRef\.current = \{ id: null, startY: 0, dy: 0, order: null \};\s*setArrangeTab\(null\);/.test(AN.replace(/\n\s*/g,' ')),'dropping ends the session — there is no Done step');
  ok(/removeEventListener\("touchmove", onDocMove/.test(AN),'and the listeners come off');
  ok(!/>Done<\/button>/.test(AN),'and no bar at the bottom');
  ok(/transform: lifted \? `translateY\(\$\{dragRef\.current\.dy\}px\) scale\(1\.03\)`/.test(AN),'the held card lifts and follows the finger');
  ok(/r\.top \+ r\.height \/ 2/.test(AN),'the drop slot comes from real card midpoints');
}


// v0.9.135: card ids must not drift between renders. The counters are per-render; when they were
// left to accumulate, the duplicate-id guard rewrote every text-derived id each time, so only
// verdict cards could be dragged. SSR cannot reproduce it (a fresh component resets its own refs),
// so the reset is pinned statically and the derivation is exercised directly here.
{
  const AO=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/seqRef\.current = 0;/.test(AO),'the sequence resets every render');
  ok(/idSeenRef\.current = \{\};/.test(AO),'and so does the duplicate-id table');
  const body=AO.slice(AO.indexOf('seqRef.current = 0;'));
  ok(body.indexOf('const _cmp') < body.indexOf('const card ='),'the reset runs before any card is built');
  ok(AO.indexOf('const idSeenRef = useRef') < AO.indexOf('idSeenRef.current = {};'),'idSeenRef is declared before it is reset');
  ok(/data-card-id=\{id \|\| undefined\}/.test(AO),'each card exposes its id, so drift is observable');
  // the derivation itself, run twice with a persistent counter — the live-browser condition
  const mk = () => { let seq = 0; const seen = {};
    return (text) => { const s = seq++; let id = text; if (seen[id] != null && seen[id] !== s) id = id + "-" + s; seen[id] = s; return id; }; };
  const withReset = () => { const f = mk(); return ["counters","log-a-meal"].map(f); };
  const f2 = mk();
  const r1 = ["counters","log-a-meal"].map(f2), r2 = ["counters","log-a-meal"].map(f2);
  ok(r1.join() !== r2.join(),'without a reset the ids provably drift — this is the bug');
  ok(withReset().join() === withReset().join(),'with a reset they are identical every render');
}


// v0.9.136: one column, one ladder, and a drag that does not repaint the app per frame.
{
  const AP=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/\{tab === "body" && <div style=\{\{ padding: "0 18px 12px", display: "flex", flexDirection: "column" \}\}>/.test(AP),'Body is one flex column');
  ok(!/<div style=\{\{ padding: "0 18px", display: "flex", flexDirection: "column" \}\}>/.test(AP),'the engine block no longer makes a second column');
  ok(/order: -1/.test(AP),'the heading sits above every card whatever the saved order says');
  // the flicker: a React render per touchmove re-ran every engine on the tab
  ok(/el\.style\.transform = `translateY\(\$\{d\.dy\}px\) scale\(1\.03\)`/.test(AP),'the drag writes the transform to the node directly');
  ok(/if \(d\.order !== before\) rerender\(\);/.test(AP),'React only re-renders when the order actually changes');
  ok(/if \(el0\) el0\.style\.transform = "";/.test(AP),'and the node is handed back to React on drop');
  // the two ladders were the same rungs twice
  ok(!/sectionTitle\("Titration ladder"\)/.test(AP),'the duplicate titration ladder card is gone');
  // v0.9.137: REVERSED. Making the rungs tappable put a silent dose change one stray touch away on
  // a medication card, and it wrote a stored value the rest of the tab does not read. A dose is
  // recorded by logging one, nowhere else.
  ok(!/onClick=\{\(\) => setGlp\(\{ \.\.\.glp, dose: \+r/.test(AP),'a tap on a rung cannot change the recorded dose');
  // one source of truth: what is displayed comes from the log whenever a log exists
  ok(/current dose \{\(\(\) => \{ const L = \(glp\.doseLog/.test(AP.replace(/\n\s*/g,' ')),'the med card shows the last logged dose, not a separate stored number');
  ok(/dose: log\.length \? \+log\[log\.length - 1\]\.mg : g\.dose/.test(AP),'removing a dose puts the stored dose back in step with the log');
}


// v0.9.138: the last dose derives from the log, and the injection countdown merged into the calendar.
{
  const AQ=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const lastDoseEntry = /.test(AQ),'a single derived last-dose exists');
  ok(/L\.reduce\(\(a, b\) => \(a\.date >= b\.date \? a : b\)\)/.test(AQ),'and it is newest-DATE wins, not last-array-entry');
  ok(!/glp\.lastInjection \? new Date/.test(AQ),'the next-shot maths reads the derived date, not the stored copy');
  ok(!/Last dose: \$\{fmtDate\(glp\.lastInjection\)\}/.test(AQ),'no display reads the stored copy either');
  ok(!/"Next dose" : "Next injection"/.test(AQ),'the separate countdown card is gone');
  const cal=AQ.slice(AQ.indexOf('{card(<><DoseCalendar'), AQ.indexOf('{card(<><DoseCalendar') + 3400);
  ok(/onClick=\{logInjection\}/.test(cal),'Log dose lives in the calendar card now');
  ok(/Last dose \$\{fmtDate\(lastDoseDate\)\}/.test(cal),'with the last-dose line beside it');
  // v0.9.139: the button moved to the site card, where the site it saves is chosen — logInjection
  // records pendingSite, and picking a site then scrolling elsewhere to press the button was how a
  // selection silently evaporated. Pill mode has no site card, so the calendar keeps a copy gated
  // to daily cadence. Exactly one button is ever VISIBLE; two exist in source, one per mode.
  ok((AQ.match(/onClick=\{logInjection\}/g) || []).length === 2,'one Log dose button per mode exists in source');
  const siteCard=AQ.slice(AQ.indexOf('id: "site"') - 2600, AQ.indexOf('id: "site"'));
  ok(/onClick=\{logInjection\}/.test(siteCard),'the injectable button lives in the site card');
  ok(/pendingSite \? `Log [^`]{1,6}\$\{pendingSite\}` : "Log dose"/.test(AQ),'and shows the site it is about to save');
  const calRow=AQ.slice(AQ.indexOf('medObj.cadence === "daily" && (() => { const _wk'), AQ.indexOf('medObj.cadence === "daily" && (() => { const _wk') + 900);
  ok(/onClick=\{logInjection\}/.test(calRow),'the calendar copy exists only behind the daily-pill gate');
}


// v0.9.140: EVERY card on an arrangeable tab must be a direct flex item. Two Today cards were not —
// one lived in a clickable margin wrapper my transparency pass skipped because it carried a handler,
// one in a bare div — so drags computed positions the layout then ignored, differently per card.
{
  const AR=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const tabs=[['Today','const renderToday = () => {'],['Body','{tab === "body" && <div style={{'],['GLP-1','const renderGlp = () => (']];
  for (const [name, probe] of tabs) {
    const i=AR.indexOf(probe);
    const end=AR.indexOf('\n  const render', i + 20);
    const blk=AR.slice(i, end > i ? end : i + 60000);
    let bad=0;
    const re=/\bcard\(/g; let mm;
    while ((mm = re.exec(blk))) {
      const pre = blk.slice(Math.max(0, mm.index - 70), mm.index).replace(/\s+/g, ' ');
      // a card can also be the return of an IIFE whose invocation is the direct child — the
      // wrapper check then applies to the IIFE, which the "return card(" form denotes
      const isReturn = /return\s*$/.test(pre);
      if (!isReturn && !/display: "contents" \}\}>\{\s*$/.test(pre)) bad++;
    }
    ok(bad === 0, name + ': every card is a direct flex item (' + bad + ' wrapped)');
  }
}


// v0.9.141: dosing interval is per medication, and the card states what a shorter one does.
{
  const AS=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/\(\(prefs\.medIntervalDays \|\| \{\}\)\[glp\.med\]\)/.test(AS),'the interval is looked up per medication');
  ok(!/intervalDays: medObj && medObj\.cadence === "daily" \? 1 : \(prefs\.injIntervalDays/.test(AS),'the med-level chart uses that same interval');
  ok(/const hl = \{ semaglutide: 7, tirzepatide: 5, retatrutide: 6 \}/.test(AS),'each drug carries its published half-life');
  ok(/1 \/ \(1 - Math\.pow\(0\.5, d \/ hl\)\)/.test(AS),'accumulation is computed, not asserted');
  ok(/a higher trough, not a flatter curve/.test(AS),'and the card says what a shorter interval actually does');
  ok(/Trials for this drug ran weekly only/.test(AS),'an investigational drug says its trials ran weekly');
}


// v0.9.142: dose is per medication. mg do not carry across these molecules — 2 mg of retatrutide is
// not 2 mg of semaglutide — and the derived last dose was reading the whole log regardless of drug.
{
  const AT=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const mine = all\.filter\(\(d\) => d\.med === glp\.med\);/.test(AT),'the last dose is scoped to the selected medication');
  ok(/all\.filter\(\(d\) => !d\.med\)/.test(AT),'entries logged before drugs were tagged still count, but only as a fallback');
  ok(!/steps\.reduce\(\(a, b\) => Math\.abs\(b - \(glp\.dose/.test(AT),'switching no longer maps your dose onto the nearest rung of another drug');
  ok(/const start = resume != null \? resume : \(steps\.length \? steps\[0\] : glp\.dose\);/.test(AT),'an unused drug starts at its lowest rung');
  ok(/priorForK\.reduce\(\(a, b\) => \(a\.date >= b\.date \? a : b\)\)/.test(AT),'a drug you have used before resumes where you left it');
}


// v0.9.143: lab panel and the four symptom additions.
{
  const AU=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const LAB_MARKERS = \[/.test(AU),'the marker table exists');
  ok(/key: "lipase"[\s\S]{0,160}required: true/.test(AU),'lipase is marked required — it is not on a standard panel');
  ok(/key: "amylase"[\s\S]{0,160}required: true/.test(AU),'so is amylase');
  // the flag threshold is the trial's, not the top of the reference range
  ok(/key: "alt"[\s\S]{0,120}hi: 46,\s*flagAt: 138/.test(AU),'ALT flags at 3x the upper limit, not at 46');
  ok(/if \(m\.flagAt != null && v >= m\.flagAt\) return "flag";/.test(AU),'a flag outranks merely out-of-range');
  ok(/if \(v < m\.lo \|\| v > m\.hi\) return "out";/.test(AU),'and out-of-range is still reported');
  // newest-date wins, same rule as the dose log
  ok(/withVal\[withVal\.length - 1\]\.values\[key\]/.test(AU),'the latest value is the newest draw');
  ok(/labs, eatenDate:/.test(AU),'labs ride the state blob');
  ok(/if \(s\.labs\) setLabs\(s\.labs\);/.test(AU),'and are read back on load');
  ok(/Import a lab report/.test(AU),'the button is lab-agnostic');
  ok(/records and compares \u2014 it never interprets/.test(AU) || /records and compares/.test(AU),'the card states that it does not interpret');
  // symptoms
  for (const sx of ["Vomiting","Abdominal pain","Skin tingling","Palpitations"])
    ok(new RegExp('"' + sx + '"').test(AU), 'the journal can log ' + sx.toLowerCase());
  ok(/e\.symptom === "Abdominal pain" && e\.severity === "severe"/.test(AU),'severe abdominal pain is recognised');
  ok(/needs a clinician the same day/.test(AU),'and says so once, on the journal');
}


// v0.9.144: lab report import. The parser proposes, the human confirms — a misread lab value that
// silently entered the record would be worse than no value at all.
{
  const AV=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const SV=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(/app\.post\("\/api\/labs\/parse"/.test(SV),'the parse route exists');
  ok(/const LAB_KEYS = \[/.test(SV),'it accepts only known marker keys');
  ok(/if \(Number\.isFinite\(v\)\) values\[k\] = v;/.test(SV),'non-numeric output is dropped rather than stored');
  ok(/never guess a value/.test(SV),'the prompt forbids guessing a value');
  ok(/never carry a reference range in as a result/.test(SV),'and forbids reading a reference range as a result');
  ok(/pdfText\(Buffer\.from\(pdf, "base64"\)\)/.test(SV),'a PDF is read through the existing extractor');
  ok(/accept="application\/pdf,image\/\*"/.test(AV),'the picker takes a PDF or a photo of one');
  // nothing is written by the parser
  ok(/setLabDraft\(\{ date: j\.date \|\| todayISO\(\)/.test(AV),'a parsed report lands in a DRAFT, not in the record');
  ok(!/setLabs\(\[\.\.\.\(labs \|\| \[\]\), \{ id: uid\(\), date: j\./.test(AV),'the parser never saves directly');
  ok(/Check every number against your report before saving/.test(AV),'the draft says to check the numbers against the source');
}


// v0.9.145: the report says what is in it, and the labs are in it.
{
  const AW=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const SW=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(/<h2>Laboratory markers<\/h2>/.test(SW),'the PDF has a laboratory section');
  ok(/not drawn/.test(SW),'a marker never drawn is listed as such rather than omitted');
  ok(/const first = \+withV\[0\]\.values\[k\], last = \+withV\[withV\.length - 1\]\.values\[k\];/.test(SW),'each row carries first, latest and the change between');
  ok(/Flag thresholds are the published trial/.test(SW),'the PDF states whose thresholds these are');
  // the card
  ok(/9 SECTIONS/.test(AW),'the card counts nine sections');
  ok(/laboratory markers,\s*\n?\s*training and intake/.test(AW.replace(/\s+/g,' ')) || /laboratory markers/.test(AW),'the blurb mentions the labs');
  ok(/\["Laboratory markers", labDraws\.length/.test(AW),'the card lists every section with what it holds');
  ok(/id: "rep"/.test(AW),'the report card collapses like the rest');
  ok(/labs section is empty/.test(AW),'and says so when there is nothing in it');
  // the count in the card and the sections in the PDF must not drift apart
  const secs=(SW.match(/<h2>[^<]{3,60}<\/h2>/g) || []).length;
  ok(secs === 9, 'the PDF really has nine sections, matching the card (' + secs + ')');
}


// v0.9.146: legibility and touch. The contrast is COMPUTED, not pinned to a hex — any future theme
// or tweak that drops faint below 4.5:1 on its own surface fails here, in any theme.
{
  const AX=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const lum=(h)=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255)
    .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];};
  const ratio=(a,b)=>{const p=[lum(a),lum(b)].sort((m,n)=>n-m);return (p[0]+0.05)/(p[1]+0.05);};
  const i=AX.indexOf('const THEMES'); const blk=AX.slice(i, i+4200);
  const themes=[...blk.matchAll(/(\w+):\s*\{[^}]*?surface:\s*"(#[0-9A-Fa-f]{6})"[^}]*?muted:\s*"(#[0-9A-Fa-f]{6})"[^}]*?faint:\s*"(#[0-9A-Fa-f]{6})"/g)];
  ok(themes.length >= 5, 'all themes found for the contrast check (' + themes.length + ')');
  for (const [,name,surf,muted,faint] of themes) {
    const rf=ratio(faint,surf), rm=ratio(muted,surf);
    ok(rf >= 4.5, name + ': faint meets WCAG AA on its surface (' + rf.toFixed(2) + ':1)');
    ok(rm > rf, name + ': faint stays dimmer than muted, so the hierarchy holds');
  }
  // touch floors
  // v0.9.156: the floor is density-aware. One floor for both made compact exactly as tall as
  // comfortable, which defeats the only thing compact is for.
  ok(/minHeight: _cmp \? 44 : 48/.test(AX),'the tab bar guarantees a hit height in both densities');
  ok((AX.match(/minHeight: _cmp \? 38 : 44/g) || []).length >= 3,'the pill controls carry a floor that respects the density choice');
  ok(!/flex: 1, height: 38, borderRadius: 999/.test(AX),'no dose pill declares a fixed sub-44 height');
  ok(!/flex: 1, height: 34, borderRadius: 999/.test(AX),'nor an interval pill');
}


// v0.9.147: hormone markers, for the panel he is drawing this week.
{
  const AY=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const SY=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  for (const k of ['tt','ft','shbg']) {
    ok(new RegExp('key: "' + k + '"').test(AY), 'the card tracks ' + k);
    ok(new RegExp('"' + k + '"').test(SY), 'the parser accepts ' + k);
  }
  ok(/const LAB_GROUPS = \[[^\]]*"Hormones"[^\]]*\]/.test(AY),'Hormones is a declared group');
  // the ranges are the ones on HIS report, so a value reads against the same scale as his baseline
  ok(/key: "tt"[\s\S]{0,120}lo: 250,\s*hi: 1100/.test(AY),'total testosterone uses the adult-male range from his own report');
  ok(/key: "ft"[\s\S]{0,120}lo: 35,\s*hi: 155/.test(AY),'free testosterone likewise');
  // the specific way an extractor gets this wrong
  ok(/Do NOT map bioavailable testosterone to ft/.test(SY),'the parser is told bioavailable is not free testosterone');
  ok(/\["tt","Testosterone, total"/.test(SY),'the prescriber report carries the hormone rows');
}


// v0.9.147: both app manifests carry the same release notes. The anchored swap targeted one file,
// so umbrel/forkcaster sat on v0.9.44's notes through a hundred releases while its version bumped.
{
  const fs2=require('fs');
  const a=fs2.readFileSync(__FCROOT + '/forkcaster-coach/umbrel-app.yml','utf8');
  const b=fs2.readFileSync(__FCROOT + '/umbrel/forkcaster/umbrel-app.yml','utf8');
  const notes=(t)=>{ const m=/releaseNotes: >-\n((?:  .+\n)+)/.exec(t); return m?m[1].trim():null; };
  ok(notes(a) && notes(b), 'both manifests declare release notes');
  ok(notes(a) === notes(b), 'and they say the same thing');
  ok(!/v0\.9\.44:/.test(b), 'no manifest is stranded on an old release note');
}


// v0.9.148: bioavailable testosterone is derived, and says so.
{
  const AZ=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/key: "alb"/.test(AZ),'albumin is tracked — the calculation needs it and the CMP reports it');
  ok(/const bioT = \(\(\) => \{/.test(AZ),'the derivation exists');
  // run the SHIPPED equation, not a copy of it
  const i=AZ.indexOf('const bioT = (() => {');
  const body=AZ.slice(i, AZ.indexOf('})();', i));
  for (const k of ['1.0e9','3.6e4','28.84','66430','288.4'])
    ok(body.includes(k), 'Vermeulen constant ' + k + ' is present');
  ok(/if \(!tt \|\| !sh \|\| !al\) return null;/.test(body),'it returns null unless all three inputs exist');
  ok(/if \(!\(disc > 0\)\) return null;/.test(body),'and refuses an impossible discriminant');
  // reproduce it here and check it against a value we already know: his measured free T
  const KT=1.0e9, KA=3.6e4;
  const calc=(tt,sh,al)=>{ const T=tt/28.84*1e-9,S=sh*1e-9,Alb=al*10/66430;
    const N=1+KA*Alb,a=N*KT,b=N+KT*(S-T),c=-T;
    const FT=(-b+Math.sqrt(b*b-4*a*c))/(2*a);
    return { free:FT*288.4*1e9, bio:N*FT*288.4*1e8 }; };
  const r=calc(250,40,3.9);
  ok(Math.abs(r.free - 43) < 6, 'the equation reproduces his measured free T of 43 pg/mL (got ' + r.free.toFixed(1) + ')');
  ok(r.bio > 0.25*250 && r.bio < 0.75*250, 'bioavailable lands in the physiological 25-75% of total');
  // it must never be presented as measured
  // v0.9.154: the provenance moved from a per-row caption to the panel footnote when the card was
  // rebuilt in report layout. Same promise, stated once per panel instead of on every row.
  ok(/Bioavailable is calculated from total testosterone, SHBG and albumin \u2014 not drawn\./.test(AZ)
     || /Bioavailable is calculated from total testosterone, SHBG and albumin — not drawn\./.test(AZ),
     'the panel states bioavailable is calculated, not drawn');
  ok(/\u00b7 calc<\/span>/.test(AZ) || /· calc<\/span>/.test(AZ),'and each derived row is marked calc');
}


// v0.9.149: the parser's key list must match the card's markers. Albumin was added to the card and
// not to the parser, so every imported report silently dropped it — and bioavailable testosterone,
// which needs albumin, could never compute. Derived on both sides now instead of hand-listed.
{
  const BA=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const BS=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  const block=/const LAB_MARKERS = \[([\s\S]*?)\n\];/.exec(BA);
  ok(!!block, 'the marker table is findable');
  const cardKeys=[...block[1].matchAll(/key: "(\w+)"/g)].map((m)=>m[1]);
  const pk=/const LAB_KEYS = \[([^\]]*)\]/.exec(BS);
  const parseKeys=[...pk[1].matchAll(/"(\w+)"/g)].map((m)=>m[1]);
  const rm=/const LABM = \[([\s\S]*?)\];/.exec(BS);
  const reportKeys=[...rm[1].matchAll(/\["(\w+)"/g)].map((m)=>m[1]);
  ok(cardKeys.length >= 12, 'the card tracks its markers (' + cardKeys.length + ')');
  const missingP=cardKeys.filter((k)=>!parseKeys.includes(k));
  const missingR=cardKeys.filter((k)=>!reportKeys.includes(k));
  ok(missingP.length === 0, 'every card marker is accepted by the parser (missing: ' + missingP.join(',') + ')');
  ok(missingR.length === 0, 'every card marker appears in the prescriber report (missing: ' + missingR.join(',') + ')');
  ok(/ALBUMIN->alb/.test(BS),'albumin is mapped explicitly');
  ok(/Do NOT map GLOBULIN or TOTAL PROTEIN to alb/.test(BS),'and globulin cannot be mistaken for it');
}


// v0.9.150: a derived value that cannot compute says why, instead of vanishing.
{
  const BB=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const bioTNeeds = /.test(BB),'the missing inputs are enumerated');
  ok(/\[\["tt", "total testosterone"\], \["shbg", "SHBG"\], \["alb", "albumin"\]\]/.test(BB),'named in words he would recognise on a report');
  ok(/needs \{bioTNeeds\.join\(", "\)\}/.test(BB),'and printed in the reference column');
  // it must not appear on an empty card — a pending row for a section he has no data in is noise
  ok(/bioTNeeds\.length > 0 && bioTNeeds\.length < 3/.test(BB),'the pending row is hidden when nothing hormone-related is on file');
  ok(/opacity: 0\.55/.test(BB),'and is visually subordinate to real values');
}


// v0.9.151: the baseline is a choice, and estradiol joins the hormone group.
{
  const BC=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const BSV=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(/const labBaselineId = \(labDraws\.find\(\(d\) => d\.baseline\) \|\| labDraws\[0\]/.test(BC),'a marked draw becomes the reference, earliest is only the fallback');
  ok(/const marked = withVal\.find\(\(d\) => d\.id === labBaselineId\);/.test(BC),'per-marker deltas measure from that draw');
  ok(/labBaselineDate = \(labDraws\.find\(\(d\) => d\.id === labBaselineId\)/.test(BC),'and the stated baseline date agrees with it');
  ok(/setLabs\(\(labs \|\| \[\]\)\.map\(\(x\) => \(\{ \.\.\.x, baseline: x\.id === d\.id \}\)\)\)/.test(BC),'choosing one clears the others — exactly one baseline');
  ok(/labDraws\.length > 1 &&/.test(BC),'the selector only appears once there is something to choose between');
  ok(/an older panel stays on file as history either way/.test(BC),'and says the old draw is not deleted');
  // estradiol
  ok(/key: "e2"/.test(BC),'estradiol is tracked');
  ok(/needs the SENSITIVE \(LC\/MS\) assay/.test(BC),'flagged as needing the sensitive assay in men');
  ok(/"e2"\]/.test(BSV) || /,"e2"/.test(BSV),'the parser accepts it');
  ok(/ESTRADIOL \(including ULTRASENSITIVE or LC\/MS\)->e2/.test(BSV),'and maps the ultrasensitive naming');
}


// v0.9.152: lab-due reminder, on the notification path that already works.
{
  const BD=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const BE=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(/async function labDueTick\(\)/.test(BE),'the reminder exists');
  ok(/setInterval\(labDueTick, 10 \* 60 \* 1000\);/.test(BE),'on the same ten-minute tick as the dose reminder');
  ok(/parseInt\(prefs\.reminderHour\) \|\| 9/.test(BE),'and the same hour preference — one clock, not two');
  ok(/const LAB_INTERVAL_DAYS = 90;/.test(BE),'the default interval is 90 days');
  ok(/if \(!draws\.length\) return;/.test(BE),'nothing is due before a first draw exists');
  ok(/if \(_labNoticeOn === last\) return;/.test(BE),'it notifies once per draw, not once per day');
  ok(/if \(days < every - 7\) return;/.test(BE),'with a week of notice rather than a week late');
  ok(/if \(prefs\.labReminder === false\) return;/.test(BE),'and can be switched off');
  // the same state is visible in the card without waiting for a notification
  ok(/const labDueIn = labAgeDays == null \? null : labEvery - labAgeDays;/.test(BD),'the card computes the same countdown');
  ok(/labDueIn <= 0 \? "due now"/.test(BD),'and says due now when it is');
  // v0.9.152: the third TDZ this project has caught. Pin the order rather than trusting it.
  ok(BD.indexOf('const labAgeDays') < BD.indexOf('const labDueIn'),'labAgeDays is declared before the countdown that reads it');
}


// v0.9.153: CBC, with the one threshold that matters if testosterone therapy is ever on the table.
{
  const BF=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const BG=require('fs').readFileSync(__FCROOT + '/server/server.js','utf8');
  for (const k of ['hct','hgb','rbc','wbc','plt']) {
    ok(new RegExp('key: "' + k + '"').test(BF), 'the card tracks ' + k);
    ok(new RegExp('"' + k + '"').test(BG), 'the parser accepts ' + k);
  }
  ok(/key: "hct"[\s\S]{0,200}flagAt: 54/.test(BF),'hematocrit flags at 54% — the line that limits testosterone therapy');
  ok(/limits testosterone therapy/.test(BF),'and says why it is flagged');
  // the two ways an extractor gets a CBC wrong
  ok(/Do NOT map HEMOGLOBIN A1c to hgb/.test(BG),'A1c cannot be misread as hemoglobin');
  ok(/Do NOT map MCV, MCH, MCHC or RDW to any key/.test(BG),'and the red-cell indices are not forced into a slot');
}


// v0.9.154: the card is ordered and laid out like a lab report.
{
  const BH=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const LAB_GROUPS = \["Lipid panel", "Comprehensive metabolic panel", "Hemoglobin A1c", "Pancreatic enzymes", "CBC", "Hormones"\]/.test(BH),
     'panels are named and ordered the way his report prints them');
  // markers must sit in the same sequence within the table as the groups list, or the card renders
  // panels in one order while the table implies another
  const blk=/const LAB_MARKERS = \[([\s\S]*?)\n\];/.exec(BH)[1];
  const seq=[...blk.matchAll(/group: "([^"]+)"/g)].map((m)=>m[1]);
  const firstAt={}; seq.forEach((g,i)=>{ if(firstAt[g]==null) firstAt[g]=i; });
  const groups=/const LAB_GROUPS = \[([^\]]*)\]/.exec(BH)[1].match(/"([^"]+)"/g).map((x)=>x.replace(/"/g,''));
  let ordered=true;
  for (let i=1;i<groups.length;i++) if (firstAt[groups[i]] < firstAt[groups[i-1]]) ordered=false;
  ok(ordered, 'the marker table is written in the same order the panels render');
  // report conventions
  ok(/const hl = !cur \? "" : cur\.v > m\.hi \? "H" : cur\.v < m\.lo \? "L" : "";/.test(BH),'out-of-range results carry H or L');
  ok(/>Result<\/span>/.test(BH) && />Reference<\/span>/.test(BH),'each panel has Result and Reference column headers');
  ok(/\{m\.lo\}\u2013\{m\.hi\}/.test(BH) || /\{m\.lo\}–\{m\.hi\}/.test(BH),'the reference range is its own right-aligned column');
  ok(/not drawn \u2014 \{m\.why\}/.test(BH) || /not drawn — \{m\.why\}/.test(BH),'undrawn markers are footnoted beneath their panel');
  ok(/key: "chol"/.test(BH),'total cholesterol is tracked so the lipid panel is complete');
}


// v0.9.155: one draw per date, and a draw can be removed.
{
  const BI=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const prior = \(labs \|\| \[\]\)\.find\(\(x\) => x\.date === labDraft\.date\);/.test(BI),'saving looks for an existing draw on that date');
  ok(/values: \{ \.\.\.\(prior \? prior\.values : \{\}\), \.\.\.labDraft\.values \}/.test(BI),'a re-import MERGES into it rather than duplicating or wiping');
  ok(/baseline: prior \? prior\.baseline : undefined/.test(BI),'and the baseline flag survives a re-import');
  ok(/id: prior \? prior\.id : uid\(\)/.test(BI),'the draw keeps its identity, so the baseline selection still points at it');
  // hold to delete
  ok(/labHoldRef\.current = setTimeout\(/.test(BI),'holding a date starts a delete');
  ok(/if \(labHoldFired\.current\) \{ labHoldFired\.current = false; return; \}/.test(BI),'and the tap that follows a hold does not also change the baseline');
  ok(/setLabs\(\(labs \|\| \[\]\)\.filter\(\(x\) => x\.id !== d\.id\)\)/.test(BI),'the draw is removed');
  ok(/Delete the draw from \$\{fmtDate\(d\.date\)\}\?/.test(BI),'after confirming, naming the date');
  ok(/Tap to compare against that draw; hold to delete it/.test(BI),'and the card says both gestures');
}


// v0.9.157: the visual audit. It cannot run here — no browser in this sandbox — so what is pinned
// is that it stays correct and stays harmless.
{
  const fs3=require('fs');
  const VA=fs3.readFileSync(__FCROOT + '/tools/ftest/visual-audit.js','utf8');
  const APPJ=fs3.readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/puppeteer-core/.test(VA),'it uses the puppeteer already pinned in the image');
  ok(/PUPPETEER_EXECUTABLE_PATH \|\| "\/usr\/bin\/chromium-browser"/.test(VA),'and the chromium the Dockerfile installs');
  ok(/VISUAL_AUDIT_SKIPPED/.test(VA),'it skips cleanly where no browser exists rather than failing the run');
  // it must never edit his data to run a test
  ok(!/localStorage\.setItem/.test(VA),'it does not write preferences');
  ok(!/method: "POST"/.test(VA),'and posts nothing to the app');
  ok(/Density is READ, never written/.test(VA),'density is observed, not set');
  // the tab labels it clicks must be the app's actual labels — the glp1 lesson
  const labels=[...APPJ.slice(APPJ.indexOf('const TABS = ['), APPJ.indexOf('const TABS = [')+700)
    .matchAll(/label: "([^"]+)"/g)].map((m)=>m[1].toLowerCase());
  const ids=/const TABS = \[([^\]]*)\]/.exec(VA)[1].match(/"([^"]+)"/g).map((x)=>x.replace(/"/g,''));
  const clicked=ids.map((t)=>t.replace('glp','glp-1'));
  ok(clicked.every((c)=>labels.includes(c)),'every tab it clicks exists in the app (' + clicked.filter((c)=>!labels.includes(c)).join(',') + ')');
  ok(labels.every((l)=>clicked.includes(l)),'and it covers every tab the app has');
  // the floors it enforces must match the ones the app ships
  ok(/const TOUCH_MIN = 44;/.test(VA) && /const TOUCH_MIN_COMPACT = 38;/.test(VA),'its floors match the shipped ones');
  ok(/minHeight: _cmp \? 38 : 44/.test(APPJ),'which the app actually declares');
  const RS=fs3.readFileSync(__FCROOT + '/release.sh','utf8');
  ok(/visual-audit\.js/.test(RS),'the release script runs it');
  // v0.9.174: name=forkcaster also matches app_proxy, and head -1 took whichever docker listed
  // first — it picked the proxy, which carries no app code, and the audit died on a missing module.
  ok(/grep -E '_web\(_\[0-9\]\+\)\?\$'/.test(RS),'and targets the web container, not the proxy');
  ok(/test -f tools\/ftest\/visual-audit\.js/.test(RS),'checking the file exists before running it');
  ok(/no audit in \$CID/.test(RS),'and saying so plainly rather than printing a stack trace');
  ok(/\|\| true/.test(RS),'advisory — a geometry finding never blocks a fix from shipping');
}


// v0.9.158: the audit's first real catch, and the tool tightened so its findings mean something.
{
  const fs4=require('fs');
  const BJ=fs4.readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const VB=fs4.readFileSync(__FCROOT + '/tools/ftest/visual-audit.js','utf8');
  // a logged meal name is never truncated — the audit measured it losing 77px at 375pt
  ok(!/whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" \}\}>\{m\.name\}/.test(BJ),'a logged meal name is not truncated');
  ok(!/whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" \}\}>\{f\.name\}/.test(BJ),'nor a food search result');
  ok(/lineHeight: 1\.3, wordBreak: "break-word" \}\}>\{m\.name\}/.test(BJ),'it wraps instead');
  // the tool must not drown its own findings
  ok(/const isNested = /.test(VB),'the audit reports the outermost control, not every nested layer');
  ok(/const inScroller = /.test(VB),'and does not call a carousel a layout fault');
  ok(/if \(hit >= floor\) continue;/.test(VB),'touch is judged on the hit height, which is what a thumb lands on');
  ok(/kind === "CLIP" \|\| p\.kind === "OVERFLOW"/.test(VB),'only real layout defects fail the run');
  ok(/VISUAL_AUDIT_OK with /.test(VB),'advisories are reported without blocking a release');
}


// v0.9.159: labels the visual audit measured as clipped. Budget checked at the narrowest device.
{
  const BK=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const MONO=0.60, cell375=(307-4*8)/5;
  const fits=(t,fs,tr)=>t.length*fs*MONO + t.length*tr <= cell375;
  ok(fits("CALORIES",10.5,0.4),'CALORIES fits its counter cell at 375pt');
  ok(fits("LIFTS/WK",10.5,0.4),'LIFTS/WK fits its cell at 375pt');
  ok(!fits("CALORIES",11,1.1),'and the previous size genuinely did not — this is why it clipped');
  ok((BK.match(/letterSpacing: 0\.4, color: C\.faint, textTransform: "uppercase", whiteSpace: "nowrap" \}\}>\{l\}/g) || []).length === 2,
     'both counter rows carry the fix, not just the one that was measured');
}


// v0.9.160: Release B — the app answers when it is touched.
{
  const BL=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  // pressed states, applied once at the root rather than at 114 call sites
  ok(/button:active,\[role="button"\]:active\{transform:scale\(\.97\)/.test(BL),'every button reacts to a press');
  ok(/button:disabled\{filter:none;transform:none;\}/.test(BL),'a disabled button does not pretend to');
  ok(/prefers-reduced-motion:reduce/.test(BL),'and motion is dropped for anyone who asks for that');
  ok(!/\[data-card-id\]:active/.test(BL),'cards are excluded — a lifted card owns its own transform mid-drag');
  // no OS dialogs left for messages
  ok(!/(^|[^.\w])alert\(/m.test(BL.replace(/toast\(/g, '')),'no alert() remains anywhere');
  ok(/const toast = \(msg, tone = "info"\)/.test(BL),'there is a toast primitive');
  ok(/tone === "bad" \? 5200 : 2800/.test(BL),'errors stay up longer than confirmations');
  ok(/animation: "fcToastIn/.test(BL),'it animates in rather than appearing');
  ok(/zIndex: 58/.test(BL),'above the tab bar, below every modal');
  // and the confirmations are visual, because vibrate does nothing on his phone
  ok(/toast\(pendingSite \? `Dose logged/.test(BL),'logging a dose confirms what was recorded');
  ok(/Draw for \$\{fmtDate\(labDraft\.date\)\} saved/.test(BL),'and saving a draw does too');
}


// v0.9.162: Release B part two — no OS chrome left anywhere.
{
  const BM=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const code=BM.replace(/\/\*[\s\S]*?\*\//g, '');          // ignore the comments that name it
  ok(!/window\.confirm\(/.test(code),'no window.confirm remains in the app');
  ok(!/(^|[^.\w])alert\(/m.test(code.replace(/toast\(/g,'')),'and no alert either');
  ok(/const askConfirm = \(msg, danger = false\)/.test(BM),'there is an in-app confirm');
  ok(/new Promise\(\(resolve\) => setAskState/.test(BM),'promise-based, so a call site changes by one keyword');
  ok(/onClick=\{\(\) => askAnswer\(false\)\}/.test(BM),'tapping the backdrop cancels');
  ok(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(BM),'but tapping the dialog does not');
  ok(/askState\.danger \? C\.avoid : C\.go/.test(BM),'a destructive confirm is red, an ordinary one is not');
  ok(/askState\.danger \? "Delete" : "Confirm"/.test(BM),'and says which it is');
  ok(/zIndex: 72/.test(BM),'it sits above every sheet and modal');
  ok(/minHeight: 44/.test(BM),'its buttons meet the touch floor');
  // every await must be inside an async function or the dialog resolves to a Promise and the
  // guard clause passes silently — the exact way this refactor breaks quietly
  const awaits=(BM.match(/await askConfirm/g) || []).length;
  ok(awaits === 9, 'all nine confirms were converted (' + awaits + ')');
  ok(/async function deletePhoto/.test(BM) && /async function deleteSim/.test(BM),'the photo and forecast handlers are async');
  ok(/onRemove=\{async \(di\)/.test(BM),'the dose remover is async');
  ok(/setTimeout\(async \(\) => \{/.test(BM),'and the lab hold callback is too');
}


// v0.9.163: Release C — the decorative line goes, and prose says its point once.
{
  const BN=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(!/Medication \u00b7 titration \u00b7 tolerability/.test(BN) && !/Medication · titration · tolerability/.test(BN),
     'the GLP-1 strapline is gone — it restated the tab name above it');
  ok(!/Composition, trend &amp; progress/.test(BN),'and the Body one');
  // Today's is the DATE, which is information rather than decoration
  ok(/weekday: "long", month: "long", day: "numeric"/.test(BN),"Today keeps its date line");
  // the condensed blocks, by their surviving wording
  ok(/Built for maintenance and coming off the drug/.test(BN),'the journey card states its point once');
  ok(/have no HealthKit fields\. Snap the report/.test(BN),'the scan card too');
  ok(/Health Auto Export can post to the same URL/.test(BN),'and the sync note');
  ok(!/Most apps quit at/.test(BN),'no card argues with other apps');
  ok(!/carries more than Apple Health can store/.test(BN),'and none explains its own explanation');
}


// v0.9.164: weeks on therapy derives — the last stored copy of the family that caused three bugs.
{
  const BO=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const weeksOnMed = /.test(BO),'weeks on therapy is derived');
  ok(/mine = all\.filter\(\(d\) => d\.med === glp\.med\)/.test(BO),'and scoped to the current medication');
  ok(/L\.reduce\(\(a, b\) => \(a\.date <= b\.date \? a : b\)\)\.date/.test(BO),'measured from the EARLIEST dose, not the count of them');
  ok(!/week \$\{glp\.weeksOn\}/.test(BO) && !/week \{glp\.weeksOn\}/.test(BO),'no display reads the stored counter');
  ok(!/Week \{glp\.weeksOn\}/.test(BO),'nor the capitalised one');
  ok(/return Math\.max\(1, \+glp\.weeksOn \|\| 1\);/.test(BO),'the stored value survives only as a fallback when nothing is logged');
  // the arithmetic, run here against the cases the counter got wrong
  const wk=(firstISO, todayMs)=>{ const d=Math.floor((todayMs - new Date(firstISO+"T12:00:00").getTime())/86400000);
    return Math.max(1, Math.floor(d/7)+1); };
  const t=new Date("2026-08-03T12:00:00").getTime();
  ok(wk("2026-07-17", t) === 3, 'three weekly doses from Jul 17 reads week 3');
  ok(wk("2026-06-26", t) === 6, 'backfilling to Jun 26 reads week 6, not week 7');
  ok(wk("2026-08-03", t) === 1, 'a dose today reads week 1');
}


// v0.9.165: Release D, first family — one scale for body-range type.
{
  const BP=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const sizes=[...BP.matchAll(/fontSize: (\d+(?:\.\d+)?)/g)].map((m)=>+m[1]);
  const small=[...new Set(sizes.filter((v)=>v<=18))].sort((a,b)=>a-b);
  const SCALE=[10.5,11.5,13,15,17];
  ok(small.length === SCALE.length, 'the body range uses ' + SCALE.length + ' sizes (found ' + small.length + ': ' + small.join(',') + ')');
  ok(small.every((v)=>SCALE.includes(v)), 'and every one of them is on the scale');
  ok(Math.min(...small) >= 10.5, 'the 10.5px floor still holds');
  // display and hero sizes are deliberate and were left alone — forcing 56px onto a scale is not
  // a tidy-up, it is a redesign nobody asked for
  ok(sizes.some((v)=>v>=34), 'the hero sizes are untouched');
  // the budgets measured this week must still hold at the narrowest device
  const MONO=0.60;
  ok(11*11.5*MONO + 11*0.4 <= (307-16)/3 - 12, 'RETATRUTIDE still fits its chip');
  ok(8*10.5*MONO + 8*0.4 <= (307-4*8)/5, 'CALORIES still fits its cell');
}


// v0.9.166: touch targets reachable without moving the layout.
{
  const fs5=require('fs');
  const BQ=fs5.readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const VC=fs5.readFileSync(__FCROOT + '/tools/ftest/visual-audit.js','utf8');
  ok(/button::after\{content:"";position:absolute;left:0;right:0;top:-8px;bottom:-8px;\}/.test(BQ),
     'buttons carry 8px of vertical hit slop');
  // v0.9.169: icon buttons were EXCLUDED by a :has(> svg) rule, which was exactly backwards — the
  // audit measured them still at 25px, unhelped. An icon has no text to reflow, so it is the
  // easiest thing in the app to expand and the hardest to hit without it.
  ok(!/button:has\(> svg\)/.test(BQ),'icon buttons are not excluded from the hit slop');
  ok(/\[role="button"\]::after,a\[href\]::after/.test(BQ),'tappable rows and links get it too');
  ok(/button\{position:relative;\}/.test(BQ),'anchored so the pseudo-element lands on the button');
  ok(/left:0;right:0/.test(BQ),'vertical only — horizontal expansion would make neighbouring chips overlap');
  // a 25px row was the commonest finding; with slop it clears the compact floor
  ok(25 + 16 >= 38, 'a 25px row becomes a 41px target, over the 38px compact floor');
  // and the audit must read the slop or it reports controls that are already reachable
  ok(/getComputedStyle\(el, "::after"\)/.test(VC),'the audit measures the hit area, not the painted box');
  ok(/drawn: Math\.round\(r\.height\)/.test(VC),'and still reports what is actually drawn');
}


// v0.9.167: Release D, second family — nineteen radii become five.
{
  const BR=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const radii=[...new Set([...BR.matchAll(/borderRadius: (\d+)/g)].map((m)=>+m[1]))].sort((a,b)=>a-b);
  const SCALE=[4,8,12,18,999];
  ok(radii.every((v)=>SCALE.includes(v)), 'every literal radius is on the scale (' + radii.join(',') + ')');
  ok(radii.length <= 5, 'and there are at most five of them');
  ok(radii.includes(4), 'the small rung survives — a 3px bar snapped to 8 would clamp to half its height and read as a lozenge');
  ok(radii.includes(999), 'pills are still pills');
  // the chassis is the one pinned design decision and is deliberately off the scale
  ok(/borderRadius: _cmp \? 15 : 18/.test(BR),'the card chassis keeps its own radius, 18 comfortable and 15 compact');
}


// v0.9.168: the audit stopped re-reading its own printed strings.
{
  const VD=require('fs').readFileSync(__FCROOT + '/tools/ftest/visual-audit.js','utf8');
  ok(/const note = \(kind, msg, n = null\)/.test(VD),'a finding carries its measurement');
  ok(/list\.map\(\(p\) => p\.n\)/.test(VD),'and the summary reads that number, not the sentence it printed');
  ok(!/\/is \(\\d\+\)x\//.test(VD),'the regex that parsed the old wording is gone');
  ok(/shortest = nums\.length \? nums\[0\] \+ "px" : "n\/a"/.test(VD),'it says n\/a rather than inventing a number');
}


// v0.9.170: Release D, third family — twenty spacing values become seven.
{
  const BS2=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const sp=[...new Set([...BS2.matchAll(/\b(?:gap|marginTop|marginBottom): (\d+)/g)].map((m)=>+m[1]))].sort((a,b)=>a-b);
  const SCALE=[0,2,4,8,12,16,24];
  ok(sp.every((v)=>SCALE.includes(v)), 'every gap and margin is on the scale (' + sp.join(',') + ')');
  ok(sp.length <= SCALE.length, 'and there are at most seven of them');
  // spacing changes CELL WIDTHS, so the two budgets measured against real geometry are re-checked
  const MONO=0.60;
  const gap=8;
  ok(11*11.5*MONO + 11*0.4 <= (307-2*gap)/3 - 12, 'RETATRUTIDE still fits its chip at the new gap');
  ok(8*10.5*MONO + 8*0.4 <= (307-4*gap)/5, 'CALORIES still fits its cell at the new gap');
}


// v0.9.171: the gap between cards belongs to the shell alone.
{
  const BT=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/marginBottom: _cmp \? 9 : 14/.test(BT),'the shell sets the gap, 9 compact and 14 comfortable');
  // a card passing its own marginBottom in extra spreads AFTER the shell value and overrides it,
  // which is how Body ended up alternating 9, 12, 8 and 4px between cards
  ok(!/, \{ marginBottom: \d+ \}\)/.test(BT),'no card overrides the gap through its extra');
  ok(!/<\/div>,\s*\{ marginBottom: \d+ \}/.test(BT),'including the multi-line form');
  // inner rows inside a card may still carry their own margin — that is layout, not card spacing
  const bodyStart=BT.indexOf('{tab === "body" && <div style={{');
  const bodyEnd=BT.indexOf('\n  const render', bodyStart + 20);
  const body=BT.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : bodyStart + 70000);
  const overrides=[...body.matchAll(/\{ marginBottom: \d+ \}/g)].length;
  ok(overrides <= 3, 'Body has no card-level margin left, only inner rows (' + overrides + ')');
}


// v0.9.172: Release D, last family — and most of it turned out to be correct already.
{
  const BU=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const SLEEP_STAGE = \{ deep: "#4C3FD4", rem: "#67E8F9", light: "#3B84BC" \}/.test(BU),
     'the sleep stage palette is named once');
  ok((BU.match(/"#4C3FD4"/g) || []).length === 1,'and deep is written exactly once');
  ok((BU.match(/"#3B84BC"/g) || []).length === 1,'light too');
  // the activity sparkline shares a hex with REM by coincidence and must NOT share the constant —
  // welding them means changing the sleep legend silently restyles a chart about steps
  ok(/spark: _spark\(wk\.map\(\(d\) => \+d\.steps \|\| 0\), "#67E8F9"\)/.test(BU),
     'the activity sparkline keeps its own colour, not the sleep constant');
  ok(/Fixed palettes\. These deliberately do NOT come from THEMES/.test(BU),
     'the fixed colours are documented as answers rather than oversights');
  ok(!/"#6b7a71"/.test(BU),'the score fallback uses a theme token');
}


// v0.9.173: the last of the measured touch findings.
{
  const BV=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const i=BV.indexOf('const renderTrain'), e=BV.indexOf('\n  const render', i + 20);
  const train=BV.slice(i, e > i ? e : i + 40000);
  let bare=0;
  const re=/<button[^>]*?style=\{\{([^}]{0,300})\}\}>([^<{]{0,18})/g; let m;
  while ((m = re.exec(train))) {
    if (/height/.test(m[1])) continue;
    const p=/padding: "(\d+)/.exec(m[1]);
    if (!p || +p[1] < 6) bare++;
  }
  ok(bare === 0, 'no Train button relies on hit slop alone (' + bare + ' bare)');
  ok(/cursor: "pointer", padding: "8px 12px" \}\}>skip<\/button>/.test(BV),'the rest-skip button is padded');
}


// v0.9.175: the report names the small controls instead of only counting them.
{
  const VE=require('fs').readFileSync(__FCROOT + '/tools/ftest/visual-audit.js','utf8');
  ok(/const lbl = \(\/"\(\[\^"\]\*\)" hit area\//.test(VE),'each small control is named in the summary');
  ok(/seenLbl\.size > 4/.test(VE),'at most four per tab, so it stays readable');
  ok(/sort\(\(a, b\) => \(a\.n \|\| 99\) - \(b\.n \|\| 99\)\)/.test(VE),'smallest first — that is where the work is');
}


// v0.9.176: the named text links get real padding.
{
  const BW=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/const linkBtn = \{[^}]*padding: "8px 4px"/.test(BW),'the shared link style is padded, which covers several call sites at once');
  ok(!/const linkBtn = \{[^}]*padding: 0 \}/.test(BW),'and no longer ships with zero padding');
  ok(/cursor: "pointer", padding: "8px 4px", textDecoration: "underline" \}\}>/.test(BW),'the how-to link is padded');
  ok(/margin: "2px 0 10px", padding: "8px 4px"/.test(BW),'and the re-search link');
}


// v0.9.177: the last three named controls.
{
  const BX=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  ok(/fontFamily: BODY, padding: "8px 10px" \}\}>Clear<\/button>/.test(BX),"Coach's Clear is padded");
  // the 6 Pack hand-off is an ANCHOR, not a button, which is why every button-shaped pass missed it
  ok(/display: "inline-block", padding: "8px 4px" \}\}>or use \{SIXPACK\.label\}/.test(BX),'the 6 Pack link is padded');
  ok(/display: "inline-block"/.test(BX),'and made inline-block, since padding does nothing on an inline anchor');
  ok(/padding: "8px 0", cursor: "pointer", textAlign: "left", fontSize: 13, letterSpacing: 1\.1/.test(BX),'the GPS pin row is padded');
}


// v0.9.178: every scan status the code can SET must have somewhere to render.
{
  const BY=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const set=new Set([...BY.matchAll(/setScan\(\{ status: "(\w+)"/g)].map((m)=>m[1]));
  const rendered=new Set([...BY.matchAll(/scan\.status === "(\w+)"/g)].map((m)=>m[1]));
  // idle and loading are handled by the sheet's own shape rather than a status branch
  const orphans=[...set].filter((k)=>!rendered.has(k) && k !== "idle" && k !== "loading");
  ok(orphans.length === 0, 'no scan status is set without a way to show it (' + orphans.join(',') + ')');
  const ghosts=[...rendered].filter((k)=>!set.has(k));
  ok(ghosts.length === 0, 'and nothing renders for a status that can never happen (' + ghosts.join(',') + ')');
  // the specific one that was silent: a thrown lookup, which is a connection fault not a bad code
  ok(/scan\.status === "failed"/.test(BY),'a failed lookup says something');
  ok(/That's a connection problem on your node/.test(BY),"and distinguishes itself from a barcode that is genuinely missing");
  ok(/onClick=\{\(\) => lookupBarcode\(scan\.code \|\| barcode\)\}/.test(BY),'with a retry that reuses the scanned code');
  ok(/status: "failed", code: bc/.test(BY),'which is why the code is kept on the state');
}


// v0.9.179: weigh-in and protein reminders, and the day-roll they depend on.
{
  const fs6=require('fs');
  const BZ=fs6.readFileSync(__FCROOT + '/src/App.jsx','utf8');
  const SZ2=fs6.readFileSync(__FCROOT + '/server/server.js','utf8');
  ok(/async function habitTick\(\)/.test(SZ2),'the habit reminders exist');
  ok(/setInterval\(habitTick, 10 \* 60 \* 1000\);/.test(SZ2),'on the same clock as the dose and lab reminders');
  ok(/prefs\.weighReminder !== false/.test(SZ2) && /prefs\.proteinReminder !== false/.test(SZ2),'each can be switched off');
  ok(/_weighNoticeOn !== today/.test(SZ2) && /_proteinNoticeOn !== today/.test(SZ2),'each fires at most once per day');
  ok(/const pHour = Math\.min\(20, hour \+ 7\);/.test(SZ2),'protein comes later in the day than the weigh-in');
  ok(/got < floor \* 0\.5/.test(SZ2),'and only when he is genuinely behind');
  ok(/\$\{Math\.round\(got\)\} of \$\{Math\.round\(floor\)\} g so far/.test(SZ2),'carrying the numbers, not an instruction to log food');
  // the day-roll is mirrored from the app; if the two drift, a night-shift reminder fires on the
  // wrong day — extract BOTH and run them, rather than trusting that they look alike
  const grab=(src)=>{ const i=src.indexOf('function dayKeyAt('); let d=0, k=src.indexOf('{', i);
    while (k < src.length) { if (src[k]==='{') d++; else if (src[k]==='}') { d--; if (!d) break; } k++; }
    return src.slice(i, k+1); };
  const appFn=grab(BZ), srvFn=grab(SZ2);
  ok(appFn.length > 80 && srvFn.length > 80, 'both implementations were found');
  const mk=(body,name)=>new Function('return ' + body.replace('function dayKeyAt', 'function ' + name))();
  const A=mk(appFn,'a'), B=mk(srvFn,'b');
  const cases=[
    [Date.UTC(2026,7,4,3,0), {shiftMode:"nights", nightRollHour:11}],
    [Date.UTC(2026,7,4,15,0),{shiftMode:"nights", nightRollHour:11}],
    [Date.UTC(2026,7,4,3,0), {shiftMode:"days"}],
    [Date.UTC(2026,7,4,3,0), {shiftMode:"varies", workNights:["2026-08-03"], nightRollHour:11}],
    [Date.UTC(2026,7,4,9,0), {}],
  ];
  let same=true;
  for (const [t,p2] of cases) if (A(t,p2) !== B(t,p2)) same=false;
  ok(same, "the server's day-roll behaves identically to the app's");
}


// v0.9.180: the overlay sweep — the last item on the redesign queue.
{
  const CA=require('fs').readFileSync(__FCROOT + '/src/App.jsx','utf8');
  // a STRING radius is invisible to a numeric codemod, which is how 22px survived .167 on the four
  // largest surfaces in the app. Check both forms from now on.
  const strRadii=[...new Set([...CA.matchAll(/borderRadius: "(\d+px[^"]*)"/g)].map((m)=>m[1]))];
  ok(strRadii.every((r)=>r.startsWith("18px")), 'string-form radii are on the card rung (' + strRadii.join(' | ') + ')');
  ok(!/borderRadius: "22px/.test(CA),'no sheet keeps the off-scale 22px corner');
  // one component, one surface
  ok(!/background: C\.bg, borderRadius: "18px/.test(CA),'no sheet sits on C.bg while its siblings sit on C.surface');
  ok((CA.match(/borderTop: `1px solid \$\{C\.hair\}`, borderRadius: "18px/g) || []).length === 4,
     'all four sheets declare a top edge rather than dissolving into the scrim');
}

console.log('\nSTRUCT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
