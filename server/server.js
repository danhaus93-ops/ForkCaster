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
const key = (name) => process.env[name] || readSecrets()[name] || "";
const ANTHROPIC_KEY_ENV = process.env.ANTHROPIC_API_KEY || "";

fs.mkdirSync(PHOTO_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "25mb" }));

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

/* ── AI proxy (ranking, coach, photo estimation) ── */
app.post("/api/ai", async (req, res) => {
  const ANTHROPIC_KEY = key("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) return res.json({ error: "No Anthropic key. Create data/secrets.json on the node with {\"ANTHROPIC_API_KEY\":\"sk-ant-...\"} — no restart needed." });
  try {
    const { prompt, system, image } = req.body || {};
    const content = image
      ? [{ type: "image", source: { type: "base64", media_type: image.media_type || "image/jpeg", data: image.data } }, { type: "text", text: prompt }]
      : prompt;
    const body = { model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content }] };
    if (system) body.system = system;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
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
    const key = (process.env.USDA_FDC_KEY || readSecrets().USDA_FDC_KEY || "DEMO_KEY");
    const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`, {
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
  res.json({ found: false });
});

/* ── Nearby restaurants via Google Places (optional; demo list if no key) ── */
app.get("/api/nearby", async (req, res) => {
  const PLACES_KEY = key("GOOGLE_PLACES_KEY");
  if (!PLACES_KEY) return res.json({ venues: [] }); // client keeps its demo set
  try {
    const { lat, lng } = req.query;
    const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.primaryTypeDisplayName,places.rating,places.photos",
      },
      body: JSON.stringify({
        includedTypes: ["restaurant"], maxResultCount: 8,
        locationRestriction: { circle: { center: { latitude: +lat, longitude: +lng }, radius: 2500 } },
      }),
    });
    const data = await r.json();
    const venues = (data.places || []).map((p) => ({
      id: p.id,
      name: p.displayName && p.displayName.text,
      cuisine: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || "Restaurant",
      eta: "nearby",
      score: Math.min(5, (p.rating || 3.8)),
      photo: p.photos && p.photos[0]
        ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=400&key=${PLACES_KEY}`
        : null,
      menu: null, // Places has no menus; the AI proposes realistic goal-fit orders
    }));
    res.json({ venues });
  } catch (e) { res.json({ venues: [], error: String(e) }); }
});

/* ── static frontend ── */
const DIST = path.join(__dirname, "..", "dist");
app.use(express.static(DIST));
app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));

app.listen(PORT, () => console.log(`ForkCaster listening on :${PORT} · data at ${DATA_DIR}`));
