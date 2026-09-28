"use strict";

const { ConnectionManager } = require("./connection-manager.cjs");
const { TikTokLiveStudioService } = require("./tiktok-live-studio.cjs");

class HybridRuntime {
  constructor(options = {}) {
    this.settingsStore = options.settingsStore;
    this.secretStore = options.secretStore;
    this.obs = options.obs;
    this.emit = typeof options.emit === "function" ? options.emit : () => {};
    this.connections = new ConnectionManager();
    this.liveStudio = new TikTokLiveStudioService();
    this.started = false;
    this.liveStudioPoll = null;
    this.lastLiveStudioSignature = "";

    this.connections.register("obs", {
      connect: async () => {
        const state = await this.settingsStore.get();
        const password = await this.secretStore.get("obs-websocket-password");
        const result = await this.obs.connect({ host: state.obs.host, port: state.obs.port, password });
        return { connected: true, host: state.obs.host, port: state.obs.port, result };
      },
      disconnect: () => this.obs.disconnect()
    });

    this.connections.register("tiktokLiveStudio", {
      connect: async () => {
        const status = await this.liveStudio.status();
        return { connected: status.running, ...status };
      }
    });

    for (const name of ["tiktokApi", "twitch", "youtube", "cng"]) {
      this.connections.register(name, {
        connect: async () => ({ connected: false, passive: true, message: "Adapter wird vom jeweiligen Plattformmodul verbunden." })
      });
    }

    this.connections.on("status", (status) => this.emit("connections:status", status));
  }

  async configureFromSettings() {
    const state = await this.settingsStore.get();
    const live = state.platforms?.tiktok?.liveStudio || {};
    this.liveStudio.configure({ executablePath: live.executablePath || "" });

    this.connections.configure("obs", state.obs?.autoConnect !== false, { role: "production-core" });
    this.connections.configure("tiktokLiveStudio", Boolean(state.platforms?.tiktok?.enabled && live.enabled !== false), { role: "tiktok-host" });
    this.connections.configure("tiktokApi", Boolean(state.platforms?.tiktok?.enabled && state.platforms?.tiktok?.api?.enabled !== false), { role: "tiktok-events" });
    this.connections.configure("twitch", Boolean(state.platforms?.twitch?.enabled), { role: "platform" });
    this.connections.configure("youtube", Boolean(state.platforms?.youtube?.enabled), { role: "platform" });
    this.connections.configure("cng", Boolean(state.platforms?.cng?.enabled), { role: "platform" });
    return state;
  }

  liveStudioConnectionState(status) {
    if (status.running) return "connected";
    if (status.installed) return "ready";
    return "unavailable";
  }

  async publishLiveStudioStatus({ force = false } = {}) {
    const state = await this.settingsStore.get();
    const enabled = Boolean(state.platforms?.tiktok?.enabled && state.platforms?.tiktok?.liveStudio?.enabled !== false);
    const status = await this.liveStudio.status();
    const signature = JSON.stringify({ enabled, installed: status.installed, running: status.running, executablePath: status.executablePath });
    if (!force && signature === this.lastLiveStudioSignature) return status;
    this.lastLiveStudioSignature = signature;

    this.emit("connections:status", {
      name: "tiktokLiveStudio",
      state: enabled ? this.liveStudioConnectionState(status) : "disabled",
      enabled,
      updatedAt: Date.now(),
      details: { role: "tiktok-host", ...status }
    });
    return status;
  }

  startLiveStudioPolling() {
    if (this.liveStudioPoll) return;
    const tick = () => {
      void this.publishLiveStudioStatus().catch((error) => {
        this.emit("connections:status", {
          name: "tiktokLiveStudio",
          state: "error",
          enabled: true,
          updatedAt: Date.now(),
          lastError: { message: String(error?.message || error), name: error?.name || "Error", code: error?.code || "" },
          details: { role: "tiktok-host" }
        });
      });
    };
    this.liveStudioPoll = setInterval(tick, 2000);
    this.liveStudioPoll.unref?.();
    tick();
  }

  stopLiveStudioPolling() {
    if (this.liveStudioPoll) clearInterval(this.liveStudioPoll);
    this.liveStudioPoll = null;
    this.lastLiveStudioSignature = "";
  }

