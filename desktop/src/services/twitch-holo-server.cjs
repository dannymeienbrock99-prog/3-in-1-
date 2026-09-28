"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
});

class TwitchHoloServer {
  constructor({ webRoot, preferredPort = 17823 } = {}) {
    this.host = "127.0.0.1";
    this.webRoot = path.resolve(webRoot);
    this.preferredPort = Math.max(1, Math.min(65535, Math.round(Number(preferredPort) || 17823)));
    this.port = null;
    this.server = null;
  }

  async start() {
    if (this.server) return this.status();
    let lastError;
    for (let offset = 0; offset < 30; offset += 1) {
      const port = this.preferredPort + offset;
      try {
        await this.listen(port);
        this.port = port;
        return this.status();
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    throw lastError || new Error("Kein freier Port für das Twitch-Hologramm gefunden.");
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handle(request, response).catch(() => {
          if (!response.headersSent) {
            response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          }
          response.end("Interner Hologramm-Overlay-Fehler.");
        });
      });
      server.once("error", reject);
      server.once("listening", () => {
        server.removeListener("error", reject);
        this.server = server;
        resolve();
      });
      server.listen(port, this.host);
    });
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise((resolve) => server.close(resolve));
  }

  status() {
    const base = this.port ? `http://${this.host}:${this.port}` : null;
    return {
      running: Boolean(this.server && this.port),
      host: this.host,
      port: this.port,
      editorUrl: base ? `${base}/editor` : null,
      overlayUrl: base ? `${base}/overlay` : null
    };
  }

  async handle(request, response) {
    const remote = String(request.socket?.remoteAddress || "");
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1", ""].includes(remote)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Nur lokal erreichbar.");
      return;
    }
    const url = new URL(request.url, `http://${this.host}:${this.port || this.preferredPort}`);
    if (url.pathname === "/health") {
      const body = Buffer.from(JSON.stringify(this.status()), "utf8");
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
      response.end(body);
      return;
    }
    let filename;
    if (url.pathname === "/" || url.pathname === "/editor") filename = "editor.html";
    else if (url.pathname === "/overlay") filename = "overlay.html";
    else filename = url.pathname.replace(/^\/+/, "");
    const resolved = path.resolve(this.webRoot, filename);
    if (!resolved.startsWith(`${this.webRoot}${path.sep}`)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Ungültiger Pfad.");
      return;
    }
    try {
      const content = await fs.readFile(resolved);
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream",
        "Content-Length": content.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy": path.extname(resolved).toLowerCase() === ".html"
          ? "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data:; object-src 'none'; base-uri 'none'"
          : "default-src 'none'"
      });
      response.end(content);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Nicht gefunden." : "Datei konnte nicht geladen werden.");
    }
  }
}

module.exports = {
  TwitchHoloServer
};
