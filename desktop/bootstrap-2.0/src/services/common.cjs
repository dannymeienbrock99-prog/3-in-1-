"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function safeText(value, maximum = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function randomId(prefix = "id") {
  return `${prefix}-${crypto.randomBytes(12).toString("hex")}`;
}

function randomPin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isLoopback(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1" || value === "[::1]";
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".cjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  }[extension] || "application/octet-stream";
}

function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function sendText(response, status, value, type = "text/plain; charset=utf-8", headers = {}) {
  const body = Buffer.from(String(value));
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

async function readRequestJson(request, limit = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error("Anfrage ist zu groß."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function normalizePathInside(root, requestPath) {
  const requested = decodeURIComponent(String(requestPath || "/").split("?")[0]);
  const relative = requested.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative || "index.html");
  const normalizedRoot = path.resolve(root) + path.sep;
  return resolved.startsWith(normalizedRoot) ? resolved : null;
}

module.exports = {
  clampNumber,
  contentType,
  deepClone,
  ensureDirectory,
  isLoopback,
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
};
