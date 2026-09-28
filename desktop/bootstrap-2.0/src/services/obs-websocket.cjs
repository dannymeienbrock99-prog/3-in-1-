"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");
const { isLoopback, safeText } = require("./common.cjs");

function normalizeLocalObsHost(value) {
  const host = String(value || "").trim().replace(/^wss?:\/\//i, "").replace(/^\[|\]$/g, "");
  if (!host || host === "0.0.0.0" || host === "::" || !isLoopback(host)) return "127.0.0.1";
  return host === "localhost" ? "127.0.0.1" : host;
}

function websocketUrl(host, port) {
  const normalized = normalizeLocalObsHost(host);
  const formatted = normalized.includes(":") ? `[${normalized}]` : normalized;
  return `ws://${formatted}:${Math.max(1, Math.min(65535, Number(port) || 4455))}`;
}

function hashBase64(value) {
  return crypto.createHash("sha256").update(value).digest("base64");
}

function authentication(password, salt, challenge) {
  const secret = hashBase64(`${password}${salt}`);
  return hashBase64(`${secret}${challenge}`);
}

function requestError(response) {
  const status = response?.requestStatus || {};
  const error = new Error(status.comment || `OBS-Anfrage fehlgeschlagen (${status.code || "unbekannt"}).`);
  error.code = status.code;
  error.requestType = response?.requestType;
  return error;
}

class ObsWebSocketClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.identified = false;
    this.endpoint = "";
    this.host = "127.0.0.1";
    this.port = 4455;
    this.lastError = null;
    this.password = "";
    this.pending = new Map();
    this.requestCounter = 0;
    this.eventSubscriptions = 0x7fffffff;
    this.version = null;
  }

  status() {
    return {
      connected: this.connected && this.identified,
      host: this.host,
      port: this.port,
      endpoint: this.endpoint,
      version: this.version,
      lastError: this.lastError ? String(this.lastError.message || this.lastError) : ""
    };
  }

  async connect(options = {}) {
    await this.disconnect();
    const requestedHost = normalizeLocalObsHost(options.host || options.address);
    const hosts = [...new Set([requestedHost, "127.0.0.1", "::1"])];
    const port = Math.max(1, Math.min(65535, Number(options.port) || 4455));
    const password = String(options.password || "");
    let lastError = null;
    for (const host of hosts) {
      try {
        await this._connectOne(host, port, password, Number(options.timeoutMs) || 6000);
        return this.status();
      } catch (error) {
        lastError = error;
        await this.disconnect();
      }
    }
    this.lastError = lastError || new Error("OBS konnte lokal nicht erreicht werden.");
    throw this.lastError;
  }

  _connectOne(host, port, password, timeoutMs) {
    return new Promise((resolve, reject) => {
      const endpoint = websocketUrl(host, port);
      const socket = new WebSocket(endpoint, { handshakeTimeout: timeoutMs });
      this.socket = socket;
      this.host = host;
      this.port = port;
      this.endpoint = endpoint;
      this.password = password;
      let finished = false;
      const timer = setTimeout(() => finish(new Error("Zeitüberschreitung beim Verbinden mit OBS.")), timeoutMs);
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      socket.on("open", () => {
        this.connected = true;
      });
      socket.on("message", (data) => {
        try {
          const message = JSON.parse(String(data));
          if (message.op === 0) {
            const hello = message.d || {};
            const identify = {
              rpcVersion: Math.min(1, Number(hello.rpcVersion) || 1),
              eventSubscriptions: this.eventSubscriptions
            };
            if (hello.authentication) {
              if (!password) return finish(new Error("OBS verlangt ein WebSocket-Passwort."));
              identify.authentication = authentication(
                password,
                hello.authentication.salt,
                hello.authentication.challenge
              );
            }
            socket.send(JSON.stringify({ op: 1, d: identify }));
            return;
          }
          if (message.op === 2) {
            this.identified = true;
            this.version = message.d?.negotiatedRpcVersion || 1;
            this.lastError = null;
            this.emit("connected", this.status());
            return finish();
          }
          this._handleMessage(message);
        } catch (error) {
          this.lastError = error;
        }
      });
      socket.on("error", (error) => {
        this.lastError = error;
        if (!this.identified) finish(error);
        this.emit("error-state", error);
      });
      socket.on("close", (code, reason) => {
        const wasConnected = this.identified;
        this.connected = false;
        this.identified = false;
        this.socket = null;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("OBS hat die Verbindung geschlossen."));
        }
        this.pending.clear();
        if (!finished) finish(new Error(`OBS-Verbindung geschlossen (${code}): ${safeText(reason, 200)}`));
        if (wasConnected) this.emit("disconnected", { code, reason: String(reason || "") });
      });
    });
  }

  _handleMessage(message) {
    if (message.op === 5) {
      const event = message.d || {};
      this.emit("event", event);
      this.emit(event.eventType || "event", event.eventData || {});
      return;
    }
    if (message.op !== 7) return;
    const response = message.d || {};
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    if (!response.requestStatus?.result) pending.reject(requestError(response));
    else pending.resolve(response.responseData || {});
  }

  call(requestType, requestData = {}, timeoutMs = 8000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.identified) {
      return Promise.reject(new Error("OBS ist nicht verbunden."));
    }
    const requestId = `batto-${Date.now()}-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS-Anfrage ${requestType} hat zu lange gedauert.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, requestType });
      this.socket.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData: requestData || {} }
      }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async safeCall(type, data = {}, fallback = null) {
    try {
      return await this.call(type, data);
    } catch {
      return fallback;
    }
  }

  async profileParameter(category, name) {
    const result = await this.safeCall("GetProfileParameter", {
      parameterCategory: category,
      parameterName: name
    });
    return result?.parameterValue ?? null;
  }

  async snapshot() {
    if (!this.status().connected) return { available: false, ...this.status() };
    const [version, profiles, scenes, currentScene, inputs, stream, record, stats, video, outputs] = await Promise.all([
      this.safeCall("GetVersion", {}, {}),
      this.safeCall("GetProfileList", {}, {}),
      this.safeCall("GetSceneList", {}, { scenes: [] }),
      this.safeCall("GetCurrentProgramScene", {}, {}),
      this.safeCall("GetInputList", {}, { inputs: [] }),
      this.safeCall("GetStreamStatus", {}, {}),
      this.safeCall("GetRecordStatus", {}, {}),
      this.safeCall("GetStats", {}, {}),
      this.safeCall("GetVideoSettings", {}, {}),
      this.safeCall("GetOutputList", {}, { outputs: [] })
    ]);
    const profileValues = {};
    const queries = [
      ["Output", "Mode"],
      ["AdvOut", "Encoder"],
      ["AdvOut", "RecEncoder"],
      ["AdvOut", "ApplyServiceSettings"],
      ["AdvOut", "Rescale"],
      ["AdvOut", "RescaleRes"],
      ["AdvOut", "TrackIndex"],
      ["SimpleOutput", "StreamEncoder"],
      ["SimpleOutput", "VBitrate"],
      ["SimpleOutput", "ABitrate"],
      ["SimpleOutput", "Preset"],
      ["SimpleOutput", "RecQuality"]
    ];
    await Promise.all(queries.map(async ([category, name]) => {
      const value = await this.profileParameter(category, name);
      if (value !== null) profileValues[`${category}.${name}`] = value;
    }));
    const outputDetails = [];
    for (const output of outputs.outputs || []) {
      const settings = await this.safeCall("GetOutputSettings", { outputName: output.outputName }, {});
      outputDetails.push({ ...output, settings: settings.outputSettings || {} });
    }
    const audioInputs = [];
    for (const input of inputs.inputs || []) {
      const [mute, volume] = await Promise.all([
        this.safeCall("GetInputMute", { inputName: input.inputName }, {}),
        this.safeCall("GetInputVolume", { inputName: input.inputName }, {})
      ]);
      audioInputs.push({
        ...input,
        inputMuted: Boolean(mute.inputMuted),
        inputVolumeMul: Number(volume.inputVolumeMul ?? 1),
        inputVolumeDb: Number(volume.inputVolumeDb ?? 0)
      });
    }
    return {
      available: true,
      connected: true,
      version,
      profiles,
      scenes: scenes.scenes || [],
      currentProgramSceneName: currentScene.currentProgramSceneName || scenes.currentProgramSceneName || "",
      inputs: inputs.inputs || [],
      audioInputs,
      stream,
      record,
      stats,
      video,
      outputs: outputDetails,
      profileValues,
      active: Boolean(stream.outputActive || record.outputActive),
      sampledAt: Date.now(),
      ...this.status()
    };
  }

  async getSceneItems(sceneName) {
    const response = await this.call("GetSceneItemList", { sceneName });
    return response.sceneItems || [];
  }

  setScene(sceneName) {
    return this.call("SetCurrentProgramScene", { sceneName });
  }

  setSceneItemEnabled(sceneName, sceneItemId, sceneItemEnabled) {
    return this.call("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: Boolean(sceneItemEnabled) });
  }

  setInputMute(inputName, inputMuted) {
    return this.call("SetInputMute", { inputName, inputMuted: Boolean(inputMuted) });
  }

  toggleInputMute(inputName) {
    return this.call("ToggleInputMute", { inputName });
  }

  setInputVolume(inputName, inputVolumeMul) {
    return this.call("SetInputVolume", { inputName, inputVolumeMul: Math.max(0, Math.min(20, Number(inputVolumeMul) || 0)) });
  }

  toggleStream() { return this.call("ToggleStream"); }
  toggleRecord() { return this.call("ToggleRecord"); }
  toggleVirtualCam() { return this.call("ToggleVirtualCam"); }
  startStream() { return this.call("StartStream"); }
  stopStream() { return this.call("StopStream"); }
  startRecord() { return this.call("StartRecord"); }
  stopRecord() { return this.call("StopRecord"); }
  pauseRecord() { return this.call("PauseRecord"); }
  resumeRecord() { return this.call("ResumeRecord"); }

  async runRecordTest(seconds = 8) {
    const stream = await this.call("GetStreamStatus");
    if (stream.outputActive) throw new Error("Der OBS-Aufnahmetest wird während eines aktiven Streams nicht gestartet.");
    const before = await this.call("GetRecordStatus");
    if (before.outputActive) throw new Error("OBS nimmt bereits auf. Die laufende Aufnahme wird nicht verändert.");
    await this.call("StartRecord");
    const started = Date.now();
    try {
      await new Promise((resolve) => setTimeout(resolve, Math.max(3000, Math.min(30000, Number(seconds) * 1000))));
      const [record, stats] = await Promise.all([this.call("GetRecordStatus"), this.call("GetStats")]);
      return { startedAt: started, finishedAt: Date.now(), record, stats };
    } finally {
      await this.safeCall("StopRecord", {}, {});
    }
  }

  async disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.identified = false;
    if (!socket) return;
    try { socket.close(1000, "Batto OBS Tool beendet Verbindung"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

module.exports = { ObsWebSocketClient, authentication, normalizeLocalObsHost, websocketUrl };
