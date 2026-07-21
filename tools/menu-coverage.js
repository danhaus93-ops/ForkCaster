#!/usr/bin/env node
/*
 * ForkCaster menu-coverage harness.
 * Runs the REAL scrape pipeline (your node's Chromium + internet) against a batch of
 * chains at once and prints a coverage table — so we can see what works, catch
 * regressions, and fix chains in batches WITHOUT visiting each restaurant.
 *
 * Run on the node — INSIDE the container (no host node needed; tools/ ships in the image):
 *   sudo docker exec -e FC_BASE=http://localhost:3450 forkcaster-coach_web_1 node /app/tools/menu-coverage.js
 *   sudo docker exec -e FC_BASE=http://localhost:3450 forkcaster-coach_web_1 node /app/tools/menu-coverage.js sonic popeyes
 * Or from the host if node is installed:
 *   node tools/menu-coverage.js                # talks to http://localhost:3451
 *
 * First run is SLOW (cold cache, ~60-90s/chain). Results cache 6h, so a re-run is fast.
 * Save a snapshot to compare later:  node tools/menu-coverage.js > coverage.txt
 */
const BASE = process.env.FC_BASE || "http://localhost:3451";
const GOAL = process.env.FC_GOAL || "glp1";

// Curated across the major menu platforms (RBI, Inspire, Yum, Olo, Contentful, Next.js, etc.)
const CHAINS = [
  ["popeyes", "https://www.popeyes.com"],
  ["sonic", "https://www.sonicdrivein.com"],
  ["chick-fil-a", "https://www.chick-fil-a.com"],
  ["mcdonalds", "https://www.mcdonalds.com"],
  ["wendys", "https://www.wendys.com"],
  ["burgerking", "https://www.bk.com"],
  ["tacobell", "https://www.tacobell.com"],
  ["chipotle", "https://www.chipotle.com"],
  ["subway", "https://www.subway.com"],
  ["panera", "https://www.panerabread.com"],
  ["fiveguys", "https://www.fiveguys.com"],
  ["raisingcanes", "https://www.raisingcanes.com"],
  ["culvers", "https://www.culvers.com"],
  ["jimmyjohns", "https://www.jimmyjohns.com"],
  ["pandaexpress", "https://www.pandaexpress.com"],
  ["kfc", "https://www.kfc.com"],
  ["arbys", "https://www.arbys.com"],
  ["jackinthebox", "https://www.jackinthebox.com"],
  ["whataburger", "https://whataburger.com"],
  ["dairyqueen", "https://www.dairyqueen.com"],
  ["zaxbys", "https://www.zaxbys.com"],
  ["bojangles", "https://www.bojangles.com"],
  ["deltaco", "https://www.deltaco.com"],
  ["firehousesubs", "https://www.firehousesubs.com"],
  ["jerseymikes", "https://www.jerseymikes.com"],
  ["firstwatch", "https://www.firstwatch.com"],
  ["huntbrothers", "https://www.huntbrotherspizza.com"],
  ["scooters", "https://www.scooterscoffee.com"],
];

const pick = process.argv.slice(2).map((s) => s.toLowerCase());
const list = pick.length ? CHAINS.filter(([n]) => pick.includes(n)) : CHAINS;

// fat evidence: structured items carry fat, or the text mentions fat inline OR as a PDF table header ("TOTAL FAT (G)")
const withFat = (d) => (Array.isArray(d.items) && d.items.some((i) => i && i.fat != null)) || /\dg fat|total\s*fat|fat\s*\(g\)/i.test(d.text || "");
const src = (t) => (/NUTRITION \(official PDF\)/.test(t) ? "PDF" : /NUTRITION \(structured data\)/.test(t) ? "JSON" : /NUTRITION \(raw menu data/.test(t) ? "rawJSON" : "text/est");

async function one([name, url]) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/menu?url=${encodeURIComponent(url)}&goal=${GOAL}`, { signal: AbortSignal.timeout(150000) });
    const d = await r.json();
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!d || !d.ok) return { name, ok: false, secs, note: (d && d.reason) || `http ${r.status}` };
    const items = Array.isArray(d.items) ? d.items : [];
    const sample = items.slice(0, 2).map((i) => `${i.item}(${i.protein ?? "?"}p/${i.cal ?? "?"}c/${i.fat ?? "?"}f)`).join(", ");
    return { name, ok: true, secs, method: d.method, items: items.length, fat: withFat(d), src: src(d.text), len: (d.text || "").length, sample };
  } catch (e) {
    return { name, ok: false, secs: ((Date.now() - t0) / 1000).toFixed(0), note: e.name === "TimeoutError" ? "timeout(150s)" : e.message };
  }
}

(async () => {
  console.log(`ForkCaster coverage · ${BASE} · goal=${GOAL} · ${list.length} chains · ${new Date().toISOString()}\n`);
  console.log("chain            ok  src       items  fat  method  secs  sample");
  console.log("---------------- --- --------- -----  ---  ------  ----  ------");
  let good = 0, structured = 0, pdf = 0;
  for (const c of list) {           // sequential: renders are lock-serialized on the node anyway
    const x = await one(c);
    if (x.ok) {
      good++;
      if (x.src === "JSON") structured++;
      if (x.src === "PDF") pdf++;
      console.log(
        `${x.name.padEnd(16)} ok  ${String(x.src).padEnd(9)} ${String(x.items).padStart(5)}  ${x.fat ? "yes" : "no "}  ${String(x.method).padEnd(6)}  ${String(x.secs).padStart(4)}  ${x.sample || ""}`
      );
    } else {
      console.log(`${x.name.padEnd(16)} --                              ${String(x.secs).padStart(4)}  ${x.note}`);
    }
  }
  console.log(`\nSUMMARY: ${good}/${list.length} returned a menu · ${pdf} via official PDF · ${structured} via structured JSON · ${good - pdf - structured} text/estimate`);
  console.log("Re-run after changes to catch regressions. 'ok' + real items/fat = working; '--' or text/est = needs work.");
})();
