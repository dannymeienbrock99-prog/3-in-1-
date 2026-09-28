"use strict";

const http = require("node:http");
const WebSocket = require("ws");
const { normalizeError, sendJson, serveStatic } = require("./runtime-utils-v2.cjs");

class HoloServer {
  constructor({ webRoot, port = 17821 } = {}) {
    this.webRoot = webRoot;
    this.requestedPort = port;
    this.port = port;
    this.server = null;
    this.wss = null;
    this.error = null;
    this.sources = 0;
  }

  async start() {
    if (this.server) return this.status();
    let port = this.requestedPort;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await this.listen(port); this.port = port; break; }
      catch (error) { if (error.code !== "EADDRINUSE" || attempt === 29) { this.error = normalizeError(error); throw error; } port += 1; }
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
              if (["config", "set-user-style", "remove-user-style", "set-role-style"].includes(message.type)) this.broadcast(message, ws);
            } catch {}
          });
        });
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.off("error", reject); this.server = server; this.wss = wss; resolve(); });
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
      running: Boolean(this.server), host: "127.0.0.1", port: this.port, sources: this.sources,
      overlayUrl: `http://127.0.0.1:${this.port}/overlay.html?ws=${encodeURIComponent(`ws://127.0.0.1:${this.port}/ws`)}`,
      editorUrl: `http://127.0.0.1:${this.port}/editor.html`, error: this.error
    };
  }

  message(payload = {}) {
    const role = String(payload.role || "viewer");
    const roles = {
      broadcaster: { broadcaster: true }, moderator: { moderator: true }, vip: { vip: true }, subscriber: { subscriber: true }, viewer: {}
    }[role] || {};
    const message = {
      type: "message",
      message: {
        id: String(payload.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        userId: String(payload.userId || ""), username: String(payload.username || payload.displayName || "").toLowerCase(),
        displayName: String(payload.displayName || payload.name || "Crazy_Batto").slice(0, 160),
        text: String(payload.text || "Hologramm-Testnachricht").slice(0, 5000), color: String(payload.color || "#55d6ff"), roles
      }
    };
    this.broadcast(message);
    return message.message;
  }

  deleteMessage(id) { this.broadcast({ type: "delete", messageId: id }); }
  clearUser(userId) { this.broadcast({ type: "clear-user", userId }); }
  clear() { this.broadcast({ type: "clear" }); }

  broadcast(payload, except = null) {
    if (!this.wss) return;
    const text = JSON.stringify(payload);
    for (const socket of this.wss.clients) if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(text);
  }

  handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/status") { sendJson(response, 200, this.status()); return; }
    if (url.pathname === "/overlay") { response.writeHead(302, { Location: `/overlay.html?ws=${encodeURIComponent(`ws://127.0.0.1:${this.port}/ws`)}` }); response.end(); return; }
    if (url.pathname === "/editor") { response.writeHead(302, { Location: "/editor.html" }); response.end(); return; }
    serveStatic(response, this.webRoot, url.pathname, "editor.html");
  }
}

module.exports = { HoloServer };
