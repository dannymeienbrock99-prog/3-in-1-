"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src");
const source = path.join(root, "src");
const resources = path.join(root, "resources");

function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function copyFile(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Quelldatei fehlt: ${path.relative(root, from)}`);
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}
function copyTree(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Quellordner fehlt: ${path.relative(root, from)}`);
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const input = path.join(from, entry.name);
    const output = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(input, output);
    else if (entry.isFile()) copyFile(input, output);
  }
}
function replaceRequired(file, before, after, label) {
  let text = fs.readFileSync(file, "utf8");
  if (text.includes(after)) return false;
  if (!text.includes(before)) throw new Error(`${label} wurde in ${path.relative(root, file)} nicht gefunden.`);
  text = text.replace(before, after);
  fs.writeFileSync(file, text, "utf8");
  return true;
}
function replaceAllRequired(file, before, after, minimum, label) {
  let text = fs.readFileSync(file, "utf8");
  const count = text.split(before).length - 1;
  if (count < minimum && !text.includes(after)) throw new Error(`${label}: erwartet mindestens ${minimum}, gefunden ${count}.`);
  text = text.split(before).join(after);
  fs.writeFileSync(file, text, "utf8");
}

if (!fs.existsSync(bootstrap)) throw new Error(`Bootstrap-Verzeichnis fehlt: ${path.relative(root, bootstrap)}`);

ensureDir(source);
for (const file of [
  "common.cjs", "obs-websocket.cjs", "plugin-registry.cjs", "deck-store.cjs", "migration.cjs",
  "action-executor.cjs", "mobile-bridge.cjs", "stream-overlay-server.cjs", "multi-chat.cjs",
  "twitch-holo-server.cjs"
]) copyFile(path.join(bootstrap, "services", file), path.join(source, "services", file));
copyTree(path.join(bootstrap, "stream-overlay"), path.join(source, "stream-overlay"));
copyTree(path.join(bootstrap, "mobile"), path.join(source, "mobile"));
copyFile(path.join(bootstrap, "main.cjs"), path.join(source, "main.cjs"));
copyFile(path.join(bootstrap, "preload.cjs"), path.join(source, "preload.cjs"));
copyFile(path.join(bootstrap, "renderer", "integrated.js"), path.join(source, "renderer", "integrated.js"));
copyFile(path.join(bootstrap, "renderer", "integrated.css"), path.join(source, "renderer", "integrated.css"));

const generatedMain = path.join(source, "main.cjs");
const cngRequire = 'require("./chat-bootstrap.cjs");';
let generatedMainText = fs.readFileSync(generatedMain, "utf8");
if (!generatedMainText.includes(cngRequire)) {
  generatedMainText += `\n// CNG / Multi-Chat bootstrap integration\n${cngRequire}\n`;
  fs.writeFileSync(generatedMain, generatedMainText, "utf8");
}

ensureDir(resources);
const fallbackLogo = path.join(source, "stream-overlay", "team-logo.svg");
if (!fs.existsSync(fallbackLogo)) throw new Error("Team-Alpha-Fallbacklogo fehlt im Stream-Overlay.");
copyFile(fallbackLogo, path.join(resources, "team-logo.svg"));
copyFile(fallbackLogo, path.join(source, "renderer", "assets", "team-alpha-logo.svg"));
copyFile(fallbackLogo, path.join(source, "mobile", "team-logo.svg"));

