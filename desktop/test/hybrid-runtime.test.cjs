"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeState } = require("../src/services/store.cjs");
const { ConnectionManager } = require("../src/services/connection-manager.cjs");
const { expandEnvironment, compareVersionLikeDesc } = require("../src/services/tiktok-live-studio.cjs");

test("TikTok settings are split into LIVE Studio and API layers", () => {
  const state = normalizeState({
    platforms: {
      tiktok: {
        enabled: true,
        username: "@Crazy_Batto",
        liveStudio: { enabled: true, launchWithApp: true, executablePath: "C:/TikTok/TikTok LIVE Studio.exe" },
        api: { enabled: true, provider: "eulerstream", reconnectMinMs: 100, reconnectMaxMs: 999999, gifts: false }
      }
    }
  });
  assert.equal(state.version, 4);
  assert.equal(state.platforms.tiktok.enabled, true);
  assert.equal(state.platforms.tiktok.liveStudio.launchWithApp, true);
  assert.equal(state.platforms.tiktok.api.provider, "eulerstream");
  assert.equal(state.platforms.tiktok.api.reconnectMinMs, 1000);
  assert.equal(state.platforms.tiktok.api.reconnectMaxMs, 300000);
  assert.equal(state.platforms.tiktok.api.gifts, false);
});

test("old TikTok v3 flags migrate into the API layer", () => {
  const state = normalizeState({ platforms: { tiktok: { enabled: true, provider: "connector", chat: false, gifts: true, moderation: false } } });
  assert.equal(state.platforms.tiktok.api.provider, "connector");
  assert.equal(state.platforms.tiktok.api.chat, false);
  assert.equal(state.platforms.tiktok.api.gifts, true);
  assert.equal(state.platforms.tiktok.api.moderation, false);
});

test("one failing platform does not fail the other connections", async () => {
  const manager = new ConnectionManager();
  manager.register("good", { connect: async () => ({ connected: true }) });
  manager.register("bad", { connect: async () => { throw new Error("platform unavailable"); } });
  manager.configure("good", true);
  manager.configure("bad", true);
  const result = await manager.startEnabled();
  assert.equal(result.good.state, "connected");
  assert.equal(result.bad.state, "error");
  assert.match(result.bad.lastError.message, /platform unavailable/);
});

test("disabled connections are not started", async () => {
  let calls = 0;
  const manager = new ConnectionManager();
  manager.register("optional", { connect: async () => { calls += 1; return { connected: true }; } });
  manager.configure("optional", false);
  const result = await manager.startEnabled();
  assert.equal(calls, 0);
  assert.equal(result.optional.state, "disabled");
});

test("TikTok LIVE Studio path expansion uses environment variables", () => {
  const old = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = "C:\\Users\\Test\\AppData\\Local";
  assert.equal(expandEnvironment("%LOCALAPPDATA%\\TikTok LIVE Studio\\TikTok LIVE Studio.exe"), "C:\\Users\\Test\\AppData\\Local\\TikTok LIVE Studio\\TikTok LIVE Studio.exe");
  if (old === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = old;
});

test("TikTok LIVE Studio version directories prefer the newest version", () => {
  const versions = ["1.9.0", "1.33.2", "1.10.4", "1.33.10"];
  versions.sort(compareVersionLikeDesc);
  assert.deepEqual(versions, ["1.33.10", "1.33.2", "1.10.4", "1.9.0"]);
});
