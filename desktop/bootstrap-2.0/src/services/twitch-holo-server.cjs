"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocketServer, WebSocket } = require("ws");
const { contentType, normalizePathInside, readJson, readRequestJson, sendJson, sendText, writeJsonAtomic } = require("./common.cjs");

class TwitchHoloServer extends EventEmitter {
  constructor({ webRoot, configFile, preferredPort = 17821 } = {}) {
    super();
    this.webRoot = webRoot;
    this.configFile = configFile;
    this.preferredPort = preferredPort;
    this.config = readJson(configFile, {}) || {};
    this.server = null;
    this.webSocketServer = null;
    this.clients = new Set();
    this.port = 0;
  }

  async start() {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => void this.handleRequest(request, response));
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
    this.server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname !== "/ws") return socket.destroy();
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => this.webSocketServer.emit("connection", client, request));
    });
    this.webSocketServer.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));
      this.send(socket, { type: "config", config: this.config });
    });
    await this.listenWithFallback();
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
    throw lastError || new Error("Kein freier Port für Twitch-Hologramm gefunden.");
  }

  status() {
    const baseUrl = this.port ? `http://127.0.0.1:${this.port}` : "";
    const ws = this.port ? `ws://127.0.0.1:${this.port}/ws` : "";
    return {
      active: Boolean(this.server?.listening), port: this.port, baseUrl,
      editorUrl: baseUrl ? `${baseUrl}/editor.html?ws=${encodeURIComponent(ws)}` : "",
      overlayUrl: baseUrl ? `${baseUrl}/overlay.html?ws=${encodeURIComponent(ws)}` : "",
      clients: this.clients.size, config: this.config
    };
  }

  send(socket, value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
  broadcast(value) { const text = JSON.stringify(value); for (const socket of this.clients) if (socket.readyState === WebSocket.OPEN) socket.send(text); }

  setConfig(config) {
    this.config = config && typeof config === "object" ? config : {};
    writeJsonAtomic(this.configFile, this.config);
    this.broadcast({ type: "config", config: this.config });
    return this.config;
  }

  publishMessage(message) {
    const envelope = { type: "message", message: { ...message, id: message.id || `holo-${Date.now()}` } };
    this.broadcast(envelope);
    return envelope.message;
  }

  deleteMessage(messageId) { this.broadcast({ type: "delete", messageId }); }
  clearUser(userId) { this.broadcast({ type: "clear-user", userId }); }
  clear() { this.broadcast({ type: "clear" }); }

  async handleRequest(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS" };
      if (request.method === "OPTIONS") { response.writeHead(204, cors); return response.end(); }
      if (request.method === "GET" && url.pathname === "/") { response.writeHead(302, { Location: "/editor.html" }); return response.end(); }
      if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, this.status(), cors);
      if (request.method === "GET" && url.pathname === "/api/config") return sendJson(response, 200, this.config, cors);
      if (request.method === "PUT" && url.pathname === "/api/config") return sendJson(response, 200, this.setConfig(await readRequestJson(request)), cors);
      if (request.method === "POST" && url.pathname === "/api/message") return sendJson(response, 200, { ok: true, message: this.publishMessage(await readRequestJson(request)) }, cors);
      if (request.method === "POST" && url.pathname === "/api/clear") { this.clear(); return sendJson(response, 200, { ok: true }, cors); }
      if (request.method === "GET") {
        const file = normalizePathInside(this.webRoot, url.pathname);
        if (file) return this.serveFile(file, response, cors);
      }
      return sendJson(response, 404, { ok: false, error: "Nicht gefunden." }, cors);
    } catch (error) {
      return sendJson(response, 500, { ok: false, error: String(error?.message || error) });
    }
  }

  serveFile(file, response, headers = {}) {
    try {
      const data = fs.readFileSync(file);
      response.writeHead(200, { "Content-Type": contentType(file), "Content-Length": data.length, "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=60", ...headers });
      response.end(data);
    } catch { sendText(response, 404, "Datei nicht gefunden.", "text/plain; charset=utf-8", headers); }
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

module.exports = { TwitchHoloServer };
