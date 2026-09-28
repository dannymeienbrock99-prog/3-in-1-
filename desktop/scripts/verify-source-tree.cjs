"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "src/main-v2.cjs", "src/main.cjs", "src/preload.cjs", "src/chat-bootstrap.cjs", "src/deck-bootstrap.cjs", "src/deck-creatorhub-bootstrap.cjs", "src/stream-overlay-bootstrap.cjs", "src/mobile-bootstrap.cjs",
  "src/services/common.cjs", "src/services/deck-store.cjs", "src/services/plugin-registry.cjs", "src/services/store.cjs", "src/services/secret-store.cjs", "src/services/obs-websocket.cjs", "src/services/connection-manager.cjs", "src/services/hybrid-runtime.cjs", "src/services/tiktok-live-studio.cjs", "src/services/stream-overlay-server.cjs", "src/services/mobile-bridge-v2.cjs",
  "src/services/platforms/tiktok-adapter.cjs", "src/services/platforms/tiktok-hybrid-adapter.cjs", "src/services/platforms/tiktok-direct-adapter.cjs", "src/services/platforms/twitch-adapter.cjs", "src/services/platforms/youtube-adapter.cjs", "src/services/platforms/cng-adapter.cjs",
  "src/renderer/index.html", "src/renderer/app.js", "src/renderer/commercial-settings.js", "src/renderer/commercial-settings.css", "src/renderer/multi-chat.js", "src/renderer/multi-chat.css", "src/renderer/touch-deck-20260802.js", "src/renderer/touch-deck-20260802.css", "src/renderer/integration-20260904.js", "src/renderer/integration-20260904.css", "src/renderer/restored-tools.js", "src/renderer/restored-tools.css", "src/renderer/assets/multi-chat-dashboard.svg",
  "src/stream-overlay/chat-overlay.html", "src/stream-overlay/chat-overlay.css", "src/stream-overlay/chat-overlay.js", "src/stream-overlay/editor.html", "src/stream-overlay/overlay.html", "src/stream-overlay/cohost-tiktok.html", "src/stream-overlay/cohost-twitch.html",
  "modules/twitch-holo-chat/web/editor.html", "modules/twitch-holo-chat/web/editor.css", "modules/twitch-holo-chat/web/font-editor-addon.js", "modules/twitch-holo-chat/web/font-overlay-addon.js",
  "scripts/prepare-original-touchdeck.cjs", "scripts/patch-cohost-runtime.cjs", "scripts/patch-cohost-ui.cjs", "scripts/patch-plugin-truth.cjs"
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Produktionsdatei fehlt: ${relative}`);
  if (!fs.statSync(absolute).size) throw new Error(`Produktionsdatei ist leer: ${relative}`);
}

const syntaxFiles = required.filter((file) => /\.(?:cjs|js)$/.test(file));
for (const relative of syntaxFiles) execFileSync(process.execPath, ["--check", path.join(root, relative)], { stdio:"pipe" });

const index = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
for (const marker of ["touch-deck-20260802.css","touch-deck-20260802.js","integration-20260904.css","integration-20260904.js","commercial-settings.css","commercial-settings.js","multi-chat.css","multi-chat.js","restored-tools.css","restored-tools.js","multi-chat-dashboard.svg","view-overview","view-obs","multi-chat-root","view-deck-0802","view-moderation","view-cohost","view-holo","view-stream-overlay","view-plugins","view-mobile","view-settings"]) {
  if (!index.includes(marker)) throw new Error(`Renderer-Einbindung fehlt: ${marker}`);
}
for (const forbidden of ["Hardwarediagnose","Encoder- und Hardware-Monitoring","settings-compat.js","product-cleanup.js","Touch-Deck Pro","view-deck-pro","touch-deck-pro-v2.js","touch-deck-pro-v2.css","./assets/bg.jpg"]) {
  if (index.includes(forbidden)) throw new Error(`Unerwünschte Alt-/Pro-UI ist noch eingebunden: ${forbidden}`);
}

const preload = fs.readFileSync(path.join(root, "src", "preload.cjs"), "utf8");
for (const marker of ["SAFE_INVOKE_CHANNELS", '"deck:execute-button"', '"deck:open-original-0802"', '"deck:original-0802-status"', '"plugins:scan"', '"mobile:status"', "onStateChanged", 'ipcRenderer.invoke("chat:unified-clear"']) {
  if (!preload.includes(marker)) throw new Error(`Preload-Verdrahtung fehlt: ${marker}`);
}
for (const forbidden of ["hardware:scan","diagnostics:cpu-load","monitoring:status","telemetry:update"]) if (preload.includes(forbidden)) throw new Error(`Entfernte Diagnose-IPC ist noch im Preload: ${forbidden}`);

const entry = fs.readFileSync(path.join(root, "src", "main-v2.cjs"), "utf8");
for (const marker of ["stream-overlay-bootstrap.cjs","deck-bootstrap.cjs","deck-creatorhub-bootstrap.cjs","chat-bootstrap.cjs","mobile-bootstrap.cjs"]) if (!entry.includes(marker)) throw new Error(`2.1-Einstieg lädt Runtime-Modul nicht: ${marker}`);
if (/enrichHardware|SystemTelemetrySampler|collectHardware/.test(entry)) throw new Error("2.1-Einstieg darf keine Hardwarediagnose laden.");

const main = fs.readFileSync(path.join(root, "src", "main.cjs"), "utf8");
for (const forbidden of ["collectHardware","SystemTelemetrySampler","MonitoringOverlayServer","hardware:scan","diagnostics:cpu-load","monitoring:status"]) if (main.includes(forbidden)) throw new Error(`Hardware-/Monitoring-Runtime ist noch aktiv: ${forbidden}`);

const chat = fs.readFileSync(path.join(root, "src", "chat-bootstrap.cjs"), "utf8");
for (const marker of ["startStreamOverlay","ensureChatObs","twitch-oauth-token","youtube-oauth-token","TikTokAdapter"]) if (!chat.includes(marker)) throw new Error(`Multi-Chat-Produktverdrahtung fehlt: ${marker}`);
const tikTokHybrid = fs.readFileSync(path.join(root, "src", "services", "platforms", "tiktok-hybrid-adapter.cjs"), "utf8");
for (const marker of ["ws://127.0.0.1:21213/","TikFinity","normalizeTikFinityPayload","scheduleReconnect"]) if (!tikTokHybrid.includes(marker)) throw new Error(`TikFinity-Hybridadapter fehlt: ${marker}`);
const multiChat = fs.readFileSync(path.join(root, "src", "renderer", "multi-chat.js"), "utf8");
for (const marker of ["batto-moderation-v1","api.onChatMessages"]) if (!multiChat.includes(marker)) throw new Error(`Multi-Chat-Renderer fehlt: ${marker}`);

const youtube = fs.readFileSync(path.join(root, "src", "services", "platforms", "youtube-adapter.cjs"), "utf8");
if (!youtube.includes("youtube/v3/liveChat/messages") || !youtube.includes("pollingIntervalMillis")) throw new Error("YouTube-Live-Chat-Transport ist nicht implementiert.");
const twitch = fs.readFileSync(path.join(root, "src", "services", "platforms", "twitch-adapter.cjs"), "utf8");
if (!twitch.includes("366") || !twitch.includes("Zeitüberschreitung beim Verbinden")) throw new Error("Twitch-Kanalbeitritt/Timeout ist nicht robust verdrahtet.");

const integration = fs.readFileSync(path.join(root, "src", "renderer", "integration-20260904.js"), "utf8");
for (const marker of ["Als Moderator hinzufügen","Als Moderator entfernen","Stummen","Blockieren","Entstummen","Entblocken","BATTO_COHOST_REAL_URLS","/cohost/tiktok","/cohost/twitch"]) if (!integration.includes(marker)) throw new Error(`Moderation/Co-Host fehlt: ${marker}`);
const overlayServer = fs.readFileSync(path.join(root, "src", "services", "stream-overlay-server.cjs"), "utf8");
for (const marker of ["BATTO_COHOST_STABLE_ROUTES","/cohost/tiktok","/cohost/twitch","/api/cohost","cohost.json"]) if (!overlayServer.includes(marker)) throw new Error(`Co-Host-Runtime fehlt: ${marker}`);

const originalDeck = fs.readFileSync(path.join(root, "src", "deck-creatorhub-bootstrap.cjs"), "utf8");
for (const marker of ["51be33d29c07f50323b19d58782804af391b8394","CreatorHub.TouchDeck.exe","deck:open-original-0802"]) if (!originalDeck.includes(marker)) throw new Error(`Original-TouchDeck-Verdrahtung fehlt: ${marker}`);
const prepareDeck = fs.readFileSync(path.join(root, "scripts", "prepare-original-touchdeck.cjs"), "utf8");
for (const marker of ["51be33d29c07f50323b19d58782804af391b8394","SOURCE-COMMIT.txt","separat gebaut"]) if (!prepareDeck.includes(marker)) throw new Error(`TouchDeck-Suite-Verknüpfung fehlt: ${marker}`);

const pluginUi = fs.readFileSync(path.join(root, "src", "renderer", "restored-tools.js"), "utf8");
for (const marker of ["BATTO_PLUGIN_TRUTHFUL_STATUS","nur erkannt","Laufzeit nicht bestätigt","plugin-open-touchdeck"]) if (!pluginUi.includes(marker)) throw new Error(`Wahrheitsgemäße Plugin-Anzeige fehlt: ${marker}`);

const holoHtml = fs.readFileSync(path.join(root, "modules", "twitch-holo-chat", "web", "editor.html"), "utf8");
for (const marker of ["Benutzername gestalten","Chat-Nachricht gestalten","font-editor-addon.js","preview-frame"]) if (!holoHtml.includes(marker)) throw new Error(`Twitch-Hologramm-Umbau fehlt: ${marker}`);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.main !== "src/main-v2.cjs") throw new Error("package.json muss src/main-v2.cjs als Programmeinstieg verwenden.");
if (packageJson.version !== "2.1.0") throw new Error(`Unerwartete Version: ${packageJson.version}`);
const prepareScript = String(packageJson.scripts?.["prepare:integrated"] || "");
if (prepareScript.includes("prepare-touch-deck-pro-v2")) throw new Error("Touch-Deck Pro wird noch beim Build injiziert.");
for (const marker of ["prepare:touchdeck-0802","patch-cohost-runtime.cjs","patch-cohost-ui.cjs","patch-plugin-truth.cjs"]) if (!prepareScript.includes(marker)) throw new Error(`Produktions-Patch fehlt im Build: ${marker}`);
const resources = JSON.stringify(packageJson.build?.extraResources || []);
if (!resources.includes("touchdeck-0802")) throw new Error("TouchDeck-Suite-Marker wird nicht in den Installer übernommen.");
const files = JSON.stringify(packageJson.build?.files || []);
if (files.includes("encoder-monitoring-overlay")) throw new Error("Encoder-Monitoring wird noch ausgeliefert.");

console.log(`Sauberer 2.1-Produktionsbaum geprüft: ${required.length} Dateien, ${syntaxFiles.length} Syntaxprüfungen OK.`);
