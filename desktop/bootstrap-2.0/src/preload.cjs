"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set([
  "state:get", "hardware:scan", "hardware:save-report", "internet:test", "cpu:test",
  "obs:connect", "obs:disconnect", "obs:forget-password", "obs:refresh", "obs:call", "obs:record-test", "recommendation:build",
  "deck:create-profile", "deck:update-profile", "deck:delete-profile", "deck:activate-profile",
  "deck:create-folder", "deck:update-folder", "deck:delete-folder", "deck:activate-folder",
  "deck:update-button", "deck:move-button", "deck:clear-button", "deck:execute-button", "deck:export", "deck:import",
  "action:execute", "plugins:scan", "plugins:enable", "plugins:settings", "plugins:import",
  "mobile:status", "mobile:approve", "mobile:reject", "mobile:revoke", "mobile:regenerate-pin", "mobile:approval",
  "stream-overlay:status", "stream-overlay:open", "stream-overlay:copy-url", "stream-overlay:event", "stream-overlay:clear",
  "monitoring:open", "monitoring:copy-url", "holo:open", "holo:copy-url", "holo:message", "holo:clear",
  "chat:update-settings", "chat:twitch-connect", "chat:twitch-disconnect", "chat:twitch-send",
  "chat:youtube-connect", "chat:youtube-disconnect", "chat:clear", "chat:test", "chat:tts-skip", "chat:tts-clear",
  "guests:list", "guests:apply", "settings:update", "migration:run",
  "app:open-path", "app:open-url", "app:copy", "app:close"
]);

function invoke(channel, payload = {}) {
  if (!CHANNELS.has(channel)) return Promise.reject(new Error(`IPC-Kanal nicht erlaubt: ${channel}`));
  return ipcRenderer.invoke(channel, payload).then((response) => {
    if (!response?.ok) {
      const error = new Error(response?.error?.message || "Batto OBS Tool: unbekannter Fehler");
      error.code = response?.error?.code || "";
      error.name = response?.error?.name || "Error";
      throw error;
    }
    return response.value;
  });
}

function telemetryForLegacy(value) {
  if (!value) return value;
  return {
    ...value,
    system: {
      cpu: value.cpu || value.system?.cpu || null,
      ram: value.ram || value.system?.ram || null,
      network: value.network || value.system?.network || null
    }
  };
}

function actionToLegacy(action) {
  if (!action) return null;
  const type = String(action.type || "");
  if (type === "obs.scene") return { type: "obs", action: "scene.set", title: action.title, payload: { sceneName: action.settings?.sceneName || "" } };
  if (type === "obs.stream.toggle") return { type: "obs", action: "stream.toggle", title: action.title };
  if (type === "obs.record.toggle") return { type: "obs", action: "record.toggle", title: action.title };
  if (type === "obs.virtualcam.toggle") return { type: "obs", action: "virtualcam.toggle", title: action.title };
  if (type === "system.url") return { type: "url", title: action.title, url: action.settings?.url || "" };
  if (type === "monitoring:open") return { type: "monitoring-editor", title: action.title };
  if (type === "holo:open") return { type: "holo-editor", title: action.title };
  return { type, title: action.title || type };
}

function deckForLegacy(deck, configured) {
  if (configured && typeof configured === "object") return configured;
  const profiles = {};
  for (const profile of deck?.profiles || []) {
    const root = profile.folders?.find((folder) => folder.id === "root") || profile.folders?.[0];
    profiles[profile.name] = {
      rows: root?.rows || 3,
      columns: root?.columns || 5,
      pages: {
        root: (root?.buttons || []).map((button) => button?.actions?.length ? actionToLegacy(button.actions[0]) : null)
      }
    };
  }
  const active = deck?.profiles?.find((profile) => profile.id === deck.activeProfileId)?.name || Object.keys(profiles)[0] || "Standard";
  return { activeProfile: active, profiles };
}

function legacyState(value) {
  const settings = value?.settings || {};
  return {
    ...value,
    product: { name: value?.app?.name || "Batto OBS Tool", version: value?.app?.version || "2.0.0" },
    settings: {
      ...settings,
      obs: { ...settings.obs, passwordStored: Boolean(settings.obs?.passwordStored) },
      preferences: {
        platform: settings.encoder?.platform || "twitch",
        targetResolution: settings.encoder?.resolution || "1920x1080",
        targetFps: Number(settings.encoder?.fps) || 60
      },
      deck: deckForLegacy(value?.deck, settings.legacyDeck)
    },
    internetResult: value?.internet || value?.internetResult || null,
    telemetry: telemetryForLegacy(value?.telemetry),
    obs: value?.obs || { connected: false },
    monitoringStatus: value?.modules?.monitoring || null,
    holoStatus: value?.modules?.twitchHolo || null
  };
}

function obsRequestForLegacy(action, payload = {}) {
  const map = {
    "stream.start": ["StartStream", {}],
    "stream.stop": ["StopStream", {}],
    "stream.toggle": ["ToggleStream", {}],
    "record.start": ["StartRecord", {}],
    "record.stop": ["StopRecord", {}],
    "record.toggle": ["ToggleRecord", {}],
    "virtualcam.start": ["StartVirtualCam", {}],
    "virtualcam.stop": ["StopVirtualCam", {}],
    "virtualcam.toggle": ["ToggleVirtualCam", {}],
    "scene.set": ["SetCurrentProgramScene", { sceneName: payload.sceneName }]
  };
  const request = map[action];
  if (!request) throw new Error(`Unbekannte OBS-Aktion: ${action}`);
  return { requestType: request[0], requestData: request[1] };
}

