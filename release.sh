#!/bin/bash
# ForkCaster release: pull latest, build, push to the node's local registry.
# Then tap Update in the Umbrel App Store. That's the whole ritual.
set -e
cd "$(dirname "$0")"

git pull

VER=$(grep '"version"' package.json | head -1 | sed 's/[^0-9.]*//g')
IMG="127.0.0.1:5000/forkcaster:v$VER"

# ensure the local registry service exists and is running (idempotent)
sudo docker start registry 2>/dev/null || sudo docker run -d --restart=always --name registry \
  -p 5000:5000 -v /home/umbrel/registry-data:/var/lib/registry registry:2

sudo docker build -t "$IMG" .
sudo docker push "$IMG"

echo ""
TAGS=$(curl -s http://127.0.0.1:5000/v2/forkcaster/tags/list)
# EXACT tag match. A bare `grep "v$VER"` is a SUBSTRING test: it reports v0.8.1 as present
# when the registry only holds v0.8.10, which would green-light an update that was never pushed.
# Match the JSON-quoted tag and escape the dots so they are not regex wildcards.
VER_RE=$(printf '%s' "$VER" | sed 's/\./\\./g')
COUNT=$(printf '%s' "$TAGS" | tr ',' '\n' | grep -c '"v[0-9]')
if printf '%s' "$TAGS" | grep -q "\"v${VER_RE}\""; then
  echo "=================================================="
  echo " ✅ SAFE TO TAP — v$VER verified in local registry"
  echo "    Registry holds $COUNT tags of forkcaster."
  echo " -> Refresh the App Store page, confirm it offers v$VER, tap Update."
  echo "=================================================="
else
  echo "=================================================="
  echo " ⛔ DO NOT TAP UPDATE — v$VER NOT found in registry!"
  echo "    Registry holds $COUNT tags, none of them v$VER."
  echo "    Full list: $TAGS"
  echo "    Re-run this script or check the registry container."
  echo "=================================================="
  exit 1
fi
