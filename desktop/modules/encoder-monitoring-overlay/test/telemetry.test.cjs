"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TelemetryNormalizer,
  createTestTelemetry,
  isIntegratedGpuName,
  lowestAverage,
  normalizeCodec,
  selectPreferredGpu
} = require("../src/telemetry.cjs");

test("the dedicated RTX 5080 is selected instead of AMD Radeon(TM) Graphics", () => {
  const selected = selectPreferredGpu([
    { name: "AMD Radeon(TM) Graphics", memoryTotalMb: 512 },
    { name: "NVIDIA GeForce RTX 5080", memoryTotalMb: 16304 }
  ]);
  assert.equal(selected.name, "NVIDIA GeForce RTX 5080");
  assert.equal(selected.dedicated, true);
  assert.equal(selected.integrated, false);
  assert.equal(isIntegratedGpuName("AMD Radeon(TM) Graphics"), true);
});

test("active OBS output is labeled Aktiver Encoder and never Kandidat", () => {
  const normalizer = new TelemetryNormalizer();
  const telemetry = normalizer.ingest(createTestTelemetry({ active: true }));
  assert.equal(telemetry.encoder.label, "Aktiver Encoder");
  assert.equal(telemetry.encoder.name, "NVIDIA NVENC AV1");
  assert.doesNotMatch(JSON.stringify(telemetry), /Kandidat/i);
  assert.equal(telemetry.gpu.name, "NVIDIA GeForce RTX 5080");
});

test("inactive OBS output uses the neutral Encoder label", () => {
  const normalizer = new TelemetryNormalizer();
  const telemetry = normalizer.ingest(createTestTelemetry({ active: false }));
  assert.equal(telemetry.encoder.label, "Encoder");
  assert.equal(telemetry.encoder.active, false);
});

test("codec names are normalized to AV1 HEVC and H.264", () => {
  assert.equal(normalizeCodec("ffmpeg_nvenc_av1"), "AV1");
  assert.equal(normalizeCodec("hevc_nvenc"), "HEVC");
  assert.equal(normalizeCodec("h264_texture_amf"), "H.264");
});

test("frame history calculates average FPS and one-percent-low FPS", () => {
  const normalizer = new TelemetryNormalizer({ historySize: 600 });
  let result;
  for (const fps of [60, 60, 59, 58, 60, 55, 60, 57, 60, 60]) {
    result = normalizer.ingest({
      activeFps: fps,
      output: { streamActive: true, totalFrames: 1000 },
      encoder: { name: "NVIDIA NVENC H.264" },
      gpus: [{ name: "NVIDIA GeForce RTX 5080", memoryTotalMb: 16304 }]
    });
  }
  assert.ok(result.frame.frameTimeMs > 16 && result.frame.frameTimeMs < 17);
  assert.ok(result.frame.averageFps > 57);
  assert.equal(result.frame.onePercentLowFps, 55);
  assert.equal(result.frame.history.length, 10);
  assert.equal(lowestAverage([60, 58, 55, 60], 0.01), 55);
});
