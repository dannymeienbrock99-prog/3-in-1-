"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DeckManager } = require("../src/services/deck-manager-v2.cjs");
const { DEFAULT_CONFIG } = require("../src/services/stream-overlay-server-v2.cjs");

function temporaryFile(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "batto-release-test-"));
  return path.join(directory, name);
}

test("rejected deck shrink does not mutate rows or columns", async () => {
  const manager = new DeckManager(temporaryFile("deck.json"), { executeMany: async () => [] });
  const profile = manager.snapshot().profiles[0];
  await manager.command("setButton", {
    profileId: profile.id,
    folderId: "root",
    index: 14,
    button: { title: "Belegt", actions: [{ type: "obs.stream.toggle" }] }
  });
  await assert.rejects(
    () => manager.command("updateLayout", { profileId: profile.id, folderId: "root", rows: 2, columns: 5 }),
    /Raster zu klein/
  );
  const after = manager.snapshot().profiles[0];
  assert.equal(after.rows, 3);
  assert.equal(after.columns, 5);
  assert.equal(after.buttons[14].title, "Belegt");
});

test("root layout changes are persisted", async () => {
  const file = temporaryFile("deck.json");
  let manager = new DeckManager(file, { executeMany: async () => [] });
  const profile = manager.snapshot().profiles[0];
  await manager.command("updateLayout", { profileId: profile.id, folderId: "root", rows: 4, columns: 6, buttonSize: 130, gap: 12 });
  manager = new DeckManager(file, { executeMany: async () => [] });
  const after = manager.snapshot().profiles[0];
  assert.equal(after.rows, 4);
  assert.equal(after.columns, 6);
  assert.equal(after.buttonSize, 130);
  assert.equal(after.gap, 12);
});

test("default stream overlay keeps the Team Alpha logo and transparent background", () => {
  assert.equal(DEFAULT_CONFIG.background, "transparent");
  const logo = DEFAULT_CONFIG.elements.find((item) => item.id === "team-logo");
  assert.ok(logo);
  assert.equal(logo.type, "image");
  assert.equal(logo.src, "/team-logo.svg");
});

test("mobile bridge contains new and legacy local pairing schemes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "mobile-bridge-v2.cjs"), "utf8");
  assert.match(source, /battoobstool:\/\/pair/);
  assert.match(source, /creatorhub:\/\/pair/);
  assert.match(source, /0\.0\.0\.0/);
  assert.doesNotMatch(source, /https:\/\//);
});

test("installer never starts the application automatically", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(packageJson.build.nsis.runAfterFinish, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(packageJson.build.nsis.license, "resources/LICENSE-DE.txt");
});
