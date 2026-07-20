import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";

/* ══════════════════════════════════════════════════════════════════
   RIGHTNOW — context-aware nutrition coach (extreme prototype)
   Now with: 5 themes, goal-mode presets, settings sheet, header mark.
   Real: device GPS, AI meal ranking, AI coach chat, all calculators
         & charts. Simulated (labeled): nearby-venue list + menu macros
         (production = Google Places + Nutritionix/Suggestic).
   See REVIEW_BRIEF.md. No localStorage (session state only).
══════════════════════════════════════════════════════════════════ */

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');`;
const DISPLAY = "'Space Grotesk', sans-serif";
const BODY = "'Inter', sans-serif";

const THEMES = {
  forest: { name: "Forest",
    bg: "#E9EEE4", surface: "#FFFFFF", surfaceAlt: "#F5F8F1", ink: "#152019", ink2: "#26352C", muted: "#5E6B62", faint: "#8A968C",
    go: "#128A4B", goSoft: "#DDF0E4", gold: "#B8860B", silver: "#7C8891", bronze: "#B06A34",
    caution: "#D08A22", cautionSoft: "#F7ECD8", avoid: "#C24631", avoidSoft: "#F6E1DC", hair: "#D3DBCC", blue: "#2E6F8E", violet: "#6A5AA6" },
  midnight: { name: "Midnight", dark: true,
    bg: "#0E141A", surface: "#182029", surfaceAlt: "#202A34", ink: "#ECF2EE", ink2: "#C6D0C9", muted: "#8A9AA0", faint: "#5E6B73",
    go: "#35D68A", goSoft: "#14322A", gold: "#E3B24C", silver: "#9AA7B0", bronze: "#C98A55",
    caution: "#E4A94C", cautionSoft: "#2C2413", avoid: "#E86A54", avoidSoft: "#2E1A16", hair: "#2A343E", blue: "#4FA3D4", violet: "#A28FE6" },
  ocean: { name: "Ocean",
    bg: "#E7EEF2", surface: "#FFFFFF", surfaceAlt: "#EEF4F8", ink: "#10202B", ink2: "#22333F", muted: "#566873", faint: "#8497A2",
    go: "#0E8F9B", goSoft: "#D5EEF0", gold: "#C69A3C", silver: "#7C8891", bronze: "#B06A34",
    caution: "#D68A2A", cautionSoft: "#F6ECD9", avoid: "#C9504A", avoidSoft: "#F6E0DE", hair: "#CFDBE2", blue: "#2E6F8E", violet: "#5E6AB0" },
  ember: { name: "Ember",
    bg: "#F6EFE9", surface: "#FFFFFF", surfaceAlt: "#FBEDE3", ink: "#241813", ink2: "#3B2A22", muted: "#7A6355", faint: "#A98F7E",
    go: "#C4632F", goSoft: "#F6E2D4", gold: "#B8860B", silver: "#8A8078", bronze: "#A9682F",
    caution: "#CE8A2A", cautionSoft: "#F7ECD6", avoid: "#B23B2F", avoidSoft: "#F4DDD7", hair: "#E4D6C9", blue: "#3E7C8E", violet: "#7A5AA6" },
  mono: { name: "Mono",
    bg: "#F0F1EF", surface: "#FFFFFF", surfaceAlt: "#F5F6F4", ink: "#1A1B18", ink2: "#33352F", muted: "#63665E", faint: "#96988F",
    go: "#1F6E3A", goSoft: "#E1EBE2", gold: "#8A7A3A", silver: "#808881", bronze: "#977A54",
    caution: "#9A7A2E", cautionSoft: "#EEEAD9", avoid: "#8E3B33", avoidSoft: "#EEDEDB", hair: "#DBDCD7", blue: "#40606E", violet: "#5A566E" },
};

const ALLERGENS = ["Milk", "Eggs", "Fish", "Shellfish", "Tree nuts", "Peanuts", "Wheat/Gluten", "Soy", "Sesame"];
const DIETS = ["Vegetarian", "Vegan", "Pork-free", "Keto"];

/* Deterministic allergen post-filter — safety net over AI output. Over-filters by design. */
const ALLERGEN_WORDS = {
  eggs: ["egg", "omelet", "omelette", "frittata", "mayo", "mayonnaise", "aioli", "meringue", "hollandaise", "quiche", "custard", "benedict"],
  dairy: ["cheese", "milk", "cream", "yogurt", "butter", "queso", "alfredo", "ranch", "parmesan", "mozzarella", "cheddar", "whey", "latte", "ice cream"],
  peanuts: ["peanut", "satay", "pad thai"],
  "tree nuts": ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "praline", "nutella"],
  gluten: ["bread", "bun", "wrap", "tortilla", "pasta", "noodle", "breaded", "battered", "croissant", "biscuit", "pita", "bagel", "flour", "panko", "pretzel", "crouton"],
  shellfish: ["shrimp", "crab", "lobster", "prawn", "scallop", "clam", "mussel", "oyster", "calamari", "crawfish"],
  fish: ["salmon", "tuna", "cod", "tilapia", "fish", "anchovy", "mahi", "halibut", "trout", "sardine"],
  soy: ["soy", "tofu", "edamame", "tempeh", "miso", "teriyaki"],
  sesame: ["sesame", "tahini", "hummus", "halva"],
};
function salvageJSONObject(text) {
  const t = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(t); } catch {}
  // models sometimes wrap JSON in prose: extract the first balanced {...} block
  const first = t.indexOf("{");
  if (first >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = first; i < t.length; i++) {
      const ch = t[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(t.slice(first, i + 1)); } catch {} break; } }
    }
  }
  // truncated: cut to last complete value, then close every open brace/bracket
  let cut = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"), t.lastIndexOf('"'));
  for (; cut > 0; cut--) {
    const cand = t.slice(0, cut + 1);
    let closers = "", inStr = false, esc = false;
    const stack = [];
    for (const ch of cand) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") stack.push(ch);
      if (ch === "}" || ch === "]") stack.pop();
    }
    if (inStr) continue; // don't cut mid-string
    for (let i = stack.length - 1; i >= 0; i--) closers += stack[i] === "{" ? "}" : "]";
    try { return JSON.parse(cand + closers); } catch {}
  }
  throw new Error("unparseable AI response");
}
function salvageJSONArray(text) {
  const t = String(text).replace(/```json|```/g, "").trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf("[");
  const lastObj = t.lastIndexOf("}");
  if (start >= 0 && lastObj > start) {
    try { return JSON.parse(t.slice(start, lastObj + 1) + "]"); } catch {}
  }
  throw new Error("unparseable AI response");
}
function violatesAllergy(text, allergies) {
  const t = String(text || "").toLowerCase();
  for (const a of allergies) {
    const words = ALLERGEN_WORDS[a.toLowerCase()] || [a.toLowerCase()];
    for (const w of words) if (t.includes(w)) return a;
  }
  return null;
}
function sanitizePicks(parsed, allergies) {
  if (!parsed || !Array.isArray(parsed.picks) || !allergies.length) return parsed;
  const clean = [], moved = [];
  for (const p of parsed.picks) {
    const hit = violatesAllergy(`${p.item || p.name || ""} ${p.why || p.desc || ""}`, allergies);
    if (hit) moved.push({ item: p.item || p.name, reason: `auto-filtered: may contain ${hit}` });
    else clean.push(p);
  }
  return { ...parsed, picks: clean, avoid: [...moved, ...(parsed.avoid || [])] };
}
const DEFAULT_PREFS = {
  rolloverHour: 0,          // hour of day when "today" resets (0 = midnight; night shift might use 4)
  units: "imperial",        // imperial | metric
  injIntervalDays: 7,       // injection cadence
  proteinFloor: 30,         // per-meal protein floor (g) used in nudges/ordering
  nauseaSensitivity: "normal", // low | normal | high
  searchRadiusMi: 2,        // nearby venue search radius (miles)
  venueCount: 20,           // max venues fetched
  dayStart: 7, dayEnd: 19,  // map auto day/night hours
  mapZoom: 15, mapStyle: "auto",
  requeryMi: 0.15,          // GPS movement before venues re-query
  paceLbPerWeek: 1.5,       // target loss pace
  aiModel: "claude-sonnet-4-6", // or claude-haiku-4-5-20251001 (cheaper)
  rankCacheHours: 4,        // health scores refresh on roughly meal cadence
  coachStyle: "balanced",   // concise | balanced | detailed | tough-love
  customTargets: null,      // saved personal macro preset
};
const KG = 0.45359237, ML_PER_OZ = 29.5735, CM_PER_IN = 2.54;
function dayISOAt(rolloverHour) { return new Date(Date.now() - (rolloverHour || 0) * 3600000).toLocaleDateString("sv-SE"); }
const MODES = {
  glp1: { label: "GLP-1", targets: { protein: 160, calories: 1400, carbs: 110, fat: 45, waterOz: 110, fiber: 28 } },
  cut: { label: "Cutting", targets: { protein: 170, calories: 1900, carbs: 150, fat: 55, waterOz: 100, fiber: 30 } },
  maintain: { label: "Maintain", targets: { protein: 150, calories: 2200, carbs: 220, fat: 70, waterOz: 100, fiber: 30 } },
  gain: { label: "Muscle gain", targets: { protein: 190, calories: 2600, carbs: 280, fat: 80, waterOz: 110, fiber: 35 } },
  custom: { label: "My preset", targets: { protein: 170, calories: 1900, carbs: 150, fat: 55, waterOz: 100, fiber: 30 } },
};

const RESTAURANTS = [
  { id: "chipotle", name: "Chipotle", score: 4.6, cuisine: "Mexican", eta: "6 min", menu: [
    { name: "Double Chicken Bowl (no rice, fajita veg, salsa, cheese)", protein: 62, calories: 510, carbs: 20, fat: 22 },
    { name: "Chicken Burrito Bowl (rice + black beans)", protein: 45, calories: 665, carbs: 70, fat: 22 },
    { name: "Steak Salad (no dressing)", protein: 31, calories: 400, carbs: 18, fat: 20 },
    { name: "Barbacoa Bowl", protein: 41, calories: 620, carbs: 55, fat: 24 },
    { name: "Veggie Bowl", protein: 12, calories: 500, carbs: 68, fat: 16 },
    { name: "Chips & Queso Blanco", protein: 9, calories: 770, carbs: 78, fat: 44 } ] },
  { id: "cfa", name: "Chick-fil-A", score: 4.2, cuisine: "Chicken", eta: "9 min", menu: [
    { name: "Grilled Nuggets (12 ct)", protein: 38, calories: 200, carbs: 3, fat: 4.5 },
    { name: "Grilled Chicken Sandwich", protein: 37, calories: 390, carbs: 44, fat: 6 },
    { name: "Cobb Salad w/ Grilled Filet", protein: 40, calories: 510, carbs: 27, fat: 24 },
    { name: "Spicy Deluxe (fried)", protein: 30, calories: 540, carbs: 46, fat: 26 },
    { name: "Classic Chicken Sandwich (fried)", protein: 28, calories: 420, carbs: 41, fat: 17 },
    { name: "Waffle Fries (medium)", protein: 5, calories: 420, carbs: 45, fat: 24 } ] },
  { id: "roadhouse", name: "Texas Roadhouse", score: 4.0, cuisine: "Steakhouse", eta: "18 min", menu: [
    { name: "8 oz Sirloin (no butter)", protein: 54, calories: 420, carbs: 2, fat: 20 },
    { name: "Grilled Chicken Breast", protein: 46, calories: 360, carbs: 4, fat: 12 },
    { name: "Grilled Salmon", protein: 42, calories: 480, carbs: 3, fat: 28 },
    { name: "Pulled Pork (no bun)", protein: 30, calories: 300, carbs: 6, fat: 16 },
    { name: "Fried Chicken Critters", protein: 34, calories: 890, carbs: 62, fat: 48 },
    { name: "Cactus Blossom (shared)", protein: 10, calories: 1950, carbs: 140, fat: 130 } ] },
  { id: "panera", name: "Panera", score: 4.1, cuisine: "Bakery-Café", eta: "11 min", menu: [
    { name: "Chicken Cobb w/ Avocado", protein: 39, calories: 560, carbs: 18, fat: 36 },
    { name: "Greek Salad w/ Chicken", protein: 34, calories: 470, carbs: 22, fat: 26 },
    { name: "Turkey Sandwich (half)", protein: 24, calories: 340, carbs: 40, fat: 9 },
    { name: "Ten Vegetable Soup", protein: 7, calories: 150, carbs: 27, fat: 3 },
    { name: "Mac & Cheese (bowl)", protein: 24, calories: 960, carbs: 84, fat: 54 },
    { name: "Double Bread Bowl", protein: 20, calories: 900, carbs: 150, fat: 14 } ] },
  { id: "culvers", name: "Culver's", score: 3.4, cuisine: "Burgers", eta: "8 min", menu: [
    { name: "Grilled Chicken Sandwich", protein: 34, calories: 420, carbs: 44, fat: 11 },
    { name: "Garden Salad w/ Grilled Chicken", protein: 30, calories: 300, carbs: 14, fat: 12 },
    { name: "ButterBurger Double", protein: 40, calories: 750, carbs: 42, fat: 45 },
    { name: "Crispy Chicken Sandwich", protein: 26, calories: 620, carbs: 52, fat: 32 },
    { name: "Cheese Curds (regular)", protein: 22, calories: 660, carbs: 42, fat: 42 },
    { name: "Concrete Mixer (mini)", protein: 10, calories: 560, carbs: 68, fat: 27 } ] },
];

const FOOD_BY_ID = { chipotle: "bowl", cfa: "chicken", roadhouse: "steak", panera: "salad", culvers: "burger" };
const FOOD_KW = { chipotle: "burrito", cfa: "chicken", roadhouse: "steak", panera: "salad", culvers: "burger" };
const PINS = [{ x: 58, y: 52 }, { x: 242, y: 44 }, { x: 108, y: 120 }, { x: 252, y: 118 }, { x: 168, y: 66 }];
const PINS_PCT = [{ x: 20, y: 30 }, { x: 75, y: 24 }, { x: 33, y: 73 }, { x: 82, y: 66 }, { x: 55, y: 43 }];
const PHOTOS = {"chipotle": "data:image/jpeg;base64,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", "cfa": "data:image/jpeg;base64,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", "roadhouse": "data:image/jpeg;base64,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", "panera": "data:image/jpeg;base64,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", "culvers": "data:image/jpeg;base64,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"};

const MEDS = {
  tirzepatide: { label: "Tirzepatide", brand: "Zepbound / Mounjaro", cadence: "weekly", investigational: false,
    steps: [2.5, 5, 7.5, 10, 12.5, 15], unit: "mg",
    note: "Typical: 2.5 mg/wk for 4 wks, then step up by 2.5 mg every ≥4 wks as tolerated. Max 15 mg." },
  semaglutide: { label: "Semaglutide", brand: "Wegovy / Ozempic", cadence: "weekly", investigational: false,
    steps: [0.25, 0.5, 1.0, 1.7, 2.4], unit: "mg",
    note: "Typical: 0.25 mg/wk, escalate ~every 4 wks to 2.4 mg maintenance." },
  retatrutide: { label: "Retatrutide", brand: "Investigational (Lilly)", cadence: "weekly", investigational: true,
    steps: [], unit: "mg",
    note: "Phase 3 (TRIUMPH), not FDA-approved. Trial/clinician-directed dosing only — no schedule shown." },
};

