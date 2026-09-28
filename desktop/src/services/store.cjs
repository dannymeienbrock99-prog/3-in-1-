"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function asObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function asString(value, fallback = "", max = 500) { return String(value ?? fallback).trim().slice(0, max); }
function asBool(value, fallback = false) { return typeof value === "boolean" ? value : fallback; }
function asPort(value, fallback) { return Math.max(1, Math.min(65535, Math.round(Number(value) || fallback))); }
function asInt(value, fallback, min, max) { return Math.max(min, Math.min(max, Math.round(Number(value) || fallback))); }

function normalizeLocalObsHost(value) {
  let host = String(value || "").trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1") return "127.0.0.1";
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return "::1";
  return "127.0.0.1";
}

const DEFAULT_STATE = Object.freeze({
  version: 4,
  product: {
    language: "de-DE",
    startMinimized: false,
    minimizeToTray: false,
    checkForUpdates: true,
    diagnosticsEnabled: true,
    launchHealthCheck: true
  },
  obs: {
    host: "127.0.0.1",
    port: 4455,
    password: "",
    autoConnect: true,
    reconnect: true,
    reconnectDelayMs: 3000,
    sceneSync: true,
    browserOverlayAutoRefresh: true
  },
  platforms: {
    tiktok: {
      enabled: false,
      username: "",
      autoConnect: false,
      preferLiveStudio: true,
      fallbackToApi: true,
      liveCenterUrl: "https://livecenter.tiktok.com/",
      liveStudio: {
        enabled: true,
        executablePath: "",
        detectAutomatically: true,
        launchWithApp: false,
        preferForTikTokFeatures: true
      },
      api: {
        enabled: true,
        provider: "eulerstream",
        reconnect: true,
        reconnectMinMs: 5000,
        reconnectMaxMs: 60000,
        rateLimitGuard: true,
        gifts: true,
        chat: true,
        follows: true,
        shares: true,
        likes: true,
        joins: true,
        subscriptions: true,
        moderation: true
      }
    },
    twitch: {
      enabled: false,
      channel: "",
      username: "",
      autoConnect: false,
      transport: "eventsub",
      chat: true,
      moderation: true,
      subs: true,
      bits: true,
      raids: true,
      holoOverlay: true
    },
    youtube: {
      enabled: false,
      channelId: "",
      liveChatId: "",
      autoConnect: false,
      transport: "streamList",
      chat: true
    },
    cng: {
      enabled: false,
      baseUrl: "https://cng-plattform.com",
      profileUrl: "https://cng-plattform.com/profile",
      apiBaseUrl: "",
      websocketUrl: "",
      username: "",
      autoConnect: false,
      chat: true
    },
    custom: {
      enabled: false,
      name: "Eigene Plattform",
      websocketUrl: "",
      apiBaseUrl: "",
      autoConnect: false
    }
  },
  chat: {
    unifiedEnabled: true,
    showPlatformBadge: true,
    showTimestamps: true,
    showAvatars: true,
    filterLinks: false,
    filterBlockedWords: false,
    ttsEnabled: false,
    ttsVolume: 1,
    maxMessages: 500
  },
  moderation: {
    rightClickActions: true,
    confirmBan: true,
    confirmTimeout: false,
    keepBlockedList: true,
    keepMutedList: true
  },
  overlays: {
    chatEnabled: true,
    giftsEnabled: true,
    alertsEnabled: true,
    monitoringEnabled: true,
    browserSourcePort: 17824
  },
  preferences: {
    platform: "twitch",
    targetResolution: "1920x1080",
    targetFps: 60,
    monitoringEnabled: true,
    twitchHoloEnabled: true
  },
  deck: {
    activeProfile: "Standard",
    profiles: {
      Standard: { rows: 3, columns: 5, pages: { root: Array.from({ length: 15 }, () => null) } }
    }
  }
});

function normalizePlatformState(source, defaults) {
  const input = asObject(source);
  const output = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (!(key in input)) continue;
    if (typeof defaults[key] === "boolean") output[key] = asBool(input[key], defaults[key]);
    else if (typeof defaults[key] === "number") output[key] = Number.isFinite(Number(input[key])) ? Number(input[key]) : defaults[key];
    else if (typeof defaults[key] === "string") output[key] = asString(input[key], defaults[key], 1000);
  }
  return output;
}

