"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {
  buildObsWebSocketUrl,
  formatWebSocketHost,
  normalizeLocalObsHost
} = require("../src/services/obs-websocket.cjs");
const {
  normalizeLocalObsHost: normalizeStoredHost,
  normalizeState
} = require("../src/services/store.cjs");
const { encoderDetails, encoderFromObs } = require("../src/services/telemetry.cjs");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");

test("old public IPv4 and IPv6 addresses are migrated to local OBS", () => {
  assert.equal(normalizeLocalObsHost("2003:f8:3733:8662:183e:947b:4c84:e8f7"), "127.0.0.1");
  assert.equal(normalizeStoredHost("192.168.178.20"), "127.0.0.1");
  assert.equal(normalizeStoredHost("localhost"), "127.0.0.1");
  assert.equal(normalizeStoredHost("[::1]"), "::1");
  const state = normalizeState({ obs: { host: "2003:f8:3733:8662:183e:947b:4c84:e8f7", port: 4455 } });
  assert.equal(state.obs.host, "127.0.0.1");
});

test("IPv6 loopback is formatted as a valid WebSocket URI", () => {
  assert.equal(formatWebSocketHost("::1"), "[::1]");
  assert.equal(buildObsWebSocketUrl("::1", 4455), "ws://[::1]:4455");
  assert.equal(buildObsWebSocketUrl("127.0.0.1", 4455), "ws://127.0.0.1:4455");
});

test("real OBS encoder IDs are mapped without inventing unavailable settings", () => {
  assert.equal(encoderDetails("jim_av1_nvenc").name, "NVIDIA NVENC AV1");
  assert.equal(encoderDetails("jim_hevc_nvenc").codec, "HEVC");
  assert.equal(encoderDetails("obs_x264").name, "x264 (CPU)");
  const encoder = encoderFromObs({
    profile: { currentProfileName: "Streaming" },
    profileParameters: {
      outputMode: { parameterValue: "Simple" },
      simpleStreamEncoder: { parameterValue: "nvenc" },
      simpleBitrate: { parameterValue: "6000" },
      simplePreset: { parameterValue: "P5" }
    }
  }, { preferredGpu: { name: "NVIDIA GeForce RTX 5080" } }, true);
  assert.equal(encoder.label, "Aktiver Encoder");
  assert.equal(encoder.name, "NVIDIA NVENC H.264");
  assert.equal(encoder.configuredBitrateKbps, 6000);
  assert.equal(encoder.obsProfileName, "Streaming");
});

test("1.9.1 installer is one assisted NSIS installer and never auto-starts the app", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.version, "1.9.1");
  assert.equal(packageJson.build.productName, "Batto OBS Tool");
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.perMachine, true);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(packageJson.build.nsis.runAfterFinish, false);
  assert.deepEqual(packageJson.build.win.target[0].arch, ["x64"]);
});

test("production source contains no old branding, duplicate-instance gap or fake monitoring API", async () => {
  const [main, hardware, index, editorHtml, editorJs, monitoringServer] = await Promise.all([
    read("src/main.cjs"),
    read("src/services/hardware.cjs"),
    read("src/renderer/index.html"),
    read("modules/encoder-monitoring-overlay/web/editor.html"),
    read("modules/encoder-monitoring-overlay/web/editor.js"),
    read("modules/encoder-monitoring-overlay/src/server.cjs")
  ]);
  const combined = [main, hardware, index, editorHtml, editorJs, monitoringServer].join("\n");
  assert.doesNotMatch(combined, /Creator[ -]?Hub/i);
  assert.doesNotMatch(combined, /show-test-values|Testwerte anzeigen|createTestTelemetry|pathname === "\/api\/test"/);
  assert.doesNotMatch(hardware, /\$\{env:ProgramFiles\(x86\)\}/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(index, /Version 1\.9\.1/);
  assert.match(index, /id="obs-host"[^>]+readonly/);
  assert.doesNotMatch(monitoringServer, /frame-ancestors/);
});
