"use strict";

const path = require("node:path");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell
} = require("electron");
const { SettingsStore } = require("./services/store.cjs");
const { SecretStore } = require("./services/secret-store.cjs");
const { ObsWebSocketClient, normalizeLocalObsHost } = require("./services/obs-websocket.cjs");
const { TwitchHoloServer } = require("./services/twitch-holo-server.cjs");
const { HybridRuntime } = require("./services/hybrid-runtime.cjs");

const uiSmokeMode = process.argv.includes("--ui-smoke-test");
if (uiSmokeMode) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
}

app.setName("Batto 3-in-1");
app.setPath("userData", process.env.BATTO_OBS_DATA || path.join(app.getPath("appData"), "Batto 3-in-1"));

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.exit(0);

let mainWindow = null;
let settingsStore = null;
let secretStore = null;
let hybridRuntime = null;
let holoServer = null;
let moduleErrors = {};
const obs = new ObsWebSocketClient();

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function userDataFile(name) {
  return path.join(app.getPath("userData"), name);
}

function errorPayload(error) {
  return {
    message: String(error?.message || error || "Unbekannter Fehler"),
    name: error?.name || "Error",
    code: error?.code || ""
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} nach ${milliseconds} ms abgebrochen.`)), milliseconds);
    })
  ]);
}

async function safeObsSnapshot() {
  try {
    return await obs.snapshot();
  } catch (error) {
    return { ...obs.status(), available: false, error: errorPayload(error) };
  }
}

async function startLocalModules() {
  moduleErrors = {};
  try {
    holoServer = new TwitchHoloServer({
      preferredPort: 17823,
      webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web")
    });
    await holoServer.start();
  } catch (error) {
    moduleErrors.twitchHolo = errorPayload(error);
    holoServer = null;
    console.error("Twitch-Hologramm konnte nicht starten:", error);
  }
}

async function stateSnapshot() {
  const state = await settingsStore.get();
  const obsSnapshot = await safeObsSnapshot();
  const platformSecrets = hybridRuntime ? await hybridRuntime.secretStatus() : {};
  const connections = hybridRuntime ? hybridRuntime.connections.statuses() : {};
  return {
    product: {
      name: "Batto OBS Tool",
      version: app.getVersion(),
      author: "Crazy_Batto / Team Alpha",
      packaged: app.isPackaged
    },
    settings: {
      ...state,
      obs: {
        ...state.obs,
        password: "",
        passwordConfigured: await secretStore.has("obs-websocket-password")
      }
    },
    platformSecrets,
    connections,
    obs: obsSnapshot,
    twitchHolo: holoServer?.status() || { running: false },
    moduleErrors: { ...moduleErrors }
  };
}

function createMainWindow({ show = true, diagnostics = null } = {}) {
  mainWindow = new BrowserWindow({
    title: "Batto OBS Tool",
    width: 1500,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: "#070b12",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, "renderer", "assets", "team-alpha-logo.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  const window = mainWindow;
  window.webContents.on("did-start-loading", () => diagnostics?.push?.("did-start-loading"));
  window.webContents.on("dom-ready", () => diagnostics?.push?.("dom-ready"));
  window.webContents.on("did-finish-load", () => diagnostics?.push?.("did-finish-load-event"));
  window.webContents.on("did-stop-loading", () => diagnostics?.push?.("did-stop-loading"));
  window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    diagnostics?.push?.(`did-fail-load ${code} ${description} ${url} main=${isMainFrame}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    diagnostics?.push?.(`render-process-gone ${details.reason || "unbekannt"}`);
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    diagnostics?.push?.(`preload-error ${preloadPath}: ${String(error?.message || error)}`);
  });
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) diagnostics?.push?.(`console[${level}] ${message}`);
  });

  const loadPromise = window.loadFile(path.join(__dirname, "renderer", "index.html"));
  loadPromise.then(() => diagnostics?.push?.("loadFile-resolved")).catch((error) => diagnostics?.push?.(`loadFile: ${String(error?.message || error)}`));
  if (show) window.once("ready-to-show", () => window?.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  return { window, loadPromise };
}

