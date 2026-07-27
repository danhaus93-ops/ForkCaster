# ForkCaster test rig

The release gate: every suite must pass (exit 0) before a version ships.

    npm install          # once, from the repo root — the rig needs the dev deps
    bash tools/ftest/run.sh

10 suites. Pattern: extract the REAL functions out of src/App.jsx / server/server.js
and run them on fixtures (several drawn from real user data), plus a full
react-dom/server render smoke — static checks alone once let a render-time
crash ship three times. foodsearch-test spins stub HTTP servers on ports
8121/8122; bodyscan/photos use temp DATA_DIRs under /tmp.

Never gate a ship on this rig piped through another command — check run.sh's
own exit code.
