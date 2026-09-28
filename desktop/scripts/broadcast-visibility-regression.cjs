'use strict';
const assert = require('node:assert/strict');
const { ChatCore } = require('../src/core/chat-core.cjs');
const { normalizeChat } = require('../src/core/events/normalizer.cjs');
const { isAutoBroadcast } = require('../src/core/broadcast/visibility.cjs');
const { BroadcastScheduler } = require('../src/core/broadcast/scheduler.cjs');

(async () => {
  const core = new ChatCore({ multiChat: { maxMessages: 100 }, moderation: { state: {} } });
  const overlayLive = [];
  const privateLive = [];
  core.on('message', message => {overlayLive.push(message);if(core.isMultiChatVisible(message))privateLive.push(message);});
  function ingest(source, platform = 'internal', text = 'Folgt meinem Kanal!') {
    const event = normalizeChat({ platform, username: 'Crazy_Batto', text }, source);
    // The same normalized event envelope passed by main21.normalizedToChat.
    return core.ingest({ platform: event.platform, username: event.user.username,
      message: event.message.text, raw: event });
  }
  const scheduler = new BroadcastScheduler({ send: async (target, text, { source }) => {
    ingest(`${target === 'cng' ? 'cng-local' : 'local'}-${source}`, target === 'cng' ? 'cng' : 'internal', text);
    return { ok: true };
  } });
  const item = { id: 'visibility', messages: ['Folgt meinem Kanal!'], targets: ['local', 'cng'], enabled: true, startDelaySeconds: 0 };
  scheduler.configure({ enabled: true, globalMinGapSeconds: 0, platformMinGapSeconds: 0, items: [item] });
  await scheduler.tick();
  await scheduler.test(item);
  scheduler.stop();
  assert.equal(overlayLive.length, 4, 'automatic sends and manual broadcast tests reach the overlay');
  assert.equal(core.getMessages().length, 4, 'overlay history retains broadcasts on reconnect');
  assert.equal(core.getMultiChatMessages().length, 2, 'scheduled/test runs are visible once each, including reopened main and detached chat');
  assert.equal(privateLive.length,2,'local and CNG targets of one run do not duplicate the private live display');
  assert(overlayLive.every(isAutoBroadcast));
  const viewer = ingest('twitch', 'twitch');
  const manual = ingest('local-manual');
  const automation = ingest('local-automation');
  const unrelated = ingest('local-broadcasting');
  assert.deepEqual(core.getMultiChatMessages().slice(-4), [viewer, manual, automation, unrelated], 'identical text and normal manual messages remain visible');
  assert.equal(core.getMessages().length, 8, 'filtering the private view must not mutate overlay history');
  assert(isAutoBroadcast({ raw: { meta: { sourceConnector: 'cng-local-auto-broadcast' } } }));
  core.setConfig({autoBroadcast:{showInMultiChat:false}});
  assert.deepEqual(core.getMultiChatMessages(),[viewer,manual,automation,unrelated],'explicitly disabling broadcasts preserves ordinary messages');
  core.setConfig({autoBroadcast:{showInMultiChat:true}});
  assert.equal(core.getMultiChatMessages().length,6,'reenabling restores the stored run without duplicate targets');
  const runSource='broadcast-run:confirmed-only';
  ingest('local-'+runSource);
  ingest(runSource,'twitch');
  assert.equal(core.getMultiChatMessages().filter(m=>String(m.raw.meta.sourceConnector).includes('confirmed-only')).length,1);
  assert.equal(core.getMultiChatMessages().at(-1).platform,'local','local row never pretends that Twitch sent successfully');
  core.setConfig({autoBroadcast:{showInMultiChat:true},filters:{enabled:true,rules:[{term:'Folgt',action:'hide'}]}});
  assert(ingest('local-broadcast-run:owned'),'viewer keyword filters do not erase explicitly authored broadcasts');
  assert.equal(ingest('twitch','twitch'),null,'viewer keyword filtering still applies');
  core.clearMessages();
  assert.equal(core.getMultiChatMessages().length, 0);
  console.log('Broadcast visibility: visible scheduled/test runs, unique multi-target rows, persistent toggle, truthful local labels and viewer preservation OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
