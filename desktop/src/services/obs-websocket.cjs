"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");

function base64Sha256(value) {
  return crypto.createHash("sha256").update(value).digest("base64");
}

function obsAuthentication(password, salt, challenge) {
  const secret = base64Sha256(`${password}${salt}`);
  return base64Sha256(`${secret}${challenge}`);
}

function stripIpv6Brackets(value) {
  const text = String(value || "").trim();
  return text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
}

function normalizeLocalObsHost(value) {
  const host = stripIpv6Brackets(value).toLowerCase();
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "::1";
  return "127.0.0.1";
}

function formatWebSocketHost(value) {
  const host = stripIpv6Brackets(value) || "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

function normalizePort(value) {
  return Math.max(1, Math.min(65535, Math.round(Number(value) || 4455)));
}

function buildObsWebSocketUrl(host, port) {
  return `ws://${formatWebSocketHost(normalizeLocalObsHost(host))}:${normalizePort(port)}`;
}

class ObsRequestError extends Error {
  constructor(message, requestType, status = {}) {
    super(message);
    this.name = "ObsRequestError";
    this.requestType = requestType;
    this.status = status;
  }
}

class ObsWebSocketClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.identified = false;
    this.pending = new Map();
    this.counter = 0;
    this.connection = null;
    this.lastError = "";
  }

  get connected() {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN && this.identified);
  }

  status() {
    return {
      connected: this.connected,
      host: this.connection?.host || "127.0.0.1",
      port: this.connection?.port || 4455,
      lastError: this.lastError
    };
  }

  async connect({ host = "127.0.0.1", port = 4455, password = "", timeoutMs = 8000 } = {}) {
    const requested = normalizeLocalObsHost(host);
    const candidates = requested === "::1" ? ["::1", "127.0.0.1"] : ["127.0.0.1", "::1"];
    const failures = [];
    for (const candidate of candidates) {
      try {
        return await this.connectSingle({ host: candidate, port, password, timeoutMs });
      } catch (error) {
        failures.push(`${candidate}: ${String(error?.message || error)}`);
      }
    }
    const error = new Error(`OBS WebSocket ist lokal nicht erreichbar. ${failures.join(" · ")}`);
    this.lastError = error.message;
    throw error;
  }

  async connectSingle({ host, port, password, timeoutMs }) {
    await this.disconnect();
    const normalizedHost = normalizeLocalObsHost(host);
    const normalizedPort = normalizePort(port);
    const url = `ws://${formatWebSocketHost(normalizedHost)}:${normalizedPort}`;
    this.connection = { host: normalizedHost, port: normalizedPort };
    this.lastError = "";

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url, {
        handshakeTimeout: timeoutMs,
        maxPayload: 8 * 1024 * 1024
      });
      this.socket = socket;
      const timer = setTimeout(() => {
        fail(new Error("Zeitüberschreitung beim Verbinden mit OBS WebSocket."));
      }, timeoutMs);

      const cleanupInitial = () => {
        clearTimeout(timer);
        socket.off("error", fail);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanupInitial();
        this.lastError = String(error?.message || error);
        this.identified = false;
        try { socket.close(); } catch {}
        reject(error);
      };

      socket.once("error", fail);
      socket.on("message", (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (message.op === 0) {
          const authentication = message.d?.authentication;
          const identify = {
            rpcVersion: 1,
            eventSubscriptions: 0
          };
          if (authentication) {
            if (!password) {
              fail(new Error("OBS verlangt ein WebSocket-Passwort."));
              return;
            }
            identify.authentication = obsAuthentication(
              String(password),
              authentication.salt,
              authentication.challenge
            );
          }
          socket.send(JSON.stringify({ op: 1, d: identify }));
          return;
        }
        if (message.op === 2) {
          if (!settled) {
            settled = true;
            cleanupInitial();
            this.identified = true;
            this.emit("connected", this.status());
            resolve(this.status());
          }
          return;
        }
        if (message.op === 7) {
          const requestId = message.d?.requestId;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.pending.delete(requestId);
          clearTimeout(pending.timer);
          const status = message.d?.requestStatus || {};
          if (status.result) pending.resolve(message.d?.responseData || {});
          else pending.reject(new ObsRequestError(
            status.comment || `${message.d?.requestType || "OBS-Anfrage"} fehlgeschlagen.`,
            message.d?.requestType,
            status
          ));
        }
      });
      socket.on("close", (code, reason) => {
        const wasConnected = this.identified;
        this.identified = false;
        if (this.socket === socket) this.socket = null;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("OBS hat die Verbindung geschlossen."));
        }
        this.pending.clear();
        if (!settled) fail(new Error(`OBS-Verbindung geschlossen (${code}): ${String(reason || "")}`));
        if (wasConnected) this.emit("disconnected", { code, reason: String(reason || "") });
      });
      socket.on("error", (error) => {
        this.lastError = String(error?.message || error);
      });
    });
  }

  async disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.identified = false;
    if (!socket) return;
    await new Promise((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 700);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try { socket.close(1000, "Batto OBS Tool getrennt"); } catch { resolve(); }
    });
  }

  request(requestType, requestData = {}, timeoutMs = 7000) {
    if (!this.connected) return Promise.reject(new Error("OBS ist nicht verbunden."));
    const requestId = `${Date.now()}-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Zeitüberschreitung bei OBS-Anfrage „${requestType}“.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData }
      }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async requestSafe(requestType, requestData = {}) {
    try {
      return await this.request(requestType, requestData);
    } catch (error) {
      return { __error: String(error?.message || error) };
    }
  }

  async profileParameter(parameterCategory, parameterName) {
    return this.requestSafe("GetProfileParameter", { parameterCategory, parameterName });
  }

  async snapshot() {
    if (!this.connected) return { ...this.status(), available: false };
    const [
      version,
      video,
      stats,
      stream,
      record,
      scenes,
      profile,
      streamService,
      outputList,
      outputMode,
      simpleStreamEncoder,
      simpleBitrate,
      simplePreset,
      advancedStreamEncoder,
      advancedRecordEncoder
    ] = await Promise.all([
      this.requestSafe("GetVersion"),
      this.requestSafe("GetVideoSettings"),
      this.requestSafe("GetStats"),
      this.requestSafe("GetStreamStatus"),
      this.requestSafe("GetRecordStatus"),
      this.requestSafe("GetSceneList"),
      this.requestSafe("GetProfileList"),
      this.requestSafe("GetStreamServiceSettings"),
      this.requestSafe("GetOutputList"),
      this.profileParameter("Output", "Mode"),
      this.profileParameter("SimpleOutput", "StreamEncoder"),
      this.profileParameter("SimpleOutput", "VBitrate"),
      this.profileParameter("SimpleOutput", "Preset"),
      this.profileParameter("AdvOut", "Encoder"),
      this.profileParameter("AdvOut", "RecEncoder")
    ]);
    return {
      ...this.status(),
      available: true,
      version,
      video,
      stats,
      stream,
      record,
      scenes,
      profile,
      streamService,
      outputList,
      profileParameters: {
        outputMode,
        simpleStreamEncoder,
        simpleBitrate,
        simplePreset,
        advancedStreamEncoder,
        advancedRecordEncoder
      }
    };
  }

  async execute(action, payload = {}) {
    const mapping = {
      "stream.start": ["StartStream", {}],
      "stream.stop": ["StopStream", {}],
      "record.start": ["StartRecord", {}],
      "record.stop": ["StopRecord", {}],
      "record.pause": ["PauseRecord", {}],
      "record.resume": ["ResumeRecord", {}],
      "virtualcam.start": ["StartVirtualCam", {}],
      "virtualcam.stop": ["StopVirtualCam", {}],
      "replay.start": ["StartReplayBuffer", {}],
      "replay.stop": ["StopReplayBuffer", {}],
      "replay.save": ["SaveReplayBuffer", {}]
    };
    if (action === "scene.set") {
      return this.request("SetCurrentProgramScene", {
        sceneName: String(payload.sceneName || "")
      });
    }
    if (action === "input.mute") {
      return this.request("SetInputMute", {
        inputName: String(payload.inputName || ""),
        inputMuted: Boolean(payload.inputMuted)
      });
    }
    const entry = mapping[action];
    if (!entry) throw new Error(`Unbekannte OBS-Aktion: ${action}`);
    return this.request(entry[0], entry[1]);
  }

  async runRecordingTest(durationSeconds = 15) {
    const duration = Math.max(5, Math.min(60, Math.round(Number(durationSeconds) || 15)));
    if (!this.connected) throw new Error("OBS ist nicht verbunden.");
    const before = await this.request("GetRecordStatus");
    if (before.outputActive) {
      throw new Error("OBS nimmt bereits auf. Der Test wurde nicht gestartet.");
    }
    const stream = await this.requestSafe("GetStreamStatus");
    if (stream.outputActive) {
      throw new Error("Während eines laufenden Streams wird kein automatischer Aufnahmetest gestartet.");
    }
    const samples = [];
    await this.request("StartRecord");
    try {
      for (let second = 0; second < duration; second += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const stats = await this.requestSafe("GetStats");
        const record = await this.requestSafe("GetRecordStatus");
        samples.push({ second: second + 1, stats, record });
      }
    } finally {
      await this.requestSafe("StopRecord");
    }
    const valid = samples.filter((sample) => !sample.stats?.__error);
    const averageCpu = valid.length
      ? valid.reduce((sum, sample) => sum + Number(sample.stats.cpuUsage || 0), 0) / valid.length
      : null;
    const renderMissed = valid.at(-1)?.stats?.renderSkippedFrames ?? null;
    const outputSkipped = valid.at(-1)?.stats?.outputSkippedFrames ?? null;
    return {
      durationSeconds: duration,
      samples,
      summary: {
        averageObsCpuPercent: averageCpu,
        renderSkippedFrames: renderMissed,
        outputSkippedFrames: outputSkipped,
        stable: Number(renderMissed || 0) === 0 && Number(outputSkipped || 0) === 0
      }
    };
  }
}

module.exports = {
  ObsRequestError,
  ObsWebSocketClient,
  buildObsWebSocketUrl,
  formatWebSocketHost,
  normalizeLocalObsHost,
  obsAuthentication,
  stripIpv6Brackets
};
