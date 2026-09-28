"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildRecommendation, classifyGpu } = require("../src/services/recommendation.cjs");

test("RTX 5080 uses NVENC H.264 for Twitch", () => {
  const result = buildRecommendation({
    platform: "twitch",
    resolution: "1920x1080",
    fps: 60,
    uploadMbps: 50,
    gpu: { name: "NVIDIA GeForce RTX 5080" }
  });
  assert.equal(result.settings.encoder, "NVIDIA NVENC H.264");
  assert.equal(result.settings.codec, "H.264");
  assert.equal(result.settings.rateControl, "CBR");
  assert.equal(result.settings.bitrateKbps, 6000);
});

test("RTX 5080 uses AV1 for YouTube and recording", () => {
  const youtube = buildRecommendation({
    platform: "youtube",
    resolution: "2560x1440",
    fps: 60,
    uploadMbps: 100,
    gpu: { name: "NVIDIA GeForce RTX 5080" }
  });
  const recording = buildRecommendation({
    platform: "recording",
    resolution: "3840x2160",
    fps: 60,
    gpu: { name: "NVIDIA GeForce RTX 5080" }
  });
  assert.match(youtube.settings.encoder, /AV1/);
  assert.match(recording.settings.encoder, /AV1/);
  assert.equal(recording.settings.rateControl, "CQP");
});

test("upload reserve limits live bitrate", () => {
  const result = buildRecommendation({
    platform: "youtube",
    resolution: "2560x1440",
    fps: 60,
    uploadMbps: 10,
    gpu: { name: "NVIDIA GeForce RTX 5080" }
  });
  assert.equal(result.settings.bitrateKbps, 7200);
  assert.ok(result.notes.some((note) => /begrenzt/i.test(note)));
});

test("integrated Radeon Graphics is not classified as a discrete Radeon RX", () => {
  const gpu = classifyGpu({ name: "AMD Radeon(TM) Graphics" });
  assert.equal(gpu.family, "AMD");
  assert.equal(gpu.av1, false);
});
