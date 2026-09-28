"use strict";

const PLATFORMS = Object.freeze(["twitch", "cng", "tiktok", "youtube"]);
const MAX_TEXT_LENGTH = 2000;
const MAX_BADGES = 20;

function cleanText(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_TEXT_LENGTH);
}

function normalizeBadges(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_BADGES).map((badge) => {
    if (typeof badge === "string") return { id: badge, label: badge };
    return {
      id: String(badge?.id || badge?.name || "badge"),
      label: String(badge?.label || badge?.name || badge?.id || "Badge"),
      url: badge?.url ? String(badge.url) : ""
    };
  });
}

function normalizeChatMessage(input = {}) {
  const platform = PLATFORMS.includes(String(input.platform)) ? String(input.platform) : "cng";
  const timestamp = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now();
  return Object.freeze({
    id: String(input.id || `${platform}-${timestamp}-${Math.random().toString(36).slice(2, 10)}`),
    platform,
    username: String(input.username ?? input.name ?? "Unbekannt").slice(0, 80),
    userId: String(input.userId ?? "").slice(0, 120),
    message: cleanText(input.message ?? input.text),
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || "")) ? String(input.color) : "",
    badges: normalizeBadges(input.badges),
    role: String(input.role || "viewer").slice(0, 40),
    avatar: input.avatar ? String(input.avatar) : "",
    timestamp,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  });
}

function createCngChatMessage(data = {}) {
  return normalizeChatMessage({
    ...data,
    platform: "cng"
  });
}

module.exports = {
  PLATFORMS,
  normalizeChatMessage,
  createCngChatMessage
};
