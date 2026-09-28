'use strict';

const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

// Euler v2 interface contracts, not a gift/diamond-derived approximation:
// https://github.com/isaackogan/TikTok-Webcast-Protobuf/tree/main/src/slim/v2
// https://github.com/EulerStream/Euler-WebSocket-SDK/blob/master/src/client/types.ts
const BACKOFF = [1000, 2000, 5000, 10000, 30000];
const clone = value => JSON.parse(JSON.stringify(value));
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim().slice(0, 180) : '';
function integer(value, zero = true) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  const s = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,30}$/.test(s)) return null;
  const normalized = s.replace(/^0+(?=\d)/, '');
  return !zero && normalized === '0' ? null : normalized;
}
const id = value => integer(value, false);
function epoch(value) {
  const s = integer(value, false); if (!s) return null;
  let n = Number(s); if (n < 1e11) n *= 1000;
  return Number.isSafeInteger(n) && n >= 946684800000 && n <= 4102444800000 ? n : null;
}
function avatar(value) {
  const candidate = typeof value === 'string' ? value : (value?.urlList || value?.url || [])[0];
  try { const u = new URL(candidate); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
function enumNumber(value, prefix, names) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'string') return names[value.replace(prefix, '')] ?? null;
  return null;
}
const actionNumber = v => enumNumber(v, 'BATTLE_ACTION_', { UNKNOWN: 0, INVITE: 1, REJECT: 2, CANCEL: 3, OPEN: 4, FINISH: 5, CUT_SHORT: 6, ACCEPT: 7, QUIT_APPLY: 8, DECLINE_QUIT: 9, DECLINE_OFF_QUIT: 10, LEAVE_LINK_MIC: 11 });
const typeNumber = v => enumNumber(v, 'BATTLE_TYPE_', { UNKNOWN_BATTLE_TYPE: 0, NORMAL_BATTLE: 1, TEAM_BATTLE: 2, INDIVIDUAL_BATTLE: 3, '1_V_N': 4, TAKE_THE_STAGE: 51, GROUP_SHOW: 52 });
const reasonNumber = v => enumNumber(v, 'TRIGGER_REASON_', { UNKNOWN: 0, SCORE_UPDATE: 1, BATTLE_END: 2, OPT_OUT_UPDATE: 3, KEEP_ALIVE: 4 });

function packets(input) {
  let value = input;
  if (Buffer.isBuffer(value)) { if (value.length > 1024 * 1024) return []; value = value.toString('utf8'); }
  if (typeof value === 'string') { if (value.length > 1024 * 1024) return []; try { value = JSON.parse(value); } catch { return []; } }
  if (Array.isArray(value)) return value.slice(0, 256).flatMap(packets);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.messages)) return value.messages.slice(0, 256).flatMap(packets);
  return [value];
}
function eventName(packet) {
  return String(packet.event || packet.eventType || packet.type || '').toLowerCase().replace(/[^a-z]/g, '').replace(/^webcast/, '').replace(/message$/, '');
}

