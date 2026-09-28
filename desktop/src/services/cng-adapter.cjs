"use strict";

const { normalizeCngConfig, sanitizeForLog } = require("./cng-config.cjs");
const { createCngChatMessage } = require("./cng-chat-model.cjs");

/**
 * CNG integration boundary.
 *
 * The public CNG URLs are accepted as user configuration. The actual realtime
 * transport is intentionally kept behind this adapter because CNG's internal
 * transport is not a documented public API in the project sources we checked.
 */
class CngAdapter {
  constructor({ onMessage, onAlert, onStatus, transportFactory } = {}) {
    this.onMessage = typeof onMessage === "function" ? onMessage : () => {};
    this.onAlert = typeof onAlert === "function" ? onAlert : () => {};
    this.onStatus = typeof onStatus === "function" ? onStatus : () => {};
    this.transportFactory = transportFactory || null;
    this.config = null;
    this.transport = null;
    this.status = "disconnected";
  }

  configure(input) {
    this.config = normalizeCngConfig(input);
    return sanitizeForLog(this.config);
  }

  getStatus() {
    return {
      platform: "cng",
      status: this.status,
      creatorId: this.config?.creatorId || "",
      chatConfigured: Boolean(this.config?.chat?.url && this.config?.chat?.obsChatToken),
      alertsConfigured: Boolean(this.config?.alerts?.url)
    };
  }

  async connect() {
    if (!this.config) throw new Error("CNG ist noch nicht konfiguriert.");
    if (!this.config.enabled) return this.getStatus();
    if (!this.config.chat.enabled) {
      this.status = "alerts-only";
      this.onStatus(this.getStatus());
      return this.getStatus();
    }
    if (!this.config.chat.url || !this.config.chat.obsChatToken) {
      throw new Error("Für den CNG-OBS-Chat muss die persönliche Chat-URL mit obsChatToken hinterlegt sein.");
    }
    if (!this.transportFactory) {
      this.status = "configured";
      this.onStatus(this.getStatus());
      return this.getStatus();
    }

    this.status = "connecting";
    this.onStatus(this.getStatus());
    this.transport = await this.transportFactory({
      chatUrl: this.config.chat.url,
      chatToken: this.config.chat.obsChatToken,
      alertUrl: this.config.alerts.url,
      creatorId: this.config.creatorId,
      onChat: (data) => this.emitChat(data),
      onAlert: (data) => this.emitAlert(data)
    });
    this.status = "connected";
    this.onStatus(this.getStatus());
    return this.getStatus();
  }

  emitChat(data) {
    this.onMessage(createCngChatMessage(data));
  }

  emitAlert(data) {
    this.onAlert({
      platform: "cng",
      creatorId: this.config?.creatorId || "",
      data
    });
  }

  async disconnect() {
    try {
      await this.transport?.close?.();
    } finally {
      this.transport = null;
      this.status = "disconnected";
      this.onStatus(this.getStatus());
    }
  }
}

module.exports = {
  CngAdapter
};