function normalizeTikTok(source) {
  const input = asObject(source);
  const oldProvider = asString(input.provider, "", 50);
  const oldFlags = {
    gifts: input.gifts,
    chat: input.chat,
    follows: input.follows,
    shares: input.shares,
    likes: input.likes,
    moderation: input.moderation
  };
  const liveStudio = asObject(input.liveStudio);
  const api = asObject(input.api);
  return {
    enabled: asBool(input.enabled, false),
    username: asString(input.username, "", 120),
    autoConnect: asBool(input.autoConnect, false),
    preferLiveStudio: asBool(input.preferLiveStudio, true),
    fallbackToApi: asBool(input.fallbackToApi, true),
    liveCenterUrl: asString(input.liveCenterUrl, DEFAULT_STATE.platforms.tiktok.liveCenterUrl, 1000),
    liveStudio: {
      enabled: asBool(liveStudio.enabled, true),
      executablePath: asString(liveStudio.executablePath, "", 1000),
      detectAutomatically: asBool(liveStudio.detectAutomatically, true),
      launchWithApp: asBool(liveStudio.launchWithApp, false),
      preferForTikTokFeatures: asBool(liveStudio.preferForTikTokFeatures, true)
    },
    api: {
      enabled: asBool(api.enabled, true),
      provider: ["eulerstream", "connector"].includes(api.provider || oldProvider) ? (api.provider || oldProvider) : "eulerstream",
      reconnect: asBool(api.reconnect, true),
      reconnectMinMs: asInt(api.reconnectMinMs, 5000, 1000, 60000),
      reconnectMaxMs: asInt(api.reconnectMaxMs, 60000, 5000, 300000),
      rateLimitGuard: asBool(api.rateLimitGuard, true),
      gifts: asBool(api.gifts ?? oldFlags.gifts, true),
      chat: asBool(api.chat ?? oldFlags.chat, true),
      follows: asBool(api.follows ?? oldFlags.follows, true),
      shares: asBool(api.shares ?? oldFlags.shares, true),
      likes: asBool(api.likes ?? oldFlags.likes, true),
      joins: asBool(api.joins, true),
      subscriptions: asBool(api.subscriptions, true),
      moderation: asBool(api.moderation ?? oldFlags.moderation, true)
    }
  };
}

function normalizeState(value = {}) {
  const source = asObject(value);
  const profiles = asObject(source.deck?.profiles);
  const normalizedProfiles = {};
  for (const [rawName, rawProfile] of Object.entries(profiles).slice(0, 100)) {
    const name = asString(rawName, "Standard", 80) || "Standard";
    const rows = asInt(rawProfile?.rows, 3, 1, 10);
    const columns = asInt(rawProfile?.columns, 5, 1, 10);
    const pages = asObject(rawProfile?.pages);
    const safePages = Object.keys(pages).length ? clone(pages) : { root: [] };
    safePages.root ||= [];
    normalizedProfiles[name] = { rows, columns, pages: safePages };
  }
  if (!Object.keys(normalizedProfiles).length) normalizedProfiles.Standard = clone(DEFAULT_STATE.deck.profiles.Standard);
  const activeProfile = normalizedProfiles[source.deck?.activeProfile] ? source.deck.activeProfile : Object.keys(normalizedProfiles)[0];
  const selectedPlatform = ["tiktok", "twitch", "youtube", "cng", "custom", "recording"].includes(source.preferences?.platform)
    ? source.preferences.platform : "twitch";

  return {
    version: 4,
    product: {
      language: asString(source.product?.language, "de-DE", 20) || "de-DE",
      startMinimized: asBool(source.product?.startMinimized, false),
      minimizeToTray: asBool(source.product?.minimizeToTray, false),
      checkForUpdates: asBool(source.product?.checkForUpdates, true),
      diagnosticsEnabled: asBool(source.product?.diagnosticsEnabled, true),
      launchHealthCheck: asBool(source.product?.launchHealthCheck, true)
    },
    obs: {
      host: normalizeLocalObsHost(source.obs?.host),
      port: asPort(source.obs?.port, 4455),
      password: "",
      autoConnect: asBool(source.obs?.autoConnect, true),
      reconnect: asBool(source.obs?.reconnect, true),
      reconnectDelayMs: asInt(source.obs?.reconnectDelayMs, 3000, 1000, 30000),
      sceneSync: asBool(source.obs?.sceneSync, true),
      browserOverlayAutoRefresh: asBool(source.obs?.browserOverlayAutoRefresh, true)
    },
    platforms: {
      tiktok: normalizeTikTok(source.platforms?.tiktok),
      twitch: normalizePlatformState(source.platforms?.twitch, DEFAULT_STATE.platforms.twitch),
      youtube: normalizePlatformState(source.platforms?.youtube, DEFAULT_STATE.platforms.youtube),
      cng: normalizePlatformState(source.platforms?.cng, DEFAULT_STATE.platforms.cng),
      custom: normalizePlatformState(source.platforms?.custom, DEFAULT_STATE.platforms.custom)
    },
    chat: {
      unifiedEnabled: asBool(source.chat?.unifiedEnabled, true),
      showPlatformBadge: asBool(source.chat?.showPlatformBadge, true),
      showTimestamps: asBool(source.chat?.showTimestamps, true),
      showAvatars: asBool(source.chat?.showAvatars, true),
      filterLinks: asBool(source.chat?.filterLinks, false),
      filterBlockedWords: asBool(source.chat?.filterBlockedWords, false),
      ttsEnabled: asBool(source.chat?.ttsEnabled, false),
      ttsVolume: Math.max(0, Math.min(1, Number(source.chat?.ttsVolume ?? 1))),
      maxMessages: asInt(source.chat?.maxMessages, 500, 50, 5000)
    },
    moderation: {
      rightClickActions: asBool(source.moderation?.rightClickActions, true),
      confirmBan: asBool(source.moderation?.confirmBan, true),
      confirmTimeout: asBool(source.moderation?.confirmTimeout, false),
      keepBlockedList: asBool(source.moderation?.keepBlockedList, true),
      keepMutedList: asBool(source.moderation?.keepMutedList, true)
    },
    overlays: {
      chatEnabled: asBool(source.overlays?.chatEnabled, true),
      giftsEnabled: asBool(source.overlays?.giftsEnabled, true),
      alertsEnabled: asBool(source.overlays?.alertsEnabled, true),
      monitoringEnabled: asBool(source.overlays?.monitoringEnabled, true),
      browserSourcePort: asPort(source.overlays?.browserSourcePort, 17824)
    },
    preferences: {
      platform: selectedPlatform,
      targetResolution: asString(source.preferences?.targetResolution, "1920x1080", 30),
      targetFps: [30, 60, 120].includes(Number(source.preferences?.targetFps)) ? Number(source.preferences.targetFps) : 60,
      monitoringEnabled: asBool(source.preferences?.monitoringEnabled, true),
      twitchHoloEnabled: asBool(source.preferences?.twitchHoloEnabled, true)
    },
    deck: { activeProfile, profiles: normalizedProfiles }
  };
}

