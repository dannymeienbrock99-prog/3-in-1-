"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocketServer, WebSocket } = require("ws");
const {
  clampNumber,
  contentType,
  deepClone,
  normalizePathInside,
  randomId,
  readJson,
  readRequestJson,
  safeText,
  sendJson,
  sendText,
  writeJsonAtomic
} = require("./common.cjs");

const ELEMENT_TYPES = Object.freeze([
  "text", "goal", "timer", "chat", "giftFeed", "giftAlarm", "topList", "likeCounter",
  "coHost", "treasure", "portal", "tiktokEvents", "heartRate", "wheel", "poll", "wordCloud", "logo", "image"
]);

function defaultElement(type, index = 0) {
  const positions = {
    goal: [4, 4, 32, 13], timer: [74, 4, 22, 12], chat: [4, 62, 34, 32], giftFeed: [65, 62, 31, 32],
    logo: [42, 3, 16, 20], heartRate: [40, 74, 20, 14], wheel: [38, 20, 24, 42]
  };
  const position = positions[type] || [8 + (index % 5) * 16, 12 + Math.floor(index / 5) * 16, 22, 12];
  const titles = {
    text: "Text", goal: "Follower-Ziel", timer: "Stream-Timer", chat: "Live-Chat", giftFeed: "Geschenke",
    giftAlarm: "Geschenk-Alarm", topList: "Topliste", likeCounter: "Likes", coHost: "Co-Host",
    treasure: "Schatztruhe", portal: "Portal", tiktokEvents: "TikTok-Ereignisse", heartRate: "Herzfrequenz",
    wheel: "Glücksrad", poll: "Umfrage", wordCloud: "Wortwolke", logo: "Team Alpha", image: "Bild"
  };
  return {
    id: randomId(type), type, title: titles[type] || type, text: type === "text" ? "Freier Hinweis" : "",
    x: position[0], y: position[1], width: position[2], height: position[3], zIndex: index + 1,
    visible: true, locked: false, fontSize: type === "chat" || type === "giftFeed" ? 28 : 34,
    fontFamily: "Inter, Segoe UI, Arial, sans-serif", fontWeight: 800, textColor: "#ffffff",
    accentColor: type === "giftFeed" ? "#ff4f98" : type === "timer" ? "#ad6cff" : "#4fd8ff",
    backgroundColor: "#0b1522", backgroundOpacity: 0.72, borderColor: "#33546b", borderWidth: 1,
    borderRadius: 14, padding: 14, alignment: "center", shadow: 18, value: 0, target: 1000,
    durationMs: 20000, maximumItems: 8, source: type === "logo" ? "/assets/team-logo" : "",
    settings: {}
  };
}

function defaultOverlayConfig() {
  return {
    version: 2,
    orientation: "landscape",
    width: 1920,
    height: 1080,
    transparent: true,
    backgroundColor: "#000000",
    backgroundOpacity: 0,
    safeArea: 1,
    elements: [defaultElement("goal", 0), defaultElement("timer", 1), defaultElement("chat", 2), defaultElement("giftFeed", 3), defaultElement("logo", 4)],
    updatedAt: Date.now()
  };
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
}

function normalizeElement(value = {}, index = 0) {
  const type = ELEMENT_TYPES.includes(value.type) ? value.type : "text";
  const fallback = defaultElement(type, index);
  return {
    ...fallback,
    ...value,
    id: safeText(value.id || fallback.id, 120),
    type,
    title: safeText(value.title || fallback.title, 180),
    text: safeText(value.text || "", 5000),
    x: clampNumber(value.x, 0, 100, fallback.x),
    y: clampNumber(value.y, 0, 100, fallback.y),
    width: clampNumber(value.width, 2, 100, fallback.width),
    height: clampNumber(value.height, 2, 100, fallback.height),
    zIndex: Math.round(clampNumber(value.zIndex, 0, 1000, fallback.zIndex)),
    visible: value.visible !== false,
    locked: Boolean(value.locked),
    fontSize: Math.round(clampNumber(value.fontSize, 8, 160, fallback.fontSize)),
    fontFamily: safeText(value.fontFamily || fallback.fontFamily, 300),
    fontWeight: Math.round(clampNumber(value.fontWeight, 300, 1000, fallback.fontWeight)),
    textColor: normalizeColor(value.textColor, fallback.textColor),
    accentColor: normalizeColor(value.accentColor, fallback.accentColor),
    backgroundColor: normalizeColor(value.backgroundColor, fallback.backgroundColor),
    backgroundOpacity: clampNumber(value.backgroundOpacity, 0, 1, fallback.backgroundOpacity),
    borderColor: normalizeColor(value.borderColor, fallback.borderColor),
    borderWidth: clampNumber(value.borderWidth, 0, 12, fallback.borderWidth),
    borderRadius: clampNumber(value.borderRadius, 0, 80, fallback.borderRadius),
    padding: clampNumber(value.padding, 0, 80, fallback.padding),
    alignment: ["left", "center", "right"].includes(value.alignment) ? value.alignment : fallback.alignment,
    shadow: clampNumber(value.shadow, 0, 80, fallback.shadow),
    value: Number(value.value) || 0,
    target: Math.max(0, Number(value.target) || fallback.target),
    durationMs: Math.round(clampNumber(value.durationMs, 1000, 300000, fallback.durationMs)),
    maximumItems: Math.round(clampNumber(value.maximumItems, 1, 100, fallback.maximumItems)),
    source: safeText(value.source || fallback.source, 2000),
    settings: value.settings && typeof value.settings === "object" ? deepClone(value.settings) : {}
  };
}

