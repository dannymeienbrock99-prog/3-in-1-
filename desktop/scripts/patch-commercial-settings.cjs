"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const htmlFile = path.join(root, "src", "renderer", "index.html");
let html = fs.readFileSync(htmlFile, "utf8");

const cssTag = '<link rel="stylesheet" href="./commercial-settings.css">';
const jsTag = '<script src="./commercial-settings.js"></script>';

if (!html.includes(cssTag)) {
  const marker = '<link rel="stylesheet" href="./styles.css">';
  if (!html.includes(marker)) throw new Error("styles.css marker missing in renderer/index.html");
  html = html.replace(marker, `${marker}\n    ${cssTag}`);
}

if (!html.includes(jsTag)) {
  const marker = "</body>";
  if (!html.includes(marker)) throw new Error("body closing tag missing in renderer/index.html");
  html = html.replace(marker, `  ${jsTag}\n  ${marker}`);
}

for (const forbidden of ["Hardwarediagnose", "PC vollständig scannen", "Encoder- und Hardware-Monitoring", "CPU-Belastungstest"]) {
  if (html.includes(forbidden)) throw new Error(`Unerwünschte Alt-UI im 2.1-Renderer: ${forbidden}`);
}

for (const required of ["view-overview", "view-obs", "multi-chat-root", "view-deck-0802", "view-moderation", "view-cohost", "view-holo", "view-settings"]) {
  if (!html.includes(required)) throw new Error(`2.1-Rendererbereich fehlt: ${required}`);
}

if (html.includes("Touch-Deck Pro")) throw new Error("Touch-Deck Pro darf im neuen Renderer nicht mehr verwendet werden.");

fs.writeFileSync(htmlFile, html, "utf8");
console.log("Clean 2.1 renderer + user-specified Touch-Deck/moderation/co-host settings integrated.");
