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
echo "=================================================="
echo " $IMG is in the local registry."
echo " -> Open the Umbrel App Store and tap Update."
echo "=================================================="
