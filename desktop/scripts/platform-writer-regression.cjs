'use strict';
const assert = require('node:assert/strict');
const { PlatformWriter } = require('../src/core/broadcast/platform-writer.cjs');
const { BroadcastEchoTracker } = require('../src/core/broadcast/echo-tracker.cjs');
const { BroadcastScheduler } = require('../src/core/broadcast/scheduler.cjs');
const config = { platforms: { twitch: { channel: 'https://www.twitch.tv/popout/crazy_batto/chat' }, youtube: { liveChatId: 'live-chat-123' } } };
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

(async () => {
  const calls = [], sent = [];
  let response = { data: [{ message_id: 'tw-1', is_sent: true }] };
  const writer = new PlatformWriter({ getConfig: () => config, getToken: () => 'test-token', onSent: message => sent.push(message), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/validate')) return reply({ user_id: 'sender', client_id: 'client', scopes: ['user:write:chat'] });
    if (url.includes('/users?')) return reply({ data: [{ id: 'broadcaster' }] });
    if (url.includes('googleapis')) return reply({ id: 'yt-1' });
    return reply(response);
  } });
  assert.equal((await writer.send('twitch', 'Hallo', { source: 'broadcast:one' })).messageId, 'tw-1');
  assert.equal(calls[1].url, 'https://api.twitch.tv/helix/users?login=crazy_batto');
  assert.deepEqual(JSON.parse(calls[2].options.body), { broadcaster_id: 'broadcaster', sender_id: 'sender', message: 'Hallo' });
  assert.equal(calls[2].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[2].options.headers['Client-Id'], 'client');
  assert.equal(sent[0].source, 'broadcast:one');
  response = { data: [{ is_sent: false, drop_reason: { code: 'automod_held' } }] };
  await assert.rejects(writer.send('twitch', 'Hallo'), /nicht veröffentlicht/);
  assert.equal(sent.length, 1, 'rejected sends must not create echo suppression records');
  await writer.send('youtube', 'Hallo YouTube');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { snippet: { liveChatId: 'live-chat-123', type: 'textMessageEvent', textMessageDetails: { messageText: 'Hallo YouTube' } } });
  for (const status of [401, 403, 429, 500]) {
    const failing = new PlatformWriter({ getConfig: () => config, getToken: () => 'private-test-token', fetchImpl: async () => reply({}, status) });
    await assert.rejects(failing.send('youtube', 'Hallo'), error => !error.message.includes('private-test-token'));
  }
  const missing = new PlatformWriter({ getConfig: () => config, getToken: () => '', fetchImpl: async () => assert.fail('missing credentials must never send') });
  await assert.rejects(missing.send('twitch', 'Hallo'), /Schreibzugang fehlt/);
  const wrongScope = new PlatformWriter({ getConfig: () => config, getToken: () => 'token', fetchImpl: async () => reply({ user_id: 'sender', client_id: 'client', scopes: ['user:read:chat'] }) });
  await assert.rejects(wrongScope.send('twitch', 'Hallo'), /user:write:chat/);

  let clock = 0;
  const echoes = new BroadcastEchoTracker({ now: () => clock });
  const received = [];
  const finish = echoes.begin('twitch');
  const echo = echoes.ingest({ platform: 'twitch', id: 'own', message: 'same' }, 'twitch', (message, source) => received.push({ message, source }));
  await Promise.resolve(); assert.equal(received.length, 0, 'echo before HTTP response waits for message ID');
  echoes.remember({ platform: 'twitch', id: 'own', source: 'broadcast:one' });
  finish(); await echo;
  assert.equal(received[0].source, 'broadcast:one');
  await echoes.ingest({ platform: 'twitch', id: 'viewer', message: 'same' }, 'chat-fixture', (message, source) => received.push({ message, source }));
  assert.equal(received[1].source, 'chat-fixture', 'same viewer text must not be suppressed');
  await echoes.ingest({ platform: 'youtube', id: 'own' }, 'youtube', (message, source) => received.push({ message, source }));
  assert.equal(received[2].source, 'youtube', 'IDs must be scoped to platform');
  clock = 86400001;
  await echoes.ingest({ platform: 'twitch', id: 'own' }, 'twitch', (message, source) => received.push({ message, source }));
  assert.equal(received[3].source, 'twitch', 'expired echo records are ignored');

  let attempts = 0;
  const uncertain = new PlatformWriter({ getConfig: () => config, getToken: () => 'token', fetchImpl: async () => { attempts++; throw new Error('network'); } });
  const scheduler = new BroadcastScheduler({ now: () => clock, send: (...args) => uncertain.send(...args) });
  scheduler.configure({ enabled: true, globalMinGapSeconds: 0, platformMinGapSeconds: 0, items: [{ id: 'uncertain', enabled: true, messages: ['Hallo'], targets: ['youtube'], startDelaySeconds: 0, intervalSeconds: 600, retryOnError: true, retryDelaySeconds: 5 }] });
  await scheduler.tick(); clock += 5000; await scheduler.tick();
  assert.equal(attempts, 1, 'unknown send outcomes must not trigger immediate duplicate retry');
  scheduler.stop();
  console.log('Platform writes: Twitch/YouTube payloads, scopes, failures, secret redaction, echo race and retry handling OK (mocked APIs; no live messages sent)');
})().catch(error => { console.error(error); process.exitCode = 1; });
