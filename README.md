# ForkCaster

**Self-hosted, medication-aware nutrition coach.** GPS-aware "what should I order right now" ranking against your remaining macros · GLP-1 dose/titration tracking with symptom↔food correlation · allergy filtering on every suggestion · barcode scanning (Open Food Facts) · AI plate-photo estimation · weight, body composition, progress photos · live AI coach. All data stays on your node.

Built by LoneStrike Labs. Personal-use build for Umbrel.

---

## Architecture

```
┌────────────────────────────────────────────┐
│  Docker container (node:20-alpine)         │
│                                            │
│  server/server.js (Express)                │
│   ├─ /api/ai       → Anthropic (key here)  │
│   ├─ /api/off/:bc  → Open Food Facts proxy │
│   ├─ /api/nearby   → Google Places (opt.)  │
│   ├─ /api/state    → JSON persistence      │
│   ├─ /api/photo    → photo files           │
│   └─ /             → built React app       │
│                                            │
│  /data volume: state.json + photos/        │
└────────────────────────────────────────────┘
```

The client **never** holds API keys. All third-party calls go through the backend.

## Quick start (any Docker host)

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # required for AI features
export GOOGLE_PLACES_KEY=...             # optional: live nearby restaurants
docker compose up -d --build
# open http://<host>:3450
```

Without `GOOGLE_PLACES_KEY` the app uses its built-in demo venues (AI ranking still fully works). Without `ANTHROPIC_API_KEY`, tracking/logging works but AI features return a friendly error.

## Umbrel install (community app store flow)

Same two-step flow as the LoneStrike apps:

1. **Build + push the image to GHCR** (classic `ghp_` PAT with `write:packages` — fine-grained tokens get 403'd):
   ```bash
   docker build -t ghcr.io/<you>/forkcaster:0.1.0 .
   echo $GHP_PAT | docker login ghcr.io -u <you> --password-stdin
   docker push ghcr.io/<you>/forkcaster:0.1.0
   ```
2. **Add `umbrel/forkcaster/` to your community app store repo**, replace `CHANGEME` in both files (repo URL, image ref, and set `ANTHROPIC_API_KEY` in the compose env), pin the sha256 digest, and install from your store on the node.

Data persists in `${APP_DATA_DIR}/data`.

## ⚠️ GPS needs HTTPS (Tailscale)

Browsers only allow geolocation in a **secure context**. Plain `http://umbrel.local:3450` will silently block GPS.

Fix — you already run Tailscale:

```bash
# on the node
tailscale serve --bg 3450
tailscale serve status   # shows your https://<node>.<tailnet>.ts.net URL
```

Open that HTTPS URL on your phone → GPS works, and you can Add to Home Screen for the app feel. (LAN HTTP still works for everything except location.)

## Configuration

| Env | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | for AI | meal ranking, coach, photo estimation |
| `GOOGLE_PLACES_KEY` | no | live nearby restaurants + real venue photos |
| `DATA_DIR` | no (default `/data`) | state + photos location |
| `PORT` | no (default `3450`) | listen port |

## Notes / honest limitations (v0.1.0)

- Live venues from Places have **no menus** (no public menu API exists) — for those, the AI proposes realistic goal-fit orders for that cuisine and estimates macros conservatively. Demo venues carry full sample menus.
- Allergy filtering on live venues is AI-inference over dish names; barcode-scanned items use real Open Food Facts allergen-relevant data. **Always confirm with the restaurant for severe allergies.**
- Camera barcode *scanning* is manual-entry in v0.1 (type/paste the number); a `BarcodeDetector`/QuaggaJS scanner is the obvious v0.2.
- Map is a stylized vector + OSM tile when reachable; a proper map SDK is a v0.2 item.
- Single-user, no auth — designed to sit behind Tailscale, not the open internet.

## Medical disclaimer

ForkCaster is a tracking and decision-support tool, not medical advice. Medication information is reference only — confirm every dose decision with your prescriber. Retatrutide is investigational and the app deliberately shows no dosing schedule for it.

## License

AGPL-3.0 (matching LoneStrike house style). © LoneStrike Labs.
