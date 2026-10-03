'use strict';

// Command recognition stays local. Every executable ID must come from the live
// control catalog; names spoken by a user never become executable code or paths.
function normalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9%]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function normalizeCommand(value) {
  let text = normalize(value);
  text = text.replace(/^(?:hey|hi|hallo|okay|ok) (?=(?:jarvis|javis|dschavis|jarwis)\b)/, '')
    .replace(/^(?:javis|dschavis|jarwis)\b/, 'jarvis');
  // "Jarvis leiser" addresses his own voice, rather than an omitted command.
  if (!/^(?:jarvis|javis|dschavis|jarwis) (?:lauter|leiser|lautstarke|stumm|ton|mikrofon)/.test(text)) {
    text = text.replace(/^(?:(?:hey|hallo|okay|ok) )?(?:jarvis|javis|dschavis|jarwis)\b\s*/, '');
  }
  return text.replace(/^(?:kannst|konntest|wurdest) du (?:mir )?/, '')
    .replace(/\bbitte\b/g, ' ').trim().replace(/\s+/g, ' ');
}
const ambiguous = text => ({kind: 'ambiguous', text});
const unavailable = () => ambiguous('Diese Funktion ist gerade nicht verfügbar. Öffne die Befehlsübersicht für die verfügbaren Befehle.');
const NAVIGATION = {
  touchdeck: ['touch deck', 'batto touch deck', 'touchdeck', 'tuch deck'], dualstream: ['dual stream', 'dualstream'],
  jarvis: ['jarvis', 'javis', 'jarvis einstellungen', 'javis einstellungen'], sensors: ['pc werte', 'pc messwerte', 'messwerte', 'sensoren'],
  fans: ['lufter', 'luftersteuerung', 'fan atlas'], start: ['startseite', 'hauptseite'], dashboard: ['chat', 'multi chat', 'multichat'],
  wishlist: ['wunschliste'], widgets: ['widgets'], livecenter: ['live center'], moderation: ['moderation'],
  chatarchive: ['chatarchiv', 'chat archiv'], filters: ['filter', 'chat filter'], hologram: ['hologramm'],
  platforms: ['plattformen'], commands: ['bot', 'bot befehle'], broadcast: ['auto broadcast', 'autobroadcast', 'broadcast'],
  hotkeys: ['hotkeys'], events: ['ereignisse'], media: ['medien'], pools: ['medien pools'], tts: ['chat stimme'],
  discord: ['discord'], streamerbot: ['streamer bot'], backups: ['sicherungen', 'backups'], settings: ['einstellungen'], diagnostics: ['diagnose']
};
const JARVIS = {
  voiceEnabled: ['sprachausgabe', 'jarvis sprachausgabe', 'jarvis stimme'],
  microphoneEnabled: ['zuhoren', 'dauerhaft zuhoren', 'dauerhaftes zuhoren', 'jarvis mikrofon'],
  chatEnabled: ['chat vorlesen', 'chat vorlesen lassen', 'chat ansagen', 'nachrichten vorlesen'],
  'events.enabled': ['stream ereignisse', 'ereignisse vorlesen', 'ereignisse ansagen', 'ereignis ansagen'],
  'events.gifts': ['geschenke', 'geschenke vorlesen', 'geschenke ansagen', 'geschenk ansagen'],
  'events.follows': ['follower', 'follower vorlesen', 'follower ansagen', 'neue follower ansagen'],
  'events.likes': ['likes', 'likes vorlesen', 'likes ansagen', 'like ansagen'],
  gamingMode: ['jarvis sparmodus', 'gaming sparmodus', 'sparmodus']
};
const CONTROLS = {
  'chatbot.enabled': ['bot', 'chat bot', 'chatbot'], 'bot.enabled': ['bot', 'chat bot', 'chatbot'], bot: ['bot', 'chat bot', 'chatbot'],
  'broadcast.master': ['auto broadcast', 'autobroadcast', 'automatische broadcasts', 'automatische nachrichten'],
  'tts.enabled': ['tts', 'chat stimme'], 'chatArchive.enabled': ['chatarchiv', 'chat archiv'],
  'viewerCount.enabled': ['zuschauerzahl'], 'chatFilter.enabled': ['chat filter', 'chatfilter'],
  'overlay.snow': ['schnee'], 'overlay.likeBar': ['like balken'], 'battleBar.enabled': ['battle bar', 'match anzeige'],
  'chatWindow.detached': ['chatfenster entkoppeln']
};
const SCENE_ALIASES = {pause: ['pause', 'pausenszene', 'pause szene', 'bin gleich zuruck'],
  spiel: ['spiel', 'spielszene', 'spiel szene', 'gaming', 'weiter', 'zuruck zum spiel'],
  start: ['start', 'startszene', 'start szene', 'stream startet'], ende: ['ende', 'endszene', 'ende szene', 'stream ende']};
