"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { authentication, normalizeLocalObsHost, websocketUrl } = require("../src/services/obs-websocket.cjs");
const { DeckStore } = require("../src/services/deck-store.cjs");
const { PluginRegistry } = require("../src/services/plugin-registry.cjs");
const { StreamOverlayServer } = require("../src/services/stream-overlay-server.cjs");
const { MobileBridge } = require("../src/services/mobile-bridge.cjs");
const { MultiChat } = require("../src/services/multi-chat.cjs");
const { copyDirectoryMissing } = require("../src/services/migration.cjs");
const { buildRecommendation } = require("../src/services/recommendation.cjs");
const { selectPreferredGpu } = require("../src/services/hardware.cjs");
const { ActionExecutor } = require("../src/services/action-executor.cjs");

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const remove = (directory) => fs.rmSync(directory, { recursive: true, force: true });

test("OBS connection is local, authenticated and IPv6-safe", () => {
  assert.equal(normalizeLocalObsHost("2003:f8:3733:8662:183e:947b:4c84:e8f7"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("192.168.2.121"), "127.0.0.1");
  assert.equal(normalizeLocalObsHost("[::1]"), "::1");
  assert.equal(websocketUrl("::1", 4455), "ws://[::1]:4455");
  assert.equal(websocketUrl("127.0.0.1", 4455), "ws://127.0.0.1:4455");
  assert.equal(authentication("pass", "salt", "challenge"), "EabUNw4z9EKKpEOC0yvqBO8dJPSIcTb82eo+adWKOvk=");
});

test("RTX 5080 wins over the CPU graphics and produces NVENC H.264 for Twitch", () => {
  const gpu = selectPreferredGpu([
    { name: "AMD Radeon(TM) Graphics", adapterRamBytes: 512 * 1024 * 1024 },
    { name: "NVIDIA GeForce RTX 5080", adapterRamBytes: 16 * 1024 ** 3 }
  ]);
  assert.equal(gpu.name, "NVIDIA GeForce RTX 5080");
  const result = buildRecommendation({ platform: "twitch", resolution: "1920x1080", fps: 60, uploadMbps: 30, gpu });
  assert.equal(result.settings.encoder, "NVIDIA NVENC H.264");
  assert.equal(result.settings.codec, "H.264");
});

test("Touch-Deck shrink preserves hidden actions, folders and delays", () => {
  const directory = temp("batto-deck");
  try {
    const store = new DeckStore(path.join(directory, "deck.json"));
    const profile = store.snapshot().profiles[0];
    const folder = profile.folders[0];
    store.updateButton(profile.id, folder.id, 14, {
      title: "OBS und Overlay",
      actions: [
        { type: "obs.scene", settings: { sceneName: "Gaming" }, delayMs: 0 },
        { type: "overlay.wheel", settings: {}, delayMs: 750 }
      ]
    });
    store.updateFolder(profile.id, folder.id, { rows: 2, columns: 3 });
    let current = store.snapshot().profiles[0].folders[0];
    assert.equal(current.rows * current.columns, 6);
    assert.equal(current.buttons[14].actions[1].delayMs, 750);
    store.updateFolder(profile.id, folder.id, { rows: 3, columns: 5 });
    current = store.snapshot().profiles[0].folders[0];
    assert.equal(current.buttons[14].title, "OBS und Overlay");
  } finally { remove(directory); }
});

test("native replacements cover the legacy plugin catalog", () => {
  const directory = temp("batto-plugins");
  try {
    const registry = new PluginRegistry({ stateFile: path.join(directory, "state.json"), pluginRoots: [], iconPackRoots: [] });
    const snapshot = registry.scan();
    const names = new Set(snapshot.plugins.map((plugin) => plugin.name));
    for (const name of [
      "OBS Studio", "YouTube Music Desktop Connector", "YouTube Ticker", "iCUE", "BambuLab Printer Monitor",
      "Spotify", "Volume Controller", "Discord Volume Mixer", "TikFinity", "TikTok LIVE Studio",
      "OBSBOT WebCam", "Twitch Giveaway", "Polls, Word Clouds & Spinner Wheels"
    ]) assert.ok(names.has(name), `Plugin fehlt: ${name}`);
  } finally { remove(directory); }
});

test("unsupported plugin action reports an error", async () => {
  const executor = new ActionExecutor({ shell: { openPath: async () => "", openExternal: async () => {} } });
  await assert.rejects(() => executor.execute({ type: "unknown.vendor.action", settings: {} }), /ohne passende Laufzeit nicht ausgeführt/);
});

test("stream overlay is local, transparent and persists portrait layout", async () => {
  const directory = temp("batto-overlay");
  const server = new StreamOverlayServer({
    webRoot: path.join(__dirname, "..", "src", "stream-overlay"),
    configFile: path.join(directory, "overlay.json"),
    logoPath: path.join(__dirname, "..", "resources", "team-logo.svg"),
    preferredPort: 49221
  });
  try {
    await server.start();
    const status = server.status();
    assert.match(status.overlayUrl, /^http:\/\/127\.0\.0\.1:/);
    const config = await (await fetch(`${status.baseUrl}/api/config`)).json();
    assert.equal(config.backgroundOpacity, 0);
    assert.ok(config.elements.some((element) => element.type === "logo"));
    const response = await fetch(`${status.baseUrl}/api/config`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...config, width: 1080, height: 1920 })
    });
    assert.equal(response.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "overlay.json"), "utf8")).height, 1920);
  } finally { await server.stop(); remove(directory); }
});

