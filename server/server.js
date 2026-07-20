/* ForkCaster backend — keys live HERE, never in the client.
   Persistence: flat JSON + photo files in DATA_DIR (Umbrel volume). */
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3450;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const PHOTO_DIR = path.join(DATA_DIR, "photos");
const STATE_FILE = path.join(DATA_DIR, "state.json");
/* Keys: env first, else /data/secrets.json — so nothing secret ever
   lives in the (public) store repo. Create the file on the node:
   echo '{"ANTHROPIC_API_KEY":"sk-ant-..."}' > .../app-data/forkcaster-coach/data/secrets.json */
function readSecrets() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "secrets.json"), "utf8")); } catch { return {}; }
}
const key = (name) => {
  const sv = readSecrets()[name];
  if (sv && String(sv).trim()) return String(sv).trim();
  const ev = process.env[name];
  return ev && ev !== "CHANGEME" ? ev : "";
};
const ANTHROPIC_KEY_ENV = process.env.ANTHROPIC_API_KEY || "";

fs.mkdirSync(PHOTO_DIR, { recursive: true });

const VERSION = (() => { try { return require("../package.json").version; } catch { return "?"; } })();
const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/api/version", (_req, res) => res.json({ version: VERSION }));

/* ── state persistence ── */
app.get("/api/state", (_req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))); }
  catch { res.json({ saved: false }); }
});
app.delete("/api/state", (_req, res) => {
  try { fs.rmSync(STATE_FILE, { force: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post("/api/state", (req, res) => {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(req.body)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

/* ── progress photos (stored on-node, private) ── */
app.post("/api/photo", (req, res) => {
  try {
    const { data, media } = req.body || {};
    if (!data) return res.status(400).json({ error: "no data" });
    const ext = /png/.test(media || "") ? "png" : "jpg";
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    fs.writeFileSync(path.join(PHOTO_DIR, `${id}.${ext}`), Buffer.from(data, "base64"));
    res.json({ id, url: `/api/photo/${id}.${ext}` });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.get("/api/photo/:file", (req, res) => {
  const f = path.join(PHOTO_DIR, path.basename(req.params.file));
  if (!fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});

/* ── API key management (personal app behind Tailscale; keys never returned in full) ── */
app.get("/api/keys/status", (_req, res) => {
  const get = (n) => key(n);
  const tail = (v) => (v ? "\u2026" + String(v).slice(-4) : null);
  res.json({
    anthropic: !!get("ANTHROPIC_API_KEY"), anthropicTail: tail(get("ANTHROPIC_API_KEY")),
    places: !!get("GOOGLE_PLACES_KEY"), placesTail: tail(get("GOOGLE_PLACES_KEY")),
    usda: !!get("USDA_FDC_KEY"),
    fatsecret: !!(get("FATSECRET_CLIENT_ID") && get("FATSECRET_CLIENT_SECRET")),
  });
});
app.post("/api/keys", (req, res) => {
  try {
    const cur = readSecrets(); const b = req.body || {};
    for (const k of ["ANTHROPIC_API_KEY", "GOOGLE_PLACES_KEY", "USDA_FDC_KEY", "FATSECRET_CLIENT_ID", "FATSECRET_CLIENT_SECRET"]) {
      if (typeof b[k] === "string" && b[k].trim()) cur[k] = b[k].trim();
    }
    fs.writeFileSync(path.join(DATA_DIR, "secrets.json"), JSON.stringify(cur, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

/* ── AI proxy (ranking, coach, photo estimation) ── */
app.post("/api/ai", async (req, res) => {
  const ANTHROPIC_KEY = key("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) return res.json({ error: "No Anthropic key. Create data/secrets.json on the node with {\"ANTHROPIC_API_KEY\":\"sk-ant-...\"} — no restart needed." });
  try {
    const { prompt, system, image } = req.body || {};
    const content = image
      ? [{ type: "image", source: { type: "base64", media_type: image.media_type || "image/jpeg", data: image.data } }, { type: "text", text: prompt }]
      : prompt;
    const body = { model: (["claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"].includes(req.body && req.body.model) ? req.body.model : "claude-sonnet-4-6"), max_tokens: Math.max(256, Math.min(3000, parseInt(req.body && req.body.max_tokens) || 1000)), messages: [{ role: "user", content }] };
    if (req.body && req.body.temperature != null) body.temperature = Math.max(0, Math.min(1, +req.body.temperature));
    if (req.body && req.body.schema) body.output_config = { format: { type: "json_schema", schema: req.body.schema } };
    if (system) body.system = system;
    let r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (!r.ok && body.output_config) {
      // structured-output shape rejected (API drift): retry plain, client salvage still guards
      delete body.output_config;
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    const data = await r.json();
    if (data.error) return res.json({ error: data.error.message || "API error" });
    res.json({ text: (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("") });
  } catch (e) { res.json({ error: String(e) }); }
});

/* ── Open Food Facts barcode proxy (keyless) ── */
app.get("/api/off/:barcode", async (req, res) => {
  try {
    const bc = req.params.barcode.replace(/\D/g, "");
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${bc}.json?fields=product_name,brands,serving_size,nutriments`, {
      headers: { "User-Agent": "ForkCaster/0.1 (self-hosted; personal use)" },
    });
    res.json(await r.json());
  } catch (e) { res.json({ status: 0, error: String(e) }); }
});

/* ── FatSecret OAuth2 (client credentials; cached ~23h) ── */
let fsTok = null;
async function fatsecretToken() {
  const id = key("FATSECRET_CLIENT_ID"), sec = key("FATSECRET_CLIENT_SECRET");
  if (!id || !sec) throw new Error("fatsecret not configured");
  if (fsTok && fsTok.exp > Date.now() + 60000) return fsTok.t;
  const r = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${id}:${sec}`).toString("base64") },
    body: "grant_type=client_credentials&scope=basic",
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description || d.error || "token failed");
  fsTok = { t: d.access_token, exp: Date.now() + Math.max(60, (d.expires_in || 86400) - 300) * 1000 };
  return fsTok.t;
}

/* ── Normalized food lookup: Open Food Facts → USDA FDC fallback ──
   USDA works with the public DEMO_KEY out of the box (rate-limited);
   add {"USDA_FDC_KEY":"..."} to secrets.json for a free real key (api.data.gov). */
app.get("/api/food/:barcode", async (req, res) => {
  const bc = req.params.barcode.replace(/\D/g, "");
  if (!bc) return res.json({ found: false, error: "empty barcode" });
  // 1) Open Food Facts (3M+ products, global)
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${bc}.json?fields=product_name,brands,serving_size,nutriments`, {
      headers: { "User-Agent": "ForkCaster/0.1 (self-hosted; personal use)" },
    });
    const d = await r.json();
    if (d && d.status === 1 && d.product) {
      const n = d.product.nutriments || {};
      const per = (k) => (n[`${k}_serving`] != null ? +n[`${k}_serving`] : n[`${k}_100g`] != null ? +n[`${k}_100g`] : 0);
      const perServing = n["energy-kcal_serving"] != null || n["proteins_serving"] != null;
      return res.json({
        found: true, source: "Open Food Facts",
        name: d.product.product_name || "Unknown product",
        brand: (d.product.brands || "").split(",")[0] || "",
        basis: perServing ? (d.product.serving_size || "1 serving") : "100 g",
        calories: Math.round(per("energy-kcal")), protein: Math.round(per("proteins")),
        carbs: Math.round(per("carbohydrates")), fat: Math.round(per("fat")), fiber: Math.round(per("fiber")),
      });
    }
  } catch (e) { console.error("OFF lookup failed:", e.message); }
  // 2) USDA FoodData Central branded search by UPC
  try {
    const key2 = key("USDA_FDC_KEY") || "DEMO_KEY";
    const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key2}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: bc, dataType: ["Branded"], pageSize: 3 }),
    });
    const d = await r.json();
    const hit = (d.foods || []).find((f) => (f.gtinUpc || "").replace(/\D/g, "").endsWith(bc.slice(-11))) || (d.foods || [])[0];
    if (hit) {
      const by = {}; (hit.foodNutrients || []).forEach((x) => { by[x.nutrientId] = x.value; });
      return res.json({
        found: true, source: "USDA FoodData Central",
        name: hit.description || "Unknown product", brand: hit.brandOwner || hit.brandName || "",
        basis: "100 g",
        calories: Math.round(by[1008] || 0), protein: Math.round(by[1003] || 0),
        carbs: Math.round(by[1005] || 0), fat: Math.round(by[1004] || 0), fiber: Math.round(by[1079] || 0),
      });
    }
  } catch (e) { console.error("USDA lookup failed:", e.message); }
  // 3) FatSecret barcode lookup (restaurant/brand strength; needs client id+secret in secrets.json)
  try {
    const tok = await fatsecretToken();
    const gtin = bc.padStart(13, "0");
    const r1 = await fetch(`https://platform.fatsecret.com/rest/server.api?method=food.find_id_for_barcode&barcode=${gtin}&format=json`, { headers: { Authorization: `Bearer ${tok}` } });
    const d1 = await r1.json();
    const fid = d1 && d1.food_id && d1.food_id.value;
    if (fid && fid !== "0") {
      const r2 = await fetch(`https://platform.fatsecret.com/rest/server.api?method=food.get.v4&food_id=${fid}&format=json`, { headers: { Authorization: `Bearer ${tok}` } });
      const d2 = await r2.json();
      const f = d2 && d2.food;
      const servs = f && f.servings && f.servings.serving;
      const sv = Array.isArray(servs) ? servs[0] : servs;
      if (f && sv) {
        return res.json({
          found: true, source: "FatSecret",
          name: f.food_name || "Unknown product", brand: f.brand_name || "",
          basis: sv.serving_description || "1 serving",
          calories: Math.round(+sv.calories || 0), protein: Math.round(+sv.protein || 0),
          carbs: Math.round(+sv.carbohydrate || 0), fat: Math.round(+sv.fat || 0), fiber: Math.round(+sv.fiber || 0),
        });
      }
    }
  } catch (e) { console.error("FatSecret lookup failed:", e.message); }
  res.json({ found: false });
});

/* ── Nearby restaurants via Google Places (optional; demo list if no key) ── */
app.get("/api/nearby", async (req, res) => {
  const PLACES_KEY = key("GOOGLE_PLACES_KEY");
  if (!PLACES_KEY) return res.json({ venues: [], live: false }); // no key: client keeps labeled demo set
  try {
    const { lat, lng } = req.query;
    const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.primaryTypeDisplayName,places.primaryType,places.types,places.rating,places.photos,places.location,places.websiteUri",
      },
      body: JSON.stringify({
        includedTypes: ["restaurant", "fast_food_restaurant", "cafe", "meal_takeaway", "sandwich_shop", "bakery"],
        maxResultCount: Math.max(1, Math.min(20, parseInt(req.query.max) || 20)), rankPreference: "DISTANCE",
        locationRestriction: { circle: { center: { latitude: +lat, longitude: +lng }, radius: Math.max(500, Math.min(50000, parseInt(req.query.radius) || 3000)) } },
      }),
    });
    const data = await r.json();
    const NON_FOOD = new Set(["gas_station", "convenience_store", "shopping_mall", "grocery_store", "supermarket", "department_store", "liquor_store", "drugstore"]);
    const venues = (data.places || [])
      .filter((p) => !NON_FOOD.has(p.primaryType) && !(p.types || []).some((t) => NON_FOOD.has(t)))
      .map((p) => ({
      id: p.id,
      name: p.displayName && p.displayName.text,
      cuisine: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || "Restaurant",
      eta: "nearby",
      score: Math.min(5, (p.rating || 3.8)),
      lat: p.location && p.location.latitude, lng: p.location && p.location.longitude,
      website: p.websiteUri || null,
      photo: p.photos && p.photos[0] ? `/api/vphoto?name=${encodeURIComponent(p.photos[0].name)}` : null,
      menu: null, // Places has no menus; the AI proposes realistic goal-fit orders
    }));
    res.json({ venues, live: true });
  } catch (e) { res.json({ venues: [], live: false, error: String(e) }); }
});

/* ── Google Map Tiles proxy (key stays server-side).
   Requires in Google Cloud: (1) "Map Tiles API" enabled on the project,
   (2) Map Tiles API added to the key's API restrictions. Falls back 404 → client uses CARTO. */
const GMAP_DARK = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a95a5" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
];
const GMAP_STYLES = {
  day: { mapType: "roadmap" },
  night: { mapType: "roadmap", styles: GMAP_DARK },
  sat: { mapType: "satellite" },
};
const gmapSessions = {};
async function gmapSession(style) {
  const PLACES_KEY = key("GOOGLE_PLACES_KEY");
  if (!PLACES_KEY) throw new Error("no key");
  const cached = gmapSessions[style];
  if (cached && +cached.expiry > Date.now() / 1000 + 120) return cached.session;
  const cfg = GMAP_STYLES[style] || GMAP_STYLES.day;
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${PLACES_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: cfg.mapType, language: "en-US", region: "US", scale: "scaleFactor2x", highDpi: true, ...(cfg.styles ? { styles: cfg.styles } : {}) }),
  });
  const d = await r.json();
  if (!d.session) throw new Error((d.error && d.error.message) || "session failed");
  gmapSessions[style] = d;
  return d.session;
}
app.get("/api/gmap/tile/:style/:z/:x/:y", async (req, res) => {
  try {
    const PLACES_KEY = key("GOOGLE_PLACES_KEY");
    const { style, z, x, y } = req.params;
    const session = await gmapSession(style);
    const r = await fetch(`https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${session}&key=${PLACES_KEY}`);
    if (!r.ok) return res.status(404).end();
    res.set("Content-Type", r.headers.get("content-type") || "image/png");
    res.set("Cache-Control", "public, max-age=604800");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch { res.status(404).end(); }
});

/* ── Live menu extraction, three-stage escalation:
   (1) plain HTML fetch  (2) PDF text extraction  (3) headless Chromium render for JS menus.
   Personal-use fetches; every stage falls through gracefully. ── */
function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;|&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function urlAllowed(u) {
  try {
    const { protocol, hostname } = new URL(u);
    if (!/^https?:$/.test(protocol)) return false;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname)) return false;
    return true;
  } catch { return false; }
}
const MENU_UA = { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ForkCaster/0.2 personal use" };
async function fetchAny(u) {
  const r = await fetch(u, { headers: MENU_UA, redirect: "follow", signal: AbortSignal.timeout(9000) });
  if (!r.ok) return null;
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const len = parseInt(r.headers.get("content-length") || "0");
  if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(u)) {
    if (len > 15e6) return null;
    return { pdf: Buffer.from(await r.arrayBuffer()), url: r.url || u };
  }
  if (ct.includes("html")) return { html: await r.text(), url: r.url || u };
  return null;
}
async function pdfText(buf) {
  try { const pdfParse = require("pdf-parse"); const d = await pdfParse(buf, { max: 25 }); return (d.text || "").replace(/\s+/g, " ").trim(); }
  catch (e) { console.error("pdf parse failed:", e.message); return ""; }
}
let renderChain = Promise.resolve();
function withRenderLock(fn) { const p = renderChain.then(fn, fn); renderChain = p.catch(() => {}); return p; }
async function renderPage(startUrl) {
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(MENU_UA["User-Agent"]);
    await page.setViewport({ width: 414, height: 896 });
    let src = startUrl;
    await page.goto(src, { waitUntil: "networkidle2", timeout: 22000 });
    await new Promise((r) => setTimeout(r, 1500));
    let text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
    const menuHref = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll("a[href]"));
      const hit = as.find((a) => /menu/i.test(a.getAttribute("href") || "") || /^\s*(view\s+)?(our\s+)?(full\s+)?menu\s*$/i.test(a.textContent || ""));
      return hit ? hit.href : null;
    }).catch(() => null);
    if (menuHref && menuHref !== src && urlAllowed(menuHref)) {
      if (/\.pdf(\?|$)/i.test(menuHref)) { await browser.close(); return { pdfUrl: menuHref }; }
      try {
        await page.goto(menuHref, { waitUntil: "networkidle2", timeout: 22000 });
        await new Promise((r) => setTimeout(r, 1500));
        const t2 = await page.evaluate(() => (document.body ? document.body.innerText : ""));
        if (t2.length > text.length) { text = t2; src = menuHref; }
      } catch {}
    }
    return { text: text.replace(/\s+/g, " ").trim(), source: src };
  } finally { try { await browser.close(); } catch {} }
}
app.get("/api/menu", async (req, res) => {
  const url = req.query.url;
  if (!url || !urlAllowed(url)) return res.json({ ok: false });
  try {
    // Stage 1: plain fetch
    const a = await fetchAny(url);
    if (a && a.pdf) {
      const t = await pdfText(a.pdf);
      if (t.length > 300) return res.json({ ok: true, method: "pdf", source: a.url, text: t.slice(0, 6000) });
    }
    let bestText = "", bestSrc = url;
    if (a && a.html) {
      bestText = stripHtml(a.html);
      // gather ALL menu-ish links, score them against the user's goal, fetch the top few
      const goal = String(req.query.goal || "").toLowerCase();
      const goalWords = goal.includes("glp") ? ["glp"] : goal.includes("gain") ? ["protein", "bowl"] : ["protein", "light", "fit", "under"];
      const linkScore = (href, label) => {
        const t = (href + " " + label).toLowerCase();
        if (!/menu|nutrition|food/.test(t)) return 0; // must be a menu-ish link at all; goal words never qualify alone
        let sc = 10;
        for (const w of goalWords) if (t.includes(w)) sc += 50;
        if (/smoothie|bowl|salad|grill/.test(t)) sc += 5;
        if (/\.pdf(\?|$)/i.test(href)) sc += 6;
        return sc;
      };
      const cands = new Map();
      const linkRe = /href=["']([^"']+)["'][^>]*>([^<]{0,80})/gi; let m;
      while ((m = linkRe.exec(a.html))) {
        try {
          const abs = new URL(m[1], a.url).href;
          if (!urlAllowed(abs) || abs === a.url) continue;
          const sc = linkScore(m[1], m[2] || "");
          if (sc >= 10) cands.set(abs, Math.max(cands.get(abs) || 0, sc));
        } catch {}
      }
      const sorted = [...cands.entries()].sort((x, y) => y[1] - x[1]);
      const goalTop = sorted.filter(([, sc]) => sc >= 50).slice(0, 2);
      const plainTop = sorted.filter(([, sc]) => sc < 50).slice(0, 2);
      const seen = new Set();
      const top = [...goalTop, ...plainTop].filter(([l]) => !seen.has(l) && seen.add(l)).slice(0, 3);
      const sections = []; let anyPdf = false;
      for (const [link] of top) {
        try {
          const b = await fetchAny(link);
          if (b && b.pdf) { const t = await pdfText(b.pdf); if (t.length > 300) { sections.push(`--- ${link} ---\n` + t.slice(0, 3000)); anyPdf = true; } }
          else if (b && b.html) { const mt = stripHtml(b.html); if (mt.length > 300) { const isGoal = goalWords.some((w) => link.toLowerCase().includes(w)); sections.push(`--- ${link} ---\n` + mt.slice(0, isGoal ? 4500 : 2000)); } }
        } catch {}
      }
      const priceCal = (t) => (t.match(/\$\s?\d|\b\d{2,4}\s?cal/gi) || []).length;
      const dishWords = (t) => (t.match(/smoothie|bowl|salad|sandwich|wrap|grill|burger|chicken|egg|toast|protein|oz\b/gi) || []).length;
      const good = sections.filter((sec) => priceCal(sec) >= 2 || dishWords(sec) >= 10);
      if (good.length) {
        const joined = good.join("\n\n").slice(0, 8000);
        return res.json({ ok: true, method: anyPdf && good.length === 1 ? "pdf" : "html", source: top.map(([l]) => l).join(" + "), text: joined });
      }
      // no section passed the food-signal gate: fall through to page text / headless render
      if (bestText.length > 700) return res.json({ ok: true, method: "html", source: bestSrc, text: bestText.slice(0, 6000) });
    }
    // Stage 3: headless render for JS-built menus
    const rendered = await withRenderLock(() => renderPage(url));
    if (rendered && rendered.pdfUrl) {
      const b = await fetchAny(rendered.pdfUrl);
      if (b && b.pdf) { const t = await pdfText(b.pdf); if (t.length > 300) return res.json({ ok: true, method: "pdf", source: rendered.pdfUrl, text: t.slice(0, 6000) }); }
    }
    if (rendered && rendered.text && rendered.text.length > 400) {
      return res.json({ ok: true, method: "js", source: rendered.source, text: rendered.text.slice(0, 6000) });
    }
    // last resort: thin HTML is better than nothing
    if (bestText.length > 400) return res.json({ ok: true, method: "html", source: bestSrc, text: bestText.slice(0, 6000) });
    res.json({ ok: false });
  } catch (e) { console.error("menu extraction failed:", e.message); res.json({ ok: false }); }
});

/* ── venue photo proxy (keeps the Places key server-side) ── */
app.get("/api/vphoto", async (req, res) => {
  const PLACES_KEY = key("GOOGLE_PLACES_KEY");
  const name = req.query.name;
  if (!PLACES_KEY || !name) return res.status(404).end();
  try {
    const r = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=500&key=${PLACES_KEY}`, { redirect: "follow" });
    if (!r.ok) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch { res.status(502).end(); }
});

/* ── static frontend ── */
const DIST = path.join(__dirname, "..", "dist");
app.use(express.static(DIST));
app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));

app.listen(PORT, () => console.log(`ForkCaster listening on :${PORT} · data at ${DATA_DIR}`));
