"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const errors = [];

function fail(message) { errors.push(message); }
function read(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { fail(`Datei fehlt: ${relative}`); return ""; }
  const content = fs.readFileSync(file, "utf8");
  if (!content.trim()) fail(`Datei ist leer: ${relative}`);
  return content;
}
function requireText(content, pattern, message) {
  if (pattern instanceof RegExp ? !pattern.test(content) : !content.includes(pattern)) fail(message);
}
function forbidText(content, pattern, message) {
  if (pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)) fail(message);
}

const required = [
  "src/main.cjs", "src/chat-bootstrap.cjs", "src/preload.cjs", "src/renderer/index.html", "src/renderer/styles.css", "src/renderer/app.js",
  "src/renderer/multi-chat.html", "src/renderer/multi-chat.js", "src/renderer/multi-chat.css", "src/renderer/chat-overlay-controls.js",
  "src/stream-overlay/chat-overlay.html", "src/stream-overlay/chat-overlay.css", "src/stream-overlay/chat-overlay.js",
  "src/renderer/integrated.js", "src/renderer/integrated.css", "src/renderer/assets/team-alpha-logo.svg",
  "src/services/hardware.cjs", "src/services/recommendation.cjs", "src/services/obs-websocket.cjs", "src/services/obs-chat-overlay.cjs",
  "src/services/common.cjs", "src/services/deck-store.cjs", "src/services/plugin-registry.cjs",
  "src/services/native-plugin-additions.cjs", "src/services/action-executor.cjs", "src/services/migration.cjs",
  "src/services/mobile-bridge.cjs", "src/services/multi-chat.cjs", "src/services/stream-overlay-server.cjs",
  "src/services/twitch-holo-server.cjs", "src/mobile/index.html", "src/mobile/styles.css", "src/mobile/app.js",
  "src/stream-overlay/editor.html", "src/stream-overlay/editor.css", "src/stream-overlay/editor.js",
  "src/stream-overlay/overlay.html", "src/stream-overlay/overlay.css", "src/stream-overlay/overlay.js",
  "src/stream-overlay/team-logo.svg", "modules/encoder-monitoring-overlay/src/server.cjs",
  "modules/encoder-monitoring-overlay/src/telemetry.cjs", "modules/encoder-monitoring-overlay/web/overlay.css",
  "modules/twitch-holo-chat/web/overlay.html", "modules/twitch-holo-chat/web/overlay.js",
  "build/installer.nsh", "build/license.txt", "resources/team-logo.svg", "package.json"
];
required.forEach(read);

const syntaxFiles = required.filter((relative) => /\.(?:cjs|js)$/.test(relative));
for (const relative of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relative)], { encoding: "utf8" });
  if (result.status !== 0) fail(`Syntaxfehler in ${relative}:\n${result.stderr || result.stdout}`);
}

let packageJson = {};
try { packageJson = JSON.parse(read("package.json") || "{}"); }
catch (error) { fail(`package.json ist ungültig: ${error.message}`); }
if (packageJson.name !== "batto-obs-tool") fail("package.json: Name muss batto-obs-tool sein.");
if (packageJson.version !== "2.0.0") fail("package.json: Version muss 2.0.0 sein.");
if (packageJson.main !== "src/main.cjs") fail("package.json: Haupteinstieg muss src/main.cjs sein.");
if (packageJson.build?.productName !== "Batto OBS Tool") fail("package.json: Produktname ist falsch.");
if (packageJson.build?.nsis?.oneClick !== false) fail("Installer muss den Assistent-Modus verwenden.");
if (packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) fail("Installationsordner muss auswählbar sein.");
if (packageJson.build?.nsis?.runAfterFinish !== false) fail("Installer darf die App nicht automatisch starten.");
if (packageJson.build?.nsis?.include !== "build/installer.nsh") fail("Installer-Erweiterung fehlt.");
if (!packageJson.dependencies?.ws || !packageJson.dependencies?.qrcode) fail("WebSocket- oder QR-Abhängigkeit fehlt.");
if (!String(packageJson.scripts?.test || "").includes("integrated-2.0.0.test.cjs")) fail("2.0.0-Integrationstest ist nicht eingebunden.");

