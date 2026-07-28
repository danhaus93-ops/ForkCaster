#!/usr/bin/env bash
# ForkCaster Doctor — one command, full physical exam.
# Run on the Umbrel:  bash ~/ForkCaster/tools/doctor.sh
# Read-only: inspects the container, state, health data, logs, snapshots, disk. Changes nothing.
set -u

hr() { echo "──────────────────────────────────────────"; }
okc()  { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }

echo "🩺 ForkCaster Doctor — $(date '+%Y-%m-%d %H:%M:%S')"
hr

# ── 1. Container ─────────────────────────────────────────
CID=$(sudo docker ps -qf name=forkcaster | head -1)
if [ -z "$CID" ]; then
  warn "No running ForkCaster container found — is the app started in Umbrel?"
  sudo docker ps -a --filter name=forkcaster --format '  last seen: {{.Names}}  {{.Status}}  ({{.Image}})'
  exit 1
fi
NAME=$(sudo docker inspect -f '{{.Name}}' "$CID" | sed 's|^/||')
IMAGE=$(sudo docker inspect -f '{{.Config.Image}}' "$CID")
STARTED=$(sudo docker inspect -f '{{.State.StartedAt}}' "$CID" | cut -c1-19)
RESTARTS=$(sudo docker inspect -f '{{.RestartCount}}' "$CID")
echo "CONTAINER"
okc "$NAME running since $STARTED (image $IMAGE)"
if [ "$RESTARTS" = "0" ]; then okc "container restarts: 0 — the SERVER has not been crashing"; else warn "container has restarted $RESTARTS times — server-side instability, check errors below"; fi

# ── 2. Server answers ────────────────────────────────────
PORT=$(sudo docker exec "$CID" sh -c 'echo ${PORT:-3000}')
DDIR=$(sudo docker exec "$CID" sh -c 'echo ${DATA_DIR:-/data}')
SUM=$(sudo docker exec "$CID" sh -c "wget -qO- -T 5 http://localhost:${PORT}/api/health/summary 2>/dev/null | head -c 100")
echo; echo "SERVER (port $PORT, data at $DDIR)"
if [ -n "$SUM" ]; then okc "API answering — /api/health/summary responds"; else warn "API did not answer on :$PORT — server hung or wrong port"; fi

# ── 3. Your data ─────────────────────────────────────────
echo; echo "YOUR DATA"
sudo docker exec "$CID" node -e '
  const fs=require("fs"), p=(process.env.DATA_DIR||"/data");
  try {
    const raw=fs.readFileSync(p+"/state.json","utf8"); const s=JSON.parse(raw);
    console.log("  ✅ state.json valid ("+(raw.length/1024).toFixed(1)+" KB) · rev "+(s._rev??"none"));
    const g=s.glp||{};
    console.log("  ✅ side effects: "+((g.sideEffects||s.sideEffects||[]).length)+" · meals logged: "+((s.mealLog||[]).length)+" · weigh-ins: "+((s.weightLog||[]).length)+" · doses: "+((g.doseLog||s.doseLog||[]).length));
  } catch(e){ console.log("  ⚠️  state.json problem: "+e.message); }
  try {
    const h=JSON.parse(fs.readFileSync(p+"/health.json","utf8"));
    const days=Object.keys(h.days||{}).sort(); const last=days[days.length-1];
    const age=((Date.now()-fs.statSync(p+"/health.json").mtimeMs)/60000).toFixed(0);
    const d=(h.days||{})[last]||{};
    console.log("  ✅ health sync: "+days.length+" days · newest "+last+" (steps "+(d.steps??"—")+(d.source?", source "+d.source:"")+") · last write "+age+" min ago");
    if (+age>30) console.log("  ⚠️  no sync landed in "+age+" min — check HAE automation is running");
  } catch(e){ console.log("  ⚠️  health.json problem: "+e.message); }
