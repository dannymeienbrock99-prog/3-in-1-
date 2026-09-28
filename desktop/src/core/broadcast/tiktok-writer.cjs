'use strict';
class TikTokWriter {
  constructor({ getConfig, getStreamerBot, fetchImpl = fetch }) { this.getConfig = getConfig; this.getStreamerBot = getStreamerBot; this.fetchImpl = fetchImpl; this.echoes = []; }
  async send(text, { source = 'manual' } = {}) {
    const config = this.getConfig(), cfg = config.platforms.tikfinity, actionId = config.streamerbot?.tiktokActionId;
    if (!cfg.sendEnabled) throw new Error('TikTok-Senden unter Plattformen aktivieren und Streamer.bot einrichten.');
    const username = String(cfg.senderUsername || '').trim().replace(/^@/, '').toLowerCase();
    if (!username) throw new Error('TikTok-Benutzername des sendenden Kontos fehlt.');
    const port = Number(cfg.streamerbotPort || 7474);
    if (!actionId && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error('Ungültiger Streamer.bot-Port.');
    const message = String(text || '').trim();
    if (!message || message.length > 500) throw new Error('Nachricht muss 1 bis 500 Zeichen haben.');
    const entry = { username, message, source, expires: Date.now() + 120000 };
    this.echoes = this.echoes.filter(item => item.expires > Date.now()).slice(-99);
    this.echoes.push(entry);
    try {
      if (actionId) {
        const adapter = this.getStreamerBot?.();
        if (!adapter) throw new Error('Streamer.bot-Verbindung ist nicht verfügbar.');
        if (!adapter.status().connected) await adapter.connect();
        const result = await adapter.execute(actionId, { message }, undefined, 10000);
        return { ...result, ok:true, mode:'tiktok-queued', delivery:'queued', actionId };
      }
      // Existing installations retain their configured HTTP route until a shared template is chosen.
      const response = await this.fetchImpl(`http://127.0.0.1:${port}/DoAction`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ action: { name: 'Batto TikTok Broadcast' }, args: { message } })
      });
      if (response.status !== 204) {
        this.echoes = this.echoes.filter(item => item !== entry);
        throw new Error(`Streamer.bot hat den Auftrag nicht bestätigt (HTTP ${response.status}). Aktion „Batto TikTok Broadcast“ prüfen.`);
      }
      return { ok: true, mode: 'tiktok-queued', delivery: 'queued' };
    } catch (error) {
      // Do not repeat a potentially accepted local action after an ambiguous timeout.
      const failure = new Error(error.message?.startsWith('Streamer.bot') ? error.message : 'Streamer.bot nicht erreichbar oder Versandstatus unklar. Verbindung und gewählte Vorlage prüfen.');
      failure.retryable = false;
      throw failure;
    }
  }
  sourceFor(message, fallback) {
    if (message.platform !== 'tiktok') return fallback;
    this.echoes = this.echoes.filter(item => item.expires > Date.now());
    const username = String(message.username || '').replace(/^@/, '').toLowerCase();
    const text = String(message.message || message.text || '').trim();
    const index = this.echoes.findIndex(item => item.username === username && item.message === text);
    if(index<0)return fallback;
    const [entry]=this.echoes.splice(index,1);
    return entry.source;
  }
}
module.exports = { TikTokWriter };
