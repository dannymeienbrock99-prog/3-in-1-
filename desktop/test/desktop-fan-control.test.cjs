'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { DesktopFanService, JsonLineNativeHost, platformFromMetadata, readWindowsMetadata } = require('../src/services/desktop-fan-control.cjs');

const NOW = Date.parse('2026-10-06T20:00:00Z');
const desktop = { kind: 'desktop', brand: 'asus', manufacturer: 'ASUSTeK COMPUTER INC.', model: 'Synthetic desktop board', chassisTypes: [3] };
const channel = { id: '/lpc/test/control/0', name: 'CPU Fan', provider: 'LibreHardwareMonitor', device: 'Synthetic SuperIO', kind: 'fan', rpm: 1200, duty: 50, minDuty: 30, maxDuty: 100 };
const sensor = { id: '/cpu/test/temperature/0', name: 'CPU Package', celsius: 45, updatedUtc: new Date(NOW).toISOString() };
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const calls = [], changes = [], timerCallbacks = [], canceled = [];
  let metadataCalls = 0, creations = 0, nativeEnabled = false, closes = 0, handlers;
  const native = {
    async start() { calls.push({ command: 'start' }); },
    async request(command, body = {}) {
      calls.push({ command, body: clone(body) });
      if (options.request) { const result = await options.request(command, body, native); if (result !== undefined) return result; }
      if (command === 'enable') nativeEnabled = true;
      if (command === 'disable') nativeEnabled = false;
      const state = { enabled: nativeEnabled, channels: clone(options.channels ?? [channel]), sensors: clone(options.sensors ?? [sensor]), releaseVerification: 'api-only' };
      if (command === 'manual') { state.channels.find(item => item.id === body.id).duty = body.duty; return { ok: true, state, applied: true, id: body.id, duty: body.duty }; }
      if (command === 'curve') return { ok: true, state, applied: true, id: body.id, sensorId: body.sensorId, failsafeDuty: body.failsafeDuty };
      if (command === 'disable') return { ok: true, state: { enabled: false, releaseVerification: 'api-only' }, released: true };
      return { ok: true, state };
    },
    async close() { closes++; calls.push({ command: 'close' }); }
  };
  const service = new DesktopFanService({
    platform: options.platform ?? 'win32', helperPath: 'C:/Synthetic/BattoFanControl.exe', exists: () => options.exists !== false,
    readMetadata: async () => { metadataCalls++; if (options.metadataError) throw Error('Synthetic CIM denial'); return clone(options.metadata ?? desktop); },
    nativeFactory(value) { creations++; handlers = value; return native; },
    now: () => NOW, onChange: value => changes.push(value),
    schedule(callback, ms) { assert.equal(ms, 2000); timerCallbacks.push(callback); return { unref() {} }; },
    unschedule: value => canceled.push(value)
  });
  return { service, native, calls, changes, timerCallbacks, canceled,
    get handlers() { return handlers; }, get creations() { return creations; }, get metadataCalls() { return metadataCalls; }, get closes() { return closes; } };
}

test('ASUS/MSI desktop metadata is recognized independently of cooling support; notebook markers take precedence', () => {
  assert.deepEqual(platformFromMetadata({ board: { Manufacturer: 'ASUSTeK COMPUTER INC.', Product: 'ROG fixture' }, system: { PCSystemType: 1 }, chassisTypes: [3] }),
    { kind: 'desktop', brand: 'asus', manufacturer: 'ASUSTeK COMPUTER INC.', model: 'ROG fixture', chassisTypes: [3] });
  assert.equal(platformFromMetadata({ board: { Manufacturer: 'Micro-Star International Co., Ltd.' }, system: { PCSystemType: 1 } }).brand, 'msi');
  assert.equal(platformFromMetadata({ board: { Manufacturer: 'MSI' }, system: { PCSystemType: 2 }, chassisTypes: [3] }).kind, 'portable');
  assert.equal(platformFromMetadata({ system: { PCSystemType: 1 }, chassisTypes: [9] }).kind, 'portable');
  assert.equal(platformFromMetadata({ board: { Manufacturer: 'ASUS' } }).kind, 'unknown');
  assert.equal(platformFromMetadata({ board: { Manufacturer: 'Unrelated' }, chassisTypes: [3] }).brand, 'other');
});

