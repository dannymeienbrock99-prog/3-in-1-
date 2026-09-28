"use strict";

const { EventEmitter } = require("node:events");
const WebSocket = require("ws");
const { TikTokAdapter } = require("./tiktok-direct-adapter.cjs");

function pick(obj, paths, fallback = "") {
  for (const path of paths) {
    let value = obj;
    for (const part of path.split(".")) value = value?.[part];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizeTikFinityPayload(raw) {
  let payload = raw;
  if (Buffer.isBuffer(payload)) payload = payload.toString("utf8");
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || typeof payload !== "object") return null;

  const event = String(payload.event || payload.type || payload.eventType || "").toLowerCase();
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  if (!event || event === "config") return { event, data, message: null };

  const username = String(pick(data, ["nickname", "uniqueId", "user.nickname", "user.uniqueId", "user.name", "displayName", "username"], "TikTok User"));
  const userId = String(pick(data, ["userId", "user.id", "user.secUid", "secUid"], ""));
  const avatar = String(pick(data, ["profilePictureUrl", "user.profilePictureUrl", "user.avatar", "avatar"], ""));
  const moderator = Boolean(pick(data, ["isModerator", "user.isModerator"], false));
  const subscriber = Boolean(pick(data, ["isSubscriber", "user.isSubscriber"], false));
  const base = {
    platform: "tiktok",
    username,
    userId,
    avatar,
    role: moderator ? "moderator" : subscriber ? "subscriber" : "",
    color: "#25f4ee",
    metadata: { provider: "tikfinity", eventType: event, raw: data }
  };

  if (event === "chat" || event === "comment") {
    const text = String(pick(data, ["comment", "text", "message", "content"], ""));
    if (!text) return { event, data, message: null };
    return { event, data, message: { ...base, id: String(pick(data, ["msgId", "id"], "")), message: text } };
  }
  if (event === "gift") {
    const gift = String(pick(data, ["giftName", "gift.name", "gift.extendedName"], "Geschenk"));
    const count = Number(pick(data, ["repeatCount", "gift.repeatCount", "count"], 1)) || 1;
    return { event, data, message: { ...base, message: `${username} sendet ${gift}${count > 1 ? ` ×${count}` : ""}` } };
  }
  if (event === "like") {
    const count = Number(pick(data, ["likeCount", "count"], 0)) || 0;
    return { event, data, message: { ...base, message: `${username} hat geliked${count ? ` ×${count}` : ""}` } };
  }
  if (event === "follow") return { event, data, message: { ...base, message: `${username} folgt jetzt` } };
  if (event === "share") return { event, data, message: { ...base, message: `${username} hat den LIVE geteilt` } };
  if (event === "subscribe") return { event, data, message: { ...base, message: `${username} hat abonniert` } };
  if (event === "member" || event === "join") return { event, data, message: { ...base, message: `${username} ist beigetreten` } };
  return { event, data, message: null };
}

class TikTokHybridAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.platform = "tiktok";
    this.wsFactory = options.wsFactory || ((url) => new WebSocket(url));
    const directOptions = { ...(options.directOptions || {}) };
    if (options.connectorFactory && !directOptions.connectorFactory) directOptions.connectorFactory = options.connectorFactory;
    this.direct = options.directAdapter || new TikTokAdapter(directOptions);
    this.preferInjectedDirect = Boolean(options.connectorFactory && !options.wsFactory && !options.directAdapter);
    this.socket = null;
    this.connected = false;
    this.configured = false;
    this.offline = false;
    this.source = "none";
    this.url = "ws://127.0.0.1:21213/";
    this.lastError = "";
    this.reconnectTimer = null;
    this.config = {};

    this.direct.onMessage((message) => this.emit("message", { ...message, metadata: { ...(message.metadata || {}), provider: "direct" } }));
    this.direct.onStatus((status) => {
      if (this.source === "direct" || status.connected) {
        this.connected = Boolean(status.connected);
        this.offline = Boolean(status.offline);
        this.emitStatus({ direct: status });
      }
    });
  }

  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    return {
      platform: "tiktok",
      connected: this.connected,
      configured: this.configured,
      available: this.source === "tikfinity" ? true : this.direct.status?.().available !== false,
      offline: this.offline,
      source: this.source,
      tikfinityUrl: this.url,
      error: this.lastError
    };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  async connectDirect(config = {}, { fallback = false } = {}) {
    const username = String(config.username || config.uniqueId || "").trim().replace(/^@/, "");
    if (!username) throw new Error("TikTok LIVE benötigt den @Username des öffentlichen LIVE-Streams.");
    this.source = "direct";
    try {
      const status = await this.direct.connect({ username, signApiKey: config.signApiKey });
      this.connected = Boolean(status.connected);
      this.offline = Boolean(status.offline);
      this.lastError = this.offline ? "TikTok ist aktuell nicht LIVE." : "";
      this.emitStatus({ fallback, offline: this.offline });
      return this.status();
    } catch (error) {
      this.connected = false;
      this.offline = false;
      this.lastError = String(error?.message || error);
      this.emitStatus({ fallback, error: this.lastError });
      throw error;
    }
  }

  async connect(config = {}) {
    await this.disconnect();
    this.config = { ...config };
    this.url = String(config.tikfinityUrl || config.wsUrl || "ws://127.0.0.1:21213/").trim() || "ws://127.0.0.1:21213/";
    this.configured = true;
    this.offline = false;
    this.lastError = "";

    if (config.directOnly === true) return this.connectDirect(config);
    if (this.preferInjectedDirect && (config.username || config.uniqueId)) return this.connectDirect(config);

    try {
      await this.connectTikFinity();
      return this.status();
    } catch (error) {
      this.lastError = `TikFinity lokal nicht erreichbar: ${String(error?.message || error)}`;
    }

    const username = String(config.username || config.uniqueId || "").trim().replace(/^@/, "");
    if (config.directFallback !== false && username) {
      try {
        const status = await this.connectDirect(config, { fallback: true });
        if (!status.connected) this.scheduleReconnect();
        return status;
      } catch (error) {
        this.connected = false;
        this.offline = false;
        this.lastError = String(error?.message || error);
      }
    }

    this.source = "none";
    this.emitStatus({ info: "TikFinity starten/verbinden; Batto wartet lokal auf Port 21213." });
    this.scheduleReconnect();
    return this.status();
  }

  connectTikFinity() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try { socket = this.wsFactory(this.url); } catch (error) { reject(error); return; }
      this.socket = socket;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          if (socket.readyState === WebSocket.CONNECTING && typeof socket.terminate === "function") socket.terminate();
          else socket.close?.();
        } catch {}
        reject(new Error("Zeitüberschreitung"));
      }, 1800);
      timeout.unref?.();

      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connected = true;
        this.offline = false;
        this.source = "tikfinity";
        this.lastError = "";
        this.emitStatus({ provider: "TikFinity", local: true });
        resolve(this.status());
      };
      const onError = (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error("WebSocket-Fehler"));
        }
      };
      const onClose = () => {
        clearTimeout(timeout);
        if (this.socket === socket) this.socket = null;
        if (this.source === "tikfinity") {
          this.connected = false;
          this.offline = false;
          this.source = "none";
          this.emitStatus({ info: "TikFinity-Verbindung getrennt." });
          this.scheduleReconnect();
        }
      };
      const onMessage = (eventOrData) => {
        const raw = eventOrData?.data !== undefined ? eventOrData.data : eventOrData;
        const parsed = normalizeTikFinityPayload(raw);
        if (parsed?.message) this.emit("message", parsed.message);
      };

      if (typeof socket.on === "function") {
        socket.on("open", onOpen);
        socket.on("error", onError);
        socket.on("close", onClose);
        socket.on("message", onMessage);
      } else {
        socket.addEventListener?.("open", onOpen);
        socket.addEventListener?.("error", onError);
        socket.addEventListener?.("close", onClose);
        socket.addEventListener?.("message", onMessage);
      }
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer || !this.configured) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.connected || !this.configured) return;
      try { await this.connectTikFinity(); } catch { this.scheduleReconnect(); }
    }, 3000);
    this.reconnectTimer.unref?.();
  }

  async disconnect() {
    this.configured = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;

    if (socket) {
      // Ein CONNECTING-WebSocket darf nicht mit close() beendet werden: ws wirft
      // sonst "WebSocket was closed before the connection was established".
      // Außerdem bleibt immer ein Fehler-Listener aktiv, damit beim Beenden der
      // Anwendung keine ungefangene main-process Exception entsteht.
      try { socket.removeAllListeners?.(); } catch {}
      try { socket.on?.("error", () => {}); } catch {}
      try {
        if (socket.readyState === WebSocket.CONNECTING && typeof socket.terminate === "function") socket.terminate();
        else if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) socket.close?.();
      } catch {}
    }

    try { await this.direct.disconnect(); } catch {}
    this.connected = false;
    this.offline = false;
    this.source = "none";
    this.emitStatus();
    return this.status();
  }
}

module.exports = { TikTokHybridAdapter, normalizeTikFinityPayload };
