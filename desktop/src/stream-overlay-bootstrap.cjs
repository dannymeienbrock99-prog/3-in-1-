"use strict";

const path = require("node:path");
const { app } = require("electron");
const { StreamOverlayServer } = require("./services/stream-overlay-server.cjs");

let server = null;
let startError = null;

async function startStreamOverlay() {
  if (server?.status?.().active) return server;
  server = new StreamOverlayServer({
    webRoot: path.join(__dirname, "stream-overlay"),
    configFile: path.join(app.getPath("userData"), "stream-overlay.json"),
    logoPath: path.join(__dirname, "renderer", "assets", "team-alpha-logo.svg"),
    preferredPort: 48621
  });
  try {
    await server.start();
    startError = null;
    return server;
  } catch (error) {
    startError = error;
    server = null;
    console.error("Stream-Overlay konnte nicht starten:", error);
    throw error;
  }
}

function getStreamOverlayServer() { return server; }
function getStreamOverlayStatus() {
  return server?.status?.() || { active: false, error: startError ? String(startError.message || startError) : "" };
}

app.whenReady().then(() => startStreamOverlay()).catch(() => {});
app.on("before-quit", () => { void server?.stop?.(); });

module.exports = { getStreamOverlayServer, getStreamOverlayStatus, startStreamOverlay };
