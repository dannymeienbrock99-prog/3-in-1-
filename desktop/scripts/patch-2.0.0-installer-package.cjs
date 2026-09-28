"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageFile = path.join(root, "package.json");
const icon = path.join(root, "build", "icon.png");
const license = path.join(root, "resources", "LICENSE-DE.txt");
const include = path.join(root, "build", "installer.nsh");
for (const required of [icon, license, include]) {
  if (!fs.existsSync(required) || fs.statSync(required).size === 0) throw new Error(`Installer-Ressource fehlt: ${required}`);
}
const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
packageJson.build = packageJson.build || {};
packageJson.build.win = { ...(packageJson.build.win || {}), icon: "build/icon.png", target: [{ target: "nsis", arch: ["x64"] }] };
packageJson.build.nsis = {
  ...(packageJson.build.nsis || {}),
  include: "build/installer.nsh",
  license: "resources/LICENSE-DE.txt",
  oneClick: false,
  perMachine: true,
  allowElevation: true,
  allowToChangeInstallationDirectory: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  runAfterFinish: false,
  deleteAppDataOnUninstall: false
};
fs.writeFileSync(packageFile, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
console.log("Batto OBS Tool 2.0.0: finale Installer-Ressourcen nach der Quellmontage bestätigt.");
