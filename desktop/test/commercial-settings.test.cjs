"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { DEFAULT_STATE, SettingsStore, normalizeState } = require("../src/services/store.cjs");

test("commercial defaults contain every supported platform", () => {
  for (const platform of ["tiktok", "twitch", "youtube", "cng", "custom"]) {
    assert.ok(DEFAULT_STATE.platforms[platform], `${platform} config missing`);
  }
  assert.equal(DEFAULT_STATE.obs.port, 4455);
  assert.equal(DEFAULT_STATE.platforms.cng.baseUrl, "https://cng-plattform.com");
});

test("normalizeState accepts TikTok and CNG as selected platforms", () => {
  assert.equal(normalizeState({ preferences: { platform: "tiktok" } }).preferences.platform, "tiktok");
  assert.equal(normalizeState({ preferences: { platform: "cng" } }).preferences.platform, "cng");
});

test("OBS settings reject unsafe remote hosts and invalid ports", () => {
  const state = normalizeState({ obs: { host: "attacker.example", port: 99999 } });
  assert.equal(state.obs.host, "127.0.0.1");
  assert.equal(state.obs.port, 65535);
});

test("partial platform patches preserve unrelated platform settings", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "batto-settings-"));
  const store = new SettingsStore(path.join(dir, "settings.json"));
  await store.load();
  await store.patch({ platforms: { twitch: { channel: "crazy_batto", enabled: true } } });
  await store.patch({ platforms: { tiktok: { username: "@crazy_batto", enabled: true } } });
  const state = await store.get();
  assert.equal(state.platforms.twitch.channel, "crazy_batto");
  assert.equal(state.platforms.twitch.enabled, true);
  assert.equal(state.platforms.tiktok.username, "@crazy_batto");
  assert.equal(state.platforms.cng.baseUrl, "https://cng-plattform.com");
  await fs.rm(dir, { recursive: true, force: true });
});

test("plain settings never persist an OBS password", () => {
  const state = normalizeState({ obs: { password: "secret-value" } });
  assert.equal(state.obs.password, "");
});
