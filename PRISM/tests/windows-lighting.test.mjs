import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { WindowsLightingClient } from '../server/windows-lighting.mjs';
import { EffectEngine } from '../server/effects.mjs';
import { isProtectedDevice } from '../server/device-policy.mjs';
import { createBridge } from '../server/index.mjs';
import { extractCorsairDll } from '../server/corsair-setup.mjs';
import { APP_VERSION } from '../server/version.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/native-helper.mjs');
test('native discovery excludes Stream Deck, retains Corsair provider and writes bounded RGB via helper', async () => {
  const client = new WindowsLightingClient({ executable: process.execPath, args: [fixture], platform: 'win32', timeout: 2000 });
  try {
    const devices = await client.connect();
    assert.deepEqual(devices.map(d => d.id), [0, 10000, 10001]);
    assert.equal(client.devices[1].backend, 'corsair');
    assert.equal(client.details.corsair.status, 'connected');
    assert.equal(devices[1].zones[0].name, 'QL-RGB-Lüfter');
    assert.equal(devices[1].channels[0].name, 'QL-RGB-Lüfter');
    assert.equal(devices[2].name, 'Corsair K70 RGB');
    assert.equal(devices[2].modes[0].name, 'Corsair iCUE direkt');
    assert.deepEqual(client.details.discovery.map(d => d.name), ['Corsair unsupported model']);
    assert.match(client.details.discovery[0].reason, /LED-Daten/);
    assert.deepEqual(client.details.warnings, ['Ein Gerät meldet keine LED-Daten.']);
    assert.equal(client.details.excludedCount, 1);
    const engine = new EffectEngine(client);
    await engine.apply({ deviceIds: [10000], effect: 'static', colors: ['#ff0080'], brightness: 100 });
    assert.deepEqual(client.devices[1].colors, [0x8000ff, 0x8000ff]);
    await assert.rejects(() => engine.apply({ deviceIds: [42], effect: 'static' }), { code: 'DEVICE_NOT_FOUND' });
    await client.disconnect();
    assert.equal(client.connected, false);
    assert.equal(client.process.exitCode, null, 'disconnect preserves native main UI');
  } finally { client.close(); }
});

test('all targets are protected before any hardware mode or color writes', async () => {
  const client = new EventEmitter();
  client.connected = true; let writes = 0;
  client.devices = [
    { id: 0, name: 'Internal controller', directMode: true, zones: [], colors: [0] },
    { id: 1, name: 'StreamDeck XL', directMode: true, zones: [], colors: [0] }
  ];
  client.selectDirect = async () => { writes++; }; client.update = async () => { writes++; };
  const engine = new EffectEngine(client);
  await assert.rejects(() => engine.apply({ deviceIds: [0, 1], effect: 'static' }), { code: 'DEVICE_PROTECTED' });
  assert.equal(writes, 0);
  assert.equal(isProtectedDevice({ location: 'USB VID_0FD9&PID_0080' }), true);
  assert.equal(isProtectedDevice({ vendor: 'Corsair', name: 'Vengeance RGB' }), false);
});

test('default app remains passive and never starts or connects OpenRGB', async () => {
  const bridge = createBridge({ port: 0 });
  const address = await bridge.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.version, APP_VERSION); assert.equal(status.backend, 'windows');
    assert.equal(bridge.client.process, null);
    const response = await fetch(base + '/api/openrgb/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 410);
    assert.equal(bridge.client.process, null);
    const license = await fetch(base + '/api/corsair/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(license.status, 400);
  } finally { await new Promise(resolve => bridge.server.close(resolve)); }
});

test('native main window rejects nonlocal destinations without spawning a helper', async () => {
  const client = new WindowsLightingClient();
  await assert.rejects(() => client.showWindow('https://example.com'), { code: 'INVALID_URL' });
  await assert.rejects(() => client.showWindow('http://127.0.0.1:4783/other'), { code: 'INVALID_URL' });
  assert.equal(client.process, null);
});

