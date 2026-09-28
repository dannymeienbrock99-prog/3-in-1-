"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell
} = require("electron");

const { atomicWrite, clone, ensureDir, normalizeError, readJson, readJsonBody, sendJson } = require("./services/runtime-utils-v2.cjs");
const { ObsClient } = require("./services/obs-client-v2.cjs");
const { DeckManager } = require("./services/deck-manager-v2.cjs");
const { ActionExecutor } = require("./services/action-executor-v2.cjs");
const { PluginRegistry } = require("./services/plugin-registry-v2.cjs");
const { MobileBridge } = require("./services/mobile-bridge-v2.cjs");
const { StreamOverlayServer } = require("./services/stream-overlay-server-v2.cjs");
const { MultiChat } = require("./services/multi-chat-v2.cjs");
const { HoloServer } = require("./services/holo-server-v2.cjs");
const { LegacyMigration } = require("./services/migration-v2.cjs");
const { MonitoringOverlayServer } = require("../modules/encoder-monitoring-overlay/src/server.cjs");

let hardwareApi = {};
let recommendationApi = {};
try { hardwareApi = require("./services/hardware.cjs"); } catch (error) { console.error("Hardware-Modul:", error); }
try { recommendationApi = require("./services/recommendation.cjs"); } catch (error) { console.error("Empfehlungsmodul:", error); }

app.setName("Batto OBS Tool");

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.exit(0);

let mainWindow = null;
let settings = null;
let secrets = null;
let stateTimer = null;
let telemetryTimer = null;
let localChatServer = null;
let hardwareBusy = false;
let hardware = null;
let internet = null;
let recommendation = null;
let guests = { sceneName: "", showAll: false, sources: [], slots: [] };
let migrationReport = null;
let moduleErrors = {};

const obs = new ObsClient();
let monitoring = null;
let streamOverlay = null;
let holo = null;
let multiChat = null;
let mobile = null;
let plugins = null;
let deck = null;
let migration = null;
let executor = null;
let systemSampler = null;

const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  startPage: "overview",
  obs: { host: "127.0.0.1", port: 4455, autoConnect: true },
  mobile: { enabled: true, requireApproval: true },
  chat: {
    platforms: { twitch: true, youtube: true, tiktok: true, tikfinity: true, tiktory: true },
    forwardToOverlay: true,
    tts: { enabled: false, maximumLength: 300 },
    twitch: { channel: "" },
    youtube: { liveChatId: "" }
  },
  guests: { sceneName: "", showAll: false, slots: [] },
  migrationCompleted: false
});

function userData(name) { return path.join(app.getPath("userData"), name); }
function appRoot(...parts) { return path.join(__dirname, "..", ...parts); }
function sourceRoot(...parts) { return path.join(__dirname, ...parts); }

function loadSettings() {
  const loaded = readJson(userData("settings.json"), DEFAULT_SETTINGS);
  return {
    ...clone(DEFAULT_SETTINGS),
    ...loaded,
    obs: { ...clone(DEFAULT_SETTINGS.obs), ...(loaded.obs || {}) },
    mobile: { ...clone(DEFAULT_SETTINGS.mobile), ...(loaded.mobile || {}) },
    chat: {
      ...clone(DEFAULT_SETTINGS.chat),
      ...(loaded.chat || {}),
      platforms: { ...clone(DEFAULT_SETTINGS.chat.platforms), ...(loaded.chat?.platforms || {}) },
      tts: { ...clone(DEFAULT_SETTINGS.chat.tts), ...(loaded.chat?.tts || {}) },
      twitch: { ...clone(DEFAULT_SETTINGS.chat.twitch), ...(loaded.chat?.twitch || {}) },
      youtube: { ...clone(DEFAULT_SETTINGS.chat.youtube), ...(loaded.chat?.youtube || {}) }
    },
    guests: { ...clone(DEFAULT_SETTINGS.guests), ...(loaded.guests || {}) }
  };
}

function saveSettings() {
  atomicWrite(userData("settings.json"), settings);
}

function loadSecrets() {
  const source = readJson(userData("secrets.json"), {});
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    try {
      result[key] = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(String(value), "base64"))
        : "";
    } catch { result[key] = ""; }
  }
  return result;
}

