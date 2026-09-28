"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DeckManager } = require("../src/services/deck-manager-v2.cjs");
const { PluginRegistry } = require("../src/services/plugin-registry-v2.cjs");
const { normalizeHost, hostForUrl } = require("../src/services/obs-client-v2.cjs");
const { convertLegacyProfiles } = require("../src/services/migration-v2.cjs");
const { normalizeConfig } = require("../src/services/stream-overlay-server-v2.cjs");

function tempFile(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "batto-test-"));
  return path.join(directory, name);
}

test("OBS host migration keeps local loopback and formats IPv6 correctly", () => {
  assert.equal(normalizeHost("localhost"), "127.0.0.1");
  assert.equal(normalizeHost("0.0.0.0"), "127.0.0.1");
  assert.equal(normalizeHost("2003:f8:3733:8662::1"), "::1");
  assert.equal(hostForUrl("::1"), "[::1]");
  assert.equal(hostForUrl("127.0.0.1"), "127.0.0.1");
});

test("deck layout expansion preserves assigned buttons", async () => {
  const manager = new DeckManager(tempFile("deck.json"), { executeMany: async () => [] });
  const profile = manager.snapshot().profiles[0];
  await manager.command("setButton", { profileId: profile.id, folderId: "root", index: 14, button: { title: "OBS", actions: [{ type: "obs.stream.toggle" }] } });
  await manager.command("updateLayout", { profileId: profile.id, folderId: "root", rows: 4, columns: 5 });
  assert.equal(manager.snapshot().profiles[0].buttons[14].title, "OBS");
});

test("deck refuses grid reduction when an occupied key would be lost", async () => {
  const manager = new DeckManager(tempFile("deck.json"), { executeMany: async () => [] });
  const profile = manager.snapshot().profiles[0];
  await manager.command("setButton", { profileId: profile.id, folderId: "root", index: 14, button: { title: "Belegt", actions: [] } });
  await assert.rejects(() => manager.command("updateLayout", { profileId: profile.id, folderId: "root", rows: 2, columns: 5 }), /Raster zu klein/);
  assert.equal(manager.snapshot().profiles[0].buttons[14].title, "Belegt");
});

test("deck folders and multi-actions survive persistence", async () => {
  const file = tempFile("deck.json");
  let manager = new DeckManager(file, { executeMany: async (actions) => actions });
  const profile = manager.snapshot().profiles[0];
  await manager.command("createFolder", { profileId: profile.id, parentId: "root", name: "OBS" });
  const folder = manager.snapshot().profiles[0].folders[0];
  await manager.command("setButton", { profileId: profile.id, folderId: folder.id, index: 0, button: { title: "Multi", actions: [{ type: "obs.scene", sceneName: "Gaming" }, { type: "delay", ms: 300 }, { type: "obs.mute", inputName: "Mic" }] } });
  manager = new DeckManager(file, { executeMany: async (actions) => actions });
  assert.equal(manager.snapshot().profiles[0].folders[0].buttons[0].actions.length, 3);
});

test("native plugin registry contains legacy and new integrations", () => {
  const registry = new PluginRegistry({ settingsFile: tempFile("plugins.json"), roots: [], iconRoots: [] });
  const snapshot = registry.scan();
  const names = new Set(snapshot.items.map((item) => item.name));
  for (const name of ["OBS Studio", "TikTok LIVE Studio", "TikFinity", "YouTube Music Desktop Connector", "OBSBOT WebCam", "YouTube Ticker", "Discord Volume Mixer"]) {
    assert.ok(names.has(name), `Plugin fehlt: ${name}`);
  }
  assert.ok(snapshot.iconPacks.some((pack) => /LS25/i.test(pack.name)));
});

test("legacy profile conversion keeps titles and action information", () => {
  const converted = convertLegacyProfiles({ profiles: [{ name: "Alt", rows: 3, columns: 5, buttons: [{ title: "Szene", action: { type: "scene", sceneName: "Gaming" } }] }] });
  assert.equal(converted.length, 1);
  assert.equal(converted[0].buttons[0].title, "Szene");
  assert.equal(converted[0].buttons[0].actions[0].type, "obs.scene");
});

test("stream overlay elements are clamped inside the selected resolution", () => {
  const config = normalizeConfig({ resolution: { width: 1280, height: 720 }, elements: [{ id: "logo", type: "image", x: 2000, y: 1000, width: 400, height: 300, src: "/team-logo.svg" }] });
  const item = config.elements[0];
  assert.equal(item.x, 880);
  assert.equal(item.y, 420);
  assert.equal(config.background, "transparent");
});

test("production renderer contains no old visible branding or demo buttons", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  const overlay = fs.readFileSync(path.join(__dirname, "..", "src", "stream-overlay", "overlay.html"), "utf8");
  assert.doesNotMatch(renderer, /Creator[ -]?Hub/i);
  assert.doesNotMatch(overlay, /Creator[ -]?Hub/i);
  assert.doesNotMatch(renderer, /Testwerte anzeigen|show-test-values/i);
  assert.match(renderer, /Batto OBS Tool/);
  assert.match(renderer, /Handy verbinden/);
});
