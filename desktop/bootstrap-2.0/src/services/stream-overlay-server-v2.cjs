"use strict";

const http = require("node:http");
const path = require("node:path");
const WebSocket = require("ws");
const { atomicWrite, clone, normalizeError, readJson, readJsonBody, sendJson, serveStatic } = require("./runtime-utils-v2.cjs");

const DEFAULT_CONFIG = Object.freeze({
  version: 2,
  resolution: { width: 1920, height: 1080 },
  background: "transparent",
  elements: [
    { id: "team-logo", type: "image", title: "Team Alpha", x: 32, y: 30, width: 170, height: 170, opacity: 1, visible: true, src: "/team-logo.svg", fit: "contain", background: "transparent", borderColor: "transparent", borderWidth: 0, radius: 0 },
    { id: "follower-goal", type: "goal", title: "Follower-Ziel", x: 310, y: 42, width: 410, height: 105, opacity: .95, visible: true, value: 0, target: 1000, accent: "#55d6ff", color: "#ffffff", background: "rgba(10,18,29,.78)", borderColor: "#55d6ff", borderWidth: 2, radius: 16 },
    { id: "timer", type: "timer", title: "Stream-Timer", x: 1450, y: 44, width: 330, height: 104, opacity: .95, visible: true, accent: "#aa62ff", color: "#ffffff", background: "rgba(10,18,29,.78)", borderColor: "#8d5cff", borderWidth: 2, radius: 16 },
    { id: "chat", type: "chat", title: "Live-Chat", x: 70, y: 620, width: 500, height: 360, opacity: .94, visible: true, maxMessages: 8, displayMs: 20000, accent: "#55d6ff", color: "#ffffff", background: "rgba(10,18,29,.72)", borderColor: "#55d6ff", borderWidth: 1, radius: 16 },
    { id: "gift-feed", type: "giftFeed", title: "Geschenke", x: 1350, y: 620, width: 500, height: 360, opacity: .94, visible: true, maxMessages: 8, displayMs: 20000, accent: "#ff4f95", color: "#ffffff", background: "rgba(10,18,29,.72)", borderColor: "#ff4f95", borderWidth: 1, radius: 16 }
  ]
});

function normalizeElement(value = {}) {
  const type = String(value.type || "text").slice(0, 50);
  return {
    id: String(value.id || `${type}-${Date.now()}`).slice(0, 120),
    type,
    title: String(value.title || type).slice(0, 160),
    text: String(value.text || "").slice(0, 5000),
    x: Math.max(0, Number(value.x) || 0),
    y: Math.max(0, Number(value.y) || 0),
    width: Math.max(40, Number(value.width) || 300),
    height: Math.max(30, Number(value.height) || 100),
    opacity: Math.max(0, Math.min(1, Number(value.opacity ?? 1))),
    visible: value.visible !== false,
    value: Number(value.value) || 0,
    target: Math.max(1, Number(value.target) || 1000),
    fontSize: Math.max(8, Math.min(200, Number(value.fontSize) || 28)),
    fontFamily: String(value.fontFamily || "Inter, Segoe UI, Arial").slice(0, 200),
    color: String(value.color || "#ffffff").slice(0, 80),
    accent: String(value.accent || "#55d6ff").slice(0, 80),
    background: String(value.background || "rgba(10,18,29,.72)").slice(0, 120),
    borderColor: String(value.borderColor || "#33485d").slice(0, 80),
    borderWidth: Math.max(0, Math.min(20, Number(value.borderWidth) || 0)),
    radius: Math.max(0, Math.min(100, Number(value.radius) || 0)),
    src: String(value.src || "").slice(0, 4000),
    fit: ["contain", "cover", "fill"].includes(value.fit) ? value.fit : "contain",
    maxMessages: Math.max(1, Math.min(100, Number(value.maxMessages) || 10)),
    displayMs: Math.max(1000, Math.min(300000, Number(value.displayMs) || 20000)),
    options: value.options && typeof value.options === "object" ? clone(value.options) : {}
  };
}

function normalizeConfig(value = {}) {
  const width = Math.max(320, Math.min(7680, Number(value.resolution?.width || value.width) || 1920));
  const height = Math.max(240, Math.min(4320, Number(value.resolution?.height || value.height) || 1080));
  const elements = (Array.isArray(value.elements) ? value.elements : DEFAULT_CONFIG.elements).map(normalizeElement).slice(0, 250);
  elements.forEach((element) => {
    element.width = Math.min(element.width, width);
    element.height = Math.min(element.height, height);
    element.x = Math.max(0, Math.min(width - element.width, element.x));
    element.y = Math.max(0, Math.min(height - element.height, element.y));
  });
  return { version: 2, resolution: { width, height }, background: "transparent", elements };
}