test('Windows probe uses a fixed encoded read-only script and starts no hardware helper', async () => {
  const invocations = [];
  const result = await readWindowsMetadata({ platform: 'win32', env: { SystemRoot: 'C:/Windows' }, exec: async (...args) => {
    invocations.push(args); return { stdout: JSON.stringify({ board: { Manufacturer: 'MSI', Product: 'Synthetic board' }, system: { PCSystemType: 1 }, chassisTypes: [3] }) };
  } });
  assert.equal(result.brand, 'msi'); assert.equal(invocations.length, 1);
  const [executable, args, options] = invocations[0], script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.match(executable, /powershell\.exe$/); assert.equal(options.windowsHide, true);
  assert.match(script, /Win32_BaseBoard/); assert.match(script, /Win32_SystemEnclosure/);
  assert.match(script, /RegistryView\]::Registry64/); assert.match(script, /Uninstall\\PawnIO/); assert.match(script, /Version\]::TryParse/); assert.match(script, /WindowsBuiltInRole\]::Administrator/);
  assert.doesNotMatch(script, /Set-|Start-Process|Stop-Process|AsusWinIO|FanControl/);
  assert.equal((await readWindowsMetadata({ platform: 'linux', exec: () => { throw Error('Must not execute'); } })).kind, 'unknown');
});

test('startup and metadata inspection remain OFF and never construct a native host', async () => {
  const f = fixture(); assert.equal(f.service.snapshot().enabled, false); assert.equal(f.metadataCalls, 0); assert.equal(f.creations, 0);
  const inspected = await f.service.inspect(); assert.equal(inspected.phase, 'off'); assert.equal(inspected.platform.brand, 'asus');
  assert.equal(inspected.availability.native, true); assert.equal(f.creations, 0); assert.deepEqual(f.calls, []); assert.deepEqual(inspected.channels, []);
  inspected.platform.model = 'Changed outside'; assert.equal(f.service.snapshot().platform.model, desktop.model);
  await f.service.close();
});

test('known missing PawnIO or administrator prerequisites are reported while OFF and cannot launch a helper', async () => {
  for (const prerequisites of [{ administrator: false, pawnIO: false }, { administrator: true, pawnIO: false }, { administrator: false, pawnIO: true }]) {
    const f = fixture({ metadata: { ...desktop, prerequisites } });
    const inspected = await f.service.inspect();
    assert.equal(inspected.enabled, false); assert.equal(inspected.phase, 'off'); assert.equal(inspected.availability.native, false);
    assert.deepEqual(inspected.prerequisites, prerequisites); assert(!('prerequisites' in inspected.platform));
    if (prerequisites.administrator === false && prerequisites.pawnIO === false)
      assert.equal(inspected.availability.reason, 'Für die direkte Mainboardsteuerung fehlen PawnIO und Administratorrechte.');
    else assert.match(inspected.availability.reason, prerequisites.pawnIO ? /Administratorrechte/ : /PawnIO/);
    await assert.rejects(f.service.enable(true), /direkte Mainboardsteuerung/);
    assert.equal(f.creations, 0); assert.deepEqual(f.calls, []); await f.service.close();
  }
  const unknown = fixture(); await unknown.service.inspect();
  assert.deepEqual(unknown.service.snapshot().prerequisites, { administrator: null, pawnIO: null }); await unknown.service.close();
});

test('unsupported OS, missing helper, notebook, unknown chassis, and CIM failure cannot open hardware', async () => {
  for (const options of [{ platform: 'linux' }, { exists: false }, { metadata: { ...desktop, brand: 'other' } }, { metadata: { ...desktop, kind: 'portable' } },
    { metadata: { ...desktop, kind: 'unknown' } }, { metadataError: true }]) {
    const f = fixture(options); await assert.rejects(f.service.enable(true));
    assert.equal(f.creations, 0); assert.equal(f.service.snapshot().enabled, false); assert.equal(f.service.snapshot().phase, 'blocked');
    assert.deepEqual(f.calls, []); await f.service.close();
  }
});

