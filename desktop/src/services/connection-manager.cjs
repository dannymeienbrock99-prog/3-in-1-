"use strict";

const { EventEmitter } = require("node:events");

function errorPayload(error) {
  return {
    message: String(error?.message || error || "Unbekannter Fehler"),
    name: String(error?.name || "Error"),
    code: String(error?.code || "")
  };
}

class ConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.entries = new Map();
  }

  register(name, adapter) {
    if (!name || !adapter) throw new Error("ConnectionManager.register benötigt Name und Adapter.");
    this.entries.set(name, {
      name,
      adapter,
      state: "idle",
      enabled: false,
      lastError: null,
      updatedAt: Date.now(),
      details: {}
    });
    return this.status(name);
  }

  configure(name, enabled, details = {}) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unbekannte Verbindung: ${name}`);
    entry.enabled = Boolean(enabled);
    entry.details = { ...entry.details, ...details };
    entry.updatedAt = Date.now();
    this.emit("status", this.status(name));
  }

  status(name) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    return {
      name: entry.name,
      state: entry.state,
      enabled: entry.enabled,
      lastError: entry.lastError,
      updatedAt: entry.updatedAt,
      details: { ...entry.details }
    };
  }

  statuses() {
    return Object.fromEntries([...this.entries.keys()].map((name) => [name, this.status(name)]));
  }

  async connect(name, options = {}) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unbekannte Verbindung: ${name}`);
    if (!entry.enabled && !options.force) {
      entry.state = "disabled";
      entry.updatedAt = Date.now();
      return this.status(name);
    }
    entry.state = "connecting";
    entry.lastError = null;
    entry.updatedAt = Date.now();
    this.emit("status", this.status(name));
    try {
      const result = typeof entry.adapter.connect === "function"
        ? await entry.adapter.connect(options)
        : { connected: false, passive: true };
      entry.state = result?.connected === false ? "ready" : "connected";
      entry.details = { ...entry.details, ...(result || {}) };
      entry.updatedAt = Date.now();
      this.emit("status", this.status(name));
      return this.status(name);
    } catch (error) {
      entry.state = "error";
      entry.lastError = errorPayload(error);
      entry.updatedAt = Date.now();
      this.emit("status", this.status(name));
      return this.status(name);
    }
  }

  async disconnect(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unbekannte Verbindung: ${name}`);
    try {
      if (typeof entry.adapter.disconnect === "function") await entry.adapter.disconnect();
      entry.state = entry.enabled ? "ready" : "disabled";
      entry.lastError = null;
    } catch (error) {
      entry.state = "error";
      entry.lastError = errorPayload(error);
    }
    entry.updatedAt = Date.now();
    this.emit("status", this.status(name));
    return this.status(name);
  }

  async startEnabled() {
    const tasks = [];
    for (const [name, entry] of this.entries) {
      if (!entry.enabled) {
        entry.state = "disabled";
        continue;
      }
      tasks.push(this.connect(name));
    }
    await Promise.allSettled(tasks);
    return this.statuses();
  }
}

module.exports = { ConnectionManager, errorPayload };