test('automatic RGB discovery preserves names and does not reset a running effect on reload', async () => {
  const client = new WindowsLightingClient({ executable: process.execPath, args: [fixture], platform: 'win32', timeout: 2000 });
  const bridge = createBridge({ client, port: 0 });
  const address = await bridge.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (endpoint, body = {}) => {
    const response = await fetch(base + '/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const initial = await post('discover');
    assert.equal(initial.status.effectRunning, false);
    assert.deepEqual(initial.devices.map(d => d.name), ['Mock LampArray', 'Mock Corsair RAM', 'Corsair K70 RGB']);
    assert.equal(initial.status.native.discovery[0].name, 'Corsair unsupported model');
    assert.deepEqual(client.devices[1].colors, [0, 0]);
    await post('apply', { deviceIds: [10000], effect: 'rainbow', colors: ['#ff0080'], speed: 50 });
    assert.equal(bridge.engine.running, true);
    const reload = await post('discover');
    assert.equal(reload.status.effectRunning, true);
    assert.equal(bridge.engine.running, true);
    assert.deepEqual(reload.devices.map(d => d.id), initial.devices.map(d => d.id));
  } finally {
    bridge.engine.stop();
    if (bridge.engine.framePromise) await bridge.engine.framePromise;
    await client.close();
    await new Promise(resolve => bridge.server.close(resolve));
  }
});

test('Corsair setup rejects altered or untrusted archives', () => {
  assert.throws(() => extractCorsairDll(Buffer.from('fake-sdk')), { code: 'CUE_DOWNLOAD_INVALID' });
});

test('partial zones with unknown current colors never black out unselected channels', async () => {
  const client = new EventEmitter();
  client.connected = true;
  const device = { id: 0, name: 'Two-channel controller', directMode: true, colorsKnown: false, colors: [0, 0, 0, 0], zones: [{id:0,startIndex:0,ledCount:2},{id:1,startIndex:2,ledCount:2}] };
  client.devices = [device];
  const writes = [];
  client.selectDirect = async () => {};
  client.update = async (_, colors) => { writes.push(colors); device.colors = colors; device.colorsKnown = true; };
  const engine = new EffectEngine(client);
  await assert.rejects(() => engine.apply({deviceIds:[0],zoneIds:{0:[0]},effect:'static',colors:['#ff0000']}), {code:'CURRENT_COLORS_UNAVAILABLE'});
  assert.equal(writes.length, 0);
  await engine.apply({deviceIds:[0],zoneIds:{0:[0,1]},effect:'static',colors:['#00ff00'],brightness:100});
  assert.deepEqual(writes[0], [0x00ff00,0x00ff00,0x00ff00,0x00ff00]);
  await engine.apply({deviceIds:[0],zoneIds:{0:[0]},effect:'static',colors:['#ff0000'],brightness:100});
  assert.deepEqual(writes[1], [0x0000ff,0x0000ff,0x00ff00,0x00ff00]);
  engine.stop();
});

test('automatic discovery retries an initially empty provider and clears a stale error', async () => {
  const client = new EventEmitter();
  client.connected = false; client.devices = []; let attempts = 0;
  client.connect = async () => {
    attempts++; client.connected = true;
    client.devices = attempts === 1 ? [] : [{id:0,name:'Newly available Corsair RAM',type:1,modes:[],colors:[0],zones:[],directMode:true}];
    return client.devices;
  };
  client.close = () => {};
  const bridge = createBridge({client,port:0});
  const address = await bridge.listen(), base = `http://127.0.0.1:${address.port}`;
  const discover = () => fetch(base+'/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
  try {
    assert.equal((await discover()).devices.length,0);
    await fetch(base+'/api/openrgb/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const recovered = await discover();
    assert.equal(recovered.devices[0].name,'Newly available Corsair RAM');
    assert.equal(recovered.status.error,null);
    assert.equal(attempts,2);
    await discover();
    assert.equal(attempts,2);
  } finally { await new Promise(resolve=>bridge.server.close(resolve)); }
});