function saveSecret(key, value) {
  secrets[key] = String(value || "");
  const current = readJson(userData("secrets.json"), {});
  if (!secrets[key]) delete current[key];
  else if (safeStorage.isEncryptionAvailable()) current[key] = safeStorage.encryptString(secrets[key]).toString("base64");
  else throw new Error("Windows-Verschlüsselung ist nicht verfügbar; Zugangsdaten wurden nicht gespeichert");
  atomicWrite(userData("secrets.json"), current);
}

function safeStatus(service, fallback = {}) {
  try { return service?.status?.() || service?.snapshot?.() || fallback; }
  catch (error) { return { ...fallback, error: normalizeError(error) }; }
}

function pluginRoots() {
  const roots = [
    userData("Plugins"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Batto OBS Tool", "Plugins"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Creator Hub", "Plugins"),
    path.join(process.env.APPDATA || "", "Elgato", "StreamDeck", "Plugins"),
    path.join(process.env.ProgramData || "", "Elgato", "StreamDeck", "Plugins")
  ];
  return [...new Set(roots.filter(Boolean).map((entry) => path.resolve(entry)))];
}

function iconRoots() {
  const roots = [
    userData("IconPacks"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Batto OBS Tool", "IconPacks"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Creator Hub", "IconPacks"),
    path.join(process.env.APPDATA || "", "Elgato", "StreamDeck", "IconPacks")
  ];
  return [...new Set(roots.filter(Boolean).map((entry) => path.resolve(entry)))];
}

async function callSampler() {
  try {
    if (!systemSampler) return {};
    for (const name of ["sample", "collect", "read", "snapshot"]) {
      if (typeof systemSampler[name] === "function") {
        const value = await systemSampler[name]();
        if (value && typeof value === "object") return value;
      }
    }
  } catch (error) { console.error("Telemetrie-Sampler:", error); }
  return {};
}

function hardwareGpuList() {
  if (Array.isArray(hardware?.gpus)) return hardware.gpus;
  if (hardware?.gpu) return [hardware.gpu];
  return [];
}

function preferredGpu() {
  const gpus = hardwareGpuList();
  return gpus.find((gpu) => gpu.preferred) || gpus.find((gpu) => gpu.dedicated && !gpu.integrated) || gpus.find((gpu) => /nvidia|geforce|rtx|radeon\s+rx|intel\s+arc/i.test(gpu.name || gpu.model || "")) || gpus[0] || {};
}

async function collectTelemetry() {
  const sampled = await callSampler();
  const obsSnapshot = obs.connected ? await obs.snapshot().catch(() => obs.status()) : obs.status();
  const gpu = preferredGpu();
  const gpus = hardwareGpuList().map((entry) => ({
    name: entry.name || entry.model,
    vendor: entry.vendor || entry.manufacturer,
    dedicated: entry.dedicated ?? !entry.integrated,
    integrated: Boolean(entry.integrated),
    memoryTotalMb: entry.memoryMb || (entry.memoryGb != null ? Number(entry.memoryGb) * 1024 : null),
    driverVersion: entry.driverVersion,
    ...((sampled.gpus || []).find?.((live) => String(live.name || "").toLowerCase().includes(String(entry.name || entry.model || "").toLowerCase())) || {})
  }));
  const cpu = { model: hardware?.cpu?.model || hardware?.cpu?.name, ...(sampled.cpu || sampled.system?.cpu || {}) };
  const ram = { totalGb: hardware?.ram?.totalGb || hardware?.memory?.totalGb, ...(sampled.ram || sampled.memory || sampled.system?.ram || {}) };
  const network = sampled.network || sampled.system?.network || {};
  return {
    timestamp: Date.now(),
    profileName: obsSnapshot.profileName || "Standard",
    gpus: gpus.length ? gpus : [{ name: gpu.name || gpu.model || "Nicht verfügbar", dedicated: true }],
    activeGpuName: gpu.name || gpu.model || "",
    cpu,
    ram,
    network,
    obs: obsSnapshot,
    output: obsSnapshot.output,
    encoder: { ...obsSnapshot.encoder, gpuName: gpu.name || gpu.model || "" },
    video: obsSnapshot.video,
    frame: {
      frameTimeMs: obsSnapshot.video?.fps ? 1000 / obsSnapshot.video.fps : null,
      renderLagFrames: obsSnapshot.stats?.renderSkippedFrames ?? obsSnapshot.stats?.renderMissedFrames,
      encodingLagFrames: obsSnapshot.stats?.outputSkippedFrames,
      networkDroppedFrames: obsSnapshot.output?.droppedFrames,
      totalFrames: obsSnapshot.output?.totalFrames
    },
    system: { cpu, ram, network }
  };
}

