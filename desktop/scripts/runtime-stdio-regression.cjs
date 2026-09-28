'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { installRuntimeStdio } = require('../src/core/runtime-stdio.cjs');

if (process.argv[2] === '--fixture') {
  runFixture(process.argv[3], process.argv[4] === 'guarded');
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

function runFixture(channel, guarded) {
  const guard = guarded ? installRuntimeStdio() : null;
  process.once('message', async () => {
    if (channel === 'unexpected') {
      const error = new Error('Non-pipe output failure must remain visible');
      error.code = 'EACCES';
      process.stdout.emit('error', error);
      return;
    }
    // Deliberately use Node's default Worker auto-forwarding, matching the
    // ReadableWorkerStdio stack in the reported crash (no custom piping).
    const worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      process[${JSON.stringify(channel)}].write('worker-output:'.repeat(8192));
      parentPort.postMessage('wrote');
    `, { eval: true });
    worker.on('error', error => { throw error; });
    worker.once('message', async () => {
      // Output is transferred on its own message channel, so give the failed
      // write time to arrive before checking the guard and ending the fixture.
      await new Promise(resolve => setTimeout(resolve, 250));
      await worker.terminate();
      process.send({ kind: 'completed', state: guard?.status() }, () => process.disconnect());
    });
  });
  process.send({ kind: 'ready' });
}

function closedPipeFixture(channel, guarded) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, ['--fixture', channel, guarded ? 'guarded' : 'unguarded'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
    });
    let stderr = '', completed = null;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    // The unaffected stream is drained; the selected pipe is really closed.
    child.stdout.on('data', () => {});
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out: ${channel} / ${guarded}`));
    }, 10000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('message', message => {
      if (message.kind === 'ready') {
        if (channel === 'unexpected') child.send('go');
        else {
          child[channel].once('close', () => child.send('go'));
          child[channel].destroy();
        }
      } else if (message.kind === 'completed') completed = message;
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, completed, stderr });
    });
  });
}

async function main() {
  const stdout = new EventEmitter(), stderr = new EventEmitter();
  const guard = installRuntimeStdio({ stdout, stderr });
  installRuntimeStdio({ stdout, stderr });
  assert.equal(stdout.listenerCount('error'), 1, 'Guard is idempotent');
  assert.equal(stderr.listenerCount('error'), 1, 'Guard is idempotent');
  stdout.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' }));
  stderr.emit('error', Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }));
  assert.deepEqual(guard.status(), {
    stdout: { disconnected: true, code: 'EPIPE', errors: 1 },
    stderr: { disconnected: true, code: 'ERR_STREAM_DESTROYED', errors: 1 }
  });
  const unexpected = Object.assign(new Error('permission'), { code: 'EACCES' });
  assert.throws(() => stdout.emit('error', unexpected), error => error === unexpected,
    'Other output errors retain their original exception');
  const unrelated = new EventEmitter();
  assert.throws(() => unrelated.emit('error', unexpected), error => error === unexpected,
    'Other streams are unaffected');

  const baseline = await closedPipeFixture('stdout', false);
  assert.notEqual(baseline.code, 0, 'Without the fix a closed worker output pipe must reproduce the crash');
  assert.match(baseline.stderr, /EPIPE/, 'Control must reproduce the reported pipe error');
  assert.match(baseline.stderr, /ReadableWorkerStdio/, 'Control must reproduce Worker auto-forwarding');
  for (const channel of ['stdout', 'stderr']) {
    const result = await closedPipeFixture(channel, true);
    assert.equal(result.code, 0, `${channel}: app must survive a closed launcher pipe: ${result.stderr}`);
    assert.equal(result.completed?.state[channel].disconnected, true, `${channel}: actual pipe error observed`);
    assert.equal(result.completed.state[channel].code, 'EPIPE');
  }
  const realError = await closedPipeFixture('unexpected', true);
  assert.notEqual(realError.code, 0, 'The guard must not convert unrelated errors to success');
  assert.match(realError.stderr, /EACCES/);
  assert.match(realError.stderr, /Non-pipe output failure must remain visible/);
  console.log('Runtime stdio regression: reproduced Worker EPIPE; stdout/stderr survive closed pipes; unrelated errors still fail.');
}