  async start() {
    const state = await this.configureFromSettings();
    const live = state.platforms?.tiktok?.liveStudio || {};
    if (state.platforms?.tiktok?.enabled && live.enabled !== false && live.launchWithApp) {
      const status = await this.liveStudio.status();
      if (status.installed && !status.running) {
        await this.liveStudio.launch().catch((error) => {
          this.emit("connections:status", {
            name: "tiktokLiveStudio",
            state: "error",
            enabled: true,
            lastError: { message: String(error?.message || error), name: error?.name || "Error", code: error?.code || "" },
            updatedAt: Date.now(),
            details: { role: "tiktok-host" }
          });
        });
      }
    }
    this.started = true;
    this.startLiveStudioPolling();
    return this.connections.startEnabled();
  }

  async refresh() {
    await this.configureFromSettings();
    const liveStudio = await this.liveStudio.status();
    const statuses = this.connections.statuses();
    statuses.tiktokLiveStudio = {
      ...statuses.tiktokLiveStudio,
      state: liveStudio.running ? "connected" : (liveStudio.installed ? "ready" : "unavailable"),
      details: { ...statuses.tiktokLiveStudio?.details, ...liveStudio }
    };
    return statuses;
  }

  async healthCheck() {
    const state = await this.settingsStore.get();
    const liveStudio = await this.liveStudio.status();
    const obsPasswordConfigured = await this.secretStore.has("obs-websocket-password");
    const eulerKeyConfigured = await this.secretStore.has("tiktok-euler-sign-api-key");
    const twitchTokenConfigured = await this.secretStore.has("twitch-oauth-token");
    const youtubeTokenConfigured = await this.secretStore.has("youtube-oauth-token");

    const checks = {
      settings: { ok: true, label: "Settings Store" },
      obs: {
        ok: Boolean(state.obs?.host && state.obs?.port),
        label: "OBS WebSocket",
        detail: `${state.obs?.host || "127.0.0.1"}:${state.obs?.port || 4455}`,
        passwordConfigured: obsPasswordConfigured
      },
      tiktokLiveStudio: {
        ok: !state.platforms?.tiktok?.enabled || !state.platforms?.tiktok?.liveStudio?.enabled || liveStudio.installed,
        label: "TikTok LIVE Studio",
        detail: liveStudio.installed ? (liveStudio.running ? "läuft" : "installiert") : "nicht gefunden",
        ...liveStudio
      },
      tiktokApi: {
        ok: !state.platforms?.tiktok?.enabled || !state.platforms?.tiktok?.api?.enabled || eulerKeyConfigured || state.platforms?.tiktok?.api?.provider === "connector",
        label: "TikTok LIVE API",
        provider: state.platforms?.tiktok?.api?.provider || "eulerstream",
        signApiKeyConfigured: eulerKeyConfigured
      },
      twitch: {
        ok: !state.platforms?.twitch?.enabled || twitchTokenConfigured,
        label: "Twitch",
        oauthConfigured: twitchTokenConfigured
      },
      youtube: {
        ok: !state.platforms?.youtube?.enabled || youtubeTokenConfigured || Boolean(state.platforms?.youtube?.liveChatId),
        label: "YouTube",
        oauthConfigured: youtubeTokenConfigured
      },
      cng: {
        ok: !state.platforms?.cng?.enabled || Boolean(state.platforms?.cng?.baseUrl),
        label: "CNG"
      }
    };

    return {
      ready: Object.values(checks).every((item) => item.ok),
      checkedAt: Date.now(),
      checks,
      connections: await this.refresh()
    };
  }

  async setSecret(name, value) {
    const allowed = new Set(["tiktok-euler-sign-api-key", "twitch-oauth-token", "youtube-oauth-token"]);
    if (!allowed.has(name)) throw new Error("Dieser Secret-Typ ist nicht erlaubt.");
    const text = String(value || "").trim();
    if (!text) {
      await this.secretStore.delete(name);
      return { configured: false };
    }
    await this.secretStore.set(name, text);
    return { configured: true };
  }

  async secretStatus() {
    return {
      eulerSignApiKey: await this.secretStore.has("tiktok-euler-sign-api-key"),
      twitchOauthToken: await this.secretStore.has("twitch-oauth-token"),
      youtubeOauthToken: await this.secretStore.has("youtube-oauth-token")
    };
  }

  async stop() {
    this.stopLiveStudioPolling();
    const tasks = ["obs", "tiktokLiveStudio", "tiktokApi", "twitch", "youtube", "cng"].map((name) => this.connections.disconnect(name));
    await Promise.allSettled(tasks);
    this.started = false;
  }
}

module.exports = { HybridRuntime };
