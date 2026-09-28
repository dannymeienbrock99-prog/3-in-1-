'use strict';
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const AUDIO_TYPES = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'mp4', 'webm']);
const VIDEO_TYPES = new Set(['mp4', 'webm']);
const gain = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 1;

// One app window owns playback, even when the detached chat is also open.
class AudioOutputService {
  constructor({ getConfig, getPlayers, overlay, onWarning = () => {} }) {
    this.getConfig = getConfig; this.getPlayers = getPlayers;
    this.overlay = overlay; this.onWarning = onWarning;
    this.ready = new Set(); this.active = new Map(); this.playerCleanup = new Map();
  }
  registerPlayer(sender) {
    if (!this.getPlayers().includes(sender) || this.ready.has(sender.id)) return;
    this.ready.add(sender.id);
    const detach = () => {
      sender.removeListener('destroyed', closed);
      sender.removeListener('did-start-navigation', navigating);
      this.ready.delete(sender.id);
      this.playerCleanup.delete(sender);
    };
    const closed = () => {
      detach();
      for (const job of [...this.active.values()]) {
        if (job.sender === sender) job.finish(new Error('Das Fenster für die Tonausgabe wurde geschlossen oder neu geladen.'));
      }
    };
    const navigating = (details, _url, isInPlace, isMainFrame) => {
      const mainFrame = details?.isMainFrame ?? isMainFrame;
      const sameDocument = details?.isSameDocument ?? isInPlace;
      if (mainFrame === true && sameDocument !== true) closed();
    };
    this.playerCleanup.set(sender, detach);
    sender.once('destroyed', closed);
    sender.on('did-start-navigation', navigating);
  }
  acknowledge(sender, result) {
    const job = this.active.get(result?.id);
    if (!job || job.sender !== sender) return;
    if (!result.ok) return job.finish(new Error(String(result.error || 'Ton konnte nicht abgespielt werden.')));
    if (result.warning) { try { this.onWarning(String(result.warning)); } catch {} }
    job.finish(null, { ok: true, completed: true, deviceId: result.deviceId, warning: result.warning });
  }
  async run(event, options = {}) {
    const data = event.data || {}, config = this.getConfig();
    const media = (config.media || []).find(item => item.id === data.mediaId);
    const type = String(media?.type || data.mediaType || '').toLowerCase();
    if (event.type !== 'media' || !AUDIO_TYPES.has(type)) return this.overlay.runAction(event, options);
    if (!media?.path || !fs.existsSync(media.path)) throw new Error('Mediendatei für die Tonausgabe nicht gefunden.');
    const output = config.audioOutput || {};
    const volume = gain(data.volume ?? 1) * gain(output.volume ?? 1);
    if (output.mode === 'obs') return this.overlay.runAction({ ...event, data: { ...data, volume, muted: false } }, options);
    return this.play({ url: pathToFileURL(media.path).href, mediaName: media.name,
      deviceId: output.deviceId || 'default', volume,
      durationSeconds: Math.max(0, Number(data.durationSeconds) || 0)
    }, options, VIDEO_TYPES.has(type) ? event : null);
  }
  async playSound(item, { signal } = {}) {
    const media = this.getConfig().media?.find(value => value.id === item.soundMediaId);
    if (!media || !AUDIO_TYPES.has(String(media.type).toLowerCase())) throw new Error('Der ausgewählte Broadcast-Ton ist nicht mehr verfügbar.');
    return this.run({ type: 'media', data: { mediaId: media.id, mediaType: media.type, volume: 1 } }, { timeoutMs: 120000, signal });
  }
  test(output = {}) {
    if (output.mode === 'obs') throw new Error('Für den Testton bitte „Über Batto abspielen“ wählen.');
    const volume = Number(output.volume ?? 1);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Lautstärke muss zwischen 0 und 100 % liegen.');
    if (typeof output.deviceId !== 'string' || output.deviceId.length > 1024) throw new Error('Bitte ein gültiges Ausgabegerät auswählen.');
    return this.play({ testTone: true, deviceId: output.deviceId || 'default', volume }, { timeoutMs: 10000 });
  }
  play(payload, { signal, timeoutMs = 30000 } = {}, visualEvent = null) {
    if (signal?.aborted) return Promise.reject(new Error('Ton abgebrochen.'));
    const sender = this.getPlayers().find(player => player && !player.isDestroyed() && this.ready.has(player.id));
    if (!sender) return Promise.reject(new Error('Die Tonausgabe ist noch nicht bereit. Bitte das Batto-Fenster öffnen.'));
    if (this.active.size >= 16) return Promise.reject(new Error('Zu viele gleichzeitige Töne. Bitte kurz warten.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let timer, finished = false;
      const cancel = () => finish(new Error('Ton abgebrochen.'));
      const finish = (error, result) => {
        if (finished) return;
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.active.delete(id);
        try { if (!sender.isDestroyed()) sender.send('audio:cancel', { id }); } catch {}
        try { if (visualEvent) this.overlay.broadcast({ type: 'action:cancel', id }); } catch {}
        error ? reject(error) : resolve(result);
      };
      this.active.set(id, { sender, finish });
      timer = setTimeout(() => finish(new Error('Die Tonausgabe hat nicht rechtzeitig geantwortet.')), Math.max(250, Math.min(120000, Number(timeoutMs) || 30000)));
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        if (visualEvent) this.overlay.broadcast({ type: 'event', data: { ...visualEvent, event: 'media', data: { ...visualEvent.data, muted: true, audioOwner: 'app', overlayActionId: id } } });
        sender.send('audio:play', { ...payload, id });
      } catch (error) { finish(error); }
    });
  }
  stop() {
    for (const job of [...this.active.values()]) job.finish(new Error('Tonausgabe beendet.'));
    for (const detach of [...this.playerCleanup.values()]) detach();
    this.ready.clear();
  }
}
module.exports = { AudioOutputService };
