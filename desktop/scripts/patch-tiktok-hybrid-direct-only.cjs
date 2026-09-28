"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "services", "platforms", "tiktok-hybrid-adapter.cjs");
let source = fs.readFileSync(file, "utf8");
const marker = `    // Dependency-injected direct connector is primarily used for deterministic\n    // adapter tests and custom runtimes. Production still prefers TikFinity.\n    if (this.preferInjectedDirect && (config.username || config.uniqueId)) {\n      return this.connectDirect(config);\n    }`;
const replacement = `    // Ein ausdrücklich gewählter Direktmodus umgeht TikFinity. Standardmäßig\n    // bleibt TikFinity der erste und Euler-freie Transportweg.\n    if (config.directOnly === true) return this.connectDirect(config);\n\n    // Dependency-injected direct connector is primarily used for deterministic\n    // adapter tests and custom runtimes. Production still prefers TikFinity.\n    if (this.preferInjectedDirect && (config.username || config.uniqueId)) {\n      return this.connectDirect(config);\n    }`;

if (!source.includes(marker)) {
  if (!source.includes("config.directOnly === true")) throw new Error("TikTok-Hybrid-Direktmodus konnte nicht eingebaut werden.");
} else {
  source = source.replace(marker, replacement);
}

if (!source.includes("config.directOnly === true")) throw new Error("TikTok-Direktmodus fehlt nach Patch.");
fs.writeFileSync(file, source, "utf8");
console.log("TikTok-Hybrid: TikFinity bleibt Standard; expliziter Direktmodus ist getrennt.");
