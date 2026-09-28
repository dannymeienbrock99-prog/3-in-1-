"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const QRCode = require("qrcode");
const WebSocket = require("ws");
const { isPrivateAddress, localAddresses, normalizeError, randomPin, readJsonBody, sendJson, serveStatic } = require("./runtime-utils-v2.cjs");

function clientId() {
  return crypto.randomUUID();
}

class MobileBridge extends EventEmitter {
  constructor({ webRoot, port = 48620, stateProvider, commandHandler, requireApproval = true } = {}) {
    super();
    this.webRoot = webRoot;
    this.port = port;
    this.stateProvider = stateProvider;
    this.commandHandler = commandHandler;
    this.requireApproval = requireApproval;
    this.pin = randomPin();
    this.server = null;
    this.wss = null;
    this.clients = new Map();
    this.pending = new Map();
    this.qr = {};
    this.error = null;
    this.heartbeat = null;
  }

  async start() {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => this.handleHttp(request, response));
    this.server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    this.wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false, maxPayload: 1_000_000 });
    this.server.on("upgrade", (request, socket, head) => {
      const remote = request.socket.remoteAddress;
      if (!isPrivateAddress(remote)) { socket.destroy(); return; }
      const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      if (url.pathname !== "/ws") { socket.destroy(); return; }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.handleSocket(ws, request, url));
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, "0.0.0.0", () => { this.server.off("error", reject); resolve(); });
    });
    await this.rebuildQr();
    this.heartbeat = setInterval(() => {
      for (const client of this.clients.values()) {
        if (client.socket.readyState !== WebSocket.OPEN) continue;
        try { client.socket.ping(); } catch {}
      }
    }, 25_000);
    this.error = null;
    this.emit("status", this.status());
    return this.status();
  }

  async stop() {
    clearInterval(this.heartbeat); this.heartbeat = null;
    for (const client of this.clients.values()) try { client.socket.close(1001, "Server beendet"); } catch {}
    this.clients.clear(); this.pending.clear();
    if (this.wss) this.wss.close();
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    this.wss = null; this.server = null;
    this.emit("status", this.status());
  }

  async rebuildQr() {
    const address = localAddresses(this.port)[0]?.address || "127.0.0.1";
    const base = `http://${address}:${this.port}/`;
    const battoUrl = `battoobstool://pair?host=${encodeURIComponent(address)}&port=${this.port}&pin=${this.pin}`;
    const legacyUrl = `creatorhub://pair?host=${encodeURIComponent(address)}&port=${this.port}&pin=${this.pin}`;
    const browserUrl = `${base}?host=${encodeURIComponent(address)}&port=${this.port}&pin=${this.pin}`;
    const [battoQr, legacyQr] = await Promise.all([
      QRCode.toDataURL(browserUrl, { errorCorrectionLevel: "M", margin: 1, width: 520 }),
      QRCode.toDataURL(legacyUrl, { errorCorrectionLevel: "M", margin: 1, width: 520 })
    ]);
    this.qr = { battoUrl, legacyUrl, browserUrl, battoQr, legacyQr };
  }

  status() {
    return {
      running: Boolean(this.server),
      port: this.port,
      pin: this.pin,
      requireApproval: this.requireApproval,
      pairing: { ...this.qr },
      addresses: localAddresses(this.port),
      pendingClients: [...this.pending.values()].map(({ socket: _socket, ...client }) => ({ ...client })),
      connectedClients: [...this.clients.values()].map(({ socket: _socket, ...client }) => ({ ...client })),
      error: this.error
    };
  }

  async regeneratePin() {
    this.pin = randomPin();
    await this.rebuildQr();
    for (const client of this.clients.values()) try { client.socket.close(4001, "PIN geändert"); } catch {}
    this.clients.clear(); this.pending.clear();
    this.emit("status", this.status());
    return this.status();
  }

  setApproval(requireApproval) {
    this.requireApproval = Boolean(requireApproval);
    this.emit("status", this.status());
    return this.status();
  }

  approve(id) {
    const client = this.pending.get(id);
    if (!client) throw new Error("Kopplungsanfrage nicht gefunden");
    this.pending.delete(id); this.clients.set(id, client);
    this.send(client.socket, { type: "paired", clientId: id, state: this.stateProvider?.() || {} });
    this.emit("status", this.status());
    return this.status();
  }

  reject(id) {
    const client = this.pending.get(id);
    if (!client) return this.status();
    this.pending.delete(id);
    try { this.send(client.socket, { type: "rejected" }); client.socket.close(4003, "Kopplung abgelehnt"); } catch {}
    this.emit("status", this.status());
    return this.status();
  }

  disconnect(id) {
    const client = this.clients.get(id) || this.pending.get(id);
    if (client) try { client.socket.close(4000, "Vom PC getrennt"); } catch {}
    this.clients.delete(id); this.pending.delete(id);
    this.emit("status", this.status());
    return this.status();
  }

  broadcastState(state = this.stateProvider?.() || {}) {
    for (const client of this.clients.values()) this.send(client.socket, { type: "state", state });
  }

  broadcast(payload) {
    for (const client of this.clients.values()) this.send(client.socket, payload);
  }

  send(socket, payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  async handleHttp(request, response) {
    const remote = request.socket.remoteAddress;
    if (!isPrivateAddress(remote)) { response.writeHead(403); response.end("Nur lokales Netzwerk"); return; }
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/status" && request.method === "GET") {
      sendJson(response, 200, { running: true, port: this.port, requireApproval: this.requireApproval }); return;
    }
    if (url.pathname === "/api/pair" && request.method === "POST") {
      try {
        const body = await readJsonBody(request, 64_000);
        if (String(body.pin || "") !== this.pin) { sendJson(response, 401, { ok: false, error: "PIN ist falsch" }); return; }
        sendJson(response, 200, { ok: true, websocket: `ws://${request.headers.host}/ws?pin=${this.pin}&name=${encodeURIComponent(body.name || "Handy")}` });
      } catch (error) { sendJson(response, 400, { ok: false, error: normalizeError(error) }); }
      return;
    }
    serveStatic(response, this.webRoot, url.pathname, "index.html");
  }

  handleSocket(socket, request, url) {
    const pin = String(url.searchParams.get("pin") || "");
    if (pin !== this.pin) { socket.close(4003, "PIN falsch"); return; }
    const id = clientId();
    const client = {
      id,
      name: String(url.searchParams.get("name") || "Handy").slice(0, 80),
      address: String(request.socket.remoteAddress || ""),
      connectedAt: new Date().toISOString(),
      socket
    };
    socket.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString("utf8"));
        if (!this.clients.has(id)) {
          if (message.type === "hello") this.send(socket, { type: "pending", clientId: id, requireApproval: this.requireApproval });
          return;
        }
        if (message.type === "command") {
          const result = await this.commandHandler?.(message.command, message.payload || {}, { clientId: id, client });
          this.send(socket, { type: "result", requestId: message.requestId || null, ok: true, result });
        } else if (message.type === "refresh") {
          this.send(socket, { type: "state", state: this.stateProvider?.() || {} });
        } else if (message.type === "ping") this.send(socket, { type: "pong", timestamp: Date.now() });
      } catch (error) {
        this.send(socket, { type: "result", ok: false, error: normalizeError(error) });
      }
    });
    socket.on("close", () => { this.clients.delete(id); this.pending.delete(id); this.emit("status", this.status()); });
    socket.on("error", () => {});
    if (this.requireApproval) {
      this.pending.set(id, client);
      this.send(socket, { type: "pending", clientId: id, requireApproval: true });
    } else {
      this.clients.set(id, client);
      this.send(socket, { type: "paired", clientId: id, state: this.stateProvider?.() || {} });
    }
    this.emit("status", this.status());
  }
}

module.exports = { MobileBridge };