test('deliberate enable scans then enables the module without any PWM command', async () => {
  const f = fixture(); const state = await f.service.enable(true);
  assert.deepEqual(f.calls.map(call => call.command), ['start', 'scan', 'enable']);
  assert.equal(state.enabled, true); assert.equal(state.phase, 'ready'); assert.equal(f.service.ownsControl, false);
  assert.deepEqual(state.channels, [channel]); assert.equal(f.timerCallbacks.length, 1);
  await f.service.enable(true); assert.equal(f.creations, 1); await f.service.close();
});

test('no controllable channels or malformed physical inventory block enable without fabricating fan controls', async () => {
  for (const channels of [[], [{ ...channel, kind: 'pump', name: 'AIO Pump' }], [{ ...channel, name: 'GPU Fan', device: 'NVIDIA GPU' }],
    [channel, { ...channel }], [{ ...channel, id: '' }]]) {
    const f = fixture({ channels }); await assert.rejects(f.service.enable(true));
    assert.equal(f.service.snapshot().enabled, false); assert.equal(f.service.snapshot().phase, 'blocked'); assert.equal(f.closes, 1);
    assert(!f.calls.some(call => call.command === 'enable' || call.command === 'manual'));
    await f.service.close();
  }
});

test('manual changes require explicit fan confirmation, a discovered stable ID, and supported positive duty', async () => {
  const f = fixture(); await f.service.enable(true); const before = f.calls.length;
  for (const value of [{ id: channel.id, duty: 50 }, { id: channel.id, duty: 0, fanConfirmed: true },
    { id: channel.id, duty: 50.1, fanConfirmed: true },
    { id: channel.id, duty: 101, fanConfirmed: true }, { id: '/different/control', duty: 50, fanConfirmed: true }])
    await assert.rejects(f.service.setManual(value));
  assert.equal(f.calls.length, before);
  const changed = await f.service.setManual({ id: channel.id, duty: 65, fanConfirmed: true });
  assert.deepEqual(f.calls.at(-1), { command: 'manual', body: { id: channel.id, duty: 65, fanConfirmed: true } });
  assert.equal(changed.channels[0].duty, 65); assert.equal(f.service.ownsControl, true); await f.service.close();
});

test('missing native write acknowledgement produces an error instead of reporting a successful manual setting', async () => {
  const f = fixture({ request: command => command === 'manual' ? { applied: false } : undefined }); await f.service.enable(true);
  await assert.rejects(f.service.setManual({ id: channel.id, duty: 65, fanConfirmed: true }), /nicht bestätigt/);
  assert.equal(f.service.snapshot().phase, 'error'); assert.equal(f.service.snapshot().channels[0].duty, 50);
  await assert.rejects(f.service.enable(true), /zuerst sicher ausgeschaltet/); await f.service.close();
});

test('curves require a fresh native temperature sensor and always pass 100 percent fail-safe duty', async () => {
  const f = fixture(); await f.service.enable(true); const points = [{ temperature: 30, duty: 40 }, { temperature: 80, duty: 100 }];
  assert.equal(f.service.snapshot().curveAvailability.available, true);
  const state = await f.service.setCurve({ id: channel.id, sensorId: sensor.id, points, fanConfirmed: true });
  assert.equal(state.phase, 'ready'); assert.deepEqual(f.calls.at(-1), { command: 'curve', body: { id: channel.id, sensorId: sensor.id, points, failsafeDuty: 100, fanConfirmed: true } });
  await f.service.close();
  for (const options of [{ sensors: [{ ...sensor, updatedUtc: new Date(NOW - 10_001).toISOString() }] },
    { sensors: [{ ...sensor, updatedUtc: new Date(NOW + 2001).toISOString() }] }, { sensors: [{ ...sensor, updatedUtc: null }] }, { sensors: [{ ...sensor, celsius: null }] }, { sensors: [] }]) {
    const stale = fixture(options); await stale.service.enable(true);
    assert.equal(stale.service.snapshot().curveAvailability.available, false); assert.match(stale.service.snapshot().curveAvailability.reason, /Messzeitpunkt/);
    await assert.rejects(stale.service.setCurve({ id: channel.id, sensorId: sensor.id, points, fanConfirmed: true }), /aktuellen Temperatursensor/);
    assert(!stale.calls.some(call => call.command === 'curve')); await stale.service.close();
  }
});

