"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { catalogForClient } = require("./metric-catalog.cjs");
const {
  applyPreset,
  changeResolution,
  createDefaultConfig,
  exportLayout,
  importLayout,
  layoutForProfile,
  normalizeConfig,
  normalizeProfileName,
  updateProfileLayout
} = require("./layout-engine.cjs");
const {
  TelemetryNormalizer,
  createEmptyTelemetry
} = require("./telemetry.cjs");

const MAX_BODY_BYTES = 1024 * 1024;
const STATIC_FILES = Object.freeze({
  "/overlay.css": ["overlay.css", "text/css; charset=utf-8"],
  "/overlay.js": ["overlay.js", "text/javascript; charset=utf-8"],
  "/editor.css": ["editor.css", "text/css; charset=utf-8"],
  "/editor.js": ["editor.js", "text/javascript; charset=utf-8"]
});

class MonitoringOverlayServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = "127.0.0.1";
    this.preferredPort = integer(options.port, 1, 65535, 17822);
    this.portSearchLimit = integer(options.portSearchLimit, 1, 100, 30);
    this.webRoot = path.resolve(options.webRoot || path.join(__dirname, "..", "web"));
    this.configFile = options.configFile ? path.resolve(options.configFile) : null;
    this.server = null;
    this.sseClients = new Set();
    this.heartbeatTimer = null;
    this.port = null;
    this.config = createDefaultConfig();
    this.telemetryNormalizer = new TelemetryNormalizer({ historySize: options.historySize || 600 });
    this.telemetry = createEmptyTelemetry();
    this.sessionId = crypto.randomBytes(12).toString("hex");
    this.savePromise = Promise.resolve();
  }

  async load() {
    if (!this.configFile) return this.config;
    try {
      const parsed = JSON.parse(await fs.readFile(this.configFile, "utf8"));
      this.config = normalizeConfig(parsed);
    } catch (error) {
      if (error.code !== "ENOENT") this.emit("warning", error);
    }
    return this.config;
  }

  async save() {
    if (!this.configFile) return this.config;
    this.savePromise = this.savePromise.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.configFile), { recursive: true });
      const temporary = `${this.configFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(this.config, null, 2), {
        encoding: "utf8",
        mode: 0o600
      });
      await fs.rename(temporary, this.configFile);
      return this.config;
    });
    return this.savePromise;
  }

  async start() {
    if (this.server) return this.status();
    await this.load();
    let lastError;
    for (let offset = 0; offset < this.portSearchLimit; offset += 1) {
      const port = this.preferredPort + offset;
      if (port > 65535) break;
      try {
        await this.listen(port);
        this.port = port;
        this.heartbeatTimer = setInterval(() => this.sendSseComment("keepalive"), 15000);
        this.heartbeatTimer.unref?.();
        this.emit("started", this.status());
        return this.status();
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    throw lastError || new Error("Kein freier lokaler Port für das Encoder-Overlay gefunden.");
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handleRequest(request, response).catch((error) => {
          this.emit("error", error);
          if (!response.headersSent) this.writeJson(response, 500, { error: "Interner Overlay-Fehler." });
          else response.destroy();
        });
      });
      const onError = (error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        this.server = server;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, this.host);
    });
  }

  async stop() {
    if (!this.server) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const response of this.sseClients) {
      try { response.end(); } catch {}
    }
    this.sseClients.clear();
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise((resolve) => server.close(() => resolve()));
    this.emit("stopped");
  }

  status() {
    const baseUrl = this.port ? `http://${this.host}:${this.port}` : null;
    return {
      running: Boolean(this.server && this.port),
      host: this.host,
      port: this.port,
      sessionId: this.sessionId,
      clientCount: this.sseClients.size,
      overlayUrl: baseUrl ? `${baseUrl}/overlay` : null,
      editorUrl: baseUrl ? `${baseUrl}/editor` : null,
      eventsUrl: baseUrl ? `${baseUrl}/events` : null,
      activeProfile: this.config.activeProfile,
      config: this.config,
      telemetry: this.telemetry
    };
  }

  snapshot(type = "snapshot") {
    return {
      type,
      status: {
        running: Boolean(this.server),
        host: this.host,
        port: this.port,
        overlayUrl: this.port ? `http://${this.host}:${this.port}/overlay` : null,
        editorUrl: this.port ? `http://${this.host}:${this.port}/editor` : null,
        clientCount: this.sseClients.size
      },
      config: this.config,
      telemetry: this.telemetry,
      catalog: catalogForClient()
    };
  }

  updateTelemetry(value) {
    this.telemetry = this.telemetryNormalizer.ingest(value);
    if (this.telemetry.profileName) {
      const profileName = normalizeProfileName(this.telemetry.profileName);
      if (profileName !== this.config.activeProfile) {
        this.config.activeProfile = profileName;
        if (!this.config.layoutsByProfile[profileName]) {
          this.config.layoutsByProfile[profileName] = layoutForProfile(this.config, "Standard");
        }
        void this.save();
      }
    }
    this.broadcast({ type: "telemetry", telemetry: this.telemetry });
    this.emit("telemetry", this.telemetry);
    return this.telemetry;
  }

  updateConfig(value) {
    this.config = normalizeConfig({ ...this.config, ...value });
    void this.save();
    this.broadcast({ type: "config", config: this.config });
    this.emit("config", this.config);
    return this.config;
  }

  broadcast(payload) {
    const block = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of [...this.sseClients]) {
      try {
        response.write(block);
      } catch {
        this.sseClients.delete(response);
      }
    }
  }

  sendSseComment(value) {
    const block = `: ${String(value || "keepalive")}\n\n`;
    for (const response of [...this.sseClients]) {
      try { response.write(block); } catch { this.sseClients.delete(response); }
    }
  }

  openEventStream(request, response) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff"
    });
    response.write(`event: message\ndata: ${JSON.stringify(this.snapshot("snapshot"))}\n\n`);
    this.sseClients.add(response);
    const remove = () => this.sseClients.delete(response);
    request.on("close", remove);
    response.on("close", remove);
  }

  async handleRequest(request, response) {
    if (!isLocalRequest(request)) {
      this.writeJson(response, 403, { error: "Der Overlay-Server ist ausschließlich lokal erreichbar." });
      return;
    }
    const requestUrl = new URL(request.url, `http://${this.host}:${this.port || this.preferredPort}`);
    const pathname = requestUrl.pathname;

    if (request.method === "GET" && pathname === "/") {
      response.writeHead(302, { Location: "/editor", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (request.method === "GET" && pathname === "/events") {
      this.openEventStream(request, response);
      return;
    }
    if (request.method === "GET" && pathname === "/overlay") {
      await this.writeStatic(response, "overlay.html", "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && pathname === "/editor") {
      await this.writeStatic(response, "editor.html", "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && STATIC_FILES[pathname]) {
      const [filename, contentType] = STATIC_FILES[pathname];
      await this.writeStatic(response, filename, contentType);
      return;
    }
    if (request.method === "GET" && pathname === "/api/status") {
      this.writeJson(response, 200, this.snapshot("status"));
      return;
    }
    if (request.method === "GET" && pathname === "/api/catalog") {
      this.writeJson(response, 200, { catalog: catalogForClient() });
      return;
    }
    if (request.method === "GET" && pathname === "/api/config") {
      this.writeJson(response, 200, this.config);
      return;
    }
    if (request.method === "POST" && pathname === "/api/config") {
      const input = await this.readJson(request);
      this.writeJson(response, 200, this.updateConfig(input));
      return;
    }
    if (request.method === "POST" && pathname === "/api/profile/layout") {
      const input = await this.readJson(request);
      this.config = updateProfileLayout(this.config, input.profileName, input.layout);
      await this.save();
      this.broadcast({ type: "config", config: this.config });
      this.writeJson(response, 200, this.config);
      return;
    }
    if (request.method === "POST" && pathname === "/api/resolution") {
      const input = await this.readJson(request);
      this.config = changeResolution(this.config, input.width, input.height);
      await this.save();
      this.broadcast({ type: "config", config: this.config });
      this.writeJson(response, 200, this.config);
      return;
    }
    if (request.method === "POST" && pathname === "/api/layout/preset") {
      const input = await this.readJson(request);
      this.config = applyPreset(this.config, String(input.name || "compact"), input.profileName);
      await this.save();
      this.broadcast({ type: "config", config: this.config });
      this.writeJson(response, 200, this.config);
      return;
    }
    if (request.method === "GET" && pathname === "/api/layout/export") {
      const profile = requestUrl.searchParams.get("profile") || this.config.activeProfile;
      this.writeJson(response, 200, exportLayout(this.config, profile), {
        "Content-Disposition": `attachment; filename="Batto-OBS-Overlay-${safeFilename(profile)}.json"`
      });
      return;
    }
    if (request.method === "POST" && pathname === "/api/layout/import") {
      const input = await this.readJson(request);
      this.config = importLayout(this.config, input);
      await this.save();
      this.broadcast({ type: "config", config: this.config });
      this.writeJson(response, 200, this.config);
      return;
    }
    if (request.method === "POST" && pathname === "/api/telemetry") {
      const input = await this.readJson(request);
      this.writeJson(response, 200, this.updateTelemetry(input));
      return;
    }
this.writeJson(response, 404, { error: "Nicht gefunden." });
  }

  async writeStatic(response, filename, contentType) {
    const resolved = path.resolve(this.webRoot, filename);
    if (!resolved.startsWith(`${this.webRoot}${path.sep}`)) {
      this.writeJson(response, 403, { error: "Ungültiger Dateipfad." });
      return;
    }
    const content = await fs.readFile(resolved);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": contentType.startsWith("text/html")
        ? "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'"
        : "default-src 'none'"
    });
    response.end(content);
  }

  writeJson(response, statusCode, value, extraHeaders = {}) {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    });
    response.end(body);
  }

  readJson(request, options = {}) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("Die Anfrage ist größer als 1 MiB."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text && options.allowEmpty) {
          resolve({});
          return;
        }
        if (!text) {
          reject(new Error("JSON-Inhalt fehlt."));
          return;
        }
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            reject(new Error("Es wird ein JSON-Objekt erwartet."));
            return;
          }
          resolve(parsed);
        } catch {
          reject(new Error("Ungültiges JSON."));
        }
      });
      request.on("error", reject);
    });
  }
}

function isLocalRequest(request) {
  const address = String(request.socket?.remoteAddress || "");
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1"
    || address === "";
}

function integer(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.round(number)))
    : fallback;
}

function safeFilename(value) {
  return normalizeProfileName(value).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "Standard";
}

module.exports = {
  MAX_BODY_BYTES,
  MonitoringOverlayServer,
  isLocalRequest,
  safeFilename
};
