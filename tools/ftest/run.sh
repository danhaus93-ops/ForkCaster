#!/bin/bash
# ForkCaster rig — rebuilt 2026-07-25 after a sandbox reset.
# Pattern: extract the REAL function from src/App.jsx with new Function() and run it on synthetic data.
cd "$(dirname "$0")"
tot=0; bad=0
for t in grocery-test.js struct-test.js engines-test.js chain-test.js delivery-test.js train-test.js bodyscan-test.js photos-test.js foodsearch-test.js ground-test.js nightshift-test.js dayroll-test.js swap-test.js manifest-test.js render-smoke.js; do
  echo "── $t"
  node "$t"; [ $? -ne 0 ] && bad=$((bad+1))
done
echo; echo "SUITES FAILED: $bad"
exit $bad
