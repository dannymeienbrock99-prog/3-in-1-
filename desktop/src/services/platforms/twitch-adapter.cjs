"use strict";

const WebSocket = require("ws");
const { EventEmitter } = require("node:events");

class TwitchAdapter extends EventEmitter {
  constructor() {
    super();
    this.platform = "twitch";
    this.ws = null;
    this.config = {};
    this.connected = false;
    this.connectTimer = null;
  }

  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() {
    return {
      platform: this.platform,
      connected: this.connected,
      configured: Boolean(this.config.channel && this.config.token),
      channel: this.config.channel || ""
    };
  }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  async connect(config = {}) {
    await this.disconnect();
    const channel = String(config.channel || "").trim().replace(/^#/, "").toLowerCase();
    const token = String(config.token || "").trim().replace(/^oauth:/i, "");
    const username = String(config.username || "batto_reader").trim().toLowerCase();
    if (!channel || !token) throw new Error("Twitch benötigt Kanalname und OAuth-Token für den Chat-Reader.");

    this.config = { channel, token, username };
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443", { handshakeTimeout: 10000 });

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.connected = true;
        this.emitStatus();
        resolve(this.status());
      };
      const fail = (error) => {
        const message = String(error?.message || error || "Twitch-Verbindung fehlgeschlagen.");
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.connected = false;
        this.emitStatus({ error: message });
        if (!settled) {
          settled = true;
          reject(new Error(message));
        }
        try { this.ws?.close(); } catch {}
      };

      this.connectTimer = setTimeout(() => fail(new Error("Zeitüberschreitung beim Verbinden mit Twitch Chat.")), 10000);

      this.ws.on("open", () => {
        this.ws.send(`PASS oauth:${token}`);
        this.ws.send(`NICK ${username}`);
        this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        this.ws.send(`JOIN #${channel}`);
      });

      this.ws.on("message", (data) => {
        for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
          if (/^:tmi\.twitch\.tv NOTICE \* :Login authentication failed/i.test(line)) {
            fail(new Error("Twitch OAuth-Token wurde abgelehnt."));
            return;
          }
          if (line.startsWith("PING")) {
            this.ws?.send("PONG :tmi.twitch.tv");
            continue;
          }
          if (new RegExp(`^:${username}!${username}@${username}\\.tmi\\.twitch\\.tv JOIN #${channel}$`, "i").test(line)
              || new RegExp(`^:.* 366 ${username} #${channel} `, "i").test(line)) {
            finish();
            continue;
          }
          this.handleLine(line);
        }
      });

      this.ws.on("error", fail);
      this.ws.on("close", () => {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
        const wasConnected = this.connected;
        this.connected = false;
        this.emitStatus();
        if (!settled) fail(new Error("Twitch hat die Verbindung vor dem Kanalbeitritt geschlossen."));
        else if (wasConnected) this.emit("disconnected");
      });
      this.emitStatus({ connecting: true });
    });
  }

  handleLine(line) {
    if (!line.includes(" PRIVMSG #")) return;
    const tagText = line.startsWith("@") ? line.slice(1, line.indexOf(" ")) : "";
    const tags = Object.fromEntries(tagText.split(";").filter(Boolean).map((part) => {
      const [key, ...rest] = part.split("=");
      return [key, rest.join("=")];
    }));
    const bodyIndex = line.indexOf(" :", line.indexOf(" PRIVMSG "));
    if (bodyIndex < 0) return;
    const message = line.slice(bodyIndex + 2);
    const prefixStart = line.indexOf(" :") + 2;
    const prefixEnd = line.indexOf("!", prefixStart);
    const username = tags["display-name"] || line.slice(prefixStart, prefixEnd > prefixStart ? prefixEnd : bodyIndex);
    const badges = String(tags.badges || "").split(",").filter(Boolean).map((badge) => badge.split("/")[0]);
    this.emit("message", {
      platform: "twitch",
      username,
      userId: tags["user-id"] || "",
      message,
      color: tags.color || "#9146ff",
      badges,
      role: badges.includes("broadcaster") ? "broadcaster" : badges.includes("moderator") ? "moderator" : badges.includes("vip") ? "vip" : "",
      metadata: { channel: this.config.channel, rawTags: tags }
    });
  }

  async disconnect() {
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const socket = this.ws;
    this.ws = null;
    this.connected = false;
    if (socket) {
      try { socket.close(1000, "Batto OBS Tool getrennt"); } catch {}
    }
    this.emitStatus();
    return this.status();
  }
}

module.exports = { TwitchAdapter };