const main = read("src/main.cjs");
const preload = read("src/preload.cjs");
const index = read("src/renderer/index.html");
const appJs = read("src/renderer/app.js");
const integratedJs = read("src/renderer/integrated.js");
const integratedCss = read("src/renderer/integrated.css");
const mobileBridge = read("src/services/mobile-bridge.cjs");
const mobileHtml = read("src/mobile/index.html");
const mobileJs = read("src/mobile/app.js");
const pluginRegistry = read("src/services/plugin-registry.cjs");
const pluginAdditions = read("src/services/native-plugin-additions.cjs");
const actionExecutor = read("src/services/action-executor.cjs");
const deckStore = read("src/services/deck-store.cjs");
const migration = read("src/services/migration.cjs");
const multiChat = read("src/services/multi-chat.cjs");
const streamOverlayCss = read("src/stream-overlay/overlay.css");
const monitoringCss = read("modules/encoder-monitoring-overlay/web/overlay.css");
const hardware = read("src/services/hardware.cjs");
const obsClient = read("src/services/obs-websocket.cjs");

requireText(main, "requestSingleInstanceLock", "Single-Instance-Sperre fehlt.");
requireText(main, /new MobileBridge\(/, "Handy-Brücke wird nicht gestartet.");
requireText(main, /new StreamOverlayServer\(/, "Stream-Overlay wird nicht gestartet.");
requireText(main, /new MonitoringOverlayServer\(/, "Monitoring-Overlay wird nicht gestartet.");
requireText(main, /new TwitchHoloServer\(/, "Twitch-Hologramm wird nicht gestartet.");
requireText(main, 'sampler?.sample?.(hardware)', "Hardware wird nicht an die Telemetrie übergeben.");
requireText(main, 'gpu: preferredGpu()', "Encoder-Empfehlung verwendet nicht die bevorzugte GPU.");
requireText(main, 'handle("obs:forget-password"', "Gespeichertes OBS-Passwort kann nicht gelöscht werden.");
forbidText(main, /mobileBridge\s*=\s*null\s*;\s*\/\/.*deaktiv/i, "Handy-Brücke ist im Produktionscode deaktiviert.");

requireText(obsClient, /ws:\/\/\$\{formatted\}:\$\{/, "OBS-WebSocket-Adresse wird nicht gültig formatiert.");
requireText(obsClient, "127.0.0.1", "Lokaler OBS-Loopback fehlt.");
requireText(obsClient, "::1", "IPv6-Loopback fehlt.");
requireText(obsClient, "authentication(password", "OBS-WebSocket-Authentifizierung fehlt.");
requireText(hardware, "selectPreferredGpu", "Auswahl der dedizierten GPU fehlt.");
requireText(hardware, /score \+= 500/, "NVIDIA-GPU wird nicht bevorzugt.");
requireText(hardware, /score -= 1000/, "Integrierte GPU wird nicht abgewertet.");

requireText(index, "Version 2.0.0", "Hauptfenster zeigt nicht Version 2.0.0.");
requireText(index, "integrated.css", "Integrierte Styles werden nicht geladen.");
requireText(index, "integrated.js", "Integrierte Oberfläche wird nicht geladen.");
for (const label of ["Stream-Overlay", "Multi-Chat", "OBS Gäste", "Plugins", "Touch-Deck Pro", "Handy verbinden", "Übernahme & Diagnose"]) {
  requireText(integratedJs, label, `Navigationsbereich fehlt: ${label}`);
}
requireText(integratedCss, "overflow-x: hidden", "Horizontaler Überlauf ist nicht abgesichert.");
requireText(integratedCss, "@media (max-width: 980px)", "Schmale Fenster werden nicht responsiv behandelt.");

const visible = [index, appJs, integratedJs, mobileHtml, mobileJs, read("src/stream-overlay/editor.html"), read("src/stream-overlay/editor.js"), read("src/stream-overlay/overlay.html"), read("src/stream-overlay/overlay.js")].join("\n");
forbidText(visible, /Creator Hub/i, "Alte Produktbezeichnung ist in einer sichtbaren Oberfläche enthalten.");
forbidText(visible, /\bKandidat\b/i, "Alte Encoderbezeichnung „Kandidat“ ist sichtbar.");
forbidText(visible, /show-test-values|Testwerte anzeigen|createTestTelemetry/i, "Veröffentlichte Demo-/Testwerte-Funktion gefunden.");
forbidText(index, /Encorder/i, "Falsche Schreibweise „Encorder“ im Hauptfenster.");

requireText(streamOverlayCss, /background:\s*transparent\s*!important/, "Stream-Overlay ist nicht vollständig transparent.");
requireText(monitoringCss, /background:\s*transparent\s*!important/, "Monitoring-Overlay ist nicht vollständig transparent.");
forbidText(monitoringCss, /body[^}]*background:\s*#0[0-9a-f]{5}/i, "Monitoring-Overlay enthält einen vollflächigen dunklen Hintergrund.");

requireText(mobileBridge, "battoobstool://pair", "Neues Batto-Kopplungsschema fehlt.");
requireText(mobileBridge, "creatorhub://pair", "Kompatibles Kopplungsschema der alten APK fehlt.");
requireText(mobileBridge, 'this.server.listen(port, "0.0.0.0")', "Handy-Server ist nicht im lokalen Netzwerk erreichbar.");
requireText(mobileBridge, "randomPin()", "Sechsstellige Handy-PIN fehlt.");
requireText(mobileBridge, "QRCode.toDataURL", "QR-Code-Erzeugung fehlt.");
requireText(mobileHtml, "Batto OBS Tool", "Mobile Oberfläche ist nicht umbenannt.");

requireText(deckStore, "rows * columns", "Variables Touch-Deck-Raster fehlt.");
requireText(deckStore, "moveButton", "Drag-and-drop-Datenoperation fehlt.");
requireText(deckStore, "delayMs", "Mehrfachaktions-Verzögerung fehlt.");
forbidText(deckStore, /buttons\s*=\s*buttons\.slice\(0,\s*capacity\)/, "Rasterverkleinerung würde Belegungen löschen.");
requireText(migration, "copyDirectoryMissing", "Nicht überschreibende Altdatenmigration fehlt.");
requireText(migration, "Creator Hub", "Legacy-Pfade werden nicht erkannt.");

requireText(pluginRegistry, "EXTRA_BUILT_IN_PLUGINS", "Zusätzliche native Plugin-Kompatibilität wird nicht geladen.");
for (const name of [
  "YouTube Music Desktop Connector", "YouTube Ticker", "iCUE", "BambuLab Printer Monitor", "Spotify",
  "Volume Controller", "Discord Volume Mixer", "TikFinity", "TikTok LIVE Studio", "Polls, Word Clouds & Spinner Wheels"
]) requireText(pluginAdditions, name, `Native Plugin-Kompatibilität fehlt: ${name}`);
for (const action of ["icue.launch", "bambulab.launch", "spotify.launch", "volume.mixer", "youtube.music.open", "youtube.ticker.status"]) {
  requireText(actionExecutor, action, `Native Aktionslaufzeit fehlt: ${action}`);
}
requireText(actionExecutor, "wird ohne passende Laufzeit nicht ausgeführt", "Unbekannte Plugin-Aktionen würden keinen klaren Fehler liefern.");

requireText(multiChat, "persistSettings()", "Multi-Chat-Einstellungen werden nicht sicher getrennt gespeichert.");
requireText(multiChat, 'stored.twitch.oauth = ""', "Twitch-Token würde unverschlüsselt gespeichert.");
requireText(multiChat, 'stored.youtube.apiKey = ""', "YouTube-Schlüssel würde unverschlüsselt gespeichert.");
requireText(preload, "contextBridge", "Sichere Electron-Brücke fehlt.");
forbidText(main, /nodeIntegration:\s*true/, "Node-Integration ist im Renderer aktiviert.");
requireText(preload, "legacyState", "Bestehende 1.9-Oberfläche hat keine Kompatibilitätsschicht.");

if (errors.length) {
  console.error(`Batto OBS Tool 2.0.0 – ${errors.length} Prüfung(en) fehlgeschlagen:`);
  errors.forEach((error, indexValue) => console.error(`${indexValue + 1}. ${error}`));
  process.exit(1);
}

console.log(`Batto OBS Tool 2.0.0 – ${required.length} Dateien, ${syntaxFiles.length} Syntaxprüfungen und alle Produktionsregeln bestanden.`);
