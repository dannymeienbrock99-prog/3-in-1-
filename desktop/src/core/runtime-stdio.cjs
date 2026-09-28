'use strict';

// A Windows launcher may close its output pipes while the app keeps running.
// Worker stdout/stderr is forwarded to these streams by Node itself; without
// an error listener that forwarding can turn EPIPE into an uncaught exception.
// Keep this local to the two output streams. Other runtime errors still throw.
const guards = new WeakMap();
const disconnectedCodes = new Set(['EPIPE', 'ERR_STREAM_DESTROYED']);

function guardOutput(stream) {
  if (!stream || typeof stream.on !== 'function') return null;
  if (guards.has(stream)) return guards.get(stream);
  const state = { disconnected: false, code: '', errors: 0 };
  stream.on('error', error => {
    if (!disconnectedCodes.has(error?.code)) throw error;
    state.disconnected = true;
    state.code = error.code;
    state.errors += 1;
    // Never report a broken output pipe by writing to that same pipe.
  });
  guards.set(stream, state);
  return state;
}

function installRuntimeStdio({ stdout = process.stdout, stderr = process.stderr } = {}) {
  const output = guardOutput(stdout);
  const errors = guardOutput(stderr);
  return {
    status: () => ({
      stdout: output ? { ...output } : null,
      stderr: errors ? { ...errors } : null
    })
  };
}

module.exports = { installRuntimeStdio };
