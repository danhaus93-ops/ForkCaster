#!/usr/bin/env node
/* ForkCaster deep scan — the five shapes that actually broke things.
 *
 * Every bug in this project's recent history has been one of five, and each is visible in the
 * source if you look for the right thing. The rig's other suites assert that specific known
 * behaviours hold; this one looks for CLASSES of fault without being told where they are.
 *
 *   1. STALE   a state field that is read but never written — decided once, then frozen
 *   2. GHOST   an identifier used in a render expression that is declared nowhere
 *   3. CONTRACT a field or status read off an engine result that the engine cannot return
 *   4. COLLIDE two different cards sharing a verdict id, where the second silently loses
 *   5. ORPHAN  a status the code can SET with no branch that renders it, or vice versa
 *
 * Run: node tools/ftest/deep-scan.js [--strict]
 * Advisory by default; --strict exits non-zero on any finding so it can gate a release.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const APP = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "server/server.js"), "utf8");

const findings = [];
const note = (kind, msg, detail) => findings.push({ kind, msg, detail });

/* Strip string and template literals so prose is never mistaken for code. Template ${...} parts
   are kept, because those DO hold identifiers — this distinction is what made an earlier version
   of this check report "no restriction" as an undefined variable. */
const codeOnly = (src) =>
  src
    .replace(/`([^`\\]|\\.)*`/g, (m) => (m.match(/\$\{[^}]*\}/g) || []).join(" "))
    .replace(/"([^"\\]|\\.)*"/g, ' ""ml')
    .replace(/'([^'\\]|\\.)*'/g, " ''ml")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

/* Brace-match a body starting at an index — used everywhere a function's true extent matters.
   Counting characters instead of matching braces is how a 700-char window missed the fields it
   was asserting on. */
function bodyAt(src, i) {
  let d = 0, k = src.indexOf("{", i);
  if (k < 0) return "";
  for (let j = k; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}

/* ---------- 1. STALE: read but never written ---------- */
{
  // not `body` — that name is also the server request body, which has different fields
  for (const [obj, label] of [["glp", "glp"], ["prefs", "prefs"]]) {
    const reads = new Set([...APP.matchAll(new RegExp("\\b" + obj + "\\.(\\w+)", "g"))].map((m) => m[1]));
    for (const f of reads) {
      if (["length", "map", "filter", "find", "reduce", "slice", "some", "every"].includes(f)) continue;
      const withoutReads = APP.replace(new RegExp("\\b" + obj + "\\." + f + "\\b", "g"), " ");
      // written as an object key anywhere, or through a computed key in a toggle list
      const keyed = new RegExp("\\b" + f + ":\\s").test(withoutReads);
      const viaKey = new RegExp('\\["' + f + '",').test(APP);
      if (!keyed && !viaKey)
        note("STALE", `${label}.${f} is read but never written`,
          "decided once and then frozen — the lastDoseChangeWk shape");
    }
  }
}

/* ---------- 2. GHOST — deliberately NOT done here ----------
   An undefined identifier needs real scope analysis, and regex cannot do that on 700KB of JSX:
   an early version of this check reported C.violet as an undefined variable called "violet", and
   stripping template literals to fix that destroyed the very declarations it was looking for.
   The render smoke already catches this class properly, by EVALUATING the expression — that is
   how `nudges` was caught before it shipped. The right investment is more render coverage, not a
   cleverer regex. See RENDER STATES at the bottom of this file. */

/* ---------- 3. CONTRACT: fields and statuses an engine cannot return ---------- */
{
  const engines = ["doseResponseRead", "adaptiveRead", "checkpointRead", "sleepRead", "rhrRead", "levelModel"];
  for (const name of engines) {
    let i = APP.indexOf("function " + name);
    if (i < 0) { const m = new RegExp("(?:const|let)\\s+" + name + "\\s*=").exec(APP); if (m) i = m.index; }
    if (i < 0) continue;
    const body = bodyAt(APP, i);
    if (body.length < 60) continue;
    const keys = new Set(), statuses = new Set();
    for (const r of body.matchAll(/return \{/g)) {
      let d = 1, e = r.index + r[0].length;
      for (; e < body.length; e++) { if (body[e] === "{") d++; else if (body[e] === "}") { d--; if (!d) break; } }
      const obj = body.slice(r.index + r[0].length, e);
      for (const k of obj.matchAll(/(\w+):/g)) keys.add(k[1]);
      for (const k of obj.matchAll(/(?:^|[{,])\s*(\w+)\s*(?=[,}]|$)/g)) keys.add(k[1]);
      for (const sp of obj.matchAll(/\.\.\.(\w+)/g)) {
        const src = new RegExp("(?:const|let)\\s+" + sp[1] + "\\s*=\\s*\\{").exec(body);
        if (src) for (const k of bodyAt(body, src.index).matchAll(/(\w+):/g)) keys.add(k[1]);
        else keys.add("*");                        // spread from something we cannot resolve
      }
      for (const st of obj.matchAll(/status:\s*"(\w+)"/g)) statuses.add(st[1]);
    }
    if (!keys.size) continue;
    // every variable assigned from this engine, and what is read off it
    for (const a of APP.matchAll(new RegExp("\\b(\\w+)\\s*=\\s*" + name + "\\(", "g"))) {
      const v = a[1];
      if (v.length > 12) continue;
      const reads = new Set([...APP.matchAll(new RegExp("\\b" + v + "\\.(\\w+)", "g"))].map((m) => m[1]));
      for (const f of reads) {
        if (keys.has("*")) continue;   // an unresolvable spread — cannot prove absence
        if (keys.has(f) || ["length","map","filter","find","reduce","slice","some","every","toFixed"].includes(f)) continue;
        note("CONTRACT", `${v}.${f} is read but ${name} never returns ${f}`,
          "returns: " + [...keys].sort().join(", "));
      }
      for (const s of APP.matchAll(new RegExp("\\b" + v + "\\.status\\s*===\\s*\"(\\w+)\"", "g"))) {
        if (!statuses.has(s[1]))
          note("CONTRACT", `${v}.status === "${s[1]}" but ${name} only returns ${[...statuses].join("|")}`,
            "a comparison that can never be true");
      }
    }
  }
}

/* ---------- 4. COLLIDE: two cards on one verdict id ---------- */
{
  const byId = {};
  for (const m of APP.matchAll(/\bid:\s*"([a-z][\w-]{1,20})",\s*tone:/g)) {
    // group by the enclosing card, so one card's two return paths are not counted as two cards
    const cardStart = APP.lastIndexOf("card(", m.index);
    (byId[m[1]] = byId[m[1]] || new Set()).add(cardStart);
  }
  for (const id in byId)
    if (byId[id].size > 1)
      note("COLLIDE", `verdict id "${id}" is used by ${byId[id].size} different cards`,
        "the second one silently loses — this removed the medication picker");
}

/* ---------- 5. ORPHAN: a status set with nothing to render it ---------- */
{
  for (const [setter, reader] of [["setScan", "scan"], ["setSim", "sim"], ["setLabDraft", "labDraft"]]) {
    const set = new Set([...APP.matchAll(new RegExp(setter + "\\(\\{ status: \"(\\w+)\"", "g"))].map((m) => m[1]));
    if (!set.size) continue;
    const shown = new Set([...APP.matchAll(new RegExp(reader + "\\.status === \"(\\w+)\"", "g"))].map((m) => m[1]));
    for (const st of set)
      if (!shown.has(st) && !["idle", "loading"].includes(st))
        note("ORPHAN", `${reader} can be set to "${st}" but nothing renders that state`,
          "the barcode failure shape — a dead end with no message");
    for (const st of shown)
      if (!set.has(st))
        note("ORPHAN", `${reader}.status === "${st}" is rendered but never set`, "dead branch");
  }
}

/* ---------- report ---------- */
const KINDS = ["CONTRACT", "COLLIDE", "ORPHAN", "STALE"];
const by = {};
for (const f of findings) (by[f.kind] = by[f.kind] || []).push(f);
console.log("\n=== DEEP SCAN ===\n");
for (const k of KINDS) {
  const list = by[k] || [];
  console.log(`  ${k}: ${list.length}`);
  for (const f of list) {
    console.log(`     ${f.msg}`);
    if (f.detail) console.log(`        ${f.detail}`);
  }
}
const total = findings.length;
console.log(`\n  ${total} finding${total === 1 ? "" : "s"}`);
if (process.argv.includes("--strict") && total) { console.log("DEEP_SCAN_FAILED"); process.exit(1); }
console.log(total ? "DEEP_SCAN_ADVISORY" : "DEEP_SCAN_CLEAN");
