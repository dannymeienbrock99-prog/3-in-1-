"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("hologram server persists styles and exposes a local config API", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "holo-server-v2.cjs"), "utf8");
  assert.match(source, /atomicWrite\(this\.configFile/);
  assert.match(source, /\/api\/config/);
  assert.match(source, /type: "config", config: this\.config/);
});

test("hologram editor saves the configured style to the local server", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "modules", "twitch-holo-chat", "web", "editor.js"), "utf8");
  assert.match(source, /fetch\("\/api\/config"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /Gespeicherter OBS-Hologramm-Stil geladen/);
});

test("hologram OBS URL connects to the local websocket", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "holo-server-v2.cjs"), "utf8");
  assert.match(source, /overlay\.html\?ws=/);
  assert.match(source, /ws:\/\/127\.0\.0\.1/);
});
