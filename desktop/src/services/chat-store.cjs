"use strict";

class ChatStore {
  constructor({ maxMessages = 500 } = {}) {
    this.maxMessages = Math.max(50, Math.min(2000, Number(maxMessages) || 500));
    this.messages = [];
    this.sequence = 0;
  }

  add(message) {
    const normalized = { ...message, id: message?.id || `batto-chat-${Date.now()}-${++this.sequence}` };
    this.messages.push(normalized);
    if (this.messages.length > this.maxMessages) {
      this.messages.splice(0, this.messages.length - this.maxMessages);
    }
    return normalized;
  }

  addMany(messages) {
    return (Array.isArray(messages) ? messages : []).map((message) => this.add(message));
  }

  list({ platform = "all", limit = 100 } = {}) {
    const cap = Math.max(1, Math.min(this.maxMessages, Number(limit) || 100));
    const filtered = platform === "all" ? this.messages : this.messages.filter((item) => item.platform === platform);
    return filtered.slice(-cap);
  }

  clear(platform = "all") {
    if (platform === "all") this.messages = [];
    else this.messages = this.messages.filter((item) => item.platform !== platform);
  }

  size() { return this.messages.length; }
}

module.exports = { ChatStore };
