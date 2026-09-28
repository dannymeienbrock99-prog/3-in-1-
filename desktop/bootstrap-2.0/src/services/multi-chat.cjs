"use strict";

const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");
const { deepClone, randomId, readJson, safeText, writeJsonAtomic } = require("./common.cjs");

function defaultSettings() {
  return {
    enabledPlatforms: { twitch: true, youtube: true, tiktok: true, tikfinity: true, tiktory: true },
    forwardToOverlay: true,
    twitch: { channel: "", oauth: "", nickname: "" },
    youtube: { apiKey: "", liveChatId: "", pollingSeconds: 5 },
    filters: { blockedWords: [], blockedUsers: [], hideLinks: false, maximumLength: 500 },
    tts: { enabled: false, maximumLength: 240, rate: 0, volume: 100, roles: ["broadcaster", "moderator", "vip", "subscriber", "viewer"] }
  };
}

function normalizeSettings(value = {}) {
  const fallback = defaultSettings();
  return {
    enabledPlatforms: { ...fallback.enabledPlatforms, ...(value.enabledPlatforms || {}) },
    forwardToOverlay: value.forwardToOverlay !== false,
    twitch: { ...fallback.twitch, ...(value.twitch || {}) },
    youtube: { ...fallback.youtube, ...(value.youtube || {}) },
    filters: { ...fallback.filters, ...(value.filters || {}) },
    tts: { ...fallback.tts, ...(value.tts || {}) }
  };
}

function parseIrcTags(line) {
  const tags = {};
  const firstSpace = line.indexOf(" ");
  if (!line.startsWith("@") || firstSpace < 0) return { tags, remainder: line };
  for (const part of line.slice(1, firstSpace).split(";")) {
    const [key, raw = ""] = part.split("=");
    tags[key] = raw.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\").replace(/\\r/g, "\r").replace(/\\n/g, "\n");
  }
  return { tags, remainder: line.slice(firstSpace + 1) };
}

