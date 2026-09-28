"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceService = path.join(root, "bootstrap-2.0", "src", "services", "stream-overlay-server.cjs");
const targetService = path.join(root, "src", "services", "stream-overlay-server.cjs");
const sourceWeb = path.join(root, "bootstrap-2.0", "src", "stream-overlay");
const targetWeb = path.join(root, "src", "stream-overlay");

if (!fs.existsSync(sourceService) || !fs.statSync(sourceService).size) {
  throw new Error("Stream-Overlay-Server-Quelle fehlt.");
}
if (!fs.existsSync(sourceWeb) || !fs.statSync(sourceWeb).isDirectory()) {
  throw new Error("Stream-Overlay-Weboberfläche fehlt.");
}

fs.mkdirSync(path.dirname(targetService), { recursive: true });
fs.copyFileSync(sourceService, targetService);
fs.rmSync(targetWeb, { recursive: true, force: true });
fs.cpSync(sourceWeb, targetWeb, { recursive: true });

for (const file of ["chat-overlay.html", "chat-overlay.css", "chat-overlay.js", "editor.html", "overlay.html"]) {
  const target = path.join(targetWeb, file);
  if (!fs.existsSync(target) || !fs.statSync(target).size) throw new Error(`Stream-Overlay-Datei fehlt nach Vorbereitung: ${file}`);
}

console.log("Stream-Overlay-Runtime in die 2.1-Produktionsquelle eingebunden.");
