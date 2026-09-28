"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const QRCode = require("qrcode");
const { WebSocketServer, WebSocket } = require("ws");
const {
  contentType,
  normalizePathInside,
  randomId,
  randomPin,
  readJson,
  readRequestJson,
  safeText,
  sendJson,
  sendText,
  sha256,
  writeJsonAtomic
} = require("./common.cjs");

function localAddresses() {
  const result = [];
  for (const [interfaceName, values] of Object.entries(os.networkInterfaces())) {
    for (const value of values || []) {
      if (value.internal || value.family !== "IPv4") continue;
      const address = value.address;
      const lower = interfaceName.toLowerCase();
      const type = /wi-?fi|wlan|wireless/.test(lower)
        ? "WLAN"
        : /ethernet|lan/.test(lower)
          ? "LAN"
          : /usb|rndis|tether/.test(lower)
            ? "USB-Tethering"
            : /bluetooth|pan/.test(lower)
              ? "Bluetooth-PAN"
              : "Netzwerk";
      result.push({ interfaceName, address, type });
    }
  }
  return result.sort((left, right) => {
    const priority = { LAN: 0, WLAN: 1, "USB-Tethering": 2, "Bluetooth-PAN": 3, Netzwerk: 4 };
    return (priority[left.type] ?? 9) - (priority[right.type] ?? 9) || left.address.localeCompare(right.address);
  });
}

function parseAuthorization(request) {
  const header = String(request.headers.authorization || "");
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  try { return new URL(request.url, "http://localhost").searchParams.get("token") || ""; } catch { return ""; }
}

class MobileBridge extends EventEmitter {
  constructor({
    webRoot,
    stateFile,
    preferredPort = 48620,
    requireApproval = true,
    stateProvider = () => ({}),
    actionHandler = async () => ({ ok: false, error: "Keine Aktion verbunden." })
  } = {}) {
    super();
    this.webRoot = webRoot;
    this.stateFile = stateFile;
    this.preferredPort = preferredPort;
    this.requireApproval = Boolean(requireApproval);
    this.stateProvider = stateProvider;
    this.actionHandler = actionHandler;
    this.server = null;
    this.webSocketServer = null;
    this.port = 0;
    this.pin = randomPin();
    this.sessionId = randomId("mobile-session");
    this.pending = new Map();
    this.clients = new Map();
    this.saved = readJson(stateFile, { paired: [] }) || { paired: [] };
    this.qr = { batto: "", legacy: "", web: "" };
  }

