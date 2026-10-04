import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIANLI_EFFECT_CATALOG, LianLiLightingClient, lianliSupportedEffects, lianliCatalogForDevice, validateLianLiNativeEffect } from '../server/lianli-lighting.mjs';

const device = ({ id = 50000, productId = 0xa100, port = 0, ring = 'all', detectedFanIds = [], ...values } = {}) => ({ id, name: 'Lian Li UNI FAN', provider: 'lianli', vendorId: productId === 0x7372 ? 0x0416 : 0x0cf2, productId, port, ring,
  detectedFanIds, fanCount: productId === 0x7372 ? detectedFanIds.length : null, nativeEffects: lianliSupportedEffects({ productId, ring }), ...values });
function mockClient(responder, options = {}) {
  const requests = [];
  const client = new LianLiLightingClient({ platform: 'win32', timeout: 1000, ...options, spawnFn: () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.killed = false;
    child.kill = () => { child.killed = true; child.exitCode = 1; child.emit('exit'); };
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(chunk.toString()); requests.push(request);
      Promise.resolve().then(() => responder(request)).then(result => { if (result !== undefined) child.stdout.write(JSON.stringify({ requestId: request.requestId, ok: true, result }) + '\n'); }, error => child.stdout.write(JSON.stringify({ requestId: request.requestId, ok: false, error: { message: error.message, code: 'TEST_ERROR' } }) + '\n'));
      done();
    }, final(done) { child.exitCode = 0; queueMicrotask(() => child.emit('exit')); done(); } });
    return child;
  } });
  return { client, requests };
}
const enumeration = devices => ({ devices, environment: { lianli: { status: 'ready' } }, discovery: [], warnings: [] });

test('all 94 upstream modes stay in reference catalog; actual family/ring capabilities are filtered', () => {
  assert.equal(LIANLI_EFFECT_CATALOG.length, 94);
  assert.equal(new Set(LIANLI_EFFECT_CATALOG.map(mode => mode.id)).size, 94);
  assert.equal(lianliSupportedEffects({ productId: 0xa100 }).length, 14);
  assert.equal(lianliSupportedEffects({ productId: 0xa103 }).length, 18);
  assert.equal(lianliSupportedEffects({ productId: 0xa102, ring: 'outer' }).find(mode => mode.id === 'MopUp').firmwareModeId, 68);
  assert.equal(lianliSupportedEffects({ productId: 0xa104, ring: 'outer' }).find(mode => mode.id === 'MopUp').firmwareModeId, 62);
  assert.equal(lianliSupportedEffects({ productId: 0xa101, ring: 'outer' }).find(mode => mode.id === 'Rainbow').firmwareModeId, 40);
  assert.equal(lianliSupportedEffects({ productId: 0xa101, ring: 'inner' }).find(mode => mode.id === 'Rainbow').firmwareModeId, 5);
  assert.equal(lianliSupportedEffects({ productId: 0x7372 }).length, 15);
  assert.equal(lianliSupportedEffects({ productId: 0xa107 }).length, 0);
  assert.ok(!lianliSupportedEffects({ productId: 0x7372 }).some(mode => mode.id === 'Kaleidoscope'));
  const reference = lianliCatalogForDevice(device({ productId: 0x7372, detectedFanIds: [0] }));
  assert.equal(reference.length, 94); assert.equal(reference.find(mode => mode.id === 'Static').available, true);
  assert.match(reference.find(mode => mode.id === 'Kaleidoscope').reason, /Gruppen-Konfiguration/);
  assert.match(reference.find(mode => mode.id === 'Direct').reason, /keine geprüfte/);
});

