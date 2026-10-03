'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {JarvisEvents, eventSettings, DEFAULT_TEMPLATES, TEMPLATE_FIELDS, validateTemplate, validateTemplates} = require('../src/services/jarvis-events.cjs');
const {EventCore} = require('../src/core/events/event-core.cjs');
const {normalizeEvent} = require('../src/core/events/normalizer.cjs');
const {normalizeTikFinityPacket} = require('../src/adapters/tikfinity.cjs');
const {SupportEvents} = require('../src/core/events/support-events.cjs');
const {JarvisCore} = require('../src/services/jarvis-core.cjs');
const now = Date.now();
function event(type, data = {}, {id = 'one', platform = 'tiktok', at = now, source = 'tikfinity', raw} = {}) {
  return normalizeEvent({id, platform, type, timestamp: new Date(at).toISOString(), data: {uniqueId: 'alex', nickname: 'Alex', ...data}, ...(raw ? {raw} : {})}, source);
}
test('new defaults match requested texts and retain existing explicit settings', () => {
  const defaults = eventSettings();
  assert.equal(defaults.likeThreshold, 1000);
  assert.equal(defaults.templates.follow, 'Danke {username} für deinen Follow.');
  assert.equal(defaults.templates.like, 'Danke {username} für {likecount} Likes.');
  assert.equal(defaults.templates.gift, 'Danke {username} für {giftname}. Kuss.');
  assert.equal(defaults.templates.coins, 'Danke für {coins} Coins. Kuss.');
  assert.match(defaults.templates.subscription, /\{submonth\} Monate/);
  const migrated = eventSettings({enabled: false, likes: false, subscriptions: false, likeThreshold: 10000, cooldown: 25, giftAnnouncement: 'coins', templates: {follow: 'Willkommen {username}!'}});
  assert.equal(migrated.enabled, false); assert.equal(migrated.likes, false); assert.equal(migrated.subscriptions, false);
  assert.equal(migrated.likeThreshold, 10000); assert.equal(migrated.cooldown, 25); assert.equal(migrated.giftAnnouncement, 'coins');
  assert.equal(migrated.templates.follow, 'Willkommen {username}!');
  assert.equal(migrated.templates.gift, DEFAULT_TEMPLATES.gift);
});
test('template validation rejects unknown fields and long or broken templates without running expressions', () => {
  assert.equal(validateTemplates({follow: 'Hallo {username} auf {platform}'}), true);
  for (const text of ['{process.exit()}', '${require("fs")}', '{{username}}', '{coins}', '', 'x'.repeat(501)]) assert.equal(validateTemplate('follow', text).ok, false, text);
  assert.throws(() => validateTemplates({follow: '{coins}'}), /Follower.*Platzhalter/);
  assert.throws(() => validateTemplates({arbitrary: 'Hallo'}), /Unbekannter/);
  assert.throws(() => validateTemplates(null), /Ansagetexte/);
  assert.equal(eventSettings({templates: {follow: '{unknown}'}}).templates.follow, DEFAULT_TEMPLATES.follow);
  assert.deepEqual(TEMPLATE_FIELDS.subscription, ['username', 'submonth', 'platform']);
});
test('follow thank-you is named, configurable and deduplicates the same follower across event IDs', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('follow'), settings, now);
  engine.ingest(event('follow', {}, {id: 'same-follow-new-wrapper'}), settings, now);
  assert.equal(engine.next(settings, now), 'Danke Alex für deinen Follow.');
  assert.equal(engine.next(settings, now + 10000), null);
  const custom = eventSettings({templates: {follow: 'Willkommen {username} bei {platform}!'}});
  engine.ingest(event('follow', {uniqueId: 'bob', nickname: 'Bob'}, {id: 'bob-follow'}), custom, now + 10000);
  assert.equal(engine.next(custom, now + 10000), 'Willkommen Bob bei TikTok!');
});
test('likes announce only reached per-viewer 1000 milestones, never stream totals or packet counts', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('like', {likeCount: 999, totalLikeCount: 400000}), settings, now);
  assert.equal(engine.next(settings, now), null);
  engine.ingest(event('like', {uniqueId: 'bob', nickname: 'Bob', likeCount: 1}, {id: 'bob-like'}), settings, now);
  engine.ingest(event('like', {likeCount: 1}, {id: 'alex-reaches'}), settings, now);
  assert.equal(engine.next(settings, now), 'Danke Alex für 1.000 Likes.');
  engine.ingest(event('like', {likeCount: 1500}, {id: 'alex-more', at: now + 10000}), settings, now + 10000);
  assert.equal(engine.next(settings, now + 10000), 'Danke Alex für 2.000 Likes.');
  engine.ingest(event('like', {totalLikeCount: 9000000}, {id: 'aggregate-only', at: now + 20000}), settings, now + 20000);
  assert.equal(engine.next(settings, now + 20000), null);
  engine.ingest(event('like', {likeCount: true}, {id: 'invalid-count'}), settings, now);
  engine.ingest(event('like', {uniqueId: 'unknown', nickname: 'unknown', likeCount: 1000}, {id: 'without-user'}), settings, now);
  assert.equal([...engine.likes.values()].find(item => item.total === 1)?.total, 1);
});
test('queued like milestones coalesce only for the same platform and user; disabled events clear', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('like', {likeCount: 1000}, {id: 'first'}), settings, now);
  engine.ingest(event('like', {likeCount: 1000}, {id: 'second'}), settings, now);
  engine.ingest(event('like', {count: 1000}, {id: 'twitch', platform: 'twitch', source: 'streamerbot'}), settings, now);
  assert.equal(engine.pending.length, 2);
  assert.equal(engine.next(settings, now), 'Danke Alex für 2.000 Likes.');
  assert.equal(engine.next({...settings, likes: false}, now + 10000), null);
  engine.resetLikes(); assert.equal(engine.likes.size, 0);
});
test('gift streak speaks only final combo once, with truthful supplied total or per-gift coins', () => {
  const engine = new JarvisEvents(), settings = eventSettings({giftAnnouncement: 'both', templates: {gift: 'Danke {username} für {giftcount} mal {giftname}. Kuss.'}});
  engine.ingest(event('gift', {groupId: 'combo1', giftType: 1, repeatEnd: false, repeatCount: 2, diamondCount: 5, giftName: 'Rose'}, {id: 'partial'}), settings, now);
  assert.equal(engine.next(settings, now), null);
  engine.ingest(event('gift', {groupId: 'combo1', giftType: 1, repeatEnd: true, repeatCount: 3, diamondCount: 5, giftName: 'Rose'}, {id: 'final'}), settings, now);
  engine.ingest(event('gift', {groupId: 'combo1', giftType: 1, repeatEnd: true, repeatCount: 3, diamondCount: 5, giftName: 'Rose'}, {id: 'final-again'}), settings, now);
  assert.equal(engine.next(settings, now), 'Danke Alex für 3 mal Rose. Kuss. Danke für 15 Coins. Kuss.');
  assert.equal(engine.next(settings, now + 10000), null);
  engine.ingest(event('gift', {repeatCount: 4, coins: 20, giftName: 'Rose'}, {id: 'total', at: now + 10000}), settings, now + 10000);
  assert.match(engine.next(settings, now + 10000), /20 Coins/);
});
test('gift coin mode never invents a value, and excludes gifts below known minimum', () => {
  const engine = new JarvisEvents(), settings = eventSettings({giftAnnouncement: 'coins'});
  engine.ingest(event('gift', {giftName: 'Rose'}), settings, now);
  const unknown = engine.next(settings, now);
  assert.match(unknown, /Rose.*Coin-Wert wurde nicht übermittelt/);
  assert.doesNotMatch(unknown, /0 Coins/);
  engine.ingest(event('gift', {giftName: 'Rose'}, {id: 'minimum'}), {...settings, giftMinimum: 1}, now);
  assert.equal(engine.next(settings, now + 10000), null);
  engine.ingest(event('gift', {giftName: 'Rose', coins: 0}, {id: 'free', at: now + 10000}), settings, now + 10000);
  assert.equal(engine.next(settings, now + 10000), 'Danke für 0 Coins. Kuss.');
});
test('subscriptions prefer real cumulative months and never infer tenure from event count or gift quantity', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('resub', {user: {id: 'u1', login: 'alex', name: 'Alex', monthsSubscribed: 12}, durationMonths: 3, count: 1}, {platform: 'twitch', source: 'streamerbot-support'}), settings, now);
  assert.equal(engine.next(settings, now), 'Danke Alex für 12 Monate. Vielen lieben Dank Alex, ich küss dein Herz.');
  engine.ingest(event('sub', {uniqueId: 'bob', nickname: 'Bob', count: 99}, {id: 'bob-sub', at: now + 10000}), settings, now + 10000);
  const unknown = engine.next(settings, now + 10000);
  assert.match(unknown, /Danke Bob für dein Abo/); assert.doesNotMatch(unknown, /99|Monate/);
  engine.ingest(event('resub', {uniqueId: 'third', nickname: 'Chris', durationMonths: 3}, {id: 'duration-only', at: now + 20000}), settings, now + 20000);
  assert.doesNotMatch(engine.next(settings, now + 20000), /3 Monate/);
  engine.ingest(event('giftsub', {count: 10, monthsSubscribed: 5}, {id: 'gifted-sub', at: now + 30000}), settings, now + 30000);
  assert.equal(engine.next(settings, now + 30000), null);
});
test('duplicate subscription wrappers collapse and subscriber switch stops pending announcements', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('sub', {monthsSubscribed: 4}, {id: 'original'}), settings, now);
  engine.ingest(event('resub', {monthsSubscribed: 4}, {id: 'another-wrapper'}), settings, now);
  assert.equal(engine.pending.length, 1);
  assert.equal(engine.next({...settings, subscriptions: false}, now), null);
});
test('a delayed subscription tenure upgrades a queued thank-you instead of adding another', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('sub', {}, {id: 'sub-first'}), settings, now);
  engine.ingest(event('resub', {monthsSubscribed: 8}, {id: 'resub-details'}), settings, now);
  assert.equal(engine.pending.length, 1);
  assert.match(engine.next(settings, now), /8 Monate/);
  engine.ingest(event('resub', {monthsSubscribed: 8}, {id: 'duplicate', at: now + 10000}), settings, now + 10000);
  assert.equal(engine.next(settings, now + 10000), null);
});
test('stale, synthetic, malformed and aggregated inputs cannot create real thank-you messages', () => {
  const engine = new JarvisEvents(), settings = eventSettings();
  engine.ingest(event('follow', {}, {id: 'stale', at: now - 61000}), settings, now);
  engine.ingest(event('follow', {isTest: true}, {id: 'simulation'}), settings, now);
  engine.ingest({...event('follow', {}, {id: 'aggregation'}), meta: {sourceConnector: 'tikfinity', aggregated: true}}, settings, now);
  engine.ingest({...event('follow', {}, {id: 'badtime'}), timestamp: 'broken'}, settings, now);
  assert.equal(engine.next(settings, now), null);
});
test('accepted real TikFinity packets preserve every per-user delta before legacy aggregation', t => {
  const core = new EventCore(), engine = new JarvisEvents(), settings = eventSettings(), accepted = [];
  t.after(() => core.stop());
  core.on('accepted', normalized => {accepted.push(normalized); engine.ingest(normalized, settings, now);});
  for (let index = 0; index < 4; index++) {
    const packet = normalizeTikFinityPacket({event: 'like', data: {msgId: 'packet-' + index, uniqueId: 'alex', nickname: 'Alex', likeCount: 250, totalLikeCount: 999999}, timestamp: new Date(now).toISOString()});
    const result = core.ingestEvent(packet.value, 'tikfinity'); assert.equal(result.ok, true);
    assert.equal(core.ingestEvent(packet.value, 'tikfinity').duplicate, true);
  }
  assert.equal(accepted.length, 4);
  assert.equal(engine.next(settings, now), 'Danke Alex für 1.000 Likes.');
  core.flushAggregates(); assert.equal(engine.next(settings, now + 10000), null);
});
test('real Streamer.bot subscription payload retains user months through SupportEvents and normalization', t => {
  const core = new EventCore(), engine = new JarvisEvents(), settings = eventSettings(); t.after(() => core.stop());
  core.on('accepted', event => engine.ingest(event, settings, now));
  const source = new SupportEvents({onEvent: (event, connector) => core.ingestEvent(event, connector)});
  const packet = {timeStamp: new Date(now).toISOString(), event: {source: 'Twitch', type: 'ReSub'}, data: {messageId: 'sub-message', user: {id: '42', login: 'alex', name: 'Alex', monthsSubscribed: 8}, durationMonths: 3, isTest: false}};
  assert.equal(source.ingest(packet), true); assert.equal(source.ingest(packet), false);
  assert.equal(engine.next(settings, now), 'Danke Alex für 8 Monate. Vielen lieben Dank Alex, ich küss dein Herz.');
});
test('TikFinity keeps packet-level IDs even when event data is JSON text', t => {
  const core = new EventCore(), engine = new JarvisEvents(), settings = eventSettings(); t.after(() => core.stop());
  core.on('accepted', event => engine.ingest(event, settings, now));
  for (const id of ['outer-a', 'outer-b']) {
    const packet = normalizeTikFinityPacket({eventId: id, event: 'like', timestamp: new Date(now).toISOString(), data: JSON.stringify({uniqueId: 'alex', nickname: 'Alex', likeCount: 500})});
    assert.equal(packet.value.id, id);
    assert.equal(core.ingestEvent(packet.value, 'tikfinity').ok, true);
    assert.equal(core.ingestEvent(packet.value, 'tikfinity').duplicate, true);
  }
  assert.equal(engine.next(settings, now), 'Danke Alex für 1.000 Likes.');
});
test('legacy support bridge gift quantity is never mistaken for a supplied coin value', () => {
  const engine = new JarvisEvents(), settings = eventSettings({giftAnnouncement: 'coins'});
  const source = new SupportEvents({onEvent: (event, connector) => engine.ingest(normalizeEvent(event, connector), settings, now)});
  const packet = {bridge: true, platform: 'tiktok', type: 'gift', eventId: 'gift-missing-value', timestamp: new Date(now).toISOString(), username: 'Alex', giftName: 'Rose', count: 3};
  assert.equal(source.ingest(packet), true);
  const text = engine.next(settings, now);
  assert.match(text, /Coin-Wert wurde nicht übermittelt/);
  assert.doesNotMatch(text, /3 Coins/);
});
function coreFixture(t, persisted) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-events-182-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  if (persisted) fs.writeFileSync(path.join(directory, 'jarvis-settings.json'), JSON.stringify(persisted));
  const spoken = [], core = new JarvisCore({directory, clock: () => now, speak: text => spoken.push(text)});
  return {core, directory, spoken};
}
test('saved legacy settings migrate tolerantly but explicit invalid templates never change settings', t => {
  const {core, directory} = coreFixture(t, {chatTemplate: 'Alt {username}: {message}', events: {likeThreshold: 10000, gifts: false, templates: {follow: 'Hallo {username}', gift: '{bad-old-value}'}}});
  assert.equal(core.settings.events.likeThreshold, 10000);
  assert.equal(core.settings.events.gifts, false);
  assert.equal(core.settings.events.templates.follow, 'Hallo {username}');
  assert.equal(core.settings.events.templates.gift, DEFAULT_TEMPLATES.gift);
  const before = JSON.stringify(core.settings), file = fs.readFileSync(path.join(directory, 'jarvis-settings.json'), 'utf8');
  assert.throws(() => core.update({events: {templates: {follow: '{process.env}'}}}), /Follower.*Platzhalter/);
  assert.equal(JSON.stringify(core.settings), before);
  assert.equal(fs.readFileSync(path.join(directory, 'jarvis-settings.json'), 'utf8'), file);
});
test('partial event template and switch saves preserve other custom settings and survive restart', t => {
  const {core, directory} = coreFixture(t);
  core.update({chatTemplate: '{username}: {message}', events: {likeThreshold: 2000, gifts: false, templates: {follow: 'Hallo {username}', gift: 'Geschenk: {giftname}'}}});
  core.update({events: {templates: {follow: 'Willkommen {username}'}}});
  core.update({events: {subscriptions: false}});
  const restored = new JarvisCore({directory});
  assert.equal(restored.settings.events.likeThreshold, 2000);
  assert.equal(restored.settings.events.gifts, false);
  assert.equal(restored.settings.events.subscriptions, false);
  assert.equal(restored.settings.events.templates.follow, 'Willkommen {username}');
  assert.equal(restored.settings.events.templates.gift, 'Geschenk: {giftname}');
  assert.equal(restored.settings.chatTemplate, '{username}: {message}');
  assert.deepEqual(restored.snapshot().eventDefaults.templates, DEFAULT_TEMPLATES);
  assert.deepEqual(restored.snapshot().eventTemplateFields, TEMPLATE_FIELDS);
});
test('explicit preview speaks fictional labeled sample exactly once without changing live event state', t => {
  const {core, spoken} = coreFixture(t);
  core.onEvent(event('like', {likeCount: 300}));
  const before = {seen: [...core.events.seen], likes: structuredClone([...core.events.likes]), pending: [...core.events.pending], last: core.events.last};
  const result = core.previewEvent({type: 'subscription', template: 'Danke {username} für {submonth} Monate.'});
  assert.equal(result.ok, true); assert.equal(result.kind, 'preview');
  assert.match(result.text, /^Vorschau mit erfundenen Beispieldaten\./);
  assert.match(result.text, /Beispielperson.*3 Monate/);
  assert.deepEqual(spoken, [result.text]);
  assert.deepEqual({seen: [...core.events.seen], likes: [...core.events.likes], pending: [...core.events.pending], last: core.events.last}, before);
  assert.equal(core.memory.length, 0);
  assert.throws(() => core.previewEvent({type: 'follow', template: '{coins}'}), /Platzhalter/);
  assert.throws(() => core.previewEvent({type: '__proto__', template: 'Hallo'}), /Ereignisansage/);
  assert.equal(spoken.length, 1);
});
