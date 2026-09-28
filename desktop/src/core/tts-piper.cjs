'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PIPER_VOICE_ID = 'piper:de_DE-thorsten-medium';
const PIPER_VOICE_NAME = 'Thorsten (Piper, Deutsch)';
const MAX_WAV_BYTES = 32 * 1024 * 1024;

function inspectPcmWav(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 44 || stat.size > MAX_WAV_BYTES) throw new Error('Piper hat keine gültige WAV-Datei erzeugt.');
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(12);
    if (fs.readSync(fd, header, 0, 12, 0) !== 12 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Piper-Ausgabe ist kein WAV-Audio.');
    if (header.readUInt32LE(4) + 8 !== stat.size) throw new Error('Die erzeugte WAV-Datei ist unvollständig.');
    let format, dataBytes = 0;
    for (let offset = 12; offset + 8 <= stat.size;) {
      const chunk = Buffer.alloc(8);
      fs.readSync(fd, chunk, 0, 8, offset);
      const type = chunk.toString('ascii', 0, 4), size = chunk.readUInt32LE(4);
      if (offset + 8 + size > stat.size) throw new Error('Die erzeugte WAV-Datei ist unvollständig.');
      if (type === 'fmt ') {
        if (size < 16) throw new Error('Ungültiges WAV-Format.');
        const fmt = Buffer.alloc(16);
        fs.readSync(fd, fmt, 0, 16, offset + 8);
        format = { encoding: fmt.readUInt16LE(0), channels: fmt.readUInt16LE(2), sampleRate: fmt.readUInt32LE(4), byteRate: fmt.readUInt32LE(8), blockAlign: fmt.readUInt16LE(12), bitsPerSample: fmt.readUInt16LE(14) };
      } else if (type === 'data') dataBytes += size;
      offset += 8 + size + (size % 2);
    }
    if (!format || format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 22050 || format.bitsPerSample !== 16 || format.blockAlign !== 2 || format.byteRate !== 44100 || dataBytes < 2 || dataBytes % 2) throw new Error('Piper hat kein vollständiges Thorsten-Sprachaudio erzeugt.');
    return { sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bitsPerSample, durationMs: Math.round(dataBytes / format.byteRate * 1000), bytes: stat.size };
  } finally { fs.closeSync(fd); }
}

class PiperTtsService {
  constructor({ runtimeDir, modelPath, outputDir, timeoutMs = 30000, maxTextLength = 1000, spawnProcess = spawn } = {}) {
    this.runtimeDir = path.resolve(runtimeDir || path.join(__dirname, '../../vendor/piper/runtime'));
    this.modelPath = path.resolve(modelPath || path.join(__dirname, '../../vendor/piper/voices/de_DE-thorsten-medium.onnx'));
    this.outputDir = outputDir ? path.resolve(outputDir) : null;
    this.timeoutMs = timeoutMs;
    this.maxTextLength = maxTextLength;
    this.spawnProcess = spawnProcess;
    this.active = new Set();
  }

  status() {
    const required = [path.join(this.runtimeDir, 'piper.exe'), path.join(this.runtimeDir, 'piper_phonemize.dll'), path.join(this.runtimeDir, 'espeak-ng.dll'), path.join(this.runtimeDir, 'onnxruntime.dll'), path.join(this.runtimeDir, 'espeak-ng-data', 'phontab'), this.modelPath, `${this.modelPath}.json`];
    const available = required.every(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
    return { available, voiceId: PIPER_VOICE_ID, voiceName: PIPER_VOICE_NAME, language: 'de-DE', local: true, supportsPitch: false, ...(!available ? { error: 'Die lokale Thorsten-Stimme ist nicht vollständig installiert.' } : {}) };
  }

  async synthesize(text, { rate = 1, signal } = {}) {
    const phrase = String(text ?? '').trim();
    if (!phrase) throw new Error('Bitte einen Text zum Vorlesen eingeben.');
    if (phrase.length > this.maxTextLength) throw new Error(`Der Text darf höchstens ${this.maxTextLength} Zeichen enthalten.`);
    if (phrase.includes('\0')) throw new Error('Der Text enthält ein ungültiges Steuerzeichen.');
    if (!Number.isFinite(Number(rate)) || Number(rate) < 0.25 || Number(rate) > 4) throw new Error('Die Sprechgeschwindigkeit muss zwischen 0,25 und 4 liegen.');
    if (signal?.aborted) throw new Error('Sprachausgabe abgebrochen.');
    const status = this.status();
    if (!status.available) throw new Error(status.error);
    if (!this.outputDir) throw new Error('Der Ordner für die Sprachausgabe fehlt.');
    if (this.active.size) throw new Error('Die lokale Stimme liest bereits einen Text vor.');
    fs.mkdirSync(this.outputDir, { recursive: true });
    const filePath = path.join(this.outputDir, `piper-${crypto.randomUUID()}.wav`);
    const args = ['--model', this.modelPath, '--config', `${this.modelPath}.json`, '--output_file', filePath, '--length_scale', String(1 / Number(rate))];
    const job = { child: null, cancel: null };
    this.active.add(job);
    try {
      await new Promise((resolve, reject) => {
        let child, failure, settled = false, timer;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        const finish = error => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(); };
        const abort = () => job.cancel?.(new Error('Sprachausgabe abgebrochen.'));
        job.cancel = error => { failure ||= error; if (child && !child.killed) child.kill(); };
        try {
          child = this.spawnProcess(path.join(this.runtimeDir, 'piper.exe'), args, { cwd: this.runtimeDir, windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'ignore'] });
          job.child = child;
          child.once('error', error => finish(new Error(`Die lokale Stimme konnte nicht gestartet werden: ${error.message}`)));
          child.once('close', code => finish(failure || (code === 0 ? null : new Error(`Piper konnte den Text nicht erzeugen (Status ${code}).`))));
          child.stdin.on('error', () => { /* Process error/close provides the actual synthesis result. */ });
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => job.cancel(new Error('Die lokale Sprachausgabe hat zu lange gebraucht.')), this.timeoutMs);
          if (signal?.aborted) abort();
          else child.stdin.end(`${phrase}\n`, 'utf8');
        } catch (error) { finish(error); }
      });
      return { filePath, mimeType: 'audio/wav', voiceId: PIPER_VOICE_ID, ...inspectPcmWav(filePath) };
    } catch (error) {
      try { fs.unlinkSync(filePath); } catch {}
      throw error;
    } finally { this.active.delete(job); }
  }

  stop() { for (const job of this.active) job.cancel?.(new Error('Sprachausgabe abgebrochen.')); }
}

module.exports = { PiperTtsService, PIPER_VOICE_ID, PIPER_VOICE_NAME, inspectPcmWav };
