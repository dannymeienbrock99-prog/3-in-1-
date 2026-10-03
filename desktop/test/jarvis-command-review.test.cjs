'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {JarvisCore} = require('../src/services/jarvis-core.cjs');
const {SuiteControls, connectAdapter} = require('../src/services/suite-controls.cjs');
function setup(t, {host = {}, dual = null, ...options} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-jarvis-review-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const spoken = [], runtime = {voice: {status: 'Test'}, stopSpeech: () => {runtime.stopped++;}, stopped: 0};
  runtime.jarvis = new JarvisCore({directory, speak: text => spoken.push(text), stopSpeech: runtime.stopSpeech, ...options});
  const controls = new SuiteControls({runtime, getHost: () => host, getDual: () => dual});
  runtime.jarvis.control = command => controls.executeFromJarvis(command);
  runtime.jarvis.getCommandCatalog = () => controls.catalog();
  return {core: runtime.jarvis, controls, runtime, spoken};
}
test('pending TikFinity connection stays pending in the final Jarvis reply', async t => {
  const adapter = {connect: () => undefined, getStatus: () => ({state: 'connecting', connected: false})};
  const {core} = setup(t, {host: {connect: (name, op) => connectAdapter(adapter, name, op)}});
  const result = await core.execute('Verbinde TikTok');
  assert.equal(result.ok, true);
  assert.match(result.text, /Noch nicht verbunden/);
  assert.doesNotMatch(result.text, /eingeschaltet/);
});
test('adapter failures and unconfirmed disconnects never announce success', async t => {
  const failed = {connect: async () => ({ok: false, error: 'Keine Anmeldung'}), getStatus: () => ({connected: false})};
  const {core} = setup(t, {host: {connect: (name, op) => connectAdapter(failed, name, op)}});
  assert.equal((await core.execute('Verbinde YouTube')).ok, false);
  assert.equal(core.memory.length, 0);
  await assert.rejects(connectAdapter({disconnect: () => {}, getStatus: () => ({connected: true})}, 'twitch', 'off'), /nicht getrennt/);
});
test('all speech-stop aliases stop quietly without starting another spoken reply', async t => {
  const {core, spoken, runtime} = setup(t);
  for (const input of ['Stopp', 'Sei ruhig', 'Hör auf zu sprechen', 'Sprich nicht weiter']) {
    const result = await core.execute(input);
    assert.equal(result.ok, true, input);
  }
  assert.equal(runtime.stopped, 4);
  assert.deepEqual(spoken, []);
});
test('unsupported moderation and malformed control commands never fall back to local AI', async t => {
  let calls = 0;
  const {core} = setup(t, {askAi: async () => {calls++; return 'Kein Steuerzugriff';}});
  core.settings.localAi = true;
  for (const input of ['Banne Bob auf Discord', 'Blocke Bob auf Discord', 'Entblockiere Bob auf Discord', 'Führe unbekannt aus', 'Drücke unbekannt', 'Spiel unbekannt', 'Send unbekannt', 'Blockiere Bob auf Discord', 'Entblocke Bob auf Discord', 'Sperre Bob auf Discord', 'Unbekannter Bereich öffnen', 'Filterwort hinzufügen']) {
    assert.equal((await core.execute(input)).ok, false, input);
  }
  assert.equal(calls, 0);
  assert.equal((await core.execute('Was ist ein Planet?')).ok, true);
  assert.equal(calls, 1);
});
test('saved Stream Deck Jarvis command executes its inner action exactly once', async t => {
  const scenes = [];
  const {controls} = setup(t, {dual: {config: {program: {}}, serial: fn => fn(), scene: async name => {scenes.push(name); return {ok: true};}}});
  const result = await controls.execute({action: 'command', text: 'Start Szene öffnen'});
  assert.equal(result.ok, true);
  assert.deepEqual(scenes, ['Start']);
  assert.equal(controls.busy, false);
  assert.equal(controls.jarvisDepth, 0);
});
test('cancel and stop while moderation identity lookup awaits cannot create a new confirmation', async t => {
  for (const cancel of ['Abbrechen', 'Stopp', 'Hör auf zu sprechen']) {
    let finish, sent = 0;
    const {core, spoken} = setup(t, {moderation: {
      prepareModeration: () => new Promise(resolve => {finish = resolve;}),
      executePrepared: async () => {sent++; return {ok: true, text: 'Soll nicht ausgeführt werden'};}
    }});
    const preparing = core.execute('Blockiere Nutzer auf Twitch');
    assert.equal(typeof finish, 'function');
    const canceled = await core.execute(cancel);
    assert.equal(canceled.ok, true, cancel);
    finish({ok: true, description: 'Nutzer sperren', prepared: {id: 'pending', expiresAt: Date.now() + 45000}});
    const result = await preparing;
    assert.equal(result.ok, false, cancel);
    assert.equal(core.pendingModeration, null);
    assert(!spoken.some(line => line.includes('Bestätigung gilt')));
    assert.equal((await core.execute('Bestätigen')).ok, false);
    assert.equal(sent, 0);
  }
});
test('typed listen command opens one listening turn and leaves the greeting to the voice runtime', async t => {
  const {core, spoken, runtime} = setup(t);
  let listening = 0;
  runtime.listen = () => {listening++; return {ok: true};};
  assert.equal((await core.execute('Hör zu')).ok, true);
  assert.equal(listening, 1);
  assert.deepEqual(spoken, []);
});
