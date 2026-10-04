import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenRGBClient, packet, parseController, publicController, MAX_PROTOCOL } from '../server/openrgb.mjs';
import { EffectEngine, renderFrame, validateSettings } from '../server/effects.mjs';
import { createBridge } from '../server/index.mjs';

function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer; }
function string(value) { const buffer = Buffer.from(value + '\0'); return Buffer.concat([u16(buffer.length), buffer]); }
function fixture(protocol = 5, { autosave = false, effectsOnly = false } = {}) {
  const mode = [string('Direct'), u32(0), u32(32 | (autosave ? 512 : 0)), u32(0), u32(100)];
  if (protocol >= 3) mode.push(u32(0), u32(100));
  mode.push(u32(0), u32(0), u32(50));
  if (protocol >= 3) mode.push(u32(100));
  mode.push(u32(0), u32(1), u16(0));
  const zone = (name, count, flags = 0) => {
    const parts = [string(name), u32(1), u32(0), u32(count), u32(count), u16(0)];
    if (protocol >= 4) parts.push(u16(1), string('Segment'), u32(1), u32(0), u32(count));
    if (protocol >= 5) parts.push(u32(flags));
    return Buffer.concat(parts);
  };
  const count = effectsOnly ? 3 : 4;
  const data = [u32(4), string('Synthetic RGB Controller')];
  if (protocol >= 1) data.push(string('Test vendor'));
  data.push(string('Mock only. No physical hardware.'), string('test'), string(''), string('Mock USB'), u16(1), u32(0), ...mode, u16(2), zone('Front', 2, effectsOnly ? 1 : 0), zone('Rear', 2), u16(count));
  for (let index = 0; index < count; index++) data.push(string(`LED ${index + 1}`), u32(index));
  data.push(u16(count));
  for (let index = 0; index < count; index++) data.push(u32(0xff0000)); // Blue in the OpenRGB R/G/B/0 byte layout.
  if (protocol >= 5) data.push(u16(1), string('Alternate LED name'), u32(1));
  const body = Buffer.concat(data);
  return Buffer.concat([u32(body.length + 4), body]);
}