async function publishMonitoring() {
  const telemetry = await collectTelemetry();
  if (!monitoring) return telemetry;
  for (const method of ["publishTelemetry", "updateTelemetry", "pushTelemetry", "ingest", "broadcastTelemetry", "setTelemetry"]) {
    if (typeof monitoring[method] === "function") {
      try { await monitoring[method](telemetry); break; } catch (error) { console.error(`Monitoring ${method}:`, error); }
    }
  }
  return telemetry;
}

function monitoringStatus() {
  const status = safeStatus(monitoring, {});
  const port = status.port || 17822;
  return {
    running: Boolean(monitoring),
    host: "127.0.0.1",
    port,
    editorUrl: status.editorUrl || `http://127.0.0.1:${port}/editor`,
    overlayUrl: status.overlayUrl || `http://127.0.0.1:${port}/overlay`,
    ...status,
    error: moduleErrors.monitoring || status.error || null
  };
}

function mobileState() {
  const deckState = deck?.snapshot?.() || { profiles: [] };
  return {
    version: app.getVersion(),
    obs: stateSnapshot().obs,
    deck: deckState,
    plugins: { items: (plugins?.items || []).map((item) => ({ id: item.id, name: item.name, enabled: item.enabled, actions: item.actions })) },
    modules: { monitoring: monitoringStatus(), streamOverlay: safeStatus(streamOverlay), hologram: safeStatus(holo) }
  };
}

async function stateSnapshot() {
  let obsState;
  try { obsState = obs.connected ? await obs.snapshot() : obs.status(); }
  catch (error) { obsState = { ...obs.status(), error: normalizeError(error) }; }
  const chatState = multiChat?.snapshot?.() || {};
  if (localChatServer) chatState.localIngestUrl = `http://127.0.0.1:${localChatServer.address().port}/api/chat`;
  return {
    version: app.getVersion(),
    hardwareBusy,
    hardware,
    internet,
    obs: { ...obsState, settings: { host: settings.obs.host, port: settings.obs.port, autoConnect: settings.obs.autoConnect } },
    recommendation,
    modules: { monitoring: monitoringStatus(), streamOverlay: safeStatus(streamOverlay), hologram: safeStatus(holo) },
    monitoring: monitoringStatus(),
    streamOverlay: safeStatus(streamOverlay),
    hologram: safeStatus(holo),
    chat: chatState,
    deck: deck?.snapshot?.() || { profiles: [] },
    plugins: plugins?.snapshot?.() || { items: [], iconPacks: [], errors: [] },
    mobile: safeStatus(mobile),
    guests: clone(guests),
    settings: clone(settings),
    migration: migrationReport || migration?.snapshot?.() || {},
    moduleErrors: clone(moduleErrors)
  };
}

async function broadcastState() {
  const snapshot = await stateSnapshot();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:state", snapshot);
  mobile?.broadcastState?.(mobileState());
  return snapshot;
}

function sendError(error) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:error", normalizeError(error));
}

async function startMonitoring() {
  try {
    monitoring = new MonitoringOverlayServer({
      port: 17822,
      webRoot: appRoot("modules", "encoder-monitoring-overlay", "web"),
      configFile: userData("encoder-monitoring-layouts.json"),
      historySize: 600
    });
    if (typeof monitoring.start === "function") await monitoring.start();
  } catch (error) { moduleErrors.monitoring = normalizeError(error); monitoring = null; }
}

async function startLocalChatIngress() {
  if (localChatServer) return;
  let port = 48623;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
        if (url.pathname === "/api/status") { sendJson(response, 200, { ok: true, port }); return; }
        if (url.pathname === "/api/chat" && request.method === "POST") {
          try {
            const body = await readJsonBody(request);
            const message = multiChat.ingest(body);
            sendJson(response, 200, { ok: true, message });
          } catch (error) { sendJson(response, 400, { ok: false, error: normalizeError(error) }); }
          return;
        }
        response.writeHead(404); response.end("Not found");
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
      localChatServer = server; return;
    } catch (error) { if (error.code !== "EADDRINUSE" || attempt === 19) throw error; port += 1; }
  }
}

