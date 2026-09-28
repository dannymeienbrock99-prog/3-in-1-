"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const preserved = {};
for (const relative of ["services/hardware.cjs", "services/recommendation.cjs"]) {
  const file = path.join(source, relative);
  if (!fs.existsSync(file)) throw new Error(`Erforderliche bestehende Diagnosequelle fehlt: ${relative}`);
  preserved[relative] = fs.readFileSync(file);
}

fs.rmSync(source, { recursive: true, force: true });
for (const [relative, buffer] of Object.entries(preserved)) {
  const target = path.join(source, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
}

require("./prepare-2.0.0-integrated.cjs");

const unexpected = [
  "src/services/twitch-holo-server.cjs",
  "src/services/telemetry.cjs",
  "src/renderer/index.old.html",
  "src/renderer/app.old.js"
].filter((relative) => fs.existsSync(path.join(root, relative)));
if (unexpected.length) throw new Error(`Alte Quellreste wurden nicht entfernt: ${unexpected.join(", ")}`);

console.log("Batto OBS Tool 2.0.0: saubere Produktionsquelle ohne alte Laufzeitreste erstellt.");