class SettingsStore {
  constructor(filename) {
    this.filename = path.resolve(filename);
    this.state = clone(DEFAULT_STATE);
    this.loaded = false;
    this.queue = Promise.resolve();
  }
  async load() {
    if (this.loaded) return clone(this.state);
    try { this.state = normalizeState(JSON.parse(await fs.readFile(this.filename, "utf8"))); }
    catch (error) {
      if (error.code !== "ENOENT") {
        const backup = `${this.filename}.invalid-${Date.now()}.json`;
        await fs.mkdir(path.dirname(this.filename), { recursive: true });
        await fs.rename(this.filename, backup).catch(() => {});
      }
      this.state = clone(DEFAULT_STATE);
    }
    this.loaded = true;
    await this.persist().catch(() => {});
    return clone(this.state);
  }
  async persist() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.filename);
  }
  async get() { await this.load(); return clone(this.state); }
  async set(value) {
    await this.load();
    this.state = normalizeState(value);
    this.queue = this.queue.catch(() => {}).then(() => this.persist());
    await this.queue;
    return clone(this.state);
  }
  async patch(patch = {}) {
    const current = await this.get();
    return this.set({
      ...current,
      ...patch,
      product: { ...current.product, ...(patch.product || {}) },
      obs: { ...current.obs, ...(patch.obs || {}) },
      platforms: {
        ...current.platforms,
        ...(patch.platforms || {}),
        tiktok: {
          ...current.platforms.tiktok,
          ...(patch.platforms?.tiktok || {}),
          liveStudio: { ...current.platforms.tiktok.liveStudio, ...(patch.platforms?.tiktok?.liveStudio || {}) },
          api: { ...current.platforms.tiktok.api, ...(patch.platforms?.tiktok?.api || {}) }
        },
        twitch: { ...current.platforms.twitch, ...(patch.platforms?.twitch || {}) },
        youtube: { ...current.platforms.youtube, ...(patch.platforms?.youtube || {}) },
        cng: { ...current.platforms.cng, ...(patch.platforms?.cng || {}) },
        custom: { ...current.platforms.custom, ...(patch.platforms?.custom || {}) }
      },
      chat: { ...current.chat, ...(patch.chat || {}) },
      moderation: { ...current.moderation, ...(patch.moderation || {}) },
      overlays: { ...current.overlays, ...(patch.overlays || {}) },
      preferences: { ...current.preferences, ...(patch.preferences || {}) },
      deck: { ...current.deck, ...(patch.deck || {}) }
    });
  }
}

module.exports = { DEFAULT_STATE, SettingsStore, normalizeLocalObsHost, normalizeState };