function actionForLegacyAssignment(assignment = {}) {
  if (assignment.type === "obs") {
    const map = {
      "scene.set": { type: "obs.scene", settings: { sceneName: assignment.payload?.sceneName || "" } },
      "stream.toggle": { type: "obs.stream.toggle", settings: {} },
      "record.toggle": { type: "obs.record.toggle", settings: {} },
      "virtualcam.toggle": { type: "obs.virtualcam.toggle", settings: {} }
    };
    return { ...map[assignment.action], title: assignment.title || assignment.action };
  }
  if (assignment.type === "url") return { type: "system.url", title: assignment.title || "Webseite", settings: { url: assignment.url || "" } };
  if (assignment.type === "monitoring-editor") return { type: "system.url", title: assignment.title || "Monitoring", settings: { url: "http://127.0.0.1:17822/editor" } };
  if (assignment.type === "holo-editor") return { type: "system.url", title: assignment.title || "Hologramm", settings: { url: "http://127.0.0.1:17821/editor.html" } };
  return { type: assignment.type || "none", title: assignment.title || "", settings: assignment.settings || {} };
}

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  invoke,
  getState: async () => legacyState(await invoke("state:get")),
  saveSettings: async (value = {}) => {
    const patch = {};
    if (value.preferences) {
      patch.encoder = {
        platform: value.preferences.platform,
        resolution: value.preferences.targetResolution,
        fps: Number(value.preferences.targetFps) || 60
      };
    }
    if (value.deck) patch.legacyDeck = value.deck;
    return (await invoke("settings:update", patch)).legacyDeck || value.deck || patch;
  },
  scanHardware: () => invoke("hardware:scan"),
  runInternetTest: () => invoke("internet:test"),
  runCpuLoadTest: (options = {}) => invoke("cpu:test", { durationSeconds: options.durationSeconds || 10 }),
  connectObs: (options = {}) => invoke("obs:connect", options),
  disconnectObs: () => invoke("obs:disconnect"),
  forgetObsPassword: () => invoke("obs:forget-password"),
  getObsSnapshot: () => invoke("obs:refresh"),
  executeObs: (action, payload) => invoke("obs:call", obsRequestForLegacy(action, payload)),
  runObsRecordingTest: async (options = {}) => {
    const result = await invoke("obs:record-test", { seconds: options.durationSeconds || 15 });
    const stats = result?.stats || {};
    return {
      ...result,
      summary: {
        stable: Number(stats.renderSkippedFrames || 0) === 0 && Number(stats.outputSkippedFrames || 0) === 0,
        renderSkippedFrames: Number(stats.renderSkippedFrames || 0),
        outputSkippedFrames: Number(stats.outputSkippedFrames || 0),
        activeFps: Number(stats.activeFps || 0),
        averageFrameRenderTime: Number(stats.averageFrameRenderTime || 0)
      }
    };
  },
  buildRecommendation: (input) => invoke("recommendation:build", input),
  getMonitoringStatus: async () => {
    const state = await invoke("state:get");
    const status = state.modules?.monitoring || {};
    return { ...status, running: Boolean(status.running || status.active) };
  },
  openMonitoringEditor: () => invoke("monitoring:open"),
  copyMonitoringUrl: () => invoke("monitoring:copy-url"),
  getHoloStatus: async () => {
    const state = await invoke("state:get");
    const status = state.modules?.twitchHolo || {};
    return { ...status, running: Boolean(status.active || status.running) };
  },
  openHoloEditor: () => invoke("holo:open"),
  copyHoloUrl: () => invoke("holo:copy-url"),
  executeDeckAction: (assignment) => invoke("action:execute", { action: actionForLegacyAssignment(assignment), context: { source: "legacy-deck" } }),
  chatOverlayStatus: () => ipcRenderer.invoke("chat:overlay-status"),
  chatOverlayCopyUrl: () => ipcRenderer.invoke("chat:overlay-copy-url"),
  chatOverlayOpen: () => ipcRenderer.invoke("chat:overlay-open"),
  chatOverlayInstall: (config) => ipcRenderer.invoke("chat:overlay-install", config),
  chatOverlayRemove: () => ipcRenderer.invoke("chat:overlay-remove"),
  saveReport: async () => {
    const filePath = await invoke("hardware:save-report");
    return { saved: Boolean(filePath), filePath };
  },
  onStateChanged(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onPairRequest(callback) { return on("mobile:pair-request", callback); },
  onTelemetry(callback) {
    const listener = (_event, value) => callback(telemetryForLegacy(value?.telemetry));
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onTelemetryError(callback) {
    const listener = (_event, value) => { if (value?.errors?.telemetry) callback(value.errors.telemetry); };
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onObsStatusChanged(callback) {
    const listener = (_event, value) => callback(value?.obs || { connected: false });
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  }
};

contextBridge.exposeInMainWorld("batto", Object.freeze(api));
