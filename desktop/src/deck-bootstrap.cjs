"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { app, dialog, ipcMain, safeStorage, shell } = require("electron");
const { DeckStore } = require("./services/deck-store.cjs");
const { PluginRegistry } = require("./services/plugin-registry.cjs");
const { SettingsStore } = require("./services/store.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const { ObsWebSocketClient } = require("./services/obs-websocket.cjs");
const { TikTokLiveStudioService } = require("./services/tiktok-live-studio.cjs");

const execFileAsync = promisify(execFile);

const SUPPORTED_ACTION_TYPES = new Set([
  "obs.scene",
  "obs.source.toggle",
  "obs.input.mute",
  "obs.input.volume",
  "obs.stream.start",
  "obs.stream.stop",
  "obs.stream.toggle",
  "obs.record.start",
  "obs.record.stop",
  "obs.record.pause",
  "obs.record.resume",
  "obs.record.toggle",
  "obs.virtualcam.start",
  "obs.virtualcam.stop",
  "obs.virtualcam.toggle",
  "obs.replay.start",
  "obs.replay.stop",
  "obs.replay.save",
  "obs.replay.toggle",
  "system.url",
  "system.launch",
  "system.hotkey",
  "media.playpause",
  "media.next",
  "media.previous",
  "media.stop",
  "media.volume.up",
  "media.volume.down",
  "media.mute",
  "youtube.dashboard",
  "youtube.channel",
  "tiktok.live-studio.launch",
  "discord.launch",
  "obsbot.center"
]);

let deckStore;
let pluginRegistry;
let settingsStore;
let secretStore;
let obs;
let liveStudio;
let registered = false;

function userDataFile(name) { return path.join(app.getPath("userData"), name); }
function register(channel, handler) { ipcMain.handle(channel, (_event, payload = {}) => handler(payload || {})); }

function psQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

async function powershell(script, timeout = 20_000) {
  return execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
  ], { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
}

function mediaKeyScript(key) {
  const mapping = {
    playpause: 0xB3,
    next: 0xB0,
    previous: 0xB1,
    stop: 0xB2,
    mute: 0xAD,
    volumeup: 0xAF,
    volumedown: 0xAE
  };
  const code = mapping[String(key || "").toLowerCase()];
  if (!code) throw new Error("Unbekannte Medientaste.");
  return `$signature='[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';Add-Type -MemberDefinition $signature -Name Native -Namespace Batto;[Batto.Native]::keybd_event(${code},0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40;[Batto.Native]::keybd_event(${code},0,2,[UIntPtr]::Zero)`;
}

function hotkeyScript(keys) {
  const tokens = Array.isArray(keys) ? keys : String(keys || "").split(/[+,\s]+/).filter(Boolean);
  const normalized = tokens.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean);
  if (!normalized.length || normalized.length > 8) throw new Error("Tastenkombination fehlt oder ist ungültig.");
  const special = { CTRL: "^", CONTROL: "^", ALT: "%", SHIFT: "+", WIN: "#", WINDOWS: "#" };
  const modifiers = normalized.filter((key) => special[key]).map((key) => special[key]).join("");
  const keysOnly = normalized.filter((key) => !special[key]);
  if (keysOnly.length !== 1) throw new Error("Touch-Deck-Hotkey benötigt genau eine Taste plus optionale Modifizierer.");
  const key = keysOnly[0];
  if (!/^[A-Z0-9]$/.test(key) && !/^F(?:[1-9]|1[0-2])$/.test(key) && !/^(ENTER|ESC|ESCAPE|TAB|SPACE|UP|DOWN|LEFT|RIGHT|HOME|END|PGUP|PGDN|DELETE|BACKSPACE)$/.test(key)) {
    throw new Error("Diese Hotkey-Taste wird nicht unterstützt.");
  }
  const target = key.length === 1 ? key.toLowerCase() : `{${key === "ESCAPE" ? "ESC" : key}}`;
  return `$ws=New-Object -ComObject WScript.Shell;Start-Sleep -Milliseconds 80;$ws.SendKeys(${psQuote(modifiers + target)})`;
}

