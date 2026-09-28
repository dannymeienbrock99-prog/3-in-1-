"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

app.whenReady().then(() => {
  const root = path.resolve(__dirname, "..");
  const source = path.join(root, "bootstrap-2.0", "brand", "team-logo.svg");
  const destination = path.join(root, "build", "icon.png");
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error("Team-Alpha-SVG konnte nicht gerendert werden");
  const resized = image.resize({ width: 256, height: 256, quality: "best" });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, resized.toPNG());
  console.log(`Windows-App-Icon erstellt: ${destination}`);
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