const uid = () => Math.random().toString(36).slice(2, 9);
const log10 = (x) => Math.log(x) / Math.LN10;
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (d) => new Date(d).toLocaleDateString([], { month: "short", day: "numeric" });
const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const distMi = (a, b, c, d) => { const R = 3958.8, dl = (c - a) * Math.PI / 180, dg = (d - b) * Math.PI / 180, h = Math.sin(dl / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dg / 2) ** 2; return R * 2 * Math.asin(Math.sqrt(h)); };

export default function App() {
  const [theme, setTheme] = useState("midnight");
  const C = THEMES[theme];
  const [mode, setMode] = useState("cut");
  const [allergies, setAllergies] = useState([]);
  const [diets, setDiets] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appVer, setAppVer] = useState("");
  useEffect(() => { fetch("/api/version").then((r) => r.json()).then((j) => j && j.version && setAppVer(j.version)).catch(() => {}); }, []);
  const [keyStatus, setKeyStatus] = useState(null);
  const [keyIn, setKeyIn] = useState({ a: "", g: "", fi: "", fs: "" });
  const [keyMsg, setKeyMsg] = useState("");
  useEffect(() => { if (settingsOpen) fetch("/api/keys/status").then((r) => r.json()).then(setKeyStatus).catch(() => {}); }, [settingsOpen]);
  async function saveKeys() {
    setKeyMsg("Saving…");
    const body = {}; if (keyIn.a.trim()) body.ANTHROPIC_API_KEY = keyIn.a.trim(); if (keyIn.g.trim()) body.GOOGLE_PLACES_KEY = keyIn.g.trim();
    if (keyIn.fi.trim()) body.FATSECRET_CLIENT_ID = keyIn.fi.trim(); if (keyIn.fs.trim()) body.FATSECRET_CLIENT_SECRET = keyIn.fs.trim();
    try { await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setKeyIn({ a: "", g: "", fi: "", fs: "" }); const st = await (await fetch("/api/keys/status")).json(); setKeyStatus(st); setKeyMsg("Saved ✓");
      if (venues.length && !venues[0].menu) rankVenues(venues); }
    catch { setKeyMsg("Save failed — is the node reachable?"); }
  }
  async function testAiKey() {
    if (keyIn.a.trim() || keyIn.g.trim() || keyIn.fi.trim() || keyIn.fs.trim()) { await saveKeys(); }  // test what you pasted, not a stale save
    setKeyMsg("Testing AI key…");
    try { const t = await callClaude("Reply with exactly: ok");
      const good = t.toLowerCase().includes("ok");
      setKeyMsg(good ? "AI key works ✓" : `Unexpected reply: ${t.slice(0, 40)}`);
      if (good && venues.length && !venues[0].menu) rankVenues(venues); }
    catch (e) { setKeyMsg(`AI key failed: ${(e && e.message) || e}`); }
  }
  const [tab, setTab] = useState("now");

  const [targets, setTargets] = useState(MODES.cut.targets);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const isMetric = prefs.units === "metric";
  const wtU = isMetric ? "kg" : "lbs";
  const fmtWt = (lb, d = 1) => (isMetric ? (lb * KG).toFixed(d) : (+lb).toFixed(d));
  const parseWt = (v) => (isMetric ? parseFloat(v) / KG : parseFloat(v));
  const fmtLen = (inch) => (isMetric ? Math.round(inch * CM_PER_IN) : inch);
  const parseLen = (v) => (isMetric ? parseFloat(v) / CM_PER_IN : parseFloat(v));
  const volU = isMetric ? "ml" : "oz";
  const fmtVol = (oz) => (isMetric ? Math.round(oz * ML_PER_OZ) : Math.round(oz));
  const [eaten, setEaten] = useState({ protein: 0, calories: 0, carbs: 0, fat: 0, waterOz: 0, fiber: 0, steps: 0, exerciseCal: 0 });
  const [savedRank, setSavedRank] = useState(null); // persisted rank cache — must precede stateBlob
  const [editing, setEditing] = useState(false);

  const [geo, setGeo] = useState({ status: "idle" });
  const [venues, setVenues] = useState(RESTAURANTS);
  const [rankState, setRankState] = useState("idle"); // idle | ranking | ranked | <error string>
  const hydrated = useRef(false);

  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(new Date());

  const [body, setBody] = useState({ sex: "male", heightIn: 71, neck: 16, waist: 35, hip: 40 });
  const [weightLog, setWeightLog] = useState([]);
  const [newWeight, setNewWeight] = useState("");
  const [goalWeight, setGoalWeight] = useState(185);
  const [photos, setPhotos] = useState([]);
  const [compareA, setCompareA] = useState(0);
  const [compareB, setCompareB] = useState(0);
  const fileRef = useRef(null);
  const photoRef = useRef(null);

  const [glp, setGlp] = useState({
    med: "tirzepatide", dose: 2.5, injectionDay: "SU",
    lastInjection: null, weeksOn: 1, lastDoseChangeWk: 99, doseLog: [],
    sideEffects: [],
  });
  const [seSymptom, setSeSymptom] = useState("Nausea");
  const [seSeverity, setSeSeverity] = useState(2);

  // meal history (fat matters for GLP-1 nausea correlation). Scans/photos/orders append here.
  const [mealLog, setMealLog] = useState([]);

  const [coachMsgs, setCoachMsgs] = useState([
    { role: "assistant", text: "I'm your coach. I can see your macros, weight trend, and meds. Ask me what to eat, whether you're on pace, or how to handle a low-appetite day." },
  ]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);

  // food logging / barcode scan
  const [logOpen, setLogOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState("");
  const [camHint, setCamHint] = useState(false);
  const resultRef = useRef(null);
  useEffect(() => {
    if (!camOn) { setCamHint(false); return; }
    const t = setTimeout(() => setCamHint(true), 10000);
    return () => clearTimeout(t);
  }, [camOn]);
  const camVideoRef = useRef(null);
  const camControlsRef = useRef(null);
  const camCanvasRef = useRef(null);
  const camOnRef = useRef(false);
  useEffect(() => { camOnRef.current = camOn; }, [camOn]);
  function paintLoop() {
    const v = camVideoRef.current, c = camCanvasRef.current;
    if (v && c && v.videoWidth) {
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      c.getContext("2d").drawImage(v, 0, 0);
    }
    if (camOnRef.current) requestAnimationFrame(paintLoop);
  }
  async function startCam() {
    setCamErr("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices) { setCamErr("Camera needs HTTPS — open ForkCaster from your ts.net URL."); return; }
    setCamOn(true);
    setCamHint(false);
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      const constraints = { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
      camControlsRef.current = await reader.decodeFromConstraints(constraints, camVideoRef.current, (result, _err, controls) => {
        if (result) {
          try { controls.stop(); } catch {}
          setCamOn(false);
          const code = result.getText();
          setBarcode(code);
          lookupBarcode(code);
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        }
      });
      requestAnimationFrame(paintLoop);
    } catch (e) {
      setCamOn(false);
      setCamErr(e && e.name === "NotAllowedError" ? "Camera permission denied — allow it in iOS Settings for ForkCaster." : `Camera failed: ${(e && e.message) || e}`);
    }
  }
  function stopCam() { try { camControlsRef.current && camControlsRef.current.stop(); } catch {} setCamOn(false); }
  const [scan, setScan] = useState({ status: "idle" }); // idle|loading|found|miss|error + food
  useEffect(() => { if (scan.status === "found" && resultRef.current) resultRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [scan.status]);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { detectLocation(); }, []);
  const watchRef = useRef(null);
  function startWatch() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setGeo({ status: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude, live: true, ts: Date.now() }),
      () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  }
  useEffect(() => { startWatch(); return () => { if (watchRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current); }; }, []);

  // ── server persistence (Umbrel backend) ──
  useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then((s) => {
      if (s && s.saved) {
        if (s.theme) setTheme(s.theme); if (s.mode) { setMode(s.mode); }
        if (s.targets) setTargets(s.targets);
        const roll = (s.prefs && s.prefs.rolloverHour) || 0;
        if (s.prefs) setPrefs({ ...DEFAULT_PREFS, ...s.prefs });
        if (s.eaten) setEaten(s.eatenDate === dayISOAt(roll) ? s.eaten : { protein: 0, calories: 0, carbs: 0, fat: 0, waterOz: 0, fiber: 0, steps: 0, exerciseCal: 0 });
        if (s.allergies) setAllergies(s.allergies); if (s.diets) setDiets(s.diets);
        if (s.body) setBody(s.body); if (s.weightLog) setWeightLog(s.weightLog);
        if (s.goalWeight) setGoalWeight(s.goalWeight); if (s.glp) setGlp({ ...s.glp, doseLog: s.glp.doseLog || (s.glp.lastInjection ? [{ date: s.glp.lastInjection, mg: s.glp.dose || 0 }] : []) });
        if (s.mealLog) setMealLog(s.mealLog); if (s.photos) setPhotos(s.photos);
        if (s.savedRank) setSavedRank(s.savedRank);
        if (s.savedGeo && s.savedGeo.lat != null) { setSavedGeo(s.savedGeo); setGeo((g) => (g.status === "ok" ? g : { status: "ok", lat: s.savedGeo.lat, lng: s.savedGeo.lng, manual: true })); }
      }
      hydrated.current = true;
    }).catch(() => { hydrated.current = true; });
  }, []);
  const [savedGeo, setSavedGeo] = useState(null);
  useEffect(() => { if (geo.status === "ok") setSavedGeo({ lat: geo.lat, lng: geo.lng }); }, [geo.status, geo.lat, geo.lng]);
  const stateBlob = JSON.stringify({ saved: true, eatenDate: dayISOAt(prefs.rolloverHour), theme, mode, targets, eaten, allergies, diets, body, weightLog, goalWeight, glp, mealLog, photos, savedGeo, prefs, savedRank });
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => { fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: stateBlob }).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [stateBlob]);

  // ── live nearby venues via Google Places (falls back to demo set) ──
  const lastQ = useRef(null);
  useEffect(() => {
    if (geo.status !== "ok") return;
    if (lastQ.current && distMi(lastQ.current.lat, lastQ.current.lng, geo.lat, geo.lng) < (prefs.requeryMi || 0.15)) return;
    lastQ.current = { lat: geo.lat, lng: geo.lng };
    fetch(`/api/nearby?lat=${geo.lat}&lng=${geo.lng}&radius=${Math.round((prefs.searchRadiusMi || 2) * 1609)}&max=${prefs.venueCount || 20}`).then((r) => r.json()).then((j) => {
      if (!j) return;
      if (j.live) {
        setVenues(j.venues || []);
        if (j.venues && j.venues.length) rankVenues(j.venues); else setRankState("idle");
      }
      // no Places key (live:false): keep the labeled demo set
    }).catch(() => {});
  }, [geo.status, geo.lat, geo.lng]);

  const proteinLeft = Math.max(0, targets.protein - eaten.protein);
  const calLeft = Math.max(0, targets.calories - eaten.calories);
  const waterLeft = Math.max(0, targets.waterOz - eaten.waterOz);
  const fiberLeft = Math.max(0, (targets.fiber || 0) - (eaten.fiber || 0));
  const waterPct = Math.min(100, (eaten.waterOz / targets.waterOz) * 100);
  const fiberPct = targets.fiber ? Math.min(100, (eaten.fiber / targets.fiber) * 100) : 0;
  const proteinPct = Math.min(100, (eaten.protein / targets.protein) * 100);
  const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const curWeight = weightLog[weightLog.length - 1]?.lbs || 0;
  const startWeight = weightLog[0]?.lbs || curWeight;
  const bmi = curWeight && body.heightIn ? (703 * curWeight) / (body.heightIn * body.heightIn) : 0;
  const bodyFat = calcBodyFat(body, curWeight);
  const leanMass = bodyFat ? curWeight * (1 - bodyFat / 100) : 0;
  const lost = startWeight - curWeight;

  const medObj = MEDS[glp.med];
  const injInterval = prefs.injIntervalDays || 7;
  const nextInjection = (() => {
    if (injInterval !== 7) {
      return glp.lastInjection
        ? new Date(new Date(glp.lastInjection).getTime() + injInterval * 86400000)
        : new Date(Date.now() + injInterval * 86400000);
    }
    // weekly: next occurrence of the chosen dose day after the last dose (or after today)
    const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const target = map[glp.injectionDay] ?? 0;
    const base = glp.lastInjection ? new Date(glp.lastInjection + "T12:00:00") : new Date();
    base.setHours(0, 0, 0, 0);
    let add = (target - base.getDay() + 7) % 7; if (add === 0) add = 7;
    const x = new Date(base); x.setDate(x.getDate() + add); return x;
  })();
  const daysToInjection = Math.max(0, Math.ceil((nextInjection - new Date()) / 86400000));
  const dueISO = nextInjection.toLocaleDateString("sv-SE");
  const recentRate = weeklyRate(weightLog);
  const weeksToGoal = recentRate > 0.05 && curWeight > goalWeight ? Math.ceil((curWeight - goalWeight) / recentRate) : null;
  const goalDate = weeksToGoal ? addDays(new Date(), weeksToGoal * 7) : null;

  // ── med-aware signals (WHITE SPACE #1) ──
  const onMed = !!medObj; // any selected GLP-1 (incl. investigational) drives appetite/nausea-aware ordering
  const escalating = onMed && (glp.lastDoseChangeWk ?? 99) <= 2;                 // recent step-up → GI risk up
  const recentNausea = glp.sideEffects.filter((s) => s.symptom === "Nausea" && daysAgo(s.date) <= 5);
  const nauseaScore = recentNausea.reduce((a, s) => a + s.severity, 0) + (escalating ? 1 : 0);
  const nauseaShift = prefs.nauseaSensitivity === "high" ? 1 : prefs.nauseaSensitivity === "low" ? -1 : 0;
  const nauseaAdj = nauseaScore + nauseaShift;
  const nauseaRisk = !onMed ? "none" : nauseaAdj >= 3 ? "high" : nauseaAdj >= 1 ? "moderate" : "low";

  // ── symptom↔food correlation (WHITE SPACE #2) ──
  const nauseaDays = glp.sideEffects.filter((s) => s.symptom === "Nausea");
  const nauseaWithMeal = nauseaDays.map((s) => ({ s, meal: mealLog.find((m) => m.date === s.date) })).filter((x) => x.meal);
  const nauseaAfterHighFat = nauseaWithMeal.filter((x) => x.meal.fat >= 30);
  const fatCorrelation = nauseaWithMeal.length >= 2
    ? { hits: nauseaAfterHighFat.length, total: nauseaWithMeal.length, avgFat: Math.round(nauseaAfterHighFat.reduce((a, x) => a + x.meal.fat, 0) / (nauseaAfterHighFat.length || 1)) }
    : null;

  // ── journey phase (WHITE SPACE #3) ──
  const goalSpan = Math.max(1, startWeight - goalWeight);
  const progress = Math.min(1, Math.max(0, lost / goalSpan));
  const toGoal = curWeight - goalWeight;
  const phaseIdx = escalating && progress < 0.15 ? 0 : toGoal <= 3 ? (toGoal <= 0.5 ? 3 : 2) : 1;
  const PHASES = [
    { key: "rampup", label: "Ramp-up", focus: "Build the habit while your dose climbs. Nausea is highest now — lighter, protein-first meals." },
    { key: "loss", label: "Active loss", focus: "Protein floor every meal to protect muscle while fat comes off. You're on pace." },
    { key: "approach", label: "Approaching goal", focus: "Shift to muscle preservation + resistance training. Ease the deficit as you close in." },
    { key: "maintain", label: "Maintenance / off-ramp", focus: "The hard part most apps ignore: hold the loss and plan life after the drug." },
  ];

  function parseCoords(v) {
    if (!v) return null;
    const s = String(v).trim().replace(/[()]/g, "");
    const re = /(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?/gi;
    let m; const vals = [];
    while ((m = re.exec(s)) && vals.length < 2) {
      let num = parseFloat(m[1]); const h = (m[2] || "").toUpperCase();
      if (h === "S" || h === "W") num = -Math.abs(num);
      if (h === "N" || h === "E") num = Math.abs(num);
      vals.push({ num, h });
    }
    if (vals.length < 2) return null;
    let lat = vals[0].num, lng = vals[1].num;
    const hs = vals.map((x) => x.h).join("");
    if (vals[0].h === "E" || vals[0].h === "W" || vals[1].h === "N" || vals[1].h === "S") { const t = lat; lat = lng; lng = t; }
    else if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) { const t = lat; lat = lng; lng = t; }
    if (!hs && lng > 66 && lng < 180 && lat > 0 && lat <= 72) lng = -lng; // pasted US coords without the minus
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }
  function manualLocation() {
    const v = window.prompt("Paste your coordinates — any of these work:\n38.62701° N, 90.19940° W\n38.62701, -90.19940\n(Apple Maps → drop pin → copy from the place card)");
    if (!v) return;
    const c = parseCoords(v);
    if (c) setGeo({ status: "ok", lat: c.lat, lng: c.lng, manual: true });
    else window.alert("Couldn't read that. Try the form: 38.62701, -90.19940");
  }
  function detectLocation(fromTap) {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeo({ status: "unavailable" }); return; }
    if (geo.status === "denied" && fromTap) { manualLocation(); return; }  // second tap after a denial = manual entry
    setGeo((g) => (g.status === "ok" ? g : { status: "locating" }));
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeo({ status: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude, live: true, ts: Date.now() }); startWatch(); },
      (err) => {
        if (fromTap) {
          const denied = err && err.code === 1;
          window.alert(denied
            ? "iOS refused the location request without prompting — this app is marked Denied.\n\nFix: iPhone Settings → Apps → ForkCaster → Location → While Using + Precise.\n\nIf ForkCaster isn't listed there: Settings → Privacy & Security → Location Services → Safari Websites → While Using."
            : `Location failed: ${(err && err.message) || "unknown"}. Tap again to retry.`);
        }
        setGeo((g) => (g.status === "ok" ? g : { status: "denied", code: err && err.code, msg: (err && err.message || "").slice(0, 80) }));
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true });
  }
  function pickMode(k) { setMode(k); setTargets(k === "custom" && prefs.customTargets ? prefs.customTargets : MODES[k].targets); }
  function toggleIn(list, setList, v) { setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]); }
  const restrictions = [...allergies.map((a) => `ALLERGY: ${a}`), ...diets.map((d) => `DIET: ${d}`)];

  async function callClaude(prompt, sys, image, maxTokens) {
    const styleLine = { concise: " Keep replies very brief.", balanced: "", detailed: " Be thorough and explain reasoning.", "tough-love": " Be direct, no sugarcoating, drill-sergeant energy." }[prefs.coachStyle] || "";
    const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, system: (sys || "") + styleLine, image, model: prefs.aiModel, max_tokens: maxTokens }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.text || "";
  }

  const lastRank = useRef({ key: "", at: 0 });
  function applyRank(vsList, arr) {
    setVenues((cur) => cur
      .map((v) => { const m = Array.isArray(arr) ? arr.find((x) => x.id === v.id) : null; return m && Number.isFinite(+m.match) ? { ...v, match: Math.max(0, Math.min(100, Math.round(+m.match))), why: m.why } : v; })
      .sort((a, b) => (b.match ?? -1) - (a.match ?? -1)));
  }
  async function rankVenues(vs, force) {
    const key = vs.map((v) => v.id).sort().join(",") + `|${mode}|${targets.protein}|${targets.calories}`;
    const now = Date.now();
    if (!force) {
      if (savedRank && savedRank.key === key && now - savedRank.at < (prefs.rankCacheHours || 4) * 3600000) {
        applyRank(vs, savedRank.arr); setRankState("ranked"); return; // reuse persisted scores: stable + free
      }
      if (key === lastRank.current.key && now - lastRank.current.at < 30 * 60000) return;
      if (now - lastRank.current.at < 120000) return;
    }
    lastRank.current = { key, at: now };
    setRankState("ranking");
    try {
      const medLine = medObj ? ` User is on ${medObj.label}${nauseaRisk !== "low" ? ` with ${nauseaRisk.toUpperCase()} nausea risk (favor gentle, lean, low-fat venues)` : ""}.` : "";
      const restrictLine = restrictions.length ? ` Hard restrictions: ${restrictions.join("; ")} — venues that can't safely serve these score LOW.` : "";
      const prompt =
        `User goal mode: ${MODES[mode] ? MODES[mode].label : mode}. Score each venue 0-100 by the BEST goal-fit order an informed customer can build there RIGHT NOW — not the menu average. ` +
        `Credit customization power: added protein, sugar-free/light bases, grilled swaps, sauces on the side (e.g., a smoothie shop with a high-protein low-sugar line scores on THAT line, not its dessert smoothies). ` +
        `Dessert-only/fried-only with no workaround = low. IGNORE popularity and review scores.` +
        `Anchor the scale: 90-100 trivially fits remaining macros with high protein; 75-89 solid fit, minor tradeoffs; 55-74 possible with care; 35-54 limited workarounds; under 35 hostile to the goal. ` +
        ` User has ${proteinLeft}g protein and ${calLeft} calories remaining today.` + medLine + restrictLine +
        `\nVenues: ${JSON.stringify(vs.map((v) => ({ id: v.id, name: v.name, type: v.cuisine })))}` +
        `\nReturn ONLY minified JSON, no markdown: [{"id":"<id>","match":<int 0-100>,"why":"<max 6 words>"}] for every venue.`;
      const text = await callClaude(prompt, null, null, 2400);
      const arr = salvageJSONArray(text);
      applyRank(vs, arr);
      setSavedRank({ key, at: now, arr });
      setRankState("ranked");
    } catch (e) { setRankState((e && e.message) || "ranking failed"); }
  }

  async function orderForMe(r) {
    setSelected(r.id); setLoading(true); setResult(null); setError(null);
    const medLine = onMed
      ? ` They use ${medObj.label} (week ${glp.weeksOn}${escalating ? ", DOSE-INCREASE WEEK" : ""}). Appetite suppressed — smaller volume, protein density first.` +
        (nauseaRisk !== "low" ? ` Nausea risk is ${nauseaRisk.toUpperCase()} right now: AVOID fried/greasy/very heavy/high-fat dishes, favor gentle, lean, protein-dense options.` : "")
      : "";
    const restrictLine = restrictions.length
      ? `\nHARD SAFETY RULE — the user has: ${restrictions.join("; ")}. NEVER put any item containing or possibly containing these in "picks". Exclude anything uncertain. List excluded items in "avoid" with reason "contains <allergen>" or "not <diet>".`
      : "";
    let liveMenu = null;
    if (!r.menu && r.website) {
      try {
        const mres = await fetch(`/api/menu?url=${encodeURIComponent(r.website)}&goal=${encodeURIComponent(mode)}`, { signal: AbortSignal.timeout(14000) });
        const mj = await mres.json();
        if (mj && mj.ok && mj.text) liveMenu = mj;
      } catch {}
    }
    const prompt =
      `You are a sharp, medication-aware nutrition coach. User is at ${r.name} right now. Goal mode: ${MODES[mode] ? MODES[mode].label : mode}.\n` +
      `Remaining today: ${proteinLeft}g protein, ${calLeft} calories.` + medLine + restrictLine +
      `\n` + (mode === "gain"
        ? `Objective (Muscle gain): pick the HIGHEST-protein items available first, then calorie density — recommend size upgrades and protein add-ons (extra whey, peanut butter, oats) freely.`
        : `Objective: maximize remaining protein under remaining calories, favoring whole/grilled foods.`) +
      (nauseaRisk === "high" || nauseaRisk === "moderate"
        ? ` Medication note: ${nauseaRisk} nausea risk — prefer smoother, lower-fat, smaller-volume VERSIONS of goal-fit items, but NEVER swap to a lower-protein item when a tolerable higher-protein one exists; the goal outranks comfort tweaks. GLP-1-branded menu sections are only preferred when the user's goal mode is GLP-1.`
        : ``) + `\n` +
      (r.menu ? `Menu JSON: ${JSON.stringify(r.menu)}\n\n`
        : liveMenu ? `LIVE MENU TEXT scraped from their website (may be partial/noisy — only recommend items actually evidenced in this text, estimate macros conservatively). Return EXACTLY 3 picks. If the menu has sections aligned to the goal (e.g., "GLP-1", "high protein", "light", "under 500 cal") with at least 2 suitable items, AT LEAST 2 of your 3 picks MUST come from that section. If the text turns out to be boilerplate with no actual menu items, DISREGARD it and propose well-known typical orders for this chain instead — NEVER refuse and NEVER return zero picks:\n"""${liveMenu.text.slice(0, prefs.aiModel && prefs.aiModel.includes("haiku") ? 3500 : prefs.aiModel && prefs.aiModel.includes("sonnet") ? 6000 : 8000)}"""\n\n`
        : `No menu data available. Propose 3 realistic, commonly-available orders at a ${r.cuisine || "restaurant"} like ${r.name} that fit the goals; estimate macros conservatively.\n\n`) +
      `Keep all strings short (under 12 words). Your ENTIRE response must be exactly one JSON object — the first character { and the last character } — no prose, no markdown, nothing else. Format:\n` +
      `{"picks":[{"name":"<exact name>","protein":<int>,"calories":<int>,"why":"<max 9 words>"}],` +
      `"avoid":[{"name":"<exact name>","reason":"<max 7 words>"}],"coachLine":"<=16 words"}\n` +
      `Exactly 3 picks best-first, up to 3 avoid.` +
      (nauseaRisk !== "low" && onMed ? ` The coachLine should reference the nausea/dose-week reasoning.` : ``);
    try { const text = await callClaude(prompt, null, null, 2000); const parsed = sanitizePicks(salvageJSONObject(text), allergies); parsed._menuSource = r.menu ? "demo" : liveMenu ? "live" : "ai"; parsed._menuMethod = liveMenu ? liveMenu.method : null; setResult(parsed); }
    catch (e) { setError((e && e.message) || "Couldn't reach the coach. Tap a venue to retry."); }
    setLoading(false);
  }

  async function sendCoach() {
    const q = coachInput.trim(); if (!q || coachLoading) return;
    const next = [...coachMsgs, { role: "user", text: q }];
    setCoachMsgs(next); setCoachInput(""); setCoachLoading(true);
    const ctx = { remaining: { protein_g: proteinLeft, calories: calLeft }, targets, eaten, mode: MODES[mode].label,
      weight_lbs: curWeight, goal_lbs: goalWeight, weekly_loss_lbs: +recentRate.toFixed(2),
      body_fat_pct: bodyFat ? +bodyFat.toFixed(1) : null,
      medication: medObj ? `${medObj.label} ${glp.dose}${medObj.unit} weekly, week ${glp.weeksOn}` : "none", allergies, diets };
    const sys = "You are ForkCaster, a concise, encouraging nutrition and GLP-1 coach. Use the user's live stats. " + (restrictions.length ? `HARD SAFETY RULE: user has ${restrictions.join("; ")} — never suggest foods containing these. ` : "") +
      "NEVER recommend any food containing the user's listed allergies; respect their diet. " +
      "Give specific, actionable answers in 2-4 sentences. Never encourage extreme restriction or unsafe rapid loss; " +
      "for medication questions defer final decisions to their prescriber. No markdown headers.";
    const convo = next.map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.text}`).join("\n");
    try { const text = await callClaude(`User's live stats (JSON): ${JSON.stringify(ctx)}\n\nConversation:\n${convo}\n\nCoach:`, sys);
      setCoachMsgs([...next, { role: "assistant", text: text.trim() || "…" }]); }
    catch { setCoachMsgs([...next, { role: "assistant", text: "I couldn't reach the model just now — try again in a moment." }]); }
    setCoachLoading(false);
  }

  function logWeight() {
    const v = parseWt(newWeight); if (!v || !Number.isFinite(v)) return;
    const filtered = weightLog.filter((w) => w.date !== todayISO());
    setWeightLog([...filtered, { date: todayISO(), lbs: v }].sort((a, b) => a.date.localeCompare(b.date))); setNewWeight("");
  }
  async function addPhotos(e) {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try {
        const b64 = await toBase64(f);
        const res = await fetch("/api/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: b64, media: f.type || "image/jpeg" }) });
        const j = await res.json();
        const entry = j && j.url ? { id: j.id, url: j.url, date: todayISO() } : { id: uid(), url: URL.createObjectURL(f), date: todayISO() };
        setPhotos((p) => { const all = [...p, entry]; setCompareB(all.length - 1); return all; });
      } catch {
        const entry = { id: uid(), url: URL.createObjectURL(f), date: todayISO() };
        setPhotos((p) => { const all = [...p, entry]; setCompareB(all.length - 1); return all; });
      }
    }
  }
  function addSideEffect() { setGlp((g) => ({ ...g, sideEffects: [...g.sideEffects, { id: uid(), date: todayISO(), symptom: seSymptom, severity: seSeverity }] })); }
  const [doseLogged, setDoseLogged] = useState(false);
  const [presetSaved, setPresetSaved] = useState(false);
  function logInjection() {
    setGlp((g) => {
      const today = todayISO();
      const log = (g.doseLog || []).filter((d) => d.date !== today);
      return { ...g, lastInjection: today, weeksOn: g.weeksOn + 1, doseLog: [...log, { date: today, mg: g.dose || 0 }] };
    });
    setDoseLogged(true); setTimeout(() => setDoseLogged(false), 2500);
  }

  // Real Open Food Facts lookup (keyless, CORS-friendly). Camera decode is stubbed;
  // in production a scanner lib feeds the same barcode into this same call.
  async function lookupBarcode(code) {
    const bc = String(code || "").replace(/\D/g, ""); if (!bc) { setScan({ status: "miss" }); return; }
    setScan({ status: "loading" });
    try {
      const res = await fetch(`/api/food/${bc}`);
      const d = await res.json();
      if (!d || !d.found) { setScan({ status: "miss" }); return; }
      setScan({ status: "found", food: { name: d.name, brand: d.brand, basis: d.basis, source: d.source, calories: d.calories || 0, protein: d.protein || 0, carbs: d.carbs || 0, fat: d.fat || 0, fiber: d.fiber || 0 } });
    } catch { setScan({ status: "failed" }); }
  }

  async function shrinkToJpeg(file, maxDim = 1280, q = 0.82) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q).split(",")[1]; // always JPEG, well under API limits
  }
  async function estimateFromPhoto(e) {
    const file = (e.target.files || [])[0]; if (!file) return;
    setScan({ status: "loading" });
    try {
      const b64 = await shrinkToJpeg(file);
      const prompt = "Identify the food in this photo and estimate the macros for the full portion shown. " +
        "Return ONLY minified JSON, no markdown: {\"name\":\"<short name>\",\"calories\":<int>,\"protein\":<int>,\"carbs\":<int>,\"fat\":<int>,\"fiber\":<int>}. Best estimate if unsure.";
      const text = await callClaude(prompt, null, { data: b64, media_type: "image/jpeg" });
      const f = JSON.parse(text.replace(/```json|```/g, "").trim());
      setScan({ status: "found", food: {
        name: f.name || "Photo estimate", brand: "", basis: "portion shown", source: "AI photo estimate",
        calories: Math.round(f.calories || 0), protein: Math.round(f.protein || 0), carbs: Math.round(f.carbs || 0), fat: Math.round(f.fat || 0), fiber: Math.round(f.fiber || 0) } });
    } catch { setScan({ status: "error" }); }
  }
  function addLoggedFood() {
    if (scan.status !== "found") return;
    const f = scan.food;
    setEaten((e) => ({ ...e, protein: e.protein + f.protein, calories: e.calories + f.calories, carbs: e.carbs + f.carbs, fat: e.fat + f.fat, fiber: (e.fiber || 0) + (f.fiber || 0) }));
    setMealLog((m) => [...m, { id: uid(), date: todayISO(), name: f.name, fat: f.fat || 0, protein: f.protein || 0, calories: f.calories || 0 }]);
    setScan({ status: "idle" }); setBarcode(""); setLogOpen(false);
  }

  // theme-aware style helpers
  const linkBtn = { marginTop: 12, background: "none", border: "none", color: C.muted, fontSize: 12.5, fontFamily: BODY, cursor: "pointer", textDecoration: "underline", padding: 0 };
  const chipBtn = { background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 20, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer", fontFamily: BODY };
  const arrowBtn = { background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 8, width: 30, height: 26, fontSize: 15, color: C.ink, cursor: "pointer" };
  const selectStyle = { flex: 1, fontFamily: BODY, fontSize: 13.5, color: C.ink, background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "10px 11px", outline: "none" };
  const scoreColor = (s) => (s >= 4.3 ? C.go : s >= 3.8 ? C.caution : C.avoid);
  const medalColor = (i) => [C.gold, C.silver, C.bronze][i] || C.muted;

  const card = (children, extra = {}) => (<div style={{ background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 16, padding: 16, ...extra }}>{children}</div>);
  const sectionTitle = (t, color = C.ink) => (<div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>{t}</div>);
  const numField = (label, val, onChange) => <NumFieldC key={label} label={label} value={val} onChange={onChange} C={C} DISPLAY={DISPLAY} />;
  const stat = (label, value, unit, color = C.ink) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10.5, color: C.muted, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}<span style={{ fontSize: 12, color: C.faint, fontWeight: 500 }}>{unit}</span></div>
    </div>
  );

  const renderNow = () => (
    <div style={{ padding: "18px 18px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={() => detectLocation(true)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontSize: 11, letterSpacing: 1.1, color: C.muted, textTransform: "uppercase", fontWeight: 600, fontFamily: BODY }}>{geoLabel(geo, timeStr)}</button>
        <div style={{ fontSize: 11, color: C.go, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: C.go }} /> {MODES[mode].label}</div>
      </div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 54, fontWeight: 700, color: C.ink, lineHeight: 0.9, fontVariantNumeric: "tabular-nums" }}>{proteinLeft}<span style={{ fontSize: 22, color: C.muted }}>g</span></div>
        <div style={{ paddingBottom: 6 }}><div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>protein to go</div><div style={{ fontSize: 13, color: C.muted }}>{calLeft} cal left today</div></div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ height: 14, background: C.surface, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.hair}`, display: "flex" }}>
          <div style={{ width: `${proteinPct}%`, background: C.go, borderRight: proteinPct < 100 ? `2px solid ${C.ink}` : "none" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums" }}><span>{eaten.protein}g eaten</span><span>{targets.protein}g goal</span></div>
      </div>

      {/* Hydration + fiber remaining — mirrors the protein readout */}
      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        {[
          { label: "water to go", left: waterLeft, unit: "oz", pct: waterPct, col: C.blue },
          { label: "fiber to go", left: fiberLeft, unit: "g", pct: fiberPct, col: C.caution },
        ].map((m) => (
          <div key={m.label} style={{ flex: 1, background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 14, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{Math.round(m.left)}</span>
              <span style={{ fontSize: 13, color: C.muted }}>{m.unit}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>{m.label}</div>
            <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${m.pct}%`, height: "100%", background: m.col }} /></div>
          </div>
        ))}
      </div>

      <button onClick={() => setEditing((e) => !e)} style={linkBtn}>{editing ? "Done" : "Adjust today's numbers →"}</button>
      {editing && card(
        <>
          <div style={{ display: "flex", gap: 10 }}>{numField("Protein goal", targets.protein, (v) => setTargets({ ...targets, protein: +v }))}{numField("Calorie goal", targets.calories, (v) => setTargets({ ...targets, calories: +v }))}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>{numField("Carbs goal", targets.carbs, (v) => setTargets({ ...targets, carbs: +v }))}{numField("Fat goal", targets.fat, (v) => setTargets({ ...targets, fat: +v }))}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>{numField(`Water goal (${volU})`, fmtVol(targets.waterOz), (v) => setTargets({ ...targets, waterOz: isMetric ? +v / ML_PER_OZ : +v }))}{numField("Fiber goal (g)", targets.fiber, (v) => setTargets({ ...targets, fiber: +v }))}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>{numField("Protein eaten", eaten.protein, (v) => setEaten({ ...eaten, protein: +v }))}{numField("Calories eaten", eaten.calories, (v) => setEaten({ ...eaten, calories: +v }))}</div>
          <button onClick={() => { setPrefs({ ...prefs, customTargets: { ...targets } }); setMode("custom"); setPresetSaved(true); setTimeout(() => setPresetSaved(false), 2200); }} style={{ marginTop: 12, width: "100%", background: "none", border: `1.5px solid ${C.go}`, color: C.go, borderRadius: 10, padding: "10px 0", fontFamily: BODY, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{presetSaved ? "Preset saved ✓" : "Save these as \"My preset\""}</button>
        </>, { marginTop: 10 })}

      {onMed && nauseaRisk !== "low" && (
        <div style={{ marginTop: 16, background: C.violet + "14", border: `1px solid ${C.violet}44`, borderRadius: 14, padding: "12px 14px", display: "flex", gap: 11 }}>
          <div style={{ width: 4, borderRadius: 3, background: C.violet, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.violet, letterSpacing: 0.3 }}>MED-AWARE ORDERING · {nauseaRisk.toUpperCase()} NAUSEA RISK</div>
            <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 3, lineHeight: 1.4 }}>
              {escalating ? "Dose-increase week" : "Recent nausea logged"} — picks below skew lighter, lean, and protein-dense, steering off fried/greasy. No other app does this.
            </div>
          </div>
        </div>
      )}

      {(allergies.length > 0 || diets.length > 0) && (
        <div style={{ marginTop: 14, background: C.avoidSoft, border: `1px solid ${C.avoid}40`, borderRadius: 14, padding: "11px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><path d="M12 2 3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7z" stroke={C.avoid} strokeWidth="2" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" stroke={C.avoid} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.4 }}>
            <b style={{ color: C.avoid }}>Filtering out:</b> {[...allergies, ...diets].join(", ")}. These are hidden from every suggestion.
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {sectionTitle("Near you")}
        {rankState === "ranking" && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: -4, marginBottom: 10 }}>Ranking venues by health fit for your goals right now…</div>
        )}
        {rankState === "ranked" && (
          <div style={{ fontSize: 12, color: C.go, fontWeight: 600, marginTop: -4, marginBottom: 10 }}>✓ Ranked by health fit — your macros, meds &amp; filters, not star ratings</div>
        )}
        {rankState !== "idle" && rankState !== "ranking" && rankState !== "ranked" && (
          <div style={{ fontSize: 12, color: C.avoid, marginTop: -4, marginBottom: 10, lineHeight: 1.4 }}>
            Ranking hiccup ({rankState}) — usually a cut-off AI response, not your key.{" "}
            <span onClick={() => rankVenues(venues, true)} style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 700 }}>tap to retry</span>.
          </div>
        )}

        {/* Live map with match pins */}
        <div style={{ marginBottom: 14 }}>
          <MapView C={C} geo={geo} restaurants={venues.slice(0, 12)} onPin={orderForMe} scoreColor={scoreColor} onSearchArea={(la, ln) => setGeo({ status: "ok", lat: la, lng: ln, manual: true })} prefs={prefs} />
        </div>

        {geo.status === "ok" && venues.length === 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 16, padding: "22px 18px", textAlign: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>No food spots near you</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>Nothing within ~2 miles of this point. Keep driving, or drag the map ahead and tap "Search this area" to scout your route.</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, overflowX: "auto", margin: "0 -18px", padding: "0 18px 6px" }}>
          {venues.map((r, i) => {
            const active = selected === r.id; const sc = scoreColor(r.score);
            return (
              <div key={r.id} style={{ minWidth: 178, background: C.surface, borderRadius: 16, flexShrink: 0, overflow: "hidden", border: `1.5px solid ${active ? C.go : C.hair}`, boxShadow: active ? `0 6px 18px ${C.go}22` : `0 1px 3px ${C.ink}0A` }}>
                <div style={{ height: 100, position: "relative", overflow: "hidden" }}>
                  <FoodImg photo={PHOTOS[r.id] || r.photo} kind={FOOD_BY_ID[r.id] || "burger"} sc={sc} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%)" }} />
                  {r.menu && <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(200,140,20,0.95)", color: "#1a1200", borderRadius: 20, padding: "3px 9px", fontSize: 9, fontWeight: 800, letterSpacing: 0.5 }}>DEMO</div>}
                  <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.95)", borderRadius: 20, padding: "3px 9px", display: "flex", alignItems: "center", gap: 3, boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }}>
                    <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, color: r.match != null ? scoreColor(r.match / 20) : r.menu ? sc : "#6b7a71" }}>{r.match != null ? r.match : r.menu ? Math.round(r.score * 20) : r.score.toFixed(1)}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: r.match != null ? scoreColor(r.match / 20) : r.menu ? sc : "#6b7a71", textTransform: "uppercase" }}>{r.match != null || r.menu ? "match" : "★"}</span>
                  </div>
                  <div style={{ position: "absolute", left: 12, bottom: 9 }}>
                    <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, color: "#fff", lineHeight: 1, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.92)", marginTop: 2, textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{r.cuisine} · {r.lat != null && geo.status === "ok" ? `${distMi(geo.lat, geo.lng, r.lat, r.lng).toFixed(1)} mi` : r.eta}</div>
                    {r.why && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.85)", marginTop: 1, textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{r.why}</div>}
                  </div>
                </div>
                <div style={{ padding: 12 }}>
                  <button onClick={() => orderForMe(r)} disabled={loading && active} style={{ width: "100%", background: active ? C.go : C.ink, color: C.surface, border: "none", borderRadius: 10, padding: "10px 0", fontFamily: BODY, fontSize: 13.5, fontWeight: 600, cursor: "pointer", opacity: loading && active ? 0.6 : 1 }}>{loading && active ? "Thinking…" : "Order for me"}</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8, lineHeight: 1.4 }}>{venues[0] && !venues[0].menu ? "Live venues from Google Places. Menus aren’t public data anywhere — the AI proposes realistic goal-fit orders for each spot and estimates macros conservatively." : "Demo venues until GPS locks and a Google Places key is added in Settings → API keys."}</div>
      </div>

      <div style={{ marginTop: 6 }}>
        {error && <div style={{ background: C.avoidSoft, color: C.avoid, borderRadius: 12, padding: 14, fontSize: 13.5, marginTop: 12 }}>{error}</div>}
        {loading && !result && <div style={{ textAlign: "center", color: C.muted, fontSize: 13.5, padding: "22px 0" }}>Reading the menu against your {proteinLeft}g / {calLeft} cal…</div>}
        {result && result._menuSource && (
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: result._menuSource === "live" ? C.go : C.faint, marginBottom: 8 }}>
                  {result._menuSource === "live" ? `● RANKED FROM THEIR LIVE MENU${result._menuMethod === "pdf" ? " (PDF)" : result._menuMethod === "js" ? " (RENDERED SITE)" : ""}` : result._menuSource === "ai" ? "AI-PROPOSED TYPICAL ORDERS (no readable menu online)" : ""}
                </div>
              )}
              {result && (
          <div style={{ marginTop: 14 }}>
            {result.coachLine && (
              <div style={{ background: C.goSoft, border: `1px solid ${C.go}33`, borderRadius: 14, padding: "13px 15px", marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, color: C.go, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 3 }}>Coach</div>
                <div style={{ fontSize: 14.5, color: C.ink2, fontWeight: 500, lineHeight: 1.35 }}>{result.coachLine}</div>
              </div>
            )}
            {(result.picks || []).map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", background: C.surface, marginBottom: 10, border: `1px solid ${C.hair}`, borderLeft: `4px solid ${medalColor(i)}`, borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, overflow: "hidden", position: "relative", boxShadow: `0 1px 3px ${C.ink}22` }}>
                  <FoodImg photo={PHOTOS[selected] || ((venues.find((v) => v.id === selected) || {}).photo)} kind={FOOD_BY_ID[selected] || "bowl"} sc={scoreColor(4.5)} />
                  <div style={{ position: "absolute", top: -5, left: -5, width: 18, height: 18, borderRadius: 99, background: medalColor(i), color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: DISPLAY, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #fff", zIndex: 2 }}>{i + 1}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink, lineHeight: 1.2 }}>{p.name}</div><div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{p.why}</div></div>
                <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, color: C.go, fontVariantNumeric: "tabular-nums" }}>{p.protein}g</div><div style={{ fontSize: 11.5, color: C.faint }}>{p.calories} cal</div></div>
              </div>
            ))}
            {result.picks && result.picks[0] && (
              <>
                <button style={{ width: "100%", marginTop: 6, background: C.go, color: C.surface, border: "none", borderRadius: 13, padding: "15px 0", fontFamily: BODY, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Send "{result.picks[0].name.split("(")[0].trim()}" to a delivery app →</button>
                <div style={{ textAlign: "center", fontSize: 11, color: C.faint, marginTop: 7 }}>Hands off to DoorDash / Uber Eats / Grubhub with the order pre-built</div>
              </>
            )}
            {(result.avoid || []).length > 0 && (
              <div style={{ marginTop: 18 }}>
                {sectionTitle("Skip today", C.avoid)}
                {result.avoid.map((a, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: i < result.avoid.length - 1 ? `1px solid ${C.hair}` : "none" }}>
                    <span style={{ fontSize: 13.5, color: C.ink, fontWeight: 500 }}>{a.name}</span><span style={{ fontSize: 12.5, color: C.muted, textAlign: "right", maxWidth: "48%" }}>{a.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderToday = () => {
    const rings = [
      { label: "Protein", val: eaten.protein, goal: targets.protein, unit: "g", color: C.go },
      { label: "Calories", val: eaten.calories, goal: targets.calories, unit: "", color: C.blue },
      { label: "Carbs", val: eaten.carbs, goal: targets.carbs, unit: "g", color: C.caution },
      { label: "Fat", val: eaten.fat, goal: targets.fat, unit: "g", color: C.violet },
    ];
    return (
      <div style={{ padding: "18px 18px 12px" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, color: C.ink }}>Today</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
        <button onClick={() => { setScan({ status: "idle" }); setBarcode(""); setLogOpen(true); }} style={{ width: "100%", marginBottom: 16, background: C.ink, color: C.surface, border: "none", borderRadius: 13, padding: "13px 0", fontFamily: BODY, fontSize: 14.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" stroke={C.surface} strokeWidth="1.6" strokeLinecap="round" /></svg>
          Scan or log food
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {rings.map((r) => (
            <div key={r.label} style={{ background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 16, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
              {ring(Math.min(100, (r.val / r.goal) * 100), r.color, C)}
              <div><div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.3 }}>{r.label}</div><div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{r.val}{r.unit}</div><div style={{ fontSize: 11, color: C.faint }}>of {r.goal}{r.unit}</div></div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>{card(
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Water</div><div style={{ fontFamily: DISPLAY, fontWeight: 700, color: C.blue }}>{fmtVol(eaten.waterOz)} / {fmtVol(targets.waterOz)} {volU}</div></div>
            <div style={{ height: 10, background: C.surfaceAlt, borderRadius: 6, overflow: "hidden", marginTop: 8 }}><div style={{ width: `${Math.min(100, (eaten.waterOz / targets.waterOz) * 100)}%`, height: "100%", background: C.blue }} /></div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>{[8, 16, 24].map((oz) => (<button key={oz} onClick={() => setEaten((e) => ({ ...e, waterOz: e.waterOz + oz }))} style={chipBtn}>+{oz} oz</button>))}</div>
          </>)}</div>

        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          {card(<>{stat("Steps", eaten.steps.toLocaleString(), "")}<div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>goal 10,000</div></>, { flex: 1 })}
          {card(<>{stat("Exercise", eaten.exerciseCal, " cal")}<div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>burned today</div></>, { flex: 1 })}
        </div>

        <div style={{ marginTop: 14 }}>{card(
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Wearables</div><div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Apple Health · Garmin · Whoop · Fitbit</div></div>
            <div style={{ fontSize: 11.5, color: C.go, fontWeight: 600, border: `1px solid ${C.go}55`, borderRadius: 20, padding: "5px 11px" }}>Auto-syncing</div>
          </div>)}</div>
      </div>
    );
  };

  const renderBody = () => (
    <div style={{ padding: "18px 18px 12px" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, color: C.ink }}>Body</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Composition, trend &amp; progress</div>

      <div style={{ marginBottom: 14 }}>{card(
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 40, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{fmtWt(curWeight)}<span style={{ fontSize: 16, color: C.muted }}> {wtU}</span></div>
            <div style={{ textAlign: "right" }}><div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: C.go }}>−{lost.toFixed(1)} lbs</div><div style={{ fontSize: 11, color: C.faint }}>since start</div></div>
          </div>
          {weightLog.length > 1 ? lineChart(weightLog.map((w) => ({ label: fmtDate(w.date), value: +fmtWt(w.lbs) })), { color: C.go, goal: +fmtWt(goalWeight), goalLabel: `Goal ${fmtWt(goalWeight, 0)}` }, C) : <div style={{ padding: "26px 0", textAlign: "center", color: C.faint, fontSize: 13 }}>Log your first weight below to start the trend.</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <input type="number" value={newWeight} placeholder={`Log today's weight (${wtU})`} onChange={(e) => setNewWeight(e.target.value)} step="0.1" style={{ flex: 1, fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, color: C.ink, background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "11px 13px", outline: "none", boxSizing: "border-box" }} />
            <button onClick={logWeight} style={{ background: C.ink, color: C.surface, border: "none", borderRadius: 10, padding: "0 20px", fontFamily: BODY, fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Log</button>
          </div>
        </>)}</div>

      {/* Journey / phase — WHITE SPACE #3: the off-ramp nobody plans for */}
      <div style={{ marginBottom: 14 }}>{card(
        <>
          {sectionTitle("Your journey", C.violet)}
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {PHASES.map((p, i) => {
              const done = i < phaseIdx, cur = i === phaseIdx;
              return (
                <div key={p.key} style={{ flex: 1 }}>
                  <div style={{ height: 6, borderRadius: 3, background: done ? C.violet : cur ? C.violet : C.hair, opacity: done ? 0.45 : 1 }} />
                  <div style={{ fontSize: 9.5, marginTop: 5, fontWeight: cur ? 700 : 500, color: cur ? C.violet : C.faint, textAlign: "center", lineHeight: 1.15 }}>{p.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{ background: C.violet + "12", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.violet }}>{PHASES[phaseIdx].label}</div>
            <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 3, lineHeight: 1.45 }}>{PHASES[phaseIdx].focus}</div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <div style={{ flex: 1 }}><div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink }}>{Math.round(progress * 100)}%</div><div style={{ fontSize: 11, color: C.faint }}>to goal weight</div></div>
            <div style={{ flex: 1 }}><div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink }}>{leanMass ? leanMass.toFixed(0) : "—"}<span style={{ fontSize: 11, color: C.faint }}> lb</span></div><div style={{ fontSize: 11, color: C.faint }}>lean mass to protect".replace("XX","XX</div></div>
          </div>
          <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10, lineHeight: 1.4 }}>Most apps quit at "goal reached." The regain problem lives in maintenance &amp; coming off the drug — this is built to carry you through it.</div>
        </>)}</div>

      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        {card(<>{stat("BMI", bmi ? bmi.toFixed(1) : "—", "")}<div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{bmiBand(bmi)}</div></>, { flex: 1 })}
        {card(<>{stat("Body fat", bodyFat ? bodyFat.toFixed(1) : "—", "%")}<div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>Navy method</div></>, { flex: 1 })}
        {card(<>{stat("Lean", leanMass ? leanMass.toFixed(0) : "—", " lb")}<div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>fat-free mass</div></>, { flex: 1 })}
      </div>

      <div style={{ marginBottom: 14 }}>{card(
        <>
          {sectionTitle("Body stats")}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{["male", "female"].map((s) => (<button key={s} onClick={() => setBody({ ...body, sex: s })} style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${body.sex === s ? C.ink : C.hair}`, background: body.sex === s ? C.ink : C.surface, color: body.sex === s ? C.surface : C.muted, fontFamily: BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{s}</button>))}</div>
          <div style={{ display: "flex", gap: 10 }}>{numField(`Height (${isMetric ? "cm" : "in"})`, fmtLen(body.heightIn), (v) => setBody({ ...body, heightIn: parseLen(v) }))}{numField(`Neck (${isMetric ? "cm" : "in"})`, fmtLen(body.neck), (v) => setBody({ ...body, neck: parseLen(v) }))}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>{numField(`Waist (${isMetric ? "cm" : "in"})`, fmtLen(body.waist), (v) => setBody({ ...body, waist: parseLen(v) }))}{body.sex === "female" ? numField(`Hip (${isMetric ? "cm" : "in"})`, fmtLen(body.hip), (v) => setBody({ ...body, hip: parseLen(v) })) : numField(`Goal weight (${wtU})`, +fmtWt(goalWeight, 0), (v) => setGoalWeight(parseWt(v)))}</div>
        </>)}</div>

      {card(
        <>
          {sectionTitle("Progress photos")}
          {photos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 12px", color: C.faint, fontSize: 13, lineHeight: 1.5 }}>Add photos to build a visual transformation timeline.<br /><span style={{ fontSize: 11 }}>Stored privately on your node.</span></div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              {[["Before", compareA, setCompareA], ["After", compareB, setCompareB]].map(([lbl, idx, setIdx]) => (
                <div key={lbl} style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 5, fontWeight: 600 }}>{lbl}</div>
                  <div style={{ aspectRatio: "3/4", borderRadius: 12, overflow: "hidden", background: C.surfaceAlt, border: `1px solid ${C.hair}` }}>{photos[idx] && <img src={photos[idx].url} alt={lbl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
                  <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4, textAlign: "center" }}>{photos[idx] ? fmtDate(photos[idx].date) : ""}</div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 4 }}><button onClick={() => setIdx(Math.max(0, idx - 1))} style={arrowBtn}>‹</button><button onClick={() => setIdx(Math.min(photos.length - 1, idx + 1))} style={arrowBtn}>›</button></div>
                </div>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: "none" }} />
          <button onClick={() => fileRef.current && fileRef.current.click()} style={{ width: "100%", marginTop: 12, background: C.surfaceAlt, color: C.ink, border: `1px dashed ${C.faint}`, borderRadius: 11, padding: "12px 0", fontFamily: BODY, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>+ Add progress photo</button>
        </>)}
    </div>
  );

  const renderGlp = () => (
    <div style={{ padding: "18px 18px 12px" }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, color: C.ink }}>GLP-1</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Medication, titration &amp; side effects</div>

      <div style={{ marginBottom: 14 }}>{card(
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{Object.entries(MEDS).map(([k, m]) => (<button key={k} onClick={() => setGlp({ ...glp, med: k })} style={{ flex: 1, padding: "9px 4px", borderRadius: 9, border: `1px solid ${glp.med === k ? C.violet : C.hair}`, background: glp.med === k ? C.violet : C.surface, color: glp.med === k ? C.surface : C.muted, fontFamily: BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{m.label}</button>))}</div>
          {medObj.investigational ? (
            <div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                {donut(glp.dose || 0, Math.max(glp.dose || 1, 12), C.violet, `${glp.dose || 0}`, medObj.unit, C)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{medObj.label}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>{medObj.brand} · {medObj.cadence} · week {glp.weeksOn}</div>
                  <div style={{ marginTop: 8 }}>{numField("Your dose (mg)", glp.dose, (v) => setGlp({ ...glp, dose: +v }))}</div>
                </div>
              </div>
              <div style={{ background: C.cautionSoft, border: `1px solid ${C.caution}55`, borderRadius: 12, padding: 11 }}>
                <div style={{ fontSize: 11.5, color: C.ink2, lineHeight: 1.45 }}><b style={{ color: C.caution }}>Investigational (Phase 3, not FDA-approved).</b> Tracking only — enter whatever your trial or clinician directs. No schedule is suggested, by design.</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {donut(glp.dose, medObj.steps[medObj.steps.length - 1], C.violet, `${glp.dose}`, medObj.unit, C)}
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{medObj.label}</div><div style={{ fontSize: 11.5, color: C.muted }}>{medObj.brand} · {medObj.cadence}</div><div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Week {glp.weeksOn} · current dose {glp.dose} {medObj.unit}</div></div>
            </div>
          )}
        </>)}</div>

      {!medObj.investigational && (
        <div style={{ marginBottom: 14 }}>{card(
          <>
            {sectionTitle("Titration ladder")}
            <div style={{ display: "flex", gap: 6 }}>{medObj.steps.map((s) => { const done = s < glp.dose, cur = s === glp.dose; return (<button key={s} onClick={() => setGlp({ ...glp, dose: s, lastDoseChangeWk: 0 })} style={{ flex: 1, textAlign: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}><div style={{ height: 6, borderRadius: 3, background: done || cur ? C.violet : C.hair, opacity: done ? 0.5 : 1 }} /><div style={{ fontSize: 11, marginTop: 5, fontWeight: cur ? 700 : 500, color: cur ? C.violet : C.faint, fontVariantNumeric: "tabular-nums" }}>{s}</div></button>); })}</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.4 }}>{medObj.note}</div>
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 6 }}>Tap a step to record the dose your prescriber directed — confirm every change with them.</div>
          </>)}</div>
      )}

      <div style={{ marginBottom: 14 }}>{card(
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>Next injection</div><div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, color: C.ink }}>{daysToInjection <= 0 ? "Today" : `${daysToInjection} day${daysToInjection > 1 ? "s" : ""}`}</div><div style={{ fontSize: 12, color: C.faint }}>{nextInjection.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</div><div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{glp.lastInjection ? `Last dose: ${fmtDate(glp.lastInjection)}${glp.dose ? ` · ${glp.dose} mg` : ""} · week ${glp.weeksOn}` : "No dose logged yet — tap Log dose after your injection"}</div></div>
          <button onClick={logInjection} style={{ background: doseLogged ? C.go : C.violet, color: C.surface, border: "none", borderRadius: 11, padding: "12px 18px", fontFamily: BODY, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>{doseLogged ? "Logged ✓" : "Log dose"}</button>
        </div>)}</div>
      <div style={{ marginBottom: 14 }}>{card(<>
        <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Dose day{(prefs.injIntervalDays || 7) !== 7 ? <span style={{ textTransform: "none", color: C.faint }}> — applies to weekly schedules (yours is every {prefs.injIntervalDays} days)</span> : null}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["SU", "Su"], ["MO", "Mo"], ["TU", "Tu"], ["WE", "We"], ["TH", "Th"], ["FR", "Fr"], ["SA", "Sa"]].map(([k, l]) => (
            <button key={k} onClick={() => setGlp({ ...glp, injectionDay: k })}
              style={{ flex: 1, height: 38, borderRadius: 10, border: glp.injectionDay === k ? "none" : `1.5px solid ${C.hair}`, background: glp.injectionDay === k ? C.violet : "transparent", color: glp.injectionDay === k ? "#fff" : C.muted, fontFamily: BODY, fontWeight: 800, fontSize: 12.5, cursor: "pointer", opacity: (prefs.injIntervalDays || 7) !== 7 ? 0.45 : 1 }}>{l}</button>
          ))}
        </div>
      </>)}</div>
      <div style={{ marginBottom: 14 }}>{card(<DoseCalendar C={C} doseLog={glp.doseLog || []} dueISO={dueISO} />)}</div>

      <div style={{ marginBottom: 14 }}>{card(
        <>
          {sectionTitle("On-med nudges", C.violet)}
          {[
            proteinLeft > 0 ? [`${proteinLeft}g protein still needed`, "Appetite's suppressed — front-load a protein-dense pick.", C.go] : ["Protein goal hit", "Nice — muscle protected on a deficit.", C.go],
            eaten.waterOz < targets.waterOz ? [`Hydration low (${fmtVol(eaten.waterOz)}/${fmtVol(targets.waterOz)} ${volU})`, "GLP-1 raises dehydration risk. Keep sipping.", C.blue] : ["Hydration on track", "Good — helps with nausea and constipation.", C.blue],
            ["Fiber for GI comfort", "Constipation is common on-med. Aim 25g+ fiber.", C.caution],
          ].map(([t, d, col], i) => (
            <div key={i} style={{ display: "flex", gap: 11, padding: "10px 0", borderBottom: i < 2 ? `1px solid ${C.hair}` : "none" }}><div style={{ width: 4, borderRadius: 3, background: col, flexShrink: 0 }} /><div><div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{t}</div><div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{d}</div></div></div>
          ))}
        </>)}</div>

      <div style={{ marginBottom: 14 }}>{card(
        <>
          {sectionTitle("Projection")}
          <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <div><div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: C.ink }}>{recentRate.toFixed(1)} lb/wk</div><div style={{ fontSize: 11, color: C.faint }}>recent avg</div></div>
            <div><div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: C.go }}>{goalDate ? fmtDate(goalDate) : "—"}</div><div style={{ fontSize: 11, color: C.faint }}>{weeksToGoal ? `${goalWeight} lb in ~${weeksToGoal} wks` : "log more to project"}</div></div>
          </div>
          {goalDate && lineChart(projection(curWeight, goalWeight, recentRate), { color: C.violet, goal: goalWeight, goalLabel: `${goalWeight}`, dashed: true }, C)}
        </>)}</div>

      {fatCorrelation && (
        <div style={{ marginBottom: 14 }}>{card(
          <>
            {sectionTitle("Symptom ↔ food pattern", C.violet)}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, color: C.violet, fontVariantNumeric: "tabular-nums" }}>{fatCorrelation.hits}/{fatCorrelation.total}</span>
              <span style={{ fontSize: 13.5, color: C.ink2, fontWeight: 500, lineHeight: 1.3 }}>of your nausea flares<br />followed a high-fat meal</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 10, lineHeight: 1.45 }}>
              Those meals averaged <b style={{ color: C.ink }}>{fatCorrelation.avgFat}g fat</b>. High-fat food is a known GLP-1 nausea trigger — so today's ordering steers you off it automatically.
            </div>
            <div style={{ marginTop: 12 }}>
              {nauseaWithMeal.slice(0, 3).map((x, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i > 0 ? `1px solid ${C.hair}` : "none" }}>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{x.meal.name}</div><div style={{ fontSize: 11, color: C.faint }}>{fmtDate(x.meal.date)} · nausea followed</div></div>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: x.meal.fat >= 30 ? C.avoid : C.go, background: x.meal.fat >= 30 ? C.avoidSoft : C.goSoft, borderRadius: 20, padding: "3px 10px" }}>{x.meal.fat}g fat</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10 }}>Correlation, not proof — the more you log, the sharper this gets. No competitor connects symptoms to meals.</div>
          </>)}</div>
      )}

      {card(
        <>
          {sectionTitle("Side-effect journal")}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <select value={seSymptom} onChange={(e) => setSeSymptom(e.target.value)} style={selectStyle}>{["Nausea", "Fatigue", "Constipation", "Diarrhea", "Heartburn", "Injection site", "Headache", "Dizziness"].map((s) => <option key={s}>{s}</option>)}</select>
            <select value={seSeverity} onChange={(e) => setSeSeverity(+e.target.value)} style={{ ...selectStyle, flex: "0 0 96px" }}>{[1, 2, 3].map((n) => <option key={n} value={n}>{["Mild", "Moderate", "Severe"][n - 1]}</option>)}</select>
            <button onClick={addSideEffect} style={{ background: C.ink, color: C.surface, border: "none", borderRadius: 10, padding: "0 16px", fontFamily: BODY, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Log</button>
          </div>
          {[...glp.sideEffects].reverse().map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.hair}` }}>
              <div><span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{s.symptom}</span><span style={{ fontSize: 12, color: C.faint, marginLeft: 8 }}>{fmtDate(s.date)}</span></div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: [C.go, C.caution, C.avoid][s.severity - 1], background: [C.goSoft, C.cautionSoft, C.avoidSoft][s.severity - 1], borderRadius: 20, padding: "3px 10px" }}>{["Mild", "Moderate", "Severe"][s.severity - 1]}</span>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10, lineHeight: 1.4 }}>Not medical advice. Severe or persistent symptoms — contact your prescriber. This log is designed to export for clinic visits.</div>
        </>)}
    </div>
  );

  const renderCoach = () => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "18px 18px 8px" }}><div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, color: C.ink }}>Coach</div><div style={{ fontSize: 13, color: C.muted }}>Knows your macros, weight &amp; meds — live</div></div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
        {coachMsgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
            <div style={{ maxWidth: "82%", padding: "11px 14px", borderRadius: 16, fontSize: 14, lineHeight: 1.45, background: m.role === "user" ? C.ink : C.surface, color: m.role === "user" ? C.surface : C.ink2, border: m.role === "user" ? "none" : `1px solid ${C.hair}`, borderBottomRightRadius: m.role === "user" ? 4 : 16, borderBottomLeftRadius: m.role === "user" ? 16 : 4 }}>{m.text}</div>
          </div>
        ))}
        {coachLoading && <div style={{ fontSize: 13, color: C.faint, padding: "4px 2px" }}>Coach is thinking…</div>}
      </div>
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.hair}`, background: C.surfaceAlt }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, overflowX: "auto" }}>{["Am I on pace?", "No appetite today — what do I eat?", "Cheat meal — recover how?"].map((q) => (<button key={q} onClick={() => setCoachInput(q)} style={{ ...chipBtn, whiteSpace: "nowrap", flexShrink: 0, fontSize: 11.5 }}>{q}</button>))}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={coachInput} onChange={(e) => setCoachInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendCoach(); }} placeholder="Ask your coach…" style={{ flex: 1, fontFamily: BODY, fontSize: 14, color: C.ink, background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 22, padding: "11px 16px", outline: "none" }} />
          <button onClick={sendCoach} disabled={coachLoading} style={{ background: C.go, color: C.surface, border: "none", borderRadius: 22, width: 46, fontSize: 18, cursor: "pointer", opacity: coachLoading ? 0.6 : 1 }}>↑</button>
        </div>
      </div>
    </div>
  );

  const TABS = [
    { id: "now", label: "Now", icon: iconNow }, { id: "today", label: "Today", icon: iconToday },
    { id: "body", label: "Body", icon: iconBody }, { id: "glp", label: "GLP-1", icon: iconMed },
    { id: "coach", label: "Coach", icon: iconCoach },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", justifyContent: "center", fontFamily: BODY }}>
      <style>{FONTS}{`*{-webkit-tap-highlight-color:transparent;box-sizing:border-box;} input:focus,select:focus{border-color:${C.go}!important;} ::-webkit-scrollbar{display:none;}`}</style>
      <div style={{ width: "100%", maxWidth: 430, background: C.bg, minHeight: "100vh", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ height: "calc(52px + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: 16, paddingRight: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.hair}`, background: C.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="26" height="26" viewBox="0 0 48 48" fill="none">
              <g fill={C.go}><circle cx="19" cy="13" r="5" /><circle cx="26" cy="9.5" r="6.5" /><circle cx="32" cy="13.5" r="5" /><rect x="16" y="12.5" width="17" height="5.5" rx="2.75" /></g>
              <path d="M22.80 35.00 C21.04 32.80 18.40 31.26 18.40 28.20 L18.40 24.80 L19.45 19.80 L20.50 24.80 L20.50 28.20 L21.43 28.20 L21.43 24.80 L22.48 19.80 L23.53 24.80 L23.53 28.20 L24.47 28.20 L24.47 24.80 L25.52 19.80 L26.57 24.80 L26.57 28.20 L27.50 28.20 L27.50 24.80 L28.55 19.80 L29.60 24.80 L29.60 28.20 C29.60 31.26 26.96 32.80 25.20 35.00 L26.00 45.80 A2.00 2.00 0 0 1 22.00 45.80 Z" fill={C.go} />
            </svg>
            <span style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, letterSpacing: -0.3 }}>ForkCaster</span>
            {appVer && <span style={{ fontSize: 10, color: C.faint, fontWeight: 600, marginTop: 4 }}>v{appVer}</span>}
          </div>
          <button onClick={() => setSettingsOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke={C.muted} strokeWidth="2" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 1h-4l-.5 2.4a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 23h4l.5-2.4a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke={C.muted} strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 76 }}>
          {tab === "now" && renderNow()}
          {tab === "today" && renderToday()}
          {tab === "body" && renderBody()}
          {tab === "glp" && renderGlp()}
          {tab === "coach" && <div style={{ height: "calc(100vh - 128px)" }}>{renderCoach()}</div>}
        </div>

        {/* Bottom nav */}
        <div style={{ position: "fixed", bottom: 0, width: "100%", maxWidth: 430, background: C.dark ? "rgba(24,32,41,0.94)" : "rgba(255,255,255,0.94)", backdropFilter: "blur(12px)", borderTop: `1px solid ${C.hair}`, display: "flex", padding: "8px 6px calc(10px + env(safe-area-inset-bottom, 0px))" }}>
          {TABS.map((t) => { const on = tab === t.id; return (<button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 0" }}>{t.icon(on ? C.go : C.faint)}<span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, color: on ? C.go : C.faint }}>{t.label}</span></button>); })}
        </div>

        {/* Scan / log food sheet */}
        {logOpen && (
          <div onClick={() => setLogOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.surface, borderRadius: "22px 22px 0 0", padding: "20px 20px 28px", maxHeight: "82vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink }}>Scan or log food</div>
                <button onClick={() => { stopCam(); setLogOpen(false); }} style={{ background: C.surfaceAlt, border: "none", width: 30, height: 30, borderRadius: 99, color: C.muted, fontSize: 15, cursor: "pointer" }}>✕</button>
              </div>

              {/* live camera scanner */}
              <video ref={camVideoRef} autoPlay playsInline muted style={{ position: "absolute", width: 2, height: 2, opacity: 0, pointerEvents: "none" }} />
              {camOn ? (
                <div style={{ borderRadius: 14, overflow: "hidden", position: "relative", marginBottom: 14, background: "#000" }}>
                  <canvas ref={camCanvasRef} style={{ width: "100%", height: 240, objectFit: "cover", display: "block", background: "#000" }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ width: "72%", height: 90, border: "2.5px solid rgba(99,212,140,0.95)", borderRadius: 12, boxShadow: "0 0 0 2000px rgba(0,0,0,0.35)" }} />
                  </div>
                  <button onClick={stopCam} style={{ position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 20, padding: "6px 13px", fontFamily: BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Stop</button>
                  <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.9)", fontSize: 11.5, fontWeight: 600, textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>{camHint ? "Struggling? More light, hold 4–8 inches away, keep steady — or type the number below" : "Center the barcode in the box"}</div>
                </div>
              ) : (
                <button onClick={startCam} style={{ width: "100%", borderRadius: 14, border: `1.5px dashed ${C.go}88`, background: C.goSoft, padding: "22px 16px", textAlign: "center", marginBottom: 14, cursor: "pointer" }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style={{ margin: "0 auto 8px", display: "block" }}><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" stroke={C.go} strokeWidth="1.8" strokeLinecap="round" /></svg>
                  <div style={{ fontFamily: BODY, fontSize: 14.5, fontWeight: 700, color: C.go }}>Scan with camera</div>
                  <div style={{ fontFamily: BODY, fontSize: 11.5, color: C.muted, marginTop: 3 }}>Point at any food barcode — or type it below</div>
                </button>
              )}
              {camErr && <div style={{ fontSize: 12, color: C.avoid, marginTop: -6, marginBottom: 10 }}>{camErr}</div>}

              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") lookupBarcode(barcode); }} placeholder="Barcode number" inputMode="numeric"
                  style={{ flex: 1, fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, color: C.ink, background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "11px 13px", outline: "none", boxSizing: "border-box" }} />
                <button onClick={() => lookupBarcode(barcode)} disabled={scan.status === "loading"} style={{ background: C.go, color: C.surface, border: "none", borderRadius: 10, padding: "0 18px", fontFamily: BODY, fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: scan.status === "loading" ? 0.6 : 1 }}>{scan.status === "loading" ? "…" : "Look up"}</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}>
                <div style={{ flex: 1, height: 1, background: C.hair }} /><span style={{ fontSize: 11, color: C.faint }}>or</span><div style={{ flex: 1, height: 1, background: C.hair }} />
              </div>
              <input ref={photoRef} type="file" accept="image/*" capture="environment" onChange={estimateFromPhoto} style={{ display: "none" }} />
              <button onClick={() => photoRef.current && photoRef.current.click()} disabled={scan.status === "loading"} style={{ width: "100%", marginBottom: 16, background: C.violet, color: C.surface, border: "none", borderRadius: 12, padding: "13px 0", fontFamily: BODY, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, opacity: scan.status === "loading" ? 0.6 : 1 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" stroke={C.surface} strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.2" stroke={C.surface} strokeWidth="1.8" /></svg>
                {scan.status === "loading" ? "Analyzing…" : "Estimate a plate from photo (AI)"}
              </button>

              {scan.status === "found" && (
                <div ref={resultRef} style={{ background: C.goSoft, border: `1px solid ${C.go}44`, borderRadius: 14, padding: 15, marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{scan.food.name}</div>
                  {scan.food.brand && <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{scan.food.brand}</div>}
                  <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                    {[["Cal", scan.food.calories], ["Protein", `${scan.food.protein}g`], ["Carbs", `${scan.food.carbs}g`], ["Fat", `${scan.food.fat}g`], ["Fiber", `${scan.food.fiber || 0}g`]].map(([l, v]) => (
                      <div key={l}><div style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink }}>{v}</div><div style={{ fontSize: 10.5, color: C.faint }}>{l}</div></div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8 }}>per {scan.food.basis} · source: {scan.food.source || "Open Food Facts"}</div>
                  <button onClick={addLoggedFood} style={{ width: "100%", marginTop: 12, background: C.go, color: C.surface, border: "none", borderRadius: 11, padding: "13px 0", fontFamily: BODY, fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Add to today →</button>
                </div>
              )}
              {scan.status === "miss" && <div style={{ fontSize: 13, color: C.muted, padding: "4px 2px" }}>Not found in Open Food Facts, USDA, or FatSecret. Try another barcode, or use the AI photo estimate below.</div>}
              {scan.status === "error" && <div style={{ fontSize: 13, color: C.avoid, padding: "4px 2px" }}>Couldn't reach your node — check the connection (or log into the Umbrel dashboard once) and retry.</div>}
            </div>
          </div>
        )}

        {/* Settings sheet */}
        {settingsOpen && (
          <div onClick={() => setSettingsOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.surface, borderRadius: "22px 22px 0 0", padding: "20px 20px 28px", maxHeight: "82vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink }}>Settings</div>
                <button onClick={() => setSettingsOpen(false)} style={{ background: C.surfaceAlt, border: "none", width: 30, height: 30, borderRadius: 99, color: C.muted, fontSize: 15, cursor: "pointer" }}>✕</button>
              </div>

              {sectionTitle("Theme")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 22 }}>
                {Object.entries(THEMES).map(([k, t]) => {
                  const on = theme === k;
                  return (
                    <button key={k} onClick={() => setTheme(k)} style={{ padding: 0, borderRadius: 12, overflow: "hidden", cursor: "pointer", border: `2px solid ${on ? C.go : C.hair}`, background: t.surface }}>
                      <div style={{ height: 42, background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <span style={{ width: 14, height: 14, borderRadius: 99, background: t.go }} />
                        <span style={{ width: 10, height: 10, borderRadius: 99, background: t.violet }} />
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: t.caution }} />
                      </div>
                      <div style={{ padding: "7px 0", fontSize: 12, fontWeight: on ? 700 : 500, color: on ? C.go : C.muted, textAlign: "center", background: C.surface }}>{t.name}</div>
                    </button>
                  );
                })}
              </div>

              {sectionTitle("Goal mode")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
                {Object.entries(MODES).map(([k, m]) => {
                  const on = mode === k;
                  return (
                    <button key={k} onClick={() => pickMode(k)} style={{ textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${on ? C.go : C.hair}`, background: on ? C.goSoft : C.surface }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: on ? C.go : C.ink }}>{m.label}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{m.targets.protein}g P · {m.targets.calories} cal</div>
                    </button>
                  );
                })}
              </div>

              {sectionTitle("Allergies")}
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: -4, marginBottom: 10, lineHeight: 1.4 }}>Tap to flag. ForkCaster will never suggest a food that contains these.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {ALLERGENS.map((a) => {
                  const on = allergies.includes(a);
                  return (
                    <button key={a} onClick={() => toggleIn(allergies, setAllergies, a)} style={{ padding: "8px 13px", borderRadius: 20, cursor: "pointer", fontFamily: BODY, fontSize: 13, fontWeight: 600, border: `1.5px solid ${on ? C.avoid : C.hair}`, background: on ? C.avoid : C.surface, color: on ? "#fff" : C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                      {on && <span style={{ fontSize: 12 }}>✕</span>}{a}
                    </button>
                  );
                })}
              </div>

              {sectionTitle("Diet")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {DIETS.map((d) => {
                  const on = diets.includes(d);
                  return (
                    <button key={d} onClick={() => toggleIn(diets, setDiets, d)} style={{ padding: "8px 13px", borderRadius: 20, cursor: "pointer", fontFamily: BODY, fontSize: 13, fontWeight: 600, border: `1.5px solid ${on ? C.go : C.hair}`, background: on ? C.go : C.surface, color: on ? "#fff" : C.muted }}>{d}</button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 12, lineHeight: 1.4 }}>Switching goal mode resets today's targets to that preset. Allergy filtering applies to every meal suggestion and the coach.</div>

              <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.hair}` }}>
                {sectionTitle("Preferences")}
                {(() => {
                  const row = (label, control) => (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.hair}` }}>
                      <div style={{ fontSize: 13, color: C.ink2, paddingRight: 10 }}>{label}</div>
                      <div style={{ flexShrink: 0 }}>{control}</div>
                    </div>
                  );
                  const sel = (val, opts, on) => (
                    <select value={val} onChange={(e) => on(e.target.value)} style={{ background: C.surfaceAlt, color: C.ink, border: `1px solid ${C.hair}`, borderRadius: 8, padding: "7px 9px", fontFamily: BODY, fontSize: 12.5 }}>
                      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  );
                  const num = (val, on, w = 64, step = 1) => <NumFieldC value={val} onChange={on} C={C} w={w} step={step} bare />;
                  const P = prefs, set = (k) => (v) => setPrefs({ ...prefs, [k]: v });
                  return (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 0.8, textTransform: "uppercase", margin: "6px 0 2px" }}>Day & units</div>
                      {row("Day resets at", sel(String(P.rolloverHour), Array.from({ length: 24 }, (_, h) => [String(h), h === 0 ? "Midnight" : h < 12 ? `${h} AM` : h === 12 ? "Noon" : `${h - 12} PM`]), (v) => set("rolloverHour")(+v)))}
                      {row("Units", sel(P.units, [["imperial", "lbs · oz · in"], ["metric", "kg · ml · cm"]], set("units")))}
                      {row("Target pace (lb/week)", num(P.paceLbPerWeek, set("paceLbPerWeek"), 64, 0.1))}
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 0.8, textTransform: "uppercase", margin: "14px 0 2px" }}>GLP-1</div>
                      {row("Injection every (days)", num(P.injIntervalDays, set("injIntervalDays")))}
                      {row("Per-meal protein floor (g)", num(P.proteinFloor, set("proteinFloor")))}
                      {row("Nausea sensitivity", sel(P.nauseaSensitivity, [["low", "Low"], ["normal", "Normal"], ["high", "High"]], set("nauseaSensitivity")))}
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 0.8, textTransform: "uppercase", margin: "14px 0 2px" }}>Map & nearby</div>
                      {row("Search radius (mi)", num(P.searchRadiusMi, set("searchRadiusMi"), 64, 0.5))}
                      {row("Max venues", num(P.venueCount, set("venueCount")))}
                      {row("Day map starts", sel(String(P.dayStart), Array.from({ length: 13 }, (_, h) => [String(h + 4), `${h + 4 <= 12 ? h + 4 : h - 8} ${h + 4 < 12 ? "AM" : "PM"}`]), (v) => set("dayStart")(+v)))}
                      {row("Night map starts", sel(String(P.dayEnd), Array.from({ length: 10 }, (_, h) => [String(h + 15), `${h + 3} PM`]), (v) => set("dayEnd")(+v)))}
                      {row("Default zoom", num(P.mapZoom, set("mapZoom")))}
                      {row("Re-search after moving (mi)", num(P.requeryMi, set("requeryMi"), 64, 0.05))}
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 0.8, textTransform: "uppercase", margin: "14px 0 2px" }}>AI</div>
                      {row("Model", sel(P.aiModel, [["claude-fable-5", "Fable 5 (most capable)"], ["claude-opus-4-8", "Opus (max accuracy)"], ["claude-sonnet-4-6", "Sonnet (smart)"], ["claude-haiku-4-5-20251001", "Haiku (fast/cheap)"]], set("aiModel")))}
                      {row("Coach style", sel(P.coachStyle, [["concise", "Concise"], ["balanced", "Balanced"], ["detailed", "Detailed"], ["tough-love", "Tough love"]], set("coachStyle")))}
                      {row("Score refresh (hours)", num(P.rankCacheHours, set("rankCacheHours"), 64, 0.5))}
                      <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.4 }}>Changes save automatically and apply immediately. Haiku costs ~10x less per coach chat and venue ranking.</div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.hair}` }}>
                {sectionTitle("API keys")}
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: -4, marginBottom: 10, lineHeight: 1.45 }}>
                  Saved to secrets.json on your node — never leaves your hardware. Anthropic: <b style={{ color: keyStatus && keyStatus.anthropic ? C.go : C.avoid }}>{keyStatus ? (keyStatus.anthropic ? `set ${keyStatus.anthropicTail}` : "not set") : "…"}</b> · Google Places: <b style={{ color: keyStatus && keyStatus.places ? C.go : C.avoid }}>{keyStatus ? (keyStatus.places ? `set ${keyStatus.placesTail}` : "not set") : "…"}</b> · FatSecret: <b style={{ color: keyStatus && keyStatus.fatsecret ? C.go : C.avoid }}>{keyStatus ? (keyStatus.fatsecret ? "set" : "not set") : "…"}</b>
                </div>
                <input value={keyIn.a} onChange={(e) => setKeyIn({ ...keyIn, a: e.target.value })} placeholder="Anthropic key (sk-ant-…)" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ width: "100%", boxSizing: "border-box", background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "11px 12px", color: C.ink, fontFamily: BODY, fontSize: 13, marginBottom: 8 }} />
                <input value={keyIn.g} onChange={(e) => setKeyIn({ ...keyIn, g: e.target.value })} placeholder="Google Places key (AIza…) — optional" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ width: "100%", boxSizing: "border-box", background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "11px 12px", color: C.ink, fontFamily: BODY, fontSize: 13, marginBottom: 10 }} />
                <input value={keyIn.fi} onChange={(e) => setKeyIn({ ...keyIn, fi: e.target.value })} placeholder="FatSecret Client ID — optional" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ width: "100%", boxSizing: "border-box", background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "11px 12px", color: C.ink, fontFamily: BODY, fontSize: 13, marginBottom: 8 }} />
                <input value={keyIn.fs} onChange={(e) => setKeyIn({ ...keyIn, fs: e.target.value })} placeholder="FatSecret Client Secret — optional" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ width: "100%", boxSizing: "border-box", background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "11px 12px", color: C.ink, fontFamily: BODY, fontSize: 13, marginBottom: 10 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveKeys} disabled={!keyIn.a.trim() && !keyIn.g.trim() && !keyIn.fi.trim() && !keyIn.fs.trim()} style={{ flex: 1, background: C.go, color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontFamily: BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: !keyIn.a.trim() && !keyIn.g.trim() && !keyIn.fi.trim() && !keyIn.fs.trim() ? 0.5 : 1 }}>Save keys</button>
                  <button onClick={testAiKey} style={{ flex: 1, background: "none", color: C.ink, border: `1.5px solid ${C.hair}`, borderRadius: 10, padding: "11px 0", fontFamily: BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Test AI key</button>
                </div>
                {keyMsg && <div style={{ fontSize: 12, color: keyMsg.includes("✓") ? C.go : C.muted, marginTop: 8 }}>{keyMsg}</div>}
              </div>

              <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.hair}` }}>
                {sectionTitle("Danger zone")}
                <button onClick={async () => { if (window.confirm("Reset ALL ForkCaster data on your node? Weight, meals, GLP-1 logs, and settings will be wiped.")) { hydrated.current = false; try { await fetch("/api/state", { method: "DELETE" }); } catch {} window.location.reload(); } }} style={{ width: "100%", background: "none", color: C.avoid, border: `1.5px solid ${C.avoid}66`, borderRadius: 11, padding: "12px 0", fontFamily: BODY, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Reset all data — start fresh</button>
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: C.faint, marginTop: 18 }}>ForkCaster {appVer ? `v${appVer}` : ""}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Month calendar for dose adherence: syringe on logged days, DUE ring on the scheduled day */
function DoseCalendar({ C, doseLog, dueISO }) {
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const todayIso = new Date().toLocaleDateString("sv-SE");
  const first = new Date(ym.y, ym.m, 1);
  const startDow = first.getDay();
  const dim = new Date(ym.y, ym.m + 1, 0).getDate();
  const monthName = first.toLocaleDateString([], { month: "long", year: "numeric" });
  const iso = (day) => `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const logged = (i) => (doseLog || []).find((d) => d.date === i);
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  const syr = (color, s = 11) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m18 2 4 4" /><path d="m17 7 3-3" /><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5" /><path d="m9 11 4 4" /><path d="m5 19-3 3" /><path d="m14 4 6 6" /></svg>
  );
  const navB = { background: "none", border: `1px solid ${C.hair}`, borderRadius: 8, color: C.ink2, width: 28, height: 28, fontSize: 15, cursor: "pointer", lineHeight: 1 };
  return (
    <div>
      {dueISO === todayIso && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.violet + "22", border: `1px solid ${C.violet}55`, borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
          {syr(C.violet, 15)}
          <span style={{ fontFamily: BODY, fontSize: 13, fontWeight: 700, color: C.violet }}>Dose due today — log it once injected</span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={navB}>‹</button>
        <div style={{ fontFamily: BODY, fontSize: 12.5, fontWeight: 700, color: C.ink2 }}>{monthName}</div>
        <button onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={navB}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 9, fontWeight: 700, color: C.faint }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", rowGap: 4 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const di = iso(d), lg = logged(di), due = di === dueISO, today = di === todayIso;
          return (
            <div key={i} style={{ height: 36, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, borderRadius: 9, margin: "0 2px", border: due ? `1.5px dashed ${C.violet}` : today ? `1.5px solid ${C.go}88` : "1.5px solid transparent", background: lg ? C.goSoft : "transparent" }}>
              <span style={{ fontSize: 10.5, fontWeight: today || due || lg ? 800 : 500, color: lg ? C.go : due ? C.violet : today ? C.ink : C.muted }}>{d}</span>
              {lg ? syr(C.go) : due ? <span style={{ fontSize: 7.5, color: C.violet, fontWeight: 800, letterSpacing: 0.5 }}>DUE</span> : <span style={{ height: 11 }} />}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10, fontSize: 10, color: C.faint, alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>{syr(C.go, 10)} dose logged</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, border: `1.5px dashed ${C.violet}`, display: "inline-block" }} /> due</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, border: `1.5px solid ${C.go}88`, display: "inline-block" }} /> today</span>
      </div>
    </div>
  );
}
/* Number input that lets you clear it while typing; commits valid numbers, restores on blur */
function NumFieldC({ label, value, onChange, C, DISPLAY, w, step, bare }) {
  const [draft, setDraft] = useState(value == null || Number.isNaN(value) ? "" : String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setDraft(value == null || Number.isNaN(value) ? "" : String(value)); }, [value, focus]);
  const input = (
    <input type="text" inputMode="decimal" value={draft} step={step}
      onFocus={() => setFocus(true)}
      onBlur={() => { setFocus(false); if (draft === "" || isNaN(parseFloat(draft))) setDraft(value == null ? "" : String(value)); }}
      onChange={(e) => { const r = e.target.value; setDraft(r); const n = parseFloat(r); if (r !== "" && !isNaN(n)) onChange(n); }}
      style={bare
        ? { width: w || 64, background: C.surfaceAlt, color: C.ink, border: `1px solid ${C.hair}`, borderRadius: 8, padding: "7px 9px", fontFamily: "inherit", fontSize: 12.5, boxSizing: "border-box" }
        : { width: "100%", boxSizing: "border-box", fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: C.ink, background: C.surfaceAlt, border: `1px solid ${C.hair}`, borderRadius: 10, padding: "9px 11px", outline: "none" }} />
  );
  if (bare) return input;
  return (<div style={{ flex: 1 }}><div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{label}</div>{input}</div>);
}
/* ── pure helpers (no theme) ── */
function bmiBand(b) { if (!b) return ""; if (b < 18.5) return "underweight"; if (b < 25) return "healthy"; if (b < 30) return "overweight"; return "obese"; }
function calcBodyFat(body, weight) {
  const { sex, heightIn, neck, waist, hip } = body;
  if (!heightIn || !neck || !waist) return 0;
  // Navy method constants expect CENTIMETERS; inputs are inches
  const CM = 2.54;
  const h = heightIn * CM, n = neck * CM, w = waist * CM, hp = (hip || 0) * CM;
  try {
    if (sex === "male") { if (w - n <= 0) return 0; return 495 / (1.0324 - 0.19077 * log10(w - n) + 0.15456 * log10(h)) - 450; }
    if (w + hp - n <= 0) return 0;
    return 495 / (1.29579 - 0.35004 * log10(w + hp - n) + 0.221 * log10(h)) - 450;
  } catch { return 0; }
}
function weeklyRate(log) {
  if (log.length < 2) return 0;
  const first = log[Math.max(0, log.length - 5)], last = log[log.length - 1];
  const days = (new Date(last.date) - new Date(first.date)) / 86400000;
  if (days <= 0) return 0;
  return Math.max(0, ((first.lbs - last.lbs) / days) * 7);
}
function projection(cur, goal, rate) {
  const pts = []; let w = cur; const r = Math.max(0.3, Math.min(rate, 2));
  for (let wk = 0; wk <= 12 && w > goal - 1; wk++) { pts.push({ label: `w${wk}`, value: +Math.max(goal, w).toFixed(1) }); w -= r; }
  return pts;
}
function nextDow(dow) {
  const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const target = map[dow]; const d = new Date(); d.setHours(0, 0, 0, 0);
  let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
  const x = new Date(d); x.setDate(x.getDate() + add); return x;
}
function geoLabel(geo, timeStr) {
  if (geo.status === "ok") return `${geo.manual && !geo.live ? (typeof window !== "undefined" && !window.isSecureContext ? "Pinned (GPS needs HTTPS)" : "Pinned · tap for GPS") : "Live GPS"} ${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)} · ${timeStr}`;
  if (geo.status === "locating") return `Locating… · ${timeStr}`;
  if (geo.status === "denied") return `GPS ${geo.code === 1 ? "denied by iOS — allow in Settings › Apps › ForkCaster (or Safari Websites) · tap for manual entry" : geo.code === 3 ? "timed out · tap to retry" : "unavailable · tap for manual entry"} · ${timeStr}`;
  if (geo.status === "unavailable") return `Downtown (sample) · ${timeStr}`;
  return `Right now · ${timeStr}`;
}

/* ── charts (take palette C) ── */
function lineChart(data, opts, C) {
  if (!data || data.length < 2) return null;
  const w = 360, h = 120, pad = 10, padL = 4, padR = 4;
  const vals = data.map((d) => d.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (opts.goal != null) { min = Math.min(min, opts.goal); max = Math.max(max, opts.goal); }
  const spanRaw = max - min || 1; min -= spanRaw * 0.12; max += spanRaw * 0.12;
  const X = (i) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const Y = (v) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
  const pts = data.map((d, i) => `${X(i)},${Y(d.value)}`).join(" ");
  const goalY = opts.goal != null ? Y(opts.goal) : null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 120, marginTop: 12, display: "block" }}>
      {goalY != null && <line x1={padL} y1={goalY} x2={w - padR} y2={goalY} stroke={C.faint} strokeWidth="1" strokeDasharray="4 4" />}
      {goalY != null && <text x={w - padR} y={goalY - 5} textAnchor="end" fontSize="10" fill={C.faint} fontFamily={BODY}>{opts.goalLabel}</text>}
      <polyline points={pts} fill="none" stroke={opts.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={opts.dashed ? "5 4" : "none"} />
      {data.map((d, i) => <circle key={i} cx={X(i)} cy={Y(d.value)} r={i === data.length - 1 ? 4 : 2.5} fill={opts.color} />)}
    </svg>
  );
}
function ring(pct, color, C) {
  const r = 20, circ = 2 * Math.PI * r, off = circ * (1 - Math.min(100, pct) / 100);
  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke={C.hair} strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 26 26)" />
      <text x="26" y="30" textAnchor="middle" fontSize="13" fontWeight="700" fill={color} fontFamily={DISPLAY}>{Math.round(pct)}</text>
    </svg>
  );
}
function donut(val, max, color, big, unit, C) {
  const r = 26, circ = 2 * Math.PI * r, off = circ * (1 - Math.min(1, val / max));
  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r={r} fill="none" stroke={C.hair} strokeWidth="6" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 36 36)" />
      <text x="36" y="34" textAnchor="middle" fontSize="17" fontWeight="700" fill={C.ink} fontFamily={DISPLAY}>{big}</text>
      <text x="36" y="47" textAnchor="middle" fontSize="9" fill={C.muted} fontFamily={BODY}>{unit}</text>
    </svg>
  );
}