function normalizeOverlayConfig(value = {}) {
  const width = Math.round(clampNumber(value.width, 320, 7680, 1920));
  const height = Math.round(clampNumber(value.height, 240, 4320, 1080));
  const elements = Array.isArray(value.elements) ? value.elements.slice(0, 100).map(normalizeElement) : defaultOverlayConfig().elements;
  return {
    version: 2,
    orientation: value.orientation === "portrait" || height > width ? "portrait" : "landscape",
    width,
    height,
    transparent: value.transparent !== false,
    backgroundColor: normalizeColor(value.backgroundColor, "#000000"),
    backgroundOpacity: clampNumber(value.backgroundOpacity, 0, 1, 0),
    safeArea: clampNumber(value.safeArea, 0.8, 1, 1),
    elements,
    updatedAt: Date.now()
  };
}

class StreamOverlayServer extends EventEmitter {
  constructor({ webRoot, configFile, logoPath, preferredPort = 48621 } = {}) {
    super();
    this.webRoot = webRoot;
    this.configFile = configFile;
    this.logoPath = logoPath;
    this.preferredPort = preferredPort;
    this.config = normalizeOverlayConfig(readJson(configFile, null) || defaultOverlayConfig());
    this.server = null;
    this.webSocketServer = null;
    this.clients = new Set();
    this.port = 0;
    this.history = [];
  }