async function mockOpenRGB({ version = 5, malformed = false } = {}) {
  const writes = [], connections = new Set();
  const server = net.createServer(socket => {
    connections.add(socket); socket.on('close', () => connections.delete(socket));
    let buffer = Buffer.alloc(0), protocol = Math.min(MAX_PROTOCOL, version);
    const respond = (id, command, body) => {
      const bytes = packet(id, command, body);
      // Deliberately split every response header across TCP chunks.
      socket.write(bytes.subarray(0, 7));
      setImmediate(() => { if (!socket.destroyed) socket.write(bytes.subarray(7)); });
    };
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 16) {
        const size = buffer.readUInt32LE(12);
        if (buffer.length < size + 16) break;
        const id = buffer.readUInt32LE(4), command = buffer.readUInt32LE(8), data = buffer.subarray(16, 16 + size);
        buffer = buffer.subarray(16 + size);
        if (command === 40) {
          protocol = Math.min(version, data.readUInt32LE());
          if (version > 0) respond(id, command, u32(version));
        }
        if (command === 0) respond(id, command, u32(1));
        if (command === 1) {
          if (malformed) socket.write(Buffer.from('BORK' + '\0'.repeat(12)));
          else respond(id, command, fixture(protocol));
        }
        if ([1050, 1101].includes(command)) writes.push({ id, command, data: Buffer.from(data) });
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, writes, connections, port: server.address().port, close: async () => { for (const socket of connections) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

test('parses device descriptions for supported protocol versions 0 to 5', () => {
  for (let protocol = 0; protocol <= 5; protocol++) {
    const device = parseController(fixture(protocol), protocol, 0);
    assert.equal(device.name, 'Synthetic RGB Controller');
    assert.equal(device.ledCount, 4);
    assert.equal(device.zones[1].startIndex, 2);
    assert.equal(device.leds[0].color, '#0000ff');
    assert.equal(device.directMode, true);
    assert.equal(publicController(device).modes[0].raw, undefined);
    if (protocol >= 5) assert.equal(device.leds[0].name, 'Alternate LED name');
  }
});

test('effect-only zones use one controllable LED and automatic-save modes are rejected', () => {
  const device = parseController(fixture(5, { effectsOnly: true }), 5, 0);
  assert.equal(device.zones[0].hardwareLedCount, 2);
  assert.equal(device.zones[0].ledCount, 1);
  assert.equal(device.zones[1].startIndex, 1);
  assert.equal(device.layoutValid, true);
  assert.equal(parseController(fixture(5, { autosave: true }), 5, 0).directMode, false);
  assert.throws(() => parseController(fixture(5).subarray(0, 50), 5, 0), /Gerätedatenlänge/);
});

test('negotiates protocol 5 with a newer server and discovers real SDK devices', async t => {
  const mock = await mockOpenRGB({ version: 6 });
  const client = new OpenRGBClient({ port: mock.port, timeout: 300 });
  t.after(async () => { client.close(); await mock.close(); });
  const devices = await client.connect();
  assert.equal(client.protocol, 5);
  assert.equal(devices.length, 1);
  assert.equal(client.connected, true);
  assert.equal(devices[0].vendor, 'Test vendor');
});

test('unversioned protocol 0 fallback and malformed-packet failure', async t => {
  const legacy = await mockOpenRGB({ version: 0 });
  const client = new OpenRGBClient({ port: legacy.port, timeout: 50 });
  t.after(async () => { client.close(); await legacy.close(); });
  await client.connect();
  assert.equal(client.protocol, 0);
  const invalid = await mockOpenRGB({ malformed: true });
  const second = new OpenRGBClient({ port: invalid.port, timeout: 100 });
  t.after(async () => { second.close(); await invalid.close(); });
  await assert.rejects(second.connect(), /Paketkennung/);
  assert.equal(second.connected, false);
});

test('writes correct RGB bytes, preserves unselected zones, and validates targets before writes', async t => {
  const mock = await mockOpenRGB();
  const client = new OpenRGBClient({ port: mock.port, timeout: 300 });
  const engine = new EffectEngine(client);
  t.after(async () => { engine.stop(); client.close(); await mock.close(); });
  await client.connect();
  await engine.apply({ deviceIds: [0], zoneIds: { 0: [0] }, effect: 'static', colors: ['#ff2200'], brightness: 100 });
  await delay(20);
  const update = mock.writes.find(write => write.command === 1050).data;
  assert.equal(update.readUInt32LE(), update.length);
  assert.equal(update.readUInt16LE(4), 4);
  assert.deepEqual([...update.subarray(6, 10)], [255, 34, 0, 0]);
  assert.deepEqual([...update.subarray(14, 18)], [0, 0, 255, 0]);
  const oldWrites = mock.writes.length;
  await assert.rejects(engine.apply({ deviceIds: [0, 999], effect: 'static' }), /nicht mehr verfügbar/);
  await assert.rejects(engine.apply({ deviceIds: [0], zoneIds: { 0: [] } }), /ungültige oder leere/);
  assert.equal(mock.writes.length, oldWrites);
});

test('all six effects respect brightness and create finite bounded RGB frames', () => {
  for (const effect of ['static', 'rainbow', 'breathing', 'wave', 'gradient', 'sparkle']) {
    const settings = validateSettings({ effect, brightness: 75, speed: 50, colors: ['#ff0000', '#0000ff'] });
    const frame = renderFrame(30, settings, 1.5);
    assert.equal(frame.length, 30);
    assert(frame.every(color => Number.isInteger(color) && color >= 0 && color <= 0xffffff));
    assert(renderFrame(30, { ...settings, brightness: 0 }, 1.5).every(color => color === 0));
  }
  assert.throws(() => validateSettings({ colors: ['red'] }), /RRGGBB/);
  assert.throws(() => validateSettings({ brightness: 101 }), /Helligkeit/);
  assert.throws(() => validateSettings({ effect: 'bad' }), /Unbekannter/);
});

test('stops active effects immediately when OpenRGB changes its indexed device list', async t => {
  const mock = await mockOpenRGB();
  const client = new OpenRGBClient({ port: mock.port, timeout: 300 });
  const engine = new EffectEngine(client);
  t.after(async () => { engine.stop(); client.close(); await mock.close(); });
  await client.connect();
  await engine.apply({ deviceIds: [0], effect: 'rainbow' });
  assert.equal(engine.running, true);
  const socket = [...mock.connections][0]; socket.write(packet(0, 100));
  await delay(20);
  assert.equal(client.devices.length, 0);
  assert.equal(engine.running, false);
  assert.match(engine.lastError, /Geräteliste/);
});

test('loopback HTTP API rejects foreign origins, provides honest disconnected errors, and supports blackout', async t => {
  const mock = await mockOpenRGB();
  const client = new OpenRGBClient({ port: mock.port, timeout: 300 });
  const bridge = createBridge({ client, port: 0 });
  await bridge.listen();
  t.after(async () => { bridge.engine.stop(); client.close(); await new Promise(resolve => bridge.server.close(resolve)); await mock.close(); });
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const post = (route, body = {}, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/apply', { deviceIds: [0] })).status, 503);
  const foreign = await post('/api/connect', {}, { Origin: 'https://example.com' });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).code, 'INVALID_ORIGIN');
  const wrongType = await fetch(base + '/api/connect', { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  const connected = await post('/api/connect');
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).devices.length, 1);
  const invalidApply = await post('/api/apply', { deviceIds: [0], effect: 'invalid' });
  assert.equal(invalidApply.status, 400);
  assert.match((await (await fetch(base + '/api/status')).json()).error, /Unbekannter/);
  const apply = await post('/api/apply', { deviceIds: [0], effect: 'rainbow', brightness: 100 });
  assert.equal(apply.status, 200);
  const appliedStatus = await (await fetch(base + '/api/status')).json();
  assert.equal(appliedStatus.effectRunning, true);
  assert.equal(appliedStatus.error, null);
  assert.equal((await post('/api/stop', { blackout: true })).status, 200);
  await delay(20);
  const updates = mock.writes.filter(write => write.command === 1050);
  assert(updates.at(-1).data.subarray(6).every(byte => byte === 0));
  assert.equal((await (await fetch(base + '/api/status')).json()).effectRunning, false);
  assert.equal((await post('/api/disconnect')).status, 200);
  const disconnectedStatus = await (await fetch(base + '/api/status')).json();
  assert.equal(disconnectedStatus.connected, false);
  assert.equal(disconnectedStatus.error, null);
});

test('SDK client refuses remote hosts', () => {
  assert.throws(() => new OpenRGBClient({ host: '192.168.1.2' }), /lokale/);
});
