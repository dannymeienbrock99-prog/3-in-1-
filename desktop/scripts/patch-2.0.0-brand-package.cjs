"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const icon = path.join(root, "build", "icon.png");
if (!fs.existsSync(icon) || fs.statSync(icon).size < 1000) throw new Error("Generiertes Team-Alpha-App-Icon fehlt oder ist leer");
const file = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(file, "utf8"));
packageJson.build = packageJson.build || {};
packageJson.build.win = { ...(packageJson.build.win || {}), icon: "build/icon.png" };
fs.writeFileSync(file, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
console.log("Batto OBS Tool 2.0.0: Team-Alpha-Icon für EXE und Verknüpfungen gesetzt.");
