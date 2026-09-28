"use strict";

const streamRuntime = require("./stream-overlay-bootstrap.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, safeStorage, shell } = require("electron");
const { ChatCore } = require("./services/chat-core.cjs");
const { ChatWindowManager } = require("./services/chat-window-manager.cjs");
const { TwitchAdapter } = require("./services/platforms/twitch-adapter.cjs");
const { CngUnifiedAdapter } = require("./services/platforms/cng-adapter.cjs");
const { TikTokAdapter } = require("./services/platforms/tiktok-adapter.cjs");
const { YouTubeAdapter } = require("./services/platforms/youtube-adapter.cjs");
const { normalizeCngConfig } = require("./services/cng-config.cjs");
const { normalizeTtsConfig } = require("./services/tts-config.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const { SettingsStore } = require("./services/store.cjs");
const { ObsWebSocketClient } = require("./services/obs-websocket.cjs");
const { ensureObsChatOverlay, removeObsChatOverlay, toOverlayChatEvent } = require("./services/obs-chat-overlay.cjs");

let core = null;
let windows = null;
let cngConfig = {};
let ttsConfig = normalizeTtsConfig();
let cngSecretStore = null;
let platformSecretStore = null;
let settingsStore = null;
let chatObs = null;
let mainWindowPoll = null;
let overlaySettings = { sourceName: "Batto Multi-Chat", sceneName: "", width: 1920, height: 1080, autoInstall: false };

const cngConfigFile = () => path.join(app.getPath("userData"), "cng-personal-chat.json");
const ttsConfigFile = () => path.join(app.getPath("userData"), "tts-config.json");
const overlaySettingsFile = () => path.join(app.getPath("userData"), "chat-overlay.json");
async function readJson(filename, fallback) { try { return JSON.parse(await fs.readFile(filename, "utf8")); } catch { return fallback; } }
async function writeJson(filename, value) { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 }); }
async function loadCngConfig() {
  const stored = await readJson(cngConfigFile(), {});
  const token = await cngSecretStore?.get("cng-obs-chat-token");
  if (stored.chat?.url && token) stored.chat.url = `${stored.chat.url}${stored.chat.url.includes("?") ? "&" : "?"}obsChatToken=${encodeURIComponent(token)}`;
  cngConfig = stored;
  return cngConfig;
}
function broadcast(channel, payload) { for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload); }
function overlayServer() { return streamRuntime.getStreamOverlayServer(); }
function obsClient() { return chatObs; }
function overlayStatus() {
  const serverStatus = streamRuntime.getStreamOverlayStatus();
  return { ...overlaySettings, active: Boolean(serverStatus.active), url: serverStatus.chatOverlayUrl || "", obs: chatObs?.status?.() || { connected: false } };
}

async function ensureChatObs() {
  if (chatObs?.status?.().connected) return chatObs;
  const settings = await settingsStore.get();
  const password = await platformSecretStore.get("obs-websocket-password");
  if (!chatObs) chatObs = new ObsWebSocketClient();
  await chatObs.connect({ host: settings.obs.host, port: settings.obs.port, password });
  return chatObs;
}

async function secureChatConnect(platform, input = {}) {
  const config = input && typeof input === "object" ? { ...input } : {};
  const settings = await settingsStore.get();

  if (platform === "twitch") {
    config.channel = String(config.channel || settings.platforms?.twitch?.channel || "").trim();
    config.username = String(config.username || settings.platforms?.twitch?.username || "").trim();
    config.token = String(config.token || await platformSecretStore.get("twitch-oauth-token") || "").trim();
  } else if (platform === "youtube") {
    config.liveChatId = String(config.liveChatId || settings.platforms?.youtube?.liveChatId || "").trim();
    config.accessToken = String(config.accessToken || await platformSecretStore.get("youtube-oauth-token") || "").trim();
  } else if (platform === "tiktok") {
    config.username = String(config.username || settings.platforms?.tiktok?.username || "").trim();
    config.signApiKey = String(config.signApiKey || await platformSecretStore.get("tiktok-euler-sign-api-key") || "").trim();
  } else if (platform === "cng" && !Object.keys(config).length) {
    return core.connect(platform, await loadCngConfig());
  }
  return core.connect(platform, config);
}

