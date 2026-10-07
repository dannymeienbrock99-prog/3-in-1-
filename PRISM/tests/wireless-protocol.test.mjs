import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeTinyUz } from './fixtures/tinyuz-decode.mjs';

// Batto's integrated binding compiles the same protocol source. Prefer its
// current fixture runner over a separately published, possibly older helper.
const integratedHelpers = [
  '../../components/batto-hardware/tests/bin/Release/net8.0-windows/win-x64/Batto.Hardware.Tests.exe',
  '../../components/batto-hardware/tests/bin/Release/net8.0-windows/Batto.Hardware.Tests.exe',
].map(relative => fileURLToPath(new URL(relative, import.meta.url)));
const legacyHelper = fileURLToPath(new URL('../native-lianli/bin/PRISM-LianLi.exe', import.meta.url));
const helper = process.env.PRISM_WIRELESS_FIXTURE_HELPER || process.env.PRISM_LIANLI_FIXTURE_HELPER
  || integratedHelpers.find(existsSync) || legacyHelper;
const fixture = process.platform === 'win32' && existsSync(helper) ? (() => {
  const result = spawnSync(helper, ['--wireless-fixtures'], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
})() : null;
const options = { skip: !fixture };

test('wireless discovery names verified Strimer models and does not invent layouts for future types', options, () => {
  assert.deepEqual(fixture.models.map(x => x.ledCount), [116, 132, 174, 88, 0, 0, 0, 0, 0]);
  assert.match(fixture.models[1].name, /Strimer Wireless 24-Pin/);
  assert.deepEqual(fixture.master, { mac: '090807060504', channel: 8, firmware: 106, time: 1000 });
  assert.equal(fixture.queries.master, '1108' + '00'.repeat(62));
  assert.equal(fixture.queries.discovery, '1001' + '00'.repeat(62));
  assert.equal(fixture.parsed.devices.length, 1);
  assert.equal(fixture.parsed.devices[0].mac, '010203040506');
  assert.equal(fixture.parsed.devices[0].masterMac, fixture.master.mac);
  assert.equal(fixture.parsed.devices[0].ledCount, 132);
  assert.equal(fixture.parsed.devices[0].rxType, 2);
});

test('wireless RGB upload rejects stale ownership, motherboard sync, malformed data, broadcasts and memory overflow before writes', options, () => {
  assert.deepEqual(fixture.invalid, ['unbound', 'motherboardSync', 'unknownModel', 'wrongLedCount', 'broadcast', 'interval', 'truncated', 'tooManyFrames', 'controllerMemory']);
  assert.deepEqual(fixture.acknowledgements, { confirmed: true, wrongIdentity: false, motherboardSync: false, wrongMaster: false, wrongChannel: false, wrongRadioAddress: false, oldEffect: false });
});

test('WinUSB errors distinguish denied opens from initialization and only known USB interfaces are eligible', options, () => {
  assert.deepEqual(fixture.diagnostics.map(({role,code,stage,win32Error}) => ({role,code,stage,win32Error})), [
    {role:'receiver',code:'WIRELESS_ACCESS_DENIED',stage:'open',win32Error:5},
    {role:'transmitter',code:'WIRELESS_INITIALIZE_DENIED',stage:'initialize',win32Error:5},
    {role:'transmitter',code:'WIRELESS_IN_USE',stage:'open',win32Error:32},
  ]);
  assert.deepEqual(fixture.interfaceIdentities, {ordinary:true,composite:true,otherProduct:false,elgato:false,suffix:false});
});

test('native tinyuz encoder round-trips through an independent decoder including 4 KiB matches and incompressible data', options, () => {
  assert.equal(fixture.vectors.length, 5);
  for (const { original, compressed } of fixture.vectors) {
    const bytes = Buffer.from(original, 'hex');
    assert.deepEqual(decodeTinyUz(Buffer.from(compressed, 'hex'), bytes.length), bytes);
  }
  assert(fixture.vectors[1].compressed.length < fixture.vectors[1].original.length / 10);
  assert(fixture.vectors[4].compressed.length / 2 > 12288);
});

test('wireless RGB packets address one actual receiver and carry the documented upload timing and RGB bytes', options, () => {
  const packets = fixture.upload.packets.map(x => Buffer.from(x, 'hex'));
  assert(packets.every(x => x.length === 64 && x[0] === 16 && x[2] === 8 && x[3] === 2));
  const join = start => Buffer.concat(packets.slice(start, start + 4).map(x => x.subarray(4)));
  const header = join(0);
  assert.deepEqual(header, join(4));
  assert.deepEqual(header, join(8));
  assert.deepEqual(header, join(12));
  assert.equal(header[0], 18); assert.equal(header[1], 32);
  assert.equal(header.subarray(2, 8).toString('hex'), '010203040506');
  assert.equal(header.subarray(8, 14).toString('hex'), '090807060504');
  assert.equal(header[27], 132); assert.equal(header.readUInt16BE(25), 1);
  assert.equal(header.readUInt16BE(32), 80); assert.equal(header[34], 0);
  assert(header.subarray(35, 40).every(x => x === 0));
  const chunks = [];
  for (let i = 16; i < packets.length; i += 4) {
    for (let chunk = 0; chunk < 4; chunk++) assert.equal(packets[i + chunk][1], chunk);
    const payload = join(i); assert.equal(payload[18], (i - 16) / 4 + 1);
    chunks.push(payload.subarray(20));
  }
  const compressed = Buffer.concat(chunks).subarray(0, header.readUInt32BE(20));
  assert.equal(compressed.toString('hex').toUpperCase(), fixture.upload.compressed);
  assert.deepEqual(decodeTinyUz(compressed, 396), Buffer.from(Array.from({ length: 132 }, () => [255, 0, 0]).flat()));
});
