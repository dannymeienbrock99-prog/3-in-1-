"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const files = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/services/hardware.cjs",
  "src/services/obs-websocket.cjs",
  "src/services/store.cjs",
  "src/services/telemetry.cjs",
  "src/services/twitch-holo-server.cjs",
  "src/renderer/index.html",
  "src/renderer/app.js",
  "src/renderer/styles.css",
  "modules/encoder-monitoring-overlay/web/editor.html",
  "modules/encoder-monitoring-overlay/web/editor.js",
  "modules/encoder-monitoring-overlay/src/server.cjs"
];

for (const relative of files) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, "utf8");
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized !== source) fs.writeFileSync(filename, normalized, "utf8");
}

require("./apply-1.9.1-source-fixes-v4.cjs");
