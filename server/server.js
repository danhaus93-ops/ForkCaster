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
app.delete("/api/photo/:file", (req, res) => {
  try { fs.rmSync(path.join(PHOTO_DIR, path.basename(req.params.file)), { force: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
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
    gemini: !!get("GEMINI_API_KEY"), geminiTail: tail(get("GEMINI_API_KEY")),
  });
});
app.post("/api/keys", (req, res) => {
  try {
    const cur = readSecrets(); const b = req.body || {};
    for (const k of ["ANTHROPIC_API_KEY", "GOOGLE_PLACES_KEY", "USDA_FDC_KEY", "FATSECRET_CLIENT_ID", "FATSECRET_CLIENT_SECRET", "GEMINI_API_KEY"]) {
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
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
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
async function renderPage(startUrl, opts = {}) {
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
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    });
    let src = startUrl;
    try { await page.goto(src, { waitUntil: "networkidle2", timeout: 22000 }); }
    catch { try { await page.goto(src, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch {} }
    await new Promise((r) => setTimeout(r, 2500));
    let text = await page.evaluate(() => (document.body ? document.body.innerText : ""));
    const menuHref = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll("a[href]"));
      const hit = as.find((a) => /menu/i.test(a.getAttribute("href") || "") || /^\s*(view\s+)?(our\s+)?(full\s+)?menu\s*$/i.test(a.textContent || ""));
      return hit ? hit.href : null;
    }).catch(() => null);
    if (opts.follow !== false && menuHref && menuHref !== src && urlAllowed(menuHref)) {
      if (/\.pdf(\?|$)/i.test(menuHref)) { await browser.close(); return { pdfUrl: menuHref }; }
      try {
        await page.goto(menuHref, { waitUntil: "networkidle2", timeout: 22000 });
        await new Promise((r) => setTimeout(r, 1500));
        const t2 = await page.evaluate(() => (document.body ? document.body.innerText : ""));
        if (t2.length > text.length) { text = t2; src = menuHref; }
      } catch {}
    }
    const dataPdfs = await page.evaluate(() => {
      const as = Array.from(document.querySelectorAll("a[href]"));
      return as.map((a) => ({ href: a.href, label: (a.textContent || "").trim() }))
        .filter((x) => /\.pdf(\?|$)/i.test(x.href) && /nutrit|allerg|calorie/i.test(x.href + " " + x.label))
        .map((x) => x.href).slice(0, 4);
    }).catch(() => []);
    return { text: text.replace(/\s+/g, " ").trim(), source: src, dataPdfs };
  } finally { try { await browser.close(); } catch {} }
}
app.get("/api/foodsearch", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ results: [] });
  try {
    const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=8&fields=product_name,brands,nutriments,serving_size`, { headers: { "User-Agent": "ForkCaster/0.2 personal nutrition app" }, signal: AbortSignal.timeout(9000) });
    const j = await r.json();
    const results = (j.products || []).map((p) => {
      const n = p.nutriments || {};
      return {
        found: true, source: "Open Food Facts",
        name: p.product_name || "Unnamed", brand: p.brands || "", basis: "100 g",
        calories: Math.round(n["energy-kcal_100g"] || 0), protein: Math.round(n.proteins_100g || 0),
        carbs: Math.round(n.carbohydrates_100g || 0), fat: Math.round(n.fat_100g || 0), fiber: Math.round(n.fiber_100g || 0),
      };
    }).filter((x) => x.name !== "Unnamed" && (x.calories || x.protein));
    res.json({ results: results.slice(0, 6) });
  } catch { res.json({ results: [] }); }
});

const MENU_CACHE = new Map(); // url+goal -> { t, obj }
app.get("/api/menu", async (req, res) => {
  const _ckey = String(req.query.url || "") + "|" + String(req.query.goal || "");
  const _hit = MENU_CACHE.get(_ckey);
  if (_hit && Date.now() - _hit.t < 6 * 3600 * 1000) { console.log(`[menu] cache hit ${_ckey.slice(0, 80)}`); return res.json(_hit.obj); }
  const _send = (obj) => { if (obj && obj.ok) MENU_CACHE.set(_ckey, { t: Date.now(), obj }); return res.json(obj); };
  const url = req.query.url;
  if (!url || !urlAllowed(url)) return res.json({ ok: false });
  try {
    // Stage 1: plain fetch
    const a = await fetchAny(url);
    console.log(`[menu] ${url} -> ${a ? (a.pdf ? "pdf" : a.html ? "html " + a.html.length + "b" : "empty") : "FETCH FAILED"}`);
    if (a && a.pdf) {
      const t = await pdfText(a.pdf);
      if (t.length > 300) return _send({ ok: true, method: "pdf", source: a.url, text: t.slice(0, 6000) });
    }
    let bestText = "", bestSrc = url; let renderTarget = url;
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
      // chains often render nav client-side: raw HTML has no menu links. Seed well-known paths.
      try {
        const origin = new URL(a.url).origin;
        for (const p of ["/menu", "/menus", "/food", "/our-menu", "/nutrition", "/nutritional-information", "/nutrition-information"]) {
          const abs = origin + p;
          if (urlAllowed(abs) && !cands.has(abs)) cands.set(abs, 12);
        }
      } catch {}
      console.log(`[menu] candidates: ${[...cands.entries()].map(([l, sc]) => sc + ":" + l).slice(0, 6).join(" | ")}`);
      const sorted = [...cands.entries()].sort((x, y) => y[1] - x[1]);
      const goalTop = sorted.filter(([, sc]) => sc >= 50).slice(0, 2);
      const plainTop = sorted.filter(([, sc]) => sc < 50).slice(0, 2);
      const seen = new Set();
      const top = [...goalTop, ...plainTop].filter(([l]) => !seen.has(l) && seen.add(l)).slice(0, 3);
      if (top.length) renderTarget = top[0][0];
      const sections = []; let anyPdf = false;
      const fetched = await Promise.allSettled(top.map(([link]) => fetchAny(link).then((b) => [link, b])));
      for (const fr of fetched) {
        try {
          if (fr.status !== "fulfilled" || !fr.value) continue;
          const [link, b] = fr.value;
          if (b && b.pdf) { const t = await pdfText(b.pdf); if (t.length > 300) { sections.push(`--- ${link} ---\n` + t.slice(0, 3000)); anyPdf = true; } }
          else if (b && b.html) { const mt = stripHtml(b.html); if (mt.length > 300) { const isGoal = goalWords.some((w) => link.toLowerCase().includes(w)); sections.push(`--- ${link} ---\n` + mt.slice(0, isGoal ? 4500 : 2000)); } }
        } catch {}
      }
      const priceCal = (t) => (t.match(/\$\s?\d|\b\d{2,4}\s?cal/gi) || []).length;
      const dishWords = (t) => (t.match(/smoothie|bowl|salad|sandwich|wrap|grill|burger|chicken|egg|toast|protein|oz\b/gi) || []).length;
      console.log(`[menu] sections fetched: ${sections.length}, lens: ${sections.map((x) => x.length).join(",")}`);
      const good = sections.filter((sec) => priceCal(sec) >= 2 || dishWords(sec) >= 10);
      console.log(`[menu] sections passing food gate: ${good.length}`);
      if (good.length) {
        const joined = good.join("\n\n").slice(0, 8000);
        return _send({ ok: true, method: anyPdf && good.length === 1 ? "pdf" : "html", source: top.map(([l]) => l).join(" + "), text: joined });
      }
      // no section passed the food-signal gate: fall through to page text / headless render
      if (bestText.length > 700 && (priceCal(bestText) >= 2 || dishWords(bestText) >= 10)) return _send({ ok: true, method: "html", source: bestSrc, text: bestText.slice(0, 6000) });
    }
    // Stage 3: headless render for JS-built menus
    const _origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
    const foodOK = (t) => t && t.length > 400 && ((t.match(/\$\s?\d|\b\d{2,4}\s?cal/gi) || []).length >= 2 || (t.match(/smoothie|bowl|salad|sandwich|wrap|grill|burger|chicken|egg|toast|protein|oz\b/gi) || []).length >= 10);
    let rendered = null;
    const rTargets = [...new Set([renderTarget !== url ? renderTarget : null, _origin ? _origin + "/menu" : null, url].filter(Boolean))].slice(0, 3);
    for (const rt of rTargets) {
      console.log(`[menu] rendering: ${rt}`);
      const r2 = await withRenderLock(() => renderPage(rt));
      console.log(`[menu] rendered ${rt} -> ${r2 ? (r2.pdfUrl ? "pdf: " + r2.pdfUrl : (r2.text || "").length + " chars, foodOK=" + foodOK(r2.text)) : "RENDER FAILED"}`);
      if (r2 && (r2.pdfUrl || foodOK(r2.text))) { rendered = r2; break; }
      if (r2 && !rendered) rendered = r2;
    }
    if (rendered && rendered.pdfUrl) {
      const b = await fetchAny(rendered.pdfUrl);
      if (b && b.pdf) { const t = await pdfText(b.pdf); if (t.length > 300) return _send({ ok: true, method: "pdf", source: rendered.pdfUrl, text: t.slice(0, 6000) }); }
    }
    if (rendered && rendered.text && rendered.text.length > 400) {
      let jsText = rendered.text.slice(0, 6000);
      let pdfSources = Array.isArray(rendered.dataPdfs) ? rendered.dataPdfs.slice() : [];
      if (!pdfSources.length && _origin) {
        for (const probe of [_origin + "/nutritional-information", _origin + "/nutrition-information", _origin + "/nutrition"]) {
          try {
            console.log(`[menu] harvest-render: ${probe}`);
            const rh = await withRenderLock(() => renderPage(probe, { follow: false }));
            if (rh && Array.isArray(rh.dataPdfs) && rh.dataPdfs.length) { pdfSources = rh.dataPdfs; break; }
            if (rh && rh.pdfUrl) { pdfSources = [rh.pdfUrl]; break; }
          } catch {}
        }
      }
      console.log(`[menu] nutrition pdf candidates: ${pdfSources.join(" | ") || "none"}`);
      if (pdfSources.length) {
        for (const pu of pdfSources.slice(0, 2)) {
          try {
            const pb = await fetchAny(pu);
            if (pb && pb.pdf) {
              const pt = await pdfText(pb.pdf);
              if (pt.length > 200) {
                const label = /allerg/i.test(pu) ? "ALLERGENS (official PDF)" : "NUTRITION (official PDF)";
                jsText += `\n--- ${label}: ${pu} ---\n` + pt.slice(0, 3200);
                console.log(`[menu] harvested ${label.split(" ")[0].toLowerCase()} pdf: ${pu} (${pt.length} chars)`);
              }
            }
          } catch (e) { console.log(`[menu] pdf harvest failed ${pu}: ${e.message}`); }
        }
      }
      return _send({ ok: true, method: "js", source: rendered.source, text: jsText.slice(0, 12000) });
    }
    // last resort: thin HTML is better than nothing
    if (bestText.length > 400) return _send({ ok: true, method: "html", source: bestSrc, text: bestText.slice(0, 6000) });
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

/* ── goal body simulation (Gemini image editing) ── */
app.post("/api/goalsim", async (req, res) => {
  try {
    const GK = key("GEMINI_API_KEY");
    if (!GK) return res.status(400).json({ error: "No Gemini key. Add it in Settings \u2192 API keys (aistudio.google.com \u2014 paid key required for image models)." });
    const { photoUrl, currentLbs, goalLbs, heightIn, sex } = req.body || {};
    const fname = path.basename(String(photoUrl || ""));
    const fpath = path.join(PHOTO_DIR, fname);
    if (!fname || !fs.existsSync(fpath)) return res.status(400).json({ error: "photo not found on node" });
    const b64 = fs.readFileSync(fpath).toString("base64");
    const mime = fname.endsWith(".png") ? "image/png" : "image/jpeg";
    const delta = Math.max(0, Math.round((+currentLbs || 0) - (+goalLbs || 0)));
    const goalBMI = heightIn ? ((703 * (+goalLbs || 0)) / (heightIn * heightIn)).toFixed(1) : null;
    const prompt = `Edit this photo of a person. Keep the SAME person: identical face, identity, skin tone, hair, tattoos, clothing (do not add or remove any clothing), pose, camera angle, lighting, and background. ` +
      `Change ONLY their body composition to show them approximately ${delta} pounds lighter${goalBMI ? ` (a healthy BMI of about ${goalBMI})` : ""}, with a natural ${sex === "female" ? "female" : "male"} fat-loss pattern \u2014 leaner face, reduced abdomen and waist, visible but realistic muscle definition. ` +
      `Photorealistic result that looks like an authentic photo of the same person after successful healthy weight loss. Do not change anything else in the image.`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${encodeURIComponent(GK)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }] }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || `Gemini ${r.status}` });
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) {
      const txt = parts.find((p) => p.text);
      return res.status(502).json({ error: txt ? `Model declined: ${String(txt.text).slice(0, 200)}` : "no image returned (possibly moderated)" });
    }
    const data = (img.inlineData || img.inline_data).data;
    const id = "sim_" + Date.now().toString(36);
    fs.writeFileSync(path.join(PHOTO_DIR, `${id}.jpg`), Buffer.from(data, "base64"));
    res.json({ id, url: `/api/photo/${id}.jpg` });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

/* ── web push: self-hosted dose-day reminders ── */
let _webpush = null;
function webpushLib() {
  if (_webpush === null) { try { _webpush = require("web-push"); } catch { _webpush = false; } }
  return _webpush;
}
const PUSH_FILE = path.join(DATA_DIR, "push.json");
function pushStore() { try { return JSON.parse(fs.readFileSync(PUSH_FILE, "utf8")); } catch { return {}; } }
function savePushStore(o) { fs.writeFileSync(PUSH_FILE, JSON.stringify(o)); }
function vapid() {
  const st = pushStore();
  const wp = webpushLib(); if (!wp) throw new Error("web-push unavailable");
  if (!st.vapid) { st.vapid = wp.generateVAPIDKeys(); savePushStore(st); }
  wp.setVapidDetails("mailto:forkcaster@selfhosted.local", st.vapid.publicKey, st.vapid.privateKey);
  return st.vapid;
}
app.get("/api/push/pubkey", (_req, res) => { try { res.json({ key: vapid().publicKey }); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.post("/api/push/subscribe", (req, res) => {
  const st = pushStore(); try { vapid(); } catch (e) { return res.status(500).json({ error: String(e) }); }
  st.sub = req.body && req.body.subscription ? req.body.subscription : null;
  savePushStore(st); res.json({ ok: !!st.sub });
});
app.delete("/api/push/subscribe", (_req, res) => { const st = pushStore(); delete st.sub; savePushStore(st); res.json({ ok: true }); });

const SITE_NAMES_SRV = ["Abdomen L", "Abdomen R", "Thigh L", "Thigh R", "Arm L", "Arm R"];
function suggestedSite(glp, perSite) {
  const sited = ((glp && glp.doseLog) || []).filter((d) => d.site).sort((a, b) => (a.date < b.date ? -1 : 1));
  const used = {}; SITE_NAMES_SRV.forEach((z) => (used[z] = 0));
  const full = () => SITE_NAMES_SRV.every((z) => used[z] >= perSite);
  const reset = () => SITE_NAMES_SRV.forEach((z) => (used[z] = 0));
  for (const d of sited) { if (full()) reset(); if (!(d.site in used)) continue; if (used[d.site] >= perSite) reset(); used[d.site] += 1; }
  if (full()) reset();
  const avail = SITE_NAMES_SRV.filter((z) => used[z] < perSite);
  const days = (z) => { const u = sited.filter((d) => d.site === z); return u.length ? (Date.now() - new Date(u[u.length - 1].date + "T12:00:00")) / 86400000 : 9999; };
  return avail.length ? avail.reduce((a, b) => (days(b) > days(a) ? b : a)) : SITE_NAMES_SRV[0];
}
async function doseReminderTick() {
  try {
    const st = pushStore();
    if (!st.sub) return;
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const glp = state.glp || {}; const prefs = state.prefs || {};
    if (!glp.lastInjection) return;
    const hour = Math.max(0, Math.min(23, parseInt(prefs.reminderHour) || 9));
    const now = new Date();
    if (now.getHours() !== hour) return;
    const daily = ["rybelsus", "orforglipron"].includes(String(glp.med || "")); const due = new Date(glp.lastInjection + "T00:00:00"); due.setDate(due.getDate() + (daily ? 1 : 7));
    const todayISO = now.toISOString().slice(0, 10);
    if (todayISO < due.toISOString().slice(0, 10)) return;
    if (st.lastSent === todayISO) return;
    try { vapid(); } catch { return; }
    const site = suggestedSite(glp, Math.max(1, Math.min(4, parseInt(prefs.sitePerCycle) || 1)));
    const medName = glp.med ? glp.med.charAt(0).toUpperCase() + glp.med.slice(1) : "your GLP-1";
    const wp2 = webpushLib(); if (!wp2) return;
    const daily2 = ["rybelsus", "orforglipron"].includes(String(glp.med || ""));
    const pillNote = String(glp.med) === "rybelsus" ? "empty stomach, wait 30 min before eating" : "any time of day \u2014 no food/water restrictions";
    await wp2.sendNotification(st.sub, JSON.stringify(daily2 ? { title: "\uD83D\uDC8A Pill time", body: `Daily ${medName} \u2014 ${pillNote}.` } : { title: "\uD83D\uDC89 Dose day", body: `Time for ${medName} \u2014 suggested site: ${site} (back of arm sites)` }));
    st.lastSent = todayISO; savePushStore(st);
  } catch (e) { if (e && e.statusCode === 410) { const st = pushStore(); delete st.sub; savePushStore(st); } }
}
setInterval(doseReminderTick, 10 * 60 * 1000);

/* ── PDF report: rendered by the bundled Chromium ── */
app.post("/api/report/pdf", async (req, res) => {
  try {
    const st = req.body || {};
    const glp = st.glp || {}; const wl = st.weightLog || []; const ml = st.mealLog || []; const se = (glp.sideEffects || []);
    const esc = (x) => String(x == null ? "" : x).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    const fmtD = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return d; } };
    const doses = (glp.doseLog || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const doseRows = doses.map((d) => `<tr><td>${fmtD(d.date)}</td><td>${esc(d.mg)} mg</td><td>${esc(d.site || "\u2014")}</td></tr>`).join("");
    const wRows = wl.slice(-20).reverse().map((w) => `<tr><td>${fmtD(w.date)}</td><td>${(+w.lbs).toFixed(1)} lb</td></tr>`).join("");
    const seRows = se.slice().reverse().map((x) => `<tr><td>${fmtD(x.date)}</td><td>${esc(x.symptom)}</td><td>${["Mild","Moderate","Severe"][x.severity - 1] || ""}</td></tr>`).join("");
    const byDay = {}; ml.forEach((m) => { byDay[m.date] = byDay[m.date] || { p: 0, c: 0 }; byDay[m.date].p += m.protein || 0; byDay[m.date].c += m.calories || 0; });
    const mealRows = Object.keys(byDay).sort().slice(-14).reverse().map((d) => `<tr><td>${fmtD(d)}</td><td>${byDay[d].p} g</td><td>${byDay[d].c}</td></tr>`).join("");
    const first = wl[0], last = wl[wl.length - 1];
    const delta = first && last ? (last.lbs - first.lbs).toFixed(1) : null;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a2430;margin:36px 44px;font-size:12px}
      h1{font-size:20px;margin:0}.sub{color:#5a6a7a;font-size:11px;margin-top:2px}
      h2{font-size:13px;border-bottom:1.5px solid #2f9e63;padding-bottom:4px;margin:22px 0 8px;color:#1f7a4d}
      table{width:100%;border-collapse:collapse}td,th{padding:5px 8px;border-bottom:1px solid #e3e8ee;text-align:left;font-size:11.5px}
      th{color:#5a6a7a;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.4px}
      .kpis{display:flex;gap:14px;margin-top:14px}.kpi{border:1px solid #dfe6ec;border-radius:10px;padding:10px 14px;flex:1}
      .kpi b{font-size:16px;display:block}.kpi span{color:#5a6a7a;font-size:10px}
      .foot{margin-top:26px;color:#8a97a4;font-size:9.5px}</style></head><body>
      <h1>ForkCaster \u2014 Progress Report</h1>
      <div class="sub">Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} \u00b7 self-reported data \u00b7 for review with your care team</div>
      <div class="kpis">
        <div class="kpi"><b>${esc(glp.med ? glp.med : "\u2014")}</b><span>medication \u00b7 ${esc(glp.dose || "?")} mg weekly \u00b7 week ${esc(glp.weeksOn || "?")}</span></div>
        <div class="kpi"><b>${doses.length}</b><span>doses logged</span></div>
        <div class="kpi"><b>${delta != null ? (delta > 0 ? "+" : "") + delta + " lb" : "\u2014"}</b><span>weight change over log</span></div>
      </div>
      <h2>Dose history &amp; injection sites</h2><table><tr><th>Date</th><th>Dose</th><th>Site</th></tr>${doseRows || "<tr><td colspan=3>None logged</td></tr>"}</table>
      <h2>Weight log</h2><table><tr><th>Date</th><th>Weight</th></tr>${wRows || "<tr><td colspan=2>None logged</td></tr>"}</table>
      <h2>Side effects</h2><table><tr><th>Date</th><th>Symptom</th><th>Severity</th></tr>${seRows || "<tr><td colspan=3>None logged</td></tr>"}</table>
      <h2>Daily nutrition (last 14 logged days)</h2><table><tr><th>Date</th><th>Protein</th><th>Calories</th></tr>${mealRows || "<tr><td colspan=3>None logged</td></tr>"}</table>
      <div class="foot">Generated by ForkCaster, a self-hosted nutrition companion. Injection sites labeled Arm refer to the posterior (back) upper arm. This report is informational and not medical advice.</div>
      </body></html>`;
    const puppeteer = require("puppeteer-core");
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "0.4in", bottom: "0.5in", left: "0.4in", right: "0.4in" } });
    await browser.close();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="ForkCaster-report.pdf"');
    res.send(Buffer.from(pdf));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

/* ── static frontend ── */
const DIST = path.join(__dirname, "..", "dist");
app.use(express.static(DIST));
app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));

app.listen(PORT, () => console.log(`ForkCaster listening on :${PORT} · data at ${DATA_DIR}`));
