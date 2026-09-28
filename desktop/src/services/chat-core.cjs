"use strict";

const { EventEmitter } = require("node:events");
const { ChatStore } = require("./chat-store.cjs");

const PLATFORMS = Object.freeze(["twitch", "cng", "tiktok", "youtube"]);
const PLATFORM_META = Object.freeze({
  twitch: { label: "Twitch", color: "#9146ff", icon: "◉" },
  cng: { label: "CNG", color: "#2f9cff", icon: "◆" },
  tiktok: { label: "TikTok", color: "#111111", icon: "♪" },
  youtube: { label: "YouTube", color: "#ff3030", icon: "▶" }
});

function cleanText(value, max = 1000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

function normalizeMessage(input = {}) {
  const platform = PLATFORMS.includes(input.platform) ? input.platform : "cng";
  return {
    id: cleanText(input.id, 160) || undefined,
    platform,
    username: cleanText(input.username || input.displayName || "User", 80) || "User",
    userId: cleanText(input.userId, 160),
    message: cleanText(input.message || input.text, 1000),
    color: cleanText(input.color, 32) || PLATFORM_META[platform].color,
    badges: Array.isArray(input.badges) ? input.badges.slice(0, 12).map((badge) => cleanText(badge, 40)).filter(Boolean) : [],
    role: cleanText(input.role, 40),
    avatar: cleanText(input.avatar, 500),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now(),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

class ChatCore extends EventEmitter {
  constructor({ maxMessages = 500, flushMs = 50 } = {}) {
    super();
    this.store = new ChatStore({ maxMessages });
    this.adapters = new Map();
    this.pending = [];
    this.flushMs = Math.max(25, Math.min(250, Number(flushMs) || 50));
    this.flushTimer = null;
  }

  registerAdapter(adapter) {
    if (!adapter || !PLATFORMS.includes(adapter.platform)) throw new Error("Ungültiger Chat-Adapter.");
    this.adapters.set(adapter.platform, adapter);
    adapter.onMessage?.((message) => this.ingest(message));
    adapter.onStatus?.((status) => this.emit("status", { platform: adapter.platform, ...status }));
    return adapter;
  }

  async connect(platform, config) {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`Kein Adapter für ${platform} eingerichtet.`);
    return adapter.connect(config);
  }

  async disconnect(platform) {
    const adapter = this.adapters.get(platform);
    if (!adapter) return { platform, connected: false };
    return adapter.disconnect?.() || { platform, connected: false };
  }

  ingest(input) {
    const message = normalizeMessage(input);
    const stored = this.store.add(message);
    this.pending.push(stored);
    this.scheduleFlush();
    return stored;
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.pending.length) return;
      const batch = this.pending.splice(0, this.pending.length);
      this.emit("messages", batch);
    }, this.flushMs);
    this.flushTimer.unref?.();
  }

  history(options) { return this.store.list(options); }
  clear(platform) { this.store.clear(platform); this.emit("cleared", platform || "all"); }

  statuses() {
    return Object.fromEntries(PLATFORMS.map((platform) => [platform, this.adapters.get(platform)?.status?.() || { platform, connected: false, configured: false }]));
  }

  stop() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    return Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.disconnect?.()));
  }
}

module.exports = { ChatCore, PLATFORMS, PLATFORM_META, cleanText, normalizeMessage };
