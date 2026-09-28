'use strict';
const { randomUUID } = require('node:crypto');
const PLATFORMS = ['local', 'cng', 'twitch', 'tiktok', 'youtube'];
const LIMIT = 100;
function number(value, fallback, min, max, label) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: Wert zwischen ${min} und ${max} erforderlich.`);
  return n;
}
function normalizeItem(input = {}, id = input.id || randomUUID()) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Ungültige Broadcast-ID.');
  if (!Array.isArray(input.messages) || input.messages.length > 200) throw new Error('1 bis 200 Nachrichten pro Broadcast erforderlich.');
  const messages = input.messages.map(v => String(v).trim()).filter(Boolean);
  if (!messages.length || messages.some(v => v.length > 500)) throw new Error('Nachrichten dürfen nicht leer sein und höchstens 500 Zeichen enthalten.');
  const targets = [...new Set(input.targets || [])];
  if (!targets.length || targets.some(v => !PLATFORMS.includes(v))) throw new Error('Mindestens ein gültiges Ausgabeziel auswählen.');
  const min = number(input.minIntervalSeconds, 300, 30, 86400, 'Mindestintervall');
  const max = number(input.maxIntervalSeconds, 900, min, 86400, 'Höchstintervall');
  if (input.soundMediaId !== undefined && (typeof input.soundMediaId !== 'string' || input.soundMediaId.length>100)) throw new Error('Ungültige Audiodatei für Auto-Broadcast.');
  return {
    id, name: String(input.name || 'Auto-Broadcast').trim().slice(0, 100) || 'Auto-Broadcast',
    enabled: input.enabled === true, targets, messages,
    soundMediaId: (input.soundMediaId || '').trim(),
    chainId: typeof input.chainId==='string' ? input.chainId.trim().slice(0,100) : '',
    intervalSeconds: number(input.intervalSeconds, 600, 30, 86400, 'Intervall'),
    intervalMode: input.intervalMode === 'random' ? 'random' : 'fixed',
    minIntervalSeconds: min, maxIntervalSeconds: max,
    startDelaySeconds: number(input.startDelaySeconds, 30, 0, 86400, 'Startverzögerung'),
    mode: input.mode === 'random' ? 'random' : 'sequence',
    avoidRepeat: input.avoidRepeat !== false,
    onlyWhenLive: input.onlyWhenLive === true,
    onlyWhenChatActive: input.onlyWhenChatActive === true,
    activityWindowSeconds: number(input.activityWindowSeconds, 300, 10, 86400, 'Aktivitätsfenster'),
    minChatMessages: number(input.minChatMessages, 1, 1, 5000, 'Chat-Nachrichten'),
    retryOnError: input.retryOnError === true,
    retryDelaySeconds: number(input.retryDelaySeconds, 30, 5, 3600, 'Wiederholungsverzögerung')
  };
}
function fromLegacy(config = {}) {
  if (Array.isArray(config.items)) return config.items;
  const messages = Array.isArray(config.messages) ? config.messages.filter(v => String(v).trim()) : [];
  return messages.length ? [normalizeItem({ ...config, id: 'legacy-broadcast', name: 'Übernommener Auto-Broadcast', messages, enabled: config.enabled === true, targets: config.targets?.length ? config.targets : ['cng'] })] : [];
}
class BroadcastScheduler {
  constructor({ send, isLive = () => false, now = Date.now, random = Math.random, onStatus = () => {}, onSound, onActions } = {}) {
    if (typeof send !== 'function') throw new Error('Broadcast-Ausgabe fehlt.');
    Object.assign(this, { send, isLive, now, random, onStatus, onSound, onActions });
    this.entries = new Map(); this.activity = new Map(); this.lastTarget = new Map();
    this.lastGlobal = -Infinity; this.timer = null; this.stopped = false; this.ticking = false;
    this.enabled = false; this.globalGap = 3000; this.platformGap = 5000;
  }
  configure(config = {}) {
    const items = fromLegacy(config);
    if (items.length > LIMIT) throw new Error(`Höchstens ${LIMIT} Auto-Broadcasts erlaubt.`);
    const normalized = items.map(item => normalizeItem(item));
    if (new Set(normalized.map(v => v.id)).size !== normalized.length) throw new Error('Doppelte Broadcast-ID.');
    const wasEnabled = this.enabled;
    this.enabled = config.enabled === true;
    this.globalGap = number(config.globalMinGapSeconds, 3, 0, 3600, 'Globaler Mindestabstand') * 1000;
    this.platformGap = number(config.platformMinGapSeconds, 5, 0, 3600, 'Plattform-Mindestabstand') * 1000;
    const ids = new Set(normalized.map(v => v.id));
    for (const [id, entry] of this.entries) if (!ids.has(id)) { entry.cancelled = true; this.cancelSounds(entry); this.entries.delete(id); }
    for (const item of normalized) {
      const fingerprint = JSON.stringify(item); const old = this.entries.get(item.id);
      if (old && old.fingerprint === fingerprint) {
        if (!wasEnabled && this.enabled) old.nextAt = this.now() + item.startDelaySeconds * 1000;
        if (!this.enabled) { old.pending = null; this.cancelSounds(old); }
        continue;
      }
      if (old) { old.cancelled = true; this.cancelSounds(old); }
      this.entries.set(item.id, { item, fingerprint, nextAt: this.now() + item.startDelaySeconds * 1000, cursor: old?.cursor || 0, lastIndex: old?.lastIndex ?? -1, sent: old?.sent || 0, lastAt: old?.lastAt || null, lastResult: old?.lastResult || null, lastError: '', lastSoundError: '', lastActionError: '', actionRuns:new Set(), soundRuns: new Set(), latestSound: null, pending: null, cancelled: false });
    }
    this.notify();
  }
  noteChat(platform, timestamp = this.now()) {
    const recent = (this.activity.get(platform) || []).filter(ts => timestamp - ts < 86400000);
    recent.push(timestamp); this.activity.set(platform, recent.slice(-5000));
  }
  blocked(entry) {
    const item = entry.item;
    if (item.onlyWhenLive && !this.isLive()) return 'Wartet auf OBS LIVE';
    if (item.onlyWhenChatActive) {
      const count = item.targets.reduce((sum, p) => sum + (this.activity.get(p) || []).filter(ts => this.now() - ts <= item.activityWindowSeconds * 1000).length, 0);
      if (count < item.minChatMessages) return 'Wartet auf Chat-Aktivität';
    }
    return '';
  }
  nextInterval(item) {
    const seconds = item.intervalMode === 'random' ? item.minIntervalSeconds + this.random() * (item.maxIntervalSeconds - item.minIntervalSeconds) : item.intervalSeconds;
    return Math.round(seconds * 1000);
  }
  choose(entry) {
    const { item } = entry; let index;
    if (item.mode === 'random') {
      const indices = item.messages.map((_, i) => i).filter(i => !item.avoidRepeat || item.messages.length === 1 || i !== entry.lastIndex);
      index = indices[Math.min(indices.length - 1, Math.floor(this.random() * indices.length))];
    } else index = entry.cursor++ % item.messages.length;
    entry.lastIndex = index; return item.messages[index];
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this.tick().catch(() => {}), 500);
    this.timer.unref?.();
  }
  async tick() {
    if (this.stopped || this.ticking || !this.enabled) return;
    this.ticking = true;
    try {
      const entries = [...this.entries.values()].sort((a, b) => a.nextAt - b.nextAt);
      for (const entry of entries) {
        if (!this.valid(entry) || !entry.item.enabled || entry.nextAt > this.now()) continue;
        const blocked = this.blocked(entry);
        if (blocked) { entry.lastResult = blocked; entry.nextAt = this.now() + 1000; continue; }
        if (this.now() - this.lastGlobal < this.globalGap) continue;
        if (!entry.pending) {
          entry.pending = { source:'broadcast-run:'+randomUUID(), text: this.choose(entry), remaining: [...entry.item.targets], failures: [], retry: false, success: 0, soundPlayed: false, actionsPlayed:false };
          entry.lastSoundError = '';
        }
        const pending = entry.pending;
        for (const target of [...pending.remaining]) {
          if (!this.valid(entry) || !this.enabled || this.stopped) break;
          if (this.now() - this.lastGlobal < this.globalGap) break;
          if (this.now() - (this.lastTarget.get(target) ?? -Infinity) < this.platformGap) continue;
          // Reserve rate slots BEFORE awaiting IO. The single tick owner prevents parallel duplicate sends.
          this.lastTarget.set(target, this.now()); this.lastGlobal = this.now();
          pending.remaining = pending.remaining.filter(p => p !== target);
          try {
            const result = await this.send(target, pending.text, { source: pending.source });
            if (result?.ok === false) throw new Error(result.error || 'Ausgabe fehlgeschlagen');
            pending.success++; entry.sent++; entry.lastAt = this.now();
            entry.lastError = ''; entry.lastResult = result?.mode === 'tiktok-queued' ? 'TikTok: an Streamer.bot übergeben (Zustellung nicht bestätigt)' : result?.mode === 'cng-local-overlay' ? 'CNG: nur lokales Overlay' : target === 'local' ? 'Lokale Ausgabe erfolgreich' : `${target}: gesendet`;
          } catch (error) {
            entry.lastError = `${target}: ${error.message}`; entry.lastResult = 'Ausgabe fehlgeschlagen';
            if (!pending.retry && entry.item.retryOnError && error.retryable !== false) pending.failures.push(target);
          }
          // Sound is independent of chat success and must never retry successful destinations.
          if (pending.success && !pending.soundPlayed && this.valid(entry) && this.enabled && !this.stopped) {
            pending.soundPlayed = true;
            this.startSound(entry, pending.text);
          }
        }
        if (!this.valid(entry)) continue;
        if (!pending.remaining.length) {
          if (pending.failures.length) {
            pending.remaining = [...pending.failures]; pending.failures = []; pending.retry = true;
            entry.nextAt = this.now() + entry.item.retryDelaySeconds * 1000;
          } else {
            if(pending.success&&!pending.actionsPlayed&&this.enabled&&!this.stopped){pending.actionsPlayed=true;this.startActions(entry,pending.text);}
            entry.pending = null; entry.nextAt = this.now() + this.nextInterval(entry.item);
          }
        }
      }
    } finally { this.ticking = false; this.notify(); }
  }
  valid(entry) { return !entry.cancelled && this.entries.get(entry.item.id) === entry; }
  startActions(entry,text){
    if(!entry.item.chainId)return;const controller=new AbortController();entry.actionRuns.add(controller);
    this.playActions(entry.item,{source:'broadcast:'+entry.item.id,text,signal:controller.signal}).then(result=>{if(this.valid(entry)&&!controller.signal.aborted){entry.lastActionError=result.ok?'':result.error;this.notify();}}).finally(()=>entry.actionRuns.delete(controller));
  }
  async playActions(item,context){
    if(!item.chainId)return undefined;
    try{if(typeof this.onActions!=='function')throw new Error('Gemeinsame Aktionsketten sind nicht verfügbar.');const r=await this.onActions(item,context);if(r?.ok===false)throw new Error(r.error||'Zusatzaktionen fehlgeschlagen.');return {...r,ok:true};}catch(error){return {ok:false,error:error.message};}
  }
  cancelSounds(entry) {
    for(const controller of entry.actionRuns||[])controller.abort();entry.actionRuns?.clear();
    for (const controller of entry.soundRuns || []) controller.abort();
    entry.soundRuns?.clear(); entry.latestSound = null;
  }
  startSound(entry, text) {
    if (!entry.item.soundMediaId) return;
    const controller = new AbortController();
    entry.soundRuns.add(controller); entry.latestSound = controller;
    // Keep chat scheduling independent of playback duration. The sound owns only its completion/error.
    this.playSound(entry.item, { source: `broadcast:${entry.item.id}`, text, signal: controller.signal }).then(sound => {
      if (!controller.signal.aborted && this.valid(entry) && entry.latestSound === controller) {
        entry.lastSoundError = sound?.ok === false ? sound.error : '';
        this.notify();
      }
    }).finally(() => entry.soundRuns.delete(controller));
  }
  async playSound(item, context) {
    if (!item.soundMediaId) return undefined;
    try {
      if (typeof this.onSound !== 'function') throw new Error('Tonausgabe ist nicht verfügbar.');
      const result = await this.onSound(item, context);
      if (result?.ok === false) throw new Error(result.error || 'Audiodatei konnte nicht abgespielt werden.');
      return { ...result, ok: true };
    } catch (error) { return { ok: false, error: error.message || String(error) }; }
  }
  async test(input) {
    const item = typeof input === 'string' ? this.entries.get(input)?.item : normalizeItem(input);
    if (!item) throw new Error('Broadcast nicht gefunden.');
    const results = [];
    const source='broadcast-run:'+randomUUID();
    for (const target of item.targets) {
      try { const result = await this.send(target, item.messages[0], { source }); results.push({ target, ...result, ok: result?.ok !== false }); }
      catch (error) { results.push({ target, ok: false, error: error.message }); }
    }
    const soundResult = results.some(v => v.ok) ? await this.playSound(item, { source: 'broadcast-manual-test', text: item.messages[0] }) : undefined;
    const actionResult = results.some(v=>v.ok) ? await this.playActions(item,{source:'broadcast-manual-test',text:item.messages[0]}) : undefined;
    return { ok: results.every(v => v.ok) && actionResult?.ok!==false && soundResult?.ok!==false, results, ...(soundResult ? { soundResult } : {}), ...(actionResult ? {actionResult} : {}) };
  }
  status() {
    return { enabled: this.enabled, items: [...this.entries.values()].map(e => ({ id: e.item.id, enabled: e.item.enabled, nextAt: this.enabled && e.item.enabled ? e.nextAt : null, sent: e.sent, lastAt: e.lastAt, lastResult: e.lastResult, lastError: e.lastError, lastSoundError: e.lastSoundError, lastActionError:e.lastActionError, pending: e.pending?.remaining.length || 0 })) };
  }
  notify() { try { this.onStatus(this.status()); } catch {} }
  stop() { this.stopped = true; clearInterval(this.timer); this.timer = null; for (const e of this.entries.values()) { e.cancelled = true; this.cancelSounds(e); } }
}
module.exports = { BroadcastScheduler, normalizeItem, fromLegacy, PLATFORMS, LIMIT };