  async start() {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => void this.handleRequest(request, response));
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
    this.server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname !== "/ws") return socket.destroy();
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => this.webSocketServer.emit("connection", client, request));
    });
    this.webSocketServer.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
      socket.on("message", (data) => this.handleSocketMessage(socket, data));
      this.send(socket, { type: "config", config: this.config });
      this.send(socket, { type: "history", events: this.history.slice(-100) });
    });
    await this.listenWithFallback();
    this.emit("started", this.status());
    return this.status();
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (error) => { this.server.off("listening", onListening); reject(error); };
      const onListening = () => { this.server.off("error", onError); resolve(); };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, "127.0.0.1");
    });
  }

  async listenWithFallback() {
    let lastError;
    for (let port = this.preferredPort; port < this.preferredPort + 20; port += 1) {
      try { await this.listen(port); this.port = port; return; }
      catch (error) { lastError = error; if (error.code !== "EADDRINUSE") throw error; }
    }
    throw lastError || new Error("Kein freier Stream-Overlay-Port gefunden.");
  }

  status() {
    return {
      active: Boolean(this.server?.listening),
      port: this.port,
      baseUrl: this.port ? `http://127.0.0.1:${this.port}` : "",
      overlayUrl: this.port ? `http://127.0.0.1:${this.port}/overlay` : "",
      chatOverlayUrl: this.port ? `http://127.0.0.1:${this.port}/chat-overlay` : "",
      editorUrl: this.port ? `http://127.0.0.1:${this.port}/editor` : "",
      eventUrl: this.port ? `http://127.0.0.1:${this.port}/api/event` : "",
      chatUrl: this.port ? `http://127.0.0.1:${this.port}/api/chat` : "",
      clients: this.clients.size,
      config: deepClone(this.config)
    };
  }

  saveConfig(value) {
    this.config = normalizeOverlayConfig(value);
    writeJsonAtomic(this.configFile, this.config);
    this.broadcast({ type: "config", config: this.config });
    this.emit("config", deepClone(this.config));
    return deepClone(this.config);
  }

  addElement(type) {
    if (!ELEMENT_TYPES.includes(type)) throw new Error("Unbekannter Overlay-Elementtyp.");
    this.config.elements.push(defaultElement(type, this.config.elements.length));
    return this.saveConfig(this.config);
  }

  updateElement(id, patch = {}) {
    const index = this.config.elements.findIndex((element) => element.id === id);
    if (index < 0) throw new Error("Overlay-Element wurde nicht gefunden.");
    this.config.elements[index] = normalizeElement({ ...this.config.elements[index], ...patch, id }, index);
    return this.saveConfig(this.config);
  }

  deleteElement(id) {
    this.config.elements = this.config.elements.filter((element) => element.id !== id);
    return this.saveConfig(this.config);
  }

  publishEvent(event = {}) {
    const normalized = {
      id: safeText(event.id || randomId("event"), 160),
      type: safeText(event.type || "event", 80),
      platform: safeText(event.platform || "local", 60),
      name: safeText(event.name || event.user || "", 160),
      text: safeText(event.text || event.message || event.gift || "", 5000),
      value: Number(event.value ?? event.count ?? 0) || 0,
      target: Number(event.target ?? 0) || 0,
      userId: safeText(event.userId || "", 160),
      avatarUrl: /^https?:\/\//i.test(String(event.avatarUrl || "")) ? String(event.avatarUrl) : "",
      timestamp: Number(event.timestamp) || Date.now(),
      data: event.data && typeof event.data === "object" ? deepClone(event.data) : {}
    };
    this.history.push(normalized);
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    this.broadcast({ type: "event", event: normalized });
    this.emit("event", normalized);
    return normalized;
  }

  clearEvents() {
    this.history = [];
    this.broadcast({ type: "clear" });
  }

  clearChat(platform = "all") {
    const selected = String(platform || "all").toLowerCase();
    this.history = this.history.filter((event) => event.type !== "chat" || (selected !== "all" && event.platform !== selected));
    this.broadcast({ type: "chat-clear", platform: selected });
  }

  send(socket, value) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }

  broadcast(value) {
    const text = JSON.stringify(value);
    for (const socket of this.clients) if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }

  handleSocketMessage(socket, data) {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    if (message.type === "get-config") return this.send(socket, { type: "config", config: this.config });
    if (message.type === "save-config") {
      try { this.saveConfig(message.config); this.send(socket, { type: "saved", ok: true }); }
      catch (error) { this.send(socket, { type: "saved", ok: false, error: String(error.message || error) }); }
      return;
    }
    if (message.type === "event") this.publishEvent(message.event || {});
    if (message.type === "clear") this.clearEvents();
  }

  async handleRequest(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" };
      if (request.method === "OPTIONS") { response.writeHead(204, cors); return response.end(); }
      if (request.method === "GET" && url.pathname === "/") { response.writeHead(302, { Location: "/editor" }); return response.end(); }
      if (request.method === "GET" && url.pathname === "/overlay") return this.serveFile(path.join(this.webRoot, "overlay.html"), response, cors);
      if (request.method === "GET" && url.pathname === "/chat-overlay") return this.serveFile(path.join(this.webRoot, "chat-overlay.html"), response, cors);
      if (request.method === "GET" && url.pathname === "/editor") return this.serveFile(path.join(this.webRoot, "editor.html"), response, cors);
      if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, this.status(), cors);
      if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, this.config, cors);
      if (request.method === "PUT" && url.pathname === "/api/config") return sendJson(response, 200, this.saveConfig(await readRequestJson(request, 3_000_000)), cors);
      if (request.method === "POST" && ["/api/event", "/api/chat"].includes(url.pathname)) {
        const body = await readRequestJson(request, 1_000_000);
        if (url.pathname === "/api/chat" && !body.type) body.type = "chat";
        return sendJson(response, 200, { ok: true, event: this.publishEvent(body) }, cors);
      }
      if (request.method === "POST" && url.pathname === "/api/clear") { this.clearEvents(); return sendJson(response, 200, { ok: true }, cors); }
      if (request.method === "GET" && url.pathname === "/assets/team-logo") return this.serveLogo(response, cors);
      if (request.method === "GET") {
        const file = normalizePathInside(this.webRoot, url.pathname);
        if (file) return this.serveFile(file, response, cors);
      }
      return sendJson(response, 404, { ok: false, error: "Nicht gefunden." }, cors);
    } catch (error) {
      return sendJson(response, error.statusCode || 500, { ok: false, error: String(error?.message || error) });
    }
  }

  serveLogo(response, headers) {
    const file = this.logoPath && fs.existsSync(this.logoPath) ? this.logoPath : path.join(this.webRoot, "team-logo.svg");
    return this.serveFile(file, response, headers);
  }

  serveFile(file, response, headers = {}) {
    try {
      const data = fs.readFileSync(file);
      response.writeHead(200, { "Content-Type": contentType(file), "Content-Length": data.length, "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=60", ...headers });
      response.end(data);
    } catch {
      sendText(response, 404, "Datei nicht gefunden.", "text/plain; charset=utf-8", headers);
    }
  }

  async stop() {
    for (const socket of this.clients) try { socket.close(1001, "Batto OBS Tool beendet"); } catch {}
    this.clients.clear();
    try { this.webSocketServer?.close(); } catch {}
    await new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
    this.webSocketServer = null;
    this.server = null;
    this.port = 0;
  }
}

module.exports = { ELEMENT_TYPES, StreamOverlayServer, defaultElement, defaultOverlayConfig, normalizeElement, normalizeOverlayConfig };
