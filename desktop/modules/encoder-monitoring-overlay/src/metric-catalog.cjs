"use strict";

const METRIC_CATALOG = Object.freeze([
  // GPU
  metric("gpu.model", "GPU", "GPU-Modell", "gpu.name", { kind: "text", defaultEnabled: true, width: 310 }),
  metric("gpu.active", "GPU", "Aktive GPU", "gpu.activeLabel", { kind: "text" }),
  metric("gpu.utilization", "GPU", "GPU-Auslastung", "gpu.utilizationPercent", { unit: "%", warning: 90, critical: 98, defaultEnabled: true }),
  metric("gpu.encoder", "GPU", "Encoder-Auslastung", "gpu.encoderUtilizationPercent", { unit: "%", warning: 90, critical: 98, defaultEnabled: true }),
  metric("gpu.decoder", "GPU", "Decoder-Auslastung", "gpu.decoderUtilizationPercent", { unit: "%" }),
  metric("gpu.temperature", "GPU", "GPU-Temperatur", "gpu.temperatureC", { unit: "°C", warning: 78, critical: 86, defaultEnabled: true }),
  metric("gpu.hotspot", "GPU", "GPU-Hotspot", "gpu.hotspotTemperatureC", { unit: "°C", warning: 92, critical: 105 }),
  metric("gpu.clock", "GPU", "GPU-Takt", "gpu.graphicsClockMhz", { unit: "MHz" }),
  metric("gpu.memoryClock", "GPU", "Speichertakt", "gpu.memoryClockMhz", { unit: "MHz" }),
  metric("gpu.vramUsed", "GPU", "VRAM belegt", "gpu.memoryUsedMb", { kind: "megabytes", unit: "MB" }),
  metric("gpu.vramTotal", "GPU", "VRAM gesamt", "gpu.memoryTotalMb", { kind: "megabytes", unit: "MB" }),
  metric("gpu.vramPercent", "GPU", "VRAM-Auslastung", null, { computed: "vramPercent", unit: "%", decimals: 1, warning: 90, critical: 98 }),
  metric("gpu.power", "GPU", "GPU-Leistungsaufnahme", "gpu.powerWatts", { unit: "W", decimals: 1 }),
  metric("gpu.powerLimit", "GPU", "Power-Limit", "gpu.powerLimitWatts", { unit: "W", decimals: 0 }),
  metric("gpu.voltage", "GPU", "GPU-Spannung", "gpu.voltageVolts", { unit: "V", decimals: 3 }),
  metric("gpu.fanRpm", "GPU", "GPU-Lüfter", "gpu.fanRpm", { unit: "RPM", decimals: 0 }),
  metric("gpu.fanPercent", "GPU", "GPU-Lüfter", "gpu.fanPercent", { unit: "%", decimals: 0 }),

  // CPU and RAM
  metric("cpu.model", "CPU und RAM", "CPU-Modell", "system.cpu.model", { kind: "text", width: 310 }),
  metric("cpu.utilization", "CPU und RAM", "CPU-Auslastung", "system.cpu.utilizationPercent", { unit: "%", warning: 85, critical: 96, defaultEnabled: true }),
  metric("cpu.cores", "CPU und RAM", "Auslastung einzelner Kerne", "system.cpu.perCorePercent", { kind: "coreBars", width: 390, height: 132 }),
  metric("cpu.temperature", "CPU und RAM", "CPU-Temperatur", "system.cpu.temperatureC", { unit: "°C", warning: 82, critical: 92 }),
  metric("cpu.clock", "CPU und RAM", "CPU-Takt", "system.cpu.clockMhz", { unit: "MHz" }),
  metric("cpu.effectiveClock", "CPU und RAM", "Effektiver CPU-Takt", "system.cpu.effectiveClockMhz", { unit: "MHz" }),
  metric("cpu.power", "CPU und RAM", "CPU-Leistungsaufnahme", "system.cpu.powerWatts", { unit: "W", decimals: 1 }),
  metric("ram.used", "CPU und RAM", "RAM belegt", "system.ram.usedGb", { unit: "GB", decimals: 1, defaultEnabled: true }),
  metric("ram.total", "CPU und RAM", "RAM gesamt", "system.ram.totalGb", { unit: "GB", decimals: 1 }),
  metric("ram.percent", "CPU und RAM", "RAM-Auslastung", "system.ram.percent", { unit: "%", warning: 85, critical: 95, defaultEnabled: true }),

  // OBS and stream
  metric("obs.encoder", "OBS und Stream", "Aktiver Encoder", "encoder.name", { kind: "text", defaultEnabled: true, width: 300 }),
  metric("obs.codec", "OBS und Stream", "Codec", "encoder.codec", { kind: "text" }),
  metric("obs.rateControl", "OBS und Stream", "Rate Control", "encoder.rateControl", { kind: "text" }),
  metric("obs.preset", "OBS und Stream", "Encoder-Preset", "encoder.preset", { kind: "text" }),
  metric("obs.profile", "OBS und Stream", "Encoder-Profil", "encoder.profile", { kind: "text" }),
  metric("obs.keyframe", "OBS und Stream", "Keyframe-Intervall", "encoder.keyframeIntervalSeconds", { unit: "s", decimals: 0 }),
  metric("obs.bframes", "OBS und Stream", "B-Frames", "encoder.bFrames", { decimals: 0 }),
  metric("obs.configuredBitrate", "OBS und Stream", "Eingestellte Bitrate", "output.configuredBitrateKbps", { kind: "kilobits", unit: "Kbit/s", defaultEnabled: true }),
  metric("obs.actualBitrate", "OBS und Stream", "Tatsächliche Bitrate", "output.actualBitrateKbps", { kind: "kilobits", unit: "Kbit/s", defaultEnabled: true }),
  metric("obs.resolution", "OBS und Stream", "Ausgabeauflösung", "video.resolution", { kind: "text", defaultEnabled: true }),
  metric("obs.scaleFilter", "OBS und Stream", "Skalierungsfilter", "video.scaleFilter", { kind: "text" }),
  metric("obs.outputFps", "OBS und Stream", "Ausgabe-FPS", "video.outputFps", { unit: "FPS", decimals: 1, defaultEnabled: true }),
  metric("obs.renderFps", "OBS und Stream", "Render-FPS", "video.renderFps", { unit: "FPS", decimals: 1 }),
  metric("obs.frameTime", "OBS und Stream", "Framezeit", "frame.frameTimeMs", { unit: "ms", decimals: 2, warning: 20, critical: 33.4, defaultEnabled: true }),
  metric("obs.averageFps", "OBS und Stream", "Durchschnittliche FPS", "frame.averageFps", { unit: "FPS", decimals: 1 }),
  metric("obs.onePercentLow", "OBS und Stream", "1-%-Low-FPS", "frame.onePercentLowFps", { unit: "FPS", decimals: 1, defaultEnabled: true }),
  metric("obs.frametimeChart", "OBS und Stream", "Frametime-Diagramm", "frame.history", { kind: "lineChart", width: 500, height: 210, defaultEnabled: true }),
  metric("obs.renderLagFrames", "OBS und Stream", "Rendering-Lag: verpasste Frames", "output.renderLagFrames", { decimals: 0 }),
  metric("obs.renderLagPercent", "OBS und Stream", "Rendering-Lag", "output.renderLagPercent", { unit: "%", decimals: 2, warning: 1, critical: 5 }),
  metric("obs.encodingLagFrames", "OBS und Stream", "Encoding-Lag: übersprungene Frames", "output.encodingLagFrames", { decimals: 0 }),
  metric("obs.encodingLagPercent", "OBS und Stream", "Encoding-Lag", "output.encodingLagPercent", { unit: "%", decimals: 2, warning: 1, critical: 5 }),
  metric("obs.networkDrops", "OBS und Stream", "Durch Netzwerk verworfene Frames", "output.networkDroppedFrames", { decimals: 0 }),
  metric("obs.totalDrops", "OBS und Stream", "Gesamte Frame-Drops", "output.totalDroppedFrames", { decimals: 0 }),
  metric("obs.totalDropPercent", "OBS und Stream", "Frame-Drops", "output.totalDroppedPercent", { unit: "%", decimals: 2, warning: 1, critical: 5, defaultEnabled: true }),
  metric("obs.cpu", "OBS und Stream", "OBS-CPU-Auslastung", "obs.cpuUsagePercent", { unit: "%", decimals: 1, warning: 25, critical: 50, defaultEnabled: true }),
  metric("obs.streamTime", "OBS und Stream", "Stream-Laufzeit", "output.streamTimecode", { kind: "timecode" }),
  metric("obs.recordTime", "OBS und Stream", "Aufnahme-Laufzeit", "output.recordTimecode", { kind: "timecode" }),
  metric("obs.recordSize", "OBS und Stream", "Aufnahme-Dateigröße", "output.recordingSizeBytes", { kind: "bytes" }),
  metric("obs.streamStatus", "OBS und Stream", "Streamstatus", null, { computed: "streamStatus", kind: "status", defaultEnabled: true }),
  metric("obs.recordStatus", "OBS und Stream", "Aufnahmestatus", null, { computed: "recordStatus", kind: "status" }),

  // Network
  metric("network.upload", "Netzwerk", "Aktuelle Uploadrate", "system.network.uploadBytesPerSecond", { kind: "bitrate", defaultEnabled: true }),
  metric("network.averageUpload", "Netzwerk", "Durchschnittliche Uploadrate", "system.network.averageUploadBytesPerSecond", { kind: "bitrate" }),
  metric("network.latency", "Netzwerk", "Netzwerklatenz", "system.network.latencyMs", { unit: "ms", warning: 80, critical: 150, defaultEnabled: true }),
  metric("network.status", "Netzwerk", "Verbindungsstatus", null, { computed: "networkStatus", kind: "status", defaultEnabled: true }),
  metric("network.reconnects", "Netzwerk", "Neuverbindungen", "system.network.reconnects", { decimals: 0 }),
  metric("network.warning", "Netzwerk", "Netzwerk-Warnung", null, { computed: "networkWarning", kind: "status" })
]);

