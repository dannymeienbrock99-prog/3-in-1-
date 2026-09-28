"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MonitoringOverlayServer } = require("../src/server.cjs");

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
    const outgoing = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: options.method || "GET",
      headers: body ? {
        "Content-Type": "application/json",
        "Content-Length": body.length
      } : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

test("local server exposes editor transparent overlay production telemetry and dynamic port", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "batto-encoder-overlay-"));
  const first = new MonitoringOverlayServer({ port: 18850, configFile: path.join(directory, "first.json") });
  const second = new MonitoringOverlayServer({ port: 18850, configFile: path.join(directory, "second.json") });
  t.after(async () => {
    await second.stop();
    await first.stop();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const firstStatus = await first.start();
  const secondStatus = await second.start();
  assert.equal(firstStatus.port, 18850);
  assert.equal(secondStatus.port, 18851);
  assert.match(firstStatus.overlayUrl, /^http:\/\/127\.0\.0\.1:/);

  const overlay = await request(firstStatus.overlayUrl);
  assert.equal(overlay.status, 200);
  assert.match(overlay.body, /overlay-stage/);

  const telemetryResponse = await request(`http://127.0.0.1:${firstStatus.port}/api/telemetry`, {
    method: "POST",
    body: {
      activeFps: 60,
      profileName: "Streaming",
      output: {
        streamActive: true,
        recordActive: false,
        totalFrames: 3600,
        networkDroppedFrames: 0,
        renderLagFrames: 0,
        encodingLagFrames: 0
      },
      encoder: {
        name: "NVIDIA NVENC AV1",
        codec: "AV1",
        rateControl: "CBR",
        bitrateKbps: 10000,
        preset: "P6 – höhere Qualität",
        gpuName: "NVIDIA GeForce RTX 5080"
      },
      gpus: [
        { name: "AMD Radeon(TM) Graphics", memoryTotalMb: 512 },
        { name: "NVIDIA GeForce RTX 5080", memoryTotalMb: 16304, utilizationPercent: 42, encoderUtilizationPercent: 18, temperatureC: 48 }
      ]
    }
  });
  assert.equal(telemetryResponse.status, 200);
  const parsed = JSON.parse(telemetryResponse.body);
  assert.equal(parsed.encoder.label, "Aktiver Encoder");
  assert.equal(parsed.gpu.name, "NVIDIA GeForce RTX 5080");

  const preset = await request(`http://127.0.0.1:${firstStatus.port}/api/layout/preset`, {
    method: "POST",
    body: { name: "3dmark", profileName: "Streaming" }
  });
  assert.equal(preset.status, 200);
  assert.equal(JSON.parse(preset.body).preset, "3dmark");
});
