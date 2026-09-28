"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function patch(relative, replacements) {
  const file = path.join(root, relative);
  let content = fs.readFileSync(file, "utf8");
  for (const [search, replacement] of replacements) {
    if (!content.includes(search)) throw new Error(`Hologramm-Patchpunkt fehlt in ${relative}: ${search}`);
    content = content.replace(search, replacement);
  }
  fs.writeFileSync(file, content, "utf8");
}

patch("src/services/holo-server-v2.cjs", [
  [
    'const { normalizeError, sendJson, serveStatic } = require("./runtime-utils-v2.cjs");',
    'const { atomicWrite, normalizeError, readJson, readJsonBody, sendJson, serveStatic } = require("./runtime-utils-v2.cjs");'
  ],
  [
    '  constructor({ webRoot, port = 17821 } = {}) {\n    this.webRoot = webRoot;',
    '  constructor({ webRoot, configFile, port = 17821 } = {}) {\n    this.webRoot = webRoot;\n    this.configFile = configFile;\n    this.config = readJson(configFile, {});'
  ],
  [
    '          this.sources += 1;\n          ws.on("close", () => { this.sources = Math.max(0, this.sources - 1); });',
    '          this.sources += 1;\n          ws.send(JSON.stringify({ type: "config", config: this.config }));\n          ws.on("close", () => { this.sources = Math.max(0, this.sources - 1); });'
  ],
  [
    '              if (["config", "set-user-style", "remove-user-style", "set-role-style"].includes(message.type)) this.broadcast(message, ws);',
    '              if (message.type === "config") this.setConfig(message.config || message, ws);\n              else if (["set-user-style", "remove-user-style", "set-role-style"].includes(message.type)) this.broadcast(message, ws);'
  ],
  [
    '      editorUrl: `http://127.0.0.1:${this.port}/editor.html`, error: this.error',
    '      editorUrl: `http://127.0.0.1:${this.port}/editor.html`, error: this.error, config: this.config'
  ],
  [
    '  message(payload = {}) {',
    '  setConfig(value = {}, except = null) {\n    this.config = value && typeof value === "object" && !Array.isArray(value) ? value : {};\n    if (this.configFile) atomicWrite(this.configFile, this.config);\n    this.broadcast({ type: "config", config: this.config }, except);\n    return this.config;\n  }\n\n  message(payload = {}) {'
  ],
  [
    '  handle(request, response) {\n    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);\n    if (url.pathname === "/api/status") { sendJson(response, 200, this.status()); return; }',
    '  async handle(request, response) {\n    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);\n    if (url.pathname === "/api/status") { sendJson(response, 200, this.status()); return; }\n    if (url.pathname === "/api/config" && request.method === "GET") { sendJson(response, 200, this.config); return; }\n    if (url.pathname === "/api/config" && request.method === "PUT") {\n      try { sendJson(response, 200, { ok: true, config: this.setConfig(await readJsonBody(request)) }); }\n      catch (error) { sendJson(response, 400, { ok: false, error: normalizeError(error) }); }\n      return;\n    }'
  ]
]);

patch("src/main.cjs", [
  [
    '  holo = new HoloServer({ webRoot: appRoot("modules", "twitch-holo-chat", "web"), port: 17821 });',
    '  holo = new HoloServer({ webRoot: appRoot("modules", "twitch-holo-chat", "web"), configFile: userData("twitch-hologram.json"), port: 17821 });'
  ]
]);

patch("modules/twitch-holo-chat/web/editor.js", [
  [
    '  function saveConfig() {\n    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));\n    applyConfigToPreview();\n  }',
    '  function saveConfig() {\n    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));\n    applyConfigToPreview();\n    void fetch("/api/config", {\n      method: "PUT",\n      headers: { "Content-Type": "application/json" },\n      body: JSON.stringify(config)\n    }).catch(() => setStatus("Hologramm-Stil lokal gespeichert; OBS-Synchronisierung fehlgeschlagen.", true));\n  }'
  ],
  [
    '  setStatus("Bereit. Keine Discord-Verbindung und kein Server-Boost erforderlich.");\n})();',
    '  setStatus("Bereit. Keine Discord-Verbindung und kein Server-Boost erforderlich.");\n  fetch("/api/config", { cache: "no-store" })\n    .then((response) => response.ok ? response.json() : null)\n    .then((serverConfig) => {\n      if (!serverConfig || typeof serverConfig !== "object" || !Object.keys(serverConfig).length) return;\n      config = {\n        ...config,\n        ...serverConfig,\n        defaultStyle: { ...config.defaultStyle, ...(serverConfig.defaultStyle || {}) },\n        roleStyles: { ...config.roleStyles, ...(serverConfig.roleStyles || {}) },\n        userStyles: { ...config.userStyles, ...(serverConfig.userStyles || {}) }\n      };\n      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));\n      loadGlobalInputs();\n      updateTargetUi();\n      applyConfigToPreview();\n      setStatus("Gespeicherter OBS-Hologramm-Stil geladen.");\n    })\n    .catch(() => {});\n})();'
  ]
]);

console.log("Batto OBS Tool 2.0.0: Hologramm-Editor und OBS-Ausgabe dauerhaft synchronisiert.");