test('native options reject unknown modes, protected devices, invalid palettes and out-of-range controls before writes', () => {
  const target = device();
  assert.deepEqual(validateLianLiNativeEffect(target, 'Static'), { effectId: 'Static', colors: ['#ffffff'], brightness: 100, speed: 50, direction: 'forward' });
  for (const options of [{ colors: [] }, { colors: ['#fff'] }, { colors: Array(5).fill('#ffffff') }, { brightness: 101 }, { speed: 0 }, { direction: 'global' }]) assert.throws(() => validateLianLiNativeEffect(target, 'Static', options));
  assert.throws(() => validateLianLiNativeEffect(target, 'Boomerang'), { code: 'NATIVE_EFFECT_UNSUPPORTED' });
  assert.throws(() => validateLianLiNativeEffect({ ...target, name: 'Stream Deck' }, 'Static'), { code: 'DEVICE_PROTECTED' });
});

test('scan returns actual controller ports and fan IDs without fabricating LED or RAM devices', async t => {
  const { client, requests } = mockClient(() => enumeration([device(), device({ id: 50016, productId: 0x7372, port: 2, detectedFanIds: [0, 2], fanRpms: [{ index: 0, rpm: 1234 }, { index: 2, rpm: 0 }] })]));
  t.after(() => client.close());
  const devices = await client.connect();
  assert.equal(devices.length, 2); assert.equal(devices[0].fanCount, null); assert.equal(devices[0].ledCount, 0); assert.equal(devices[0].physicalLedCount, null);
  assert.equal(devices[0].directMode, false); assert.deepEqual(devices[0].zones, []); assert.deepEqual(devices[0].modes, []);
  assert.deepEqual(devices[1].detectedFanIds, [0, 2]); assert.equal(devices[1].fanRpms[1].rpm, 0);
  assert.equal(client.details.lianli.effectCatalogCount, 94); assert.equal(requests.length, 1); assert.equal(requests[0].command, 'enumerate');
  const staticMode = devices[0].nativeEffects.find(effect => effect.id === 'Static');
  assert.deepEqual(staticMode.controls, { colors: true, brightness: true, speed: false, direction: false });
  assert.equal(staticMode.colorsMax, 4); assert.equal(devices[0].nativeEffects.find(effect => effect.id === 'Off').controls.colors, false);
});

test('unknown HID families and fabricated capabilities are rejected', async t => {
  for (const invalid of [device({ productId: 0x1234 }), device({ nativeEffects: [{ id: 'Boomerang' }] }), device({ port: 9 }), device({ rpm: '1234' }), device({ productId: 0x7372, detectedFanIds: [1], fanRpms: [{ index: 0, rpm: 12 }] })]) {
    const { client } = mockClient(() => enumeration([invalid])); t.after(() => client.close());
    await assert.rejects(client.scan(), { code: 'NATIVE_INVALID_DATA' }); assert.equal(client.connected, false);
  }
});

test('explicit native apply addresses only the selected device and confirms transport', async t => {
  const { client, requests } = mockClient(request => request.command === 'enumerate' ? enumeration([device(), device({ id: 50002, port: 1 })]) : { deviceId: request.deviceId, effectId: request.effectId, transmitted: true });
  t.after(() => client.close()); await client.scan();
  await assert.rejects(client.applyNativeEffect(client.devices[0], 'Boomerang')); assert.equal(requests.length, 1);
  const result = await client.applyNativeEffect(client.devices[1], 'Static', { colors: ['#123456'], brightness: 75, speed: 40, direction: 'reverse' });
  assert.equal(result.deviceId, 50002); assert.equal(result.transmitted, true); assert.match(result.acknowledgement, /Übertragung/);
  assert.deepEqual(requests[1], { requestId: 2, command: 'effect', deviceId: 50002, effectId: 'Static', colors: ['#123456'], brightness: 75, speed: 40, direction: 'reverse' });
  assert.equal(client.devices[0].activeNativeEffect, undefined);
  await assert.rejects(client.selectDirect(client.devices[1]), { code: 'DIRECT_UNSUPPORTED' });
});