const METRIC_BY_ID = new Map(METRIC_CATALOG.map((entry) => [entry.id, entry]));

function metric(id, group, label, path, options = {}) {
  return Object.freeze({
    id,
    group,
    label,
    path,
    computed: options.computed || null,
    kind: options.kind || "number",
    unit: options.unit || "",
    decimals: Number.isInteger(options.decimals) ? options.decimals : 0,
    warning: Number.isFinite(options.warning) ? options.warning : null,
    critical: Number.isFinite(options.critical) ? options.critical : null,
    defaultEnabled: Boolean(options.defaultEnabled),
    defaultWidth: Number(options.width) || (options.kind === "text" ? 270 : 190),
    defaultHeight: Number(options.height) || 92
  });
}

function getByPath(value, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => current == null ? undefined : current[key], value);
}

function computedValue(metricDefinition, telemetry) {
  switch (metricDefinition.computed) {
    case "vramPercent": {
      const used = Number(telemetry?.gpu?.memoryUsedMb);
      const total = Number(telemetry?.gpu?.memoryTotalMb);
      return Number.isFinite(used) && Number.isFinite(total) && total > 0
        ? used / total * 100
        : null;
    }
    case "streamStatus":
      return telemetry?.output?.streamActive ? "LIVE" : "Nicht aktiv";
    case "recordStatus":
      return telemetry?.output?.recordActive ? "AUFNAHME" : "Nicht aktiv";
    case "networkStatus":
      return telemetry?.system?.network?.connected ? "Verbunden" : "Getrennt";
    case "networkWarning":
      return telemetry?.system?.network?.unstable ? "Verbindung instabil" : "Verbindung stabil";
    default:
      return undefined;
  }
}