async function startRuntime() {
  settings = loadSettings();
  secrets = loadSecrets();
  guests = clone(settings.guests || DEFAULT_SETTINGS.guests);
  ensureDir(userData("Plugins")); ensureDir(userData("IconPacks"));

  if (typeof hardwareApi.SystemTelemetrySampler === "function") {
    try { systemSampler = new hardwareApi.SystemTelemetrySampler(); } catch (error) { console.error(error); }
  }

  streamOverlay = new StreamOverlayServer({ webRoot: sourceRoot("stream-overlay"), configFile: userData("stream-overlay.json"), port: 48621 });
  holo = new HoloServer({ webRoot: appRoot("modules", "twitch-holo-chat", "web"), port: 17821 });
  multiChat = new MultiChat({ settings: settings.chat, overlay: streamOverlay });
  obs.on("status", () => broadcastState().catch(sendError));
  obs.on("event", () => broadcastState().catch(sendError));
  multiChat.on("message", (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("multichat:message", message);
    broadcastState().catch(sendError);
  });
  multiChat.on("status", () => broadcastState().catch(sendError));

  plugins = new PluginRegistry({ settingsFile: userData("plugin-settings.json"), roots: pluginRoots(), iconRoots: iconRoots() });
  executor = new ActionExecutor({ obs, streamOverlay, multiChat, holo, pluginRegistry: plugins, stateProvider: () => ({ obs: obs.status() }) });
  plugins.setExecutor(executor);
  deck = new DeckManager(userData("deck-profiles.json"), executor);
  migration = new LegacyMigration({
    appData: process.env.APPDATA || app.getPath("appData"),
    programData: process.env.ProgramData || "C:\\ProgramData",
    userData: app.getPath("userData"),
    deckManager: deck,
    pluginDestination: userData("Plugins"),
    iconDestination: userData("IconPacks")
  });

  mobile = new MobileBridge({
    webRoot: sourceRoot("mobile"),
    port: 48620,
    stateProvider: mobileState,
    commandHandler: handleMobileCommand,
    requireApproval: settings.mobile.requireApproval !== false
  });
  mobile.on("status", () => broadcastState().catch(sendError));

  await Promise.allSettled([streamOverlay.start(), holo.start(), startMonitoring(), startLocalChatIngress()]);
  if (settings.mobile.enabled !== false) await mobile.start().catch((error) => { moduleErrors.mobile = normalizeError(error); });
  plugins.scan();

  if (!settings.migrationCompleted) {
    migrationReport = migration.run();
    settings.migrationCompleted = true;
    saveSettings();
    plugins.setRoots(pluginRoots(), iconRoots()); plugins.scan();
  }

  await scanHardware().catch((error) => { moduleErrors.hardware = normalizeError(error); });
  if (settings.obs.autoConnect !== false) {
    obs.connect({ host: settings.obs.host, port: settings.obs.port, password: secrets.obsPassword || "" }).catch(() => {});
  }

  telemetryTimer = setInterval(() => publishMonitoring().catch(() => {}), 1000);
  stateTimer = setInterval(() => broadcastState().catch(() => {}), 2500);
}

async function scanHardware() {
  hardwareBusy = true; await broadcastState();
  try {
    if (typeof hardwareApi.collectHardware !== "function") throw new Error("Hardwarediagnose-Modul fehlt");
    hardware = await hardwareApi.collectHardware();
    return hardware;
  } finally { hardwareBusy = false; await broadcastState(); }
}