test('safe telemetry preserves zero RPM, marks missing values unknown and does not rescan/reset a lighting session', async t => {
  const { client, requests } = mockClient(request => request.command === 'enumerate' ? enumeration([device()]) : { devices: [{ deviceId: 50000, rpm: 0, fanRpms: null }], layoutChanged: false });
  t.after(() => client.close()); await client.scan();
  const values = await client.readTelemetry(); assert.equal(values[0].rpm, 0); assert.equal(client.devices[0].rpm, 0); assert.match(values[0].capturedAt, /^\d{4}-/);
  assert.deepEqual(requests.map(request => request.command), ['enumerate', 'telemetry']);
});

test('changed TL fan layout invalidates cached endpoints before subsequent application', async t => {
  const { client } = mockClient(request => request.command === 'enumerate' ? enumeration([device({ productId: 0x7372, detectedFanIds: [0] })]) : { devices: [], layoutChanged: true });
  t.after(() => client.close()); await client.scan(); const old = client.devices[0]; let changes = 0; client.on('devicesChanged', () => changes++);
  assert.deepEqual(await client.readTelemetry(), []); assert.equal(changes, 1); assert.equal(client.devices.length, 0);
  await assert.rejects(client.applyNativeEffect(old, 'Static'), { code: 'DEVICE_LIST_CHANGED' });
});

test('a timed out helper is stopped and clears every stale target', async t => {
  const { client } = mockClient(() => undefined, { timeout: 15 }); t.after(() => client.close()); let disconnected = 0; client.on('disconnected', () => disconnected++);
  await assert.rejects(client.scan(), { code: 'NATIVE_TIMEOUT' }); assert.equal(client.process, null); assert.deepEqual(client.devices, []); assert.equal(disconnected, 1);
});

const helper = fileURLToPath(new URL('../native-lianli/bin/PRISM-LianLi.exe', import.meta.url));
test('compiled native packet fixtures match upstream wire bytes without opening hardware', { skip: process.platform !== 'win32' || !existsSync(helper) }, () => {
  const result = spawnSync(helper, ['--fixtures'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }); assert.equal(result.status, 0, result.stderr);
  const fixture = JSON.parse(result.stdout); assert.equal(fixture.invalidCount, 4); assert.equal(fixture.firmwareValid, true); assert.equal(fixture.firmwareMismatchRejected, true);
  assert.deepEqual(fixture.handshake, [{ port: 0, fan: 0, rpm: 1234 }, { port: 2, fan: 2, rpm: 0 }]);
  const [sl, inf, alv2, slv2, tl] = fixture.cases;
  assert.equal(sl.packets[0].bytes, 'E032' + '010302'.repeat(64)); assert.equal(sl.packets[1].bytes, 'E01201000000');
  assert.equal(inf.packets[1].bytes, 'E01544000108'); assert.equal(inf.packets[2].bytes, 'E0600001');
  assert.equal(alv2.packets[0].bytes, 'E037' + '010302040605'.repeat(18)); assert.equal(alv2.packets[1].bytes, 'E01719000000');
  assert.equal(slv2.packets[0].bytes, 'E030' + '010302'.repeat(96)); assert.equal(slv2.packets[2].bytes, 'E0600004');
  assert.equal(tl.packets.length, 2);
  for (let i = 0; i < 2; i++) {
    const packet = Buffer.from(tl.packets[i].bytes, 'hex'); assert.equal(packet.length, 64); assert.deepEqual([...packet.subarray(0, 6)], [1, 0xa3, 0, 0, 0, 20]);
    assert.equal(packet[6], 0x20); assert.equal(packet[7], i === 0 ? 0x20 : 0x22); assert.equal(packet[8], 25); assert.equal(packet[24], 0); assert.equal(packet[25], 1);
  }
  for (const entry of fixture.cases) for (const packet of entry.packets) {
    const bytes = Buffer.from(packet.bytes, 'hex'); if (bytes[0] === 1) assert.equal(bytes[1], 0xa3);
    else assert.ok(bytes[1] === 0x60 || (bytes[1] & 0xf0) === 0x10 || (bytes[1] & 0xf0) === 0x30);
  }
});
