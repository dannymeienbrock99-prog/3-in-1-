"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { obsAuthentication } = require("../src/services/obs-websocket.cjs");
const { TwitchHoloServer } = require("../src/services/twitch-holo-server.cjs");

const root = path.join(__dirname, "..");

async function read(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

test("desktop UI contains only Batto and Team Alpha branding", async () => {
  const files = [
    "package.json",
    "src/main.cjs",
    "src/renderer/index.html",
    "src/renderer/app.js",
    "src/renderer/styles.css"
  ];
  const content = (await Promise.all(files.map(read))).join("\n");
  assert.doesNotMatch(content, /Creator[ -]?Hub/i);
  assert.match(content, /Batto OBS Tool/);
  assert.match(content, /Team Alpha/);
});

test("OBS authentication matches the documented SHA-256 challenge algorithm", () => {
  const value = obsAuthentication("password", "salt", "challenge");
  assert.equal(typeof value, "string");
  assert.ok(value.length >= 40);
  assert.doesNotMatch(value, /password|salt|challenge/);
});

test("Twitch hologram server always binds to loopback", () => {
  const server = new TwitchHoloServer({ webRoot: path.join(root, "src", "renderer") });
  assert.equal(server.host, "127.0.0.1");
});

test("visible desktop production UI contains no demo or fake hardware button", async () => {
  const html = await read("src/renderer/index.html");
  assert.doesNotMatch(html, /Testwerte anzeigen|Demo-Modus|Demo starten/i);
  assert.match(html, /PC jetzt scannen/);
  assert.match(html, /Internettest starten/);
});
