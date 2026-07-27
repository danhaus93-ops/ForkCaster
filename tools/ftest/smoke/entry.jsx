import React from "react";
import { renderToString } from "react-dom/server";
import App from "../../../home/claude/forkcaster/src/App.jsx";
try { renderToString(React.createElement(App)); console.log("RENDER_OK"); }
catch (e) { console.log("RENDER_THREW: " + e.message); console.log(e.stack.split("\n").slice(0,12).join("\n")); process.exit(1); }
