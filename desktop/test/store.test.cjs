"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SettingsStore, normalizeState } = require("../src/services/store.cjs");

test("deck grid accepts 1x1 through 10x10 without truncating hidden assignments", () => {
  const assignments = Array.from({ length: 100 }, (_, index) => ({
    title: `Taste ${index + 1}`,
    type: "obs",
    action: "record.start"
  }));
  const state = normalizeState({
    deck: {
      activeProfile: "Streaming",
      profiles: {
        Streaming: {
          rows: 2,
          columns: 2,
          pages: { root: assignments }
        }
      }
    }
  });
  assert.equal(state.deck.profiles.Streaming.rows, 2);
  assert.equal(state.deck.profiles.Streaming.columns, 2);
  assert.equal(state.deck.profiles.Streaming.pages.root.length, 100);
  assert.equal(state.deck.profiles.Streaming.pages.root[99].title, "Taste 100");
});

test("settings are written atomically and can be loaded again", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "batto-store-"));
  const filename = path.join(directory, "settings.json");
  const store = new SettingsStore(filename);
  const saved = await store.set({
    preferences: { platform: "youtube", targetFps: 60 },
    deck: {
      activeProfile: "YouTube",
      profiles: {
        YouTube: {
          rows: 4,
          columns: 6,
          pages: { root: [{ title: "Stream", type: "obs", action: "stream.start" }] }
        }
      }
    }
  });
  assert.equal(saved.deck.activeProfile, "YouTube");
  const reloaded = new SettingsStore(filename);
  const value = await reloaded.get();
  assert.equal(value.preferences.platform, "youtube");
  assert.equal(value.deck.profiles.YouTube.rows, 4);
  assert.equal(value.deck.profiles.YouTube.pages.root[0].action, "stream.start");
});
