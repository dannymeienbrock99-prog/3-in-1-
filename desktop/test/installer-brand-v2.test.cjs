"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("NSIS uses the final Team Alpha icon, license and mobile firewall include", () => {
  const root = path.join(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.build.win.icon, "build/icon.png");
  assert.equal(packageJson.build.nsis.license, "resources/LICENSE-DE.txt");
  assert.equal(packageJson.build.nsis.include, "build/installer-2.0.nsh");
  assert.equal(packageJson.build.nsis.runAfterFinish, false);
  assert.ok(fs.statSync(path.join(root, "build", "icon.png")).size > 1000);
  const include = fs.readFileSync(path.join(root, "build", "installer-2.0.nsh"), "utf8");
  assert.match(include, /localport=48620/);
  assert.match(include, /customUnInstall/);
});
