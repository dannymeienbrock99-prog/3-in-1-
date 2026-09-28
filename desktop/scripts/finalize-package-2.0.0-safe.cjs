"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("./finalize-package-2.0.0.cjs");

const file = path.resolve(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(file, "utf8"));
packageJson.scripts = packageJson.scripts || {};
for (const name of ["preinstall", "install", "postinstall", "prepublish", "prepublishOnly", "preprepare", "prepare", "postprepare"]) {
  delete packageJson.scripts[name];
}
fs.writeFileSync(file, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
console.log("Batto OBS Tool 2.0.0: veraltete Projekt-Lifecycle-Hooks vor npm install entfernt.");