const indexFile = path.join(source, "renderer", "index.html");
let index = fs.readFileSync(indexFile, "utf8").replaceAll("1.9.1", "2.0.0");
index = index.replaceAll("./assets/team-alpha-logo.svg", "./assets/team-alpha-logo.png");
if (!index.includes("integrated.css")) {
  const marker = '<link rel="stylesheet" href="./styles.css">';
  if (!index.includes(marker)) throw new Error("Stylesheet-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <link rel="stylesheet" href="./integrated.css">`);
}
if (!index.includes("integrated.js")) {
  const marker = '<script src="./app.js"></script>';
  if (!index.includes(marker)) throw new Error("Skript-Marker im Hauptfenster fehlt.");
  index = index.replace(marker, `${marker}\n    <script src="./integrated.js"></script>`);
}
fs.writeFileSync(indexFile, index, "utf8");

const mainFile = path.join(source, "main.cjs");
replaceRequired(mainFile, 'Promise.resolve(sampler?.sample?.() || sampler?.snapshot?.() || {})', 'Promise.resolve(sampler?.sample?.(hardware) || sampler?.snapshot?.() || {})', "Hardwareübergabe an den Telemetrie-Sampler");
replaceRequired(mainFile, 'recommendation = await Promise.resolve(buildRecommendation({ hardware: await ensureHardware(), internet: internetResult, ...appSettings.encoder }));', 'recommendation = await Promise.resolve(buildRecommendation({ ...appSettings.encoder, gpu: preferredGpu(), uploadMbps: internetResult?.uploadMbps || 0 }));', "Bevorzugte GPU für die Encoder-Empfehlung");
replaceRequired(mainFile, 'handle("cpu:test", (payload) => runCpuLoadTest(payload));', 'handle("cpu:test", (payload) => runCpuLoadTest(payload.durationSeconds || payload.seconds || payload));', "Dauerübergabe für den CPU-Test");
replaceRequired(mainFile, 'if (payload.password !== undefined) writeSecret("obsPassword", password);', 'if (payload.password !== undefined && payload.rememberPassword !== false) writeSecret("obsPassword", password);\n  if (payload.rememberPassword === false) writeSecret("obsPassword", "");', "Auswahl zur OBS-Passwortspeicherung");
replaceRequired(mainFile, 'handle("obs:disconnect", async () => { await obs.disconnect(); latestObs = { available: false, ...obs.status() }; scheduleState(); return latestObs; });', 'handle("obs:disconnect", async () => { await obs.disconnect(); latestObs = { available: false, ...obs.status() }; scheduleState(); return latestObs; });\n  handle("obs:forget-password", () => { writeSecret("obsPassword", ""); return {}; });', "IPC zum Entfernen des OBS-Passworts");
replaceRequired(mainFile, 'logoPath: appResource("team-logo.svg")', 'logoPath: appResource("team-logo.png")', "Originales Team-Alpha-Logo im Stream-Overlay");

const streamServerFile = path.join(source, "services", "stream-overlay-server.cjs");
replaceRequired(streamServerFile, 'path.join(this.webRoot, "team-logo.svg")', 'path.join(this.webRoot, "team-logo.png")', "PNG-Fallback des Team-Alpha-Logos");

const preloadFile = path.join(source, "preload.cjs");
replaceRequired(
  preloadFile,
  'function legacyState(value) {',
  'function obsForLegacy(value) {\n  if (!value) return value;\n  return {\n    ...value,\n    scenes: Array.isArray(value.scenes)\n      ? { scenes: value.scenes, currentProgramSceneName: value.currentScene }\n      : value.scenes,\n    currentScene: value.currentProgramSceneName\n  };\n}\n\nfunction legacyState(value) {',
  "OBS-Kompatibilitätsform für die vorhandene Oberfläche"
);
replaceRequired(preloadFile, 'obs: value?.obs || { connected: false },', 'obs: obsForLegacy(value?.obs || { connected: false }),', "OBS-Kompatibilität im Startzustand");
replaceRequired(preloadFile, 'getObsSnapshot: () => invoke("obs:refresh"),', 'getObsSnapshot: async () => obsForLegacy(await invoke("obs:refresh")),', "OBS-Kompatibilität beim Neuladen");
replaceRequired(preloadFile, 'return (await invoke("settings:update", patch)).legacyDeck || value.deck || patch;', 'await invoke("settings:update", patch);\n    return legacyState(await invoke("state:get")).settings;', "Vollständige Rückgabe alter Einstellungen");

const multiChatFile = path.join(source, "services", "multi-chat.cjs");
replaceRequired(multiChatFile, '  snapshot() {', '  persistSettings() {\n    const stored = deepClone(this.settings);\n    stored.twitch.oauth = "";\n    stored.youtube.apiKey = "";\n    writeJsonAtomic(this.settingsFile, stored);\n  }\n\n  snapshot() {', "Getrennte Speicherung von Multi-Chat-Geheimnissen");
replaceAllRequired(multiChatFile, 'writeJsonAtomic(this.settingsFile, this.settings);', 'this.persistSettings();', 3, "Unverschlüsselte Multi-Chat-Geheimnisse");

const oldApp = path.join(source, "renderer", "app.js");
replaceRequired(oldApp, 'state?.product?.version || "1.9.1"', 'state?.product?.version || "2.0.0"', "Renderer-Fallbackversion");

const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.version !== "2.0.0") throw new Error(`Falsche Paketversion: ${packageJson.version}`);
if (packageJson.main !== "src/main.cjs") throw new Error(`Falscher Programmeinstieg: ${packageJson.main}`);
packageJson.build = packageJson.build || {};
packageJson.build.nsis = {
  ...(packageJson.build.nsis || {}),
  oneClick: false,
  allowToChangeInstallationDirectory: true,
  runAfterFinish: false,
  include: "build/installer.nsh"
};
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

const required = [
  "src/main.cjs", "src/chat-bootstrap.cjs", "src/preload.cjs", "src/renderer/index.html", "src/renderer/app.js",
  "src/renderer/multi-chat.html", "src/renderer/multi-chat.js", "src/renderer/multi-chat.css", "src/renderer/chat-overlay-controls.js",
  "src/stream-overlay/chat-overlay.html", "src/stream-overlay/chat-overlay.css", "src/stream-overlay/chat-overlay.js",
  "src/renderer/integrated.js", "src/renderer/integrated.css", "src/renderer/assets/team-alpha-logo.svg",
  "src/services/hardware.cjs", "src/services/recommendation.cjs", "src/services/obs-websocket.cjs", "src/services/obs-chat-overlay.cjs",
  "src/services/mobile-bridge.cjs", "src/services/stream-overlay-server.cjs", "src/services/plugin-registry.cjs",
  "src/services/deck-store.cjs", "src/services/multi-chat.cjs", "src/mobile/index.html",
  "src/stream-overlay/editor.html", "src/stream-overlay/overlay.html", "resources/team-logo.svg",
  "modules/encoder-monitoring-overlay/src/server.cjs", "modules/twitch-holo-chat/web/overlay.html"
];
for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).size) throw new Error(`Integrierte Datei fehlt oder ist leer: ${relative}`);
}

console.log(`Batto OBS Tool 2.0.0: ${required.length} Kernbestandteile korrekt zusammengesetzt.`);
