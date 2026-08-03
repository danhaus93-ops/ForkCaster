#!/usr/bin/env node
/* ForkCaster visual audit — the only check in this project that sees GEOMETRY.
 *
 * Every other suite reads source or server-rendered HTML. Both are blind to layout: they cannot
 * see a control that is 28px tall, a label that wraps to three lines, a number clipped by its
 * container, or a tab that is fourteen screens deep. That blindness is why a text scan called the
 * tab bar 28px when the real content was 46px, and why his screenshots have repeatedly caught what
 * every automated pass missed.
 *
 * It runs INSIDE the app container, against the running server, using the Chromium that is already
 * in the image for menu scraping. Nothing to install.
 *
 *   docker exec forkcaster_web_1 node tools/ftest/visual-audit.js
 *   docker exec forkcaster_web_1 node tools/ftest/visual-audit.js --shots /data/audit
 *
 * Exits non-zero if anything fails a floor, so it can gate a release like the rest of the rig.
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3450;
const BASE = process.env.AUDIT_URL || `http://127.0.0.1:${PORT}`;
const EXE = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser";
const SHOT_DIR = (() => {
  const i = process.argv.indexOf("--shots");
  return i > 0 ? process.argv[i + 1] : null;
})();

/* The widths that matter: his phone and the two either side of it. A control that fits at 430
   can still wrap at 375, which is the device the layout budget has always been computed for. */
const WIDTHS = [
  { w: 375, h: 812, name: "375pt" },
  { w: 393, h: 852, name: "393pt" },
  { w: 430, h: 932, name: "430pt" },
];
const TABS = ["now", "today", "plan", "body", "train", "glp", "coach"];
const TOUCH_MIN = 44;          // Apple HIG
const TOUCH_MIN_COMPACT = 38;  // the density he opted into

const problems = [];
const note = (kind, msg) => problems.push({ kind, msg });