function registerIpc() {
  ipcMain.handle("app:get-state", () => stateSnapshot());

  ipcMain.handle("settings:save", async (_event, value) => {
    const payload = value && typeof value === "object" ? value : {};
    if (payload.obs && Object.prototype.hasOwnProperty.call(payload.obs, "password")) payload.obs = { ...payload.obs, password: "" };
    const saved = await settingsStore.patch(payload);
    await hybridRuntime?.configureFromSettings();
    return saved;
  });

  ipcMain.handle("hybrid:status", () => hybridRuntime?.refresh() || {});
  ipcMain.handle("hybrid:refresh", () => hybridRuntime?.refresh() || {});
  ipcMain.handle("hybrid:health-check", () => hybridRuntime?.healthCheck() || { ready: false, checks: {} });
  ipcMain.handle("hybrid:secret-status", () => hybridRuntime?.secretStatus() || {});
  ipcMain.handle("hybrid:set-secret", (_event, name, value) => hybridRuntime.setSecret(name, value));
  ipcMain.handle("tiktok-live-studio:status", () => hybridRuntime.liveStudio.status());
  ipcMain.handle("tiktok-live-studio:launch", () => hybridRuntime.liveStudio.launch());

  ipcMain.handle("obs:connect", async (_event, input = {}) => {
    const current = await settingsStore.get();
    const host = normalizeLocalObsHost(input.host || current.obs.host || "127.0.0.1");
    const port = Number(input.port || current.obs.port || 4455);
    let password = String(input.password || "");
    if (!password) password = await secretStore.get("obs-websocket-password");
    const result = await obs.connect({ host, port, password });
    await settingsStore.patch({ obs: { host, port, password: "" } });
    if (input.rememberPassword && password) await secretStore.set("obs-websocket-password", password);
    else if (input.clearStoredPassword) await secretStore.delete("obs-websocket-password");
    return result;
  });

  ipcMain.handle("obs:disconnect", async () => {
    await obs.disconnect();
    return obs.status();
  });
  ipcMain.handle("obs:forget-password", async () => {
    await secretStore.delete("obs-websocket-password");
    return { configured: false };
  });
  ipcMain.handle("obs:snapshot", () => safeObsSnapshot());
  ipcMain.handle("obs:execute", (_event, action, payload) => obs.execute(action, payload));
  ipcMain.handle("obs:recording-test", (_event, options) => obs.runRecordingTest(options?.durationSeconds || 15));

  ipcMain.handle("holo:status", () => holoServer?.status() || { running: false });
  ipcMain.handle("holo:open-editor", async () => {
    const status = holoServer?.status();
    if (!status?.editorUrl) throw new Error("Hologramm-Editor ist nicht gestartet.");
    await shell.openExternal(status.editorUrl);
    return status;
  });
  ipcMain.handle("holo:copy-url", () => {
    const status = holoServer?.status();
    if (!status?.overlayUrl) throw new Error("Hologramm-Overlay ist nicht gestartet.");
    clipboard.writeText(status.overlayUrl);
    return status.overlayUrl;
  });

  ipcMain.handle("deck:execute", async (_event, assignment = {}) => {
    if (assignment.type === "obs") return obs.execute(assignment.action, assignment.payload || {});
    if (assignment.type === "url") {
      const url = String(assignment.url || "");
      if (!/^https?:\/\//i.test(url)) throw new Error("Nur HTTP- oder HTTPS-Adressen sind erlaubt.");
      await shell.openExternal(url);
      return { opened: true };
    }
    if (assignment.type === "holo-editor") {
      const status = holoServer?.status();
      if (!status?.editorUrl) throw new Error("Hologramm-Editor ist nicht gestartet.");
      return shell.openExternal(status.editorUrl);
    }
    throw new Error("Diese Touch-Deck-Aktion ist nicht eingerichtet.");
  });

  ipcMain.handle("dialog:save-report", async (_event, report) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Batto-OBS-Tool-Bericht speichern",
      defaultPath: `Batto-OBS-Tool-Bericht-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    const fs = require("node:fs/promises");
    await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), "utf8");
    return { saved: true, filePath: result.filePath };
  });
}

function createHybridRuntime() {
  hybridRuntime = new HybridRuntime({
    settingsStore,
    secretStore,
    obs,
    emit: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  });
}

async function runSelfTest() {
  const result = {
    product: "Batto OBS Tool",
    version: app.getVersion(),
    platform: process.platform,
    hardwareDiagnostics: false,
    modules: {}
  };
  const testHolo = new TwitchHoloServer({
    preferredPort: 18923,
    webRoot: path.join(__dirname, "..", "modules", "twitch-holo-chat", "web")
  });
  await testHolo.start();
  result.modules.twitchHolo = testHolo.status().running;
  await testHolo.stop();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function runUiSmokeTest() {
  createHybridRuntime();
  registerIpc();
  const diagnostics = [];
  const { window, loadPromise } = createMainWindow({ show: false, diagnostics });
  try {
    await withTimeout(loadPromise, 12000, "Renderer laden");
  } catch (error) {
    throw new Error(`${error.message} Diagnose: ${diagnostics.join(" | ")} URL=${window.webContents.getURL()} loading=${window.webContents.isLoading()} mainLoading=${window.webContents.isLoadingMainFrame()}`);
  }

  let readiness = null;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    readiness = await withTimeout(
      window.webContents.executeJavaScript("window.__battoRendererReady || null"),
      2000,
      "Renderer-Bereitschaft abfragen"
    );
    if (readiness) break;
    await sleep(250);
  }
  if (!readiness) throw new Error(`Renderer hat keinen Bereitschaftsstatus gemeldet. Diagnose: ${diagnostics.join(" | ")}`);

  const result = await withTimeout(window.webContents.executeJavaScript(`(() => ({
    api: Boolean(window.batto),
    renderer: window.__battoRendererReady || null,
    pageTitle: document.getElementById("page-title")?.textContent || "",
    obsConnect: Boolean(document.getElementById("obs-connect")),
    settingsView: Boolean(document.getElementById("view-settings")),
    hardwareNav: Boolean(document.querySelector('[data-view="hardware"]')),
    hardwareView: Boolean(document.getElementById("view-hardware")),
    hardwareText: document.body.innerText.includes("Hardwarediagnose"),
    monitoringText: document.body.innerText.includes("Encoder- und Hardware-Monitoring")
  }))()`), 3000, "Renderer-Zustand prüfen");

  if (!result.api) throw new Error("Preload API fehlt im Renderer.");
  if (!result.renderer?.ok) throw new Error(`Renderer nicht bereit: ${result.renderer?.error || "unbekannt"}; Diagnose: ${diagnostics.join(" | ")}`);
  if (!result.obsConnect || !result.settingsView) throw new Error(`Kernoberfläche wurde nicht vollständig geladen. Diagnose: ${diagnostics.join(" | ")}`);
  if (result.hardwareNav || result.hardwareView || result.hardwareText || result.monitoringText) throw new Error("Hardwarediagnose/Monitoring ist noch im ausgelieferten Renderer vorhanden.");
  if (process.argv.includes('--suite-smoke')) await require('./suite-smoke.cjs').run(window, diagnostics);
  process.stdout.write(`${JSON.stringify({ uiSmoke: true, diagnostics, ...result })}\n`);
  window.destroy();
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(userDataFile("settings.json"));
  secretStore = new SecretStore(userDataFile("secrets.json"), safeStorage);
  await settingsStore.load();

  if (process.argv.includes("--self-test")) {
    try {
      await runSelfTest();
      app.exit(0);
    } catch (error) {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      app.exit(1);
    }
    return;
  }

  if (process.argv.includes("--ui-smoke-test")) {
    try {
      await runUiSmokeTest();
      app.exit(0);
    } catch (error) {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      app.exit(1);
    }
    return;
  }

  createHybridRuntime();
  registerIpc();
  await startLocalModules();
  createMainWindow();

  Promise.resolve(hybridRuntime.start()).catch((error) => {
    moduleErrors.hybridRuntime = errorPayload(error);
    console.error("Hybrid-Runtime konnte nicht vollständig starten:", error);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error) => {
  dialog.showErrorBox("Batto OBS Tool konnte nicht starten", String(error?.stack || error));
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void hybridRuntime?.stop();
  void obs.disconnect();
  void holoServer?.stop();
});

module.exports = {
  getObsClient: () => obs
};
