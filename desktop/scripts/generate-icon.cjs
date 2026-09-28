"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "build", "icon.ico");
const outputs = [
  path.join(root, "build", "icon.png"),
  path.join(root, "resources", "team-logo.png"),
  path.join(root, "src", "renderer", "assets", "team-alpha-logo.png"),
  path.join(root, "src", "stream-overlay", "team-logo.png"),
  path.join(root, "src", "mobile", "team-logo.png")
];

function fail(message) {
  console.error(message);
  app.exit(1);
}

app.whenReady().then(() => {
  try {
    if (!fs.existsSync(source)) return fail(`Team-Alpha-Quellicon fehlt: ${source}`);
    const image = nativeImage.createFromPath(source);
    if (image.isEmpty()) return fail("Team-Alpha-Quellicon konnte nicht gelesen werden.");
    const resized = image.resize({ width: 256, height: 256, quality: "best" });
    const png = resized.toPNG();
    if (!png || png.length < 10_000) return fail(`Erzeugtes 256px-Logo ist ungültig oder zu klein: ${png?.length || 0} Bytes`);
    for (const output of outputs) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, png);
    }
    console.log(`Team-Alpha-Logo erzeugt: 256 × 256, ${png.length} Bytes, ${outputs.length} Ziele.`);
    app.exit(0);
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  }
});
