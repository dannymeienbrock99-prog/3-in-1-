"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");
const { normalizeError } = require("./runtime-utils-v2.cjs");

function normalizeHost(value) {
  let host = String(value || "127.0.0.1").trim();
  host = host.replace(/^wss?:\/\//i, "").replace(/\/.*$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host === "0.0.0.0" || host === "::") return "127.0.0.1";
  const publicIpv4 = /^(?!10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}(?:\.\d{1,3}){3}$/;
  if (publicIpv4.test(host)) return "127.0.0.1";
  if (host.includes(":") && host !== "::1") return "::1";
  return host;
}

function hostForUrl(host) {
  const normalized = normalizeHost(host);
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

function sha256Base64(value) {
  return crypto.createHash("sha256").update(value).digest("base64");
}

function authentication(password, salt, challenge) {
  const secret = sha256Base64(`${password}${salt}`);
  return sha256Base64(`${secret}${challenge}`);
}

class ObsClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.identified = false;
    this.settings = { host: "127.0.0.1", port: 4455 };
    this.pending = new Map();
    this.lastError = null;
    this.hello = null;
    this.eventSubscription = 0x7fffffff;
    this.requestCounter = 0;
  }

  status() {
    return {
      connected: this.connected && this.identified,
      host: this.settings.host,
      port: this.settings.port,
      url: `ws://${hostForUrl(this.settings.host)}:${this.settings.port}`,
      obsWebSocketVersion: this.hello?.d?.obsWebSocketVersion || "",
      rpcVersion: this.hello?.d?.rpcVersion || 1,
      lastError: this.lastError
    };
  }

  async connect({ host = "127.0.0.1", port = 4455, password = "", timeoutMs = 8000 } = {}) {
    await this.disconnect();
    const candidates = [];
    const normalized = normalizeHost(host);
    candidates.push(normalized);
    if (normalized === "127.0.0.1") candidates.push("::1");
    else if (normalized === "::1") candidates.push("127.0.0.1");
    let lastError;
    for (const candidate of [...new Set(candidates)]) {
      try {
        await this.connectSingle({ host: candidate, port, password, timeoutMs });
        return this.status();
      } catch (error) {
        lastError = error;
        await this.disconnect();
      }
    }
    this.lastError = normalizeError(lastError || new Error("OBS-Verbindung fehlgeschlagen"));
    throw lastError || new Error("OBS-Verbindung fehlgeschlagen");
  }

  connectSingle({ host, port, password, timeoutMs }) {
    this.settings = { host: normalizeHost(host), port: Math.max(1, Math.min(65535, Number(port) || 4455)) };
    const url = `ws://${hostForUrl(this.settings.host)}:${this.settings.port}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url, { handshakeTimeout: timeoutMs, perMessageDeflate: false });
      this.socket = socket;
      const timer = setTimeout(() => finish(new Error("Zeitüberschreitung beim Verbinden mit OBS")), timeoutMs);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(this.status());
      };
      socket.on("open", () => { this.connected = true; this.emit("status", this.status()); });
      socket.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString("utf8"));
          this.handleMessage(message, password, finish);
        } catch (error) {
          finish(error);
        }
      });
      socket.on("error", (error) => { this.lastError = normalizeError(error); finish(error); this.emit("status", this.status()); });
      socket.on("close", (code, reason) => {
        const wasIdentified = this.identified;
        this.connected = false; this.identified = false;
        const error = new Error(`OBS hat die Verbindung geschlossen (${code}${reason?.length ? `: ${reason}` : ""})`);
        if (!wasIdentified) finish(error);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.emit("status", this.status());
      });
    });
  }

  handleMessage(message, password, identifyDone) {
    const op = Number(message?.op);
    const data = message?.d || {};
    if (op === 0) {
      this.hello = message;
      const identify = { op: 1, d: { rpcVersion: Math.min(1, Number(data.rpcVersion) || 1), eventSubscriptions: this.eventSubscription } };
      if (data.authentication) {
        if (!password) throw new Error("OBS verlangt ein WebSocket-Passwort");
        identify.d.authentication = authentication(password, data.authentication.salt, data.authentication.challenge);
      }
      this.socket.send(JSON.stringify(identify));
      return;
    }
    if (op === 2) {
      this.identified = true; this.lastError = null;
      identifyDone();
      this.emit("status", this.status());
      return;
    }
    if (op === 5) {
      this.emit("event", { type: data.eventType, intent: data.eventIntent, data: data.eventData || {} });
      return;
    }
    if (op === 7) {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.requestStatus?.result) pending.resolve(data.responseData || {});
      else pending.reject(Object.assign(new Error(data.requestStatus?.comment || `OBS-Anfrage fehlgeschlagen: ${data.requestType}`), { code: data.requestStatus?.code }));
      return;
    }
    if (op === 9) {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      const failure = (data.results || []).find((item) => !item.requestStatus?.result);
      if (failure) pending.reject(new Error(failure.requestStatus?.comment || "OBS-Stapelanfrage fehlgeschlagen"));
      else pending.resolve(data.results || []);
    }
  }

  async disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false; this.identified = false;
    if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
      try { socket.close(1000, "Batto OBS Tool beendet Verbindung"); } catch {}
    }
    for (const pending of this.pending.values()) pending.reject(new Error("OBS-Verbindung getrennt"));
    this.pending.clear();
    this.emit("status", this.status());
  }

  call(requestType, requestData = {}, timeoutMs = 8000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.identified) return Promise.reject(new Error("OBS ist nicht verbunden"));
    const requestId = `batto-${Date.now()}-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`OBS-Anfrage Zeitüberschreitung: ${requestType}`)); }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
    });
  }

  async safeCall(requestType, requestData = {}, fallback = {}) {
    try { return await this.call(requestType, requestData); } catch { return fallback; }
  }

  async snapshot() {
    if (!this.identified) return { ...this.status(), scenes: [], audioSources: [], output: {}, encoder: {}, video: {}, stats: {} };
    const [version, sceneList, currentScene, inputs, video, stats, streamStatus, recordStatus, virtualCamStatus] = await Promise.all([
      this.safeCall("GetVersion"), this.safeCall("GetSceneList", {}, { scenes: [] }), this.safeCall("GetCurrentProgramScene"),
      this.safeCall("GetInputList", {}, { inputs: [] }), this.safeCall("GetVideoSettings"), this.safeCall("GetStats"),
      this.safeCall("GetStreamStatus"), this.safeCall("GetRecordStatus"), this.safeCall("GetVirtualCamStatus")
    ]);
    let encoder = {};
    const streamEncoderId = streamStatus.outputActive ? (await this.safeCall("GetStreamServiceSettings")).streamServiceSettings?.video_encoder : null;
    const outputSettings = await this.safeCall("GetOutputSettings", { outputName: streamStatus.outputName || "adv_stream" });
    if (outputSettings.outputSettings) encoder = { ...outputSettings.outputSettings };
    const profileList = await this.safeCall("GetProfileList");
    const audioSources = (inputs.inputs || []).filter((input) => /audio|wasapi|pulse|alsa|coreaudio/i.test(`${input.inputKind || ""} ${input.unversionedInputKind || ""}`));
    return {
      ...this.status(),
      obsVersion: version.obsVersion,
      obsWebSocketVersion: version.obsWebSocketVersion,
      currentScene: currentScene.currentProgramSceneName || sceneList.currentProgramSceneName,
      scenes: sceneList.scenes || [],
      inputs: inputs.inputs || [],
      audioSources,
      video: {
        baseWidth: video.baseWidth,
        baseHeight: video.baseHeight,
        outputWidth: video.outputWidth,
        outputHeight: video.outputHeight,
        fps: video.fpsNumerator && video.fpsDenominator ? video.fpsNumerator / video.fpsDenominator : null
      },
      stats,
      output: {
        active: Boolean(streamStatus.outputActive || recordStatus.outputActive),
        streamActive: Boolean(streamStatus.outputActive),
        recordActive: Boolean(recordStatus.outputActive),
        virtualCamActive: Boolean(virtualCamStatus.outputActive),
        droppedFrames: streamStatus.outputSkippedFrames,
        totalFrames: streamStatus.outputTotalFrames,
        durationMs: streamStatus.outputDuration,
        bytes: streamStatus.outputBytes,
        outputName: streamStatus.outputName || recordStatus.outputName
      },
      encoder: {
        ...encoder,
        id: streamEncoderId || encoder.encoder || encoder.encoderId || "",
        name: encoder.encoder_name || encoder.encoder || encoder.id || streamEncoderId || "",
        bitrateKbps: encoder.bitrate ?? encoder.video_bitrate,
        rateControl: encoder.rate_control,
        preset: encoder.preset || encoder.preset2,
        profile: encoder.profile,
        codec: encoder.codec || (/av1/i.test(streamEncoderId || "") ? "AV1" : /hevc|h265/i.test(streamEncoderId || "") ? "HEVC" : /264/i.test(streamEncoderId || "") ? "H.264" : "")
      },
      profileName: profileList.currentProfileName,
      profiles: profileList.profiles || []
    };
  }

  async runRecordTest(seconds = 8) {
    const status = await this.call("GetStreamStatus");
    if (status.outputActive) throw new Error("Aufnahmetest wird während eines aktiven Streams nicht gestartet");
    const record = await this.call("GetRecordStatus");
    if (record.outputActive) throw new Error("OBS nimmt bereits auf");
    await this.call("StartRecord");
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(3, Math.min(30, Number(seconds) || 8)) * 1000));
    const stopped = await this.call("StopRecord");
    return { durationMs: Date.now() - started, outputPath: stopped.outputPath || "", status: await this.snapshot() };
  }
}

module.exports = { ObsClient, normalizeHost, hostForUrl };