  async start() {
    if (this.server) return this.status();
    this.server = http.createServer((request, response) => void this.handleRequest(request, response));
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
    this.webSocketServer.on("connection", (socket, request) => this.handleSocket(socket, request));
    this.server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname !== "/ws") return socket.destroy();
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => this.webSocketServer.emit("connection", client, request));
    });
    this.server.on("error", (error) => this.emit("error-state", error));
    await this.listenWithFallback();
    await this.refreshQr();
    this.emit("started", this.status());
    return this.status();
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, "0.0.0.0");
    });
  }

  async listenWithFallback() {
    let lastError = null;
    for (let port = this.preferredPort; port < this.preferredPort + 20; port += 1) {
      try {
        await this.listen(port);
        this.port = port;
        return;
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    throw lastError || new Error("Kein freier Port für die Handy-Verbindung gefunden.");
  }

  primaryAddress() {
    return localAddresses()[0]?.address || "127.0.0.1";
  }

  async refreshQr() {
    const host = this.primaryAddress();
    const web = `http://${host}:${this.port}/mobile/?host=${encodeURIComponent(host)}&port=${this.port}&pin=${this.pin}`;
    const batto = `battoobstool://pair?host=${encodeURIComponent(host)}&port=${this.port}&pin=${this.pin}`;
    const legacy = `creatorhub://pair?host=${encodeURIComponent(host)}&port=${this.port}&pin=${this.pin}`;
    const options = { errorCorrectionLevel: "M", margin: 1, width: 360 };
    this.qr = {
      web,
      batto,
      legacy,
      webDataUrl: await QRCode.toDataURL(web, options),
      battoDataUrl: await QRCode.toDataURL(batto, options),
      legacyDataUrl: await QRCode.toDataURL(legacy, options)
    };
  }

  status() {
    return {
      active: Boolean(this.server?.listening),
      port: this.port,
      pin: this.pin,
      requireApproval: this.requireApproval,
      sessionId: this.sessionId,
      addresses: localAddresses(),
      primaryAddress: this.primaryAddress(),
      connectedClients: [...this.clients.values()].map((client) => ({
        clientId: client.clientId,
        name: client.name,
        address: client.address,
        connectedAt: client.connectedAt,
        legacy: client.legacy
      })),
      pendingClients: [...this.pending.values()].map((client) => ({
        requestId: client.requestId,
        clientId: client.clientId,
        name: client.name,
        address: client.address,
        requestedAt: client.requestedAt,
        legacy: client.legacy
      })),
      qr: this.qr
    };
  }

  regeneratePin() {
    this.pin = randomPin();
    this.sessionId = randomId("mobile-session");
    this.pending.clear();
    return this.refreshQr().then(() => {
      this.broadcast({ type: "pairing-updated" });
      this.emit("changed", this.status());
      return this.status();
    });
  }

  setApprovalRequired(value) {
    this.requireApproval = Boolean(value);
    this.emit("changed", this.status());
    return this.status();
  }

  isSavedToken(clientId, token) {
    const hash = sha256(String(token || ""));
    return (this.saved.paired || []).some((entry) => entry.clientId === clientId && entry.tokenHash === hash);
  }

  saveClient(clientId, name, token) {
    const entry = { clientId, name, tokenHash: sha256(token), pairedAt: Date.now() };
    this.saved.paired = (this.saved.paired || []).filter((item) => item.clientId !== clientId);
    this.saved.paired.push(entry);
    this.saved.paired = this.saved.paired.slice(-30);
    writeJsonAtomic(this.stateFile, this.saved);
  }

  handleSocket(socket, request) {
    const address = request.socket.remoteAddress || "";
    const context = { socket, address, authenticated: false, clientId: "", name: "", token: "", legacy: false };
    socket.on("message", (data) => void this.handleSocketMessage(context, data));
    socket.on("close", () => {
      if (context.clientId) this.clients.delete(context.clientId);
      this.emit("changed", this.status());
    });
    socket.on("error", () => {});
    this.send(socket, { type: "hello", app: "Batto OBS Tool", protocolVersion: 2, approvalRequired: this.requireApproval });
  }

  send(socket, value) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
  }

  async handleSocketMessage(context, data) {
    let message;
    try { message = JSON.parse(String(data)); } catch { return this.send(context.socket, { type: "error", error: "Ungültige JSON-Nachricht." }); }
    const type = String(message.type || message.action || "").toLowerCase();
    if (["pair", "auth", "hello"].includes(type)) return this.handlePair(context, message);
    if (!context.authenticated) return this.send(context.socket, { type: "error", error: "Handy ist nicht gekoppelt." });
    if (["state", "get-state", "sync"].includes(type)) return this.sendState(context.socket);
    if (["execute", "deck-action", "action"].includes(type)) {
      try {
        const result = await this.actionHandler(message.payload || message.actionData || message);
        this.send(context.socket, { type: "action-result", requestId: message.requestId || "", result });
      } catch (error) {
        this.send(context.socket, { type: "action-result", requestId: message.requestId || "", result: { ok: false, error: String(error?.message || error) } });
      }
      return;
    }
    if (type === "ping") this.send(context.socket, { type: "pong", timestamp: Date.now() });
  }

  handlePair(context, message) {
    const clientId = safeText(message.clientId || message.deviceId || randomId("phone"), 120);
    const name = safeText(message.name || message.deviceName || "Handy", 120);
    const token = safeText(message.token || "", 500);
    const pin = safeText(message.pin || message.code || "", 20);
    const legacy = Boolean(message.legacy || message.protocol === "creatorhub" || message.scheme === "creatorhub");
    if (token && this.isSavedToken(clientId, token)) return this.approveContext(context, { clientId, name, token, legacy });
    if (pin !== this.pin) return this.send(context.socket, { type: "pair-denied", error: "Die sechsstellige PIN ist falsch oder abgelaufen." });
    const requestId = randomId("pair");
    const pending = { requestId, clientId, name, address: context.address, requestedAt: Date.now(), legacy, context };
    if (!this.requireApproval || legacy) return this.approvePending(pending);
    this.pending.set(requestId, pending);
    this.send(context.socket, { type: "pair-pending", requestId, message: "Kopplung am PC bestätigen." });
    this.emit("pair-request", { requestId, clientId, name, address: context.address, requestedAt: pending.requestedAt, legacy });
    this.emit("changed", this.status());
  }

  approveContext(context, { clientId, name, token, legacy }) {
    context.authenticated = true;
    context.clientId = clientId;
    context.name = name;
    context.token = token;
    context.legacy = legacy;
    context.connectedAt = Date.now();
    this.clients.set(clientId, context);
    this.send(context.socket, { type: "pair-approved", token, clientId, state: this.stateProvider() });
    this.emit("changed", this.status());
  }

  approvePending(pending) {
    const token = randomId("mobile-token");
    this.saveClient(pending.clientId, pending.name, token);
    this.pending.delete(pending.requestId);
    this.approveContext(pending.context, { clientId: pending.clientId, name: pending.name, token, legacy: pending.legacy });
    return this.status();
  }

  approve(requestId) {
    const pending = this.pending.get(requestId);
    if (!pending) throw new Error("Kopplungsanfrage wurde nicht gefunden.");
    return this.approvePending(pending);
  }

  reject(requestId) {
    const pending = this.pending.get(requestId);
    if (!pending) return this.status();
    this.pending.delete(requestId);
    this.send(pending.context.socket, { type: "pair-denied", error: "Kopplung wurde am PC abgelehnt." });
    try { pending.context.socket.close(1008, "Pairing rejected"); } catch {}
    this.emit("changed", this.status());
    return this.status();
  }

  revoke(clientId) {
    const context = this.clients.get(clientId);
    if (context) {
      this.send(context.socket, { type: "revoked" });
      try { context.socket.close(1008, "Pairing revoked"); } catch {}
      this.clients.delete(clientId);
    }
    this.saved.paired = (this.saved.paired || []).filter((entry) => entry.clientId !== clientId);
    writeJsonAtomic(this.stateFile, this.saved);
    this.emit("changed", this.status());
    return this.status();
  }

  sendState(socket) {
    this.send(socket, { type: "state", state: this.stateProvider(), timestamp: Date.now() });
  }

  broadcast(value) {
    for (const context of this.clients.values()) this.send(context.socket, value);
  }

  broadcastState() {
    this.broadcast({ type: "state", state: this.stateProvider(), timestamp: Date.now() });
  }

  async handleRequest(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(302, { Location: "/mobile/" });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        const status = this.status();
        delete status.pin;
        delete status.qr;
        return sendJson(response, 200, status, { "Access-Control-Allow-Origin": "*" });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        const token = parseAuthorization(request);
        const entry = (this.saved.paired || []).find((item) => item.tokenHash === sha256(token));
        if (!entry) return sendJson(response, 401, { ok: false, error: "Nicht gekoppelt." });
        return sendJson(response, 200, { ok: true, state: this.stateProvider() });
      }
      if (request.method === "POST" && url.pathname === "/api/action") {
        const token = parseAuthorization(request);
        const entry = (this.saved.paired || []).find((item) => item.tokenHash === sha256(token));
        if (!entry) return sendJson(response, 401, { ok: false, error: "Nicht gekoppelt." });
        const body = await readRequestJson(request);
        const result = await this.actionHandler(body);
        return sendJson(response, 200, { ok: true, result });
      }
      if (request.method === "GET" && (url.pathname === "/mobile" || url.pathname === "/mobile/")) {
        return this.serveFile(path.join(this.webRoot, "index.html"), response);
      }
      if (request.method === "GET" && url.pathname.startsWith("/mobile/")) {
        const relative = url.pathname.slice("/mobile/".length);
        const file = normalizePathInside(this.webRoot, relative || "index.html");
        if (!file) return sendText(response, 403, "Nicht erlaubt.");
        return this.serveFile(file, response);
      }
      return sendJson(response, 404, { ok: false, error: "Nicht gefunden." });
    } catch (error) {
      return sendJson(response, error.statusCode || 500, { ok: false, error: String(error?.message || error) });
    }
  }

  serveFile(file, response) {
    try {
      const data = fs.readFileSync(file);
      response.writeHead(200, { "Content-Type": contentType(file), "Content-Length": data.length, "Cache-Control": "no-store" });
      response.end(data);
    } catch {
      sendText(response, 404, "Datei nicht gefunden.");
    }
  }

  async stop() {
    for (const context of this.clients.values()) {
      try { context.socket.close(1001, "Batto OBS Tool beendet"); } catch {}
    }
    this.clients.clear();
    this.pending.clear();
    try { this.webSocketServer?.close(); } catch {}
    await new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
    this.webSocketServer = null;
    this.server = null;
    this.port = 0;
  }
}

module.exports = { MobileBridge, localAddresses };
