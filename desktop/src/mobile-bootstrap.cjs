"use strict";

const path = require("node:path");
const { app, ipcMain } = require("electron");
const { MobileBridge } = require("./services/mobile-bridge-v2.cjs");
const deckRuntime = require("./deck-creatorhub-bootstrap.cjs");

let bridge = null;
let startupError = "";

function snapshot() {
  return {
    product: "Batto OBS Tool",
    version: app.getVersion(),
    touchDeck: deckRuntime.touchDeckStatus(),
    timestamp: Date.now()
  };
}

async function mobileCommand(command, payload = {}) {
  switch (String(command || "")) {
    case "touchdeck.open":
      return deckRuntime.launchOriginalTouchDeck();
    case "media.mute":
      return deckRuntime.execute("mute");
    case "media.volumeup":
      return deckRuntime.execute("volumeup");
    case "media.volumedown":
      return deckRuntime.execute("volumedown");
    case "state.get":
      return snapshot();
    default:
      throw new Error(`Mobile-Befehl nicht freigegeben: ${String(command || "")}`);
  }
}

async function startMobileBridge() {
  if (bridge?.status?.().running) return bridge.status();
  bridge = new MobileBridge({
    webRoot: path.join(__dirname, "mobile"),
    port: 48620,
    stateProvider: snapshot,
    commandHandler: mobileCommand,
    requireApproval: true
  });
  try {
    const status = await bridge.start();
    startupError = "";
    return status;
  } catch (error) {
    startupError = String(error?.message || error);
    bridge = null;
    throw error;
  }
}

function status() {
  return bridge?.status?.() || {
    running: false,
    port: 48620,
    pendingClients: [],
    connectedClients: [],
    pairing: {},
    addresses: [],
    error: startupError
  };
}

function registerIpc() {
  ipcMain.handle("mobile:status", () => status());
  ipcMain.handle("mobile:start", () => startMobileBridge());
  ipcMain.handle("mobile:regenerate-pin", () => bridge ? bridge.regeneratePin() : startMobileBridge().then(() => bridge.regeneratePin()));
  ipcMain.handle("mobile:set-approval", (_event, value) => {
    if (!bridge) throw new Error("Mobile-Bridge ist nicht gestartet.");
    return bridge.setApproval(value);
  });
  ipcMain.handle("mobile:approve", (_event, id) => {
    if (!bridge) throw new Error("Mobile-Bridge ist nicht gestartet.");
    return bridge.approve(String(id || ""));
  });
  ipcMain.handle("mobile:reject", (_event, id) => {
    if (!bridge) throw new Error("Mobile-Bridge ist nicht gestartet.");
    return bridge.reject(String(id || ""));
  });
  ipcMain.handle("mobile:disconnect", (_event, id) => {
    if (!bridge) throw new Error("Mobile-Bridge ist nicht gestartet.");
    return bridge.disconnect(String(id || ""));
  });
}

registerIpc();
app.whenReady().then(() => startMobileBridge()).catch((error) => {
  console.error("Mobile-Bridge konnte nicht starten:", error);
});
app.on("before-quit", () => { void bridge?.stop?.(); });

module.exports = { startMobileBridge, status };