async function startConfiguredChats() {
  const settings = await settingsStore.get();
  const platforms = settings.platforms || {};
  const selected = [];

  if (platforms.tiktok?.enabled && platforms.tiktok?.autoConnect && platforms.tiktok?.api?.enabled !== false && platforms.tiktok?.api?.chat !== false) selected.push("tiktok");
  if (platforms.twitch?.enabled && platforms.twitch?.autoConnect && platforms.twitch?.chat !== false) selected.push("twitch");
  if (platforms.youtube?.enabled && platforms.youtube?.autoConnect && platforms.youtube?.chat !== false) selected.push("youtube");
  if (platforms.cng?.enabled && platforms.cng?.autoConnect && platforms.cng?.chat !== false) selected.push("cng");

  const results = await Promise.allSettled(selected.map(async (platform) => {
    try {
      const status = await secureChatConnect(platform, {});
      broadcast("chat:status", { platform, ...status, autoConnect: true });
      return status;
    } catch (error) {
      const message = String(error?.message || error || "Chat-Verbindung fehlgeschlagen");
      broadcast("chat:status", { platform, connected: false, autoConnect: true, error: message });
      console.error(`${platform}-Chat AutoConnect fehlgeschlagen:`, error);
      throw error;
    }
  }));

  return { selected, results };
}

function attachEmbeddedChat(main) {
  if (!main || main.isDestroyed()) return;
  const scriptPath = path.join(__dirname, "renderer", "multi-chat.js").replaceAll("\\", "/");
  const controlsPath = path.join(__dirname, "renderer", "chat-overlay-controls.js").replaceAll("\\", "/");
  const cssPath = path.join(__dirname, "renderer", "multi-chat.css").replaceAll("\\", "/");
  const code = `(function(){if(document.getElementById('batto-multi-chat-dock'))return;const css=document.createElement('link');css.rel='stylesheet';css.href='file://${cssPath}';document.head.appendChild(css);const host=document.createElement('div');host.id='batto-multi-chat-dock';host.style='position:fixed;right:18px;bottom:18px;width:460px;height:700px;z-index:2147483000;box-shadow:0 22px 70px rgba(0,0,0,.55);border:1px solid #223044;border-radius:10px;overflow:hidden;background:#090d14;';const root=document.createElement('div');root.id='multi-chat-root';root.style='height:100%';host.appendChild(root);document.body.appendChild(host);const s=document.createElement('script');s.src='file://${scriptPath}';s.onload=function(){const controls=document.createElement('script');controls.src='file://${controlsPath}';document.body.appendChild(controls);};document.body.appendChild(s);window.batto.onChatWindow(function(state){host.hidden=!!state.undocked});})();`;
  main.webContents.executeJavaScript(code).catch((error) => console.error("Multi-Chat-Einbettung fehlgeschlagen:", error));
}

function registerChatIpc() {
  ipcMain.handle("chat:history", (_event, options) => core.history(options));
  ipcMain.handle("chat:statuses", () => core.statuses());
  ipcMain.handle("chat:connect", (_event, platform, config) => secureChatConnect(platform, config));
  ipcMain.handle("chat:disconnect", (_event, platform) => core.disconnect(platform));
  ipcMain.handle("chat:unified-clear", (_event, platform) => { core.clear(platform); return true; });
  ipcMain.handle("chat:toggle-window", () => windows.toggle());
  ipcMain.handle("chat:window-status", () => windows.status());
  ipcMain.handle("chat:window-always-on-top", (_event, value) => windows.setAlwaysOnTop(value));
  ipcMain.handle("chat:overlay-status", () => overlayStatus());
  ipcMain.handle("chat:overlay-copy-url", () => {
    const url = overlayStatus().url;
    if (!url) throw new Error("Das lokale Chat-Overlay ist noch nicht gestartet.");
    clipboard.writeText(url);
    return url;
  });
  ipcMain.handle("chat:overlay-open", async () => {
    const url = overlayStatus().url;
    if (!url) throw new Error("Das lokale Chat-Overlay ist noch nicht gestartet.");
    await shell.openExternal(url);
    return url;
  });
  ipcMain.handle("chat:overlay-install", async (_event, input = {}) => {
    const server = await streamRuntime.startStreamOverlay();
    const status = server.status();
    if (!status.chatOverlayUrl) throw new Error("Das lokale Chat-Overlay ist noch nicht gestartet.");
    overlaySettings = { ...overlaySettings, ...input, autoInstall: input.autoInstall === true };
    await writeJson(overlaySettingsFile(), overlaySettings);
    const client = await ensureChatObs();
    return ensureObsChatOverlay(client, { ...overlaySettings, url: status.chatOverlayUrl });
  });
  ipcMain.handle("chat:overlay-remove", async () => {
    const client = await ensureChatObs();
    return removeObsChatOverlay(client, overlaySettings.sourceName);
  });
  ipcMain.handle("cng:save-config", async (_event, input = {}) => {
    const normalized = normalizeCngConfig(input);
    if (normalized.chat?.obsChatToken) await cngSecretStore.set("cng-obs-chat-token", normalized.chat.obsChatToken);
    const safe = JSON.parse(JSON.stringify(normalized));
    if (safe.chat) {
      safe.chat.obsChatToken = "";
      if (safe.chat.url) {
        const url = new URL(safe.chat.url);
        url.searchParams.delete("obsChatToken");
        safe.chat.url = url.toString();
      }
    }
    await writeJson(cngConfigFile(), safe);
    cngConfig = normalized;
    return { ...normalized, chat: { ...normalized.chat, obsChatToken: "" } };
  });
  ipcMain.handle("cng:get-config", async () => loadCngConfig());
  ipcMain.handle("tts:get-config", () => ttsConfig);
  ipcMain.handle("tts:save-config", async (_event, input) => {
    ttsConfig = normalizeTtsConfig(input);
    await writeJson(ttsConfigFile(), ttsConfig);
    return ttsConfig;
  });
}

