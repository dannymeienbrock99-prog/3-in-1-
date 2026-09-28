"use strict";

const { EventEmitter } = require("node:events");
const { normalizeCngConfig } = require("../cng-config.cjs");
const { createCngChatMessage } = require("../cng-chat-model.cjs");

class CngUnifiedAdapter extends EventEmitter {
  constructor({ transportFactory = null } = {}) { super(); this.platform = "cng"; this.transportFactory = transportFactory; this.transport = null; this.config = null; }
  onMessage(callback) { this.on("message", callback); }
  onStatus(callback) { this.on("status", callback); }
  status() { return { platform: this.platform, connected: Boolean(this.transport?.connected), configured: Boolean(this.config?.chat?.url && this.config?.chat?.obsChatToken), creatorId: this.config?.creatorId || "" }; }
  emitStatus(extra = {}) { this.emit("status", { ...this.status(), ...extra }); }

  configure(input) { this.config = normalizeCngConfig(input); this.emitStatus(); return this.config; }

  async connect(input) {
    this.configure(input);
    if (!this.config.chat.enabled) return this.status();
    if (!this.config.chat.url || !this.config.chat.obsChatToken) throw new Error("CNG benötigt die persönliche OBS-Chat-URL inklusive obsChatToken.");
    if (!this.transportFactory) {
      this.emitStatus({ configured: true, connected: false, transport: "not-verified" });
      return this.status();
    }
    this.transport = await this.transportFactory(this.config);
    this.transport.onMessage?.((raw) => this.emit("message", createCngChatMessage(raw)));
    this.transport.onStatus?.((status) => this.emitStatus(status));
    await this.transport.connect?.();
    this.emitStatus();
    return this.status();
  }

  async disconnect() { await this.transport?.disconnect?.(); this.transport = null; this.emitStatus(); return this.status(); }
}

module.exports = { CngUnifiedAdapter };
