"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "resources", "touchdeck-0802");
const COMMIT = "51be33d29c07f50323b19d58782804af391b8394";

fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(path.join(OUTPUT, "SOURCE-COMMIT.txt"), `${COMMIT}\r\n`, "utf8");
fs.writeFileSync(path.join(OUTPUT, "README.txt"), [
  "CreatorHub TouchDeck vom 02.08.2026",
  `Original-Quellstand: ${COMMIT}`,
  "",
  "Das TouchDeck wird aus dem privaten Original-Repository separat gebaut und im Batto-Suite-Paket installiert.",
  "Batto OBS Tool sucht CreatorHub.TouchDeck.exe automatisch unter Program Files und bekannten Installationspfaden.",
  "Der private Quellcode wird nicht in das öffentliche Batto-Repository kopiert."
].join("\r\n") + "\r\n", "utf8");

console.log(`TouchDeck-Verknüpfung vorbereitet: exakter Original-Commit ${COMMIT}; Binärdatei wird als Suite-Komponente installiert.`);
