"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src");
const source = path.join(root, "src");

require("./prepare-2.0.0-final.cjs");

function copyText(sourcePath, destinationPath, replacements = []) {
  let content = fs.readFileSync(sourcePath, "utf8");
  for (const [search, replacement] of replacements) {
    if (!content.includes(search)) throw new Error(`Erwarteter Text fehlt in ${sourcePath}: ${search}`);
    content = content.replaceAll(search, replacement);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, content, "utf8");
}

function copyFile(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Quelldatei fehlt: ${sourcePath}`);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

copyText(
  path.join(bootstrap, "stream-overlay", "overlay-v2.html"),
  path.join(source, "stream-overlay", "overlay.html"),
  [["./overlay-v2.css", "./overlay.css"], ["./overlay-v2.js", "./overlay.js"]]
);
copyFile(path.join(bootstrap, "stream-overlay", "overlay-v2.css"), path.join(source, "stream-overlay", "overlay.css"));
copyFile(path.join(bootstrap, "stream-overlay", "overlay-v2.js"), path.join(source, "stream-overlay", "overlay.js"));
copyText(
  path.join(bootstrap, "stream-overlay", "editor-v2.html"),
  path.join(source, "stream-overlay", "editor.html"),
  [["./editor-v2.css", "./editor.css"], ["./editor-v2.js", "./editor.js"]]
);
copyFile(path.join(bootstrap, "stream-overlay", "editor-v2.css"), path.join(source, "stream-overlay", "editor.css"));
copyFile(path.join(bootstrap, "stream-overlay", "editor-v2.js"), path.join(source, "stream-overlay", "editor.js"));

copyText(
  path.join(bootstrap, "mobile", "index-v2.html"),
  path.join(source, "mobile", "index.html"),
  [["./styles-v2.css", "./styles.css"], ["./app-v2.js", "./app.js"], ["../stream-overlay/team-logo.svg", "./team-logo.svg"]]
);
copyFile(path.join(bootstrap, "mobile", "styles-v2.css"), path.join(source, "mobile", "styles.css"));
copyFile(path.join(bootstrap, "mobile", "app-v2.js"), path.join(source, "mobile", "app.js"));

for (const file of [
  "mobile/index-v2.html", "mobile/styles-v2.css", "mobile/app-v2.js",
  "stream-overlay/overlay-v2.html", "stream-overlay/overlay-v2.css", "stream-overlay/overlay-v2.js",
  "stream-overlay/editor-v2.html", "stream-overlay/editor-v2.css", "stream-overlay/editor-v2.js"
]) fs.rmSync(path.join(source, file), { force: true });

const servicesRoot = path.join(source, "services");
const allowedServices = new Set([
  "hardware.cjs",
  "recommendation.cjs",
  "runtime-utils-v2.cjs",
  "deck-manager-v2.cjs",
  "action-executor-v2.cjs",
  "obs-client-v2.cjs",
  "mobile-bridge-v2.cjs",
  "stream-overlay-server-v2.cjs",
  "multi-chat-v2.cjs",
  "plugin-registry-v2.cjs",
  "holo-server-v2.cjs",
  "migration-v2.cjs"
]);
for (const entry of fs.readdirSync(servicesRoot)) {
  if (!allowedServices.has(entry)) fs.rmSync(path.join(servicesRoot, entry), { recursive: true, force: true });
}

const mainPath = path.join(source, "main.cjs");
let main = fs.readFileSync(mainPath, "utf8");
if (!main.includes("let systemSampler = null;")) throw new Error("Main-Patchpunkt für letzten OBS-Zustand fehlt");
main = main.replace("let systemSampler = null;", "let systemSampler = null;\nlet latestObsSnapshot = null;");
if (!main.includes('obs: { ...obs.status(), currentScene: null, scenes: [] },')) throw new Error("Mobile-OBS-Patchpunkt fehlt");
main = main.replace('obs: { ...obs.status(), currentScene: null, scenes: [] },', 'obs: latestObsSnapshot || { ...obs.status(), currentScene: null, scenes: [] },');
const snapshotPatch = "  const chatState = multiChat?.snapshot?.() || {};";
if (!main.includes(snapshotPatch)) throw new Error("State-Snapshot-Patchpunkt fehlt");
main = main.replace(snapshotPatch, "  latestObsSnapshot = obsState;\n" + snapshotPatch);
fs.writeFileSync(mainPath, main, "utf8");

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
packageJson.scripts = {
  ...(packageJson.scripts || {}),
  "prepare:release": "node scripts/prepare-2.0.0-release.cjs",
  "check:release": "node scripts/check-2.0.0.cjs",
  "test:release": "node --test test/*.test.cjs",
  "dist:release": "electron-builder --win nsis --x64"
};
packageJson.build = packageJson.build || {};
packageJson.build.extraResources = [
  { from: "resources/team-logo.svg", to: "team-logo.svg" },
  { from: "resources/plugin-catalog-2.0.json", to: "plugin-catalog-2.0.json" }
];
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

const forbiddenNames = [/Creator Hub\.exe/i, /Creator-Hub-\.apk/i];
for (const expression of forbiddenNames) {
  for (const file of fs.readdirSync(source, { recursive: true })) {
    if (expression.test(String(file))) throw new Error(`Veraltete veröffentlichte Datei gefunden: ${file}`);
  }
}

console.log("Batto OBS Tool 2.0.0: finale saubere Produktionsquelle erstellt.");