class StreamOverlayServer {
  constructor({ webRoot, configFile, port = 48621 } = {}) {
    this.webRoot = webRoot;
    this.configFile = configFile;
    this.requestedPort = port;
    this.port = port;
    this.server = null;
    this.wss = null;
    this.config = normalizeConfig(readJson(configFile, DEFAULT_CONFIG));
    this.error = null;
    this.sources = 0;
  }

  async start() {
    if (this.server) return this.status();
    let port = this.requestedPort;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await this.listen(port); this.port = port; break; }
      catch (error) {
        if (error.code !== "EADDRINUSE" || attempt === 29) { this.error = normalizeError(error); throw error; }
        port += 1;
      }
    }
    this.error = null;
    return this.status();
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => this.handle(request, response));
      const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false, maxPayload: 1_000_000 });
      server.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
        if (url.pathname !== "/ws") { socket.destroy(); return; }
        wss.handleUpgrade(request, socket, head, (ws) => {
          this.sources += 1;
          ws.on("close", () => { this.sources = Math.max(0, this.sources - 1); });
          ws.on("message", (raw) => {
            try {
              const message = JSON.parse(raw.toString("utf8"));
              if (message.type === "config" && message.config) this.setConfig(message.config);
              if (message.type === "event" && message.payload) this.emitEvent(message.payload, ws);
            } catch {}
          });
          ws.send(JSON.stringify({ type: "config", config: this.config }));
        });
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server; this.wss = wss; resolve();
      });
    });
  }

  async stop() {
    if (this.wss) for (const socket of this.wss.clients) try { socket.close(1001, "Server beendet"); } catch {}
    if (this.wss) this.wss.close();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.wss = null; this.server = null; this.sources = 0;
  }

  status() {
    return {
      running: Boolean(this.server),
      host: "127.0.0.1",
      port: this.port,
      overlayUrl: `http://127.0.0.1:${this.port}/overlay.html`,
      editorUrl: `http://127.0.0.1:${this.port}/editor.html`,
      chatIngestUrl: `http://127.0.0.1:${this.port}/api/chat`,
      sources: this.sources,
      error: this.error,
      config: clone(this.config)
    };
  }

  setConfig(value) {
    this.config = normalizeConfig(value);
    atomicWrite(this.configFile, this.config);
    this.broadcast({ type: "config", config: this.config });
    return clone(this.config);
  }

  emitEvent(payload = {}, except = null) {
    const event = {
      id: String(payload.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      type: String(payload.type || "chat").slice(0, 80),
      name: String(payload.name || payload.displayName || payload.user || "").slice(0, 160),
      text: String(payload.text || payload.message || payload.gift || "").slice(0, 5000),
      value: Number(payload.value ?? payload.count ?? payload.amount) || 0,
      target: Number(payload.target) || 0,
      platform: String(payload.platform || "local").slice(0, 80),
      image: String(payload.image || payload.avatar || "").slice(0, 4000),
      timestamp: payload.timestamp || new Date().toISOString(),
      data: payload.data && typeof payload.data === "object" ? clone(payload.data) : {}
    };
    this.broadcast({ type: "event", event }, except);
    return event;
  }

  broadcast(payload, except = null) {
    if (!this.wss) return;
    const text = JSON.stringify(payload);
    for (const socket of this.wss.clients) if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(text);
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/status" && request.method === "GET") { sendJson(response, 200, this.status()); return; }
    if (url.pathname === "/api/config" && request.method === "GET") { sendJson(response, 200, this.config); return; }
    if (url.pathname === "/api/config" && request.method === "PUT") {
      try { sendJson(response, 200, { ok: true, config: this.setConfig(await readJsonBody(request)) }); }
      catch (error) { sendJson(response, 400, { ok: false, error: normalizeError(error) }); }
      return;
    }
    if ((url.pathname === "/api/event" || url.pathname === "/api/chat") && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const event = this.emitEvent(url.pathname === "/api/chat" ? { type: "chat", ...body } : body);
        sendJson(response, 200, { ok: true, event });
      } catch (error) { sendJson(response, 400, { ok: false, error: normalizeError(error) }); }
      return;
    }
    if (url.pathname === "/overlay") { response.writeHead(302, { Location: "/overlay.html" }); response.end(); return; }
    if (url.pathname === "/editor") { response.writeHead(302, { Location: "/editor.html" }); response.end(); return; }
    serveStatic(response, this.webRoot, url.pathname, "editor.html");
  }
}

module.exports = { DEFAULT_CONFIG, StreamOverlayServer, normalizeConfig, normalizeElement };
