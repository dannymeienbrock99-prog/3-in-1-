import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LightingClient } from '../server/lighting-client.mjs';
import { EffectEngine } from '../server/effects.mjs';
import { BridgeError, publicController } from '../server/openrgb.mjs';

const rgbDevice = (id, provider, extra = {}) => ({ id, name: `${provider} ${id}`, vendor: provider, provider, type: 21, ledCount: 2,
  colors: [0, 0], leds: [{ id: 0 }, { id: 1 }], zones: [{ id: 0, startIndex: 0, ledCount: 2 }], modes: [], directMode: true,
  nativeEffects: [{ id: 'Static', name: 'Static', colorsMax: 1 }], ...extra });
class FixtureProvider extends EventEmitter {
  constructor(provider, devices, options = {}) {
    super(); this.provider = provider; this.devices = devices; this.options = options; this.alive = !!options.connected;
    this.calls = []; this.details = { [provider]: { status: 'fixture' }, warnings: options.warnings ?? [], discovery: [{ provider, name: provider }] };
  }
  get connected() { return this.alive; }
  async connect() { this.calls.push(['connect']); if (this.options.failConnect) throw new BridgeError('Herstellerdienst fehlt', 'PROVIDER_UNAVAILABLE'); this.alive = true; return this.devices.map(publicController); }
  async scan() { this.calls.push(['scan']); if (this.options.failScan) throw new BridgeError('Hersteller antwortet nicht', 'PROVIDER_UNAVAILABLE'); return this.devices.map(publicController); }
  async selectDirect(device) { this.calls.push(['selectDirect', device.id]); }
  async update(device, colors) {
    this.calls.push(['update', device.id, [...colors]]);
    if (this.options.failUpdate) {
      const error = new BridgeError('Hersteller getrennt', 'PROVIDER_UNAVAILABLE'); this.alive = false; this.devices = []; this.emit('disconnected', error); throw error;
    }
    device.colors = [...colors];
  }
  async applyNativeEffect(device, effectId, options) { this.calls.push(['native', device.id, effectId, options]); return { transmitted: true, deviceId: device.id, effectId }; }
  async readTelemetry() { this.calls.push(['telemetry']); if (this.options.failTelemetry) throw Error('Keine Telemetrie'); return this.options.telemetry ?? []; }
  async close() { this.calls.push(['close']); this.alive = false; this.devices = []; }
}

test('parallel provider scan retains healthy devices when one manufacturer service is unavailable', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')], { warnings: ['Windows Hinweis'] });
  const kingston = new FixtureProvider('kingston', [], { failConnect: true });
  const lianli = new FixtureProvider('lianli', [rgbDevice(50000, 'lianli', { directMode: false, ledCount: 0, colors: [], leds: [], zones: [] })]);
  const client = new LightingClient({ clients: [windows, kingston, lianli] }); t.after(() => client.close());
  const devices = await client.connect();
  assert.deepEqual(devices.map(device => device.id), [1, 50000]); assert.equal(client.connected, true);
  assert.deepEqual(client.details.warnings, ['Windows Hinweis', 'Herstellerdienst fehlt']);
  assert.equal(client.details.discovery.length, 3); assert.equal(client.details.lianli.status, 'fixture');
  assert.equal(windows.calls[0][0], 'connect'); assert.equal(lianli.calls[0][0], 'connect');
});

test('routing preserves provider ownership and rejects reconstructed or removed device objects', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]);
  const lianli = new FixtureProvider('lianli', [rgbDevice(50000, 'lianli')]);
  const client = new LightingClient({ clients: [windows, lianli] }); t.after(() => client.close()); await client.scan();
  const target = client.devices[1]; await client.applyNativeEffect(target, 'Static', { colors: ['#112233'] });
  assert.equal(windows.calls.some(call => call[0] === 'native'), false); assert.deepEqual(lianli.calls.find(call => call[0] === 'native').slice(0, 3), ['native', 50000, 'Static']);
  assert.throws(() => client.update({ ...target }, [0, 0]), { code: 'DEVICE_NOT_FOUND' });
  lianli.devices = [rgbDevice(50000, 'lianli')]; assert.throws(() => client.selectDirect(target), { code: 'DEVICE_NOT_FOUND' });
});

test('an idle provider disconnect removes only its targets and stops only its software jobs', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]);
  const msi = new FixtureProvider('msi', [rgbDevice(20000, 'msi')]);
  const client = new LightingClient({ clients: [windows, msi] }); t.after(() => client.close()); await client.scan();
  const engine = new EffectEngine(client); t.after(() => engine.stop());
  await engine.apply({ deviceIds: [1, 20000], effect: 'static', colors: ['#123456'] });
  const events = []; client.on('providerDisconnected', event => events.push(event));
  msi.alive = false; msi.devices = []; msi.emit('disconnected', new BridgeError('MSI beendet', 'NATIVE_DISCONNECTED'));
  assert.deepEqual(events[0].deviceIds, [20000]); assert.deepEqual(client.devices.map(device => device.id), [1]);
  assert.deepEqual([...engine.jobs.keys()], [1]); assert.equal(client.connected, true);
});