function roleFromTwitchTags(tags) {
  const badges = String(tags.badges || "");
  if (/broadcaster\//.test(badges)) return "broadcaster";
  if (/moderator\//.test(badges) || tags.mod === "1") return "moderator";
  if (/vip\//.test(badges)) return "vip";
  if (/subscriber\//.test(badges) || tags.subscriber === "1") return "subscriber";
  return "viewer";
}

function powershellEncoded(value) { return Buffer.from(value, "utf16le").toString("base64"); }

class MultiChat extends EventEmitter {
  constructor({ settingsFile, overlayServer } = {}) {
    super();
    this.settingsFile = settingsFile;
    this.overlayServer = overlayServer;
    this.settings = normalizeSettings(readJson(settingsFile, null) || {});
    this.messages = [];
    this.twitchSocket = null;
    this.twitchConnected = false;
    this.youtubeTimer = null;
    this.youtubePageToken = "";
    this.youtubeConnected = false;
    this.ttsQueue = [];
    this.ttsRunning = false;
    this.lastError = {};
  }

  snapshot() {
    return {
      settings: deepClone({ ...this.settings, twitch: { ...this.settings.twitch, oauth: this.settings.twitch.oauth ? "••••••••" : "" }, youtube: { ...this.settings.youtube, apiKey: this.settings.youtube.apiKey ? "••••••••" : "" } }),
      messages: deepClone(this.messages.slice(-300)),
      status: {
        twitch: this.twitchConnected,
        youtube: this.youtubeConnected,
        localWebhook: Boolean(this.overlayServer?.status().active),
        lastError: deepClone(this.lastError)
      }
    };
  }

  updateSettings(patch = {}, secrets = {}) {
    this.settings = normalizeSettings({ ...this.settings, ...patch, twitch: { ...this.settings.twitch, ...(patch.twitch || {}) }, youtube: { ...this.settings.youtube, ...(patch.youtube || {}) }, filters: { ...this.settings.filters, ...(patch.filters || {}) }, tts: { ...this.settings.tts, ...(patch.tts || {}) } });
    if (secrets.twitchOauth !== undefined) this.settings.twitch.oauth = String(secrets.twitchOauth || "");
    if (secrets.youtubeApiKey !== undefined) this.settings.youtube.apiKey = String(secrets.youtubeApiKey || "");
    writeJsonAtomic(this.settingsFile, this.settings);
    this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  filter(message) {
    const user = String(message.name || "").toLowerCase();
    if ((this.settings.filters.blockedUsers || []).some((entry) => String(entry).toLowerCase() === user)) return null;
    let text = safeText(message.text, Math.max(1, Number(this.settings.filters.maximumLength) || 500));
    if (!text) return null;
    for (const word of this.settings.filters.blockedWords || []) {
      const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (escaped) text = text.replace(new RegExp(escaped, "gi"), "•••");
    }
    if (this.settings.filters.hideLinks) text = text.replace(/https?:\/\/\S+/gi, "[Link ausgeblendet]");
    return { ...message, text };
  }

  ingest(message = {}) {
    const platform = safeText(message.platform || "local", 40).toLowerCase();
    if (this.settings.enabledPlatforms[platform] === false) return null;
    const normalized = this.filter({
      id: safeText(message.id || randomId("chat"), 180), platform,
      name: safeText(message.name || message.user || "Zuschauer", 120),
      userId: safeText(message.userId || "", 160),
      color: /^#[0-9a-f]{6}$/i.test(String(message.color || "")) ? String(message.color) : "#ffffff",
      role: safeText(message.role || "viewer", 40),
      badges: Array.isArray(message.badges) ? message.badges.map((badge) => safeText(badge, 100)) : [],
      text: safeText(message.text || message.message || "", 5000),
      timestamp: Number(message.timestamp) || Date.now(),
      raw: message.raw && typeof message.raw === "object" ? message.raw : {}
    });
    if (!normalized) return null;
    this.messages.push(normalized);
    if (this.messages.length > 1000) this.messages.splice(0, this.messages.length - 1000);
    if (this.settings.forwardToOverlay) this.overlayServer?.publishEvent({ type: "chat", ...normalized });
    this.enqueueTts(normalized);
    this.emit("message", normalized);
    this.emit("changed", this.snapshot());
    return normalized;
  }

  clear() {
    this.messages = [];
    this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  async connectTwitch(options = {}) {
    this.disconnectTwitch();
    const channel = String(options.channel || this.settings.twitch.channel || "").trim().replace(/^#/, "").toLowerCase();
    if (!channel) throw new Error("Twitch-Kanalname fehlt.");
    const oauth = String(options.oauth || this.settings.twitch.oauth || "").replace(/^oauth:/i, "");
    const nickname = String(options.nickname || this.settings.twitch.nickname || "").trim() || (oauth ? channel : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`);
    this.settings.twitch = { channel, oauth, nickname };
    writeJsonAtomic(this.settingsFile, this.settings);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      this.twitchSocket = socket;
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Twitch-Verbindung hat zu lange gedauert.")), 10000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      socket.on("open", () => {
        socket.send(`PASS ${oauth ? `oauth:${oauth}` : "SCHMOOPIIE"}`);
        socket.send(`NICK ${nickname}`);
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        socket.send(`JOIN #${channel}`);
      });
      socket.on("message", (data) => {
        for (const line of String(data).split("\r\n").filter(Boolean)) {
          if (line.startsWith("PING")) { socket.send(line.replace("PING", "PONG")); continue; }
          if (/ 001 /.test(line) || / JOIN #/.test(line)) { this.twitchConnected = true; this.lastError.twitch = ""; finish(); this.emit("changed", this.snapshot()); }
          this.parseTwitchLine(line);
        }
      });
      socket.on("error", (error) => { this.lastError.twitch = error.message; finish(error); });
      socket.on("close", () => { this.twitchConnected = false; this.twitchSocket = null; this.emit("changed", this.snapshot()); });
    });
    return this.snapshot();
  }

  parseTwitchLine(line) {
    const parsed = parseIrcTags(line);
    const match = parsed.remainder.match(/^:([^!]+)!.* PRIVMSG #[^ ]+ :(.+)$/);
    if (!match) return;
    const tags = parsed.tags;
    const badges = String(tags.badges || "").split(",").filter(Boolean);
    this.ingest({
      id: tags.id || randomId("twitch"), platform: "twitch", name: tags["display-name"] || match[1], userId: tags["user-id"] || "",
      color: tags.color || "#ffffff", role: roleFromTwitchTags(tags), badges, text: match[2], timestamp: Number(tags["tmi-sent-ts"]) || Date.now(), raw: tags
    });
  }

  async sendTwitch(text) {
    if (!this.twitchConnected || !this.twitchSocket || this.twitchSocket.readyState !== WebSocket.OPEN) throw new Error("Twitch ist nicht verbunden.");
    if (!this.settings.twitch.oauth) throw new Error("Zum Senden wird ein Twitch-OAuth-Token benötigt.");
    const message = safeText(text, 500).trim();
    if (!message) throw new Error("Twitch-Nachricht ist leer.");
    this.twitchSocket.send(`PRIVMSG #${this.settings.twitch.channel} :${message}`);
    return { ok: true };
  }

  disconnectTwitch() {
    try { this.twitchSocket?.close(1000, "Batto OBS Tool trennt Twitch"); } catch {}
    this.twitchSocket = null;
    this.twitchConnected = false;
  }

  async connectYouTube(options = {}) {
    this.disconnectYouTube();
    const apiKey = String(options.apiKey || this.settings.youtube.apiKey || "").trim();
    const liveChatId = String(options.liveChatId || this.settings.youtube.liveChatId || "").trim();
    if (!apiKey || !liveChatId) throw new Error("YouTube-API-Schlüssel und Live-Chat-ID werden benötigt.");
    this.settings.youtube = { ...this.settings.youtube, apiKey, liveChatId, pollingSeconds: Math.max(2, Math.min(30, Number(options.pollingSeconds || this.settings.youtube.pollingSeconds) || 5)) };
    writeJsonAtomic(this.settingsFile, this.settings);
    this.youtubeConnected = true;
    await this.pollYouTube();
    return this.snapshot();
  }

  async pollYouTube() {
    if (!this.youtubeConnected) return;
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("part", "snippet,authorDetails");
      url.searchParams.set("liveChatId", this.settings.youtube.liveChatId);
      url.searchParams.set("key", this.settings.youtube.apiKey);
      if (this.youtubePageToken) url.searchParams.set("pageToken", this.youtubePageToken);
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || `YouTube API HTTP ${response.status}`);
      this.youtubePageToken = body.nextPageToken || this.youtubePageToken;
      for (const item of body.items || []) {
        this.ingest({
          id: item.id, platform: "youtube", name: item.authorDetails?.displayName || "YouTube",
          userId: item.authorDetails?.channelId || "", color: "#ff4d57",
          role: item.authorDetails?.isChatOwner ? "broadcaster" : item.authorDetails?.isChatModerator ? "moderator" : item.authorDetails?.isChatSponsor ? "subscriber" : "viewer",
          text: item.snippet?.displayMessage || "", timestamp: Date.parse(item.snippet?.publishedAt) || Date.now(), raw: item
        });
      }
      this.lastError.youtube = "";
      const wait = Math.max(2000, Number(body.pollingIntervalMillis) || this.settings.youtube.pollingSeconds * 1000);
      this.youtubeTimer = setTimeout(() => void this.pollYouTube(), wait);
    } catch (error) {
      this.lastError.youtube = String(error.message || error);
      this.emit("changed", this.snapshot());
      this.youtubeTimer = setTimeout(() => void this.pollYouTube(), 10000);
    }
  }

  disconnectYouTube() {
    clearTimeout(this.youtubeTimer);
    this.youtubeTimer = null;
    this.youtubeConnected = false;
    this.youtubePageToken = "";
  }

  enqueueTts(message) {
    const settings = this.settings.tts;
    if (!settings.enabled || !settings.roles.includes(message.role)) return;
    let value = safeText(message.text, Math.max(20, Number(settings.maximumLength) || 240));
    value = value.replace(/https?:\/\/\S+/gi, "Link").replace(/:[a-z0-9_+-]+:/gi, "");
    if (!value.trim()) return;
    this.ttsQueue.push({ text: `${message.name}: ${value}`, rate: Number(settings.rate) || 0, volume: Number(settings.volume) || 100 });
    if (this.ttsQueue.length > 40) this.ttsQueue.splice(0, this.ttsQueue.length - 40);
    void this.runTtsQueue();
  }

  async runTtsQueue() {
    if (this.ttsRunning) return;
    this.ttsRunning = true;
    try {
      while (this.ttsQueue.length) {
        const item = this.ttsQueue.shift();
        const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=${Math.max(-10, Math.min(10, item.rate))}; $s.Volume=${Math.max(0, Math.min(100, item.volume))}; $s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(item.text, "utf8").toString("base64")}')))`;
        await new Promise((resolve) => {
          const process = childProcess.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", powershellEncoded(script)], { windowsHide: true, stdio: "ignore" });
          process.once("exit", resolve);
          process.once("error", resolve);
        });
      }
    } finally {
      this.ttsRunning = false;
    }
  }

  skipTts() {
    this.ttsQueue.shift();
    return { remaining: this.ttsQueue.length };
  }

  clearTts() {
    this.ttsQueue = [];
    return { remaining: 0 };
  }

  stop() {
    this.disconnectTwitch();
    this.disconnectYouTube();
    this.clearTts();
  }
}

module.exports = { MultiChat, defaultSettings, normalizeSettings, parseIrcTags, roleFromTwitchTags };
