import test from 'node:test';
import assert from 'node:assert/strict';
import { KingstonServiceClient, KingstonCodec, buildKingstonEffect, kingstonNativeEffects, validateKingstonServiceIdentity } from '../server/kingston-service.mjs';
import { KingstonCodec as InProcessKingstonCodec } from '../server/kingston-codec.mjs';
import { integratedClients } from '../server/in-process-lighting.mjs';

const proof = { serviceName: 'FuryController_Service', servicePath: '"C:\\Program Files (x86)\\Kingston\\FURYCTRL_SDK\\FuryController_Service.exe"',
  processPath: 'C:\\Program Files (x86)\\Kingston\\FURYCTRL_SDK\\FuryController_Service.exe', processId: 2345,
  startTime: '2026-10-04T10:00:00Z', signatureStatus: 'Valid', signer: 'Kingston Technology Company, Inc.',
  listenerAddress: '127.0.0.1', listenerPort: 55599, programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'] };
const identity = validateKingstonServiceIdentity(proof);
const slot = index => ({ index, manufac: 'KingstonFury_Beast_DDR5', brand: 'KingstonFury', product: 'Beast',
  part_number: 'KF556C40BBA-8', type: 2, api_ver: 2, model_id: 1 });

// A stand-in codec keeps schema tests runnable without a Windows build. A
// separate test below exercises real in-process Rijndael-256 messages.
class FixtureCodec {
  async encrypt(data) { return 'fixture:' + Buffer.from(data).toString('base64'); }
  async decrypt(data) {
    assert.ok(data.startsWith('fixture:'));
    return Buffer.from(data.slice(8), 'base64').toString();
  }
  close() {}
}

function fixture({ dram = { slot_0: slot(0), slot_1: slot(1), slot_2: slot(2), slot_3: slot(3) }, reply = root => root,
  type = 2, api = 2, verify = async () => identity, real = false, codec, timeout = 1000 } = {}) {
  const clientCodec = codec ?? (real ? new KingstonCodec() : new FixtureCodec());
  const serverCodec = real ? new KingstonCodec() : new FixtureCodec();
  const requests = [], frames = [];
  let socket;
  class FixtureSocket extends EventTarget {
    constructor(url) {
      super(); assert.equal(url, 'ws://127.0.0.1:55599/'); this.readyState = 0;
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
    }
    send(packet) {
      frames.push(packet);
      Promise.resolve().then(async () => {
        const message = JSON.parse(await serverCodec.decrypt(packet)); requests.push(message.root);
        const apiName = message.root.api;
        let root = { api: apiName, status: '0' };
        if (apiName === 'get_version') root.version = '1.2.0.10';
        if (apiName === 'get_dram_type') root.dram_type = type;
        if (apiName === 'get_dram_api') root.dram_api = api;
        if (apiName === 'get_dram_info') root.dram = dram;
        root = reply(root, message.root);
        if (root === null || this.readyState !== 1) return;
        const data = await serverCodec.encrypt(JSON.stringify({ root }));
        this.dispatchEvent(new MessageEvent('message', { data }));
      }).catch(error => { this.error = error; this.dispatchEvent(new Event('error')); });
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const client = new KingstonServiceClient({ codec: clientCodec, platform: 'win32', verifyService: verify,
    createSocket: url => { socket = new FixtureSocket(url); return socket; }, timeout });
  return { client, requests, frames, get socket() { return socket; }, close() { client.close(); serverCodec.close(); } };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class DeferredCodec extends FixtureCodec {
  constructor() { super(); this.held = new Map(); }
  hold(label) { const wait = deferred(); this.held.set(label, wait); return wait; }
  decrypt(data) { return this.held.has(data) ? this.held.get(data).promise : super.decrypt(data); }
}
const frame = root => 'fixture:' + Buffer.from(JSON.stringify({ root })).toString('base64');

test('Kingston requires the real local service image, signature and protected installation root', () => {
  assert.equal(identity.verified, true);
  for (const patch of [ { signer: 'Unknown Publisher' }, { signatureStatus: 'NotSigned' }, { listenerAddress: '0.0.0.0' },
    { listenerPort: 55600 }, { serviceName: 'StreamDeck' }, { processId: 0 },
    { servicePath: '"C:\\Program Files (x86)\\Kingston\\FURYCTRL_SDK\\other.exe"' },
    { processPath: 'C:\\Users\\Test\\FuryController_Service.exe', servicePath: 'C:\\Users\\Test\\FuryController_Service.exe' } ]) {
    assert.throws(() => validateKingstonServiceIdentity({ ...proof, ...patch }), { code: 'KINGSTON_SERVICE_UNVERIFIED' });
  }
});

test('Kingston read-only discovery reports four real DDR5 slots without fabricated LED counts', async () => {
  const f = fixture();
  try {
    const devices = await f.client.connect();
    assert.deepEqual(devices.map(device => device.id), [40000, 40001, 40002, 40003]);
    assert.deepEqual(f.requests.map(request => request.api), ['get_version', 'get_dram_type', 'get_dram_api', 'get_dram_info']);
    assert.ok(devices.every(device => device.directMode === false && device.ledCount === 0 && device.hardwareLedCount === null && device.zones.length === 0));
    assert.match(devices[0].name, /Kingston FURY Beast RGB DDR5.*KF556C40BBA-8/);
    assert.equal(devices[0].nativeEffects.length, 20, 'API 2 excludes the API 3/4 racing mode');
    assert.equal(f.client.details.kingston.status, 'connected');
    await assert.rejects(() => f.client.selectDirect(f.client.devices[0]), { code: 'DIRECT_UNSUPPORTED' });
    await assert.rejects(() => f.client.update(f.client.devices[0], [0xff0000]), { code: 'DIRECT_UNSUPPORTED' });
    assert.equal(f.requests.length, 4);
  } finally { f.close(); }
});

test('native Kingston effect writes exactly the chosen actual slot and requires success acknowledgement', async () => {
  const f = fixture({ dram: { slot_1: slot(1), slot_3: slot(3) } });
  try {
    await f.client.connect();
    const device = f.client.devices[1];
    const result = await f.client.applyNativeEffect(device, 'static_color', { colors: ['#4080ff'], brightness: 35 });
    const write = f.requests.at(-1);
    assert.equal(write.api, 'set_dram_led');
    assert.deepEqual(Object.keys(write.ctrl_settings_ddr5), ['slot_3']);
    assert.deepEqual(write.ctrl_settings_ddr5.slot_3.color_table, [[64, 128, 255]]);
    assert.equal(write.ctrl_settings_ddr5.slot_3.index, 3);
    assert.equal(write.ctrl_settings_ddr5.slot_3.reset_default_effect, false);
    assert.equal(write.ctrl_settings_ddr5.slot_3.reset_color_table, false);
    assert.equal(result.accepted, true); assert.equal(result.physicalVerification, false);
    assert.equal(device.activeNativeEffect, 'static_color');
  } finally { f.close(); }
  const bad = fixture({ reply: root => root.api === 'set_dram_led' ? { ...root, status: '5' } : root });
  try {
    await bad.client.connect();
    await assert.rejects(() => bad.client.applyNativeEffect(bad.client.devices[0], 'breath'), { code: 'KINGSTON_REJECTED' });
    assert.equal(bad.client.devices[0].activeNativeEffect, undefined);
  } finally { bad.close(); }
});

test('Kingston handles real sparse slots and rejects mismatches, duplicate indices and missing memory', async () => {
  for (const dram of [null, {}, { slot_1: slot(0) }, { slot_0: slot(0), slot_1: slot(0) }]) {
    const f = fixture({ dram });
    try { await assert.rejects(() => f.client.connect(), { code: 'KINGSTON_INVALID_DATA' }); assert.equal(f.client.devices.length, 0); }
    finally { f.close(); }
  }
  for (const params of [{ api: 254 }, { api: 255 }, { type: 1 }]) {
    const f = fixture(params);
    try { await assert.rejects(() => f.client.connect(), { code: 'KINGSTON_DDR5_UNSUPPORTED' }); }
    finally { f.close(); }
  }
});

test('Kingston limits hardware modes, color count, percentages and real effect-specific ranges', () => {
  assert.equal(kingstonNativeEffects(3).length, 21);
  const device = { slotIndex: 3, apiVersion: 3, nativeEffects: kingstonNativeEffects(3) };
  const racing = buildKingstonEffect(device, 'racing');
  assert.equal(racing.ctrl_mode, 'def', 'Racing only implements the vendor default branch');
  assert.equal(buildKingstonEffect(device, 'rainbow_1').ctrl_mode, 'ctrl', 'rainbow modes do not implement ctrl_color');
  assert.equal(buildKingstonEffect(device, 'rainbow_1', { direction: 'forward' }).direction, 1);
  assert.equal(buildKingstonEffect(device, 'rainbow_1', { direction: 'reverse' }).direction, 2);
  for (const [mode, options] of [ ['breath', { speed: 101 }], ['static_color', { brightness: -1 }],
    ['static_color', { colors: ['#ffffff', '#000000'] }], ['comet', { length: 19 }],
    ['slide', { irDelay: 0 }], ['rainbow_2', { hue: 30 }], ['rain', { direction: 3 }], ['breath', { multicolor: true }] ]) {
    assert.throws(() => buildKingstonEffect(device, mode, options), error => ['INVALID_NATIVE_EFFECT', 'NATIVE_EFFECT_UNSUPPORTED'].includes(error.code));
  }
  assert.throws(() => buildKingstonEffect(device, 'set_kernel_update'), { code: 'NATIVE_EFFECT_UNSUPPORTED' });
});

test('changed service identity prevents all color writes and closes only the local adapter', async () => {
  let checks = 0;
  const f = fixture({ verify: async () => ++checks === 1 ? identity : { ...identity, processId: 7777 } });
  try {
    await f.client.connect();
    await assert.rejects(() => f.client.applyNativeEffect(f.client.devices[0], 'static_color'), { code: 'KINGSTON_SERVICE_CHANGED' });
    assert.equal(f.requests.filter(request => request.api === 'set_dram_led').length, 0);
    assert.equal(f.client.connected, false);
  } finally { f.close(); }
});

test('Kingston refuses updater/service APIs, unexpected acknowledgements and silent timeouts', async () => {
  const f = fixture({ reply: root => root.api === 'set_dram_led' ? { ...root, api: 'set_kernel_update' } : root });
  try {
    await f.client.connect();
    await assert.rejects(() => f.client.request('set_kernel_update'), { code: 'KINGSTON_API_FORBIDDEN' });
    await assert.rejects(() => f.client.request('set_keep_status'), { code: 'KINGSTON_API_FORBIDDEN' });
    await assert.rejects(() => f.client.request('set_dram_led', { ctrl_settings_ddr5: {} }), { code: 'KINGSTON_API_FORBIDDEN' });
    await assert.rejects(() => f.client.applyNativeEffect(f.client.devices[0], 'all_off'), error => ['KINGSTON_INVALID_DATA', 'KINGSTON_DISCONNECTED'].includes(error.code));
    assert.equal(f.client.connected, false);
  } finally { f.close(); }
  const silent = fixture({ timeout: 60, reply: root => root.api === 'set_dram_led' ? null : root });
  try {
    await silent.client.connect();
    await assert.rejects(() => silent.client.applyNativeEffect(silent.client.devices[0], 'all_off'), error => ['KINGSTON_TIMEOUT', 'KINGSTON_DISCONNECTED'].includes(error.code));
    assert.equal(silent.client.connected, false);
  } finally { silent.close(); }
});

test('default Kingston client uses the in-process codec without a helper executable', () => {
  const client = new KingstonServiceClient();
  assert.equal(KingstonCodec, InProcessKingstonCodec);
  assert.ok(client.codec instanceof InProcessKingstonCodec);
  assert.equal('child' in client.codec, false);
  client.close();
});

test('integrated Kingston identity verification uses only the in-process inventory provider and validates its proof',async()=>{
  const calls=[];let result=proof;
  const clients=integratedClients({request:async(provider,command)=>{calls.push({provider,command});return result;}});
  const client=clients.find(value=>value.backend==='kingston');
  assert.ok(client instanceof KingstonServiceClient);
  assert.ok(client.codec instanceof InProcessKingstonCodec);
  assert.deepEqual(calls,[],'creating adapters does not query devices or services');
  assert.deepEqual(await client.verifyService(),identity);
  result={unavailable:true};
  await assert.rejects(client.verifyService(),{code:'KINGSTON_UNAVAILABLE'});
  result={...proof,signer:'Unknown Publisher'};
  await assert.rejects(client.verifyService(),{code:'KINGSTON_SERVICE_UNVERIFIED'});
  assert.deepEqual(calls,Array(3).fill({provider:'inventory',command:'kingston'}));
  client.close();
});

test('in-process Rijndael-256 codec roundtrips UTF-8, changes entropy and rejects malformed data', async () => {
  const codec = new KingstonCodec();
  try {
    const plain = JSON.stringify({ root: { api: 'get_version', name: 'FURY · Prüfung 🌈' } });
    const first = await codec.encrypt(plain), second = await codec.encrypt(plain);
    assert.notEqual(first, second);
    const envelope = Buffer.from(first, 'base64');
    assert.ok(envelope.length >= 96 && (envelope.length - 64) % 32 === 0);
    assert.equal(await codec.decrypt(first), plain);
    await assert.rejects(() => codec.decrypt('malformed'), { code: 'KINGSTON_INVALID_DATA' });
    await assert.rejects(() => codec.decrypt(Buffer.alloc(96).toString('base64')), { code: 'KINGSTON_INVALID_DATA' });
    assert.equal(await codec.decrypt(second), plain, 'an invalid frame does not corrupt the codec');
  } finally { codec.close(); }
});

test('actual in-process Rijndael-encrypted fixture handshake and four sparse-slot acknowledgements', async () => {
  const f = fixture({ real: true, dram: { slot_0: slot(0), slot_2: slot(2), slot_5: slot(5), slot_7: slot(7) }, timeout: 2000 });
  try {
    await f.client.connect();
    for (const device of f.client.devices) await f.client.applyNativeEffect(device, 'static_color', { colors: ['#102030'] });
    assert.deepEqual(f.requests.filter(request => request.api === 'set_dram_led').map(request => Object.keys(request.ctrl_settings_ddr5)), [['slot_0'], ['slot_2'], ['slot_5'], ['slot_7']]);
    assert.ok(f.frames.every(frame => /^[A-Za-z\d+/]+=*$/.test(frame) && !frame.includes('static_color')));
    assert.equal(f.socket.error, undefined);
  } finally { f.close(); }
});

for (const failDecrypt of [false, true]) test(`late ${failDecrypt ? 'failed' : 'successful'} decrypt from the previous socket cannot close or acknowledge a reconnect`, async () => {
  const codec = new DeferredCodec();
  let holdReplies = false;
  const f = fixture({ codec, reply: root => holdReplies ? null : root });
  try {
    await f.client.connect();
    const oldSocket = f.socket;
    holdReplies = true;
    const oldRequest = f.client.request('get_version');
    const oldRejected = assert.rejects(oldRequest, { code: 'KINGSTON_DISCONNECTED' });
    await tick();
    const wait = codec.hold('old-frame');
    oldSocket.dispatchEvent(new MessageEvent('message', { data: 'old-frame' }));
    f.client.close(); await oldRejected;
    holdReplies = false; await f.client.connect();
    const currentSocket = f.socket;
    holdReplies = true;
    const currentRequest = f.client.request('get_version');
    await tick();
    const currentPending = f.client.pending;
    if (failDecrypt) wait.reject(Object.assign(Error('old canceled decode'), { code: 'KINGSTON_DISCONNECTED' }));
    else wait.resolve(JSON.stringify({ root: { api: 'get_version', status: '0', version: 'stale' } }));
    await tick();
    assert.equal(f.client.socket, currentSocket);
    assert.equal(f.client.pending, currentPending);
    assert.equal(f.client.connected, true);
    currentSocket.dispatchEvent(new MessageEvent('message', { data: frame({ api: 'get_version', status: '0', version: 'current' }) }));
    assert.equal((await currentRequest).version, 'current');
  } finally { f.close(); }
});

test('delayed duplicate acknowledgement cannot settle the next request with the same API on one socket', async () => {
  const codec = new DeferredCodec();
  let holdReplies = false;
  const f = fixture({ codec, reply: root => holdReplies ? null : root });
  try {
    await f.client.connect(); holdReplies = true;
    const first = f.client.request('get_version');
    const second = f.client.request('get_version');
    await tick();
    const duplicate = codec.hold('duplicate-frame');
    f.socket.dispatchEvent(new MessageEvent('message', { data: 'duplicate-frame' }));
    f.socket.dispatchEvent(new MessageEvent('message', { data: frame({ api: 'get_version', status: '0', version: 'first' }) }));
    assert.equal((await first).version, 'first'); await tick();
    const secondPending = f.client.pending;
    duplicate.resolve(JSON.stringify({ root: { api: 'get_version', status: '0', version: 'duplicate' } }));
    await tick();
    assert.equal(f.client.pending, secondPending);
    assert.equal(f.client.connected, true);
    f.socket.dispatchEvent(new MessageEvent('message', { data: frame({ api: 'get_version', status: '0', version: 'second' }) }));
    assert.equal((await second).version, 'second');
  } finally { f.close(); }
});

test('queued requests from a closed session never send on the new connection', async () => {
  let holdReplies = false;
  const f = fixture({ reply: root => holdReplies ? null : root });
  try {
    await f.client.connect(); holdReplies = true;
    const first = f.client.request('get_version');
    const second = f.client.request('get_dram_info');
    const rejected = Promise.all([assert.rejects(first, { code: 'KINGSTON_DISCONNECTED' }), assert.rejects(second, { code: 'KINGSTON_DISCONNECTED' })]);
    await tick(); const requestCount = f.requests.length;
    f.client.close(); holdReplies = false;
    await f.client.connect(); await rejected;
    assert.equal(f.requests.length, requestCount + 4);
    assert.equal(f.client.connected, true);
  } finally { f.close(); }
});

test('superseded asynchronous service verification cannot replace or close the new connection', async () => {
  const verification = deferred();
  let checks = 0;
  const f = fixture({ verify: () => ++checks === 1 ? verification.promise : Promise.resolve(identity) });
  try {
    const oldConnect = f.client.connect();
    const oldRejected = assert.rejects(oldConnect, { code: 'KINGSTON_DISCONNECTED' });
    await f.client.connect();
    const currentSocket = f.socket;
    verification.resolve({ ...identity, processId: 7777 }); await oldRejected;
    assert.equal(f.client.socket, currentSocket);
    assert.equal(f.client.identity, identity);
    assert.equal(f.client.connected, true);
  } finally { f.close(); }
});

test('an effect verification completed after reconnect cannot write the old device to the new service', async () => {
  const verification = deferred();
  let checks = 0;
  const f = fixture({ verify: () => ++checks === 2 ? verification.promise : Promise.resolve(identity) });
  try {
    await f.client.connect();
    const effect = f.client.applyNativeEffect(f.client.devices[0], 'static_color');
    const rejected = assert.rejects(effect, { code: 'DEVICE_LIST_CHANGED' });
    f.client.close(); await f.client.connect();
    verification.resolve(identity); await rejected;
    assert.equal(f.requests.filter(request => request.api === 'set_dram_led').length, 0);
    assert.equal(f.client.connected, true);
  } finally { f.close(); }
});