const definition = (catalog, id) => catalog?.actions?.find(a => a?.id === id);
const choices = (catalog, id) => (definition(catalog, id)?.choices || []).filter(c => c && typeof c.id === 'string' && typeof c.name === 'string');
function spokenChoiceName(item, action) {
  // The shared deck catalog decorates these names for drop-downs. Remove only
  // that explicit cosmetic prefix, preserving the exact saved name beneath it.
  if (action === 'hotkey') return item.name.replace(/^Hotkey:\s*/i, '');
  if (action === 'broadcast') return item.name.replace(/^Auto-Broadcast:\s*/i, '');
  return item.name;
}
function choiceMatches(item, query, aliases = {}, action) {
  return [item.name, spokenChoiceName(item, action), item.id, ...(aliases[item.id] || [])].some(name => normalize(name) === query);
}
function select(catalog, id, query, aliases = {}, extra = {}) {
  const action = definition(catalog, id);
  if (!action) return unavailable();
  const matches = choices(catalog, id).filter(item => choiceMatches(item, query, aliases, id));
  if (matches.length > 1) return ambiguous('Mehrere Ziele heißen so. Vergib bitte eindeutige Namen, damit ich das richtige auswähle.');
  if (!matches.length) return ambiguous('Diesen Namen finde ich nicht. Nenne bitte den vollständigen Namen aus den Einstellungen.');
  const target = matches[0];
  return {kind: 'action', action: {action: id, target: target.id, ...extra}, reply: `${target.name}: ${extra.op === 'on' ? 'eingeschaltet' : extra.op === 'off' ? 'ausgeschaltet' : id === 'navigate' ? 'geöffnet' : 'ausgeführt'}.`};
}
function simple(catalog, id, reply) {
  return definition(catalog, id) ? {kind: 'action', action: {action: id}, reply} : unavailable();
}
function targetText(value) { return value.replace(/^(?:den|die|das|der|dem|meinen|meine|mein) /, '').trim(); }
function switchPhrase(text) {
  let query, op, match;
  if ((match = /^(?:schalte|schalt|mache|mach|stelle|stell|setze|setz) (.+?) (an|ein|aus|stumm|einblenden|ausblenden|einschalten|ausschalten)$/.exec(text)) ||
      (match = /^(.+?) (an|ein|aus|stumm|einblenden|ausblenden|einschalten|ausschalten)$/.exec(text))) {
    query = targetText(match[1]); op = /^(?:an|ein|einblenden|einschalten)$/.test(match[2]) ? 'on' : 'off';
  } else if ((match = /^(aktiviere|aktivier|deaktiviere|deaktivier|starte|stoppe|beende) (.+)$/.exec(text))) {
    query = targetText(match[2]); op = /^(?:aktiviere|aktivier|starte)$/.test(match[1]) ? 'on' : 'off';
  } else if ((match = /^(?:schalte|schalt) (.+) um$/.exec(text))) {
    query = targetText(match[1]); op = 'toggle';
  }
  return query ? {query, op} : null;
}
function audioCommand(text) {
  let match;
  const units = {null: 0, ein: 1, eins: 1, eine: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
    zehn: 10, elf: 11, zwolf: 12, dreizehn: 13, vierzehn: 14, funfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
    zwanzig: 20, dreissig: 30, vierzig: 40, funfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90, hundert: 100, einhundert: 100};
  // Offline speech recognition sometimes writes German numbers as words.
  text = text.replace(/\b(auf|um) ([a-z]+) (prozent|%)$/, (full, prep, word, unit) => {
    let value = units[word];
    const compound = /^(.+?)und(.+)$/.exec(word);
    if (value === undefined && compound && units[compound[1]] > 0 && units[compound[1]] < 10 && units[compound[2]] >= 20 && units[compound[2]] < 100) value = units[compound[1]] + units[compound[2]];
    return value === undefined ? full : `${prep} ${value} ${unit}`;
  });
  const canonical = name => /^(?:pc|computer|system|windows)(?: (?:ton|audio))?$/.test(name) ? 'Windows' : /^(?:jarvis|javis|dschavis|jarwis|deine stimme|dich)$/.test(name) ? 'Jarvis' : name;
  const target = value => canonical(targetText(value).replace(/^(?:von|fur) /, '').replace(/ (?:lautstarke|ton)$/, ''));
  const prefix = '(?:(?:setze|setz|stelle|stell|mache|mach|regle) (?:die )?)?';
  if ((match = new RegExp('^' + prefix + '(?:(.+?) )?lautstarke(?: (?:von|fur) (.+?))? auf (\\d{1,3}) (?:prozent|%)$').exec(text))) {
    if (match[1] && match[2]) return ambiguous('Nenne bitte genau eine Tonquelle.');
    const volume = Number(match[3]);
    return volume <= 100 ? {kind: 'audio', targetQuery: target(match[1] || match[2] || 'Windows'), patch: {volume}} : ambiguous('Die Lautstärke muss zwischen 0 und 100 Prozent liegen.');
  }
  if ((match = /^(?:(?:mache|mach|stelle|stell|setze|setz) )?(.+?) (lauter|leiser)(?: um (\d{1,3}) (?:prozent|%))?$/.exec(text))) {
    const delta = Number(match[3] || 5);
    return delta <= 100 && delta > 0 ? {kind: 'audio', targetQuery: target(match[1]), delta: match[2] === 'leiser' ? -delta : delta} : ambiguous('Nenne eine Lautstärkeänderung zwischen 1 und 100 Prozent.');
  }
  if ((match = /^(?:(?:mache|mach|schalte|schalt) )?(.+?) (stumm|wieder horbar|lautlos)$/.exec(text)))
    return {kind: 'audio', targetQuery: target(match[1]), patch: {muted: match[2] !== 'wieder horbar'}};
  if ((match = /^(?:hebe|heb) (?:die )?stummschaltung (?:von|fur) (.+?) auf$/.exec(text)))
    return {kind: 'audio', targetQuery: target(match[1]), patch: {muted: false}};
  if ((match = /^(?:(?:schalte|schalt|mache|mach) )?(windows|pc|computer|system|jarvis|javis) (?:ton|audio) (an|ein|aus)$/.exec(text)))
    return {kind: 'audio', targetQuery: target(match[1]), patch: {muted: match[2] === 'aus'}};
  return null;
}
function moderationCommand(input) {
  const raw = input.trim().replace(/^(?:(?:hey|hallo|okay|ok)\s+)?(?:jarvis|javis|dschavis|jarwis)[,!:.\s]*/iu, '')
    .replace(/^(?:kannst|könntest|würdest)\s+du\s+(?:mir\s+)?/iu, '').replace(/\bbitte\b/giu, ' ').trim();
  let match;
  if ((match = /^(?:filterwort|filter wort)\s+["„“']?(.+?)["„“']?\s+(hinzufügen|hinzufuegen|entfernen)[.!?]?$/iu.exec(raw))) {
    const word = match[1].trim();
    if (word.length > 100 || /[\x00-\x1f]/.test(word)) return ambiguous('Ein Filterwort darf höchstens 100 Zeichen enthalten.');
    return {kind: 'filter', operation: normalize(match[2]) === 'entfernen' ? 'remove-word' : 'add-word', word};
  }
  const name = '(@?[\\p{L}\\p{N}_.-]{1,80})';
  const platform = '(?:\\s+auf\\s+(twitch|youtube|tiktok))?';
  if ((match = new RegExp('^(?:sperre|sperr|timeout)\\s+' + name + platform + '\\s+f(?:ü|ue)r\\s+(\\d{1,7})\\s+(sekunden?|minuten?|stunden?)[.!?]?$', 'iu').exec(raw))) {
    const durationSeconds = Number(match[3]) * (/^min/i.test(match[4]) ? 60 : /^stund/i.test(match[4]) ? 3600 : 1);
    if (durationSeconds < 1 || durationSeconds > 1209600) return ambiguous('Nenne für die Sperre eine Dauer zwischen einer Sekunde und 14 Tagen.');
    return {kind: 'moderation', operation: 'timeout', userName: match[1].replace(/^@/, ''), platform: match[2]?.toLowerCase() || null, durationSeconds};
  }
  if ((match = new RegExp('^(blockiere|blockier|blocke|banne|sperre|entblocke|entblockiere|entsperre|entbanne)\\s+' + name + platform + '[.!?]?$', 'iu').exec(raw))) {
    return {kind: 'moderation', operation: /^ent/i.test(match[1]) ? 'unban' : 'ban', userName: match[2].replace(/^@/, ''), platform: match[3]?.toLowerCase() || null};
  }
  return null;
}
function resolveCommand(input, {catalog = {}, sceneAliases = {}} = {}) {
  if (typeof input !== 'string' || input.length > 1500) return null;
  const text = normalizeCommand(input);
  if (!text) return {kind: 'help', text: 'Ich höre. Sag zum Beispiel: Mach bitte Pause, öffne das Touch Deck oder Windows Lautstärke auf 35 Prozent.'};
  if (/^(?:bestatigen|bestatige|ja bestatigen|ja bestatige)$/.test(text)) return {kind: 'confirmation'};
  if (/^(?:abbrechen|nicht bestatigen|nein abbrechen)$/.test(text)) return {kind: 'cancel-confirmation'};
  if (/^(?:hilfe|befehle|befehlsliste|was kannst du|welche befehle (?:kennst|kannst) du|zeige (?:mir )?(?:die )?befehle)$/.test(text))
    return {kind: 'help', text: commandExamples(catalog).map(example => example.phrase).join('. ') + '. Frage außerdem gezielt nach PC-Messwerten, zum Beispiel GPU-Temperatur oder Lüfterdrehzahl.'};
  // Negation and multiple commands must not accidentally execute the first match.
  // These two phrases are explicit requests to stop reading, not negated actions.
  const stopReading = /^(?:lies|lese) (?:den |die )?(chat|nachrichten|geschenke|likes|follower|ereignisse) nicht mehr vor$/.exec(text);
  if (stopReading) return select(catalog, 'jarvis', `${stopReading[1]} vorlesen`, JARVIS, {op: 'off'});
  if (text === 'sprich nicht weiter') return simple(catalog, 'speech-stop', 'Sprachausgabe gestoppt.');
  const moderation = moderationCommand(input);
  // The filter term is literal data; e.g. Filterwort "kein" hinzufügen is an
  // affirmative add request even though the term itself contains a negation.
  if (moderation?.kind === 'filter') return moderation;
  if (/\b(?:nicht|nichts|kein|keine|keinen|keinem|keiner|ohne|niemals|niemand|niemanden|vielleicht|eventuell|falls|wenn|warum|wieso)\b/.test(text)) return null;
  if (moderation) return moderation;
  const compound = /\b(?:und|danach|anschliessend|dann|aber|oder)\b/.test(text);
  // The full name of a saved action may legitimately contain "und". It is only
  // accepted with an explicit action verb and an exact catalog match below.
  const named = [
    ['broadcast', /^(?:sende|send|schicke) (?:den |das )?(?:broadcast|rundruf) (.+)$/],
    ['chain', /^(?:(?:starte|starte die|fuhre|fuhre die) (?:aktionskette|kette) (.+?)(?: aus)?|(?:aktionskette|kette) (.+?) (?:starten|ausfuhren))$/],
    ['event', /^(?:(?:starte|lose|fuhre) (?:das )?(?:ereignis|event) (.+?)(?: aus)?|(?:ereignis|event) (.+?) (?:starten|auslosen|ausfuhren))$/],
    ['hotkey', /^(?:(?:fuhre|starte|drucke) (?:den )?hotkey (.+?)(?: aus)?|hotkey (.+?) (?:ausfuhren|drucken))$/],
    ['media', /^(?:(?:spiele|spiel|starte) (?:das )?(?:medium|video|audio|lied|sound) (.+?)(?: ab)?|(?:medium|video|audio|lied|sound) (.+?) abspielen)$/]
  ];
  for (const [id, pattern] of named) {
    const match = pattern.exec(text);
    if (!match) continue;
    const query = match[1] || match[2];
    if (compound && !choices(catalog, id).some(item => choiceMatches(item, query, {}, id))) break;
    return select(catalog, id, query);
  }
  if (compound) return ambiguous('Bitte gib mir einen Befehl nach dem anderen. Für mehrere Schritte kannst du eine gespeicherte Aktionskette nennen.');
  if (/^(?:(?:schalte|mach|mache) )?(?:das )?mikrofon (?:aus|an|ein|stumm)$/.test(text)) return ambiguous('Meinst du das Jarvis-Mikrofon? Sag dafür: Dauerhaft zuhören aus oder Dauerhaft zuhören an.');
  const audio = audioCommand(text);
  if (audio) return audio;
  if (/^(?:stopp|stop|ruhe|sei still|schweigen|sei ruhig|hor auf zu sprechen|sprich nicht weiter)$/.test(text)) return simple(catalog, 'speech-stop', 'Sprachausgabe gestoppt.');
  if (/^(?:hore zu|hor zu|zuhoren|ich habe eine frage)$/.test(text)) return simple(catalog, 'listen', 'Ich höre.');
  // Explicit scene phrases win over view navigation ("Start Szene öffnen").
  const explicitScene = /^(?:(?:offne|offnen|zeige|zeig|aktiviere|starte|wechsle (?:zu|zur)|wechsel (?:zu|zur)) (?:die )?)?(?:szene (.+?)|(.+?) szene|((?:pausen?|spiel|start|ende?)szene))(?: (?:offnen|anzeigen|aktivieren))?$/.exec(text);
  if (explicitScene) {
    const requested = explicitScene[1] || explicitScene[2] || explicitScene[3];
    const key = Object.keys(SCENE_ALIASES).find(id => SCENE_ALIASES[id].includes(requested));
    return select(catalog, 'scene', normalize(sceneAliases[key] || (key ? {pause: 'Pause', spiel: 'Spiel', start: 'Start', ende: 'Ende'}[key] : requested)));
  }
  const navigation = /^(?:offne|offnen|zeige|zeig|gehe zu|geh zu|wechsle zu|wechsel zu) (?:mir )?(?:(?:den|die|das|der|dem) )?(.+?)(?: fenster)?$/.exec(text) || /^(.+?)(?: fenster)? (?:offnen|anzeigen)$/.exec(text);
  if (navigation) {
    const query = navigation[1];
    if (query === 'start') return ambiguous('Meinst du die Startszene oder die Startseite? Sag: Startszene öffnen oder Startseite öffnen.');
    const known = choices(catalog, 'navigate').some(item => choiceMatches(item, query, NAVIGATION));
    if (known) return select(catalog, 'navigate', query, NAVIGATION);
    if (/^(?:tikfinity|tikfinity web|tikfinity website)$/.test(query)) return simple(catalog, 'tikfinity', 'TikFinity geöffnet.');
    if (/^(?:batto|tool|programm|hauptfenster|batto fenster)$/.test(query)) return simple(catalog, 'show', 'Batto geöffnet.');
    if (!/^(?:szene|zur szene) /.test(query)) return ambiguous('Diesen Programmbereich finde ich nicht. Sag zum Beispiel: Öffne Touch Deck, Dual Stream oder Einstellungen.');
  }
  let sceneQuery = null;
  const scene = /^(?:(?:mach|mache|aktiviere|starte) (?:die )?|(?:wechsle|wechsel|schalte) (?:zu|zur|auf|in) (?:die )?(?:szene )?|szene )(.+)$/.exec(text);
  if (scene) sceneQuery = targetText(scene[1]).replace(/^szene /, '');
  else if (Object.values(SCENE_ALIASES).some(list => list.includes(text)) || choices(catalog, 'scene').some(item => choiceMatches(item, text))) sceneQuery = text;
  if (sceneQuery) {
    const key = Object.keys(SCENE_ALIASES).find(id => SCENE_ALIASES[id].includes(sceneQuery));
    const query = normalize(sceneAliases[key] || (key ? {pause: 'Pause', spiel: 'Spiel', start: 'Start', ende: 'Ende'}[key] : sceneQuery));
    if (key || choices(catalog, 'scene').some(item => choiceMatches(item, query))) {
      const result = select(catalog, 'scene', query);
      if (result.kind === 'action') result.reply = `Die Szene ${choices(catalog, 'scene').find(c => c.id === result.action.target).name} ist ausgewählt.`;
      return result;
    }
  }
  const stream = /^(?:(?:starte|stoppe|beende) (?:die )?)?((?:beide )?(?:streams|virtuelle[n]? kameras?)|(?:tiktok|twitch)(?: ausgabe| kamera| virtuelle kamera)?)(?: (starten|stoppen|beenden))?$/.exec(text);
  if (stream && (/^(?:starte|stoppe|beende) /.test(text) || stream[2])) {
    const op = /^starte /.test(text) || stream[2] === 'starten' ? 'start' : 'stop';
    const query = /^(?:tiktok|twitch)/.exec(stream[1])?.[0] || 'both';
    const result = select(catalog, op, query);
    if (result.kind === 'action') result.reply = `Virtuelle Kamera ${query === 'both' ? 'für beide Ausgaben' : 'für ' + stream[1]} ${op === 'start' ? 'gestartet' : 'gestoppt'}.`;
    return result;
  }
  if (/^(?:bildquellen vorbereiten|bereite (?:die )?bildquellen vor|kamera vorbereiten)$/.test(text)) return simple(catalog, 'prepare', 'Bildquellen vorbereitet.');
  if (/^(?:video dienst ausschalten|videodienst ausschalten|beende (?:den )?video ?dienst|bildquellen freigeben)$/.test(text)) return simple(catalog, 'release', 'Video-Dienst ausgeschaltet.');
  if (/^(?:gaming modus|gaming modus (?:an|ein|aktivieren)|aktiviere (?:den )?gaming modus|oberflache schliessen)$/.test(text)) return simple(catalog, 'gaming', 'Gaming-Modus aktiviert.');
  if (/^(?:gaming modus (?:aus|deaktivieren)|zeige (?:das )?hauptfenster|programm anzeigen|batto anzeigen)$/.test(text)) return simple(catalog, 'show', 'Batto geöffnet.');
  if (/^(?:automationen abbrechen|brich (?:die |alle )?automationen ab|stoppe (?:die |alle )?automationen)$/.test(text)) return simple(catalog, 'cancel', 'Automationen abgebrochen.');
  if (/^(?:like zahler zurucksetzen|setze (?:den )?like zahler zuruck|likes zurucksetzen)$/.test(text)) return simple(catalog, 'likes-reset', 'Like-Zähler zurückgesetzt.');
  const connection = /^(verbinde|trenne) (?:den |die |das )?(twitch|tiktok|tikfinity|youtube)(?: chat| verbindung)?$/.exec(text) || /^(twitch|tiktok|tikfinity|youtube)(?: chat| verbindung)? (verbinden|trennen)$/.exec(text);
  if (connection) {
    const prefix = /^(verbinde|trenne)$/.test(connection[1]);
    const query = prefix ? connection[2] : connection[1];
    return select(catalog, 'connect', query === 'tiktok' ? 'tikfinity' : query, {}, {op: /^(verbinde|verbinden)$/.test(prefix ? connection[1] : connection[2]) ? 'on' : 'off'});
  }
  const read = /^(?:lies|lese) (?:den |die )?(chat|nachrichten|geschenke|likes|follower|ereignisse) vor$/.exec(text);
  if (read) return select(catalog, 'jarvis', `${read[1]} vorlesen`, JARVIS, {op: 'on'});
  const sw = switchPhrase(text);
  if (sw) {
    const {query, op} = sw;
    if (/^(?:auto broadcast|autobroadcast|broadcast) (?:profil )?(.+)$/.test(query)) {
      const name = /^(?:auto broadcast|autobroadcast|broadcast) (?:profil )?(.+)$/.exec(query)[1];
      return select(catalog, 'broadcast-profile', name, {}, {op});
    }
    for (const [id, aliases] of [['source', {camera: ['kamera', 'cam', 'webcam', 'kamerabild'], game: ['spielbild', 'spielquelle', 'bildschirm', 'spiel aufnahme']}],
      ['overlay', {chat: ['chat einblendung', 'chat einblenden', 'chat overlay'], events: ['ereignis einblendung', 'ereignisse einblenden', 'ereignis overlay']}],
      ['jarvis', JARVIS], ['control', CONTROLS]]) {
      if (choices(catalog, id).some(item => choiceMatches(item, query, aliases))) return select(catalog, id, query, aliases, {op});
    }
    if (/^(?:live studio|tiktok live studio)(?: sitzung)?$/.test(query)) {
      const result = simple(catalog, 'companion', 'LIVE-Studio-Sitzung aktualisiert.');
      if (result.kind === 'action') result.action.op = op;
      return result;
    }
    if (/^(?:twitch|youtube|tiktok|tikfinity)(?: chat| verbindung)?$/.test(query)) return select(catalog, 'connect', query.split(' ')[0] === 'tiktok' ? 'tikfinity' : query.split(' ')[0], {}, {op});
    return unavailable();
  }
  return null;
}
function commandExamples(catalog = {}, {limit = 18} = {}) {
  const examples = [], has = id => !!definition(catalog, id), present = (id, target) => choices(catalog, id).some(c => c.id === target);
  const add = (phrase, description) => examples.push({phrase, description});
  if (present('scene', 'Start')) add('Start Szene öffnen', 'Startszene auswählen');
  if (present('navigate', 'dashboard')) add('Multi Chat öffnen', 'Chat anzeigen');
  if (present('scene', 'Pause')) add('Mach bitte Pause', 'Pausenszene auswählen');
  for (const [id, name] of [['touchdeck', 'Touch Deck'], ['dualstream', 'Dual Stream'], ['settings', 'Einstellungen']]) if (present('navigate', id)) add(`Öffne ${name}`, `${name} anzeigen`);
  if (present('scene', 'Spiel')) add('Wechsel zur Spielszene', 'Spielszene auswählen');
  if (present('source', 'camera')) add('Kamera an', 'Kamerabild einschalten');
  if (present('control', 'broadcast.master')) add('Auto-Broadcast aus', 'Automatische Broadcasts abschalten');
  if (present('jarvis', 'chatEnabled')) add('Chat vorlesen aus', 'Jarvis liest keine Chatnachrichten mehr');
  if (present('connect', 'twitch')) add('Verbinde Twitch', 'Twitch-Chat verbinden');
  if (present('start', 'both')) add('Starte beide virtuelle Kameras', 'Virtuelle Kamera für beide Ausgaben starten');
  if (has('gaming')) add('Gaming-Modus an', 'Oberfläche schließen, Dienste weiterlaufen lassen');
  if (has('show')) add('Zeige das Hauptfenster', 'Batto anzeigen');
  add('Windows Lautstärke auf 35 Prozent', 'Windows-Lautstärke einstellen');
  add('Mach Jarvis leiser', 'Jarvis-Stimme um 5 Prozentpunkte leiser stellen');
  for (const [id, prefix] of [['broadcast-profile', 'Auto-Broadcast'], ['chain', 'Starte Aktionskette'], ['media', 'Spiele Medium'], ['broadcast', 'Sende Broadcast']]) {
    const item = choices(catalog, id).find(c => c.name.length <= 100 && !choices(catalog, id).some(other => other !== c && normalize(spokenChoiceName(other, id)) === normalize(spokenChoiceName(c, id))));
    if (item) add(`${prefix} ${spokenChoiceName(item, id)}${id === 'broadcast-profile' ? ' an' : id === 'media' ? ' ab' : ''}`, `${definition(catalog, id).name}: ${item.name}`);
  }
  return examples.slice(0, Math.max(1, Math.min(30, Number.isFinite(limit) ? Math.floor(limit) : 18)));
}
module.exports = {normalize, normalizeCommand, resolveCommand, commandExamples};
