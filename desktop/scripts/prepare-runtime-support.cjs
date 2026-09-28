"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "bootstrap-2.0", "src", "services");
const targetRoot = path.join(root, "src", "services");
const files = [
  "common.cjs",
  "deck-store.cjs",
  "plugin-registry.cjs",
  "runtime-utils-v2.cjs",
  "mobile-bridge-v2.cjs"
];

fs.mkdirSync(targetRoot, { recursive: true });
for (const name of files) {
  const source = path.join(sourceRoot, name);
  const target = path.join(targetRoot, name);
  if (!fs.existsSync(source) || !fs.statSync(source).size) throw new Error(`Runtime-Unterbau fehlt: ${source}`);
  fs.copyFileSync(source, target);
}

const mobileSource = path.join(root, "bootstrap-2.0", "src", "mobile");
const mobileTarget = path.join(root, "src", "mobile");
fs.rmSync(mobileTarget, { recursive: true, force: true });
fs.cpSync(mobileSource, mobileTarget, { recursive: true });

console.log(`Runtime-Unterbau vorbereitet: ${files.join(", ")} + Mobile-Weboberfläche`);