test('ownership loss suspends only the source provider while retaining independent sessions', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]);
  const lianli = new FixtureProvider('lianli', [rgbDevice(50000, 'lianli')]);
  const client = new LightingClient({ clients: [windows, lianli] }); t.after(() => client.close()); await client.scan();
  const engine = new EffectEngine(client); t.after(() => engine.stop()); await engine.apply({ deviceIds: [1, 50000], effect: 'static' });
  windows.emit('controlLost', new BridgeError('Windows besitzt die Beleuchtung nicht', 'LIGHTING_NOT_FOREGROUND'));
  assert.deepEqual([...engine.jobs.keys()], [50000]); assert.equal(lianli.connected, true); assert.equal(client.connected, true);
});

test('telemetry failures are isolated and polling does not rescan or reset manufacturer sessions', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')], { failTelemetry: true });
  const lianli = new FixtureProvider('lianli', [rgbDevice(50000, 'lianli')], { telemetry: [{ deviceId: 50000, rpm: 0, capturedAt: '2026-10-04T08:00:00Z' }] });
  const client = new LightingClient({ clients: [windows, lianli] }); t.after(() => client.close()); await client.scan(); const targets = [...client.devices];
  const values = await client.readTelemetry(); assert.equal(values.length, 1); assert.equal(values[0].rpm, 0);
  assert.equal(client.devices[0], targets[0]); assert.equal(client.devices[1], targets[1]);
  assert.deepEqual(windows.calls.map(call => call[0]), ['connect', 'telemetry']); assert.deepEqual(lianli.calls.map(call => call[0]), ['connect', 'telemetry']);
});

test('cached routes are cleared after duplicate manufacturer device IDs, preventing stale ownership', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]);
  const lianli = new FixtureProvider('lianli', [rgbDevice(50000, 'lianli')]);
  const client = new LightingClient({ clients: [windows, lianli] }); t.after(() => client.close()); await client.scan(); const old = client.devices[0];
  lianli.devices = [rgbDevice(1, 'lianli')];
  await assert.rejects(client.scan(), { code: 'RGB_ID_COLLISION' });
  assert.deepEqual(client.devices, []); assert.equal(client.routes.size, 0); assert.throws(() => client.update(old, [0, 0]), { code: 'DEVICE_NOT_FOUND' });
});

test('disconnect during a frame cannot cancel another healthy provider job', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]);
  const msi = new FixtureProvider('msi', [rgbDevice(20000, 'msi')]);
  const client = new LightingClient({ clients: [windows, msi] }); t.after(() => client.close()); await client.scan();
  const engine = new EffectEngine(client); t.after(() => engine.stop()); await engine.apply({ deviceIds: [1, 20000], effect: 'rainbow' });
  msi.options.failUpdate = true;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture disconnect did not occur')), 1000);
    msi.once('disconnected', () => { clearTimeout(timer); setImmediate(resolve); });
  });
  assert.deepEqual([...engine.jobs.keys()], [1]); assert.deepEqual(client.devices.map(device => device.id), [1]);
});

test('closing a composite releases every owned helper and removes all routes', async () => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]); const lianli = new FixtureProvider('lianli', [rgbDevice(50000, 'lianli')]);
  const client = new LightingClient({ clients: [windows, lianli] }); await client.scan(); await client.close();
  assert.deepEqual(client.devices, []); assert.equal(client.routes.size, 0); assert.equal(client.connected, false);
  assert.equal(windows.calls.at(-1)[0], 'close'); assert.equal(lianli.calls.at(-1)[0], 'close');
});

test('a failed effect request restarts the timer for an existing healthy provider job', async t => {
  const windows = new FixtureProvider('windows', [rgbDevice(1, 'windows')]);
  const msi = new FixtureProvider('msi', [rgbDevice(20000, 'msi')]);
  const client = new LightingClient({ clients: [windows, msi] }); t.after(() => client.close()); await client.scan();
  const engine = new EffectEngine(client); t.after(() => engine.stop()); await engine.apply({ deviceIds: [1], effect: 'rainbow' });
  msi.options.failUpdate = true;
  await assert.rejects(engine.apply({ deviceIds: [20000], effect: 'static' }), { code: 'PROVIDER_UNAVAILABLE' });
  assert.deepEqual([...engine.jobs.keys()], [1]); assert.equal(engine.running, true); assert.ok(engine.timer);
});
