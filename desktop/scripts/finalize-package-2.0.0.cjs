"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("./bootstrap-package-2.0.0.cjs");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(file, "utf8"));
packageJson.build = packageJson.build || {};
packageJson.build.nsis = {
  ...(packageJson.build.nsis || {}),
  include: "build/installer-2.0.nsh",
  license: "resources/LICENSE-DE.txt",
  runAfterFinish: false,
  allowToChangeInstallationDirectory: true
};
fs.writeFileSync(file, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
console.log("Batto OBS Tool 2.0.0: Lizenzseite und Firewall-Integration aktiviert.");