class TikTokMatchService extends EventEmitter {
  constructor({ getApiKey = () => '', WebSocketImpl = WebSocket, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    super(); this.getApiKey = getApiKey; this.WebSocketImpl = WebSocketImpl; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.config = { enabled: false, provider: 'tikfinity', username: '' }; this.socket = null; this.timer = null; this.generation = 0; this.retry = 0; this.stopped = false;
    this.retired = new Set(); this.connections = {}; this.lastMessageTime = 0; this.matchType = null; this._key = '';
    this.state = this.empty('disabled');
  }
  empty(status, error = null) { return { enabled: this.config.enabled, provider: this.config.provider, source: this.config.provider, connected: false, status, battleId: null, teams: [], endsAt: null, updatedAt: null, lastEventAt: null, error }; }
  getState() {
    const result = clone(this.state);
    if (result.status === 'live' && result.endsAt !== null && result.endsAt <= this.now()) result.status = 'awaiting-result';
    return result;
  }
  publish(patch) { this.state = { ...this.state, ...patch }; this.emit('change', this.getState()); }
  reset(status, error = null) { this.lastMessageTime = 0; this.matchType = null; this.state = this.empty(status, error); this.emit('change', this.getState()); }
  updateConfig(config = {}) {
    const next = { enabled: config.enabled === true, provider: ['euler', 'widget'].includes(config.provider) ? config.provider : 'tikfinity', username: text(config.username).replace(/^@/, '') };
    let key = ''; try { key = next.enabled && next.provider === 'euler' ? String(this.getApiKey() || '').trim() : ''; } catch { /* a locked secret is reported as missing */ }
    if (!this.stopped && JSON.stringify(next) === JSON.stringify(this.config) && key === this._key) return;
    this.shutdownSocket(); this.stopped = false; this.config = next; this._key = key; this.retry = 0; this.retired.clear();
    if (!next.enabled) return this.reset('disabled');
    if (next.provider === 'widget') return this.reset('waiting');
    if (next.provider === 'tikfinity') {
      const connection = this.connections.tikfinity || {};
      this.reset(connection.connected ? 'waiting' : 'disconnected', connection.error || null);
      return this.publish({ connected: connection.connected === true });
    }
    if (!/^[a-zA-Z0-9._]{1,64}$/.test(next.username)) return this.reset('error', 'Für Euler Stream fehlt dein gültiger TikTok-Benutzername.');
    if (!key) return this.reset('error', 'Für Euler Stream fehlt dein API-Schlüssel.');
    this.reset('disconnected'); this.connectEuler();
  }
  setConnection({ connected = false, error = null } = {}, source = 'tikfinity') {
    this.connections[source] = { connected: connected === true, error: typeof error === 'string' ? error.slice(0, 240) : null };
    if (!this.config.enabled || source !== this.config.provider) return;
    if (!connected) this.reset('disconnected', this.connections[source].error);
    else this.publish({ connected: true, error: null, status: ['disconnected', 'error'].includes(this.state.status) ? 'waiting' : this.state.status });
  }
  retire(battleId) { if (!battleId) return; this.retired.add(battleId); if (this.retired.size > 256) this.retired.delete(this.retired.values().next().value); }
  ingest(input, { source = 'tikfinity' } = {}) {
    if (!this.config.enabled || this.stopped || source !== this.config.provider) return 0;
    let handled = 0;
    for (const packet of packets(input)) {
      const name = eventName(packet);
      if (!['linkmicbattle', 'linkmicarmies', 'linkmicbattlepunishfinish'].includes(name)) continue;
      if (this.consume(name, obj(packet.data), source)) handled += 1;
    }
    return handled;
  }
  consume(name, data, source) {
    const setting = obj(data.battleSetting || data.battleSettings);
    const battleId = id(data.battleId || setting.battleId);
    const action = actionNumber(data.action);
    if (name === 'linkmicbattle' && ![3, 4, 5, 6, 11].includes(action)) return false;
    if (!battleId) {
      if (!this.state.battleId) this.publish({ status: 'unsupported', error: 'Die Datenquelle liefert keine bestätigte Match-ID. Für diese Battle-Daten ist keine sichere Anzeige möglich.', lastEventAt: this.now() });
      return false;
    }
    if (this.retired.has(battleId)) return false;
    const isEnd = name === 'linkmicbattlepunishfinish' || (name === 'linkmicbattle' && [3, 5, 6, 11].includes(action)) || (name === 'linkmicarmies' && reasonNumber(data.battleStatus) === 2);
    const isOpen = name === 'linkmicbattle' && action === 4;
    const messageTime = epoch(data.scoreUpdateTime) || epoch(data.common?.createTime) || null;
    if (messageTime && messageTime < this.lastMessageTime) return false;
    if (this.state.battleId && this.state.battleId !== battleId && !isOpen) return false;
    if (isEnd && this.state.battleId !== battleId) return false;
    if (this.state.battleId === battleId && this.state.status === 'ended') return false;
    if (this.state.battleId !== battleId && isOpen && !messageTime && this.state.battleId) return false;
    const same = this.state.battleId === battleId;
    const reportedType = typeNumber(setting.battleType);
    const kind = reportedType || (same ? this.matchType : null);
    if (![1, 2].includes(kind)) {
      this.publish({ status: 'unsupported', error: 'Dieses Match-Format liefert keine bestätigte 1-gegen-1- oder Zwei-Team-Zuordnung.', teams: [], battleId, endsAt: null, lastEventAt: this.now() });
      return false;
    }
    const previous = same ? this.state.teams : [];
    const teams = kind === 1 ? this.normalTeams(data, previous) : this.explicitTeams(data, previous);
    if (teams.length !== 2) {
      this.publish({ status: 'unsupported', error: kind === 1 ? 'Es werden genau zwei bestätigte Match-Teilnehmer benötigt.' : 'Es werden zwei bestätigte Teams mit getrennten Team-Punkteständen benötigt.', teams: [], battleId, endsAt: null, lastEventAt: this.now() });
      return false;
    }
    if (!same) { this.retire(this.state.battleId); this.lastMessageTime = 0; }
    this.matchType = kind;
    if (messageTime) this.lastMessageTime = messageTime;
    const end = epoch(setting.endTimeMs);
    // Never assume a five-minute round. Use only a supplied end time, or supplied start + duration.
    const start = epoch(setting.startTimeMs), duration = Number(setting.duration);
    const derivedEnd = start && Number.isFinite(duration) && duration > 0 && duration <= 3600 ? start + duration * 1000 : null;
    const endsAt = end || derivedEnd || (same ? this.state.endsAt : null);
    this.publish({ status: isEnd ? 'ended' : 'live', source, connected: true, battleId, teams, endsAt, updatedAt: messageTime || this.now(), lastEventAt: this.now(), error: null });
    return true;
  }
  normalTeams(data, previous) {
    const people = new Map(previous.map(team => [team.id, clone(team)]));
    const upsert = (uid, patch) => { if (!uid) return; people.set(uid, { id: uid, name: uid, points: null, avatar: '', members: [], ...people.get(uid), ...patch }); };
    for (const [key, value] of Object.entries(obj(data.anchorInfo))) {
      const user = obj(value?.user), uid = id(user.userId || key);
      if (!uid || (id(key) && id(key) !== uid)) continue;
      upsert(uid, { name: text(user.nickName || user.nickname || user.displayId) || uid, avatar: avatar(user.avatarThumb) });
    }
    if (Array.isArray(data.battleUsers)) for (const item of data.battleUsers) {
      const u = obj(item.user || item), uid = id(u.userId || item.userId);
      upsert(uid, { name: text(u.nickname || u.nickName || u.uniqueId) || uid, avatar: avatar(u.profilePictureUrl || u.avatarThumb) });
    }
    // v2 hostScore is the host's complete match score. Gift values and supporter sums are not interchangeable.
    for (const map of [data.armies, !Array.isArray(data.battleItems) ? data.battleItems : null]) for (const [key, value] of Object.entries(obj(map))) {
      const uid = id(value?.anchorIdStr || key), points = integer(value?.hostScore);
      if (!uid || (id(key) && id(key) !== uid)) continue;
      upsert(uid, points === null ? {} : { points });
    }
    for (const [key, value] of Object.entries(obj(data.battleResult))) {
      const uid = id(value?.userId || key), points = integer(value?.score);
      if (!uid || (id(key) && id(key) !== uid)) continue;
      upsert(uid, points === null ? {} : { points });
    }
    // Legacy arrays expose supporter groups, not a documented authoritative host total.
    // Their points must not be summed into a made-up match score.
    const result = [...people.values()];
    return result.length === 2 ? result : [];
  }
  explicitTeams(data, previous) {
    if (!Array.isArray(data.teamArmies) || !data.teamArmies.length) return previous.length === 2 ? previous : [];
    const result = [], seen = new Set();
    for (const team of data.teamArmies) {
      const teamId = id(team.teamId), points = integer(team.teamTotalScore);
      if (!teamId || seen.has(teamId) || points === null || !Array.isArray(team.teamUsers)) return [];
      seen.add(teamId);
      const memberIds = team.teamUsers.map(u => id(u.userIdStr || u.userId));
      if (!memberIds.length || memberIds.some(v => !v) || new Set(memberIds).size !== memberIds.length) return [];
      const members = memberIds.map(uid => { const u = obj(data.anchorInfo?.[uid]?.user); return { id: uid, name: text(u.nickName || u.displayId) || previous.flatMap(t => t.members || []).find(m => m.id === uid)?.name || uid }; });
      result.push({ id: teamId, name: members.map(m => m.name).join(' + '), points, avatar: '', members });
    }
    const allMembers = result.flatMap(t => t.members.map(m => m.id));
    return result.length === 2 && new Set(allMembers).size === allMembers.length ? result : [];
  }
  connectEuler() {
    if (this.stopped || !this.config.enabled || this.config.provider !== 'euler' || !this._key || this.socket) return;
    const generation = this.generation;
    const url = new URL('wss://ws.eulerstream.com');
    url.searchParams.set('uniqueId', this.config.username); url.searchParams.set('apiKey', this._key);
    url.searchParams.set('features.schemaVersion', 'v2'); url.searchParams.set('features.rawMessages', 'false'); url.searchParams.set('features.bundleEvents', 'true');
    url.searchParams.set('features.syntheticPresence', 'false');
    let socket;
    try { socket = new this.WebSocketImpl(url.href, { maxPayload: 1024 * 1024, handshakeTimeout: 10000 }); this.socket = socket; }
    catch { this.publish({ connected: false, status: 'error', error: 'Die Euler-Stream-Verbindung konnte nicht geöffnet werden.' }); this.scheduleReconnect(generation); return; }
    const current = () => generation === this.generation && socket === this.socket && !this.stopped;
    socket.on('open', () => { if (current()) this.setConnection({ connected: true }, 'euler'); });
    socket.on('message', raw => {
      if (!current()) return;
      const items = packets(raw);
      if (!items.length) { this.publish({ status: 'error', error: 'Euler Stream hat ein unbekanntes Nachrichtenformat geliefert.' }); return; }
      for (const packet of items) {
        const name = eventName(packet);
        if (name === 'roominfo' || name === 'tiktokconnect') { this.retry = 0; this.setConnection({ connected: true }, 'euler'); }
        else if (name === 'tiktokdisconnect' || (name === 'roomstatus' && ['offline', 'ended', 'error'].includes(packet.data?.state))) this.setConnection({ connected: false, error: 'Der TikTok-Livestream ist über Euler Stream nicht verbunden.' }, 'euler');
        else this.ingest(packet, { source: 'euler' });
      }
    });
    // Never expose socket error messages/reasons: they can contain an authenticated URL.
    socket.on('error', () => { if (current()) this.setConnection({ connected: false, error: 'Euler Stream ist momentan nicht erreichbar.' }, 'euler'); });
    socket.on('close', code => {
      if (!current()) return; this.socket = null;
      const messages = { 4401: 'Der Euler-API-Schlüssel wurde abgelehnt.', 4403: 'Der Euler-Zugang erlaubt diese Verbindung nicht.', 4404: 'Dieser TikTok-Kanal ist gerade nicht live.', 4429: 'Das Euler-Verbindungslimit wurde erreicht.', 4005: 'Der TikTok-Livestream wurde beendet.' };
      this.setConnection({ connected: false, error: messages[code] || 'Die Euler-Stream-Verbindung wurde getrennt.' }, 'euler');
      if (![1000, 4005, 4400, 4401, 4403].includes(code)) this.scheduleReconnect(generation);
    });
  }
  scheduleReconnect(generation) {
    if (generation !== this.generation || this.stopped || this.retry >= 8) return;
    this.clearTimer(this.timer); const delay = BACKOFF[Math.min(this.retry++, BACKOFF.length - 1)];
    this.timer = this.setTimer(() => { this.timer = null; if (generation === this.generation) this.connectEuler(); }, delay); this.timer?.unref?.();
  }
  shutdownSocket() { this.generation += 1; this.clearTimer(this.timer); this.timer = null; const socket = this.socket; this.socket = null; try { socket?.close(); } catch { /* stopping is idempotent */ } }
  stop() { this.stopped = true; this.shutdownSocket(); this._key = ''; this.reset('disabled'); }
}

module.exports = { TikTokMatchService, packets, integer, epoch };
