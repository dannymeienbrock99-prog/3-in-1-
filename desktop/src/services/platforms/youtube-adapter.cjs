"use strict";

const { EventEmitter } = require("node:events");

function asText(value) {
  return String(value ?? "").trim();
}

function roleFor(author = {}) {
  if (author.isChatOwner) return "broadcaster";
  if (author.isChatModerator) return "moderator";
  if (author.isChatSponsor) return "member";
  return "";
}

class YouTubeAdapter extends EventEmitter {
  constructor() {
    super();
    this.platform = "youtube";
    this.config = {};
    this.connected = false;
    this.pageToken = "";
    this.timer = null;
    this.abortController = null;
    this.running = false;
  }

  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    return {
      platform: this.platform,
      connected: this.connected,
      configured: Boolean((this.config.liveChatId || this.config.videoId) && this.config.accessToken),
      liveChatId: this.config.liveChatId || "",
      videoId: this.config.videoId || "",
      transport: "youtube-data-api"
    };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  async requestJson(url) {
    this.abortController = new AbortController();
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.config.accessToken}`, Accept: "application/json" },
      signal: this.abortController.signal
    });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const message = body?.error?.message || `YouTube API HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return body || {};
  }

  async resolveLiveChatId() {
    if (this.config.liveChatId) return this.config.liveChatId;
    if (!this.config.videoId) throw new Error("YouTube benötigt eine Live-Video-ID oder Live-Chat-ID.");
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", this.config.videoId);
    const data = await this.requestJson(url.toString());
    const liveChatId = asText(data.items?.[0]?.liveStreamingDetails?.activeLiveChatId);
    if (!liveChatId) throw new Error("Für dieses YouTube-Video wurde kein aktiver Live-Chat gefunden.");
    this.config.liveChatId = liveChatId;
    return liveChatId;
  }

  normalizeMessage(item = {}) {
    const snippet = item.snippet || {};
    const author = item.authorDetails || {};
    const displayMessage = asText(snippet.displayMessage);
    return {
      platform: "youtube",
      username: author.displayName || "YouTube User",
      userId: author.channelId || "",
      message: displayMessage || this.describeEvent(snippet),
      color: "#ff0033",
      badges: [author.isChatOwner ? "owner" : "", author.isChatModerator ? "moderator" : "", author.isChatSponsor ? "member" : ""].filter(Boolean),
      role: roleFor(author),
      avatar: author.profileImageUrl || "",
      metadata: {
        eventType: snippet.type || "textMessageEvent",
        publishedAt: snippet.publishedAt || "",
        liveChatId: this.config.liveChatId,
        superChatDetails: snippet.superChatDetails || null,
        superStickerDetails: snippet.superStickerDetails || null,
        membershipGiftingDetails: snippet.membershipGiftingDetails || null,
        giftMembershipReceivedDetails: snippet.giftMembershipReceivedDetails || null
      }
    };
  }

  describeEvent(snippet = {}) {
    if (snippet.superChatDetails) {
      const details = snippet.superChatDetails;
      return `Super Chat ${details.amountDisplayString || ""}${details.userComment ? `: ${details.userComment}` : ""}`.trim();
    }
    if (snippet.superStickerDetails) return `Super Sticker ${snippet.superStickerDetails.amountDisplayString || ""}`.trim();
    if (snippet.newSponsorDetails) return `Neue Kanalmitgliedschaft: ${snippet.newSponsorDetails.memberLevelName || "Mitglied"}`;
    if (snippet.membershipGiftingDetails) return `${snippet.membershipGiftingDetails.giftMembershipsCount || ""} Mitgliedschaft(en) verschenkt`.trim();
    if (snippet.giftMembershipReceivedDetails) return "Geschenkte Mitgliedschaft erhalten";
    return snippet.type || "YouTube LIVE Ereignis";
  }

  async pollOnce() {
    if (!this.running) return;
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", this.config.liveChatId);
    url.searchParams.set("part", "id,snippet,authorDetails");
    url.searchParams.set("maxResults", "200");
    if (this.pageToken) url.searchParams.set("pageToken", this.pageToken);

    try {
      const data = await this.requestJson(url.toString());
      this.pageToken = asText(data.nextPageToken);
      if (!this.connected) {
        this.connected = true;
        this.emitStatus();
      }
      for (const item of data.items || []) this.emit("message", this.normalizeMessage(item));
      const delay = Math.max(1000, Math.min(30000, Number(data.pollingIntervalMillis) || 5000));
      if (this.running) this.timer = setTimeout(() => void this.pollOnce(), delay);
    } catch (error) {
      if (!this.running || error?.name === "AbortError") return;
      this.connected = false;
      this.emitStatus({ error: String(error?.message || error) });
      const retryable = ![400, 401, 403, 404].includes(Number(error?.status));
      if (retryable && this.running) this.timer = setTimeout(() => void this.pollOnce(), 10000);
      else this.running = false;
    }
  }

  async connect(config = {}) {
    await this.disconnect();
    this.config = {
      videoId: asText(config.videoId),
      liveChatId: asText(config.liveChatId),
      accessToken: asText(config.accessToken || config.token)
    };
    if (!this.config.accessToken) throw new Error("YouTube benötigt ein OAuth-Zugriffstoken für den Live-Chat.");
    await this.resolveLiveChatId();
    this.running = true;
    this.pageToken = "";

    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", this.config.liveChatId);
    url.searchParams.set("part", "id,snippet,authorDetails");
    url.searchParams.set("maxResults", "200");
    const data = await this.requestJson(url.toString());
    this.pageToken = asText(data.nextPageToken);
    this.connected = true;
    this.emitStatus();
    for (const item of data.items || []) this.emit("message", this.normalizeMessage(item));
    const delay = Math.max(1000, Math.min(30000, Number(data.pollingIntervalMillis) || 5000));
    this.timer = setTimeout(() => void this.pollOnce(), delay);
    return this.status();
  }

  async disconnect() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    try { this.abortController?.abort(); } catch {}
    this.abortController = null;
    this.connected = false;
    this.pageToken = "";
    this.emitStatus();
    return this.status();
  }
}

module.exports = { YouTubeAdapter, roleFor };