async function buildRecommendation(payload = {}) {
  if (!hardware) await scanHardware();
  const options = {
    hardware,
    internetResult: internet,
    internet,
    platform: payload.platform || "twitch",
    resolution: payload.resolution || "1920x1080",
    fps: Number(payload.fps) || 60,
    obs: obs.connected ? await obs.snapshot().catch(() => null) : null
  };
  if (typeof recommendationApi.buildRecommendation === "function") {
    try { recommendation = await recommendationApi.buildRecommendation(options); }
    catch {
      try { recommendation = await recommendationApi.buildRecommendation(hardware, internet, options); } catch {}
    }
  }
  if (!recommendation) {
    const gpu = preferredGpu();
    const nvidia = /nvidia|geforce|rtx/i.test(gpu.name || gpu.model || "");
    const amd = /amd|radeon/i.test(gpu.name || gpu.model || "") && !gpu.integrated;
    const upload = Number(internet?.uploadMbps) || 10;
    recommendation = {
      title: `${payload.platform || "Twitch"} · ${payload.resolution || "1920x1080"} · ${payload.fps || 60} FPS`,
      gpu: gpu.name || gpu.model || "Nicht verfügbar",
      encoder: nvidia ? "NVIDIA NVENC" : amd ? "AMD HW Encoder" : "x264",
      codec: nvidia ? "AV1 oder H.264" : "H.264",
      rateControl: "CBR",
      bitrateKbps: Math.max(2500, Math.min(payload.platform === "youtube" ? 18000 : 8000, Math.round(upload * 700))),
      preset: nvidia ? "P5 – Quality" : "Quality",
      profile: "High",
      keyframeInterval: 2,
      bFrames: 2,
      notes: ["Werte manuell in OBS übernehmen; bestehende OBS-Einstellungen werden nicht geändert."]
    };
  }
  await broadcastState();
  return recommendation;
}

async function handleMobileCommand(command, payload, context) {
  switch (command) {
    case "deck.execute": return deck.command("execute", payload);
    case "deck.state": return deck.snapshot();
    case "obs.call": return obs.call(payload.requestType, payload.requestData || {});
    case "obs.scene": return obs.call("SetCurrentProgramScene", { sceneName: payload.sceneName });
    case "obs.mute": return obs.call("ToggleInputMute", { inputName: payload.inputName });
    case "streamOverlay.event": return streamOverlay.emitEvent(payload);
    case "holo.message": return holo.message(payload);
    case "chat.send": return multiChat.sendMessage(payload.text, payload.platform);
    default: throw new Error(`Unbekannter Handy-Befehl: ${command}`);
  }
}

async function loadGuestSources(sceneName) {
  if (!obs.connected) throw new Error("OBS ist nicht verbunden");
  const target = sceneName || (await obs.call("GetCurrentProgramScene")).currentProgramSceneName;
  const result = await obs.call("GetSceneItemList", { sceneName: target });
  guests.sceneName = target;
  guests.sources = (result.sceneItems || []).map((item) => ({ name: item.sourceName, sourceName: item.sourceName, sceneItemId: item.sceneItemId, enabled: item.sceneItemEnabled, inputKind: item.inputKind }));
  if (!guests.slots.length) guests.slots = guests.sources.filter((item) => /browser|camera|video|ndi|capture|ffmpeg|decklink/i.test(`${item.inputKind || ""} ${item.name}`)).map((item, index) => ({ name: `Gastplatz ${index + 1}`, sourceName: item.sourceName, visible: item.enabled })).slice(0, 8);
  return clone(guests);
}

async function applyGuests(config) {
  if (!obs.connected) throw new Error("OBS ist nicht verbunden");
  const sceneName = config.sceneName || guests.sceneName;
  if (!sceneName) throw new Error("OBS-Szene fehlt");
  const list = await obs.call("GetSceneItemList", { sceneName });
  const byName = new Map((list.sceneItems || []).map((item) => [item.sourceName, item]));
  for (const slot of config.slots || []) {
    const item = byName.get(slot.sourceName); if (!item) continue;
    await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: Boolean(slot.visible) });
  }
  if (config.showAll) {
    for (const item of list.sceneItems || []) await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: true });
  }
  guests = { ...guests, ...clone(config) };
  settings.guests = clone(guests); saveSettings(); await broadcastState();
  return clone(guests);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 720,
    backgroundColor: "#070b11",
    title: "Batto OBS Tool",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: sourceRoot("preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(sourceRoot("renderer", "index.html"));
  mainWindow.once("ready-to-show", () => { mainWindow.show(); mainWindow.focus(); });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: "deny" }; });
}

