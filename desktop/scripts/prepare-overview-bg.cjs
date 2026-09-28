"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src", "renderer", "assets");
const parts = ["bg-part-01.txt", "bg-part-02.txt", "bg-part-03.txt", "bg-part-04.txt"];
const output = path.join(root, "bg.jpg");

const base64 = parts.map((name) => {
  const filename = path.join(root, name);
  if (!fs.existsSync(filename)) throw new Error(`Übersichtsbild fehlt: ${name}`);
  return fs.readFileSync(filename, "utf8").replace(/\s+/g, "");
}).join("");

if (!base64.startsWith("/9j/")) throw new Error("Übersichtsbild ist kein gültiger JPEG-Base64-Stream.");

const buffer = Buffer.from(base64, "base64");
if (buffer.length < 10000 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
  throw new Error("Übersichtsbild konnte nicht als JPEG rekonstruiert werden.");
}

fs.writeFileSync(output, buffer);
console.log(`Übersichtsbild erzeugt: ${path.relative(path.join(__dirname, ".."), output)} (${buffer.length} Bytes)`);
