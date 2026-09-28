"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { METRIC_CATALOG } = require("../src/metric-catalog.cjs");
const {
  PRESET_NAMES,
  applyPreset,
  changeResolution,
  createDefaultConfig,
  exportLayout,
  importLayout,
  layoutForProfile,
  normalizeConfig,
  presetLayout,
  updateProfileLayout
} = require("../src/layout-engine.cjs");

const REQUIRED_IDS = [
  "gpu.model", "gpu.utilization", "gpu.encoder", "gpu.temperature", "gpu.hotspot",
  "gpu.clock", "gpu.memoryClock", "gpu.vramUsed", "gpu.vramPercent", "gpu.power",
  "gpu.powerLimit", "gpu.voltage", "gpu.fanRpm", "gpu.fanPercent",
  "cpu.model", "cpu.utilization", "cpu.cores", "cpu.temperature", "cpu.clock",
  "cpu.effectiveClock", "cpu.power", "ram.used", "ram.percent",
  "obs.encoder", "obs.codec", "obs.rateControl", "obs.configuredBitrate",
  "obs.actualBitrate", "obs.resolution", "obs.outputFps", "obs.renderFps",
  "obs.frameTime", "obs.averageFps", "obs.onePercentLow", "obs.frametimeChart",
  "obs.renderLagFrames", "obs.encodingLagFrames", "obs.networkDrops", "obs.totalDrops",
  "obs.cpu", "obs.streamTime", "obs.recordTime", "obs.recordSize",
  "network.upload", "network.averageUpload", "network.latency", "network.status"
];

test("the catalog contains every required GPU CPU RAM OBS stream and network value", () => {
  const ids = new Set(METRIC_CATALOG.map((entry) => entry.id));
  for (const id of REQUIRED_IDS) assert.equal(ids.has(id), true, `missing ${id}`);
  assert.ok(ids.size >= 55);
});

test("all required presets exist and keep every card inside the overlay resolution", () => {
  assert.deepEqual(PRESET_NAMES, ["compact", "horizontal", "vertical", "3dmark", "afterburner"]);
  for (const name of PRESET_NAMES) {
    const layout = presetLayout(name, 1280, 720);
    assert.equal(layout.length, METRIC_CATALOG.length);
    assert.ok(layout.some((entry) => entry.enabled));
    for (const entry of layout) {
      assert.ok(entry.x >= 0 && entry.y >= 0, `${name}:${entry.id} negative position`);
      assert.ok(entry.x + entry.width <= 1280, `${name}:${entry.id} clipped horizontally`);
      assert.ok(entry.y + entry.height <= 720, `${name}:${entry.id} clipped vertically`);
    }
  }
});

test("resolution changes clamp cards without deleting disabled or off-screen assignments", () => {
  let config = createDefaultConfig();
  const before = layoutForProfile(config, "Standard");
  before.find((entry) => entry.id === "gpu.power").enabled = true;
  before.find((entry) => entry.id === "gpu.power").x = 1800;
  before.find((entry) => entry.id === "gpu.power").y = 1000;
  config = updateProfileLayout(config, "Standard", before);
  config = changeResolution(config, 1280, 720);
  const after = layoutForProfile(config, "Standard");
  assert.equal(after.length, before.length);
  const power = after.find((entry) => entry.id === "gpu.power");
  assert.equal(power.enabled, true);
  assert.ok(power.x + power.width <= 1280);
  assert.ok(power.y + power.height <= 720);
});

test("layouts are stored separately per OBS profile", () => {
  let config = createDefaultConfig();
  const streaming = layoutForProfile(config, "Standard");
  streaming.find((entry) => entry.id === "gpu.temperature").x = 333;
  config = updateProfileLayout(config, "Streaming", streaming);
  config = applyPreset(config, "afterburner", "Aufnahme");
  assert.equal(layoutForProfile(config, "Streaming").find((entry) => entry.id === "gpu.temperature").x, 333);
  assert.equal(layoutForProfile(config, "Aufnahme").find((entry) => entry.id === "obs.frametimeChart").enabled, true);
});

test("layout export and import preserve profile and positions", () => {
  let config = normalizeConfig(createDefaultConfig());
  const layout = layoutForProfile(config, "Standard");
  layout.find((entry) => entry.id === "obs.encoder").x = 444;
  config = updateProfileLayout(config, "Gaming", layout);
  const exported = exportLayout(config, "Gaming");
  const imported = importLayout(createDefaultConfig(), exported);
  assert.equal(imported.activeProfile, "Gaming");
  assert.equal(layoutForProfile(imported, "Gaming").find((entry) => entry.id === "obs.encoder").x, 444);
});
