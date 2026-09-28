'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const { PiperTtsService, PIPER_VOICE_ID, inspectPcmWav } = require('../src/core/tts-piper.cjs');

function wav() {
  const pcm = Buffer.alloc(4410);
  for (let n = 0; n < pcm.length / 2; n++) pcm.writeInt16LE(Math.round(Math.sin(n / 10) * 5000), n * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(22050, 24); h.writeUInt32LE(44100, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-piper-regression-'));
  const runtimeDir = path.join(temp, 'runtime'), modelPath = path.join(temp, 'voice.onnx'), outputDir = path.join(temp, 'output');
  const fixture = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture'); };
  for (const name of ['piper.exe', 'piper_phonemize.dll', 'espeak-ng.dll', 'onnxruntime.dll', 'espeak-ng-data/phontab']) fixture(path.join(runtimeDir, name));
  fixture(modelPath); fixture(`${modelPath}.json`);
  let call, mode = 'ok', killed = 0;
  const fakeSpawn = (exe, args, options) => {
    const child = new EventEmitter();
    call = { exe, args, options, text: '' };
    child.stdin = new Writable({ write(chunk, _encoding, done) { call.text += chunk.toString('utf8'); done(); } });
    child.kill = () => { killed++; child.killed = true; setImmediate(() => child.emit('close', null)); return true; };
    const out = args[args.indexOf('--output_file') + 1];
    child.stdin.once('finish', () => {
      if (mode === 'hang') { fs.writeFileSync(out, 'partial'); return; }
      fs.writeFileSync(out, mode === 'malformed' ? 'not audio' : wav());
      setImmediate(() => child.emit('close', mode === 'fail' ? 1 : 0));
    });
    return child;
  };
  const svc = new PiperTtsService({ runtimeDir, modelPath, outputDir, spawnProcess: fakeSpawn, timeoutMs: 20 });
  try {
    assert.equal(svc.status().available, true);
    const phrase = 'Schön! $() ` --output_file böse.wav\nNoch ein Satz.';
    const result = await svc.synthesize(phrase, { rate: 2 });
    assert.equal(result.voiceId, PIPER_VOICE_ID);
    assert.equal(result.durationMs, 100);
    assert.equal(call.text, `${phrase}\n`, 'Arbitrary chat text goes only to UTF-8 stdin');
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.args.at(-1), '0.5', 'Rate maps to inverse Piper length scale');
    assert.ok(!call.args.some(arg => arg.includes('$()')));
    await assert.rejects(svc.synthesize(''), /Text/);
    await assert.rejects(svc.synthesize('x'.repeat(1001)), /1000/);
    await assert.rejects(svc.synthesize('text', { rate: NaN }), /geschwindigkeit/);
    const preabort = new AbortController(); preabort.abort();
    await assert.rejects(svc.synthesize('text', { signal: preabort.signal }), /abgebrochen/);
    mode = 'malformed';
    await assert.rejects(svc.synthesize('bad output'), /WAV/);
    mode = 'fail';
    await assert.rejects(svc.synthesize('failed helper'), /Status 1/);
    mode = 'hang';
    const cancelled = svc.synthesize('cancelled helper');
    await assert.rejects(svc.synthesize('overlap'), /bereits/);
    svc.stop();
    await assert.rejects(cancelled, /abgebrochen/);
    await assert.rejects(svc.synthesize('timeout helper'), /zu lange/);
    assert.equal(killed, 2);
    assert.deepEqual(fs.readdirSync(outputDir), [path.basename(result.filePath)], 'Partial/failed WAVs are removed');
    assert.equal(svc.active.size, 0);
    const invalid = path.join(temp, 'truncated.wav');
    fs.writeFileSync(invalid, wav().subarray(0, 46));
    assert.throws(() => inspectPcmWav(invalid), /unvollständig/);
    fs.unlinkSync(path.join(runtimeDir, 'espeak-ng.dll'));
    assert.equal(svc.status().available, false);
    await assert.rejects(svc.synthesize('missing runtime'), /nicht vollständig/);
    console.log('Piper boundary regression: PASS (UTF-8, no shell, rate, file validation, overlap, cancellation, timeout, cleanup, missing runtime)');
  } finally {
    svc.stop();
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('batto-piper-regression-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }

  if (process.argv.includes('--integration')) {
    const repo = path.resolve(__dirname, '..');
    const bundle = path.join(repo, 'vendor/piper');
    const artifactDir = path.resolve(repo, '../../outputs/Piper/integration');
    fs.mkdirSync(artifactDir, { recursive: true });
    const real = new PiperTtsService({ runtimeDir: path.join(bundle, 'runtime'), modelPath: path.join(bundle, 'voices/de_DE-thorsten-medium.onnx'), outputDir: artifactDir });
    assert.equal(real.status().available, true, 'Packaged Thorsten runtime and model must exist');
    const phrase = 'Hallo Batto! Schön, dass du da bist. Diese Nachricht entsteht vollständig auf deinem Computer.';
    const first = await real.synthesize(phrase);
    const fast = await real.synthesize(phrase, { rate: 1.5 });
    const second = await real.synthesize('Ein anderer Text: Danke für deinen Besuch im Livestream!');
    const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(first.sampleRate, 22050);
    assert.ok(first.durationMs > 1000);
    assert.ok(fast.durationMs < first.durationMs * 0.9, 'Speed setting must shorten actual generated speech');
    assert.notEqual(sha(first.filePath), sha(second.filePath), 'Different text must produce different speech');
    assert.ok(fs.readFileSync(first.filePath).subarray(44).some(value => value !== 0), 'Real synthesized PCM must be non-silent');
    const report = { ok: true, voice: PIPER_VOICE_ID, audioPlayed: false, syntheticTestFixtureUsedForNativeSynthesis: false, generated: [first, fast, second].map(item => ({ ...item, sha256: sha(item.filePath) })) };
    fs.writeFileSync(path.join(artifactDir, 'result.json'), JSON.stringify(report, null, 2));
    console.log(`Piper native synthesis: PASS (${first.durationMs} ms normal, ${fast.durationMs} ms faster; different arbitrary texts; no playback)`);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