app.whenReady().then(async () => {
  cngSecretStore = new SecretStore(path.join(app.getPath("userData"), "cng-secrets.json"), safeStorage);
  platformSecretStore = new SecretStore(path.join(app.getPath("userData"), "secrets.json"), safeStorage);
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  await settingsStore.load();
  cngConfig = await loadCngConfig();
  ttsConfig = normalizeTtsConfig(await readJson(ttsConfigFile(), {}));
  await streamRuntime.startStreamOverlay().catch(() => null);

  core = new ChatCore({ maxMessages: 500, flushMs: 60 });
  core.registerAdapter(new TwitchAdapter());
  core.registerAdapter(new CngUnifiedAdapter());
  core.registerAdapter(new TikTokAdapter());
  core.registerAdapter(new YouTubeAdapter());
  core.on("messages", (batch) => {
    require('./suite-bootstrap.cjs').onChat(batch);
    const server = overlayServer();
    for (const message of batch) server?.publishEvent(toOverlayChatEvent(message));
    broadcast("chat:messages", batch);
  });
  core.on("status", (status) => broadcast("chat:status", status));
  core.on("cleared", (platform) => {
    overlayServer()?.clearChat(platform);
    broadcast("chat:cleared", platform);
  });

  const main = BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Batto 3-in-1") || BrowserWindow.getAllWindows()[0] || null;
  overlaySettings = { ...overlaySettings, ...(await readJson(overlaySettingsFile(), {})) };
  windows = new ChatWindowManager({ mainWindow: main, userDataFile: path.join(app.getPath("userData"), "multi-chat-window.json"), broadcast: (state) => broadcast("chat:window", state) });
  await windows.loadSettings();
  registerChatIpc();
  globalShortcut.register("CommandOrControl+Shift+C", () => windows.toggle());

  void startConfiguredChats().catch((error) => console.error("Chat-AutoConnect konnte nicht vollständig gestartet werden:", error));

  if (overlaySettings.autoInstall) {
    const status = overlayStatus();
    if (status.url) {
      void ensureChatObs().then((client) => ensureObsChatOverlay(client, { ...overlaySettings, url: status.url }))
        .catch((error) => console.error("OBS-Chatquelle konnte nicht automatisch aktualisiert werden:", error));
    }
  }

  const wireMain = () => {
    const found = BrowserWindow.getAllWindows().find((win) => win.getTitle() === "Batto 3-in-1");
    if (!found) return false;
    windows.mainWindow = found;
    if (!found.isDestroyed()) {
      found.webContents.once("did-finish-load", () => attachEmbeddedChat(found));
      if (!found.webContents.isLoading()) attachEmbeddedChat(found);
    }
    return true;
  };
  if (!wireMain()) {
    mainWindowPoll = setInterval(() => {
      if (wireMain()) {
        clearInterval(mainWindowPoll);
        mainWindowPoll = null;
      }
    }, 250);
    mainWindowPoll.unref?.();
  }
  if (windows.settings.undocked) setTimeout(() => windows.create(), 1200).unref?.();
}).catch((error) => console.error("Multi-Chat-Bootstrap konnte nicht starten:", error));

app.on("before-quit", () => {
  if (mainWindowPoll) clearInterval(mainWindowPoll);
  globalShortcut.unregister("CommandOrControl+Shift+C");
  void core?.stop();
  void chatObs?.disconnect?.();
});
