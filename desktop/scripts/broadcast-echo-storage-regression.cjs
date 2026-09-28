'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BroadcastEchoTracker } = require('../src/core/broadcast/echo-tracker.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-echo-test-'));
  const file = path.join(dir, 'echoes.json');
  let clock = 1000;
  const warnings = [];
  const options = { file, now: () => clock, onStorageError: message => warnings.push(message) };
  try {
    const first = new BroadcastEchoTracker(options);
    first.remember({ platform: 'twitch', id: 'confirmed-id', source: 'broadcast:one', text: 'Private broadcast text', token: 'private-token' });
    const stored = fs.readFileSync(file, 'utf8');
    assert(!stored.includes('Private broadcast text') && !stored.includes('private-token'), 'store only message identity, source and expiry');
    let source;
    const reopened = new BroadcastEchoTracker(options);
    await reopened.ingest({ platform: 'twitch', id: 'confirmed-id' }, 'twitch', (_message, value) => { source = value; });
    assert.equal(source, 'broadcast:one', 'confirmed broadcast echo retains its source after a full restart');
    await reopened.ingest({ platform: 'twitch', id: 'viewer-id' }, 'twitch', (_message, value) => { source = value; });
    assert.equal(source, 'twitch', 'viewer messages remain ordinary chat');
    clock += 86400001;
    assert.equal(new BroadcastEchoTracker(options).sent.size, 0, 'expired IDs are not restored');
    fs.writeFileSync(file, '{broken');
    assert.equal(new BroadcastEchoTracker(options).sent.size, 0);
    assert.equal(warnings.length, 1, 'corrupt cache is reported without stopping the app');
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [[null, null], ['twitch:bad', { source: 'manual', until: clock + 1 }]] }));
    assert.equal(new BroadcastEchoTracker(options).sent.size, 0, 'invalid entries cannot misclassify regular messages');
    const failing = new BroadcastEchoTracker({ ...options, file: path.join(dir, 'missing', 'echoes.json') });
    assert.doesNotThrow(() => failing.remember({ platform: 'youtube', id: 'sent', source: 'broadcast:one' }));
    assert.equal(failing.sent.size, 1, 'storage failure keeps current-session identification');
    assert.equal(warnings.length, 2, 'write failure is reported without triggering a duplicate send');
    console.log('Broadcast echo storage: restart, expiry, corrupt cache, no message/token persistence and storage failure OK');
  } finally {
    // Remove only the known test file and the now-empty generated directory.
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
