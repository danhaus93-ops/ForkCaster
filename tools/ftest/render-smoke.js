const __FCROOT = require("path").resolve(__dirname, "..", "..");
// The gap that let a render-time crash ship: nothing in the rebuilt rig ever RENDERED the app.
const { execSync } = require('child_process');
const fs = require('fs');
const R = __FCROOT;
fs.writeFileSync(R + '/.smoke-entry.jsx', `
import React from "react";
import { renderToString } from "react-dom/server";
import App from "./src/App.jsx";
try { renderToString(React.createElement(App)); console.log("RENDER_OK"); }
catch (e) { console.log("RENDER_THREW: " + e.message); console.log((e.stack||"").split("\\n").slice(0,10).join("\\n")); process.exitCode = 1; }
`);
try {
  execSync(`cd ${R} && npx esbuild .smoke-entry.jsx --bundle --platform=node --format=cjs --outfile=${__dirname}/smoke/bundle.cjs --loader:.jsx=jsx --jsx=automatic --loader:.png=dataurl --log-level=error`, {stdio:'pipe'});
  const out = execSync(`node -e "require(__dirname + '/smoke/shim.js'); require(__dirname + '/smoke/bundle.cjs');"`, {stdio:'pipe'}).toString();
  console.log(out.trim());
  process.exit(/RENDER_OK/.test(out) ? 0 : 1);
} catch (e) {
  console.log('RENDER SMOKE FAILED:\n' + (e.stdout||'').toString() + (e.stderr||'').toString().slice(0,900));
  process.exit(1);
} finally { try { fs.unlinkSync(R + '/.smoke-entry.jsx'); } catch {} }
