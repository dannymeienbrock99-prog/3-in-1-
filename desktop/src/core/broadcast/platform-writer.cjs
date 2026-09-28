'use strict';

function uncertain(message) { const error = new Error(message); error.retryable = false; return error; }

function twitchChannel(value) {
  let channel = String(value || '').trim().replace(/^#/, '');
  if (/^https?:\/\//i.test(channel)) {
    const url = new URL(channel);
    if (!['twitch.tv', 'www.twitch.tv', 'dashboard.twitch.tv'].includes(url.hostname)) throw new Error('Ungültige Twitch-Kanaladresse.');
    const parts = url.pathname.split('/').filter(Boolean);
    channel = url.hostname === 'dashboard.twitch.tv' ? (parts[0] === 'popout' && parts[1] === 'u' ? parts[2] : '') : parts[0] === 'popout' ? parts[1] : parts[0];
  }
  if (!/^[a-zA-Z0-9_]+$/.test(channel || '')) throw new Error('Twitch-Kanal fehlt oder ist ungültig.');
  return channel.toLowerCase();
}

// Credentials are supplied by Windows Secure Storage, never by the general config.
class PlatformWriter {
  constructor({ getConfig, getToken, fetchImpl = fetch, onSent = () => {} }) {
    Object.assign(this, { getConfig, getToken, fetchImpl, onSent });
  }

  async request(url, token, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(url, { ...options, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
        signal: AbortSignal.timeout(10000) });
    } catch {
      throw uncertain('Plattform nicht erreichbar. Versandstatus unbekannt; vor erneutem Senden den Plattform-Chat prüfen.');
    }
    if (response.status === 401) throw new Error('Anmeldung abgelaufen oder ungültig. Schreibzugang erneut verbinden.');
    if (response.status === 403) throw new Error('Keine Schreibberechtigung oder Live-Chat geschlossen.');
    if (response.status === 429) throw new Error('Plattform-Sendelimit erreicht. Später erneut versuchen.');
    if (!response.ok) throw uncertain(`Plattform-Anfrage fehlgeschlagen (HTTP ${response.status}).`);
    try { return await response.json(); }
    catch { throw uncertain('Ungültige Plattform-Antwort. Versandstatus unbekannt.'); }
  }

  async validateTwitch(token) {
    const identity = await this.request('https://id.twitch.tv/oauth2/validate', token);
    if (!identity.user_id || !identity.client_id || !identity.scopes?.includes('user:write:chat')) {
      throw new Error('Twitch benötigt einen Benutzerzugang mit user:write:chat.');
    }
    return identity;
  }

  async send(platform, text, { source = 'manual' } = {}) {
    const token = await this.getToken(platform);
    if (!token) throw new Error(`${platform}: Schreibzugang fehlt. Unter Plattformen verbinden.`);
    const message = String(text || '').trim();
    if (!message || message.length > 500) throw new Error('Nachricht muss 1 bis 500 Zeichen enthalten.');
    const config = this.getConfig().platforms;
    let id;
    if (platform === 'twitch') {
      // Validate on every send, including the first send after startup.
      const identity = await this.validateTwitch(token);
      const channel = twitchChannel(config.twitch.channel);
      const headers = { 'Client-Id': identity.client_id };
      const users = await this.request(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, token, { headers });
      const broadcaster = users.data?.[0]?.id;
      if (!broadcaster) throw new Error('Twitch-Kanal nicht gefunden.');
      const result = await this.request('https://api.twitch.tv/helix/chat/messages', token, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcaster_id: broadcaster, sender_id: identity.user_id, message })
      });
      const sent = result.data?.[0];
      if (sent?.is_sent !== true) throw new Error('Twitch hat die Nachricht nicht veröffentlicht (z. B. AutoMod oder Sendelimit).');
      id = sent.message_id;
    } else if (platform === 'youtube') {
      const liveChatId = String(config.youtube.liveChatId || '').trim();
      if (!liveChatId) throw new Error('YouTube Live Chat ID fehlt.');
      const result = await this.request('https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: message } } })
      });
      id = result.id;
    } else throw new Error('Für diese Plattform ist noch keine Schreibschnittstelle angebunden.');
    if (!id) throw uncertain('Plattform hat keine Nachrichten-ID bestätigt. Versandstatus unbekannt.');
    this.onSent({ platform, id, text: message, source });
    return { ok: true, mode: platform, messageId: id };
  }
}

module.exports = { PlatformWriter };