test("mobile bridge provides web, Batto and legacy QR pairing without exposing PIN", async () => {
  const directory = temp("batto-mobile");
  const server = new MobileBridge({
    webRoot: path.join(__dirname, "..", "src", "mobile"), stateFile: path.join(directory, "pairings.json"),
    preferredPort: 49220, stateProvider: () => ({ deck: { profiles: [] } }), actionHandler: async () => ({ ok: true })
  });
  try {
    await server.start();
    const status = server.status();
    assert.match(status.pin, /^\d{6}$/);
    assert.match(status.qr.batto, /^battoobstool:\/\/pair\?/);
    assert.match(status.qr.legacy, /^creatorhub:\/\/pair\?/);
    assert.match(status.qr.webDataUrl, /^data:image\/png;base64,/);
    const publicStatus = await (await fetch(`http://127.0.0.1:${status.port}/api/status`)).json();
    assert.equal(Object.hasOwn(publicStatus, "pin"), false);
  } finally { await server.stop(); remove(directory); }
});

test("multi-chat does not store tokens or API keys in plain JSON", () => {
  const directory = temp("batto-chat");
  try {
    const file = path.join(directory, "chat.json");
    const chat = new MultiChat({ settingsFile: file });
    chat.updateSettings({ twitch: { channel: "crazy_batto" }, youtube: { liveChatId: "live-id" } }, {
      twitchOauth: "oauth-secret-value", youtubeApiKey: "youtube-secret-value"
    });
    const raw = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(raw, /oauth-secret-value|youtube-secret-value/);
    assert.equal(chat.settings.twitch.oauth, "oauth-secret-value");
    assert.equal(chat.settings.youtube.apiKey, "youtube-secret-value");
  } finally { remove(directory); }
});

test("legacy file copy never overwrites existing Batto data", () => {
  const directory = temp("batto-migration");
  try {
    const source = path.join(directory, "legacy");
    const destination = path.join(directory, "batto");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(source, "same.json"), "legacy");
    fs.writeFileSync(path.join(destination, "same.json"), "batto");
    fs.writeFileSync(path.join(source, "new.json"), "new");
    const report = { copied: [], errors: [] };
    copyDirectoryMissing(source, destination, report, "Test");
    assert.equal(fs.readFileSync(path.join(destination, "same.json"), "utf8"), "batto");
    assert.equal(fs.readFileSync(path.join(destination, "new.json"), "utf8"), "new");
    assert.equal(report.errors.length, 0);
  } finally { remove(directory); }
});

test("production UI contains integrated pages and no visible old product name", () => {
  const root = path.join(__dirname, "..");
  const visible = [
    "src/renderer/index.html", "src/renderer/app.js", "src/renderer/integrated.js",
    "src/mobile/index.html", "src/mobile/app.js", "src/stream-overlay/editor.html", "src/stream-overlay/overlay.html"
  ].map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
  assert.doesNotMatch(visible, /Creator Hub/i);
  assert.doesNotMatch(visible, /\bKandidat\b/i);
  for (const label of ["Stream-Overlay", "Multi-Chat", "OBS Gäste", "Plugins", "Touch-Deck Pro", "Handy verbinden"]) assert.match(visible, new RegExp(label));
  assert.match(fs.readFileSync(path.join(root, "modules", "encoder-monitoring-overlay", "web", "overlay.css"), "utf8"), /background:\s*transparent\s*!important/);
});
