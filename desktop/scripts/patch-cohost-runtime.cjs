"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src", "services", "stream-overlay-server.cjs");
let source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

if (source.includes("BATTO_COHOST_STABLE_ROUTES")) {
  console.log("Co-Host-Runtime bereits gepatcht.");
  process.exit(0);
}

const ctorNeedle = "    this.history = [];\n";
if (!source.includes(ctorNeedle)) throw new Error("Co-Host-Patch: Server-Konstruktor nicht gefunden.");
source = source.replace(ctorNeedle, `${ctorNeedle}    // BATTO_COHOST_STABLE_ROUTES\n    this.cohostFile = path.join(path.dirname(this.configFile), "cohost.json");\n    this.cohost = readJson(this.cohostFile, { slots: 4, sources: [] }) || { slots: 4, sources: [] };\n`);

const statusNeedle = "      chatUrl: this.port ? `http://127.0.0.1:${this.port}/api/chat` : \"\",\n";
if (!source.includes(statusNeedle)) throw new Error("Co-Host-Patch: Statusblock nicht gefunden.");
source = source.replace(statusNeedle, `${statusNeedle}      cohostTikTokUrl: this.port ? \`http://127.0.0.1:\${this.port}/cohost/tiktok\` : \"\",\n      cohostTwitchUrl: this.port ? \`http://127.0.0.1:\${this.port}/cohost/twitch\` : \"\",\n`);

const saveNeedle = "  saveConfig(value) {\n";
if (!source.includes(saveNeedle)) throw new Error("Co-Host-Patch: saveConfig nicht gefunden.");
source = source.replace(saveNeedle, `  normalizeCohost(value = {}) {\n    const slots = Math.max(1, Math.min(8, Number(value.slots) || 4));\n    const sources = Array.from({ length: 8 }, (_, index) => {\n      const raw = String(Array.isArray(value.sources) ? value.sources[index] || \"\" : \"\").trim();\n      return /^https?:\\/\\//i.test(raw) ? raw : \"\";\n    });\n    return { slots, sources, updatedAt: Date.now() };\n  }\n\n  saveCohost(value = {}) {\n    this.cohost = this.normalizeCohost(value);\n    writeJsonAtomic(this.cohostFile, this.cohost);\n    return deepClone(this.cohost);\n  }\n\n  cohostLocation(format) {\n    const cfg = this.normalizeCohost(this.cohost);\n    const params = new URLSearchParams({ slots: String(cfg.slots) });\n    cfg.sources.slice(0, cfg.slots).forEach((url, index) => { if (url) params.set(\`u\${index + 1}\`, url); });\n    return \`/cohost-\${format}.html?\${params.toString()}\`;\n  }\n\n${saveNeedle}`);

const routeNeedle = "      if (request.method === \"GET\" && url.pathname === \"/editor\") return this.serveFile(path.join(this.webRoot, \"editor.html\"), response, cors);\n";
if (!source.includes(routeNeedle)) throw new Error("Co-Host-Patch: Editor-Route nicht gefunden.");
source = source.replace(routeNeedle, `${routeNeedle}      if (request.method === \"GET\" && url.pathname === \"/cohost/tiktok\") { response.writeHead(302, { ...cors, Location: this.cohostLocation(\"tiktok\") }); return response.end(); }\n      if (request.method === \"GET\" && url.pathname === \"/cohost/twitch\") { response.writeHead(302, { ...cors, Location: this.cohostLocation(\"twitch\") }); return response.end(); }\n      if (request.method === \"GET\" && url.pathname === \"/api/cohost\") return sendJson(response, 200, this.normalizeCohost(this.cohost), cors);\n      if (request.method === \"PUT\" && url.pathname === \"/api/cohost\") return sendJson(response, 200, this.saveCohost(await readRequestJson(request, 250000)), cors);\n`);

fs.writeFileSync(file, source, "utf8");
console.log("Co-Host-Runtime gepatcht: /cohost/tiktok und /cohost/twitch + persistente Quellen.");