function registerIpc() {
  const handle = (channel, handler) => ipcMain.handle(channel, async (_event, payload) => {
    try {
      const result = await handler(payload || {});
      return { ok: true, result, state: await stateSnapshot() };
    } catch (error) {
      console.error(channel, error);
      return { ok: false, error: normalizeError(error), state: await stateSnapshot() };
    }
  });

  handle("app:getState", async () => stateSnapshot());
  handle("app:close", async () => { app.quit(); return true; });
  handle("app:saveSettings", async (payload) => {
    settings = {
      ...settings,
      startPage: payload.startPage || settings.startPage,
      obs: { ...settings.obs, ...(payload.obs || {}) },
      mobile: { ...settings.mobile, ...(payload.mobile || {}) }
    };
    saveSettings();
    if (settings.mobile.enabled === false) await mobile.stop();
    else if (!mobile.status().running) await mobile.start();
    return clone(settings);
  });
  handle("hardware:scan", scanHardware);
  handle("hardware:saveReport", async () => {
    if (!hardware) await scanHardware();
    const result = await dialog.showSaveDialog(mainWindow, { title: "Diagnosebericht speichern", defaultPath: `Batto-OBS-Tool-Hardware-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    atomicWrite(result.filePath, { generatedAt: new Date().toISOString(), hardware, obs: await obs.snapshot().catch(() => obs.status()), internet });
    return { filePath: result.filePath };
  });
  handle("internet:test", async () => {
    if (typeof hardwareApi.runInternetTest !== "function") throw new Error("Internettest-Modul fehlt");
    internet = await hardwareApi.runInternetTest(); await broadcastState(); return internet;
  });
  handle("obs:connect", async (payload) => {
    settings.obs = { host: payload.host || "127.0.0.1", port: Number(payload.port) || 4455, autoConnect: payload.autoConnect !== false };
    saveSettings(); if (payload.password) saveSecret("obsPassword", payload.password);
    return obs.connect({ host: settings.obs.host, port: settings.obs.port, password: payload.password || secrets.obsPassword || "" });
  });
  handle("obs:disconnect", () => obs.disconnect());
  handle("obs:refresh", () => obs.snapshot());
  handle("obs:call", (payload) => obs.call(payload.requestType, payload.requestData || {}));
  handle("recommendation:build", buildRecommendation);
  handle("test:cpu", async (payload) => {
    if (typeof hardwareApi.runCpuLoadTest !== "function") throw new Error("CPU-Test-Modul fehlt");
    return hardwareApi.runCpuLoadTest(Math.max(3, Math.min(30, Number(payload.seconds) || 8)));
  });
  handle("test:record", (payload) => obs.runRecordTest(payload.seconds));
  handle("monitoring:open", async () => { await shell.openExternal(monitoringStatus().editorUrl); return monitoringStatus(); });
  handle("monitoring:copyUrl", async () => { clipboard.writeText(monitoringStatus().overlayUrl); return monitoringStatus().overlayUrl; });
  handle("streamOverlay:open", async () => { await shell.openExternal(streamOverlay.status().editorUrl); return streamOverlay.status(); });
  handle("streamOverlay:copyUrl", async () => { clipboard.writeText(streamOverlay.status().overlayUrl); return streamOverlay.status().overlayUrl; });
  handle("streamOverlay:event", (payload) => streamOverlay.emitEvent(payload));
  handle("multichat:update", async (payload) => {
    multiChat.updateSettings(payload); settings.chat = clone(multiChat.settings); saveSettings(); return multiChat.snapshot();
  });
  handle("multichat:connectTwitch", async (payload) => { if (payload.oauthToken) saveSecret("twitchOAuth", payload.oauthToken); const result = await multiChat.connectTwitch({ channel: payload.channel, oauthToken: payload.oauthToken || secrets.twitchOAuth || "" }); settings.chat = clone(multiChat.settings); saveSettings(); return result; });
  handle("multichat:disconnectTwitch", () => multiChat.disconnectTwitch());
  handle("multichat:connectYouTube", async (payload) => { if (payload.apiKey) saveSecret("youtubeApiKey", payload.apiKey); const result = await multiChat.connectYouTube({ apiKey: payload.apiKey || secrets.youtubeApiKey || "", liveChatId: payload.liveChatId }); settings.chat = clone(multiChat.settings); saveSettings(); return result; });
  handle("multichat:disconnectYouTube", () => multiChat.disconnectYouTube());
  handle("multichat:test", (payload) => multiChat.ingest(payload));
  handle("multichat:clear", () => multiChat.clear());
  handle("multichat:tts", (payload) => multiChat.ttsCommand(payload.command));
  handle("guests:load", async (payload) => ({ guests: await loadGuestSources(payload.sceneName) }));
  handle("guests:save", async (payload) => { guests = { ...guests, ...clone(payload) }; settings.guests = clone(guests); saveSettings(); return guests; });
  handle("guests:apply", applyGuests);
  handle("holo:open", async () => { await shell.openExternal(holo.status().editorUrl); return holo.status(); });
  handle("holo:copyUrl", async () => { clipboard.writeText(holo.status().overlayUrl); return holo.status().overlayUrl; });
  handle("holo:test", (payload) => holo.message(payload));
  handle("holo:clear", () => holo.clear());
  handle("deck:command", async (payload) => {
    if (payload.command === "export") {
      const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "Batto-OBS-Tool-Deck.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      atomicWrite(result.filePath, deck.snapshot()); return { filePath: result.filePath };
    }
    if (payload.command === "import") {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      return deck.command("replaceAll", { data: readJson(result.filePaths[0], null) });
    }
    return deck.command(payload.command, payload);
  });
  handle("plugins:scan", async () => { plugins.setRoots(pluginRoots(), iconRoots()); return plugins.scan(); });
  handle("plugins:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Plugin-Ordner auswählen", properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return plugins.importDirectory(result.filePaths[0], userData("Plugins"));
  });
  handle("plugins:setEnabled", (payload) => plugins.setEnabled(payload.id, payload.enabled));
  handle("mobile:command", async (payload) => {
    switch (payload.command) {
      case "regeneratePin": return mobile.regeneratePin();
      case "setApproval": settings.mobile.requireApproval = Boolean(payload.requireApproval); saveSettings(); return mobile.setApproval(payload.requireApproval);
      case "approve": return mobile.approve(payload.clientId);
      case "reject": return mobile.reject(payload.clientId);
      case "disconnect": return mobile.disconnect(payload.clientId);
      default: throw new Error(`Unbekannter Handy-Befehl: ${payload.command}`);
    }
  });
  handle("migration:run", async () => { migrationReport = migration.run(); plugins.setRoots(pluginRoots(), iconRoots()); plugins.scan(); return migrationReport; });
}

async function selfTest() {
  const required = [
    sourceRoot("renderer", "index.html"), sourceRoot("renderer", "app.js"), sourceRoot("renderer", "styles.css"), sourceRoot("preload.cjs"),
    sourceRoot("mobile", "index.html"), sourceRoot("stream-overlay", "overlay.html"),
    appRoot("modules", "encoder-monitoring-overlay", "src", "server.cjs"), appRoot("modules", "twitch-holo-chat", "web", "overlay.html")
  ];
  const missing = required.filter((entry) => !fs.existsSync(entry));
  if (missing.length) throw new Error(`Self-Test: Dateien fehlen: ${missing.join(", ")}`);
  const temporaryDeck = new DeckManager(path.join(app.getPath("temp"), `batto-selftest-${process.pid}.json`), { executeMany: async () => [] });
  await temporaryDeck.command("createProfile", { name: "Self-Test" });
  const registry = new PluginRegistry({ settingsFile: path.join(app.getPath("temp"), `batto-plugin-selftest-${process.pid}.json`), roots: [], iconRoots: [] });
  const snapshot = registry.scan();
  if (!snapshot.items.some((item) => item.id === "batto.obs")) throw new Error("Self-Test: Native OBS-Aktionen fehlen");
  return true;
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    if (process.argv.includes("--self-test")) {
      await selfTest();
      console.log("BATTO_OBS_TOOL_SELF_TEST_OK");
      app.exit(0); return;
    }
    createWindow();
    registerIpc();
    await startRuntime();
    await broadcastState();
  } catch (error) {
    console.error(error);
    if (process.argv.includes("--self-test")) app.exit(1);
    else dialog.showErrorBox("Batto OBS Tool", normalizeError(error).message);
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  clearInterval(stateTimer); clearInterval(telemetryTimer);
  obs.disconnect().catch(() => {});
  multiChat?.close?.().catch?.(() => {});
  mobile?.stop?.().catch?.(() => {});
  streamOverlay?.stop?.().catch?.(() => {});
  holo?.stop?.().catch?.(() => {});
  if (localChatServer) try { localChatServer.close(); } catch {}
  for (const method of ["stop", "close"]) if (typeof monitoring?.[method] === "function") try { monitoring[method](); } catch {}
});