function findKnownProgram(relativePaths) {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean);
  for (const root of roots) {
    for (const relative of relativePaths) {
      const candidate = path.join(root, relative);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return "";
}

async function openKnownProgram(label, relativePaths, fallbackUrl = "") {
  const executable = findKnownProgram(relativePaths);
  if (executable) {
    const error = await shell.openPath(executable);
    if (error) throw new Error(error);
    return { opened: true, target: executable };
  }
  if (fallbackUrl) {
    await shell.openExternal(fallbackUrl);
    return { opened: true, target: fallbackUrl };
  }
  throw new Error(`${label} wurde nicht gefunden.`);
}

function sanitizePluginSnapshot() {
  if (!pluginRegistry) return null;
  for (const plugin of pluginRegistry.plugins || []) {
    if (!plugin.native) {
      if ((plugin.actions || []).length) {
        plugin.status = "Original Stream-Deck-Plugin erkannt. Aktionen bleiben deaktiviert, bis eine kompatible Plugin-Laufzeit vorhanden ist.";
      }
      plugin.actions = [];
      continue;
    }
    plugin.actions = (plugin.actions || []).filter((action) => SUPPORTED_ACTION_TYPES.has(String(action.id || "")));
    if (!plugin.actions.length) plugin.status = "Erkannt, aber in Batto 2.1 noch ohne freigegebene Aktion.";
  }
  return pluginRegistry.snapshot();
}

function scanDeckPlugins() {
  pluginRegistry.scan();
  return sanitizePluginSnapshot();
}

async function ensureObs() {
  if (obs.connected) return obs;
  const settings = await settingsStore.get();
  const password = await secretStore.get("obs-websocket-password");
  await obs.connect({ host: settings.obs.host, port: settings.obs.port, password });
  return obs;
}

function obsAction(action) {
  const type = String(action?.type || "");
  const settings = action?.settings && typeof action.settings === "object" ? action.settings : {};
  if (type === "obs.scene") return ["scene.set", { sceneName: settings.sceneName || settings.scene || settings.name || "" }];
  if (type === "obs.stream.start") return ["stream.start", {}];
  if (type === "obs.stream.stop") return ["stream.stop", {}];
  if (type === "obs.record.start") return ["record.start", {}];
  if (type === "obs.record.stop") return ["record.stop", {}];
  if (type === "obs.record.pause") return ["record.pause", {}];
  if (type === "obs.record.resume") return ["record.resume", {}];
  if (type === "obs.virtualcam.start") return ["virtualcam.start", {}];
  if (type === "obs.virtualcam.stop") return ["virtualcam.stop", {}];
  if (type === "obs.replay.start") return ["replay.start", {}];
  if (type === "obs.replay.stop") return ["replay.stop", {}];
  if (type === "obs.replay.save") return ["replay.save", {}];
  return null;
}

async function toggleObsOutput(client, requestType, activeAction, inactiveAction) {
  const status = await client.request(requestType);
  return client.execute(status.outputActive ? activeAction : inactiveAction);
}

async function executeAction(action) {
  const delay = Math.max(0, Math.min(120000, Number(action?.delayMs) || 0));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

  const type = String(action?.type || "");
  if (!SUPPORTED_ACTION_TYPES.has(type)) throw new Error(`Touch-Deck-Aktion ist nicht freigegeben: ${type || "ohne Typ"}`);

  const mapped = obsAction(action);
  if (mapped) {
    const client = await ensureObs();
    return client.execute(mapped[0], mapped[1]);
  }

  const settings = action?.settings && typeof action.settings === "object" ? action.settings : {};

  if (type === "obs.stream.toggle") {
    const client = await ensureObs();
    return toggleObsOutput(client, "GetStreamStatus", "stream.stop", "stream.start");
  }
  if (type === "obs.record.toggle") {
    const client = await ensureObs();
    return toggleObsOutput(client, "GetRecordStatus", "record.stop", "record.start");
  }
  if (type === "obs.virtualcam.toggle") {
    const client = await ensureObs();
    return toggleObsOutput(client, "GetVirtualCamStatus", "virtualcam.stop", "virtualcam.start");
  }
  if (type === "obs.replay.toggle") {
    const client = await ensureObs();
    return toggleObsOutput(client, "GetReplayBufferStatus", "replay.stop", "replay.start");
  }
  if (type === "obs.input.mute") {
    const client = await ensureObs();
    const inputName = String(settings.inputName || settings.sourceName || "").trim();
    if (!inputName) throw new Error("OBS-Audioquelle fehlt.");
    let inputMuted;
    if (settings.toggle !== false && settings.inputMuted === undefined && settings.muted === undefined) {
      const current = await client.request("GetInputMute", { inputName });
      inputMuted = !current.inputMuted;
    } else {
      inputMuted = Boolean(settings.inputMuted ?? settings.muted);
    }
    return client.execute("input.mute", { inputName, inputMuted });
  }
  if (type === "obs.input.volume") {
    const client = await ensureObs();
    const inputName = String(settings.inputName || settings.sourceName || "").trim();
    if (!inputName) throw new Error("OBS-Audioquelle fehlt.");
    const volume = Number(settings.volumeMul ?? settings.volume ?? 1);
    if (!Number.isFinite(volume) || volume < 0 || volume > 20) throw new Error("OBS-Lautstärke liegt außerhalb des erlaubten Bereichs.");
    return client.request("SetInputVolume", { inputName, inputVolumeMul: volume });
  }
  if (type === "obs.source.toggle") {
    const client = await ensureObs();
    let sceneName = String(settings.sceneName || "").trim();
    const sourceName = String(settings.sourceName || settings.inputName || "").trim();
    if (!sourceName) throw new Error("OBS-Quellenname fehlt.");
    if (!sceneName) {
      const scene = await client.request("GetCurrentProgramScene");
      sceneName = scene.currentProgramSceneName;
    }
    const item = await client.request("GetSceneItemId", { sceneName, sourceName, searchOffset: 0 });
    const current = await client.request("GetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId });
    return client.request("SetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: !current.sceneItemEnabled });
  }
  if (type === "system.url") {
    const url = String(settings.url || settings.href || settings.target || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Touch-Deck-Webadresse ist ungültig.");
    await shell.openExternal(url);
    return { opened: true, url };
  }
  if (type === "system.launch") {
    const target = String(settings.path || settings.target || "").trim();
    if (!target) throw new Error("Programm- oder Dateipfad fehlt.");
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return { opened: true, target };
  }
  if (type === "system.hotkey") {
    await powershell(hotkeyScript(settings.keys || settings.hotkey || settings.key));
    return { sent: true };
  }
  if (type.startsWith("media.")) {
    const key = {
      "media.playpause": "playpause",
      "media.next": "next",
      "media.previous": "previous",
      "media.stop": "stop",
      "media.volume.up": "volumeup",
      "media.volume.down": "volumedown",
      "media.mute": "mute"
    }[type];
    await powershell(mediaKeyScript(key));
    return { sent: key };
  }
  if (type === "youtube.dashboard") {
    await shell.openExternal("https://studio.youtube.com/");
    return { opened: true };
  }
  if (type === "youtube.channel") {
    const state = await settingsStore.get();
    const channelId = String(settings.channelId || state.platforms?.youtube?.channelId || "").trim();
    const url = channelId ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}` : "https://www.youtube.com/";
    await shell.openExternal(url);
    return { opened: true, url };
  }
  if (type === "tiktok.live-studio.launch") return liveStudio.launch();
  if (type === "discord.launch") {
    return openKnownProgram("Discord", [
      "Discord\\Update.exe",
      "DiscordCanary\\Update.exe",
      "DiscordPTB\\Update.exe"
    ], "https://discord.com/app");
  }
  if (type === "obsbot.center") {
    return openKnownProgram("OBSBOT Center", [
      "OBSBOT Center\\OBSBOT Center.exe",
      "OBSBOT Center\\OBSBOT_Center.exe"
    ]);
  }

  throw new Error(`Touch-Deck-Aktion wird nicht unterstützt: ${type || "ohne Typ"}`);
}

async function executeButton(payload) {
  const profile = deckStore.getProfile(payload.profileId) || deckStore.activeProfile();
  const folder = profile?.folders.find((item) => item.id === payload.folderId) || profile?.folders[0];
  const index = Number(payload.buttonIndex);
  const button = folder?.buttons?.[index];
  if (!button?.enabled) throw new Error("Diese Taste ist deaktiviert.");
  if (!button?.actions?.length) throw new Error("Diese Taste ist nicht belegt.");
  const results = [];
  for (const action of button.actions) results.push(await executeAction(action));
  return results;
}

async function initialize() {
  if (registered) return;
  registered = true;
  settingsStore = new SettingsStore(userDataFile("settings.json"));
  secretStore = new SecretStore(userDataFile("secrets.json"), safeStorage);
  await settingsStore.load();
  obs = new ObsWebSocketClient();
  liveStudio = new TikTokLiveStudioService();
  const settings = await settingsStore.get();
  liveStudio.configure({ executablePath: settings.platforms?.tiktok?.liveStudio?.executablePath || "" });

  deckStore = new DeckStore(userDataFile("deck-profiles.json"));
  pluginRegistry = new PluginRegistry({ stateFile: userDataFile("plugin-state.json") });
  scanDeckPlugins();

  register("state:get", () => ({ deck: deckStore.snapshot(), plugins: pluginRegistry.snapshot() }));
  register("plugins:scan", () => scanDeckPlugins());
  register("plugins:enable", (payload) => {
    pluginRegistry.setEnabled(payload.pluginId, payload.enabled);
    return sanitizePluginSnapshot();
  });
  register("plugins:settings", (payload) => pluginRegistry.saveSettings(payload.pluginId, payload.settings));

  register("deck:create-profile", (payload) => deckStore.createProfile(payload.name, payload.templateProfileId));
  register("deck:update-profile", (payload) => deckStore.updateProfile(payload.profileId, payload.patch));
  register("deck:delete-profile", (payload) => deckStore.deleteProfile(payload.profileId));
  register("deck:activate-profile", (payload) => deckStore.activateProfile(payload.profileId));
  register("deck:create-folder", (payload) => deckStore.createFolder(payload.profileId, payload.name, payload.parentId));
  register("deck:update-folder", (payload) => deckStore.updateFolder(payload.profileId, payload.folderId, payload.patch));
  register("deck:delete-folder", (payload) => deckStore.deleteFolder(payload.profileId, payload.folderId));
  register("deck:activate-folder", (payload) => deckStore.activateFolder(payload.profileId, payload.folderId));
  register("deck:update-button", (payload) => deckStore.updateButton(payload.profileId, payload.folderId, payload.buttonIndex, payload.button));
  register("deck:move-button", (payload) => deckStore.moveButton(payload.profileId, payload.folderId, payload.fromIndex, payload.toIndex));
  register("deck:clear-button", (payload) => deckStore.clearButton(payload.profileId, payload.folderId, payload.buttonIndex));
  register("deck:execute-button", executeButton);

  register("deck:export", async () => {
    const result = await dialog.showSaveDialog({ title: "Touch-Deck exportieren", defaultPath: "Batto-OBS-Tool-Deck.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return null;
    return deckStore.exportTo(result.filePath);
  });
  register("deck:import", async (payload) => {
    const result = await dialog.showOpenDialog({ title: "Touch-Deck importieren", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return deckStore.importFrom(result.filePaths[0], payload.mode || "merge");
  });
}

app.whenReady().then(initialize).catch((error) => console.error("Touch-Deck-Runtime konnte nicht starten:", error));
app.on("before-quit", () => { void obs?.disconnect(); });

module.exports = { SUPPORTED_ACTION_TYPES, executeAction, initialize, obsAction, sanitizePluginSnapshot, toggleObsOutput };
