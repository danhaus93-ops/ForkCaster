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
  ok(/bfShown \? bfShown\.toFixed\(1\) : "—"/.test(SRC),'body fat tile shows — when nothing is known');
  ok(/leanShown \? leanShown\.toFixed\(0\) : "—"/.test(SRC),'lean tile shows — when nothing is known');
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
  const A=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/savedRankRef\.current \|\| savedRank/.test(A),'rank gate reads the ref mirror, not the stale closure');
  ok(/if \(s\.savedRank\) \{ savedRankRef\.current = s\.savedRank;/.test(A),'loader writes the ref synchronously');
  ok(/!hydrated\.current; w\+\+\) await new Promise/.test(A),'ranking waits for hydration when GPS wins the race');
  ok(/savedRankRef\.current = \{ key, at: now, arr \}/.test(A),'saving keeps ref and state in sync');
}
// v0.9.22: no more silent data loss on app close, quick-adds leave records, honest describe-it errors
{
  const A2=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/keepalive: true/.test(A2),'the close-time flush uses keepalive so the POST outlives the page');
  ok(/addEventListener\("pagehide", flush\)/.test(A2) && /visibilitychange/.test(A2),'flush fires on both hide paths');
  ok(/blobRef\.current = stateBlob/.test(A2),'the flush reads a ref kept current by the save effect');
  ok(/Quick add \\u2014/.test(A2) || /Quick add \u2014/.test(A2),'macro quick-adds write a visible row');
  ok(/Couldn't reach the AI/.test(A2),'describe-it distinguishes an outage from a parse failure');
  ok(!/alert\("Couldn't parse that/.test(A2),'the undifferentiated catch-all alert is gone');
}
// v0.9.25: every client writer presents its revision; restore is the one deliberate overwrite
{
  const A3=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok((A3.match(/"_baseRev":\$\{revRef\.current\}/g) || []).length === 1, 'the ONE writer (postState) injects _baseRev — both callers route through it (v0.9.31)');
  ok(/revRef\.current = j\.rev; lastSavedRef\.current = blob;/.test(A3), 'an accepted post advances the rev AND the saved baseline in one place');
  ok(/j\.stale\) \{ console\.warn/.test(A3) && /window\.location\.reload\(\)/.test(A3), 'a stale ACTIVE instance re-syncs instead of fighting');
  ok(/api\/state\?force=1/.test(A3), 'backup restore uses the force path');
  ok(/revRef\.current = \(s && \+s\._rev\) \|\| 0/.test(A3), 'the loader adopts the revision it loaded');
}
// v0.9.26: provenance labeling end to end on the client
{
  const A4=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/synced: true, source: d\.source/.test(A4),'mergeWeightSeries carries the source tag');
  ok(/"apple-health": "APPLE HEALTH", "google-health": "GOOGLE HEALTH"/.test(A4),'the chip names known platforms');
  ok(/: "SYNCED"/.test(A4),'untagged synced days still fall back to the generic SYNCED chip');
}
// v0.9.27: the Today steps tile agrees with Body — shows today's synced count when it beats the manual tap counter
{
  const A5=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/Math\.max\(\+eaten\.steps \|\| 0, syn\)/.test(A5),'the tile shows the larger of manual and synced-today');
  ok(/d\.date === tk/.test(A5) && /dayKeyAt\(Date\.now\(\), prefs\)/.test(A5),'synced lookup uses the unified day clock, not UTC');
  ok(/"synced \\u00b7 goal 10,000"/.test(A5),'the tile says when the number came from sync');
}
// v0.9.28: foreground refresh — resume re-pulls synced health data and re-renders time-dependent surfaces
{
  const A6=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/document\.visibilityState !== "visible"\) return/.test(A6),'refresh fires only on becoming visible, not on hide');
  ok(/setFgTick\(\(t\) => t \+ 1\)/.test(A6),'a tick re-renders clocks even when data is unchanged');
  ok(/setHealthSync\(\(h\) => \(\{ \.\.\.\(h \|\| \{\}\), days: sm\.days \}\)\)/.test(A6),'the summary re-pull keeps the token and replaces days');
  ok(/addEventListener\("pageshow", refresh\)/.test(A6),'iOS back-forward-cache resume is covered too');
}
// v0.9.29: never write unchanged data — the echo save + teardown flush + stale-reload chased each other into a restart loop
{
  const A7=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/lastSavedRef\.current === null\) \{ lastSavedRef\.current = stateBlob; return; \}/.test(A7),'first post-hydration blob is the as-loaded baseline, not a save');
  ok(/if \(stateBlob === lastSavedRef\.current\) return;/.test(A7),'an unchanged blob is never saved');
  ok(/blobRef\.current === lastSavedRef\.current\) return;/.test(A7),'an unchanged blob is never flushed at teardown');
  ok(/revRef\.current = j\.rev; lastSavedRef\.current = blob;/.test(A7),'an accepted save updates BOTH the rev and the saved baseline (via the single writer)');
  ok(/window\.location\.reload\(\)/.test(A7),'genuinely-divergent stale saves still re-sync by reload');
}
// v0.9.30: the flush learns the revision its write produced — edit + quick-background no longer strands the client one rev behind
{
  const A8=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/postState\(blobRef\.current, true\)/.test(A8),'the flush routes through the single writer with keepalive');
  ok(/now - lastRefresh < 2000\) return;/.test(A8),'resume refreshes once, not once per event');
}
// v0.9.31: saves are SERIALIZED — a client can never race itself into an off-by-one stale
{
  const A9=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/if \(saveBusyRef\.current\) \{ pendingSaveRef\.current = stateBlob; return; \}/.test(A9),'a debounced save queues instead of racing an in-flight one');
  ok(/if \(saveBusyRef\.current\) \{ pendingSaveRef\.current = blobRef\.current; return; \}/.test(A9),'the flush queues too instead of racing with an old rev');
  ok(/if \(next && next !== lastSavedRef\.current\) postState\(next, false\);/.test(A9),'the queued newest state ships the moment the line clears, latest wins');
  ok((A9.match(/fetch\("\/api\/state", \{ method: "POST"/g) || []).length === 1,'exactly ONE code path posts state — postState is the single writer');
}
// v0.9.32: GPS jitter stays out of the saved state — location persists at ~110m grid, identity kept when unmoved
{
  const B1=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(/const r3 = \(n\) => Math\.round\(n \* 1000\) \/ 1000;/.test(B1),'savedGeo rounds to 3 decimals (~110m)');
  ok(/r3\(p\.lat\) === r3\(geo\.lat\) && r3\(p\.lng\) === r3\(geo\.lng\) \? p :/.test(B1),'an unmoved position keeps the SAME object — no blob churn, no save');
}
// v0.9.33: estimates itemize; deterministic summation with a 4/4/9 identity cross-check
{
  const src=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
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
  const src=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(src.split('!Object.values(keyIn).some((v) => String(v || \"\").trim())').length===3, 'Save gate (disabled + opacity) derives from Object.values — a ninth key field can never be forgotten');
  ok(!src.includes('!keyIn.a.trim() && !keyIn.g.trim()'), 'the enumerated field chain is gone from the gate');
  ok(src.includes('body.USDA_FDC_KEY = keyIn.fdc.trim()'), 'FDC key crosses the payload hop to the server name the whitelist expects');
}
// v0.9.35: updates must arrive — versioned bundle URLs + no-store HTML; CHECK 46 REBORN
{
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  const srv=require('fs').readFileSync('/home/claude/forkcaster/server/server.js','utf8');
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
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  const srv=require('fs').readFileSync('/home/claude/forkcaster/server/server.js','utf8');
  ok(app.includes('required: [\"item\", \"grams\"'), 'NL schema REQUIRES grams — the model must weigh every item');
  ok(app.split('groundFoodItems(').length>=4, 'both estimate paths (described + photo) ground through the shared helper');
  ok(srv.includes('app.post(\"/api/food/ground\"') && srv.includes('${FDC_BASE}'), 'ground endpoint exists and is stubbable via FDC_BASE');
  ok(srv.includes('return { grounded: false }'), 'no-match and FDC failure fall back honestly, never block');
  ok(app.includes('grounded: true') && app.includes('item: row.matched'), 'grounded lines take FDC values AND display the matched row name');
}
// v0.9.37: RHR wired end to end — ingest (both shapes) -> summary passthrough -> card
{
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  const srv=require('fs').readFileSync('/home/claude/forkcaster/server/server.js','utf8');
  ok(srv.includes('nm === \"resting_heart_rate\"'), 'HAE metric resting_heart_rate is ingested');
  ok(srv.includes('rec.restingHeartRate'), 'flat-shape rhr/restingHeartRate is ingested');
  ok(app.includes('rhrRead((healthSync && healthSync.days) || [], glp.doseLog)'), 'card reads the synced days + dose log');
  ok(app.includes('Resting heart rate') && app.includes('#f05252'), 'card exists and the vital sign line is RED (his call — dose curve stays purple)');
  ok(app.includes('not medical advice') || app.includes('Informational only'), 'flag banner keeps the informs-never-prescribes voice');
}
// v0.9.38: dose curve teaches steady-state; RHR card position is a signal
{
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(app.includes('doses.concat(virtual)'), 'projection includes scheduled future doses (steady-state build is drawn, not hidden)');
  ok(app.includes('level(now) / maxReal'), 'now-percent stays anchored to the peak actually reached, not the projected future peak');
  ok(app.includes('% at next dose'), 'next-dose marker names the projected trough');
  ok(app.split('rhrCardFor(_r)').length===3, 'RHR card renders in exactly one of two slots: top when flagged, below the med curve when quiet');
}
// v0.9.39: the X must be a perfect inverse of Add — EVERY meal-entry writer stores EVERY macro
// the delete subtracts. His field find: photo meal deleted, carbs+fiber orphaned on the Now card,
// because two of four entry writers enumerated {fat, protein, calories} and stopped (the picks
// writer and quick-add stored all five — a fix applied to one caller and not its siblings).
{
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
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
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(app.includes('commitQuick("set")') && app.includes('>Set</button>'), 'the editor has a Set button beside Add');
  ok(app.includes('const target = Number.isFinite(v) && v >= 0 ? v : 0;'), 'blank or invalid input sets ZERO — zeroing is the primary use');
  ok(app.includes('delta = target - cur'), 'Set computes a delta against the current counter');
  ok(app.includes('adjust: true'), 'corrections are recorded as adjustment rows, X-reversible like any entry');
  ok(!/mode === \"set\"[\s\S]{0,900}kcal \? \{ calories/.test(app.slice(app.indexOf('mode === \"set\"'), app.indexOf('mode === \"set\"')+900)), 'Set moves ONLY the tapped counter — no derived calorie side-effect');
}
// v0.9.41: injection-site sides are ANATOMICAL — his right-abdomen shot was recorded as
// "Abdomen L" because the dot map carried viewer-side coordinates under patient-side names.
{
  const app=require('fs').readFileSync('/home/claude/forkcaster/src/App.jsx','utf8');
  ok(app.includes('\"Abdomen L\": [belly * 0.8') && app.includes('\"Abdomen R\": [-belly * 0.8'), 'patient-left renders viewer-right: the front view is a mirror, like every medical chart');
  ok(app.includes('\"Thigh L\": [thW + 2.5') && app.includes('\"Arm L\": [sh + lp(7, 10)'), 'all three L/R pairs flipped together — no half-mirrored body');
  ok(app.includes('_siteMirrorFixed'), 'one-time migration flips pre-fix stored sites and flags itself done');
  ok(app.includes('are <b>your</b> left and right'), 'the caption teaches the mirror');
  ok(app.includes('>R</text>') && app.includes('>your right</text>'), 'radiograph-style R/L side markers on the avatar (his ask)');
}
console.log('\nSTRUCT: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
