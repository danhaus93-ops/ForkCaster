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
    spoonacular: !!get("SPOONACULAR_KEY"), spoonacularTail: tail(get("SPOONACULAR_KEY")),
  });
});
/* ── Apple Health ingest (via the Health Auto Export iOS app posting to this node) ── */
const HEALTH_FILE = path.join(DATA_DIR, "health.json");
const _loadHealth = () => { try { return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8")); } catch { return { token: null, days: {} } } };
const _saveHealth = (h) => { try { fs.writeFileSync(HEALTH_FILE, JSON.stringify(h)); } catch {} };
app.get("/api/health/setup", (req, res) => {
  const h = _loadHealth();
  if (!h.token) { h.token = require("crypto").randomBytes(12).toString("hex"); _saveHealth(h); }
  res.json({ token: h.token, days: Object.keys(h.days || {}).length });
});
app.post("/api/health/sync", (req, res) => {
  const h = _loadHealth();
  if (!h.token || String(req.query.token || "") !== h.token) return res.status(403).json({ ok: false, error: "bad token" });
  // SIMPLE shape (Apple Shortcuts-friendly): {"date":"YYYY-MM-DD","steps":N,"weightLbs":N,...} or an array of such — no HAE required
  const _simple = Array.isArray(req.body) ? req.body : (req.body && req.body.date ? [req.body] : null);
  if (_simple) {
    h.days = h.days || {}; let n = 0;
    for (const rec of _simple) {
      const d = String(rec.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const clean = {};
      for (const [k, cast] of [["steps", Math.round], ["activeKcal", Math.round], ["exerciseMin", Math.round], ["strength", Math.round]]) { const v = +rec[k]; if (Number.isFinite(v) && v >= 0) clean[k] = cast(v); }
      const w = +rec.weightLbs; if (Number.isFinite(w) && w > 40 && w < 900) clean.weightLbs = Math.round(w * 10) / 10;
      const wkg = +rec.weightKg; if (clean.weightLbs == null && Number.isFinite(wkg) && wkg > 18) clean.weightLbs = Math.round(wkg * 2.20462 * 10) / 10;
      if (!Object.keys(clean).length) continue;
      h.days[d] = { ...h.days[d], ...clean }; n++;
    }
    const kk = Object.keys(h.days).sort(); while (kk.length > 400) delete h.days[kk.shift()];
    _saveHealth(h);
    console.log(`[health] simple sync: ${n} day(s)`);
    return res.json({ ok: true, daysUpdated: n, format: "simple" });
  }
  const metrics = (req.body && req.body.data && req.body.data.metrics) || [];
  const workouts = (req.body && req.body.data && req.body.data.workouts) || [];
  h.days = h.days || {}; const acc = {}; let touched = new Set();
  const day = (dstr) => { const d = String(dstr || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null; acc[d] = acc[d] || {}; touched.add(d); return acc[d]; };
  for (const m of metrics) {
    const nm = String(m.name || "").toLowerCase(), unit = String(m.units || "").toLowerCase();
    for (const pt of (m.data || [])) {
      const rec = day(pt.date); if (!rec) continue;
      const q = +pt.qty; if (!Number.isFinite(q)) continue;
      if (nm === "body_mass" || nm === "weight_body_mass") rec.weightLbs = Math.round((unit.startsWith("kg") ? q * 2.20462 : q) * 10) / 10;
      else if (nm === "step_count") rec.steps = (rec.steps || 0) + Math.round(q);
      else if (nm === "active_energy") rec.activeKcal = (rec.activeKcal || 0) + Math.round(q);
      else if (nm === "apple_exercise_time") rec.exerciseMin = (rec.exerciseMin || 0) + Math.round(q);
    }
  }
  for (const w of workouts) {
    const rec = day(w.start || w.date); if (!rec) continue;
    if (/strength|weight|functional|core|resistance/i.test(String(w.name || ""))) rec.strength = (rec.strength || 0) + 1;
  }
  // REPLACE each touched day's fields with this payload's totals — re-sent exports overwrite instead of double-counting
  for (const [d, rec] of Object.entries(acc)) h.days[d] = { ...h.days[d], ...rec };
  const keys = Object.keys(h.days).sort(); while (keys.length > 400) delete h.days[keys.shift()]; // cap history
  _saveHealth(h);
  console.log(`[health] sync: ${touched.size} day(s) updated`);
  res.json({ ok: true, daysUpdated: touched.size });
});
app.get("/api/health/summary", (req, res) => {
  const h = _loadHealth();
  const days = Object.entries(h.days || {}).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-60).map(([date, v]) => ({ date, ...v }));
  res.json({ ok: true, days });
});
app.post("/api/keys", (req, res) => {
  try {
    const cur = readSecrets(); const b = req.body || {};
    for (const k of ["ANTHROPIC_API_KEY", "GOOGLE_PLACES_KEY", "USDA_FDC_KEY", "FATSECRET_CLIENT_ID", "FATSECRET_CLIENT_SECRET", "GEMINI_API_KEY", "SPOONACULAR_KEY"]) {
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
    // `temperature` is deprecated on current Anthropic models and hard-fails the request — never forward it
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
const FS_PLATFORM = process.env.FATSECRET_BASE || "https://platform.fatsecret.com";
let fsTok = null;
async function fatsecretToken() {
  if (process.env.FATSECRET_BASE) return "rig-token"; // test mode: fixture stub needs no OAuth
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
    const r1 = await fetch(`${FS_PLATFORM}/rest/server.api?method=food.find_id_for_barcode&barcode=${gtin}&format=json`, { headers: { Authorization: `Bearer ${tok}` } });
    const d1 = await r1.json();
    const fid = d1 && d1.food_id && d1.food_id.value;
    if (fid && fid !== "0") {
      const r2 = await fetch(`${FS_PLATFORM}/rest/server.api?method=food.get.v4&food_id=${fid}&format=json`, { headers: { Authorization: `Bearer ${tok}` } });
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
  try {
    if (!buf || buf.length < 5 || buf.slice(0, 5).toString("latin1") !== "%PDF-") { console.log("pdf skipped: no %PDF magic (got HTML or junk)"); return ""; }
    const m = require("pdf-parse");
    let d;
    if (typeof m === "function") d = await m(buf, { max: 25 });
    else if (typeof m.default === "function") d = await m.default(buf, { max: 25 });
    else if (typeof m.pdf === "function") d = await m.pdf(buf, { max: 25 });
    else if (m.PDFParse) { const p = new m.PDFParse({ data: new Uint8Array(buf) }); d = await p.getText(); }
    else throw new Error("pdf-parse API unrecognized");
    return ((d && d.text) || "").replace(/\s+/g, " ").trim();
  }
  catch (e) { console.error("pdf parse failed:", e.message); return ""; }
}
let renderChain = Promise.resolve();
function withRenderLock(fn) { const p = renderChain.then(fn, fn); renderChain = p.catch(() => {}); return p; }
function pdfCandidatesFromHtml(html, baseUrl) {
  const out = [];
  for (const source of [html, String(html).replace(/\\\//g, "/")]) {
    const hits = source.match(/https?:\/\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi) || [];
    for (const u of hits) if (/nutrit|allerg|calorie/i.test(u)) out.push(u);
    if (baseUrl) {
      // site-RELATIVE pdf paths ("_path":"/content/dam/.../Nutrition-Facts.pdf") — invisible to the absolute matcher
      for (const m of source.match(/\/[^\s"'<>\\:]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi) || []) {
        if (!/nutrit|allerg|calorie/i.test(m)) continue;
        try { out.push(new URL(m, baseUrl).href); } catch {}
      }
    }
  }
  // unwrap viewer links (docs.google.com/viewer?url=<real>.pdf) — fetch the real PDF, not the viewer's HTML
  const unwrapped = out.map((u) => {
    const m = u.match(/[?&](?:url|file|src)=([^&]+)/i);
    if (m) { try { const inner = decodeURIComponent(m[1]); if (/\.pdf/i.test(inner)) return inner.split("#")[0]; } catch {} }
    return u.split("#")[0]; // strip link-rot fragments ("...pdf?x=y#main")
  });
  return [...new Set(unwrapped)].slice(0, 4);
}

/* ── structured-nutrition harvest: pull macros out of embedded/fetched JSON, no per-chain code ──
   Handles JSON-LD (schema.org NutritionInformation), Next.js __NEXT_DATA__, and framework state
   blobs (__NUXT__/__APOLLO_STATE__/__INITIAL_STATE__), plus JSON the page fetches from a backend. */
function _snum(v) { if (v == null) return null; const m = String(v).match(/-?\d+(?:\.\d+)?/); return m ? Math.round(parseFloat(m[0])) : null; }
function _macrosFrom(obj) {
  if (!obj || typeof obj !== "object") return null;
  // nutrient-array shape: [{name/label:"Protein", value/amount:30}, ...]
  const arr = Array.isArray(obj.nutrition) ? obj.nutrition : Array.isArray(obj.nutrients) ? obj.nutrients : Array.isArray(obj.nutritionFacts) ? obj.nutritionFacts : null;
  if (arr) {
    let cal = null, protein = null, fat = null, carbs = null;
    for (const e of arr) {
      if (!e || typeof e !== "object") continue;
      const label = String(e.name || e.label || e.nutrient || e.type || e.key || "").toLowerCase();
      const val = _snum(e.value ?? e.amount ?? e.quantity ?? e.grams ?? e.qty);
      if (val == null) continue;
      if (/calor|energy|kcal/.test(label)) cal = cal ?? val;
      else if (/protein/.test(label)) protein = protein ?? val;
      else if (/(^|\b)(total\s*)?fat\b/.test(label) && !/satur|trans|unsat/.test(label)) fat = fat ?? val;
      else if (/carb/.test(label) && !/fiber|sugar|net/.test(label)) carbs = carbs ?? val;
    }
    if (cal != null || protein != null || fat != null) return { cal, protein, fat, carbs };
  }
  const n = obj.nutrition || obj.nutritionInfo || obj.nutritionalInfo || obj.nutritionInformation || obj.nutrients || obj.macros || obj;
  let cal = _snum(n.calories ?? n.calorie ?? n.cal ?? n.kcal ?? n.energy ?? n.Calories ?? n.calorieCount ?? n.totalCalories ?? n.caloriesPerServing);
  let protein = _snum(n.proteinContent ?? n.protein ?? n.proteinG ?? n.Protein ?? n.protein_g ?? n.proteinGrams ?? n.proteinInGrams);
  let fat = _snum(n.fatContent ?? n.fat ?? n.totalFat ?? n.fatG ?? n.Fat ?? n.fat_g ?? n.total_fat ?? n.fatGrams ?? n.fatInGrams ?? n.totalFatContent);
  let carbs = _snum(n.carbohydrateContent ?? n.carbohydrates ?? n.carbs ?? n.totalCarbs ?? n.carbohydrate ?? n.Carbohydrates ?? n.carbs_g ?? n.carb_g ?? n.totalCarbohydrates ?? n.carbohydrateGrams);
  // nested "macroNutrients" shape (commerce platforms, e.g. Sonic api-idp): { protein:{weight:{value:N}}, totalFat:{weight:{value:N}} }
  const mn = n.macroNutrients || obj.macroNutrients;
  if (mn && typeof mn === "object") {
    const mv = (o) => { if (o == null) return null; if (typeof o !== "object") return _snum(o); const w = o.weight != null ? o.weight : o; return _snum(w && typeof w === "object" ? (w.value ?? w.amount ?? w.grams ?? w.qty) : w); };
    if (cal == null) cal = mv(mn.calories ?? mn.energy ?? mn.totalCalories);
    if (protein == null) protein = mv(mn.protein);
    if (fat == null) fat = mv(mn.totalFat ?? mn.fat);
    if (carbs == null) carbs = mv(mn.totalCarbohydrates ?? mn.carbohydrates ?? mn.carbs);
  }
  if (cal == null && protein == null && fat == null) return null;
  return { cal, protein, fat, carbs };
}
function _nameFrom(obj) {
  const nm = obj && (obj.name || obj.itemName || obj.title || obj.displayName || obj.label || obj.productName || obj.description);
  return typeof nm === "string" && nm.trim() && nm.trim().length <= 80 ? nm.trim() : null;
}
function _walkNutrition(node, out, section, depth) {
  if (!node || depth > 9 || out.length > 240) return;
  if (Array.isArray(node)) { for (const x of node) _walkNutrition(x, out, section, depth + 1); return; }
  if (typeof node !== "object") return;
  const type = String(node["@type"] || node.type || "");
  const nm = _nameFrom(node);
  const isContainer = /menu|section|category|restaurant/i.test(type) || Array.isArray(node.hasMenuItem) || Array.isArray(node.hasMenuSection) || Array.isArray(node.items);
  const sect = nm && isContainer ? nm : section;
  const macros = _macrosFrom(node);
  // skip modifier/option entries (toppings, "Easy X", size upcharges) — not orderable menu items
  const isModifier = (Array.isArray(node.groupIds) && node.groupIds.some((g) => /modifier|option|addon|add-on/i.test(String(g)))) || /modifier|option/i.test(type);
  if (nm && macros && !isModifier && !/^(menu|menusection|restaurant|nutritioninformation|website|organization|itemlist|breadcrumblist|listitem)$/i.test(type)) {
    out.push({ item: nm, section: section || "", cal: macros.cal, protein: macros.protein, fat: macros.fat, carbs: macros.carbs ?? null });
  }
  for (const k of Object.keys(node)) { const v = node[k]; if (v && typeof v === "object") _walkNutrition(v, out, sect, depth + 1); }
}
function nutritionFromJson(parsed, out) { try { _walkNutrition(parsed, out, "", 0); } catch {} }
function dedupeRecords(records) {
  const seen = new Map();
  for (const r of records || []) {
    if (!r || !r.item) continue;
    const k = r.item.toLowerCase();
    const s = (r.cal != null) + (r.protein != null) + (r.fat != null);
    if (!seen.has(k) || s > seen.get(k)._s) seen.set(k, { ...r, _s: s });
  }
  return [...seen.values()].map(({ _s, ...r }) => r).slice(0, 40);
}
function structuredNutrition(html) {
  const src = String(html || ""), out = [];
  for (const m of src.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { nutritionFromJson(JSON.parse(m[1].trim()), out); } catch {} }
  for (const m of src.matchAll(/<script[^>]+(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi)) { try { nutritionFromJson(JSON.parse(m[1].trim()), out); } catch {} }
  for (const m of src.matchAll(/window\.(?:__NUXT__|__APOLLO_STATE__|__INITIAL_STATE__|__PRELOADED_STATE__)\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:<\/script>|window\.)/gi)) { try { nutritionFromJson(JSON.parse(m[1]), out); } catch {} }
  return dedupeRecords(out);
}
function structuredNutritionText(records) {
  return (records || []).map((r) => {
    const parts = [];
    if (r.cal != null) parts.push(`${r.cal} cal`);
    if (r.protein != null) parts.push(`${r.protein}g protein`);
    if (r.fat != null) parts.push(`${r.fat}g fat`);
    return parts.length ? `${r.item}${r.section ? ` [${r.section}]` : ""} — ${parts.join(", ")}` : null;
  }).filter(Boolean).join("\n");
}
function jsonCandidatesFromHtml(html, baseUrl) {
  const src = String(html || ""), out = new Set();
  for (const u of src.match(/https?:\/\/[^\s"'<>\\]+?\.json(?:\?[^\s"'<>\\]*)?/gi) || []) out.add(u);
  for (const m of src.matchAll(/["'](\/[^"'\s]*?(?:menu|nutrition|product|item|catalog)[^"'\s]*?)["']/gi)) { try { out.add(new URL(m[1], baseUrl).href); } catch {} }
  for (const m of src.matchAll(/(?:fetch|axios\.get|\.get|\.load)\(\s*["'](https?:\/\/[^"']+|\/[^"']+)["']/gi)) { try { out.add(new URL(m[1], baseUrl).href); } catch {} }
  return [...out].filter((u) => urlAllowed(u) && /menu|nutrition|product|item|catalog|allergen|page-data|\.json(\?|$)/i.test(u) && !/\.(js|mjs|css|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|mp4|mov|webm|avif)(\?|$)/i.test(u)).slice(0, 6);
}
// nutrition often hides behind a PAGE link inside a data blob ("url":"/allergens/") rather than a .pdf URL
function nutriPageLinksFromBlobs(blobs, baseUrl) {
  const out = new Set();
  for (const blob of blobs || []) {
    for (const m of String(blob.body || "").matchAll(/"(?:url|href|slug|link)"\s*:\s*"(\\?\/[^"]*?(?:allergen|nutrition)[^"]*?)"/gi)) {
      try { const u = new URL(m[1].replace(/\\\//g, "/"), baseUrl).href; if (urlAllowed(u) && !/\.(png|jpe?g|svg|css|js)(\?|$)/i.test(u)) out.add(u); } catch {}
    }
  }
  return [...out].slice(0, 2);
}
// universal fallback: when deterministic parsers strike out, cut the nutrition-bearing WINDOWS out of raw
// captured JSON and ship them for the client AI to read — any shape, no per-site parser required
function rawNutritionSlices(blobs, budget) {
  const out = [];
  let used = 0;
  for (const blob of blobs || []) {
    const body = String((blob && blob.body) || "");
    if (body.length < 80) continue;
    const re = /calorie|protein|nutrition|kcal|"fat"|total_?fat/gi;
    let m; const windows = [];
    while ((m = re.exec(body)) && windows.length < 6) {
      const a = Math.max(0, m.index - 300), b = Math.min(body.length, m.index + 700);
      if (windows.length && a <= windows[windows.length - 1][1]) windows[windows.length - 1][1] = Math.max(windows[windows.length - 1][1], b);
      else windows.push([a, b]);
    }
    let taken = 0;
    for (const [a, b] of windows) {
      const slice = body.slice(a, b).replace(/\s+/g, " ");
      if (used + slice.length > budget) return out;
      out.push(slice); used += slice.length;
      if (++taken >= 3) break;
    }
  }
  return out;
}
// item-detail links from a menu page — macros often live one click deeper (product pages carry JSON-LD)
function itemLinksFromHtml(html, baseUrl) {
  const out = new Set();
  let origin = ""; try { origin = new URL(baseUrl).origin; } catch {}
  for (const m of String(html || "").matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(m[1], baseUrl).href; } catch { continue; }
    if (origin && !u.startsWith(origin)) continue;
    if (!/(\/products?\/|\/items?\/|[?&](?:id|productid|itemid)=\d|\/menu\/[a-z0-9][a-z0-9-]{5,})/i.test(u)) continue;
    if (/(nutrition|allergen|category|menus?$|locations?|careers|about|contact|gift|catering|reward|\.(pdf|jpe?g|png|css|js))/i.test(u)) continue;
    out.add(u);
    if (out.size >= 3) break;
  }
  return [...out];
}
async function fetchJson(u) {
  try {
    const r = await fetch(u, { headers: MENU_UA, redirect: "follow", signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const len = parseInt(r.headers.get("content-length") || "0");
    if (len > 4e6) return null;
    const body = await r.text();
    if (body.length > 4e6) return null;
    if (!ct.includes("json") && !/^\s*[[{]/.test(body)) return null;
    return JSON.parse(body);
  } catch { return null; }
}

async function renderPage(startUrl, opts = {}) {
  if (process.env.FORKCASTER_FAKE_RENDER) {
    // test seam: emulate a JS render with plain fetches (browser unavailable in CI)
    const r = await fetch(startUrl, { headers: { ...MENU_UA, "X-Fake-Render": "1" }, signal: AbortSignal.timeout(8000) });
    let html = await r.text();
    const frameSrcs = [...html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 3);
    for (const fsrc of frameSrcs) {
      try { const fu = new URL(fsrc, startUrl).href; const fr2 = await fetch(fu, { headers: { ...MENU_UA, "X-Fake-Render": "1" }, signal: AbortSignal.timeout(8000) }); html += "\n" + (await fr2.text()); } catch {}
    }
    // stand-in for browser response capture: fetch referenced JSON endpoints into blobs
    const jsonBlobs = [];
    for (const ju of jsonCandidatesFromHtml(html, startUrl).slice(0, 6)) {
      try { const jr = await fetch(ju, { headers: { ...MENU_UA, "X-Fake-Render": "1" }, signal: AbortSignal.timeout(8000) }); if (!jr.ok) continue; const ct = (jr.headers.get("content-type") || "").toLowerCase(); const body = await jr.text(); if (ct.includes("json") || /^\s*[[{]/.test(body)) jsonBlobs.push({ url: ju, body }); } catch {}
    }
    return { text: stripHtml(html), source: startUrl, dataPdfs: pdfCandidatesFromHtml(html, startUrl), html, jsonBlobs };
  }
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
  });
  try {
    const page = await browser.newPage();
    const jsonBlobs = [];
    page.on("response", async (resp) => {
      try {
        if (jsonBlobs.length >= 24) return;
        const ct = (resp.headers()["content-type"] || "").toLowerCase();
        if (!ct.includes("json")) return;
        const buf = await resp.buffer().catch(() => null);
        if (!buf || buf.length <= 200 || buf.length >= 3e6) return;
        const body = buf.toString("utf8");
        const ru = resp.url();
        // capture if the URL looks menu-ish OR the body actually carries nutrition-ish keys (Contentful/GraphQL/etc.)
        if (/menu|nutrition|product|item|catalog|api|entries|graphql|content|dish/i.test(ru) || /calorie|protein|"fat"|nutrition/i.test(body)) jsonBlobs.push({ url: ru, body });
      } catch {}
    });
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
    // Cloudflare/anti-bot interstitials often auto-solve if the browser simply WAITS — detect and give it 7s
    if (/__cf_chl|just a moment|checking your browser|challenge-platform|cf-turnstile/i.test(text) || text.length < 40) {
      const _maybe = await page.content().catch(() => "");
      if (/__cf_chl|challenge-platform|cf-turnstile/i.test(_maybe)) {
        console.log(`[render] challenge detected — waiting 7s for auto-solve`);
        await new Promise((r) => setTimeout(r, 7000));
        try { text = await page.evaluate(() => (document.body ? document.body.innerText : "")); } catch {}
      }
    }
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
    let dataPdfs = [];
    try {
      for (const f of page.frames()) {
        const arr = await f.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({ href: a.href, label: (a.textContent || "").trim() }))).catch(() => []);
        for (const x of arr) if (/\.pdf(\?|$)/i.test(x.href) && /nutrit|allerg|calorie/i.test(x.href + " " + x.label)) dataPdfs.push(x.href);
      }
      const fullHtml = await page.content().catch(() => "");
      for (const u2 of pdfCandidatesFromHtml(fullHtml, src)) dataPdfs.push(u2);
    } catch {}
    dataPdfs = [...new Set(dataPdfs)].slice(0, 4);
    const fullHtml2 = await page.content().catch(() => "");
    console.log(`[render] ${src} -> ${text.length} chars, ${(typeof page.frames === "function" ? page.frames().length : 1)} frames, ${dataPdfs.length} data pdfs, ${jsonBlobs.length} json blobs`);
    return { text: text.replace(/\s+/g, " ").trim(), source: src, dataPdfs, html: fullHtml2, jsonBlobs };
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
const MENU_INFLIGHT = new Map(); // url+goal -> Promise: concurrent identical requests share one run
/* ── Recipe engine (Plan tab): schema.org importer, Spoonacular search, seed cookbook ── */
const _num = (v) => { const m = String(v ?? "").match(/[\d.]+/); return m ? +m[0] : null; };
function recipeFromJsonLd(html, srcUrl) {
  const blocks = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = n["@type"]; const ts = Array.isArray(t) ? t : [t];
    if (ts.some((x) => String(x).toLowerCase() === "recipe")) found.push(n);
    for (const k of ["@graph", "mainEntity", "itemListElement", "hasPart"]) if (n[k]) walk(n[k]);
  };
  for (const b of blocks) { try { walk(JSON.parse(b.trim())); } catch {} }
  const r = found[0];
  if (!r) return null;
  const ins = [];
  const insWalk = (x) => {
    if (!x) return;
    if (typeof x === "string") return void ins.push(x.trim());
    if (Array.isArray(x)) return x.forEach(insWalk);
    if (x.text) return void ins.push(String(x.text).trim());
    if (x.itemListElement) return insWalk(x.itemListElement);
  };
  insWalk(r.recipeInstructions);
  const img = Array.isArray(r.image) ? r.image[0] : (r.image && r.image.url) || r.image || null;
  const yieldN = _num(Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield) || 1;
  const nu = r.nutrition || {};
  return {
    ok: true, source: "import", url: srcUrl, name: r.name || "Imported recipe",
    image: typeof img === "string" ? img : null,
    servings: yieldN,
    ingredients: (r.recipeIngredient || []).map((x) => String(x).trim()).filter(Boolean),
    steps: ins.filter(Boolean).slice(0, 30),
    perServing: { calories: _num(nu.calories), protein: _num(nu.proteinContent), fat: _num(nu.fatContent), carbs: _num(nu.carbohydrateContent) },
  };
}
app.get("/api/recipe", async (req, res) => {
  const u = String(req.query.url || "");
  if (!/^https?:\/\//i.test(u)) return res.json({ ok: false, reason: "bad-url" });
  try {
    let html = null;
    const first = await fetchAny(u);
    if (first && first.html) html = first.html;
    let rec = html && recipeFromJsonLd(html, u);
    if (!rec) { // JS-rendered recipe sites: fall back to the browser
      try { const rd = await withRenderLock(() => renderPage(u, { follow: false })); if (rd && rd.html) rec = recipeFromJsonLd(rd.html, u); } catch {}
    }
    if (!rec) return res.json({ ok: false, reason: "no-recipe-markup" });
    res.json(rec);
  } catch (e) { res.json({ ok: false, reason: e.message }); }
});
const _SEARCH_CACHE_FILE = path.join(DATA_DIR, "search-cache.json");
const _searchCache = new Map(); // param-key -> {t, data} — persisted; identical questions are never paid for twice
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(_SEARCH_CACHE_FILE, "utf8")))) _searchCache.set(k, v); } catch {}
const _saveSearchCache = () => { try { fs.writeFileSync(_SEARCH_CACHE_FILE, JSON.stringify(Object.fromEntries(_searchCache))); } catch {} };
const SEARCH_TTL = 7 * 24 * 3600 * 1000;
app.get("/api/recipes/search", async (req, res) => {
  const SPN = key("SPOONACULAR_KEY");
  if (!SPN) return res.json({ ok: false, reason: "no-key" });
  const ck = JSON.stringify(["query", "minProtein", "maxProtein", "minCalories", "maxCalories", "maxFat", "excludeIngredients", "type", "number"].map((k) => String(req.query[k] || "")));
  if (!req.query.fresh) {
    const hit = _searchCache.get(ck);
    if (hit && Date.now() - hit.t < SEARCH_TTL) { console.log(`[recipes] search (cached)`); return res.json({ ...hit.data, cached: true }); }
  }
  try {
    const q = new URLSearchParams({ apiKey: SPN, addRecipeNutrition: "true", number: String(Math.min(12, +req.query.number || 8)), sort: "max-used-ingredients" });
    for (const k of ["query", "minProtein", "maxProtein", "minCalories", "maxCalories", "maxFat", "excludeIngredients", "type"]) if (req.query[k]) q.set(k, String(req.query[k]));
    q.delete("sort"); // default relevance
    const r = await fetch(`${SPN_BASE}/recipes/complexSearch?${q}`, { signal: AbortSignal.timeout(12000) });
    _noteQuota(r);
    if (!r.ok) { console.log(`[recipes] search -> HTTP ${r.status}`); return res.json({ ok: false, reason: `spoonacular ${r.status}` }); }
    const d = await r.json();
    const pull = (rec, want) => { const n = ((rec.nutrition || {}).nutrients || []).find((x) => x.name === want); return n ? Math.round(n.amount) : null; };
    const payload = { ok: true, results: (d.results || []).map((rec) => ({
      id: "spn:" + rec.id, name: rec.title, image: rec.image || null, source: "spoonacular",
      url: rec.sourceUrl || null, servings: rec.servings || 1, readyMin: rec.readyInMinutes || null,
      perServing: { calories: pull(rec, "Calories"), protein: pull(rec, "Protein"), fat: pull(rec, "Fat"), carbs: pull(rec, "Carbohydrates") },
    })) };
    _searchCache.set(ck, { t: Date.now(), data: payload }); _saveSearchCache();
    res.json({ ...payload, cached: false });
  } catch (e) { res.json({ ok: false, reason: e.message }); }
});
const SPN_BASE = process.env.SPOONACULAR_BASE || "https://api.spoonacular.com"; // rig overrides this to a fixture
const _PHOTO_CACHE_FILE = path.join(DATA_DIR, "photo-cache.json");
const _photoCache = new Map(); // q -> {v: url|null, t} — PERSISTED; nulls retry after 24h, images live forever
try {
  const raw = JSON.parse(fs.readFileSync(_PHOTO_CACHE_FILE, "utf8"));
  if (raw && raw._v === 3) for (const [k, e] of Object.entries(raw)) { if (k !== "_v") _photoCache.set(k, e); }
  // older caches (title-only matching) are discarded — vision-unverified matches are untrusted
} catch {}
const _savePhotoCache = () => { try { fs.writeFileSync(_PHOTO_CACHE_FILE, JSON.stringify({ _v: 3, ...Object.fromEntries(_photoCache) })); } catch {} };
async function _visionOk(anthKey, imgUrl, q) { // one cheap haiku look: does the photo actually show the dish?
  try {
    const ir = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) });
    if (!ir.ok) return false;
    const buf = Buffer.from(await ir.arrayBuffer());
    if (buf.length > 3_500_000 || buf.length < 500) return false;
    const mt = /\.png(\?|$)/i.test(imgUrl) ? "image/png" : "image/jpeg";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": anthKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mt, data: buf.toString("base64") } },
        { type: "text", text: `Does this photo plausibly show: "${q}"? Reply only YES or NO.` },
      ] }] }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    return /yes/i.test(((d.content || []).find((x) => x.type === "text") || {}).text || "");
  } catch { return false; }
}
let _spnLeft = null; // remaining Spoonacular points today, read from X-API-Quota-Left on every response
const _noteQuota = (r) => { const q = parseFloat(r.headers.get("x-api-quota-left")); if (Number.isFinite(q)) _spnLeft = q; };
const PHOTO_QUOTA_FLOOR = 15; // photos are decoration; meal searches are the product — photos never spend the last points
const _STOP = new Set(["a","an","the","with","and","of","on","in","style","fresh","easy","best","homemade"]);
const _toks = (t) => String(t).toLowerCase().split(/\W+/).filter((x) => x.length >= 3 && !_STOP.has(x));
app.get("/api/recipes/photo", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (!q) return res.json({ ok: false, reason: "no-query" });
  const hit = _photoCache.get(q);
  if (hit && (hit.v || Date.now() - hit.t < 24 * 3600 * 1000)) return res.json({ ok: !!hit.v, image: hit.v });
  const SPN = key("SPOONACULAR_KEY");
  if (!SPN) return res.json({ ok: false, reason: "no-key" });
  try {
    if (_spnLeft != null && _spnLeft < PHOTO_QUOTA_FLOOR) { console.log(`[recipes] photo "${q}" -> paused (quota ${_spnLeft} < floor ${PHOTO_QUOTA_FLOOR})`); return res.json({ ok: false, reason: `paused — saving your last ${Math.floor(_spnLeft)} Spoonacular points for meal planning; photos resume after the daily reset` }); }
    const r = await fetch(`${SPN_BASE}/recipes/complexSearch?${new URLSearchParams({ apiKey: SPN, query: q, number: "5" })}`, { signal: AbortSignal.timeout(9000) });
    _noteQuota(r);
    if (!r.ok) { console.log(`[recipes] photo "${q}" -> HTTP ${r.status}`); return res.json({ ok: false, reason: `spoonacular ${r.status}` }); }
    const d = await r.json();
    // pick the candidate whose TITLE actually matches the dish — zero-overlap results are junk, reject them
    const qt = _toks(q);
    const scored = (d.results || []).filter((rec) => rec.image).map((rec) => ({ rec, score: qt.filter((t) => new Set(_toks(rec.title)).has(t)).length })).filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, 3);
    let img = null, picked = null;
    const anthKey = key("ANTHROPIC_API_KEY");
    if (scored.length && anthKey) {
      for (const cand of scored) { // words got it shortlisted; the picture has to pass the eye test
        if (await _visionOk(anthKey, cand.rec.image, q)) { img = cand.rec.image; picked = cand; break; }
        console.log(`[recipes] photo "${q}" vision REJECTED "${cand.rec.title}"`);
      }
    } else if (scored.length) { img = scored[0].rec.image; picked = scored[0]; } // no key: best title match, unverified
    _photoCache.set(q, { v: img, t: Date.now() }); _savePhotoCache();
    console.log(`[recipes] photo "${q}" -> ${img ? `${anthKey ? "vision-approved" : "title-matched"} "${picked.rec.title}" (score ${picked.score})` : `no ${anthKey ? "vision-approved" : "title"} match among ${(d.results || []).length}`}`);
    res.json({ ok: !!img, image: img });
  } catch (e) { res.json({ ok: false, reason: e.message }); }
});
app.get("/api/recipes/seed", (_req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(path.join(__dirname, "seed-recipes.json"), "utf8"))); }
  catch (e) { res.json({ ok: false, reason: e.message }); }
});

/* ── Chains that publish a dedicated GLP-1 menu line. Deterministic Stage -1: no cache, no API,
   no scraper can defeat it. Protein = published low end, calories = published high end. ── */
const CHAIN_GLP_MENUS = {
  smoothieking: {
    label: "Smoothie King",
    source: "smoothieking.com/glp-1",
    section: "GLP-1 SUPPORT MENU",
    note: "Published GLP-1 Support Menu (20g+ protein, 0g added sugar), crafted with Ochsner Health dietitians. Ten orderable items: Gladiator, Power Meal Slim and Keto Champ each come in flavors. Where the chain publishes a range, protein shown is the low end and calories the high end — add-ins and size shift both.",
    items: [
      { item: "Gladiator GLP-1 — Chocolate (pick 2 add-ins)", protein: 45, cal: 560, fat: null, carbs: null },
      { item: "Gladiator GLP-1 — Vanilla (pick 2 add-ins)", protein: 45, cal: 560, fat: null, carbs: null },
      { item: "Gladiator GLP-1 — Strawberry (pick 2 add-ins)", protein: 45, cal: 560, fat: null, carbs: null },
      { item: "Keto Champ GLP-1 — Berry", protein: 24, cal: 450, fat: null, carbs: null },
      { item: "Keto Champ GLP-1 — Chocolate", protein: 24, cal: 450, fat: null, carbs: null },
      { item: "The Activator Recovery GLP-1 Almond Berry", protein: 24, cal: 200, fat: null, carbs: null },
      { item: "Slim 'N Trim GLP-1 Mango Greens", protein: 22, cal: 200, fat: null, carbs: null },
      { item: "Power Meal Slim GLP-1 — Chocolate", protein: 19, cal: 210, fat: null, carbs: null },
      { item: "Power Meal Slim GLP-1 — Vanilla", protein: 19, cal: 210, fat: null, carbs: null },
      { item: "Power Meal Slim GLP-1 — Strawberry", protein: 19, cal: 210, fat: null, carbs: null },
    ],
  },
};
const chainGlpProfile = (name, url) => {
  const keys = [_normBrandKey(name), _normBrandKey((() => { try { return new URL(String(url)).hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; } })())];
  for (const k of keys) { if (k && CHAIN_GLP_MENUS[k]) return CHAIN_GLP_MENUS[k]; }
  return null;
};
const _normBrandKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const MENU_NOTES_FILE = path.join(DATA_DIR, "menu-notes.json");
const _menuNotes = (() => { try { return JSON.parse(fs.readFileSync(MENU_NOTES_FILE, "utf8")); } catch { return {}; } })();
const _saveMenuNotes = () => { try { fs.writeFileSync(MENU_NOTES_FILE, JSON.stringify(_menuNotes)); } catch {} };
const _menuDomain = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return ""; } };
const _normBrand = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
async function fatsecretBrandItems(brand) { // published chain nutrition in one call — the fast tier
  const tok = await fatsecretToken();
  const r = await fetch(`${FS_PLATFORM}/rest/server.api?method=foods.search&search_expression=${encodeURIComponent(brand)}&max_results=50&format=json`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(6000) });
  const d = await r.json();
  let foods = d && d.foods && d.foods.food; if (!foods) return [];
  if (!Array.isArray(foods)) foods = [foods];
  const nb = _normBrand(brand), out = [];
  for (const f of foods) {
    const bn = _normBrand(f.brand_name);
    if (!bn || !(bn.includes(nb) || nb.includes(bn))) continue; // strict brand match — no lookalike brands
    const m = String(f.food_description || "").match(/Calories:\s*([\d.]+)kcal.*?Fat:\s*([\d.]+)g.*?Carbs:\s*([\d.]+)g.*?Protein:\s*([\d.]+)g/i);
    if (!m) continue;
    out.push({ item: f.food_name, section: "PUBLISHED NUTRITION (FatSecret)", cal: Math.round(+m[1]), fat: Math.round(+m[2]), carbs: Math.round(+m[3]), protein: Math.round(+m[4]) });
  }
  return out;
}
app.get("/api/menu", async (req, res) => {
  const _reqT0 = Date.now(); // overall time budget — client aborts at 150s, so return SOMETHING by ~120s
  let earlyFallback = null; // menu-shaped early-html text WITHOUT macro evidence — kept as fallback while we go deep
  const _diag = {}; // per-request pipeline diagnosis, attached to every response so coverage sweeps self-explain
  const _ckey = String(req.query.url || "") + "|" + String(req.query.goal || "");
  /* Stage -1 — the chain publishes a GLP-1 line: serve it verbatim, ahead of cache/FatSecret/scrape */
  if (String(req.query.goal || "") === "glp1" && String(req.query.chain || "") !== "0") {
    const cg = chainGlpProfile(req.query.name, req.query.url);
    if (cg) {
      const items = cg.items.map((i) => ({ ...i, section: cg.section }));
      console.log(`[menu] chain GLP-1 menu: ${cg.label} (${items.length} published items)`);
      _diag.chain = `${cg.label} GLP-1 menu`;
      return res.json({ ok: true, method: "chain", source: cg.source, note: cg.note,
        text: items.map((i) => `${i.item} — ${i.cal} cal, ${i.protein}g protein`).join("\n"), items, diag: _diag });
    }
  }
  const _rawHit = String(req.query.skipfs || "") === "1" ? null : MENU_CACHE.get(_ckey);
  const _hitUseful = (h) => { const o = h && h.obj; if (!o || !o.ok) return false; if (o.method === "fatsecret") return true;
    const mg = (o.items || []).filter((i) => (i.protein || 0) >= 15 && (i.cal || 0) >= 200).length; return mg >= 3; };
  const _hit = _hitUseful(_rawHit) ? _rawHit : null; // thin scrape cached ≠ answered: fall through to the FatSecret tier
  if (_hit && Date.now() - _hit.t < 6 * 3600 * 1000) { console.log(`[menu] cache hit ${_ckey.slice(0, 80)}`); return res.json(_hit.obj); }
  if (MENU_INFLIGHT.has(_ckey)) {
    console.log(`[menu] joining in-flight run ${_ckey.slice(0, 80)}`);
    try { return res.json(await MENU_INFLIGHT.get(_ckey)); } catch (e) { return res.status(500).json({ error: String(e) }); }
  }
  let _resolveInflight, _rejectInflight;
  MENU_INFLIGHT.set(_ckey, new Promise((ok, no) => { _resolveInflight = ok; _rejectInflight = no; }));
  res.on("finish", () => MENU_INFLIGHT.delete(_ckey));
  const _send = (obj) => {
    if (obj) obj.diag = _diag;
    if (obj && obj.ok) MENU_CACHE.set(_ckey, { t: Date.now(), obj });
    if (obj && obj.ok && Array.isArray(obj.items) && obj.method !== "fatsecret") {
      const dom = _menuDomain(req.query.url);
      if (dom && obj.items.some((i) => /glp/i.test(String(i.section || ""))) && !(_menuNotes[dom] && _menuNotes[dom].glp)) {
        _menuNotes[dom] = { glp: true, t: Date.now() }; _saveMenuNotes();
        console.log(`[menu] ${dom} has GLP-tagged sections — scrape-first for this domain from now on`);
      }
    }
    try { _resolveInflight(obj); } catch {} return res.json(obj);
  };
  /* Stage 0 — FatSecret published nutrition: a half-second brand lookup beats a 90-second render. Cached scrapes still win (cache check above). */
  try {
    const _dom0 = _menuDomain(req.query.url);
    const _skipFs = String(req.query.skipfs || "") === "1" || !!(_dom0 && _menuNotes[_dom0] && _menuNotes[_dom0].glp);
    if (_skipFs) _diag.fatsecret = (_dom0 && _menuNotes[_dom0] && _menuNotes[_dom0].glp) ? "skipped — site has GLP-1 sections (scrape carries structure)" : "skipped by request";
    if (!_skipFs && key("FATSECRET_CLIENT_ID") && key("FATSECRET_CLIENT_SECRET")) {
      const rawName = String(req.query.name || "").trim() || (() => { try { return new URL(String(req.query.url)).hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; } })();
      const brand = rawName.split(/\s+at\s+/i)[0].replace(/grill|bar|express|restaurant|cafe|kitchen|\+/gi, " ").replace(/\s+/g, " ").trim();
      if (brand.length >= 3) {
        const fsItems = await fatsecretBrandItems(brand);
        const mg = fsItems.filter((i) => i.protein >= 15 && i.cal >= 200).length;
        _diag.fatsecret = `${fsItems.length} brand items, ${mg} meal-grade`;
        if (mg >= 3) {
          console.log(`[menu] fatsecret tier: ${fsItems.length} items for "${brand}" (${mg} meal-grade)`);
          return _send({ ok: true, method: "fatsecret", source: "FatSecret published nutrition", text: fsItems.map((i) => `${i.item} — ${i.cal} cal, ${i.protein}g protein, ${i.fat}g fat, ${i.carbs}g carbs`).join("\n").slice(0, 6000), items: fsItems });
        }
      } else _diag.fatsecret = "no usable brand name";
    } else _diag.fatsecret = "not configured";
  } catch (e) { _diag.fatsecret = `error: ${String(e).slice(0, 80)}`; }
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
        for (const p of ["/menu", "/menus", "/food", "/our-menu", "/nutrition", "/nutrition-allergen", "/nutritional-information", "/nutrition-information"]) {
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
      _diag.sections = good.length;
      // menu names alone aren't nutrition: only return early when the text carries MACRO evidence
      // (grams of protein/fat, or a nutrition-PDF table) — otherwise keep it as fallback and go deep
      // one "20g protein" marketing blurb isn't nutrition data — a real table mentions macros many times
      const hasMacros = (t) => ((t || "").match(/\d{1,3}\s?g\s*(of\s*)?(protein|fat)|total\s*fat|protein\s*\(g\)/gi) || []).length >= 3;
      if (good.length) {
        const joined = good.join("\n\n").slice(0, 8000);
        if (anyPdf || hasMacros(joined)) return _send({ ok: true, method: anyPdf && good.length === 1 ? "pdf" : "html", source: top.map(([l]) => l).join(" + "), text: joined });
        earlyFallback = { text: joined, source: top.map(([l]) => l).join(" + ") };
        console.log(`[menu] early html is menu-shaped but has NO macro evidence — going deep`);
        _diag.early = 1;
      }
      // no section passed the food-signal gate: fall through to page text / headless render
      else if (bestText.length > 700 && (priceCal(bestText) >= 2 || dishWords(bestText) >= 10)) {
        if (hasMacros(bestText)) return _send({ ok: true, method: "html", source: bestSrc, text: bestText.slice(0, 6000) });
        earlyFallback = { text: bestText.slice(0, 6000), source: bestSrc };
        console.log(`[menu] landing text is menu-shaped but has NO macro evidence — going deep`);
        _diag.early = 1;
      }
    }
    // Stage 3: headless render for JS-built menus
    const _origin = (() => { try { return new URL(url).origin; } catch { return null; } })();
    const foodOK = (t) => t && t.length > 400 && ((t.match(/\$\s?\d|\b\d{2,4}\s?cal/gi) || []).length >= 2 || (t.match(/smoothie|bowl|salad|sandwich|wrap|grill|burger|chicken|egg|toast|protein|oz\b/gi) || []).length >= 10);
    let rendered = null;
    const rTargets = [...new Set([renderTarget !== url ? renderTarget : null, _origin ? _origin + "/menu" : null, url].filter(Boolean))].slice(0, 3);
    for (const rt of rTargets) {
      console.log(`[menu] rendering: ${rt}`);
      let r2 = null;
      try { r2 = await withRenderLock(() => renderPage(rt)); }
      catch (e) { console.log(`[menu] render threw ${rt}: ${e.message}`); continue; }
      console.log(`[menu] rendered ${rt} -> ${r2 ? (r2.pdfUrl ? "pdf: " + r2.pdfUrl : (r2.text || "").length + " chars, foodOK=" + foodOK(r2.text)) : "RENDER FAILED"}`);
      if (r2 && (r2.pdfUrl || foodOK(r2.text))) { rendered = r2; break; }
      if (r2 && !rendered) rendered = r2;
    }
    if (rendered && rendered.pdfUrl) {
      const b = await fetchAny(rendered.pdfUrl);
      if (b && b.pdf) { const t = await pdfText(b.pdf); if (t.length > 300) return _send({ ok: true, method: "pdf", source: rendered.pdfUrl, text: t.slice(0, 6000) }); }
    }
    if (rendered && (rendered.text || rendered.html)) {
      // a real orderable item has a non-trivial name and real macros (not a bare component/drink fragment)
      const realItem = (r) => r.item && r.item.trim().length > 2 && ((+r.protein || 0) >= 3 || (+r.cal || 0) >= 50);
      _diag.rendered = (rendered.text || "").length; _diag.blobs = (rendered.jsonBlobs || []).length;
      // structured-nutrition harvest: embedded JSON (JSON-LD/__NEXT_DATA__/state), captured JSON responses, fetched endpoints
      let structured = [];
      try { structured = structuredNutrition(rendered.html || ""); } catch {}
      if (Array.isArray(rendered.jsonBlobs)) for (const blob of rendered.jsonBlobs) { try { nutritionFromJson(JSON.parse(blob.body), structured); } catch {} }
      if (structured.length < 3 && rendered.html && !(Array.isArray(rendered.dataPdfs) && rendered.dataPdfs.length)) {
        const jcands = jsonCandidatesFromHtml(rendered.html, rendered.source || url);
        console.log(`[menu] json candidates: ${jcands.join(" | ") || "none"}`);
        for (const ju of jcands.slice(0, 3)) {
          const j = await fetchJson(ju);
          if (j) { const before = structured.length; nutritionFromJson(j, structured); if (structured.length > before) console.log(`[menu] json harvested ${structured.length - before} items from ${ju}`); }
          if (structured.length >= 6) break;
        }
      }
      // Nutrition PDFs are often referenced INSIDE json blobs (e.g. Contentful asset links on assets.ctfassets.net),
      // not in the page HTML — scan blob bodies too, unescaping \/ forms (pdfCandidatesFromHtml handles both).
      let pdfSources = Array.isArray(rendered.dataPdfs) ? rendered.dataPdfs.slice() : [];
      if (Array.isArray(rendered.jsonBlobs)) for (const blob of rendered.jsonBlobs) for (const pu of pdfCandidatesFromHtml(blob.body, rendered.source || url)) pdfSources.push(pu);
      pdfSources = [...new Set(pdfSources)];
      // if still missing a PDF or the structured set is thin, render the nutrition pages and mine BOTH their PDFs and their structured JSON
      const _extraBlobs = [];
      if (structured.filter(realItem).length < 8 && !pdfSources.length && _origin && Date.now() - _reqT0 < 90000) {
        const blobPages = nutriPageLinksFromBlobs(rendered.jsonBlobs, rendered.source || url);
        if (blobPages.length) console.log(`[menu] nutrition page links from blobs: ${blobPages.join(" | ")}`);
        for (const probe of [...blobPages, _origin + "/nutrition-allergen", _origin + "/allergens", _origin + "/nutritional-information", _origin + "/nutrition-information", _origin + "/nutrition"]) {
          try {
            if (Date.now() - _reqT0 > 90000) { console.log(`[menu] time budget hit — stop probing, return what we have`); break; }
            console.log(`[menu] harvest-render: ${probe}`);
            const rh = await withRenderLock(() => renderPage(probe, { follow: false }));
            if (!rh) continue;
            if (Array.isArray(rh.dataPdfs)) for (const pu of rh.dataPdfs) pdfSources.push(pu);
            if (rh.pdfUrl) pdfSources.push(rh.pdfUrl);
            if (Array.isArray(rh.jsonBlobs)) for (const blob of rh.jsonBlobs) { _extraBlobs.push(blob); for (const pu of pdfCandidatesFromHtml(blob.body, probe)) pdfSources.push(pu); try { nutritionFromJson(JSON.parse(blob.body), structured); } catch {} }
            try { for (const r of structuredNutrition(rh.html || "")) structured.push(r); } catch {}
            pdfSources = [...new Set(pdfSources)];
            if (pdfSources.length || structured.filter(realItem).length >= 8) break; // official PDF or a full menu — stop probing
          } catch {}
        }
      }
      // keep only plausible real menu items — drop component/drink fragments with no real macros
      // (a bare "Bun"/"Tea"/"Coke" with 0 protein and no calories is not an orderable meal)
      structured = dedupeRecords(structured).filter(realItem);
      _diag.structured = structured.length; _diag.extraBlobs = _extraBlobs.length;
      // item-page dive: still thin and no PDF — macros often live one click deeper on product pages
      if (structured.length < 3 && !pdfSources.length && Date.now() - _reqT0 < 75000) {
        const links = itemLinksFromHtml(rendered.html, rendered.source || url);
        if (links.length) console.log(`[menu] item-dive: trying ${links.length} item pages`);
        let dived = 0;
        for (const link of links) {
          if (Date.now() - _reqT0 > 90000) break;
          try {
            const rh2 = await withRenderLock(() => renderPage(link, { follow: false }));
            if (!rh2) continue;
            dived++;
            try { for (const r of structuredNutrition(rh2.html || "")) structured.push(r); } catch {}
            if (Array.isArray(rh2.dataPdfs)) for (const pu of rh2.dataPdfs) pdfSources.push(pu);
            if (Array.isArray(rh2.jsonBlobs)) for (const blob of rh2.jsonBlobs) { _extraBlobs.push(blob); try { nutritionFromJson(JSON.parse(blob.body), structured); } catch {} }
            if (dedupeRecords(structured).filter(realItem).length >= 3 || pdfSources.length) break;
          } catch {}
        }
        if (dived) {
          structured = dedupeRecords(structured).filter(realItem);
          pdfSources = [...new Set(pdfSources)];
          _diag.dive = `${dived}p->${structured.length}i`;
          console.log(`[menu] item-dive: ${dived} pages -> ${structured.length} items, ${pdfSources.length} pdfs`);
        }
      }
      // universal fallback: parsers found <3 real items and no PDF — ship raw nutrition-bearing JSON windows for the AI
      let rawSection = "";
      if (structured.length < 3 && !pdfSources.length) {
        const slices = rawNutritionSlices([...(rendered.jsonBlobs || []), ..._extraBlobs], 3500);
        if (slices.length) {
          rawSection = `\n--- NUTRITION (raw menu data — unparsed site JSON; read item names and calories/protein/fat out of whatever shape it uses): ${rendered.source || url} ---\n` + slices.join("\n---\n");
          console.log(`[menu] raw nutrition slices: ${slices.length} (${rawSection.length} chars)`);
          _diag.raw = rawSection.length;
        }
      }
      // diagnostic: blobs present but parser under-extracted — log the real shape so it can be taught precisely
      if (structured.length < 5 && !pdfSources.length && Array.isArray(rendered.jsonBlobs) && rendered.jsonBlobs.length) {
        let shown = 0;
        for (const blob of rendered.jsonBlobs) {
          if (shown >= 2) break;
          const idx = blob.body.search(/calorie|protein|nutrition/i);
          if (idx >= 0) { console.log(`[menu] structured LOW(${structured.length}) — ${blob.url} :: ${blob.body.slice(Math.max(0, idx - 140), idx + 420).replace(/\s+/g, " ")}`); shown++; }
        }
      }
      console.log(`[menu] nutrition pdf candidates: ${pdfSources.join(" | ") || "none"}`);
      _diag.pdfs = pdfSources.slice(0, 2);
      let baseText = rendered.text && rendered.text.length > 100 ? rendered.text.slice(0, 6000) : "";
      if (baseText.length < 400 && earlyFallback) baseText = earlyFallback.text; // deep render came back thin — early menu text is better context
      if (baseText.length > 400 || structured.length >= 2 || pdfSources.length || rawSection) {
      if (rawSection && baseText.length > 3000) baseText = baseText.slice(0, 3000); // keep raw inside the client's 9k window
      let jsText = baseText;
      jsText += rawSection;
      if (structured.length) {
        const stext = structuredNutritionText(structured);
        if (stext) { jsText += `\n--- NUTRITION (structured data): ${rendered.source || url} ---\n` + stext.slice(0, 3500); console.log(`[menu] structured nutrition: ${structured.length} items`); }
      }
      if (pdfSources.length) {
        // language twins: if any non-spanish candidate exists, drop the spanish ones entirely (they duplicate content and burn text budget)
        const _nonEs = pdfSources.filter((u) => !/spanish|espanol|_es[._-]|-es\./i.test(u));
        if (_nonEs.length) pdfSources = _nonEs;
        // prefer english editions — spanish/localized PDFs sort last (Cane's publishes both)
        pdfSources.sort((a, b) => (/spanish|espanol|_es[._-]|-es\./i.test(a) ? 1 : 0) - (/spanish|espanol|_es[._-]|-es\./i.test(b) ? 1 : 0));
        // walk up to 4 candidates but count SUCCESSES, not attempts — two blocked hosts must not
        // shadow a fetchable CDN copy sitting third in line (the Bojangles case)
        let _pdfHarvested = 0;
        for (const pu of pdfSources.slice(0, 4)) {
          if (_pdfHarvested >= 2) break;
          try {
            const pb = await fetchAny(pu);
            if (!pb || !pb.pdf) console.log(`[menu] pdf fetch empty/rejected: ${pu}`);
            if (pb && pb.pdf) {
              const pt = await pdfText(pb.pdf);
              if (pt.length <= 200) console.log(`[menu] pdf too short to use (${pt.length} chars): ${pu}`);
              if (pt.length > 200) {
                // files named "AllergenNutritionInfo" carry BOTH — nutrition-in-name or macro content wins the label
                const label = (/nutrit/i.test(pu) || (/calorie/i.test(pt) && /protein/i.test(pt))) ? "NUTRITION (official PDF)" : "ALLERGENS (official PDF)";
                jsText += `\n--- ${label}: ${pu} ---\n` + pt.slice(0, 7000);
                _pdfHarvested++;
                console.log(`[menu] harvested ${label.split(" ")[0].toLowerCase()} pdf: ${pu} (${pt.length} chars)`);
              }
            }
          } catch (e) { console.log(`[menu] pdf harvest failed ${pu}: ${e.message}`); }
        }
      }
      // direct-pick items must carry PROTEIN (FDA menu labeling mandates calories only, so many sites embed
      // cal-only data — real macros live in the PDF). Cal-only entries stay in the text section for the AI to
      // anchor names+calories and estimate the rest; sending them as items[] would headline 0g protein on cards.
      // meal-grade only: components with real macros (Bacon 6p/70c, Sub Roll 6p/200c) pass a bare protein
      // gate — real entrees run >=15g protein AND >=200 cal. Anything less stays text context for the AI.
      const mealItems = structured.filter((r) => (+r.protein || 0) >= 15 && (+r.cal || 0) >= 200);
      return _send({ ok: true, method: "js", source: rendered.source, text: jsText.slice(0, 12000), items: mealItems.length >= 3 ? mealItems : undefined });
      }
    }
    // last resort: the stashed early menu text (deep path found nothing better), then thin HTML, then give up
    if (earlyFallback) return _send({ ok: true, method: "html", source: earlyFallback.source, text: earlyFallback.text });
    if (bestText.length > 400 && ((bestText.match(/\$\s?\d|\b\d{2,4}\s?cal/gi) || []).length >= 2 || (bestText.match(/smoothie|bowl|salad|sandwich|wrap|grill|burger|chicken|egg|toast|protein|oz\b/gi) || []).length >= 10)) return _send({ ok: true, method: "html", source: bestSrc, text: bestText.slice(0, 6000) });
    _send({ ok: false });
  } catch (e) { console.error("menu extraction failed:", e.message); _diag.err = e.message; _send({ ok: false }); }
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
    const _b = req.body || {};
    const st = _b.state || _b; const fnd = _b.findings || {};
    const glp = st.glp || {}; const wl = st.weightLog || []; const ml = st.mealLog || []; const se = (glp.sideEffects || []);
    const tgt = st.targets || {};
    const esc = (x) => String(x == null ? "" : x).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    const fmtD = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return d; } };
    const doses = (glp.doseLog || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const doseRows = doses.map((d) => `<tr><td>${fmtD(d.date)}</td><td>${esc(d.mg)} mg</td><td>${esc(d.site || "\u2014")}</td></tr>`).join("");
    const wRows = wl.slice(-20).reverse().map((w) => `<tr><td>${fmtD(w.date)}</td><td>${(+w.lbs).toFixed(1)} lb</td></tr>`).join("");
    const _t = (d) => new Date(d + "T12:00:00").getTime();
    const postDose = (date) => { const prior = doses.filter((dd) => dd.date <= date); if (!prior.length) return "\u2014"; const dd = Math.round((_t(date) - _t(prior[0].date)) / 86400000); return dd === 0 ? "dose day" : `+${dd}d`; };
    const seRows = se.slice().reverse().map((x) => `<tr><td>${fmtD(x.date)}</td><td>${esc(x.symptom)}</td><td>${["Mild","Moderate","Severe"][x.severity - 1] || ""}</td><td>${postDose(x.date)}</td></tr>`).join("");
    const byDay = {}; ml.forEach((m) => { byDay[m.date] = byDay[m.date] || { p: 0, c: 0, cb: 0, f: 0 }; byDay[m.date].p += m.protein || 0; byDay[m.date].c += m.calories || 0; byDay[m.date].cb += m.carbs || 0; byDay[m.date].f += m.fat || 0; });
    const adh = (p) => tgt.protein ? ` <span style="color:#8a97a4">(${Math.min(999, Math.round((p / tgt.protein) * 100))}%)</span>` : "";
    const mealRows = Object.keys(byDay).sort().slice(-14).reverse().map((d) => `<tr><td>${fmtD(d)}</td><td>${byDay[d].p} g${adh(byDay[d].p)}</td><td>${byDay[d].c}</td><td>${byDay[d].cb} g</td><td>${byDay[d].f} g</td></tr>`).join("");
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
      <h2>What the app has learned (on-device analysis)</h2>
      <table>
      ${(() => { const a = fnd.adaptive || {}; return a.status === "ok" ? `<tr><td style="width:140px"><b>Weight trend</b></td><td>${esc(a.detail)} (${a.pts} weigh-ins over ${a.spanDays} days)</td></tr>` : `<tr><td style="width:140px"><b>Weight trend</b></td><td>Still collecting \u2014 ${a.pts || 0} weigh-ins over ${a.spanDays || 0} days so far.</td></tr>`; })()}
      ${(() => { const d = fnd.doseResp || {}; return d.status === "ok" ? `<tr><td><b>Dose response</b></td><td>Meals over ~${d.ceiling}g fat ${esc(d.scope)} preceded GI symptoms ${d.aboveSym} of ${d.above} times; at or under, ${d.belowSym} of ${d.below}. Working personal fat ceiling: ~${d.ceiling}g (generic guidance: 15g).</td></tr>` : d.status === "no-pattern" ? `<tr><td><b>Dose response</b></td><td>No clear fat\u2194symptom pattern across ${d.days} logged days (${d.inWin} within 48h of a dose).</td></tr>` : `<tr><td><b>Dose response</b></td><td>Still collecting \u2014 ${d.sym || 0}/5 GI symptom entries, ${d.days || 0}/10 meal-logged days, ${d.inWin || 0}/3 dose-window days.</td></tr>`; })()}
      ${fnd.health ? `<tr><td><b>Activity (synced)</b></td><td>${fnd.health.avgSteps.toLocaleString()} steps/day (7-day avg) \u00b7 ${fnd.health.strengthWk} resistance session${fnd.health.strengthWk === 1 ? "" : "s"} this week \u00b7 ${fnd.health.days} days of Apple Health data.</td></tr>` : ""}
      </table>
      <div style="color:#8a97a4;font-size:9.5px;margin-top:4px">Correlations computed on the patient's own server from self-reported logs \u2014 patterns for discussion, not diagnoses.</div>
      <h2>Dose history &amp; injection sites</h2><table><tr><th>Date</th><th>Dose</th><th>Site</th></tr>${doseRows || "<tr><td colspan=3>None logged</td></tr>"}</table>
      <h2>Weight log</h2><table><tr><th>Date</th><th>Weight</th></tr>${wRows || "<tr><td colspan=2>None logged</td></tr>"}</table>
      <h2>Side effects</h2><table><tr><th>Date</th><th>Symptom</th><th>Severity</th><th>Post-dose</th></tr>${seRows || "<tr><td colspan=4>None logged</td></tr>"}</table>
      <h2>Daily nutrition (last 14 logged days)</h2><table><tr><th>Date</th><th>Protein (vs goal)</th><th>Calories</th><th>Carbs</th><th>Fat</th></tr>${mealRows || "<tr><td colspan=5>None logged</td></tr>"}</table>
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
