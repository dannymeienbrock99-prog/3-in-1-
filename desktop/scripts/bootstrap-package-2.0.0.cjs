"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(file, "utf8"));

packageJson.name = "batto-obs-tool";
packageJson.version = "2.0.0";
packageJson.productName = "Batto OBS Tool";
packageJson.description = "Lokales Windows-Tool für OBS, Hardwarediagnose, Encoder-Empfehlung, Overlays, Multi-Chat, Touch-Deck, Plugins und Handy-Steuerung.";
packageJson.main = "src/main.cjs";
packageJson.author = packageJson.author || "Crazy_Batto / Team Alpha";
packageJson.license = packageJson.license || "UNLICENSED";
packageJson.private = true;
packageJson.dependencies = {
  ...(packageJson.dependencies || {}),
  qrcode: packageJson.dependencies?.qrcode || "^1.5.4",
  ws: packageJson.dependencies?.ws || "^8.18.3"
};
packageJson.devDependencies = {
  ...(packageJson.devDependencies || {}),
  electron: packageJson.devDependencies?.electron || "^39.2.7",
  "electron-builder": packageJson.devDependencies?.["electron-builder"] || "^26.0.12"
};
packageJson.scripts = {
  ...(packageJson.scripts || {}),
  start: "electron .",
  "prepare:release": "node scripts/prepare-2.0.0-release.cjs && node scripts/patch-2.0.0-runtime.cjs && node scripts/patch-2.0.0-deck-safety.cjs",
  "check:release": "node scripts/check-2.0.0.cjs",
  "test:release": "node --test test/*.test.cjs",
  "dist:release": "electron-builder --win nsis --x64"
};
packageJson.build = {
  ...(packageJson.build || {}),
  appId: "de.crazybatto.battoobstool",
  productName: "Batto OBS Tool",
  artifactName: "Batto-OBS-Tool-Setup-${version}.${ext}",
  asar: true,
  files: ["src/**/*", "modules/**/*", "resources/**/*", "package.json"],
  extraMetadata: { ...(packageJson.build?.extraMetadata || {}), main: "src/main.cjs" },
  extraResources: [
    { from: "resources/team-logo.svg", to: "team-logo.svg" },
    { from: "resources/plugin-catalog-2.0.json", to: "plugin-catalog-2.0.json" }
  ],
  win: {
    ...(packageJson.build?.win || {}),
    target: [{ target: "nsis", arch: ["x64"] }],
    requestedExecutionLevel: "asInvoker"
  },
  nsis: {
    ...(packageJson.build?.nsis || {}),
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    include: "build/installer.nsh"
  }
};

fs.writeFileSync(file, JSON.stringify(packageJson, null, 2) + "\n", "utf8");
console.log("Batto OBS Tool 2.0.0: package.json und Installer-Metadaten normalisiert.");
