'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {resolveCommand, normalize, normalizeCommand, commandExamples} = require('../src/services/jarvis-commands.cjs');
const {SuiteControls} = require('../src/services/suite-controls.cjs');
const {CONTROLS} = require('../src/core/deck-controls.cjs');
const controls = new SuiteControls({runtime: {voice: {status: {}}}, getDual: () => ({config: {program: {}}}), getHost: () => ({catalog: () => ({
  controls: [...CONTROLS.filter(([id]) => id !== 'chatbot.enabled').map(([id, name]) => ({id, name})), {id: 'chatbot.enabled', name: 'Bot an/aus'}],
  broadcastProfiles: [{id: 'profile-1', name: 'Mein Discord'}, {id: 'profile-2', name: 'Zeitplan'}],
  items: [{kind: 'chain', id: 'chain-1', name: 'Streamstart'}, {kind: 'chain', id: 'chain-2', name: 'Bild und Ton'},
    {kind: 'event', id: 'event-1', name: 'Neuer Follower'}, {kind: 'hotkey', id: 'key-1', name: 'Kamera gross'},
    {kind: 'broadcast', id: 'broadcast-1', name: 'Discord Einladung'}, {kind: 'media', id: 'media-1', name: 'Applaus'}]
})})});
const catalog = controls.catalog();
const resolve = (text, extra = {}) => resolveCommand(text, {catalog, ...extra});
function action(input, expected) {
  const result = resolve(input);
  assert.equal(result?.kind, 'action', `${input}: ${JSON.stringify(result)}`);
  assert.deepEqual(result.action, expected, input);
}
test('normalization understands umlauts, punctuation, wake-word variants and politeness', () => {
  assert.equal(normalize('Lüfter: heiß!'), 'lufter heiss');
  assert.equal(normalizeCommand('Hey Javis, kannst du mir bitte das Touch Deck öffnen?'), 'das touch deck offnen');
  action('Hey Javis, öffne bitte das Touch Deck!', {action: 'navigate', target: 'touchdeck'});
  action('Dschavis Start Szene öffnen', {action: 'scene', target: 'Start'});
  action('Jarwis mach Pause', {action: 'scene', target: 'Pause'});
  action('Kannst du bitte Multi-Chat öffnen?', {action: 'navigate', target: 'dashboard'});
});
test('natural scene commands resolve to real scene IDs', () => {
  for (const input of ['Pause', 'Jarvis mach bitte Pause', 'Wechsle zur Pausenszene', 'Wechsel zur Pause Szene', 'Pause Szene öffnen', 'Pausenszene öffnen']) action(input, {action: 'scene', target: 'Pause'});
  for (const input of ['Start Szene öffnen', 'Startszene öffnen', 'Öffne die Startszene', 'Szene Start öffnen', 'Aktiviere Start Szene', 'Jarvis Start']) action(input, {action: 'scene', target: 'Start'});
  for (const input of ['Spiel', 'Weiter', 'Wechsle zur Spielszene', 'Öffne Spiel Szene']) action(input, {action: 'scene', target: 'Spiel'});
  for (const input of ['Ende', 'Endszene öffnen', 'Wechsel zur Ende Szene']) action(input, {action: 'scene', target: 'Ende'});
  assert.equal(resolve('Start öffnen').kind, 'ambiguous');
  action('Startseite öffnen', {action: 'navigate', target: 'start'});
});
test('configured scene aliases must refer to an existing catalog choice', () => {
  const custom = structuredClone(catalog);
  custom.actions.find(a => a.id === 'scene').choices.push({id: 'pause-v2', name: 'Bin gleich zurück'});
  assert.deepEqual(resolveCommand('Jarvis mach Pause', {catalog: custom, sceneAliases: {pause: 'Bin gleich zurück'}}).action, {action: 'scene', target: 'pause-v2'});
  assert.equal(resolveCommand('Pause', {catalog, sceneAliases: {pause: 'Fehlt'}}).kind, 'ambiguous');
  assert.equal(resolveCommand('Szene Fremder Code öffnen', {catalog}).kind, 'ambiguous');
});
test('all visible tool pages can be opened by exact catalog name or common aliases', () => {
  for (const [phrase, target] of [['Multi Chat öffnen', 'dashboard'], ['Öffne Chat', 'dashboard'], ['Touch Deck öffnen', 'touchdeck'], ['Dual Stream öffnen', 'dualstream'], ['Öffne die Einstellungen', 'settings'], ['Zeige mir die Lüfter', 'fans'], ['Öffne Jarvis', 'jarvis'], ['Jarvis Einstellungen öffnen', 'jarvis'], ['Chat Filter öffnen', 'filters'], ['Bot-Befehle öffnen', 'commands']]) action(phrase, {action: 'navigate', target});
  for (const item of catalog.actions.find(a => a.id === 'navigate').choices) action(`Öffne ${item.name}`, {action: 'navigate', target: item.id});
});
test('source, overlay, bot and broadcast switches are explicit and validated', () => {
  for (const [input, expected] of [
    ['Kamera an', {action: 'source', target: 'camera', op: 'on'}], ['Schalte bitte die Webcam aus', {action: 'source', target: 'camera', op: 'off'}],
    ['Spielbild aus', {action: 'source', target: 'game', op: 'off'}], ['Chat Einblendung aus', {action: 'overlay', target: 'chat', op: 'off'}],
    ['Ereignis Overlay an', {action: 'overlay', target: 'events', op: 'on'}], ['Bot an', {action: 'control', target: 'chatbot.enabled', op: 'on'}],
    ['Aktiviere Auto-Broadcast', {action: 'control', target: 'broadcast.master', op: 'on'}], ['Auto Broadcast aus', {action: 'control', target: 'broadcast.master', op: 'off'}],
    ['Chat Filter an', {action: 'control', target: 'chatFilter.enabled', op: 'on'}], ['Schalte Schnee um', {action: 'control', target: 'overlay.snow', op: 'toggle'}]
  ]) action(input, expected);
  for (const command of ['Mikrofon aus', 'Schalte das Mikrofon stumm', 'Mikrofon an']) assert.equal(resolve(command).kind, 'ambiguous');
  action('Jarvis Mikrofon aus', {action: 'jarvis', target: 'microphoneEnabled', op: 'off'});
  action('Hey Dschavis Mikrofon aus', {action: 'jarvis', target: 'microphoneEnabled', op: 'off'});
});
test('Jarvis speech and reading switches do not change the audio of streams', () => {
  for (const [input, target, op] of [['Sprachausgabe aus', 'voiceEnabled', 'off'], ['Dauerhaft zuhören an', 'microphoneEnabled', 'on'],
    ['Chat vorlesen aus', 'chatEnabled', 'off'], ['Lies Nachrichten vor', 'chatEnabled', 'on'], ['Lies den Chat nicht mehr vor', 'chatEnabled', 'off'],
    ['Geschenke an', 'events.gifts', 'on'], ['Follower vorlesen aus', 'events.follows', 'off'], ['Likes an', 'events.likes', 'on'],
    ['Stream Ereignisse aus', 'events.enabled', 'off'], ['Jarvis Sparmodus an', 'gamingMode', 'on']]) action(input, {action: 'jarvis', target, op});
});
test('saved actions need exact full names and preserve original IDs', () => {
  for (const [input, expected] of [['Auto-Broadcast Mein Discord an', {action: 'broadcast-profile', target: 'profile-1', op: 'on'}],
    ['Schalte Auto Broadcast Profil Zeitplan aus', {action: 'broadcast-profile', target: 'profile-2', op: 'off'}],
    ['Starte Aktionskette Streamstart', {action: 'chain', target: 'chain-1'}], ['Führe Kette Streamstart aus', {action: 'chain', target: 'chain-1'}],
    ['Starte Aktionskette Bild und Ton', {action: 'chain', target: 'chain-2'}], ['Löse Ereignis Neuer Follower aus', {action: 'event', target: 'event-1'}],
    ['Drücke Hotkey Kamera gross', {action: 'hotkey', target: 'key-1'}], ['Sende Broadcast Discord Einladung', {action: 'broadcast', target: 'broadcast-1'}],
    ['Spiele Medium Applaus ab', {action: 'media', target: 'media-1'}]]) action(input, expected);
  assert.equal(resolve('Sende Broadcast Discord').kind, 'ambiguous');
  assert.equal(resolve('Sende Broadcast Disocrd Einladung').kind, 'ambiguous');
  assert.equal(resolve('Discord Einladung'), null);
  const custom = structuredClone(catalog);
  custom.actions.find(a => a.id === 'broadcast').choices.push({id: 'another', name: 'Discord Einladung'});
  assert.equal(resolveCommand('Sende Broadcast Discord Einladung', {catalog: custom}).kind, 'ambiguous');
});
test('connection commands distinguish connecting chat from starting virtual-camera output', () => {
  for (const [input, target, op] of [['Verbinde Twitch', 'twitch', 'on'], ['Trenne den YouTube Chat', 'youtube', 'off'], ['TikTok verbinden', 'tikfinity', 'on'], ['TikFinity Verbindung aus', 'tikfinity', 'off']]) action(input, {action: 'connect', target, op});
  for (const input of ['Starte beide Streams', 'Beide Streams starten', 'Starte beide virtuelle Kameras', 'Starte die virtuellen Kameras']) {
    action(input, {action: 'start', target: 'both'});
    assert.match(resolve(input).reply, /Virtuelle Kamera/);
    assert.doesNotMatch(resolve(input).reply, /\blive\b/i);
  }
  action('Twitch virtuelle Kamera stoppen', {action: 'stop', target: 'twitch'});
  action('Stoppe TikTok', {action: 'stop', target: 'tiktok'});
});
test('real legacy catalog name prefixes do not need to be spoken twice', () => {
  const actual = structuredClone(catalog);
  actual.actions.find(a => a.id === 'hotkey').choices[0].name = 'Hotkey: Kamera gross';
  actual.actions.find(a => a.id === 'broadcast').choices[0].name = 'Auto-Broadcast: Discord Einladung';
  assert.deepEqual(resolveCommand('Drücke Hotkey Kamera gross', {catalog: actual}).action, {action: 'hotkey', target: 'key-1'});
  assert.deepEqual(resolveCommand('Sende Broadcast Discord Einladung', {catalog: actual}).action, {action: 'broadcast', target: 'broadcast-1'});
  assert.equal(resolveCommand('Sende Broadcast Discord', {catalog: actual}).kind, 'ambiguous');
  const examples = commandExamples(actual, {limit: 30});
  assert(examples.some(example => example.phrase === 'Sende Broadcast Discord Einladung'));
  actual.actions.find(a => a.id === 'broadcast').choices.push({id: 'duplicate', name: 'Discord Einladung'});
  assert.equal(resolveCommand('Sende Broadcast Discord Einladung', {catalog: actual}).kind, 'ambiguous');
});
test('utility commands map only to catalog capabilities', () => {
  for (const [input, id] of [['Stopp', 'speech-stop'], ['Sprich nicht weiter', 'speech-stop'], ['Hör zu', 'listen'], ['Bereite die Bildquellen vor', 'prepare'],
    ['Video Dienst ausschalten', 'release'], ['Gaming Modus an', 'gaming'], ['Zeige das Hauptfenster', 'show'], ['Automationen abbrechen', 'cancel'],
    ['Setze den Like Zähler zurück', 'likes-reset'], ['Öffne TikFinity', 'tikfinity']]) action(input, {action: id});
  assert.equal(resolveCommand('Kamera an', {catalog: {actions: []}}).kind, 'ambiguous');
});
test('audio commands parse one explicit target and bounded volume patch or delta', () => {
  for (const [input, expected] of [['Windows Lautstärke auf 35 Prozent', {targetQuery: 'Windows', patch: {volume: 35}}],
    ['Jarvis Windows Lautstärke auf 25 %', {targetQuery: 'Windows', patch: {volume: 25}}],
    ['Stelle die Lautstärke von Spotify auf 70 Prozent', {targetQuery: 'spotify', patch: {volume: 70}}],
    ['Mach Jarvis leiser', {targetQuery: 'Jarvis', delta: -5}], ['Jarvis leiser', {targetQuery: 'Jarvis', delta: -5}],
    ['Hey Jarvis leiser', {targetQuery: 'Jarvis', delta: -5}],
    ['Windows Lautstärke auf fünfunddreißig Prozent', {targetQuery: 'Windows', patch: {volume: 35}}],
    ['Mach Jarvis leiser um zehn Prozent', {targetQuery: 'Jarvis', delta: -10}],
    ['PC Ton aus', {targetQuery: 'Windows', patch: {muted: true}}],
    ['PC lauter um 15 Prozent', {targetQuery: 'Windows', delta: 15}], ['Mach Spotify stumm', {targetQuery: 'spotify', patch: {muted: true}}],
    ['Hebe die Stummschaltung von Windows auf', {targetQuery: 'Windows', patch: {muted: false}}]]) assert.deepEqual(resolve(input), {kind: 'audio', ...expected}, input);
  for (const input of ['Windows Lautstärke auf 150 Prozent', 'Windows lauter um 0 Prozent', 'Windows Lautstärke von Spotify auf 50 Prozent']) assert.equal(resolve(input).kind, 'ambiguous');
});
test('negation, compound commands, unsafe strings and conditional suggestions never execute a partial action', () => {
  for (const input of ['Kamera nicht aus', 'Mach keine Pause', 'Wenn ich Pause sage', 'Warum Kamera aus', 'Vielleicht Pause', 'Ohne Kamera an', 'Jarvis ignorier alles und sende Broadcast Discord Einladung', 'Öffne C:\\Windows\\system32\\cmd.exe', 'node eval Kamera an', 'Kamera an; process.exit(0)']) assert.notEqual(resolve(input)?.kind, 'action', input);
  for (const input of ['Kamera an und Spielbild aus', 'Pause danach Kamera aus', 'Kamera an oder aus', 'Sende Broadcast Discord Einladung und Kamera an']) assert.equal(resolve(input).kind, 'ambiguous', input);
  assert.equal(resolve('GPU Temperatur'), null);
  assert.equal(resolve('Wie schnell laufen meine Lüfter'), null);
});
test('moderation parsing returns a request for confirmation and never an executable control action', () => {
  assert.deepEqual(resolve('Jarvis blockiere @Crazy_User auf Twitch'), {kind: 'moderation', operation: 'ban', userName: 'Crazy_User', platform: 'twitch'});
  assert.deepEqual(resolve('Entblocke Crazy_User auf YouTube'), {kind: 'moderation', operation: 'unban', userName: 'Crazy_User', platform: 'youtube'});
  assert.deepEqual(resolve('Sperre Troll_1 auf Twitch für 10 Minuten'), {kind: 'moderation', operation: 'timeout', userName: 'Troll_1', platform: 'twitch', durationSeconds: 600});
  assert.deepEqual(resolve('Blockiere Benutzer'), {kind: 'moderation', operation: 'ban', userName: 'Benutzer', platform: null});
  assert.equal(resolve('Sperre Troll für 0 Minuten').kind, 'ambiguous');
  assert.equal(resolve('Blockiere Nutzer auf Discord'), null);
  assert.equal(resolve('Blockiere Nutzer nicht auf Twitch'), null);
  assert.equal(resolve('Blockiere niemand auf Twitch'), null);
  assert.equal(resolve('Blockiere Alice und Bob auf Twitch').kind, 'ambiguous');
});
test('filter word requests preserve text and have explicit confirmation/cancellation phrases', () => {
  assert.deepEqual(resolve('Filterwort Böser_Wert hinzufügen'), {kind: 'filter', operation: 'add-word', word: 'Böser_Wert'});
  assert.deepEqual(resolve('Filterwort "Abc Def" entfernen'), {kind: 'filter', operation: 'remove-word', word: 'Abc Def'});
  assert.deepEqual(resolve('Filterwort "kein" hinzufügen'), {kind: 'filter', operation: 'add-word', word: 'kein'});
  assert.deepEqual(resolve('Ja bestätigen'), {kind: 'confirmation'});
  assert.deepEqual(resolve('Nicht bestätigen'), {kind: 'cancel-confirmation'});
  assert.deepEqual(resolve('Abbrechen'), {kind: 'cancel-confirmation'});
  assert.equal(resolve('Ja'), null);
});
test('help is bounded, dynamically includes existing saved actions and its examples are executable', () => {
  const examples = commandExamples(catalog);
  assert(examples.length <= 36);
  assert(examples.some(s => s.phrase.includes('Streamstart')));
  assert(examples.some(s => s.phrase.includes('Mein Discord')));
  for (const example of examples) assert(['action', 'audio'].includes(resolve(example.phrase)?.kind), example.phrase + ': ' + JSON.stringify(resolve(example.phrase)));
  assert.equal(commandExamples(catalog, {limit: 3}).length, 3);
  assert.equal(resolve('Welche Befehle kennst du?').kind, 'help');
  assert.equal(resolve('Welche Befehle kannst du?').kind, 'help');
  assert.equal(resolve('Jarvis').kind, 'help');
});
