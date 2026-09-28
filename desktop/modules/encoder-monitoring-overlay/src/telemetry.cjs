"use strict";

const os = require("node:os");

const INTEGRATED_GPU_PATTERNS = Object.freeze([
  /amd\s+radeon\(tm\)\s+graphics/i,
  /amd\s+radeon\s+graphics(?!.*\brx\b)/i,
  /intel\s+(?:uhd|hd|iris)\s+graphics/i,
  /microsoft\s+basic\s+(?:display|render)/i,
  /remote\s+display/i,
  /virtual\s+(?:display|gpu)/i,
  /vmware|virtualbox|hyper-v/i
]);

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function booleanValue(...values) {
  for (const value of values) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
    if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  }
  return false;
}

function isIntegratedGpuName(name) {
  const text = String(name || "").trim();
  return INTEGRATED_GPU_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeGpu(value = {}) {
  const name = firstText(
    value.name,
    value.model,
    value.gpuName,
    value.adapterName,
    value.description
  ) || "Nicht verfügbar";
  const memoryUsedMb = firstNumber(
    value.memoryUsedMb,
    value.vramUsedMb,
    value.memoryUsed,
    value.usedMemoryMb,
    value.vramUsed
  );
  const memoryTotalMb = firstNumber(
    value.memoryTotalMb,
    value.vramTotalMb,
    value.memoryTotal,
    value.totalMemoryMb,
    value.vramTotal
  );
  const integrated = value.integrated === true || isIntegratedGpuName(name);
  return {
    name,
    vendor: firstText(value.vendor, vendorFromName(name)),
    dedicated: value.dedicated === undefined ? !integrated : Boolean(value.dedicated),
    integrated,
    utilizationPercent: firstNumber(
      value.utilizationPercent,
      value.utilization,
      value.gpuUtilization,
      value.loadPercent,
      value.load
    ),
    encoderUtilizationPercent: firstNumber(
      value.encoderUtilizationPercent,
      value.encoderUtilization,
      value.encoder,
      value.nvencUtilization
    ),
    decoderUtilizationPercent: firstNumber(
      value.decoderUtilizationPercent,
      value.decoderUtilization,
      value.decoder
    ),
    temperatureC: firstNumber(value.temperatureC, value.temperature, value.tempC, value.gpuTemperature),
    hotspotTemperatureC: firstNumber(
      value.hotspotTemperatureC,
      value.hotspotTemperature,
      value.hotspot,
      value.junctionTemperatureC
    ),
    graphicsClockMhz: firstNumber(
      value.graphicsClockMhz,
      value.clockMhz,
      value.gpuClockMhz,
      value.coreClockMhz
    ),
    memoryClockMhz: firstNumber(value.memoryClockMhz, value.vramClockMhz, value.memClockMhz),
    memoryUsedMb,
    memoryTotalMb,
    powerWatts: firstNumber(value.powerWatts, value.powerDrawWatts, value.powerDraw, value.watts),
    powerLimitWatts: firstNumber(value.powerLimitWatts, value.powerLimit, value.maxPowerWatts),
    voltageVolts: firstNumber(value.voltageVolts, value.voltage, value.coreVoltage),
    fanRpm: firstNumber(value.fanRpm, value.fanSpeedRpm, value.rpm),
    fanPercent: firstNumber(value.fanPercent, value.fanSpeedPercent, value.fanSpeed),
    source: firstText(value.source, "Nicht angegeben")
  };
}

function vendorFromName(name) {
  const text = String(name || "");
  if (/nvidia|geforce|quadro|rtx|gtx/i.test(text)) return "NVIDIA";
  if (/amd|radeon/i.test(text)) return "AMD";
  if (/intel|arc|iris|uhd/i.test(text)) return "Intel";
  return "";
}

function gpuScore(value = {}) {
  const gpu = normalizeGpu(value);
  let score = 0;
  if (gpu.integrated) score -= 1000;
  if (/nvidia/i.test(gpu.vendor)) score += 420;
  if (/geforce\s+rtx/i.test(gpu.name)) score += 220;
  else if (/geforce\s+gtx/i.test(gpu.name)) score += 150;
  if (/amd/i.test(gpu.vendor) && /radeon\s+(?:rx|pro)/i.test(gpu.name)) score += 390;
  if (/intel/i.test(gpu.vendor) && /\barc\b/i.test(gpu.name)) score += 360;
  if (gpu.dedicated) score += 180;
  if (Number.isFinite(gpu.memoryTotalMb)) score += Math.min(160, gpu.memoryTotalMb / 128);
  if (Number.isFinite(gpu.encoderUtilizationPercent)) score += 15;
  return score;
}

function selectPreferredGpu(values = [], preferredName = "") {
  const source = Array.isArray(values) ? values : [values];
  const normalized = source.filter(Boolean).map(normalizeGpu);
  if (!normalized.length) return normalizeGpu({});

  const preferred = String(preferredName || "").trim().toLowerCase();
  if (preferred) {
    const exact = normalized.find((gpu) => gpu.name.toLowerCase() === preferred);
    if (exact && (!exact.integrated || !normalized.some((gpu) => !gpu.integrated))) return exact;
    const partial = normalized.find((gpu) => gpu.name.toLowerCase().includes(preferred));
    if (partial && (!partial.integrated || !normalized.some((gpu) => !gpu.integrated))) return partial;
  }

  return normalized
    .map((gpu) => ({ gpu, score: gpuScore(gpu) }))
    .sort((left, right) => right.score - left.score)[0].gpu;
}

function normalizeBitrateKbps(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  if (number > 100_000) return number / 1000;
  if (number > 0 && number < 100) return number * 1000;
  return number;
}

function normalizeTimecode(value) {
  const text = String(value ?? "").trim();
  if (/^\d{2,}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) return text.split(".")[0];
  const seconds = finiteNumber(value);
  if (seconds === null || seconds < 0) return "";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function normalizeCpu(value = {}) {
  const perCore = Array.isArray(value.perCorePercent || value.perCore || value.cores)
    ? (value.perCorePercent || value.perCore || value.cores)
      .map((entry) => finiteNumber(typeof entry === "object" ? entry?.usage ?? entry?.value : entry))
      .filter((entry) => entry !== null)
    : [];
  return {
    model: firstText(value.model, value.name, os.cpus()?.[0]?.model, "Nicht verfügbar"),
    utilizationPercent: firstNumber(value.utilizationPercent, value.utilization, value.usagePercent, value.usage),
    perCorePercent: perCore,
    temperatureC: firstNumber(value.temperatureC, value.temperature, value.tempC),
    clockMhz: firstNumber(value.clockMhz, value.currentClockMhz, value.frequencyMhz),
    effectiveClockMhz: firstNumber(value.effectiveClockMhz, value.effectiveClock, value.averageClockMhz),
    powerWatts: firstNumber(value.powerWatts, value.power, value.packagePowerWatts),
    source: firstText(value.source, "Nicht angegeben")
  };
}

function normalizeRam(value = {}) {
  let totalGb = firstNumber(value.totalGb, value.totalMemoryGb);
  let usedGb = firstNumber(value.usedGb, value.usedMemoryGb);
  const totalBytes = firstNumber(value.totalBytes, value.totalMemoryBytes);
  const usedBytes = firstNumber(value.usedBytes, value.usedMemoryBytes);
  if (totalGb === null && totalBytes !== null) totalGb = totalBytes / 1024 ** 3;
  if (usedGb === null && usedBytes !== null) usedGb = usedBytes / 1024 ** 3;
  const percent = firstNumber(value.percent, value.utilizationPercent, value.usagePercent);
  return {
    usedGb,
    totalGb,
    percent: percent !== null
      ? percent
      : Number.isFinite(usedGb) && Number.isFinite(totalGb) && totalGb > 0
        ? usedGb / totalGb * 100
        : null,
    source: firstText(value.source, "Nicht angegeben")
  };
}

function normalizeNetwork(value = {}) {
  const connected = value.connected === undefined
    ? !Boolean(value.disconnected)
    : Boolean(value.connected);
  const latencyMs = firstNumber(value.latencyMs, value.pingMs, value.latency);
  return {
    connected,
    uploadBytesPerSecond: firstNumber(
      value.uploadBytesPerSecond,
      value.uploadBps,
      value.uploadBytes,
      value.currentUploadBytesPerSecond
    ),
    averageUploadBytesPerSecond: firstNumber(
      value.averageUploadBytesPerSecond,
      value.averageUploadBps,
      value.avgUploadBytesPerSecond
    ),
    latencyMs,
    reconnects: firstNumber(value.reconnects, value.reconnectionCount, 0) || 0,
    unstable: value.unstable === undefined
      ? !connected || (latencyMs !== null && latencyMs > 100)
      : Boolean(value.unstable),
    source: firstText(value.source, "Nicht angegeben")
  };
}

function lowestAverage(values, portion = 0.01) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const count = Math.max(1, Math.ceil(sorted.length * portion));
  return sorted.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
}

class TelemetryNormalizer {
  constructor({ historySize = 600 } = {}) {
    this.historySize = Math.max(60, Math.min(3600, Math.round(Number(historySize) || 600)));
    this.fpsSamples = [];
    this.frameHistory = [];
    this.uploadSamples = [];
    this.last = createEmptyTelemetry();
  }

  ingest(input = {}) {
    const timestamp = firstNumber(input.timestamp, input.sampledAt, Date.now()) || Date.now();
    const outputSource = input.output || input.stream || input.obsOutput || {};
    const videoSource = input.video || input.videoSettings || {};
    const frameSource = input.frame || input.frames || {};
    const obsSource = input.obs || input.obsStats || {};
    const systemSource = input.system || {};
    const cpuSource = systemSource.cpu || input.cpu || {};
    const ramSource = systemSource.ram || input.ram || input.memory || {};
    const networkSource = systemSource.network || input.network || {};
    const encoderSource = input.encoder || input.encoderSettings || {};

    const streamActive = booleanValue(
      outputSource.streamActive,
      input.streamActive,
      input.outputActive,
      input.streaming
    );
    const recordActive = booleanValue(
      outputSource.recordActive,
      input.recordActive,
      input.recording
    );
    const outputActive = streamActive || recordActive;
    const preferredGpuName = firstText(
      encoderSource.gpuName,
      encoderSource.adapterName,
      input.activeGpuName,
      input.gpu?.name
    );
    const gpuCandidates = [
      ...(Array.isArray(input.gpus) ? input.gpus : []),
      ...(Array.isArray(systemSource.gpus) ? systemSource.gpus : []),
      ...(input.gpu && !Array.isArray(input.gpu) ? [input.gpu] : []),
      ...(input.hardware?.gpus && Array.isArray(input.hardware.gpus) ? input.hardware.gpus : [])
    ];
    const gpu = selectPreferredGpu(gpuCandidates, preferredGpuName);
    gpu.activeLabel = gpu.name !== "Nicht verfügbar"
      ? `${gpu.name}${gpu.dedicated ? " · dediziert" : " · integriert"}`
      : "Nicht verfügbar";

    const outputFps = firstNumber(
      videoSource.outputFps,
      videoSource.fps,
      input.activeFps,
      input.outputFps,
      input.fps
    );
    const renderFps = firstNumber(videoSource.renderFps, input.renderFps, outputFps);
    const frameTimeMs = firstNumber(
      frameSource.frameTimeMs,
      input.frameTimeMs,
      outputFps && outputFps > 0 ? 1000 / outputFps : null
    );
    if (outputFps !== null && outputFps > 0) {
      this.fpsSamples.push(outputFps);
      trim(this.fpsSamples, this.historySize);
    }
    if (frameTimeMs !== null && frameTimeMs > 0) {
      this.frameHistory.push({ timestamp, value: frameTimeMs });
      trim(this.frameHistory, this.historySize);
    }

    const network = normalizeNetwork(networkSource);
    if (network.uploadBytesPerSecond !== null) {
      this.uploadSamples.push(network.uploadBytesPerSecond);
      trim(this.uploadSamples, this.historySize);
    }
    if (network.averageUploadBytesPerSecond === null && this.uploadSamples.length) {
      network.averageUploadBytesPerSecond = this.uploadSamples.reduce((sum, value) => sum + value, 0) / this.uploadSamples.length;
    }

    const totalFrames = firstNumber(
      outputSource.totalFrames,
      outputSource.outputTotalFrames,
      input.totalFrames,
      0
    ) || 0;
    const renderLagFrames = firstNumber(
      outputSource.renderLagFrames,
      outputSource.renderMissedFrames,
      input.renderLagFrames,
      input.renderMissedFrames,
      0
    ) || 0;
    const encodingLagFrames = firstNumber(
      outputSource.encodingLagFrames,
      outputSource.skippedFrames,
      input.encodingLagFrames,
      input.skippedFrames,
      0
    ) || 0;
    const networkDroppedFrames = firstNumber(
      outputSource.networkDroppedFrames,
      outputSource.droppedFrames,
      input.networkDroppedFrames,
      input.droppedFrames,
      0
    ) || 0;
    const totalDroppedFrames = firstNumber(
      outputSource.totalDroppedFrames,
      input.totalDroppedFrames,
      renderLagFrames + encodingLagFrames + networkDroppedFrames
    ) || 0;
    const renderTotal = firstNumber(outputSource.renderTotalFrames, input.renderTotalFrames, totalFrames) || totalFrames;
    const outputTotal = firstNumber(outputSource.outputTotalFrames, input.outputTotalFrames, totalFrames) || totalFrames;

    const normalized = {
      version: 1,
      timestamp,
      profileName: firstText(input.profileName, input.obsProfileName, "Standard"),
      gpu,
      system: {
        cpu: normalizeCpu(cpuSource),
        ram: normalizeRam(ramSource),
        network
      },
      encoder: {
        label: outputActive ? "Aktiver Encoder" : "Encoder",
        active: outputActive,
        name: firstText(
          encoderSource.name,
          encoderSource.encoderName,
          input.encoderName,
          input.activeEncoder,
          "Nicht verfügbar"
        ).replace(/\bKandidat\b/gi, "").replace(/\s{2,}/g, " ").trim(),
        codec: normalizeCodec(firstText(encoderSource.codec, input.codec, input.encoderCodec)),
        rateControl: firstText(
          encoderSource.rateControl,
          encoderSource.rate_control,
          input.rateControl,
          "Nicht verfügbar"
        ).toUpperCase(),
        preset: firstText(encoderSource.preset, input.encoderPreset, "Nicht verfügbar"),
        profile: firstText(encoderSource.profile, input.encoderProfile, "Nicht verfügbar"),
        keyframeIntervalSeconds: firstNumber(
          encoderSource.keyframeIntervalSeconds,
          encoderSource.keyintSec,
          input.keyframeIntervalSeconds
        ),
        bFrames: firstNumber(encoderSource.bFrames, encoderSource.bframes, input.bFrames)
      },
      video: {
        resolution: normalizeResolution(videoSource, input),
        scaleFilter: firstText(videoSource.scaleFilter, input.scaleFilter, "Nicht verfügbar"),
        outputFps,
        renderFps
      },
      frame: {
        frameTimeMs,
        averageFps: this.fpsSamples.length
          ? this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length
          : null,
        onePercentLowFps: lowestAverage(this.fpsSamples, 0.01),
        history: this.frameHistory.map((entry) => ({ ...entry }))
      },
      output: {
        streamActive,
        recordActive,
        configuredBitrateKbps: normalizeBitrateKbps(
          outputSource.configuredBitrateKbps
          ?? encoderSource.bitrateKbps
          ?? encoderSource.bitrate
          ?? input.configuredBitrateKbps
          ?? input.targetBitrateKbps
        ),
        actualBitrateKbps: normalizeBitrateKbps(
          outputSource.actualBitrateKbps
          ?? outputSource.bitrateKbps
          ?? input.actualBitrateKbps
          ?? input.bitrateKbps
          ?? input.bitrate
        ),
        renderLagFrames,
        renderLagPercent: renderTotal > 0 ? renderLagFrames / renderTotal * 100 : 0,
        encodingLagFrames,
        encodingLagPercent: outputTotal > 0 ? encodingLagFrames / outputTotal * 100 : 0,
        networkDroppedFrames,
        totalDroppedFrames,
        totalDroppedPercent: totalFrames > 0 ? totalDroppedFrames / totalFrames * 100 : 0,
        streamTimecode: normalizeTimecode(
          outputSource.streamTimecode ?? outputSource.streamSeconds ?? input.streamTimecode
        ),
        recordTimecode: normalizeTimecode(
          outputSource.recordTimecode ?? outputSource.recordSeconds ?? input.recordTimecode
        ),
        recordingSizeBytes: firstNumber(
          outputSource.recordingSizeBytes,
          outputSource.recordSizeBytes,
          input.recordingSizeBytes,
          input.recordSizeBytes
        )
      },
      obs: {
        cpuUsagePercent: firstNumber(
          obsSource.cpuUsagePercent,
          obsSource.cpuUsage,
          input.obsCpuUsagePercent,
          input.cpuUsage
        ),
        memoryUsageMb: firstNumber(obsSource.memoryUsageMb, input.obsMemoryUsageMb),
        status: firstText(obsSource.status, outputActive ? "Ausgabe aktiv" : "Bereit")
      }
    };

    if (!normalized.encoder.name) normalized.encoder.name = "Nicht verfügbar";
    this.last = normalized;
    return normalized;
  }
}

function normalizeCodec(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "Nicht verfügbar";
  if (text.includes("av1")) return "AV1";
  if (text.includes("hevc") || text.includes("h265") || text.includes("h.265")) return "HEVC";
  if (text.includes("h264") || text.includes("h.264") || text.includes("avc")) return "H.264";
  return String(value).trim();
}

function normalizeResolution(videoSource = {}, root = {}) {
  const direct = firstText(videoSource.resolution, root.resolution);
  if (direct) return direct;
  const width = firstNumber(
    videoSource.outputWidth,
    videoSource.width,
    root.outputWidth,
    root.width
  );
  const height = firstNumber(
    videoSource.outputHeight,
    videoSource.height,
    root.outputHeight,
    root.height
  );
  return width && height ? `${Math.round(width)} × ${Math.round(height)}` : "Nicht verfügbar";
}

function trim(array, maximum) {
  if (array.length > maximum) array.splice(0, array.length - maximum);
}

function createEmptyTelemetry() {
  return {
    version: 1,
    timestamp: Date.now(),
    profileName: "Standard",
    gpu: normalizeGpu({}),
    system: {
      cpu: normalizeCpu({}),
      ram: normalizeRam({}),
      network: normalizeNetwork({ connected: false })
    },
    encoder: {
      label: "Encoder",
      active: false,
      name: "Nicht verfügbar",
      codec: "Nicht verfügbar",
      rateControl: "Nicht verfügbar",
      preset: "Nicht verfügbar",
      profile: "Nicht verfügbar",
      keyframeIntervalSeconds: null,
      bFrames: null
    },
    video: {
      resolution: "Nicht verfügbar",
      scaleFilter: "Nicht verfügbar",
      outputFps: null,
      renderFps: null
    },
    frame: {
      frameTimeMs: null,
      averageFps: null,
      onePercentLowFps: null,
      history: []
    },
    output: {
      streamActive: false,
      recordActive: false,
      configuredBitrateKbps: null,
      actualBitrateKbps: null,
      renderLagFrames: 0,
      renderLagPercent: 0,
      encodingLagFrames: 0,
      encodingLagPercent: 0,
      networkDroppedFrames: 0,
      totalDroppedFrames: 0,
      totalDroppedPercent: 0,
      streamTimecode: "",
      recordTimecode: "",
      recordingSizeBytes: null
    },
    obs: {
      cpuUsagePercent: null,
      memoryUsageMb: null,
      status: "Nicht verbunden"
    }
  };
}

function createTestTelemetry({ timestamp = Date.now(), active = true } = {}) {
  return {
    timestamp,
    profileName: "Streaming",
    gpus: [
      {
        name: "AMD Radeon(TM) Graphics",
        vendor: "AMD",
        memoryTotalMb: 512,
        utilizationPercent: 2,
        temperatureC: 42
      },
      {
        name: "NVIDIA GeForce RTX 5080",
        vendor: "NVIDIA",
        memoryTotalMb: 16304,
        memoryUsedMb: 5840,
        utilizationPercent: 67,
        encoderUtilizationPercent: 34,
        decoderUtilizationPercent: 4,
        temperatureC: 61,
        hotspotTemperatureC: 74,
        graphicsClockMhz: 2730,
        memoryClockMhz: 14001,
        powerWatts: 284.5,
        powerLimitWatts: 450,
        voltageVolts: 0.985,
        fanRpm: 1320,
        fanPercent: 48,
        source: "nvidia-smi"
      }
    ],
    encoder: {
      name: "NVIDIA NVENC AV1",
      codec: "av1",
      rateControl: "CBR",
      preset: "P6",
      profile: "main",
      keyframeIntervalSeconds: 2,
      bFrames: 2,
      bitrateKbps: 12000,
      gpuName: "NVIDIA GeForce RTX 5080"
    },
    video: {
      outputWidth: 2560,
      outputHeight: 1440,
      outputFps: 60,
      renderFps: 60,
      scaleFilter: "Lanczos"
    },
    output: {
      streamActive: active,
      recordActive: false,
      actualBitrateKbps: 11984,
      configuredBitrateKbps: 12000,
      totalFrames: 360000,
      renderTotalFrames: 360000,
      outputTotalFrames: 360000,
      renderLagFrames: 12,
      encodingLagFrames: 3,
      networkDroppedFrames: 4,
      totalDroppedFrames: 19,
      streamTimecode: "01:40:00",
      recordTimecode: "",
      recordingSizeBytes: 0
    },
    obs: {
      cpuUsagePercent: 5.7,
      status: active ? "Streaming" : "Bereit"
    },
    system: {
      cpu: {
        model: "AMD Ryzen 7 9800X3D 8-Core Processor",
        utilizationPercent: 38,
        perCorePercent: [42, 36, 31, 48, 22, 39, 33, 45, 28, 36, 24, 41, 31, 37, 27, 44],
        temperatureC: 67,
        clockMhz: 4700,
        effectiveClockMhz: 4350,
        powerWatts: 92
      },
      ram: {
        usedGb: 14.7,
        totalGb: 32,
        percent: 45.9
      },
      network: {
        connected: true,
        uploadBytesPerSecond: 1_650_000,
        averageUploadBytesPerSecond: 1_590_000,
        latencyMs: 14,
        reconnects: 0,
        unstable: false
      }
    }
  };
}

module.exports = {
  INTEGRATED_GPU_PATTERNS,
  TelemetryNormalizer,
  createEmptyTelemetry,
  createTestTelemetry,
  gpuScore,
  isIntegratedGpuName,
  lowestAverage,
  normalizeBitrateKbps,
  normalizeCodec,
  normalizeGpu,
  normalizeNetwork,
  normalizeResolution,
  normalizeTimecode,
  selectPreferredGpu
};
