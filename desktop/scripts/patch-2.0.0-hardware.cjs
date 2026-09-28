"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceService = path.join(root, "bootstrap-2.0", "src", "services", "hardware-enrichment-v2.cjs");
const destinationService = path.join(root, "src", "services", "hardware-enrichment-v2.cjs");
if (!fs.existsSync(sourceService)) throw new Error("Hardware-Enrichment-Quelle fehlt");
fs.copyFileSync(sourceService, destinationService);

const mainPath = path.join(root, "src", "main.cjs");
let main = fs.readFileSync(mainPath, "utf8");
const importAnchor = 'const { LegacyMigration } = require("./services/migration-v2.cjs");';
if (!main.includes(importAnchor)) throw new Error("Hardware-Import-Patchpunkt fehlt");
main = main.replace(importAnchor, `${importAnchor}\nconst { enrichHardware } = require("./services/hardware-enrichment-v2.cjs");`);
const scanAnchor = '    hardware = await hardwareApi.collectHardware();';
if (!main.includes(scanAnchor)) throw new Error("Hardware-Scan-Patchpunkt fehlt");
main = main.replace(scanAnchor, '    hardware = await enrichHardware(await hardwareApi.collectHardware());');
fs.writeFileSync(mainPath, main, "utf8");

console.log("Batto OBS Tool 2.0.0: echte NVIDIA-VRAM- und GPU-Werte in die Diagnose integriert.");
