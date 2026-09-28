"use strict";

const { EventEmitter } = require("node:events");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const WebSocket = require("ws");
const { clone, normalizeError } = require("./runtime-utils-v2.cjs");

const execFileAsync = promisify(execFile);

function normalizeChannel(value) {
  return String(value || "").trim().replace(/^#/, "").toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function parseTags(input) {
  const result = {};
  for (const part of String(input || "").split(";")) {
    const [key, ...rest] = part.split("=");
    result[key] = rest.join("=").replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return result;
}

function parseIrcLine(line) {
  let rest = line;
  let tags = {};
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }
  const trailingIndex = rest.indexOf(" :");
  const trailing = trailingIndex >= 0 ? rest.slice(trailingIndex + 2) : "";
  const commandPart = trailingIndex >= 0 ? rest.slice(0, trailingIndex) : rest;
  const [command, ...params] = commandPart.split(" ").filter(Boolean);
  return { tags, prefix, command, params, trailing };
}

function rolesFromTags(tags) {
  const badges = String(tags.badges || "").split(",");
  const has = (name) => badges.some((entry) => entry.startsWith(`${name}/`));
  return {
    broadcaster: has("broadcaster"),
    moderator: has("moderator") || tags.mod === "1",
    vip: has("vip"),
    subscriber: has("subscriber") || tags.subscriber === "1"
  };
}

function normalizeMessage(value = {}) {
  return {
    id: String(value.id || value.messageId || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    platform: String(value.platform || "local").toLowerCase(),
    userId: String(value.userId || ""),
    username: String(value.username || value.login || value.user || "").slice(0, 100),
    displayName: String(value.displayName || value.name || value.username || value.user || "Zuschauer").slice(0, 160),
    color: String(value.color || "#ffffff").slice(0, 30),
    text: String(value.text || value.message || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 5000),
    roles: value.roles && typeof value.roles === "object" ? clone(value.roles) : {},
    badges: Array.isArray(value.badges) ? clone(value.badges) : [],
    timestamp: value.timestamp || new Date().toISOString(),
    raw: value.raw && typeof value.raw === "object" ? clone(value.raw) : undefined
  };
}

class MultiChat extends EventEmitter {
  constructor({ settings = {}, overlay, maximumMessages = 500 } = {}) {
    super();
    this.overlay = overlay;
    this.maximumMessages = maximumMessages;
    this.messages = [];
    this.settings = {
      platforms: { twitch: true, youtube: true, tiktok: true, tikfinity: true, tiktory: true, ...(settings.platforms || {}) },
      forwardToOverlay: settings.forwardToOverlay !== false,
      tts: { enabled: false, maximumLength: 300, roles: {}, ...(settings.tts || {}) },
      twitch: { channel: settings.twitch?.channel || "" },
      youtube: { liveChatId: settings.youtube?.liveChatId || "" }
    };
    this.secrets = { twitchOAuth: "", youtubeApiKey: "" };
    this.twitch = { socket: null, connected: false, error: null, channel: "" };
    this.youtube = { connected: false, error: null, liveChatId: "", timer: null, pageToken: "", seen: new Set() };
    this.ttsQueue = [];
    this.ttsBusy = false;
    this.ttsAbort = false;
  }

  snapshot() {
    return {
      settings: clone(this.settings),
      twitch: { connected: this.twitch.connected, channel: this.twitch.channel, error: this.twitch.error },
      youtube: { connected: this.youtube.connected, liveChatId: this.youtube.liveChatId, error: this.youtube.error },
      messages: clone(this.messages.slice(-300)),
      localIngestUrl: this.overlay?.status?.().chatIngestUrl || ""
    };
  }

  updateSettings(value = {}) {
    if (value.platforms && typeof value.platforms === "object") this.settings.platforms = { ...this.settings.platforms, ...value.platforms };
    if (value.forwardToOverlay !== undefined) this.settings.forwardToOverlay = Boolean(value.forwardToOverlay);
    if (value.tts && typeof value.tts === "object") this.settings.tts = { ...this.settings.tts, ...value.tts };
    if (value.twitch?.channel !== undefined) this.settings.twitch.channel = normalizeChannel(value.twitch.channel);
    if (value.youtube?.liveChatId !== undefined) this.settings.youtube.liveChatId = String(value.youtube.liveChatId || "").trim();
    this.emit("status", this.snapshot());
    return clone(this.settings);
  }

  ingest(value = {}) {
    const message = normalizeMessage(value);
    if (!message.text) return null;
    const platformKey = message.platform.toLowerCase();
    if (this.settings.platforms[platformKey] === false) return null;
    this.messages.push(message);
    if (this.messages.length > this.maximumMessages) this.messages.splice(0, this.messages.length - this.maximumMessages);
    if (this.settings.forwardToOverlay) this.overlay?.emitEvent?.({ type: "chat", ...message });
    this.emit("message", clone(message));
    this.emit("status", this.snapshot());
    if (this.settings.tts.enabled) this.enqueueTts(message);
    return message;
  }

  clear() {
    this.messages = [];
    this.overlay?.emitEvent?.({ type: "clearChat" });
    this.emit("status", this.snapshot());
    return this.snapshot();
  }

  async connectTwitch({ channel, oauthToken = "" } = {}) {
    await this.disconnectTwitch();
    const target = normalizeChannel(channel || this.settings.twitch.channel);
    if (!target) throw new Error("Twitch-Kanal fehlt");
    this.settings.twitch.channel = target;
    this.secrets.twitchOAuth = String(oauthToken || "").trim().replace(/^oauth:/i, "");
    const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443", { perMessageDeflate: false, handshakeTimeout: 10_000 });
    this.twitch.socket = socket; this.twitch.channel = target; this.twitch.error = null;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Zeitüberschreitung beim Verbinden mit Twitch")), 12_000);
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      socket.on("open", () => {
        const nick = this.secrets.twitchOAuth ? `justinfan${Math.floor(Math.random() * 90000 + 10000)}` : `justinfan${Math.floor(Math.random() * 90000 + 10000)}`;
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        socket.send(`PASS ${this.secrets.twitchOAuth ? `oauth:${this.secrets.twitchOAuth}` : "SCHMOOPIIE"}`);
        socket.send(`NICK ${nick}`);
        socket.send(`JOIN #${target}`);
      });
      socket.on("message", (raw) => {
        const lines = raw.toString("utf8").split("\r\n").filter(Boolean);
        for (const line of lines) {
          if (line.startsWith("PING")) { socket.send(line.replace("PING", "PONG")); continue; }
          const parsed = parseIrcLine(line);
          if (parsed.command === "001" || parsed.command === "JOIN" || parsed.command === "366") {
            this.twitch.connected = true; finish(); this.emit("status", this.snapshot());
          }
          if (parsed.command === "PRIVMSG") {
            this.ingest({
              id: parsed.tags.id,
              platform: "twitch",
              userId: parsed.tags["user-id"],
              username: parsed.prefix.split("!")[0],
              displayName: parsed.tags["display-name"] || parsed.prefix.split("!")[0],
              color: parsed.tags.color || "#ffffff",
              text: parsed.trailing,
              roles: rolesFromTags(parsed.tags),
              badges: String(parsed.tags.badges || "").split(",").filter(Boolean),
              raw: parsed.tags
            });
          }
          if (parsed.command === "CLEARCHAT") this.overlay?.emitEvent?.({ type: "clearChat", user: parsed.trailing });
          if (parsed.command === "CLEARMSG") this.overlay?.emitEvent?.({ type: "deleteChat", id: parsed.tags["target-msg-id"] });
          if (parsed.command === "NOTICE" && /authentication failed|improperly formatted auth/i.test(parsed.trailing)) finish(new Error("Twitch-Anmeldung fehlgeschlagen"));
        }
      });
      socket.on("error", (error) => { this.twitch.error = normalizeError(error); finish(error); this.emit("status", this.snapshot()); });
      socket.on("close", () => { this.twitch.connected = false; this.twitch.socket = null; this.emit("status", this.snapshot()); });
    });
    return this.snapshot();
  }

  async disconnectTwitch() {
    const socket = this.twitch.socket;
    this.twitch.socket = null; this.twitch.connected = false;
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) try { socket.close(1000, "Trennen"); } catch {}
    this.emit("status", this.snapshot());
    return this.snapshot();
  }

  async sendMessage(text, platform = "twitch") {
    const message = String(text || "").trim().slice(0, 500);
    if (!message) throw new Error("Nachricht fehlt");
    if (platform === "twitch") {
      if (!this.twitch.connected || this.twitch.socket?.readyState !== WebSocket.OPEN) throw new Error("Twitch ist nicht verbunden");
      if (!this.secrets.twitchOAuth) throw new Error("Zum Senden wird ein Twitch-OAuth-Token benötigt");
      this.twitch.socket.send(`PRIVMSG #${this.twitch.channel} :${message}`);
      return { platform, sent: true };
    }
    if (platform === "youtube") throw new Error("YouTube-Senden benötigt OAuth und ist in diesem lokalen API-Schlüssel-Modus nicht aktiv");
    return this.ingest({ platform, displayName: "Batto OBS Tool", text: message, roles: { broadcaster: true } });
  }

  async connectYouTube({ apiKey, liveChatId } = {}) {
    this.disconnectYouTube();
    const key = String(apiKey || "").trim();
    const chatId = String(liveChatId || this.settings.youtube.liveChatId || "").trim();
    if (!key || !chatId) throw new Error("YouTube-API-Schlüssel und Live-Chat-ID werden benötigt");
    this.secrets.youtubeApiKey = key;
    this.settings.youtube.liveChatId = chatId;
    this.youtube.liveChatId = chatId;
    this.youtube.connected = true; this.youtube.error = null; this.youtube.pageToken = ""; this.youtube.seen.clear();
    await this.refreshYouTube();
    return this.snapshot();
  }

  disconnectYouTube() {
    clearTimeout(this.youtube.timer); this.youtube.timer = null;
    this.youtube.connected = false; this.youtube.pageToken = "";
    this.emit("status", this.snapshot());
    return this.snapshot();
  }

  async refreshYouTube() {
    if (!this.youtube.connected) throw new Error("YouTube ist nicht verbunden");
    clearTimeout(this.youtube.timer);
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", this.youtube.liveChatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("maxResults", "200");
    url.searchParams.set("key", this.secrets.youtubeApiKey);
    if (this.youtube.pageToken) url.searchParams.set("pageToken", this.youtube.pageToken);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || `YouTube API ${response.status}`);
      for (const item of body.items || []) {
        if (this.youtube.seen.has(item.id)) continue;
        this.youtube.seen.add(item.id);
        const snippet = item.snippet || {}; const author = item.authorDetails || {};
        this.ingest({
          id: item.id, platform: "youtube", userId: author.channelId, username: author.channelId,
          displayName: author.displayName || "YouTube-Zuschauer", text: snippet.displayMessage || "",
          color: author.isChatModerator ? "#5ad66f" : author.isChatOwner ? "#ff5a67" : "#ffffff",
          roles: { broadcaster: Boolean(author.isChatOwner), moderator: Boolean(author.isChatModerator), subscriber: Boolean(author.isChatSponsor) },
          timestamp: snippet.publishedAt
        });
      }
      this.youtube.pageToken = body.nextPageToken || this.youtube.pageToken;
      const interval = Math.max(1000, Math.min(30000, Number(body.pollingIntervalMillis) || 5000));
      this.youtube.timer = setTimeout(() => this.refreshYouTube().catch(() => {}), interval);
      this.youtube.error = null;
    } catch (error) {
      this.youtube.error = normalizeError(error);
      this.youtube.timer = setTimeout(() => this.refreshYouTube().catch(() => {}), 15000);
      throw error;
    } finally { this.emit("status", this.snapshot()); }
    return this.snapshot();
  }

  enqueueTts(message) {
    const roles = message.roles || {};
    const roleRules = this.settings.tts.roles || {};
    const role = roles.broadcaster ? "broadcaster" : roles.moderator ? "moderator" : roles.vip ? "vip" : roles.subscriber ? "subscriber" : "viewer";
    if (roleRules[role] === false) return;
    const text = String(message.text || "").replace(/https?:\/\/\S+/gi, " Link ").slice(0, Number(this.settings.tts.maximumLength) || 300);
    if (!text.trim()) return;
    this.ttsQueue.push(`${message.displayName}: ${text}`);
    this.processTts().catch(() => {});
  }

  async speak(text) {
    this.ttsQueue.push(String(text || "").slice(0, 1000));
    await this.processTts();
    return { queued: true };
  }

  async processTts() {
    if (this.ttsBusy) return;
    this.ttsBusy = true; this.ttsAbort = false;
    try {
      while (this.ttsQueue.length && !this.ttsAbort) {
        const text = this.ttsQueue.shift();
        const script = `Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.Volume=100;$s.Rate=0;$s.Speak('${String(text).replace(/'/g, "''")}')`;
        await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 120000 });
      }
    } finally { this.ttsBusy = false; }
  }

  ttsCommand(command) {
    if (command === "skip") this.ttsAbort = true;
    if (command === "clear") { this.ttsQueue = []; this.ttsAbort = true; }
    return { queueLength: this.ttsQueue.length, busy: this.ttsBusy };
  }

  async close() {
    await this.disconnectTwitch(); this.disconnectYouTube(); this.ttsQueue = []; this.ttsAbort = true;
  }
}

module.exports = { MultiChat, normalizeMessage, parseIrcLine };
