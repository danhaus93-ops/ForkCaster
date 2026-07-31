const __FCROOT = require("path").resolve(__dirname, "..", "..");
// The gap that let a render-time crash ship: nothing in the rebuilt rig ever RENDERED the app.
const { execSync } = require('child_process');
const fs = require('fs');
const R = __FCROOT;
fs.writeFileSync(R + '/.smoke-entry.jsx', `
import React from "react";
import { renderToString } from "react-dom/server";
import App from "./src/App.jsx";
try { renderToString(React.createElement(App)); console.log("RENDER_OK"); }
catch (e) { console.log("RENDER_THREW: " + e.message); console.log((e.stack||"").split("\\n").slice(0,10).join("\\n")); process.exitCode = 1; }
// v0.9.60: DEEP passes — every tab, seeded with real-shaped data (his exact first two dose dates).
// The default render returns early everywhere data is empty; this is the pass that executes the
// med chart's full geometry, the checkpoint, the weight chart. The v0.9.59 TDZ dies here forever.
globalThis.__FC_TEST_STATE = { glp: { med: "semaglutide", dose: 0.25, injectionDay: "FR", lastInjection: "2026-07-31", weeksOn: 2, lastDoseChangeWk: 0, doseLog: [{ date: "2026-07-26", mg: 0.25 }, { date: "2026-07-31", mg: 0.25 }], sideEffects: [{ id: 1, symptom: "Nausea", severity: 1, date: "2026-07-26" }], protocol: { rungs: [0.25, 0.5, 1, 1.7, 2.4], minHoldDays: 28 } }, weightLog: [{ date: "2026-07-20", lbs: 230 }, { date: "2026-07-27", lbs: 228.4 }, { date: "2026-07-31", lbs: 227.1 }] };
let deepFail = 0;
for (const t of ["now", "today", "plan", "body", "train", "glp1", "coach"]) {
  globalThis.__FC_TEST_TAB = t;
  try { renderToString(React.createElement(App)); console.log("DEEP_OK " + t); }
  catch (e) { console.log("DEEP_THREW " + t + ": " + e.message); deepFail++; }
}
if (deepFail) process.exitCode = 1; else console.log("DEEP_RENDER_OK");
`);
try {
  execSync(`cd ${R} && npx esbuild .smoke-entry.jsx --bundle --platform=node --format=cjs --outfile=${__dirname}/smoke/bundle.cjs --loader:.jsx=jsx --jsx=automatic --loader:.png=dataurl --log-level=error`, {stdio:'pipe'});
  const out = execSync(`node -e "require(__dirname + '/smoke/shim.js'); require(__dirname + '/smoke/bundle.cjs');"`, {stdio:'pipe'}).toString();
  console.log(out.trim());
  process.exit(/RENDER_OK/.test(out) && /DEEP_RENDER_OK/.test(out) ? 0 : 1);
} catch (e) {
  console.log('RENDER SMOKE FAILED:\n' + (e.stdout||'').toString() + (e.stderr||'').toString().slice(0,900));
  process.exit(1);
} finally { try { fs.unlinkSync(R + '/.smoke-entry.jsx'); } catch {} }
