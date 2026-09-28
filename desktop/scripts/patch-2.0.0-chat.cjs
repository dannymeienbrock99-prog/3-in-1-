"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// Keep the existing Twitch login correction when the v2 service is present.
const legacyChat = path.join(root, "src", "services", "multi-chat-v2.cjs");
if (fs.existsSync(legacyChat)) {
  let content = fs.readFileSync(legacyChat, "utf8");
  const before = '        const nick = this.secrets.twitchOAuth ? `justinfan${Math.floor(Math.random() * 90000 + 10000)}` : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;';
  const after = '        const nick = this.secrets.twitchOAuth ? target : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;';
  if (content.includes(before)) {
    content = content.replace(before, after);
    fs.writeFileSync(legacyChat, content, "utf8");
  }
}

// The integrated prepare step regenerates preload.cjs from bootstrap-2.0 and used to
// remove the Unified Multi-Chat bridge from PR #12. Restore that bridge after every prepare.
const preload = path.join(root, "src", "preload.cjs");
let preloadText = fs.readFileSync(preload, "utf8");
if (!preloadText.includes("chatHistory:")) {
  const marker = "  onStateChanged(callback) {";
  if (!preloadText.includes(marker)) throw new Error("Unified-Multi-Chat: Preload-Patchpunkt fehlt.");
  const bridge = `  // Unified Multi-Chat API. Raw IPC is intentional: these handlers do not use the legacy response envelope.\n  chatHistory: (options) => ipcRenderer.invoke("chat:history", options),\n  chatStatuses: () => ipcRenderer.invoke("chat:statuses"),\n  chatConnect: (platform, config) => ipcRenderer.invoke("chat:connect", platform, config),\n  chatDisconnect: (platform) => ipcRenderer.invoke("chat:disconnect", platform),\n  chatClear: (platform) => ipcRenderer.invoke("chat:unified-clear", platform),\n  chatToggleWindow: () => ipcRenderer.invoke("chat:toggle-window"),\n  chatWindowStatus: () => ipcRenderer.invoke("chat:window-status"),\n  setChatAlwaysOnTop: (value) => ipcRenderer.invoke("chat:window-always-on-top", value),\n  saveCngConfig: (value) => ipcRenderer.invoke("cng:save-config", value),\n  getCngConfig: () => ipcRenderer.invoke("cng:get-config"),\n  getTtsConfig: () => ipcRenderer.invoke("tts:get-config"),\n  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),\n  onChatMessages: (callback) => on("chat:messages", callback),\n  onChatStatus: (callback) => on("chat:status", callback),\n  onChatCleared: (callback) => on("chat:cleared", callback),\n  onChatWindow: (callback) => on("chat:window", callback),\n`;
  preloadText = preloadText.replace(marker, bridge + marker);
  fs.writeFileSync(preload, preloadText, "utf8");
}

if (!preloadText.includes("chatOverlayStatus:")) {
  const marker = "  onStateChanged(callback) {";
  if (!preloadText.includes(marker)) throw new Error("OBS-Chat-Overlay: Preload-Patchpunkt fehlt.");
  const overlayBridge = `  chatOverlayStatus: () => ipcRenderer.invoke("chat:overlay-status"),\n  chatOverlayCopyUrl: () => ipcRenderer.invoke("chat:overlay-copy-url"),\n  chatOverlayOpen: () => ipcRenderer.invoke("chat:overlay-open"),\n  chatOverlayInstall: (config) => ipcRenderer.invoke("chat:overlay-install", config),\n  chatOverlayRemove: () => ipcRenderer.invoke("chat:overlay-remove"),\n`;
  preloadText = preloadText.replace(marker, overlayBridge + marker);
  fs.writeFileSync(preload, preloadText, "utf8");
}

// main.cjs already owns the legacy chat:clear IPC handler. Give the Unified Chat its
// own clear channel so chat-bootstrap can register all of its handlers instead of aborting.
const bootstrap = path.join(root, "src", "chat-bootstrap.cjs");
let bootstrapText = fs.readFileSync(bootstrap, "utf8");
bootstrapText = bootstrapText.replace('ipcMain.handle("chat:clear", (_event, platform)', 'ipcMain.handle("chat:unified-clear", (_event, platform)');
fs.writeFileSync(bootstrap, bootstrapText, "utf8");

for (const required of ["chatHistory:", "onChatWindow:", "chatOverlayInstall:", 'ipcMain.handle("chat:unified-clear"']) {
  const haystack = required.startsWith("ipcMain") ? bootstrapText : preloadText;
  if (!haystack.includes(required)) throw new Error(`Unified-Multi-Chat-Patch fehlt: ${required}`);
}

console.log("Batto OBS Tool 2.0.0: Unified Multi-Chat Bridge, abtrennbares Chatfenster und IPC-Konflikt korrigiert.");