' 2>/dev/null || warn "could not inspect data files inside the container"

# ── 4. Stale-write rejections (self-reload evidence) ────
echo; echo "STALE WRITES (full log — each one = a client got bounced and reloaded)"
STALES=$(sudo docker logs -t "$CID" 2>&1 | grep -c "STALE WRITE REJECTED" || true)
if [ "$STALES" = "0" ]; then
  okc "zero stale rejections since container start — no app self-reloads were triggered by the node"
else
  warn "$STALES stale rejection(s) — most recent:"
  sudo docker logs -t "$CID" 2>&1 | grep "STALE WRITE REJECTED" | tail -3 | sed 's/^/     /'
fi

# ── 5. Server errors ─────────────────────────────────────
echo; echo "SERVER ERRORS (last 5 in full log)"
ERRS=$(sudo docker logs "$CID" 2>&1 | grep -ciE "error|exception|unhandled" || true)
if [ "$ERRS" = "0" ]; then okc "no errors in the server log"; else
  warn "$ERRS error line(s) — last 5:"
  sudo docker logs -t "$CID" 2>&1 | grep -iE "error|exception|unhandled" | tail -5 | cut -c1-160 | sed 's/^/     /'
fi

# ── 6. Memory (a leak is a SLOPE — each run logs a point) ─
echo; echo "MEMORY"
MEMUSE=$(sudo docker stats --no-stream --format '{{.MemUsage}} ({{.MemPerc}})' "$CID" 2>/dev/null)
RSS=$(sudo docker exec "$CID" sh -c "grep VmRSS /proc/1/status 2>/dev/null" | awk '{print $2, $3}')
okc "container: $MEMUSE · server process RSS: ${RSS:-unknown}"
CHROMS=$(sudo docker exec "$CID" sh -c "ps -o comm 2>/dev/null | grep -ci chrom" 2>/dev/null || echo 0)
if [ "${CHROMS:-0}" = "0" ]; then okc "no Chromium processes alive — the menu scraper is cleaning up after itself"; else
  warn "$CHROMS Chromium process(es) running — fine mid-scrape; LEAKED BROWSERS if the app is idle (the classic Node leak here)"; fi
MEMLOG="$HOME/.forkcaster-mem.log"
echo "$(date '+%Y-%m-%d %H:%M') rss=${RSS:-?} chromium=$CHROMS since=$STARTED" >> "$MEMLOG"
echo "  trend (last 5 runs — flat RSS at similar uptime = healthy, a staircase = leak):"
tail -5 "$MEMLOG" | sed 's/^/     /'

# ── 7. Snapshots & disk ─────────────────────────────────
HOSTDATA="$HOME/umbrel/app-data/forkcaster-coach/data"
echo; echo "SNAPSHOTS & DISK"
SNAPS=$(sudo sh -c "ls $HOSTDATA/*snapshot* 2>/dev/null | wc -l" || echo 0)
NEWEST=$(sudo sh -c "ls -t $HOSTDATA/*snapshot* 2>/dev/null | head -1" || true)
if [ "$SNAPS" != "0" ] && [ -n "$NEWEST" ]; then okc "$SNAPS shrink-snapshot(s) on disk · newest: $(basename "$NEWEST")"; else okc "no shrink snapshots (no suspicious data shrinks — good)"; fi
sudo df -h "$HOSTDATA" 2>/dev/null | tail -1 | awk '{u=$5; sub("%","",u); printf "  %s disk: %s used of %s (%s%%)\n", (u+0<85?"✅":"⚠️ "), $3, $2, u}'

hr
echo "Reading the results:"
echo "• Restarts 0 + zero stale rejections + app still reloading on your phone"
echo "  = iOS evicted the page for memory (normal with several apps open; data is safe)."
echo "• Stale rejections with fresh timestamps = the app self-reloaded; note the times"
echo "  and tell Claude — that means a revision desync survived v0.9.30."
