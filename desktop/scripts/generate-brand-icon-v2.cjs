"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const source = path.join(root, "bootstrap-2.0", "brand", "team-logo.svg");
  const destination = path.join(root, "build", "icon.png");
  if (!fs.existsSync(source)) throw new Error("Team-Alpha-SVG fehlt");

  const window = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: { offscreen: true, sandbox: true }
  });
  await window.loadFile(source);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  if (image.isEmpty()) throw new Error("Chromium konnte das Team-Alpha-Logo nicht rendern");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, image.toPNG());
  window.destroy();
  console.log(`Windows-App-Icon erstellt: ${destination}`);
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
