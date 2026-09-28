"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const SAFE_INVOKE_CHANNELS = new Set([
  "state:get",
  "plugins:scan", "plugins:enable", "plugins:settings",
  "deck:create-profile", "deck:update-profile", "deck:delete-profile", "deck:activate-profile",
  "deck:create-folder", "deck:update-folder", "deck:delete-folder", "deck:activate-folder",
  "deck:update-button", "deck:move-button", "deck:clear-button", "deck:execute-button",
  "deck:quick-media", "deck:export", "deck:import",
  "deck:original-0802-status", "deck:open-original-0802",
  "chat:overlay-status", "chat:overlay-copy-url", "chat:overlay-open", "chat:overlay-install", "chat:overlay-remove",
  "mobile:status", "mobile:start", "mobile:regenerate-pin", "mobile:set-approval", "mobile:approve", "mobile:reject", "mobile:disconnect"
]);

function invoke(channel, payload) {
  if (!SAFE_INVOKE_CHANNELS.has(channel)) return Promise.reject(new Error(`IPC-Kanal nicht freigegeben: ${channel}`));
  return ipcRenderer.invoke(channel, payload);
}

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("batto", Object.freeze({
  suite: (command,value) => { if(!['state','command','settings','listen','stop','devices','scenes','fan-config','profile','csv','voice-folder','copy-obs','open-obs','export-layout','import-layout','export-curve','plugin','forget-memory'].includes(command)) return Promise.reject(new Error('Unbekannte Suite-Aktion')); return ipcRenderer.invoke('suite:'+command,value); },
  onSuiteState: callback => on('suite:state',callback),
  onJarvisMessage: callback => on('suite:message',callback),
  onJarvisVoice: callback => on('suite:voice',callback),
  invoke,
  getState: () => ipcRenderer.invoke("app:get-state"),
  saveSettings: (value) => ipcRenderer.invoke("settings:save", value),

  connectObs: (options) => ipcRenderer.invoke("obs:connect", options),
  disconnectObs: () => ipcRenderer.invoke("obs:disconnect"),
  forgetObsPassword: () => ipcRenderer.invoke("obs:forget-password"),
  getObsSnapshot: () => ipcRenderer.invoke("obs:snapshot"),
  executeObs: (action, payload) => ipcRenderer.invoke("obs:execute", action, payload),
  runObsRecordingTest: (options) => ipcRenderer.invoke("obs:recording-test", options),

  getHoloStatus: () => ipcRenderer.invoke("holo:status"),
  openHoloEditor: () => ipcRenderer.invoke("holo:open-editor"),
  copyHoloUrl: () => ipcRenderer.invoke("holo:copy-url"),
  executeDeckAction: (assignment) => ipcRenderer.invoke("deck:execute", assignment),
  saveReport: (report) => ipcRenderer.invoke("dialog:save-report", report),

  hybridStatus: () => ipcRenderer.invoke("hybrid:status"),
  runHealthCheck: () => ipcRenderer.invoke("hybrid:health-check"),
  refreshConnections: () => ipcRenderer.invoke("hybrid:refresh"),
  getPlatformSecretStatus: () => ipcRenderer.invoke("hybrid:secret-status"),
  setPlatformSecret: (name, value) => ipcRenderer.invoke("hybrid:set-secret", name, value),
  detectTikTokLiveStudio: () => ipcRenderer.invoke("tiktok-live-studio:status"),
  launchTikTokLiveStudio: () => ipcRenderer.invoke("tiktok-live-studio:launch"),

  chatHistory: (options) => ipcRenderer.invoke("chat:history", options),
  chatStatuses: () => ipcRenderer.invoke("chat:statuses"),
  chatConnect: (platform, config) => ipcRenderer.invoke("chat:connect", platform, config),
  chatDisconnect: (platform) => ipcRenderer.invoke("chat:disconnect", platform),
  chatClear: (platform) => ipcRenderer.invoke("chat:unified-clear", platform),
  chatToggleWindow: () => ipcRenderer.invoke("chat:toggle-window"),
  chatWindowStatus: () => ipcRenderer.invoke("chat:window-status"),
  setChatAlwaysOnTop: (value) => ipcRenderer.invoke("chat:window-always-on-top", value),
  chatOverlayStatus: () => ipcRenderer.invoke("chat:overlay-status"),
  chatOverlayCopyUrl: () => ipcRenderer.invoke("chat:overlay-copy-url"),
  chatOverlayOpen: () => ipcRenderer.invoke("chat:overlay-open"),
  chatOverlayInstall: (options) => ipcRenderer.invoke("chat:overlay-install", options),
  chatOverlayRemove: () => ipcRenderer.invoke("chat:overlay-remove"),
  saveCngConfig: (value) => ipcRenderer.invoke("cng:save-config", value),
  getCngConfig: () => ipcRenderer.invoke("cng:get-config"),
  getTtsConfig: () => ipcRenderer.invoke("tts:get-config"),
  saveTtsConfig: (value) => ipcRenderer.invoke("tts:save-config", value),

  scanPlugins: () => invoke("plugins:scan", {}),
  enablePlugin: (id, enabled) => invoke("plugins:enable", { pluginId: id, enabled }),
  updatePluginSettings: (id, settings) => invoke("plugins:settings", { pluginId: id, settings }),

  mobileStatus: () => invoke("mobile:status", {}),
  mobileStart: () => invoke("mobile:start", {}),
  mobileRegeneratePin: () => invoke("mobile:regenerate-pin", {}),
  mobileSetApproval: (value) => invoke("mobile:set-approval", value),
  mobileApprove: (id) => invoke("mobile:approve", id),
  mobileReject: (id) => invoke("mobile:reject", id),
  mobileDisconnect: (id) => invoke("mobile:disconnect", id),

  onStateChanged: (callback) => on("state:update", callback),
  onObsStatusChanged: (callback) => on("obs:status-changed", callback),
  onConnectionStatus: (callback) => on("connections:status", callback),
  onChatMessages: (callback) => on("chat:messages", callback),
  onChatStatus: (callback) => on("chat:status", callback),
  onChatCleared: (callback) => on("chat:cleared", callback),
  onChatWindow: (callback) => on("chat:window", callback)
}));
