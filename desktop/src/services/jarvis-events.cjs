'use strict';
const {simulated} = require('../core/gifts/gift-registry.cjs');
const clean = (value, limit = 80) => String(value ?? '').replace(/https?:\/\/\S+/gi, 'Link').replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const integer = value => Number.isSafeInteger(number(value)) ? number(value) : null;
const format = value => value.toLocaleString('de-DE', {maximumFractionDigits: 2});
const DEFAULT_TEMPLATES = Object.freeze({
  follow: 'Danke {username} für deinen Follow.',
  like: 'Danke {username} für {likecount} Likes.',
  gift: 'Danke {username} für {giftname}. Kuss.',
  coins: 'Danke für {coins} Coins. Kuss.',
  subscription: 'Danke {username} für {submonth} Monate. Vielen lieben Dank {username}, ich küss dein Herz.'
});
const TEMPLATE_FIELDS = Object.freeze({
  follow: Object.freeze(['username', 'platform']), like: Object.freeze(['username', 'likecount', 'platform']),
  gift: Object.freeze(['username', 'giftname', 'giftcount', 'coins', 'platform']),
  coins: Object.freeze(['username', 'coins', 'giftname', 'giftcount', 'platform']),
  subscription: Object.freeze(['username', 'submonth', 'platform'])
});
const DEFAULT_EVENTS = Object.freeze({enabled: true, gifts: true, follows: true, likes: true, subscriptions: true, giftMinimum: 0, likeThreshold: 1000, cooldown: 8, giftAnnouncement: 'gift', templates: DEFAULT_TEMPLATES});
function validateTemplate(kind, value) {
  if (!Object.hasOwn(TEMPLATE_FIELDS, kind) || typeof value !== 'string' || !value.trim() || value.length > 500) return {ok: false, error: 'Bitte einen Text mit 1 bis 500 Zeichen verwenden.'};
  const tokens = [...value.matchAll(/\{([^{}]*)\}/g)].map(match => match[1]);
  if (/[{}]/.test(value.replace(/\{[^{}]*\}/g, '')) || tokens.some(token => !TEMPLATE_FIELDS[kind].includes(token))) return {ok: false, error: 'Dieser Text enthält einen unbekannten Platzhalter.'};
  const text = clean(value, 500);
  return text ? {ok: true, text} : {ok: false, error: 'Bitte einen lesbaren Text verwenden.'};
}
function validateTemplates(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Die Ansagetexte müssen als benannte Texte gespeichert werden.');
  const names = {follow: 'Follower', like: 'Likes', gift: 'Geschenke', coins: 'Coins', subscription: 'Abonnements'};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_TEMPLATES, key)) throw Error('Unbekannter Ansagetext: ' + clean(key));
    const valid = validateTemplate(key, value);
    if (!valid.ok) throw Error(`${names[key]}: ${valid.error} Erlaubt: ${TEMPLATE_FIELDS[key].map(name => '{' + name + '}').join(', ')}.`);
  }
  return true;
}
function settings(input = {}) {
  const source = input && typeof input === 'object' ? input : {}, result = {...DEFAULT_EVENTS, templates: {...DEFAULT_TEMPLATES}};
  for (const key of ['enabled', 'gifts', 'follows', 'likes', 'subscriptions']) if (typeof source[key] === 'boolean') result[key] = source[key];
  for (const [key, min, max] of [['giftMinimum', 0, 100000000], ['likeThreshold', 1, 100000000], ['cooldown', 2, 120]]) if (Number.isFinite(source[key])) result[key] = Math.max(min, Math.min(max, Math.round(source[key])));
  if (['gift', 'coins', 'both'].includes(source.giftAnnouncement)) result.giftAnnouncement = source.giftAnnouncement;
  for (const key of Object.keys(DEFAULT_TEMPLATES)) {
    const valid = validateTemplate(key, source.templates?.[key]);
    if (valid.ok) result.templates[key] = valid.text;
  }
  return result;
}
function renderTemplate(template, values) {
  let missing = false;
  const text = template.replace(/\{([a-z]+)\}/g, (_, token) => {
    if (values[token] === undefined || values[token] === null || values[token] === '') {missing = true; return '';}
    return clean(values[token]);
  });
  return missing ? null : clean(text, 1000);
}
function rawData(event) {
  const raw = event.meta?.rawData || {};
  let data = raw.data;
  if (typeof data === 'string' && data.length <= 262144) try {data = JSON.parse(data);} catch {data = null;}
  return data && typeof data === 'object' && !Array.isArray(data) ? data : raw;
}
function months(event, raw) {
  // Only supplied month fields have this meaning. A generic event count or
  // gifted-sub quantity is not the recipient's subscription tenure.
  const values = [raw.cumulativeMonths, raw.cumulative_months, raw.cumulative, raw.user?.monthsSubscribed,
    raw.monthsSubscribed, raw.submonth, raw.subMonths, raw.months, event.data?.submonth, event.data?.monthsSubscribed];
  if (event.type === 'sub') values.push(raw.durationMonths, raw.duration_months);
  return values.map(integer).find(value => value !== null && value > 0 && value <= 12000) ?? null;
}
function giftTotal(event, raw, count) {
  // TikFinity coins is the event total; diamondCount / coinsPerGift is a unit price.
  const total = integer(raw.coins);
  if (total !== null) return total;
  const unit = [raw.coinsPerGift, raw.diamondCount, raw.diamond_count, raw.gift?.diamondCount, raw.gift?.diamond_count, event.gift?.coins].map(integer).find(value => value !== null);
  if (unit !== undefined && Number.isSafeInteger(unit * count)) return unit * count;
  // Legacy bridge normalization may default value to gift count. Accept a
  // coins value only when the original packet actually supplied that value.
  return event.data?.unit === 'coins' ? integer(raw.value) : null;
}
const switchFor = type => ({gift: 'gifts', follow: 'follows', like: 'likes', sub: 'subscriptions', resub: 'subscriptions'})[type];
class JarvisEvents {
  constructor() {this.seen = new Map(); this.likes = new Map(); this.pending = []; this.last = -Infinity; this.nextPrune = -Infinity;}
  configuration(input) {
    // Jarvis settings are replaced on save. Reuse their validated templates
    // between saves instead of revalidating strings for every like packet.
    if (!this.cachedSettings || input !== this.settingsInput) {this.settingsInput = input; this.cachedSettings = settings(input);}
    return this.cachedSettings;
  }
  seenBefore(key, now) {
    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    while (this.seen.size > 4000) this.seen.delete(this.seen.keys().next().value);
    return false;
  }
  ingest(event, input, now = Date.now()) {
    const s = this.configuration(input), type = event?.type, enabled = switchFor(type);
    if (!s.enabled || !enabled || !s[enabled] || !['tiktok', 'twitch', 'youtube'].includes(event?.platform)) return;
    if (simulated(event) || /mock|fake|test|local/i.test(event.meta?.sourceConnector || '') || event.meta?.aggregated === true) return;
    const raw = rawData(event), age = now - Date.parse(event.timestamp);
    if (!Number.isFinite(age) || age > 60000 || age < -5000 || !event.eventId) return;
    const repeatEnd = raw.repeatEnd === true || raw.repeatEnd === 1 || raw.repeatEnd === 'true';
    if (type === 'gift' && (raw.repeatEnd === false || raw.repeatEnd === 0 || raw.repeatEnd === 'false' || Number(raw.giftType) === 1 && !repeatEnd)) return;
    if (now >= this.nextPrune) {
      for (const [id, stamp] of this.seen) if (now - stamp > 300000) this.seen.delete(id);
      for (const [key, value] of this.likes) if (now - value.time > 3600000) this.likes.delete(key);
      this.nextPrune = now + 15000;
    }
    if (this.seenBefore('event:' + event.platform + ':' + event.eventId, now)) return;
    const username = clean(raw.user?.displayName || raw.user?.nickname || (raw.user?.login ? raw.user?.name : '') || event.user?.displayName || event.user?.username), userId = clean(event.user?.id, 160);
    const knownName = username && !['unknown', 'tiktokuser', 'youtubeuser'].includes(username.toLowerCase()) ? username : 'dir';
    const identity = userId && userId !== 'unknown' ? `${event.platform}:${event.channelId || ''}:${userId}` : null;
    const values = {username: knownName, platform: {tiktok: 'TikTok', twitch: 'Twitch', youtube: 'YouTube'}[event.platform]};
    let text = '', submonth = null;
    if (type === 'follow') {
      if (identity && this.seenBefore('follow:' + identity, now)) return;
      text = renderTemplate(s.templates.follow, values);
    } else if (type === 'sub' || type === 'resub') {
      submonth = months(event, raw);
      values.submonth = submonth === null ? null : format(submonth);
      text = renderTemplate(s.templates.subscription, values) || `Danke ${knownName} für dein Abo. Vielen lieben Dank ${knownName}, ich küss dein Herz.`;
      if (identity && this.seenBefore('subscription:' + identity, now)) {
        // Some providers emit Sub followed by ReSub metadata. Upgrade the
        // queued text when months arrive, but never thank twice for that sub.
        const waiting = this.pending.find(item => item.user === identity && ['sub', 'resub'].includes(item.type));
        if (waiting && waiting.submonth === null && submonth !== null) Object.assign(waiting, {text, submonth});
        return;
      }
    } else if (type === 'gift') {
      const count = integer(event.gift?.count);
      if (count === null || count < 1 || count > 1000000) return;
      const series = clean(raw.groupId || raw.group_id || raw.comboId || raw.repeatId || raw.streakId || raw.giftGroupId, 160);
      if (identity && series && this.seenBefore(`gift:${identity}:${event.gift?.id || event.gift?.name || ''}:${series}`, now)) return;
      const total = giftTotal(event, raw, count);
      if (s.giftMinimum > 0 && (total === null || total < s.giftMinimum)) return;
      Object.assign(values, {giftname: clean(event.gift?.name) || 'dein Geschenk', giftcount: format(count), coins: total === null ? null : format(total)});
      const giftText = renderTemplate(s.templates.gift, values) || `Danke ${knownName} für ${values.giftname}. Kuss.`;
      const coinText = renderTemplate(s.templates.coins, values) || (total === null ? 'Der Coin-Wert wurde nicht übermittelt.' : `Danke für ${format(total)} Coins. Kuss.`);
      text = s.giftAnnouncement === 'both' ? `${giftText} ${coinText}` : s.giftAnnouncement === 'coins' ? total === null ? `${giftText} ${coinText}` : coinText : giftText;
    } else if (type === 'like') {
      if (!identity) return;
      // totalLikeCount belongs to the entire stream, never to this person.
      const delta = integer(raw.likeCount) ?? integer(event.data?.count);
      if (delta === null || delta < 1 || delta > 100000000) return;
      const entry = this.likes.get(identity) || {total: 0, announced: 0, threshold: s.likeThreshold, time: now};
      if (entry.threshold !== s.likeThreshold) {entry.threshold = s.likeThreshold; entry.announced = Math.floor(entry.total / s.likeThreshold) * s.likeThreshold;}
      entry.total += delta; entry.time = now;
      if (!Number.isSafeInteger(entry.total)) return;
      const milestone = Math.floor(entry.total / s.likeThreshold) * s.likeThreshold;
      if (milestone > entry.announced) {entry.announced = milestone; values.likecount = format(milestone); text = renderTemplate(s.templates.like, values);}
      this.likes.set(identity, entry);
      if (this.likes.size > 5000) this.likes.delete(this.likes.keys().next().value);
    }
    if (text) {
      const replace = type === 'like' ? this.pending.findIndex(item => item.user === identity && item.type === 'like') : -1;
      const item = {text, time: now, type, user: identity, ...(['sub', 'resub'].includes(type) ? {submonth} : {})};
      if (replace >= 0) this.pending[replace] = item;
      else if (this.pending.length < 8) this.pending.push(item);
    }
  }
  next(input, now = Date.now()) {
    const s = this.configuration(input);
    this.pending = this.pending.filter(item => now - item.time < 30000 && s.enabled && s[switchFor(item.type)]);
    if (now - this.last < s.cooldown * 1000 || !this.pending.length) return null;
    this.last = now;
    return this.pending.shift().text;
  }
  resetLikes() {this.likes.clear(); this.pending = this.pending.filter(item => item.type !== 'like');}
}
module.exports = {JarvisEvents, eventSettings: settings, DEFAULT_EVENTS, DEFAULT_TEMPLATES, TEMPLATE_FIELDS, validateTemplate, validateTemplates, renderTemplate};