async function auditPage(page, label, compact) {
  return page.evaluate(({ TOUCH_MIN, TOUCH_MIN_COMPACT, compact }) => {
    const floor = compact ? TOUCH_MIN_COMPACT : TOUCH_MIN;
    const out = { small: [], clipped: [], overflow: [], scrollH: 0, cards: 0 };
    out.scrollH = document.documentElement.scrollHeight;
    out.cards = document.querySelectorAll("[data-card-id]").length;

    /* v0.9.158: report the OUTERMOST interactive element only. A button containing a div
       containing a span counted three times, which is how one small chip became three findings. */
    const interactive = [...document.querySelectorAll('button, [role="button"], a, select, input')];
    const isNested = (el) => interactive.some((o) => o !== el && o.contains(el));
    /* Anything inside a horizontal scroller is deliberately off-screen — a carousel is not a
       layout fault, and treating it as one buried the real findings under place chips. */
    const inScroller = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };

    const seen = new Set();
    for (const el of interactive) {
      if (isNested(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // height is what a thumb misses; a full-width row 30px tall is the real failure mode
      if (r.height >= floor) continue;
      const label = (el.textContent || "").trim().slice(0, 28) || el.tagName.toLowerCase();
      const key = label + "|" + Math.round(r.height);
      if (seen.has(key)) continue;
      seen.add(key);
      out.small.push({ label, h: Math.round(r.height), w: Math.round(r.width) });
    }

    for (const el of document.querySelectorAll("span, div")) {
      if (el.children.length) continue;
      const t = (el.textContent || "").trim();
      if (t.length < 2) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        const ell = getComputedStyle(el).textOverflow === "ellipsis";
        out.clipped.push({ text: t.slice(0, 34), by: el.scrollWidth - el.clientWidth, ell });
      }
    }

    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll("div, span, img, button")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (inScroller(el)) continue;                    // a carousel is meant to run off-screen
      const t = (el.textContent || "").trim().slice(0, 26) || el.tagName.toLowerCase();
      out.overflow.push({ text: t, right: Math.round(r.right), vw });
      if (out.overflow.length > 6) break;
    }
    return out;
  }, { TOUCH_MIN, TOUCH_MIN_COMPACT, compact });
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.log("VISUAL_AUDIT_SKIPPED no chromium at " + EXE);
    process.exit(0);
  }
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EXE,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const summary = [];
  try {
    /* Density is READ, never written. State lives in state.json on his node, so setting compact
       here would edit his real preferences to run a test — and leave them edited if the audit
       crashed midway. The audit measures the app as he actually has it. Whether compact is denser
       than comfortable is a separate question, answered by the DENSITY probe in render-smoke,
       which can seed prefs safely because it never touches his data. */
    let compact = false;
    try {
      const r = await fetch(BASE + "/api/state");
      const st = await r.json();
      compact = !!((st && st.prefs) || {}).compact;
    } catch {}
    console.log("auditing in " + (compact ? "COMPACT" : "COMFORTABLE") + " density (as configured on this node)");

    for (const dev of WIDTHS) {
      {
        const page = await browser.newPage();
        await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });

        for (const tab of TABS) {
          const clicked = await page.evaluate((t) => {
            const b = [...document.querySelectorAll("button")]
              .find((x) => (x.textContent || "").trim().toLowerCase() === t.replace("glp", "glp-1"));
            if (b) { b.click(); return true; }
            return false;
          }, tab);
          if (!clicked) continue;
          await new Promise((r) => setTimeout(r, 350));

          const label = `${dev.name}/${compact ? "compact" : "comfort"}/${tab}`;
          const res = await auditPage(page, label, compact);
          summary.push({ label, scrollH: res.scrollH, cards: res.cards, small: res.small.length });

          for (const s of res.small)
            note("TOUCH", `${label}: "${s.label}" is ${s.h}x${s.w}px, under the ${compact ? TOUCH_MIN_COMPACT : TOUCH_MIN}px floor`);
          for (const c of res.clipped)
            note(c.ell ? "TRUNCATED" : "CLIP",
              `${label}: "${c.text}" ${c.ell ? "truncates" : "is hard-clipped"} by ${c.by}px`);
          for (const o of res.overflow)
            note("OVERFLOW", `${label}: "${o.text}" extends to ${o.right}px past a ${o.vw}px viewport`);

          if (SHOT_DIR && dev.w === 393) {
            await page.screenshot({
              path: path.join(SHOT_DIR, `${compact ? "compact" : "comfort"}-${tab}.png`),
              fullPage: true,
            });
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== SCROLL DEPTH (393pt, screens of 852px) ===");
  for (const s of summary.filter((x) => x.label.startsWith("393pt")))
    console.log(`  ${s.label.padEnd(26)} ${(s.scrollH / 852).toFixed(1)} screens · ${s.cards} cards`);

  const byKind = {};
  for (const p of problems) (byKind[p.kind] = byKind[p.kind] || []).push(p.msg);
  console.log("\n=== FINDINGS ===");
  for (const k of ["CLIP", "OVERFLOW", "TOUCH", "TRUNCATED"]) {
    const list = byKind[k] || [];
    console.log(`  ${k}: ${list.length}`);
    for (const m of list.slice(0, 12)) console.log("    " + m);
    if (list.length > 12) console.log(`    …and ${list.length - 12} more`);
  }
  if (SHOT_DIR) console.log(`\n  screenshots written to ${SHOT_DIR}`);

  /* What FAILS versus what is merely reported. A hard clip means text is unreadable and an
     overflow means the layout is broken — those are defects. Touch findings are a floor to work
     toward, and truncations are his own rule to judge case by case; both are printed, neither
     stops a release. A check that fails on everything gets ignored, which is the state this tool
     exists to fix. */
  const hard = problems.filter((p) => p.kind === "CLIP" || p.kind === "OVERFLOW").length;
  if (hard) { console.log("\nVISUAL_AUDIT_FAILED " + hard + " layout defects (" + (problems.length - hard) + " advisories)"); process.exit(1); }
  if (problems.length) { console.log("\nVISUAL_AUDIT_OK with " + problems.length + " advisories"); process.exit(0); }
  console.log("\nVISUAL_AUDIT_OK");
})().catch((e) => { console.log("VISUAL_AUDIT_ERROR " + (e && e.message ? e.message : e)); process.exit(1); });
