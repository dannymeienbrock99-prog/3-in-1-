"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseCngChatUrl,
  parseCngAlertUrl,
  normalizeCngConfig,
  sanitizeForLog
} = require("../src/services/cng-config.cjs");
const { createCngChatMessage } = require("../src/services/cng-chat-model.cjs");

test("parses a personal CNG OBS chat URL without exposing the token in log output", () => {
  const token = "secret-token-value";
  const parsed = parseCngChatUrl(`https://cng-plattform.com/chat-popout/210048?mode=obs&obsChatToken=${encodeURIComponent(token)}`);
  assert.equal(parsed.creatorId, "210048");
  assert.equal(parsed.mode, "obs");
  assert.equal(parsed.obsChatToken, token);
  const safe = sanitizeForLog({ enabled: true, creatorId: parsed.creatorId, chat: parsed });
  assert.equal(safe.chat.hasToken, true);
  assert.equal(safe.chat.token.includes(token), false);
});

test("parses CNG alert URL and TTS flags", () => {
  const parsed = parseCngAlertUrl("https://cng-plattform.com/alert-overlay?creatorId=210048&alertTts=1&chatTts=0");
  assert.equal(parsed.creatorId, "210048");
  assert.equal(parsed.alertTts, true);
  assert.equal(parsed.chatTts, false);
});

test("requires the CNG host and matching creator", () => {
  assert.throws(() => parseCngChatUrl("https://example.com/chat-popout/210048?mode=obs&obsChatToken=x"));
  assert.throws(() => normalizeCngConfig({
    creatorId: "210048",
    chat: { url: "https://cng-plattform.com/chat-popout/210049?mode=obs&obsChatToken=x" }
  }));
});

test("normalizes CNG chat messages into the unified model", () => {
  const message = createCngChatMessage({
    id: "cng-1",
    username: "CreatorFan",
    text: "Hallo Batto!",
    role: "viewer",
    badges: ["follower"]
  });
  assert.equal(message.platform, "cng");
  assert.equal(message.username, "CreatorFan");
  assert.equal(message.message, "Hallo Batto!");
  assert.equal(message.badges[0].id, "follower");
});
