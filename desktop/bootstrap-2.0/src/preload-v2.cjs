"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_INVOKE = new Set([
  "app:getState",
  "app:close",
  "app:saveSettings",
  "hardware:scan",
  "hardware:saveReport",
  "internet:test",
  "obs:connect",
  "obs:disconnect",
  "obs:refresh",
  "obs:call",
  "recommendation:build",
  "test:cpu",
  "test:record",
  "monitoring:open",
  "monitoring:copyUrl",
  "streamOverlay:open",
  "streamOverlay:copyUrl",
  "streamOverlay:event",
  "multichat:update",
  "multichat:connectTwitch",
  "multichat:disconnectTwitch",
  "multichat:connectYouTube",
  "multichat:disconnectYouTube",
  "multichat:test",
  "multichat:clear",
  "multichat:tts",
  "guests:load",
  "guests:save",
  "guests:apply",
  "holo:open",
  "holo:copyUrl",
  "holo:test",
  "holo:clear",
  "deck:command",
  "plugins:scan",
  "plugins:import",
  "plugins:setEnabled",
  "mobile:command",
  "migration:run"
]);

function invoke(channel, payload) {
  if (!ALLOWED_INVOKE.has(channel)) {
    return Promise.reject(new Error(`Nicht erlaubter IPC-Kanal: ${channel}`));
  }
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld("batto", Object.freeze({
  invoke,
  onState(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("app:state", listener);
    return () => ipcRenderer.removeListener("app:state", listener);
  },
  onChat(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("multichat:message", listener);
    return () => ipcRenderer.removeListener("multichat:message", listener);
  },
  onError(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, error) => callback(error);
    ipcRenderer.on("app:error", listener);
    return () => ipcRenderer.removeListener("app:error", listener);
  }
}));