/* ── real embedded photo with graceful fallback to illustration ── */
function FoodImg({ photo, kind, sc }) {
  const [ok, setOk] = useState(true);
  if (photo && ok) return (<img src={photo} alt="" onError={() => setOk(false)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />);
  return (<div style={{ position: "absolute", inset: 0, background: `linear-gradient(140deg, ${sc}, ${sc}BB)`, display: "flex", alignItems: "center", justifyContent: "center" }}>{foodGlyph(kind, "#FFFFFF", 62)}</div>);
}

/* ── interactive map: Leaflet + HD tiles, drag/pinch/zoom, search-this-area ── */
const MAP_TILES = {
  day:   { tl: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", attr: "&copy; OpenStreetMap &copy; CARTO", dark: false },
  night: { tl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attr: "&copy; OpenStreetMap &copy; CARTO", dark: true },
  sat:   { tl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "&copy; Esri", dark: true },
};
const VENUE_OFFSETS = [[0.0038, -0.0062], [0.0042, 0.0058], [-0.0012, -0.0008], [-0.0035, 0.0052], [-0.0041, -0.0047]];
const YOU_PIN_SVG = `<svg width="30" height="37" viewBox="0 0 48 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 2 C13 2 4.2 10.8 4.2 21.8 C4.2 36 24 57 24 57 C24 57 43.8 36 43.8 21.8 C43.8 10.8 35 2 24 2 Z" fill="#22B573" stroke="#fff" stroke-width="2.5"/><g transform="translate(10.2,8.6) scale(0.575)"><g fill="#fff"><circle cx="19" cy="13" r="5"/><circle cx="26" cy="9.5" r="6.5"/><circle cx="32" cy="13.5" r="5"/><rect x="16" y="12.5" width="17" height="5.5" rx="2.75"/></g><path d="M22.80 35.00 C21.04 32.80 18.40 31.26 18.40 28.20 L18.40 24.80 L19.45 19.80 L20.50 24.80 L20.50 28.20 L21.43 28.20 L21.43 24.80 L22.48 19.80 L23.53 24.80 L23.53 28.20 L24.47 28.20 L24.47 24.80 L25.52 19.80 L26.57 24.80 L26.57 28.20 L27.50 28.20 L27.50 24.80 L28.55 19.80 L29.60 24.80 L29.60 28.20 C29.60 31.26 26.96 32.80 25.20 35.00 L26.00 45.80 A2.00 2.00 0 0 1 22.00 45.80 Z" fill="#fff"/></g></svg>`;
function MapView({ C, geo, restaurants, onPin, scoreColor, onSearchArea, prefs }) {
  const ref = useRef(null); const mapRef = useRef(null); const layerRef = useRef(null); const mkRef = useRef([]);
  const [pick, setPick] = useState((prefs && prefs.mapStyle) || "auto");
  const [moved, setMoved] = useState(false);
  const [follow, setFollow] = useState(true);
  const [gmap, setGmap] = useState(null); // null=probing, true=Google tiles live, false=CARTO fallback
  useEffect(() => { fetch("/api/gmap/tile/day/3/1/2").then((r) => setGmap(r.ok)).catch(() => setGmap(false)); }, []);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 3000); return () => clearInterval(t); }, []);
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  const hour = new Date().getHours();
  const styleKey = pick === "auto" ? (hour >= ((prefs && prefs.dayStart) ?? 7) && hour < ((prefs && prefs.dayEnd) ?? 19) ? "day" : "night") : pick;
  const S = MAP_TILES[styleKey];
  const lat = geo.status === "ok" ? geo.lat : 39.7392;
  const lon = geo.status === "ok" ? geo.lng : -104.9903;

  useEffect(() => {
    if (mapRef.current || !ref.current) return;
    const m = L.map(ref.current, { zoomControl: false, attributionControl: true });
    m.attributionControl.setPrefix(false);
    m.setView([lat, lon], (prefs && prefs.mapZoom) || 15);
    m.on("dragstart", () => { setMoved(true); setFollow(false); });
    m.on("zoomstart", () => setMoved(true));
    mapRef.current = m;
    return () => { m.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const m = mapRef.current; if (!m || gmap === null) return;
    if (layerRef.current) m.removeLayer(layerRef.current);
    const url = gmap ? `/api/gmap/tile/${styleKey}/{z}/{x}/{y}` : S.tl;
    const attr = gmap ? "&copy; Google" : S.attr;
    layerRef.current = L.tileLayer(url, { attribution: attr, maxZoom: 19, subdomains: "abcd" }).addTo(m);
  }, [styleKey, gmap]);

  useEffect(() => {
    const m = mapRef.current; if (!m || geo.status !== "ok" || !follow) return;
    m.setView([geo.lat, geo.lng], m.getZoom() || 15, { animate: true });
  }, [geo.status, geo.lat, geo.lng, follow]);

  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    mkRef.current.forEach((k) => m.removeLayer(k)); mkRef.current = [];
    const you = L.marker([lat, lon], { icon: L.divIcon({ html: YOU_PIN_SVG, className: "", iconSize: [30, 37], iconAnchor: [15, 37] }), zIndexOffset: 500 }).addTo(m);
    mkRef.current.push(you);
    restaurants.forEach((r, i) => {
      const vLat = r.lat != null ? r.lat : lat + (VENUE_OFFSETS[i % 5][0]);
      const vLng = r.lng != null ? r.lng : lon + (VENUE_OFFSETS[i % 5][1]);
      const ranked = r.match != null;
      const sc = ranked ? scoreColor(r.match / 20) : (S.dark ? "#9aa7ad" : "#8a958c");
      const html = `<div style="background:${S.dark ? "rgba(20,27,34,0.92)" : "rgba(255,255,255,0.95)"};color:${S.dark ? "#EDF2F0" : "#17221C"};border-radius:11px;padding:4px 9px 4px 7px;font-weight:700;font-size:11px;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,0.3);white-space:nowrap;display:flex;gap:6px;align-items:center;"><span style="width:8px;height:8px;border-radius:99px;background:${sc};flex-shrink:0;"></span>${r.name}&nbsp;<span style="color:${sc};font-weight:${ranked ? 700 : 600};">${ranked ? r.match : "★" + (+r.score).toFixed(1)}</span></div>`;
      const mk = L.marker([vLat, vLng], { icon: L.divIcon({ html, className: "", iconSize: null, iconAnchor: [40, 14] }) }).addTo(m);
      mk.on("click", () => onPin(r));
      mkRef.current.push(mk);
    });
  }, [restaurants, lat, lon, styleKey]);

  const pillBg = S.dark ? "rgba(20,27,34,0.92)" : "rgba(255,255,255,0.95)";
  const pillInk = S.dark ? "#EDF2F0" : "#17221C";
  return (
    <div style={{ position: "relative", height: 280, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.hair}`, isolation: "isolate", zIndex: 0 }}>
      <div ref={ref} style={{ position: "absolute", inset: 0, background: S.dark ? "#11181f" : "#e8ecef" }} />
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 800, background: pillBg, borderRadius: 20, padding: "4px 11px", fontSize: 11, fontWeight: 600, color: pillInk, display: "flex", gap: 5, alignItems: "center", pointerEvents: "none" }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: C.go }} /> {geo.status === "ok" ? `${restaurants.length === 0 ? "No spots here" : `${restaurants.length} spots`}${geo.live && geo.ts ? ` · fix ${Math.max(0, Math.round((Date.now() - geo.ts) / 1000))}s ago` : geo.manual ? " · pinned" : ""}` : "Demo area"}
      </div>
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 800, display: "flex", gap: 4, background: pillBg, borderRadius: 20, padding: 3 }}>
        {["auto", "day", "night", "sat"].map((k) => (
          <button key={k} onClick={() => setPick(k)} style={{ border: "none", cursor: "pointer", borderRadius: 16, padding: "3px 9px", fontFamily: BODY, fontSize: 10.5, fontWeight: 700, background: pick === k ? C.go : "transparent", color: pick === k ? "#fff" : pillInk, textTransform: "capitalize" }}>{k}</button>
        ))}
      </div>
      {moved && (
        <button onClick={() => { const c = mapRef.current && mapRef.current.getCenter(); if (c && onSearchArea) { onSearchArea(c.lat, c.lng); } setMoved(false); }}
          style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 800, background: C.go, color: "#fff", border: "none", borderRadius: 20, padding: "9px 16px", fontFamily: BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 3px 10px rgba(0,0,0,0.35)" }}>
          Search this area
        </button>
      )}
      <button onClick={() => { setFollow(true); setMoved(false); const m = mapRef.current; if (m && geo.status === "ok") m.setView([geo.lat, geo.lng], 16, { animate: true }); }}
        style={{ position: "absolute", bottom: 12, right: 12, zIndex: 800, width: 40, height: 40, borderRadius: 99, border: "none", cursor: "pointer", background: follow ? C.go : pillBg, boxShadow: "0 2px 8px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={follow ? "#fff" : pillInk} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" /></svg>
      </button>
      {insecure && !geo.live && (
        <div style={{ position: "absolute", bottom: 12, left: 10, right: 10, zIndex: 800, background: "rgba(200,140,20,0.92)", color: "#1a1200", borderRadius: 10, padding: "6px 10px", fontSize: 11, fontWeight: 600, textAlign: "center" }}>
          Live GPS can’t work over HTTP — open ForkCaster from your Tailscale HTTPS URL (ts.net)
        </div>
      )}
    </div>
  );
}

/* ── food illustrations (fallback when photos are blocked) ── */
function foodGlyph(kind, c, s = 52) {
  const common = { width: s, height: s, viewBox: "0 0 48 48", fill: "none" };
  const f = { fill: c };
  if (kind === "bowl") return (<svg {...common}><path d="M7 25h34c0 9-8 14-17 14S7 34 7 25z" {...f} /><path d="M12 23c3-6 21-6 24 0z" fill={c} opacity="0.8" /><rect x="19" y="10" width="2.4" height="8" rx="1.2" {...f} opacity="0.7" /><rect x="25" y="11" width="2.4" height="7" rx="1.2" {...f} opacity="0.7" /></svg>);
  if (kind === "chicken") return (<svg {...common}><path d="M29 8a9 9 0 016 15.5L21 37.5a6 6 0 11-8-2.5 6 6 0 01-2.5-8L25 12.5A9 9 0 0129 8z" {...f} /><rect x="9" y="33" width="11" height="3.6" rx="1.8" transform="rotate(45 14.5 34.8)" {...f} /></svg>);
  if (kind === "steak") return (<svg {...common}><path d="M11 19c4-9 22-10 26-2s-2 19-11 21S5 31 11 19z" {...f} /><circle cx="31" cy="20" r="4" fill="none" stroke="#fff" strokeWidth="2.2" opacity="0.85" /></svg>);
  if (kind === "salad") return (<svg {...common}><path d="M8 24h32c0 8-7 13-16 13S8 32 8 24z" {...f} /><circle cx="18" cy="20" r="5.5" {...f} opacity="0.9" /><circle cx="28" cy="18" r="6.5" {...f} opacity="0.72" /><circle cx="34" cy="23" r="4" {...f} opacity="0.9" /></svg>);
  return (<svg {...common}><path d="M10 19c0-7 6-10 14-10s14 3 14 10z" {...f} /><rect x="9" y="22" width="30" height="5" rx="2.5" {...f} opacity="0.85" /><path d="M9 31h30c0 4-3 6.5-7 6.5H16c-4 0-7-2.5-7-6.5z" {...f} /><circle cx="18" cy="14" r="1.1" fill="#fff" opacity="0.75" /><circle cx="24" cy="13" r="1.1" fill="#fff" opacity="0.75" /><circle cx="30" cy="14" r="1.1" fill="#fff" opacity="0.75" /></svg>);
}

/* ── nav icons ── */
const iconNow = (c) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 21s-7-5.2-7-10a7 7 0 0114 0c0 4.8-7 10-7 10z" stroke={c} strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="11" r="2.5" stroke={c} strokeWidth="2" /></svg>);
const iconToday = (c) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="2" /><path d="M12 7v5l3 2" stroke={c} strokeWidth="2" strokeLinecap="round" /></svg>);
const iconBody = (c) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 20l4-9 4 2 4-2 4 9" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="5" r="2.5" stroke={c} strokeWidth="2" /></svg>);
const iconMed = (c) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 2 4 4" /><path d="m17 7 3-3" /><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5" /><path d="m9 11 4 4" /><path d="m5 19-3 3" /><path d="m14 4 6 6" /></svg>);
const iconCoach = (c) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke={c} strokeWidth="2" strokeLinejoin="round" /></svg>);
