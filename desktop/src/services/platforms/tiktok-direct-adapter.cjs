"use strict";
const { EventEmitter } = require("node:events");

function isOfflineError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("isn't online")
    || message.includes("is not online")
    || message.includes("user isn't online")
    || message.includes("user is not online")
    || message.includes("live has ended")
    || message.includes("not currently live")
    || message.includes("room not found");
}

class TikTokAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.platform = "tiktok";
    this.client = null;
    this.username = "";
    this.connected = false;
    this.available = false;
    this.offline = false;
    this.connectorFactory = typeof options.connectorFactory === "function" ? options.connectorFactory : null;
  }

  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    return {
      platform: this.platform,
      connected: this.connected,
      configured: Boolean(this.username),
      available: this.available,
      offline: this.offline
    };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }
  emitEvent(eventType, data, text) {
    this.emit("message", {
      platform: "tiktok",
      username: data?.nickname || data?.uniqueId || "TikTok User",
      userId: data?.userId || "",
      message: text,
      color: "#111111",
      badges: data?.userBadges || [],
      role: data?.isModerator ? "moderator" : "",
      metadata: { eventType, raw: data }
    });
  }

  async resolveConnector() {
    if (this.connectorFactory) {
      this.available = true;
      return this.connectorFactory;
    }
    try {
      const module = await import("tiktok-live-connector");
      const Connector = module.TikTokLiveConnection || module.default?.TikTokLiveConnection || module.default;
      if (typeof Connector !== "function") throw new Error("TikTokLiveConnection Export fehlt.");
      this.available = true;
      return Connector;
    } catch (error) {
      this.available = false;
      this.emitStatus({ error: "tiktok-live-connector ist nicht verfügbar." });
      throw new Error(`TikTok LIVE Connector konnte nicht geladen werden: ${String(error?.message || error)}`);
    }
  }

  async connect(config = {}) {
    await this.disconnect();
    this.username = String(config.username || config.uniqueId || "").trim().replace(/^@/, "");
    this.offline = false;
    if (!this.username) throw new Error("TikTok LIVE benötigt den @Username des öffentlichen LIVE-Streams.");

    const Connector = await this.resolveConnector();
    const connectorOptions = { processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: true };
    this.client = new Connector(this.username, connectorOptions);
    if (!this.client || typeof this.client.connect !== "function") {
      this.client = null;
      this.available = false;
      throw new Error("TikTok LIVE Connector wurde geladen, stellt aber keine connect()-Funktion bereit.");
    }

    this.client.on?.("chat", (data) => this.emit("message", {
      platform: "tiktok",
      username: data?.nickname || data?.uniqueId || "TikTok User",
      userId: data?.userId || "",
      message: data?.comment || "",
      color: data?.color || "#111111",
      badges: data?.userBadges || [],
      role: data?.isModerator ? "moderator" : data?.isSubscriber ? "subscriber" : "",
      avatar: data?.profilePictureUrl || "",
      metadata: { ...data, provider: "direct" }
    }));
    this.client.on?.("gift", (data) => this.emitEvent("gift", data, `${data?.nickname || data?.uniqueId || "User"} sendet ${data?.giftName || "ein Geschenk"}${data?.repeatCount ? ` ×${data.repeatCount}` : ""}`));
    this.client.on?.("like", (data) => this.emitEvent("like", data, `${data?.nickname || data?.uniqueId || "User"} hat geliked${data?.likeCount ? ` ×${data.likeCount}` : ""}`));
    this.client.on?.("member", (data) => this.emitEvent("member", data, `${data?.nickname || data?.uniqueId || "User"} ist beigetreten`));
    this.client.on?.("social", (data) => this.emitEvent("social", data, `${data?.nickname || data?.uniqueId || "User"} hat eine soziale Aktion ausgelöst`));
    this.client.on?.("subscribe", (data) => this.emitEvent("subscribe", data, `${data?.nickname || data?.uniqueId || "User"} hat abonniert`));
    this.client.on?.("connected", () => { this.connected = true; this.offline = false; this.emitStatus(); });
    this.client.on?.("disconnected", () => { this.connected = false; this.emitStatus(); });

    try {
      await this.client.connect();
      this.connected = true;
      this.offline = false;
      this.emitStatus();
      return this.status();
    } catch (error) {
      this.connected = false;
      const message = String(error?.message || error || "Unbekannter TikTok-Fehler");
      const offline = isOfflineError(error);
      this.offline = offline;
      try { await this.client?.disconnect?.(); } catch {}
      this.client = null;
      if (offline) {
        const status = this.status();
        this.emitStatus({ state: "offline", info: "TikTok-Account ist aktuell nicht LIVE." });
        return status;
      }
      this.emitStatus({ error: message });
      throw new Error(`TikTok LIVE Verbindung fehlgeschlagen: ${message}`);
    }
  }

  async disconnect() {
    try { await this.client?.disconnect?.(); } catch {}
    this.client = null;
    this.connected = false;
    this.emitStatus();
    return this.status();
  }
}

module.exports = { TikTokAdapter, isOfflineError };
