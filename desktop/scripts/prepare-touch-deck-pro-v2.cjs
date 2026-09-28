"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src", "renderer");
const renderer = path.join(root, "src", "renderer");
const indexFile = path.join(renderer, "index.html");

function copyRequired(name) {
  const source = path.join(bootstrap, name);
  const target = path.join(renderer, name);
  if (!fs.existsSync(source) || !fs.statSync(source).size) {
    const actual = fs.existsSync(source) ? `${fs.statSync(source).size} bytes` : "NICHT VORHANDEN";
    throw new Error(`Touch-Deck-Pro-Quelldatei fehlt oder ist leer: bootstrap-2.0/src/renderer/${name} (Status: ${actual})`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

copyRequired("touch-deck-pro-v2.css");
copyRequired("touch-deck-pro-v2.js");
copyRequired("touch-deck-creatorhub.css");
copyRequired("touch-deck-creatorhub.js");

let index = fs.readFileSync(indexFile, "utf8");
if (!index.includes('href="./touch-deck-pro-v2.css"')) {
  const marker = '<link rel="stylesheet" href="./styles.css">';
  if (!index.includes(marker)) throw new Error("styles.css-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <link rel="stylesheet" href="./touch-deck-pro-v2.css">`);
}
if (!index.includes('href="./touch-deck-creatorhub.css"')) {
  const marker = '<link rel="stylesheet" href="./touch-deck-pro-v2.css">';
  if (!index.includes(marker)) throw new Error("Touch-Deck-Pro-CSS-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <link rel="stylesheet" href="./touch-deck-creatorhub.css">`);
}
if (!index.includes('src="./touch-deck-pro-v2.js"')) {
  const marker = '<script src="./app.js"></script>';
  if (!index.includes(marker)) throw new Error("app.js-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <script src="./touch-deck-pro-v2.js"></script>`);
}
if (!index.includes('src="./touch-deck-creatorhub.js"')) {
  const marker = '<script src="./touch-deck-pro-v2.js"></script>';
  if (!index.includes(marker)) throw new Error("Touch-Deck-Pro-JS-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <script src="./touch-deck-creatorhub.js"></script>`);
}
fs.writeFileSync(indexFile, index, "utf8");

for (const relative of [
  "src/renderer/touch-deck-pro-v2.css",
  "src/renderer/touch-deck-pro-v2.js",
  "src/renderer/touch-deck-creatorhub.css",
  "src/renderer/touch-deck-creatorhub.js"
]) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Touch-Deck-Pro-Builddatei fehlt: ${relative}`);
}

console.log("Touch-Deck Pro V2 + Creator-Hub-Deck-Ansicht in die 2.1-Produktionsquelle eingebunden.");
