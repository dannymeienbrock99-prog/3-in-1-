'use strict';
const { isAutoBroadcast } = require('./visibility.cjs');
const fs = require('node:fs');
const { atomicWrite } = require('../storage/atomic-file.cjs');
const MAX_ENTRIES = 5000;
const RETENTION_MS = 86400000;

class BroadcastEchoTracker {
  constructor({ now = Date.now, file = '', onStorageError = () => {} } = {}) {
    Object.assign(this, { now, file, onStorageError });
    this.sent = new Map(); this.pending = new Map();
    if (file) this.restore();
  }
  restore() {
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size > 2 * 1024 * 1024) throw new Error('Broadcast-Verlauf ist zu groß.');
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Ungültiger Broadcast-Verlauf.');
      for (const entry of data.entries.slice(-MAX_ENTRIES)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, value] = entry;
        if (typeof key !== 'string' || !/^(twitch|youtube):.{1,512}$/.test(key)) continue;
        if (!Number.isFinite(value?.until) || value.until <= this.now() || value.until > this.now() + RETENTION_MS) continue;
        if (!isAutoBroadcast({ meta: { sourceConnector: value.source } })) continue;
        this.sent.set(key, { source: value.source, until: value.until });
      }
    } catch { this.onStorageError('Gespeicherte Broadcast-Erkennung konnte nicht geladen werden.'); }
  }
  save() {
    if (!this.file) return;
    // A confirmed platform post must remain successful even when local storage fails.
    try { atomicWrite(this.file, JSON.stringify({ version: 1, entries: [...this.sent] })); }
    catch { this.onStorageError('Broadcast gesendet; Erkennung konnte nicht für den nächsten Programmstart gespeichert werden.'); }
  }
  begin(platform) {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    const pending = this.pending.get(platform) || new Set();
    this.pending.set(platform, pending); pending.add(promise);
    return () => { pending.delete(promise); if (!pending.size) this.pending.delete(platform); release(); };
  }
  remember({ platform, id, source }) {
    if (!['twitch', 'youtube'].includes(platform) || typeof id !== 'string' || !id || id.length > 512) return;
    if (!isAutoBroadcast({ meta: { sourceConnector: source } })) return;
    this.sent.set(`${platform}:${id}`, { source, until: this.now() + RETENTION_MS });
    for (const [key, value] of this.sent) if (value.until <= this.now()) this.sent.delete(key);
    while (this.sent.size > MAX_ENTRIES) this.sent.delete(this.sent.keys().next().value);
    this.save();
  }
  async ingest(message, connector, deliver) {
    // Some chat transports deliver the echo before the HTTP send response.
    await Promise.all([...(this.pending.get(message.platform) || [])]);
    const entry = this.sent.get(`${message.platform}:${message.id}`);
    deliver(message, entry && entry.until > this.now() ? entry.source : connector);
  }
}
module.exports = { BroadcastEchoTracker };