test('curve validation rejects pump confirmation gaps, zero duty, repeated temperatures, and unknown sensor IDs', async () => {
  const f = fixture(); await f.service.enable(true); const points = [{ temperature: 30, duty: 40 }, { temperature: 80, duty: 100 }];
  for (const value of [{ id: channel.id, sensorId: sensor.id, points },
    { id: channel.id, sensorId: sensor.id, points: [{ temperature: 30, duty: 0 }, { temperature: 80, duty: 100 }], fanConfirmed: true },
    { id: channel.id, sensorId: sensor.id, points: [{ temperature: 30, duty: 40 }, { temperature: 30, duty: 100 }], fanConfirmed: true },
    { id: channel.id, sensorId: sensor.id, points: [{ temperature: 30, duty: 60 }, { temperature: 80, duty: 40 }], fanConfirmed: true },
    { id: channel.id, sensorId: '/csv/not-a-native-temperature', points, fanConfirmed: true }]) await assert.rejects(f.service.setCurve(value));
  assert(!f.calls.some(call => call.command === 'curve')); await f.service.close();
});

test('heartbeat refreshes current sensor values while removed physical channels cannot be written', async () => {
  const f = fixture(); await f.service.enable(true); f.timerCallbacks[0](); await flush();
  assert.equal(f.calls.at(-1).command, 'heartbeat');
  f.handlers.onState({ enabled: true, channels: [], sensors: [sensor] });
  await assert.rejects(f.service.setManual({ id: channel.id, duty: 50, fanConfirmed: true }), /nicht mehr verfügbar/);
  assert(!f.calls.some(call => call.command === 'manual')); await f.service.close(); assert(f.canceled.length > 0);
});

test('OFF requires a native release response and describes its API-only verification honestly', async () => {
  let bad = true;
  const f = fixture({ request: command => command === 'disable' && bad ? { released: false, state: { enabled: false } } : undefined });
  await f.service.enable(true); await f.service.setManual({ id: channel.id, duty: 50, fanConfirmed: true });
  await assert.rejects(f.service.enable(false), /nicht bestätigt/); assert.equal(f.service.snapshot().enabled, true);
  assert.equal(f.service.snapshot().phase, 'error'); assert.equal(f.closes, 0);
  bad = false; const state = await f.service.enable(false);
  assert.equal(state.enabled, false); assert.equal(state.phase, 'off'); assert.equal(state.releaseVerification, 'api-only'); assert.deepEqual(state.channels, []); assert.equal(f.closes, 1);
  await f.service.close();
});

test('closing waits for an in-flight hardware command and rejects queued later writes before native release', async () => {
  let entered, release;
  const enteredPromise = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve);
  const f = fixture({ request: async command => { if (command === 'manual') { entered(); await gate; } } });
  await f.service.enable(true);
  const first = f.service.setManual({ id: channel.id, duty: 50, fanConfirmed: true }); await enteredPromise;
  const queued = f.service.setManual({ id: channel.id, duty: 55, fanConfirmed: true }); const closing = f.service.close(); assert.equal(closing, f.service.close());
  release(); await first; await assert.rejects(queued, /geschlossen/); await closing;
  assert.deepEqual(f.calls.map(call => call.command), ['start', 'scan', 'enable', 'manual', 'disable', 'close']);
  await assert.rejects(f.service.enable(true), /geschlossen/);
});

