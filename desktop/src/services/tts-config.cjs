"use strict";

const DEFAULT_TTS = Object.freeze({
  enabled: false,
  voice: "",
  language: "de-DE",
  rate: 1,
  pitch: 1,
  volume: 1,
  cooldownMs: 1200,
  maxQueue: 20,
  maxCommentLength: 220,
  allowUsers: [],
  blockUsers: [],
  announcePlatforms: ["twitch", "cng", "tiktok", "youtube"],
  chat: true,
  events: true
});

function normalizeTtsConfig(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    ...DEFAULT_TTS,
    ...source,
    enabled: source.enabled === true,
    voice: String(source.voice || "").slice(0, 160),
    language: String(source.language || "de-DE").slice(0, 24),
    rate: Math.max(0.5, Math.min(2, Number(source.rate) || 1)),
    pitch: Math.max(0, Math.min(2, Number(source.pitch) || 1)),
    volume: Math.max(0, Math.min(1, Number(source.volume) || 1)),
    cooldownMs: Math.max(0, Math.min(60000, Math.round(Number(source.cooldownMs) || 1200))),
    maxQueue: Math.max(1, Math.min(100, Math.round(Number(source.maxQueue) || 20))),
    maxCommentLength: Math.max(20, Math.min(1000, Math.round(Number(source.maxCommentLength) || 220))),
    allowUsers: Array.isArray(source.allowUsers) ? source.allowUsers.slice(0, 100).map(String) : [],
    blockUsers: Array.isArray(source.blockUsers) ? source.blockUsers.slice(0, 100).map(String) : [],
    announcePlatforms: Array.isArray(source.announcePlatforms) ? source.announcePlatforms.filter((item) => ["twitch", "cng", "tiktok", "youtube"].includes(item)).slice(0, 4) : DEFAULT_TTS.announcePlatforms,
    chat: source.chat !== false,
    events: source.events !== false
  };
}
module.exports = { DEFAULT_TTS, normalizeTtsConfig };
