"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { YouTubeAdapter, roleFor } = require("../src/services/platforms/youtube-adapter.cjs");
const { TwitchAdapter } = require("../src/services/platforms/twitch-adapter.cjs");
const { TikTokAdapter, isOfflineError } = require("../src/services/platforms/tiktok-adapter.cjs");

test("YouTube Rollen werden normalisiert", () => {
  assert.equal(roleFor({ isChatOwner: true }), "broadcaster");
  assert.equal(roleFor({ isChatModerator: true }), "moderator");
  assert.equal(roleFor({ isChatSponsor: true }), "member");
  assert.equal(roleFor({}), "");
});

test("YouTube löst aus einer Live-Video-ID den aktiven Chat und liest Nachrichten", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options?.headers?.Authorization || "" });
    if (String(url).includes("/youtube/v3/videos")) {
      return { ok: true, status: 200, json: async () => ({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat-123" } }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        nextPageToken: "next-1",
        pollingIntervalMillis: 30000,
        items: [{
          id: "m1",
          snippet: { type: "textMessageEvent", displayMessage: "Hallo Batto", publishedAt: "2026-09-04T00:00:00Z" },
          authorDetails: { channelId: "u1", displayName: "Tester", isChatModerator: true, profileImageUrl: "https://example.invalid/a.png" }
        }]
      })
    };
  };

  try {
    const adapter = new YouTubeAdapter();
    const messages = [];
    adapter.onMessage((message) => messages.push(message));
    const status = await adapter.connect({ videoId: "video-1", accessToken: "secret-token" });
    assert.equal(status.connected, true);
    assert.equal(status.liveChatId, "chat-123");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message, "Hallo Batto");
    assert.equal(messages[0].role, "moderator");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.authorization === "Bearer secret-token"));
    assert.equal(JSON.stringify(status).includes("secret-token"), false);
    await adapter.disconnect();
  } finally {
    global.fetch = originalFetch;
  }
});

test("Twitch PRIVMSG wird mit Badges und Benutzerfarbe normalisiert", () => {
  const adapter = new TwitchAdapter();
  adapter.config = { channel: "crazy_batto", token: "hidden", username: "reader" };
  const messages = [];
  adapter.onMessage((message) => messages.push(message));
  adapter.handleLine("@badges=moderator/1;color=#12AB34;display-name=ModGuy;user-id=42 :modguy!modguy@modguy.tmi.twitch.tv PRIVMSG #crazy_batto :Testnachricht");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].username, "ModGuy");
  assert.equal(messages[0].message, "Testnachricht");
  assert.equal(messages[0].role, "moderator");
  assert.equal(messages[0].color, "#12AB34");
  assert.equal(JSON.stringify(adapter.status()).includes("hidden"), false);
});

test("TikTok übergibt immer ein vollständiges Connector-Optionsobjekt", async () => {
  const constructions = [];
  class FakeConnector {
    constructor(username, options) {
      constructions.push({ username, options });
    }
    on() {}
    async connect() { return { roomId: "123" }; }
    async disconnect() {}
  }

  const adapter = new TikTokAdapter({ connectorFactory: FakeConnector });
  const status = await adapter.connect({ username: "@crazy_batto" });

  assert.equal(status.connected, true);
  assert.equal(status.offline, false);
  assert.equal(constructions.length, 1);
  assert.equal(constructions[0].username, "crazy_batto");
  assert.equal(constructions[0].options.processInitialData, false);
  assert.equal(constructions[0].options.fetchRoomInfoOnConnect, true);
  assert.equal(constructions[0].options.enableExtendedGiftInfo, true);
  await adapter.disconnect();
});

test("TikTok offline ist ein normaler Status und kein Remote-Method-Fehler", async () => {
  class OfflineConnector {
    on() {}
    async connect() { throw new Error("The requested user isn't online :("); }
    async disconnect() {}
  }

  const adapter = new TikTokAdapter({ connectorFactory: OfflineConnector });
  const status = await adapter.connect({ username: "crazy_batto" });
  assert.equal(status.connected, false);
  assert.equal(status.offline, true);
  assert.equal(status.configured, true);
  assert.equal(isOfflineError("The requested user isn't online :("), true);
});

test("TikTok echte Verbindungsfehler werden kontrolliert zurückgegeben", async () => {
  class BrokenConnector {
    on() {}
    async connect() { throw new TypeError("Cannot read properties of undefined (reading 'processInitialData')"); }
    async disconnect() {}
  }

  const adapter = new TikTokAdapter({ connectorFactory: BrokenConnector });
  await assert.rejects(
    () => adapter.connect({ username: "crazy_batto" }),
    /TikTok LIVE Verbindung fehlgeschlagen/
  );
  assert.equal(adapter.status().connected, false);
  assert.equal(adapter.status().offline, false);
});