function resolveMetricValue(metricId, telemetry = {}) {
  const definition = METRIC_BY_ID.get(metricId);
  if (!definition) {
    return { available: false, raw: null, text: "Nicht verfügbar", definition: null };
  }
  const raw = definition.computed
    ? computedValue(definition, telemetry)
    : getByPath(telemetry, definition.path);
  const formatted = formatMetricValue(definition, raw);
  return { ...formatted, definition };
}

function formatMetricValue(definition, raw) {
  if (definition.kind === "lineChart") {
    const history = Array.isArray(raw) ? raw.filter((entry) => Number.isFinite(Number(entry?.value))) : [];
    return {
      available: history.length > 0,
      raw: history,
      text: history.length ? `${history.length} Messpunkte` : "Noch keine Messpunkte"
    };
  }

  if (definition.kind === "coreBars") {
    const values = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : [];
    return {
      available: values.length > 0,
      raw: values,
      text: values.length
        ? values.map((value, index) => `C${index + 1} ${value.toFixed(0)}%`).join(" · ")
        : "Nicht verfügbar"
    };
  }

  if (["text", "status", "timecode"].includes(definition.kind)) {
    const text = String(raw ?? "").trim();
    return {
      available: Boolean(text),
      raw: text || null,
      text: text || "Nicht verfügbar"
    };
  }

  if (definition.kind === "bytes") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return unavailable();
    return { available: true, raw: value, text: formatBytes(value) };
  }

  if (definition.kind === "bitrate") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return unavailable();
    const mbps = value * 8 / 1_000_000;
    return { available: true, raw: mbps, text: `${mbps.toFixed(2)} Mbit/s` };
  }

  if (definition.kind === "kilobits") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return unavailable();
    return {
      available: true,
      raw: value,
      text: `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })} Kbit/s`
    };
  }

  if (definition.kind === "megabytes") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return unavailable();
    if (value >= 1024) {
      return { available: true, raw: value, text: `${(value / 1024).toFixed(2)} GB` };
    }
    return { available: true, raw: value, text: `${value.toFixed(0)} MB` };
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) return unavailable();
  const decimals = Math.max(0, Math.min(4, Number(definition.decimals) || 0));
  const numberText = value.toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return {
    available: true,
    raw: value,
    text: `${numberText}${definition.unit ? ` ${definition.unit}` : ""}`
  };
}

function unavailable() {
  return { available: false, raw: null, text: "Nicht verfügbar" };
}

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = Math.max(0, Number(value) || 0);
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(unitIndex < 2 ? 0 : 2)} ${units[unitIndex]}`;
}

function catalogForClient() {
  return METRIC_CATALOG.map((entry) => ({ ...entry }));
}

module.exports = {
  METRIC_BY_ID,
  METRIC_CATALOG,
  catalogForClient,
  formatBytes,
  formatMetricValue,
  getByPath,
  resolveMetricValue
};
