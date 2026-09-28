'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function verifyPiperBundle(root = path.resolve(__dirname, '../vendor/piper')) {
  root = path.resolve(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.voiceId, 'piper:de_DE-thorsten-medium');
  assert.equal(manifest.runtimeRelease, '2023.11.14-2');
  let bytes = 0;
  for (const item of manifest.files) {
    const file = path.resolve(root, item.path);
    assert.ok(file.startsWith(root + path.sep), 'Manifest path must stay within bundle');
    assert.ok(!/\.wav$|speaker_0\.mp3$/i.test(file), 'Generated audio and voice samples must not be bundled');
    const body = fs.readFileSync(file);
    assert.equal(body.length, item.bytes, `Length mismatch: ${item.path}`);
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'), item.sha256, `Hash mismatch: ${item.path}`);
    bytes += body.length;
  }
  for (const required of ['runtime/piper.exe', 'runtime/espeak-ng.dll', 'voices/de_DE-thorsten-medium.onnx', 'voices/MODEL_CARD', 'licenses/espeak-ng-GPL-3.0.txt', 'sources/espeak-ng-0f65aa3.zip']) assert.ok(manifest.files.some(item => item.path === required), `Required bundle file missing: ${required}`);
  return { ok: true, files: manifest.files.length, bytes, voiceId: manifest.voiceId };
}
module.exports = { verifyPiperBundle };
if (require.main === module) console.log(JSON.stringify(verifyPiperBundle(process.argv[2]), null, 2));
