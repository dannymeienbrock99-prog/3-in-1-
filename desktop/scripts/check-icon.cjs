"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceIconPath = path.join(root, "build", "icon.ico");
const generatorPath = path.join(root, "scripts", "generate-icon.cjs");
const packagePath = path.join(root, "package.json");

if (!fs.existsSync(sourceIconPath)) throw new Error("Team-Alpha-Quellicon fehlt: build/icon.ico");
const icon = fs.readFileSync(sourceIconPath);
if (icon.length < 10_000) throw new Error(`Team-Alpha-Quellicon ist unerwartet klein: ${icon.length} Bytes`);
if (icon[0] !== 0x00 || icon[1] !== 0x00 || icon[2] !== 0x01 || icon[3] !== 0x00) {
  throw new Error("build/icon.ico besitzt keinen gültigen ICO-Header.");
}
const imageCount = icon.readUInt16LE(4);
if (imageCount < 1) throw new Error("build/icon.ico enthält kein Bild.");
if (!fs.existsSync(generatorPath)) throw new Error("Generator für das 256px-Team-Alpha-Logo fehlt.");
const generator = fs.readFileSync(generatorPath, "utf8");
if (!generator.includes("width: 256") || !generator.includes("height: 256")) {
  throw new Error("Der Logo-Generator erzeugt kein 256 × 256 Pixel großes Windows-Icon.");
}
for (const output of ["build/icon.png", "resources/team-logo.png", "src/renderer/assets/team-alpha-logo.png", "src/stream-overlay/team-logo.png"]) {
  if (!generator.includes(output.split("/").at(-1))) throw new Error(`Logo-Generator berücksichtigt ${output} nicht.`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (packageJson.build?.win?.icon !== "build/icon.png") throw new Error("Das Windows-Programm verwendet nicht das erzeugte 256px-Logo build/icon.png.");
if (packageJson.build?.nsis?.installerIcon || packageJson.build?.nsis?.uninstallerIcon) {
  throw new Error("NSIS darf kein zu kleines separates Icon überschreiben, sondern muss das 256px-App-Logo erben.");
}
if (!String(packageJson.scripts?.["predist:win"] || "").includes("generate-icon.cjs")) {
  throw new Error("Das 256px-Logo wird vor dem Windows-Build nicht erzeugt.");
}

console.log(`Team-Alpha-Branding geprüft: Quellicon ${icon.length} Bytes, 256px-App-Logo wird vor dem Build erzeugt und von NSIS übernommen.`);
