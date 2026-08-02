const __FCROOT = require("path").resolve(__dirname, "..", "..");
// The gap that let a render-time crash ship: nothing in the rebuilt rig ever RENDERED the app.
const { execSync } = require('child_process');
const fs = require('fs');
const R = __FCROOT;
fs.writeFileSync(R + '/.smoke-entry.jsx', `
import React from "react";
import { renderToString } from "react-dom/server";
import App, { MedLevelChart, medLevelModel, SiteAvatar, siteRotation } from "./src/App.jsx";
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
// v0.9.108: COMPACT pass. The collapsed rows are built inside verdict closures that never execute
// with compact off, so a scope error in one of them rendered green here and crashed on his phone.
globalThis.__FC_TEST_STATE = { ...globalThis.__FC_TEST_STATE, prefs: { ...(globalThis.__FC_TEST_STATE.prefs || {}), compact: true } };
let cmpFail = 0;
for (const t of ["now", "today", "plan", "body", "train", "glp1", "coach"]) {
  globalThis.__FC_TEST_TAB = t;
  try { renderToString(React.createElement(App)); console.log("COMPACT_OK " + t); }
  catch (e) { console.log("COMPACT_THREW " + t + ": " + e.message); cmpFail++; }
}
if (cmpFail) process.exitCode = 1; else console.log("COMPACT_RENDER_OK");
// v0.9.125: a card that DECLARES a verdict must actually collapse in compact. Body's weight card
// declared one and still rendered its full prose, so the declaration alone proves nothing.
globalThis.__FC_TEST_TAB = "body";
{
  const h = renderToString(React.createElement(App));
  const leaked = ["fat to lose", "lean to protect", "protein floor"].filter((t) => h.includes(t));
  if (leaked.length) { console.log("COLLAPSE_LEAK body weight card still renders: " + leaked.join(", ")); process.exitCode = 1; }
  else console.log("COLLAPSE_OK body");
}
// v0.9.111: render the med chart DIRECTLY. Mounting it through a tab depends on onMed, the tab's
// early returns and the density mode; three ReferenceErrors inside it reached his phone while every
// tab pass reported green. This mounts the component itself, so nothing can gate it out.
try {
  const C = { dark: true, bg: "#0A0E13", surface: "#141C25", surfaceAlt: "#1B2530", hair: "#232E3A",
    ink: "#F2F6F4", ink2: "#C8D2D8", muted: "#8595A2", faint: "#5B6874", go: "#3BDF93", gold: "#D9A441",
    caution: "#F0B455", avoid: "#F0705A", violet: "#AE9BF6", blue: "#5AB0E0", goSoft: "#12301F" };
  const log = [{ date: "2026-07-26", mg: 0.25 }, { date: "2026-07-31", mg: 0.25 }];
  renderToString(React.createElement(MedLevelChart, { C, doseLog: log, med: "semaglutide", dueISO: "2026-08-07", intervalDays: 7 }));
  // and the model both consumers share must expose every field the row reads
  const M = medLevelModel({ doseLog: log, med: "semaglutide", dueISO: "2026-08-07", intervalDays: 7 });
  const need = ["ssPct", "ssPeak", "absorbing", "absPeakPct", "absDays", "nextPct", "climbing", "level", "now"];
  const missing = need.filter((k) => M[k] === undefined);
  if (missing.length) { console.log("MED_MODEL_MISSING: " + missing.join(",")); process.exitCode = 1; }
  else console.log("MED_CHART_OK");
} catch (e) { console.log("MED_CHART_THREW: " + e.message); process.exitCode = 1; }
// v0.9.116: the injection map, rendered on its own. Extracting the rotation board stranded three
// bindings the avatar still used; mounting it through the tab did not exercise the branch that
// referenced them. Render the component itself, with and without sited doses.
try {
  const C = { dark: true, bg: "#0A0E13", surface: "#141C25", surfaceAlt: "#1B2530", hair: "#232E3A",
    ink: "#F2F6F4", ink2: "#C8D2D8", muted: "#8595A2", faint: "#5B6874", go: "#3BDF93", gold: "#D9A441",
    caution: "#F0B455", avoid: "#F0705A", violet: "#AE9BF6", blue: "#5AB0E0", goSoft: "#12301F" };
  const sited = [{ date: "2026-07-26", mg: 0.25, site: "Abdomen L" }, { date: "2026-07-31", mg: 0.25, site: "Abdomen R" }];
  for (const [label, log, per] of [["empty", [], 1], ["sited", sited, 1], ["multi", sited, 3]]) {
    renderToString(React.createElement(SiteAvatar, { C, sex: "male", bmi: 31, doseLog: log, perSite: per, pendingSite: null, setPendingSite: () => {} }));
    // mini must draw the figure and NOTHING else — no headings, no chip, no paragraph
    const m = renderToString(React.createElement(SiteAvatar, { C, sex: "male", bmi: 31, doseLog: log, perSite: per, pendingSite: null, setPendingSite: () => {}, mini: true }));
    if (!/<svg/.test(m)) { console.log("SITE_MINI: no figure drawn (" + label + ")"); process.exitCode = 1; }
    if (/Injection site|NEXT:|Cycle |front view/.test(m)) { console.log("SITE_MINI: mini leaked card prose (" + label + ")"); process.exitCode = 1; }
    if (m.length > 9000) { console.log("SITE_MINI: mini too heavy for a row (" + label + ", " + m.length + ")"); process.exitCode = 1; }
    const r = siteRotation(log, per);
    if (r.used === undefined || r.suggested === undefined) { console.log("SITE_ROTATION_MISSING: " + label); process.exitCode = 1; }
  }
  console.log("SITE_AVATAR_OK");
} catch (e) { console.log("MED_CHART_THREW: " + e.message); process.exitCode = 1; }
`);
try {
  execSync(`cd ${R} && npx esbuild .smoke-entry.jsx --bundle --platform=node --format=cjs --outfile=${__dirname}/smoke/bundle.cjs --loader:.jsx=jsx --jsx=automatic --loader:.png=dataurl --log-level=error`, {stdio:'pipe'});
  const out = execSync(`node -e "require(__dirname + '/smoke/shim.js'); require(__dirname + '/smoke/bundle.cjs');"`, {stdio:'pipe'}).toString();
  console.log(out.trim());
  // v0.9.112: the collapsed row and the chart's chip must print the SAME number. The chip uses
  // vsPeak — level against the highest prior cycle peak — and the row briefly used ssPct, which is
  // against steady state. Both honest, answering different questions, disagreeing on one screen.
  const SRC = fs.readFileSync(R + '/src/App.jsx', 'utf8');
  const at = SRC.indexOf('id: "med", tone: C.violet');
  const row = at < 0 ? '' : SRC.slice(at, at + 900);
  let denomOK = true;
  if (!/value: String\(_M\.vsPeak\)/.test(row)) { console.log('MED_ROW_DENOMINATOR: row does not print vsPeak'); denomOK = false; }
  if (/_M\.ssPct/.test(row)) { console.log('MED_ROW_DENOMINATOR: row still reads ssPct'); denomOK = false; }
  if (!/\{vsPeak\}%/.test(SRC)) { console.log('MED_ROW_DENOMINATOR: chart chip no longer prints vsPeak'); denomOK = false; }
  // v0.9.113: the sparkline must be the chart's curve, not a decay. Sampling level() past now loses
  // every planned dose and the saw-tooth with it, so the row showed a fading line under a climbing chart.
  const sp = SRC.slice(SRC.indexOf('const spark = (() => {'), SRC.indexOf('const spark = (() => {') + 1200);
  let shapeOK = true;
  if (!/_M\.levelProj\(t\)/.test(sp)) { console.log('MED_SPARK_SHAPE: spark does not project future doses'); shapeOK = false; }
  if (!/t0 = _M\.start, t1 = _M\.end/.test(sp)) { console.log('MED_SPARK_SHAPE: spark window is not the chart window'); shapeOK = false; }
  if (!/t <= _M\.now \? _M\.level\(t\)/.test(sp)) { console.log('MED_SPARK_SHAPE: logged history must use level()'); shapeOK = false; }
  if (shapeOK) console.log('MED_SPARK_OK');
  if (denomOK && shapeOK) console.log('MED_DENOMINATOR_OK');
  process.exit(/RENDER_OK/.test(out) && /DEEP_RENDER_OK/.test(out) && /COMPACT_RENDER_OK/.test(out) && /MED_CHART_OK/.test(out) && denomOK && shapeOK && /SITE_AVATAR_OK/.test(out) && /COLLAPSE_OK/.test(out) ? 0 : 1);
} catch (e) {
  console.log('RENDER SMOKE FAILED:\n' + (e.stdout||'').toString() + (e.stderr||'').toString().slice(0,900));
  process.exit(1);
} finally { try { fs.unlinkSync(R + '/.smoke-entry.jsx'); } catch {} }
