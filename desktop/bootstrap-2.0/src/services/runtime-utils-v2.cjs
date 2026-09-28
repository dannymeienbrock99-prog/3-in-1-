"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function atomicWrite(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function safeId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function randomPin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function normalizeError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "Unbekannter Fehler"),
    code: String(error?.code || "")
  };
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
    if (!signal) return;
    const abort = () => { clearTimeout(timer); reject(new Error("Vorgang abgebrochen")); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function localAddresses(port) {
  const rows = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      rows.push({ interface: name, address: entry.address, url: `http://${entry.address}:${port}/` });
    }
  }
  return rows.sort((a, b) => a.interface.localeCompare(b.interface));
}

function isPrivateAddress(address) {
  const value = String(address || "").replace(/^::ffff:/, "");
  return value === "127.0.0.1" || value === "::1" || /^10\./.test(value) || /^192\.168\./.test(value) || /^172\.(1[6-9]|2\d|3[01])\./.test(value) || /^169\.254\./.test(value);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
  })[extension] || "application/octet-stream";
}

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function readBody(request, maximumBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(new Error("Anfrage zu groß"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request, maximumBytes) {
  const body = await readBody(request, maximumBytes);
  if (!body.length) return {};
  const parsed = JSON.parse(body.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON-Objekt erforderlich");
  return parsed;
}

function serveStatic(response, root, requestPath, fallback = "index.html") {
  const cleanPath = decodeURIComponent(String(requestPath || "/").split("?")[0]);
  const relative = cleanPath === "/" ? fallback : cleanPath.replace(/^\/+/, "");
  const absolute = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  if (!absolute.startsWith(`${rootResolved}${path.sep}`) && absolute !== rootResolved) {
    response.writeHead(403); response.end("Forbidden"); return true;
  }
  let target = absolute;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, fallback);
    const body = fs.readFileSync(target);
    response.writeHead(200, {
      "Content-Type": contentType(target),
      "Content-Length": body.length,
      "Cache-Control": /\.(?:html|json)$/i.test(target) ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Nicht gefunden");
  }
  return true;
}

module.exports = {
  atomicWrite,
  clone,
  contentType,
  delay,
  ensureDir,
  isPrivateAddress,
  localAddresses,
  normalizeError,
  randomPin,
  readBody,
  readJson,
  readJsonBody,
  safeId,
  sendJson,
  serveStatic
};
