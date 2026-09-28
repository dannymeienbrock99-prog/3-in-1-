"use strict";

const { METRIC_CATALOG, METRIC_BY_ID } = require("./metric-catalog.cjs");

const PRESET_NAMES = Object.freeze(["compact", "horizontal", "vertical", "3dmark", "afterburner"]);
const DEFAULT_FONT = "Inter, Segoe UI, sans-serif";
const DEFAULT_COLORS = Object.freeze({
  font: "#f4f8fb",
  background: "#0a1018",
  border: "#33495c",
  accent: "#55d6ff"
});

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function integer(value, minimum, maximum, fallback) {
  return Math.round(boundedNumber(value, minimum, maximum, fallback));
}

function safeColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function safeText(value, fallback, maximum = 160) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, maximum);
}

function normalizeProfileName(value) {
  return safeText(value, "Standard", 120)
    .replace(/[\u0000-\u001f]/g, "")
    .trim() || "Standard";
}

function defaultCard(metricDefinition, index, overlayWidth = 1920, overlayHeight = 1080) {
  const gap = 12;
  const margin = 18;
  const width = metricDefinition.defaultWidth;
  const height = metricDefinition.defaultHeight;
  const columns = Math.max(1, Math.floor((overlayWidth - margin * 2 + gap) / (width + gap)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return normalizeCard({
    id: metricDefinition.id,
    enabled: metricDefinition.defaultEnabled,
    x: margin + column * (width + gap),
    y: margin + row * (height + gap),
    width,
    height,
    fontFamily: DEFAULT_FONT,
    fontSize: metricDefinition.kind === "text" ? 22 : 24,
    fontColor: DEFAULT_COLORS.font,
    backgroundColor: DEFAULT_COLORS.background,
    borderColor: DEFAULT_COLORS.border,
    borderWidth: 1,
    borderRadius: 11,
    accentColor: DEFAULT_COLORS.accent,
    opacity: 0.88,
    unit: metricDefinition.unit,
    decimals: metricDefinition.decimals,
    warning: metricDefinition.warning,
    critical: metricDefinition.critical,
    updateMs: 1000,
    chartSeconds: metricDefinition.kind === "lineChart" ? 60 : null,
    chartMaximum: metricDefinition.kind === "lineChart" ? 40 : null,
    groupId: ""
  }, { overlayWidth, overlayHeight, metricDefinition });
}

function normalizeCard(value = {}, context = {}) {
  const metricDefinition = context.metricDefinition || METRIC_BY_ID.get(value.id);
  if (!metricDefinition) return null;
  const overlayWidth = integer(context.overlayWidth, 320, 7680, 1920);
  const overlayHeight = integer(context.overlayHeight, 180, 4320, 1080);
  const fallback = context.fallback || {
    id: metricDefinition.id,
    enabled: metricDefinition.defaultEnabled,
    x: 18,
    y: 18,
    width: metricDefinition.defaultWidth,
    height: metricDefinition.defaultHeight,
    fontFamily: DEFAULT_FONT,
    fontSize: metricDefinition.kind === "text" ? 22 : 24,
    fontColor: DEFAULT_COLORS.font,
    backgroundColor: DEFAULT_COLORS.background,
    borderColor: DEFAULT_COLORS.border,
    borderWidth: 1,
    borderRadius: 11,
    accentColor: DEFAULT_COLORS.accent,
    opacity: 0.88,
    unit: metricDefinition.unit,
    decimals: metricDefinition.decimals,
    warning: metricDefinition.warning,
    critical: metricDefinition.critical,
    updateMs: 1000,
    chartSeconds: metricDefinition.kind === "lineChart" ? 60 : null,
    chartMaximum: metricDefinition.kind === "lineChart" ? 40 : null,
    groupId: ""
  };
  const minimumWidth = metricDefinition.kind === "lineChart" ? 260 : 90;
  const minimumHeight = metricDefinition.kind === "lineChart" ? 130 : 54;
  const width = integer(value.width, minimumWidth, overlayWidth, fallback.width);
  const height = integer(value.height, minimumHeight, overlayHeight, fallback.height);
  const x = integer(value.x, 0, Math.max(0, overlayWidth - width), fallback.x);
  const y = integer(value.y, 0, Math.max(0, overlayHeight - height), fallback.y);
  return {
    id: metricDefinition.id,
    enabled: value.enabled === undefined ? Boolean(fallback.enabled) : Boolean(value.enabled),
    x,
    y,
    width,
    height,
    fontFamily: safeText(value.fontFamily, fallback.fontFamily || DEFAULT_FONT, 160),
    fontSize: integer(value.fontSize, 8, 96, fallback.fontSize || 24),
    fontColor: safeColor(value.fontColor, fallback.fontColor || DEFAULT_COLORS.font),
    backgroundColor: safeColor(
      value.backgroundColor,
      fallback.backgroundColor || DEFAULT_COLORS.background
    ),
    borderColor: safeColor(value.borderColor, fallback.borderColor || DEFAULT_COLORS.border),
    borderWidth: boundedNumber(value.borderWidth, 0, 12, fallback.borderWidth ?? 1),
    borderRadius: integer(value.borderRadius, 0, 60, fallback.borderRadius ?? 11),
    accentColor: safeColor(value.accentColor, fallback.accentColor || DEFAULT_COLORS.accent),
    opacity: boundedNumber(value.opacity, 0, 1, fallback.opacity ?? 0.88),
    unit: safeText(value.unit, fallback.unit ?? metricDefinition.unit, 20),
    decimals: integer(value.decimals, 0, 4, fallback.decimals ?? metricDefinition.decimals),
    warning: nullableThreshold(value.warning, fallback.warning),
    critical: nullableThreshold(value.critical, fallback.critical),
    updateMs: integer(value.updateMs, 250, 10000, fallback.updateMs ?? 1000),
    chartSeconds: metricDefinition.kind === "lineChart"
      ? integer(value.chartSeconds, 10, 300, fallback.chartSeconds ?? 60)
      : null,
    chartMaximum: metricDefinition.kind === "lineChart"
      ? boundedNumber(value.chartMaximum, 5, 200, fallback.chartMaximum ?? 40)
      : null,
    groupId: safeText(value.groupId, fallback.groupId || "", 80)
  };
}

function nullableThreshold(value, fallback) {
  if (value === null || value === "") return null;
  if (value === undefined) return Number.isFinite(fallback) ? Number(fallback) : null;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(-1_000_000, Math.min(1_000_000, number))
    : Number.isFinite(fallback) ? Number(fallback) : null;
}

function normalizeLayout(value, overlayWidth = 1920, overlayHeight = 1080) {
  const supplied = new Map(
    (Array.isArray(value) ? value : [])
      .filter((entry) => entry && METRIC_BY_ID.has(entry.id))
      .map((entry) => [entry.id, entry])
  );
  return METRIC_CATALOG.map((metricDefinition, index) => {
    const fallback = defaultCard(metricDefinition, index, overlayWidth, overlayHeight);
    return normalizeCard(supplied.get(metricDefinition.id) || fallback, {
      overlayWidth,
      overlayHeight,
      metricDefinition,
      fallback
    });
  });
}

function createDefaultConfig() {
  const overlayWidth = 1920;
  const overlayHeight = 1080;
  const layout = presetLayout("compact", overlayWidth, overlayHeight);
  return {
    version: 1,
    overlayWidth,
    overlayHeight,
    transparent: true,
    snapToGrid: true,
    gridSize: 10,
    showAlignmentGuides: true,
    activeProfile: "Standard",
    preset: "compact",
    layoutsByProfile: {
      Standard: layout
    }
  };
}

function normalizeConfig(value = {}) {
  const defaults = createDefaultConfig();
  const overlayWidth = integer(value.overlayWidth, 320, 7680, defaults.overlayWidth);
  const overlayHeight = integer(value.overlayHeight, 180, 4320, defaults.overlayHeight);
  const activeProfile = normalizeProfileName(value.activeProfile || defaults.activeProfile);
  const layoutsByProfile = {};
  const sourceLayouts = value.layoutsByProfile
    && typeof value.layoutsByProfile === "object"
    && !Array.isArray(value.layoutsByProfile)
      ? value.layoutsByProfile
      : {};
  for (const [rawName, rawLayout] of Object.entries(sourceLayouts).slice(0, 100)) {
    const profileName = normalizeProfileName(rawName);
    layoutsByProfile[profileName] = normalizeLayout(rawLayout, overlayWidth, overlayHeight);
  }
  if (!layoutsByProfile[activeProfile]) {
    const fallbackLayout = value.layout || value.monitoringLayout || defaults.layoutsByProfile.Standard;
    layoutsByProfile[activeProfile] = normalizeLayout(fallbackLayout, overlayWidth, overlayHeight);
  }
  if (!layoutsByProfile.Standard) {
    layoutsByProfile.Standard = normalizeLayout(
      defaults.layoutsByProfile.Standard,
      overlayWidth,
      overlayHeight
    );
  }
  return {
    version: 1,
    overlayWidth,
    overlayHeight,
    transparent: true,
    snapToGrid: value.snapToGrid !== false,
    gridSize: integer(value.gridSize, 1, 100, defaults.gridSize),
    showAlignmentGuides: value.showAlignmentGuides !== false,
    activeProfile,
    preset: PRESET_NAMES.includes(value.preset) ? value.preset : "custom",
    layoutsByProfile
  };
}

function layoutForProfile(configValue, profileName) {
  const config = normalizeConfig(configValue);
  const name = normalizeProfileName(profileName || config.activeProfile);
  return config.layoutsByProfile[name]
    ? config.layoutsByProfile[name].map((entry) => ({ ...entry }))
    : normalizeLayout([], config.overlayWidth, config.overlayHeight);
}

function updateProfileLayout(configValue, profileName, layoutValue) {
  const config = normalizeConfig(configValue);
  const name = normalizeProfileName(profileName || config.activeProfile);
  config.activeProfile = name;
  config.preset = "custom";
  config.layoutsByProfile[name] = normalizeLayout(
    layoutValue,
    config.overlayWidth,
    config.overlayHeight
  );
  return config;
}

function changeResolution(configValue, width, height) {
  const config = normalizeConfig(configValue);
  const nextWidth = integer(width, 320, 7680, config.overlayWidth);
  const nextHeight = integer(height, 180, 4320, config.overlayHeight);
  config.overlayWidth = nextWidth;
  config.overlayHeight = nextHeight;
  for (const profileName of Object.keys(config.layoutsByProfile)) {
    config.layoutsByProfile[profileName] = normalizeLayout(
      config.layoutsByProfile[profileName],
      nextWidth,
      nextHeight
    );
  }
  return config;
}

function applyPreset(configValue, name, profileName) {
  const config = normalizeConfig(configValue);
  const preset = PRESET_NAMES.includes(name) ? name : "compact";
  const profile = normalizeProfileName(profileName || config.activeProfile);
  config.activeProfile = profile;
  config.preset = preset;
  config.layoutsByProfile[profile] = presetLayout(
    preset,
    config.overlayWidth,
    config.overlayHeight
  );
  return config;
}

function presetLayout(name, overlayWidth = 1920, overlayHeight = 1080) {
  const base = normalizeLayout([], overlayWidth, overlayHeight)
    .map((entry) => ({ ...entry, enabled: false }));
  const byId = new Map(base.map((entry) => [entry.id, entry]));
  const enable = (ids) => ids.forEach((id) => {
    const entry = byId.get(id);
    if (entry) entry.enabled = true;
  });

  if (name === "horizontal") {
    const ids = [
      "obs.encoder", "obs.actualBitrate", "obs.outputFps", "obs.frameTime",
      "gpu.utilization", "gpu.temperature", "cpu.utilization", "network.upload"
    ];
    enable(ids);
    const gap = 10;
    const margin = 14;
    const width = Math.max(150, Math.floor((overlayWidth - margin * 2 - gap * (ids.length - 1)) / ids.length));
    ids.forEach((id, index) => Object.assign(byId.get(id), {
      x: margin + index * (width + gap),
      y: margin,
      width,
      height: Math.min(100, overlayHeight - margin * 2),
      fontSize: width < 190 ? 18 : 22,
      opacity: 0.82
    }));
    return normalizeLayout([...byId.values()], overlayWidth, overlayHeight);
  }

  if (name === "vertical") {
    const ids = [
      "obs.encoder", "obs.actualBitrate", "obs.outputFps", "obs.frameTime",
      "gpu.utilization", "gpu.temperature", "cpu.utilization", "ram.percent",
      "network.upload", "obs.totalDropPercent"
    ];
    enable(ids);
    const gap = 9;
    const margin = 14;
    const width = Math.min(360, overlayWidth - margin * 2);
    const height = Math.max(62, Math.min(90, Math.floor((overlayHeight - margin * 2 - gap * (ids.length - 1)) / ids.length)));
    ids.forEach((id, index) => Object.assign(byId.get(id), {
      x: margin,
      y: margin + index * (height + gap),
      width,
      height,
      fontSize: 20,
      opacity: 0.84
    }));
    return normalizeLayout([...byId.values()], overlayWidth, overlayHeight);
  }

  if (name === "3dmark") {
    const ids = [
      "gpu.model", "gpu.utilization", "gpu.temperature", "gpu.clock", "gpu.power",
      "cpu.utilization", "cpu.temperature", "ram.percent", "obs.outputFps",
      "obs.averageFps", "obs.onePercentLow", "obs.frametimeChart"
    ];
    enable(ids);
    const margin = 18;
    const gap = 12;
    const chartHeight = Math.max(180, Math.round(overlayHeight * 0.30));
    const topHeight = Math.max(78, Math.min(102, Math.round((overlayHeight - chartHeight - margin * 2 - gap * 3) / 3)));
    const cardWidth = Math.max(170, Math.floor((overlayWidth - margin * 2 - gap * 3) / 4));
    ids.slice(0, 11).forEach((id, index) => Object.assign(byId.get(id), {
      x: margin + (index % 4) * (cardWidth + gap),
      y: margin + Math.floor(index / 4) * (topHeight + gap),
      width: cardWidth,
      height: topHeight,
      backgroundColor: "#0d141d",
      borderColor: "#26465d",
      accentColor: "#44bfff",
      borderRadius: 8,
      opacity: 0.88,
      fontSize: 22
    }));
    Object.assign(byId.get("obs.frametimeChart"), {
      x: margin,
      y: Math.max(margin, overlayHeight - chartHeight - margin),
      width: Math.max(280, overlayWidth - margin * 2),
      height: chartHeight,
      backgroundColor: "#0d141d",
      borderColor: "#26465d",
      accentColor: "#44bfff",
      borderRadius: 8,
      opacity: 0.90,
      chartMaximum: 40
    });
    return normalizeLayout([...byId.values()], overlayWidth, overlayHeight);
  }

  if (name === "afterburner") {
    const ids = [
      "gpu.utilization", "gpu.temperature", "gpu.clock", "gpu.memoryClock",
      "gpu.vramUsed", "gpu.power", "gpu.fanPercent", "cpu.utilization",
      "ram.percent", "obs.outputFps", "obs.frameTime", "obs.onePercentLow",
      "obs.frametimeChart"
    ];
    enable(ids);
    const margin = 14;
    const gap = 8;
    const columns = overlayWidth >= 1000 ? 4 : 2;
    const width = Math.max(150, Math.floor((overlayWidth - margin * 2 - gap * (columns - 1)) / columns));
    const height = 78;
    ids.slice(0, -1).forEach((id, index) => Object.assign(byId.get(id), {
      x: margin + (index % columns) * (width + gap),
      y: margin + Math.floor(index / columns) * (height + gap),
      width,
      height,
      fontFamily: "Consolas, Cascadia Mono, monospace",
      fontSize: 19,
      backgroundColor: "#07090b",
      fontColor: "#f1f1f1",
      borderColor: "#4d2a17",
      accentColor: "#ff7b25",
      borderRadius: 4,
      opacity: 0.86
    }));
    const rows = Math.ceil((ids.length - 1) / columns);
    Object.assign(byId.get("obs.frametimeChart"), {
      x: margin,
      y: Math.min(
        overlayHeight - 180 - margin,
        margin + rows * (height + gap) + 4
      ),
      width: overlayWidth - margin * 2,
      height: Math.max(170, overlayHeight - (margin + rows * (height + gap) + 4) - margin),
      fontFamily: "Consolas, Cascadia Mono, monospace",
      backgroundColor: "#07090b",
      fontColor: "#f1f1f1",
      borderColor: "#4d2a17",
      accentColor: "#ff7b25",
      borderRadius: 4,
      opacity: 0.88,
      chartMaximum: 40
    });
    return normalizeLayout([...byId.values()], overlayWidth, overlayHeight);
  }

  // Compact default. Deliberately avoids one giant encoder card and unused areas.
  const compactIds = [
    "obs.encoder", "obs.actualBitrate", "obs.outputFps", "obs.frameTime",
    "obs.onePercentLow", "obs.totalDropPercent", "gpu.utilization", "gpu.encoder",
    "gpu.temperature", "cpu.utilization", "ram.percent", "network.upload",
    "obs.frametimeChart"
  ];
  enable(compactIds);
  const margin = 16;
  const gap = 10;
  const columns = overlayWidth >= 1200 ? 4 : overlayWidth >= 720 ? 3 : 2;
  const width = Math.max(155, Math.floor((overlayWidth - margin * 2 - gap * (columns - 1)) / columns));
  const height = Math.max(74, Math.min(92, Math.round(overlayHeight * 0.085)));
  compactIds.slice(0, -1).forEach((id, index) => Object.assign(byId.get(id), {
    x: margin + (index % columns) * (width + gap),
    y: margin + Math.floor(index / columns) * (height + gap),
    width,
    height,
    fontSize: width < 190 ? 18 : 21,
    opacity: 0.84
  }));
  const rows = Math.ceil((compactIds.length - 1) / columns);
  const chartY = margin + rows * (height + gap) + 4;
  Object.assign(byId.get("obs.frametimeChart"), {
    x: margin,
    y: chartY,
    width: overlayWidth - margin * 2,
    height: Math.max(170, Math.min(260, overlayHeight - chartY - margin)),
    opacity: 0.86,
    chartMaximum: 40
  });
  return normalizeLayout([...byId.values()], overlayWidth, overlayHeight);
}

function exportLayout(configValue, profileName) {
  const config = normalizeConfig(configValue);
  const profile = normalizeProfileName(profileName || config.activeProfile);
  return {
    format: "batto-obs-tool-encoder-overlay-layout",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    overlayWidth: config.overlayWidth,
    overlayHeight: config.overlayHeight,
    layout: layoutForProfile(config, profile)
  };
}

function importLayout(configValue, payload) {
  if (!payload || payload.format !== "batto-obs-tool-encoder-overlay-layout") {
    throw new Error("Die Datei ist kein Batto-OBS-Tool-Encoder-Overlay-Layout.");
  }
  if (!Array.isArray(payload.layout)) {
    throw new Error("Das importierte Layout enthält keine Messwertkarten.");
  }
  let config = changeResolution(
    configValue,
    payload.overlayWidth,
    payload.overlayHeight
  );
  const profile = normalizeProfileName(payload.profile || config.activeProfile);
  config = updateProfileLayout(config, profile, payload.layout);
  return config;
}

module.exports = {
  DEFAULT_COLORS,
  PRESET_NAMES,
  applyPreset,
  changeResolution,
  createDefaultConfig,
  defaultCard,
  exportLayout,
  importLayout,
  layoutForProfile,
  normalizeCard,
  normalizeConfig,
  normalizeLayout,
  normalizeProfileName,
  presetLayout,
  updateProfileLayout
};