test('late exit and telemetry from a released helper cannot change a newly enabled session', async () => {
  const sessions = [];
  const service = new DesktopFanService({ platform: 'win32', exists: () => true, readMetadata: async () => desktop,
    schedule: () => ({ unref() {} }), unschedule: () => {},
    nativeFactory(handlers) {
      const host = { async start() {}, async close() {}, async request(command) {
        return { ok: true, released: command === 'disable', state: { enabled: command !== 'disable', channels: [channel], sensors: [sensor] } };
      } };
      sessions.push({ handlers, host }); return host;
    }
  });
  await service.enable(true); await service.enable(false); await service.enable(true);
  assert.equal(sessions.length, 2);
  sessions[0].handlers.onExit(); sessions[0].handlers.onState({ enabled: true, channels: [], sensors: [] });
  assert.equal(service.snapshot().phase, 'ready'); assert.deepEqual(service.snapshot().channels, [channel]); await service.close();
});

test('native protocol correlates split JSON lines and EOF closes only its owned helper', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
  const lines = []; child.stdin = new Writable({ write(chunk, encoding, done) { lines.push(JSON.parse(chunk.toString())); done(); } });
  child.stdin.on('finish', () => { child.exitCode = 0; child.emit('exit', 0); });
  let spawnCall;
  const host = new JsonLineNativeHost({ helperPath: 'C:/Synthetic/BattoFanControl.exe', spawnProcess: (...args) => { spawnCall = args; return child; } });
  await host.start();
  assert.equal(spawnCall[2].windowsHide, true); assert.deepEqual(spawnCall[1], ['--parent-pid', String(process.pid)]);
  const scan = host.request('scan'), enable = host.request('enable');
  assert.deepEqual(lines.map(line => line.command), ['scan', 'enable']);
  const payload = JSON.stringify({ requestId: lines[0].requestId, ok: true, state: { channels: [], sensors: [] } });
  child.stdout.write(payload.slice(0, 10)); child.stdout.write(payload.slice(10) + '\n');
  child.stdout.write(JSON.stringify({ requestId: lines[1].requestId, ok: true, state: { enabled: true } }) + '\n');
  assert.deepEqual((await scan).state.channels, []); assert.equal((await enable).state.enabled, true);
  await host.close(); assert.equal(child.stdin.writableEnded, true);
});

test('malformed native output and unacknowledged native requests cannot be treated as successful actions', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.stdin = new PassThrough();
  const host = new JsonLineNativeHost({ helperPath: 'C:/Synthetic/BattoFanControl.exe', spawnProcess: () => child, timeoutMs: 20 }); await host.start();
  const pending = host.request('scan'); child.stdout.write('invalid-json\n'); await assert.rejects(pending, /ungültigen Format/); assert.equal(child.stdin.writableEnded, true);
  const another = new EventEmitter(); another.stdout = new PassThrough(); another.stderr = new PassThrough(); another.exitCode = null; another.stdin = new PassThrough();
  another.stdin.on('finish', () => { another.exitCode = 0; another.emit('exit', 0); });
  const timed = new JsonLineNativeHost({ helperPath: 'C:/Synthetic/BattoFanControl.exe', spawnProcess: () => another, timeoutMs: 20 }); await timed.start();
  await assert.rejects(timed.request('manual', { id: channel.id, duty: 50 }), /nicht rechtzeitig bestätigt/); await timed.close();
});

test('null, primitive, array, and out-of-range response envelopes fail safely instead of crashing Batto', async () => {
  for (const value of [null, false, 42, 'invalid response', [], { requestId: 0, ok: true }, { requestId: 2_147_483_648, ok: true }, { requestId: 1.5, ok: true }]) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.stdin = new PassThrough();
    child.stdin.on('finish', () => { child.exitCode = 0; child.emit('exit', 0); });
    const host = new JsonLineNativeHost({ helperPath: 'C:/Synthetic/BattoFanControl.exe', spawnProcess: () => child }); await host.start();
    const pending = host.request('scan');
    assert.doesNotThrow(() => child.stdout.write(JSON.stringify(value) + '\n'));
    await assert.rejects(pending, /ungültigen Format/); assert.equal(child.stdin.writableEnded, true); await host.close();
  }
});
