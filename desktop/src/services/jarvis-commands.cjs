'use strict';
const {SETTING_SPECS,validateSetting}=require('./jarvis-setting-actions.cjs');

// Command recognition stays local. Every executable ID must come from the live
// control catalog; names spoken by a user never become executable code or paths.
function normalize(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9%]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function normalizeCommand(value, {preservePoliteness=false}={}) {
  let text = normalize(value);
  text = text.replace(/^(?:hey|hi|hallo|okay|ok) (?=(?:jarvis|javis|dschavis|jarwis)\b)/, '')
    .replace(/^(?:javis|dschavis|jarwis)\b/, 'jarvis');
  // "Jarvis leiser" addresses his own voice, rather than an omitted command.
  if (!/^(?:jarvis|javis|dschavis|jarwis) (?:lauter|leiser|lautstarke|stumm|ton|mikrofon|einstellungen)/.test(text)) {
    text = text.replace(/^(?:(?:hey|hallo|okay|ok) )?(?:jarvis|javis|dschavis|jarwis)\b\s*/, '');
  }
  text=text.replace(/^(?:(?:kannst|konntest|wurdest) du (?:mir )?|ich (?:mochte|will|wurde gern|hatte gerne) )/, '');
  return (preservePoliteness?text:text.replace(/\bbitte\b/g, ' ')).trim().replace(/\s+/g, ' ');
}
const ambiguous = text => ({kind: 'ambiguous', text});
const unavailable = () => ambiguous('Diese Funktion ist gerade nicht verfügbar. Öffne die Befehlsübersicht für die verfügbaren Befehle.');
const NAVIGATION = {
  touchdeck: ['touch deck', 'batto touch deck', 'touchdeck', 'tuch deck'], dualstream: ['dual stream', 'dualstream'],
  jarvis: ['jarvis', 'javis', 'jarvis einstellungen', 'javis einstellungen'], sensors: ['pc werte', 'pc messwerte', 'messwerte', 'sensoren'],
  fans: ['lufter', 'luftersteuerung', 'fan atlas'], start: ['startseite', 'hauptseite'], dashboard: ['chat', 'multi chat', 'multichat'],
  wishlist: ['wunschliste'], widgets: ['widgets'], livecenter: ['live center'], moderation: ['moderation'],
  chatarchive: ['chatarchiv', 'chat archiv'], filters: ['filter', 'chat filter', 'chatfilter'], hologram: ['hologramm', 'chatfarben', 'chat farben', 'schottfarben', 'zettfarben'],
  platforms: ['plattformen'], commands: ['bot', 'bot befehle', 'kommands', 'comands'], broadcast: ['auto broadcast', 'autobroadcast', 'broadcast'],
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
  'events.subscriptions': ['abos', 'abos vorlesen', 'abos ansagen', 'abo danksagungen', 'abo danke', 'subscriptions', 'subs', 'abonnenten ansagen'],
  'fanAlerts.enabled': ['lufterwarnungen', 'lufter warnungen', 'lufterwarnung', 'lufter ansagen'],
  wakeWord: ['aktivierungswort', 'jarvis aktivierungswort', 'wake word'],
  headphones: ['kopfhorermodus', 'kopfhorer modus'],
  gamingMode: ['jarvis sparmodus', 'gaming sparmodus', 'sparmodus']
};
const CONTROLS = {
  'chatbot.enabled': ['bot', 'chat bot', 'chatbot'], 'bot.enabled': ['bot', 'chat bot', 'chatbot'], bot: ['bot', 'chat bot', 'chatbot'],
  'broadcast.master': ['auto broadcast', 'autobroadcast', 'automatische broadcasts', 'automatische nachrichten'],
  'tts.enabled': ['tts', 'chat stimme'], 'chatArchive.enabled': ['chatarchiv', 'chat archiv'],
  'viewerCount.enabled': ['zuschauerzahl'], 'chatFilter.enabled': ['chat filter', 'chatfilter'],
  'overlay.snow': ['schnee'], 'overlay.likeBar': ['like balken'], 'battleBar.enabled': ['battle bar', 'match anzeige'],
  'chatWindow.detached': ['chatfenster entkoppeln','chatfenster entkopplung']
};
const SCENE_ALIASES = {pause: ['pause', 'pausenszene', 'pause szene', 'bin gleich zuruck'],
  spiel: ['spiel', 'spielszene', 'spiel szene', 'gaming', 'weiter', 'zuruck zum spiel'],
  start: ['start', 'startszene', 'start szene', 'stream startet'], ende: ['ende', 'endszene', 'ende szene', 'stream ende']};
const definition = (catalog, id) => [...(catalog?.actions||[]),...(catalog?.voiceActions||[])].find(a => a?.id === id);
const choices = (catalog, id) => (definition(catalog, id)?.choices || []).filter(c => c && typeof c.id === 'string' && typeof c.name === 'string');
function spokenChoiceName(item, action) {
  // The shared deck catalog decorates these names for drop-downs. Remove only
  // that explicit cosmetic prefix, preserving the exact saved name beneath it.
  if (action === 'hotkey') return item.name.replace(/^Hotkey:\s*/i, '');
  if (action === 'broadcast') return item.name.replace(/^Auto-Broadcast:\s*/i, '');
  if (action === 'control') return item.name.replace(/\s+an\s*\/\s*aus$/i, '');
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
  if ((match = /^blende (.+?) (ein|aus)$/.exec(text))) {
    query=targetText(match[1]);op=match[2]==='ein'?'on':'off';
  } else if ((match=/^(verstecke|versteck) (.+)$/.exec(text))) {
    query=targetText(match[2]);op='off';
  } else if ((match = /^(?:schalte|schalt|mache|mach|stelle|stell|setze|setz) (.+?) (an|ein|aus|stumm|einblenden|ausblenden|einschalten|ausschalten|aktivieren|deaktivieren|anmachen|ausmachen|umschalten)$/.exec(text)) ||
      (match = /^(.+?) (an|ein|aus|stumm|einblenden|ausblenden|einschalten|ausschalten|aktivieren|deaktivieren|anmachen|ausmachen|umschalten)$/.exec(text))) {
    query = targetText(match[1]); op = match[2]==='umschalten'?'toggle':/^(?:an|ein|einblenden|einschalten|aktivieren|anmachen)$/.test(match[2]) ? 'on' : 'off';
  } else if ((match = /^(aktiviere|aktivier|deaktiviere|deaktivier|starte|stoppe|beende) (.+)$/.exec(text))) {
    query = targetText(match[2]); op = /^(?:aktiviere|aktivier|starte)$/.test(match[1]) ? 'on' : 'off';
  } else if ((match = /^(?:schalte|schalt) (.+) um$/.exec(text))) {
    query = targetText(match[1]); op = 'toggle';
  }
  return query ? {query, op} : null;
}
function spokenInteger(input){
  const text=input.trim();
  if(/^\d+$/.test(text))return Number(text);
  if(/^\d{1,3}(?: \d{3})+$/.test(text))return Number(text.replace(/ /g,''));
  const units={null:0,ein:1,eins:1,zwei:2,drei:3,vier:4,funf:5,sechs:6,sieben:7,acht:8,neun:9,zehn:10,elf:11,zwolf:12,dreizehn:13,vierzehn:14,funfzehn:15,sechzehn:16,siebzehn:17,achtzehn:18,neunzehn:19,zwanzig:20,dreissig:30,vierzig:40,funfzig:50,sechzig:60,siebzig:70,achtzig:80,neunzig:90,hundert:100,einhundert:100,tausend:1000,eintausend:1000,zehntausend:10000};
  if(Object.hasOwn(units,text))return units[text];
  let match=/^(.+?)und(.+)$/.exec(text);
  if(match&&units[match[1]]>0&&units[match[1]]<10&&units[match[2]]>=20&&units[match[2]]<100)return units[match[1]]+units[match[2]];
  match=/^(.+?)\s*(?:k|tausend)$/.exec(text);
  if(match){const value=spokenInteger(match[1]);if(Number.isInteger(value)&&value>0&&value<=100000)return value*1000;}
  match=/^(?:ein)?hundert([a-z]+)$/.exec(text);
  if(match){const value=spokenInteger(match[1]);if(Number.isInteger(value)&&value>0&&value<100)return 100+value;}
  return NaN;
}
function settingCommand(text,catalog){
  const result=(target,value,extra={})=>{
    if(!choices(catalog,'jarvis-setting').some(c=>c.id===target))return unavailable();
    const action={action:'jarvis-setting',target,...(value===undefined?{}:{value}),...extra};
    try{validateSetting(action);}catch(error){return ambiguous(error.message);}
    return {kind:'action',action,reply:SETTING_SPECS[target].name+' aktualisiert.'};
  };
  const exactModes={
    'lies alle chatnachrichten vor':'all','lies den gesamten chat vor':'all','lies alles im chat vor':'all',
    'lies nur moderatoren vor':'moderators','lies nur nachrichten von moderatoren vor':'moderators','lies nur moderator nachrichten vor':'moderators',
    'lies nur freigegebene personen vor':'allowlist','lies nur die freigabeliste vor':'allowlist','lies nur erlaubte personen vor':'allowlist'
  };
  if(Object.hasOwn(exactModes,text))return result('chatMode',exactModes[text]);
  let match=/^(?:(?:stelle|stell|setze|setz) (?:den )?)?chat (?:modus|auswahl) auf (alle|moderatoren|freigabeliste|erlaubte personen)$/.exec(text);
  if(match)return result('chatMode',{alle:'all',moderatoren:'moderators',freigabeliste:'allowlist','erlaubte personen':'allowlist'}[match[1]]);
  if(/^(?:lies (?:nachrichten )?aus dem chatfenster vor|chat quelle auf (?:fenster|chatfenster))$/.test(text))return result('chatSource','window');
  if(/^(?:lies (?:nachrichten )?aus (?:allen )?verbundenen chats vor|chat quelle auf verbundene chats)$/.test(text))return result('chatSource','connected');
  match=/^(?:(?:stelle|stell|setze|setz) (?:die )?)?(?:geschenk ansage|geschenke ansagen) auf (geschenkname|geschenk|coins|beides|geschenkname und coins|geschenke und coins)$/.exec(text);
  if(match)return result('events.giftAnnouncement',/und|beides/.test(match[1])?'both':match[1]==='coins'?'coins':'gift');
  match=/^(?:lies|sage|sag) (?:bei geschenken )?(?:den )?(geschenknamen|geschenkname|coins|geschenkname und coins|geschenknamen und coins) (?:vor|an)$/.exec(text);
  if(match)return result('events.giftAnnouncement',/ und /.test(match[1])?'both':match[1]==='coins'?'coins':'gift');
  if(/^(?:sprich|rede) (?:etwas )?(?:schneller|langsamer)$/.test(text)||/^(?:schneller|langsamer) sprechen$/.test(text))return result('speechRate',undefined,{delta:/langsamer/.test(text)?-10:10});
  const numeric=[
    ['events.likeThreshold',/^(?:lies|sage|sag) likes ab (.+?) (?:vor|an)$/],
    ['events.likeThreshold',/^likes ab (.+?) (?:ansagen|vorlesen)$/],
    ['events.likeThreshold',/^(?:like schwelle|likes schwelle|like grenze|like ansagen) (?:auf|ab) (.+?)(?: likes)?$/],
    ['events.giftMinimum',/^(?:geschenk mindestwert|geschenke mindestwert) (?:auf|ab) (.+?) coins$/],
    ['speechRate',/^(?:(?:stelle|stell|setze|setz) (?:das |dein )?)?(?:sprechtempo|sprechgeschwindigkeit) auf (.+?)(?: worter pro minute)?$/],
    ['fanAlerts.threshold',/^(?:lufterwarnung|lufter warnung|lufterwarnungen|lufter warnschwelle) (?:ab|auf) (.+?) (?:prozent|%)$/],
    ['fanAlerts.threshold',/^(?:warne|warn) mich (?:bei luftern|bei lufterdrehzahl) ab (.+?) (?:prozent|%)$/],
    ['events.cooldown',/^(?:ereignis abstand|abstand zwischen ereignis ansagen) auf (.+?) sekunden$/],
    ['chatCooldown',/^(?:chat abstand|abstand zwischen chatnachrichten) auf (.+?) sekunden$/],
    ['chatMaxLength',/^chat lange auf (.+?) zeichen$/],
    ['fanAlerts.cooldown',/^(?:lufterwarnung abstand|abstand zwischen lufterwarnungen) auf (.+?) sekunden$/]
  ];
  for(const [target,pattern] of numeric){match=pattern.exec(text);if(match)return result(target,spokenInteger(match[1]));}
  return null;
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
function quotedCatalogCommand(input,catalog){
  const quoted=String(input).match(/"(?:\\.|[^"\\])*"/g);
  if(!quoted||quoted.length!==1)return null;
  let value;try{value=JSON.parse(quoted[0]);}catch{return null;}
  const text=normalizeCommand(input.replace(quoted[0],' katalogziel '));
  const marker='(?:(mit kennung) )?katalogziel',article='(?:(?:den|die|das) )?';
  const kinds=[['scene','szene','(?:offne|starte|aktiviere)','(?:offnen|anzeigen|aktivieren)'],['chain','(?:aktionskette|kette)','(?:starte|starte die|fuhre|fuhre die)','(?:starten|ausfuhren)'],['event','(?:ereignis|event)','(?:starte|lose|fuhre)','(?:starten|auslosen|ausfuhren)'],['hotkey','hotkey','(?:fuhre|starte|drucke)','(?:ausfuhren|drucken)'],['broadcast','(?:broadcast|rundruf)','(?:sende|send|schicke)','(?:senden|verschicken)'],['media','(?:medium|video|audio|lied|sound)','(?:spiele|spiel|starte)','(?:abspielen|starten)']];
  const finish=(id,identifier,extra={})=>{
    if(!definition(catalog,id))return unavailable();
    const matches=choices(catalog,id).filter(item=>identifier?item.id===value:spokenChoiceName(item,id)===value||item.name===value);
    if(matches.length!==1)return ambiguous(matches.length?'Mehrere Ziele heißen so. Verwende die eindeutige Variante aus der Befehlsliste oder benenne sie um.':'Diesen Namen finde ich nicht. Wähle einen vorhandenen Eintrag aus der Befehlsliste.');
    return {kind:'action',action:{action:id,target:matches[0].id,...extra},reply:`${matches[0].name}: ${extra.op==='on'?'eingeschaltet':extra.op==='off'?'ausgeschaltet':extra.op==='toggle'?'umgeschaltet':'ausgeführt'}.`};
  };
  for(const [id,noun,verb,last]of kinds){
    const match=new RegExp('^(?:'+verb+' '+article+noun+' '+marker+'(?: aus| ab)?|'+article+noun+' '+marker+' '+last+')$').exec(text);
    if(match)return finish(id,!!(match[1]||match[2]));
  }
  for(const [id,noun]of [['broadcast-profile','(?:auto broadcast|autobroadcast|broadcast) profil'],['control','funktion'],['jarvis','jarvis schalter'],['source','bildquelle'],['overlay','einblendung']]){
    const sw=switchPhrase(text);if(!sw)continue;
    const match=new RegExp('^'+noun+' '+marker+'$').exec(sw.query);if(match)return finish(id,!!match[1],{op:sw.op});
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
    return {kind: 'help', text: 'Du kannst Szenen, Programmbereiche, Chat, Jarvis und Lautstärke steuern. Zum Beispiel: '+commandExamples(catalog,{limit:6}).map(example => example.phrase).join('. ')+'. Alle Befehle und Vorlagen findest du in der durchsuchbaren Befehlsliste bei Jarvis. Frage außerdem gezielt nach PC-Messwerten, zum Beispiel GPU-Temperatur oder Lüfterdrehzahl.'};
  // Negation and multiple commands must not accidentally execute the first match.
  // These two phrases are explicit requests to stop reading, not negated actions.
  const stopReading = /^(?:lies|lese) (?:den |die )?(chat|nachrichten|geschenke|likes|follower|ereignisse|abos) nicht mehr vor$/.exec(text);
  if (stopReading) return select(catalog, 'jarvis', `${stopReading[1]} vorlesen`, JARVIS, {op: 'off'});
  const stopThanks=/^bedanke dich nicht mehr fur (?:neue )?(follower|abos|subs|abonnenten)$/.exec(text);
  if(stopThanks)return select(catalog,'jarvis',stopThanks[1]==='follower'?'follower':'abos',JARVIS,{op:'off'});
  if (text === 'sprich nicht weiter') return simple(catalog, 'speech-stop', 'Sprachausgabe gestoppt.');
  const moderation = moderationCommand(input);
  // The filter term is literal data; e.g. Filterwort "kein" hinzufügen is an
  // affirmative add request even though the term itself contains a negation.
  if (moderation?.kind === 'filter') return moderation;
  const quoted=quotedCatalogCommand(input,catalog);
  if(quoted)return quoted;
  if (/\b(?:nicht|nichts|kein|keine|keinen|keinem|keiner|ohne|niemals|niemand|niemanden|vielleicht|eventuell|falls|wenn|warum|wieso)\b/.test(text)) return null;
  if (moderation) return moderation;
  const setting=settingCommand(text,catalog);
  if(setting)return setting;
  const compound = /\b(?:und|danach|anschliessend|dann|aber|oder)\b/.test(text);
  const literalText=normalizeCommand(input,{preservePoliteness:true}).replace(/^bitte /,'').replace(/^(starte|fuhre|sende|send|schicke|spiele|spiel|lose|drucke|schalte|schalt) bitte /,'$1 ');
  // The full name of a saved action may legitimately contain "und". It is only
  // accepted with an explicit action verb and an exact catalog match below.
  const named = [
    ['broadcast', /^(?:(?:sende|send|schicke) (?:den |das )?(?:broadcast|rundruf) (.+)|(?:den |das )?(?:broadcast|rundruf) (.+?) (?:senden|verschicken))$/],
    ['chain', /^(?:(?:starte|starte die|fuhre|fuhre die) (?:aktionskette|kette) (.+?)(?: aus)?|(?:die )?(?:aktionskette|kette) (.+?) (?:starten|ausfuhren))$/],
    ['event', /^(?:(?:starte|lose|fuhre) (?:das )?(?:ereignis|event) (.+?)(?: aus)?|(?:das )?(?:ereignis|event) (.+?) (?:starten|auslosen|ausfuhren))$/],
    ['hotkey', /^(?:(?:fuhre|starte|drucke) (?:den )?hotkey (.+?)(?: aus)?|(?:den )?hotkey (.+?) (?:ausfuhren|drucken))$/],
    ['media', /^(?:(?:spiele|spiel|starte) (?:das )?(?:medium|video|audio|lied|sound) (.+?)(?: ab)?|(?:das )?(?:medium|video|audio|lied|sound) (.+?) abspielen)$/]
  ];
  for (const [id, pattern] of named) {
    const match = pattern.exec(literalText);
    if (!match) continue;
    const query = match[1] || match[2];
    if (compound && !choices(catalog, id).some(item => choiceMatches(item, query, {}, id))) break;
    return select(catalog, id, query);
  }
  const profileSwitch=switchPhrase(literalText),profileMatch=profileSwitch&&/^(?:auto broadcast|autobroadcast|broadcast) (?:profil )?(.+)$/.exec(profileSwitch.query);
  if(profileMatch)return select(catalog,'broadcast-profile',profileMatch[1],{},{op:profileSwitch.op});
  if (compound) return ambiguous('Bitte gib mir einen Befehl nach dem anderen. Für mehrere Schritte kannst du eine gespeicherte Aktionskette nennen.');
  // These exact, observed speech-recognition variants only open a harmless page.
  // Never apply fuzzy correction to switches, saved actions or moderation.
  const heardNavigation={'chatfarben':'hologram','chat farben':'hologram','schottfarben':'hologram','zettfarben':'hologram','ne chatfilter':'filters','ne chat filter':'filters'};
  if(Object.hasOwn(heardNavigation,text))return select(catalog,'navigate',heardNavigation[text]);
  const heardScene={'macht pause':'pause','nach pause':'pause','ach pause':'pause','so pause wechseln':'pause','marspiel':'spiel'};
  if(Object.hasOwn(heardScene,text))return resolveCommand(heardScene[text],{catalog,sceneAliases});
  if(text==='ich falte auto broadcast ein')return ambiguous('Meinst du „Schalte Auto-Broadcast ein“? Sage den Befehl erneut. Es wurde noch nichts eingeschaltet.');
  const detached=/^(?:chatfenster (entkoppeln|koppeln|andocken)|(?:entkopple|entkoppel) (?:das )?chatfenster|(?:kopple|koppel|docke) (?:das )?chatfenster(?: an)?)$/.exec(text);
  if(detached)return select(catalog,'control','chatwindow detached',{},{op:/entkopp/.test(text)?'on':'off'});
  if(/^(?:(?:offne|zeige|zeig) (?:mir )?(?:die )?(?:deine|jarvis) einstellungen|(?:die )?(?:deine|jarvis) einstellungen (?:offnen|anzeigen))$/.test(text))return definition(catalog,'jarvis-settings')?simple(catalog,'jarvis-settings','Jarvis-Einstellungen geöffnet.'):select(catalog,'navigate','jarvis',NAVIGATION);
  if(/^(?:mikrofone (?:neu laden|suchen|aktualisieren)|lade (?:die )?mikrofone neu|suche (?:nach )?mikrofonen)$/.test(text))return simple(catalog,'microphones','Die Mikrofonliste wird aktualisiert.');
  if(/^(?:teste (?:das |mein |dein )?mikrofon|mikrofon testen|starte (?:den )?mikrofontest)$/.test(text))return simple(catalog,'listen','Ich höre für den Mikrofontest.');
  const transition=/^(?:(?:stelle|stell|setze|setz) (?:den )?)?(?:ubergang|szenenubergang) auf (uberblendung|fade|schnitt|cut)$/.exec(text);
  if(transition)return select(catalog,'transition',/^(?:fade|uberblendung)$/.test(transition[1])?'fade':'cut');
  const duration=/^(?:(?:stelle|stell|setze|setz) (?:die )?)?ubergangsdauer auf (.+?) (?:millisekunden|ms)$/.exec(text);
  if(duration){const value=spokenInteger(duration[1]);if(!Number.isInteger(value)||value<100||value>2000)return ambiguous('Die Übergangsdauer muss zwischen 100 und 2000 Millisekunden liegen.');const result=simple(catalog,'transition-duration','Übergangsdauer aktualisiert.');if(result.kind==='action')result.action.value=value;return result;}
  const withTransition=/^(.+?) mit (?:dem ubergang )?(uberblendung|fade|schnitt|cut)(?: (?:von )?(\d+) (?:millisekunden|ms))?$/.exec(text);
  if(withTransition){const base=resolveCommand(withTransition[1],{catalog,sceneAliases});if(base?.kind==='action'&&base.action.action==='scene'){const durationMs=withTransition[3]===undefined?undefined:Number(withTransition[3]);if(durationMs!==undefined&&(durationMs<100||durationMs>2000))return ambiguous('Die Übergangsdauer muss zwischen 100 und 2000 Millisekunden liegen.');return {...base,action:{...base.action,transition:/^(?:fade|uberblendung)$/.test(withTransition[2])?'fade':'cut',...(durationMs===undefined?{}:{durationMs})}};}return ambiguous('Nenne eine vorhandene Szene mit Überblendung oder Schnitt.');}
  if (/^(?:(?:schalte|mach|mache) )?(?:das )?mikrofon (?:aus|an|ein|stumm)$/.test(text)) return ambiguous('Meinst du das Jarvis-Mikrofon? Sag dafür: Dauerhaft zuhören aus oder Dauerhaft zuhören an.');
  const audio = audioCommand(text);
  if (audio) return audio;
  if (/^(?:stopp|stop|ruhe|sei still|schweigen|sei ruhig|hor auf zu sprechen|sprich nicht weiter)$/.test(text)) return simple(catalog, 'speech-stop', 'Sprachausgabe gestoppt.');
  if (/^(?:hore zu|hor zu|zuhoren|ich habe eine frage)$/.test(text)) return simple(catalog, 'listen', 'Ich höre.');
  // Explicit scene phrases win over view navigation ("Start Szene öffnen").
  const explicitScene = /^(?:(?:offne|offnen|zeige|zeig|aktiviere|starte|wechsle (?:zu|zur)|wechsel (?:zu|zur)) )?(?:die )?(?:szene (.+?)|(.+?) szene|((?:pausen?|spiel|start|ende?)szene))(?: (?:offnen|anzeigen|aktivieren))?$/.exec(text);
  if (explicitScene) {
    const requested = explicitScene[1] || explicitScene[2] || explicitScene[3];
    const key = Object.keys(SCENE_ALIASES).find(id => SCENE_ALIASES[id].includes(requested));
    return select(catalog, 'scene', normalize(sceneAliases[key] || (key ? {pause: 'Pause', spiel: 'Spiel', start: 'Start', ende: 'Ende'}[key] : requested)));
  }
  const sceneMove=/^(?:(?:wechsle|wechsel|schalte) (?:zu|zur|auf|in) (?:die )?(?:szene )?(.+)|(?:(?:zu|zur|auf|in) (?:die )?)?(.+?) (?:wechseln|umschalten|machen|aktivieren))$/.exec(text);
  if(sceneMove){const query=targetText(sceneMove[1]||sceneMove[2]).replace(/^szene /,'');const key=Object.keys(SCENE_ALIASES).find(id=>SCENE_ALIASES[id].includes(query));if(key)return select(catalog,'scene',normalize(sceneAliases[key]||{pause:'Pause',spiel:'Spiel',start:'Start',ende:'Ende'}[key]));}
  const navigation = /^(?:offne|offene|offnen|offnet|eroffne|zeige|zeig|(?:gehe|geh|wechsle|wechsel) (?:zu|zum|zur)|dexel zu) (?:mir )?(?:(?:den|die|das|der|dem) )?(.+?)(?: fenster)?$/.exec(text) || /^(?:(?:zu|zur|zum) )?(.+?)(?: fenster)? (?:offnen|anzeigen|wechseln)$/.exec(text);
  if (navigation) {
    // Polite questions become "das Touch Deck öffnen" after normalization.
    // Handle the article in this verb-last form just as in "öffne das Touch Deck".
    const query = targetText(navigation[1]);
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
  const stream = /^(?:(?:starte|stoppe|stopp|beende) (?:die )?)?((?:beide )?(?:streams|virtuelle[n]? kameras?)|(?:tiktok|twitch)(?: ausgabe| kamera| virtuelle kamera)?)(?: (starten|stoppen|beenden))?$/.exec(text);
  if (stream && (/^(?:starte|stoppe|stopp|beende) /.test(text) || stream[2])) {
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
  const connection = /^(verbinde|trenne) (?:(?:dich mit|die verbindung zu|den|die|das) )?(twitch|tiktok|tikfinity|youtube)(?: chat| verbindung)?$/.exec(text) || /^(twitch|tiktok|tikfinity|youtube)(?: chat| verbindung)? (verbinden|trennen)$/.exec(text);
  if (connection) {
    const prefix = /^(verbinde|trenne)$/.test(connection[1]);
    const query = prefix ? connection[2] : connection[1];
    return select(catalog, 'connect', query === 'tiktok' ? 'tikfinity' : query, {}, {op: /^(verbinde|verbinden)$/.test(prefix ? connection[1] : connection[2]) ? 'on' : 'off'});
  }
  const thanks=/^bedanke dich fur (?:neue )?(follower|abos|subs|abonnenten)$/.exec(text);
  if(thanks)return select(catalog,'jarvis',thanks[1]==='follower'?'follower':'abos',JARVIS,{op:'on'});
  const read = /^(?:lies|lese) (?:den |die )?(chat|nachrichten|geschenke|likes|follower|ereignisse|abos) vor$/.exec(text);
  if (read) return select(catalog, 'jarvis', `${read[1]} vorlesen`, JARVIS, {op: 'on'});
  const sw = switchPhrase(text);
  if (sw) {
    const {query, op} = sw;
    const qualified=/^(bildquelle|einblendung|funktion|jarvis schalter|schalter) (.+)$/.exec(query);
    if(qualified){const id={bildquelle:'source',einblendung:'overlay',funktion:'control','jarvis schalter':'jarvis',schalter:'jarvis'}[qualified[1]];return select(catalog,id,qualified[2],{},{op});}
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
function commandExamples(catalog = {}, {limit} = {}) {
  const examples=[],phrases=new Set(),has=id=>!!definition(catalog,id),present=(id,target)=>choices(catalog,id).some(c=>c.id===target);
  const groups={scene:'Szenen & Übergänge',transition:'Szenen & Übergänge',start:'Bild & Ausgaben',stop:'Bild & Ausgaben',source:'Bild & Ausgaben',overlay:'Einblendungen',jarvis:'Jarvis & Ansagen',control:'Chat & Automationen','broadcast-profile':'Auto-Broadcast',chain:'Aktionsketten',event:'Ereignisse',hotkey:'Hotkeys',broadcast:'Nachrichten senden',media:'Medien',connect:'Verbindungen',navigate:'Programmbereiche'};
  const add=(phrase,description,category,expectedAction,metadata={})=>{if(phrases.has(phrase))return;phrases.add(phrase);examples.push({phrase,description,category,...(expectedAction?{expectedAction,expectedKind:'action'}:{}),...metadata});};
  const action=(phrase,description,id,target,extra={},metadata={})=>add(phrase,description,groups[id]||'Jarvis & Ansagen',{action:id,...(target===undefined?{}:{target}),...extra},metadata);
  const sameAction=(phrase,expected)=>JSON.stringify(resolveCommand(phrase,{catalog})?.action)===JSON.stringify(expected);
  const choose=(variants,expected)=>variants.find(phrase=>sameAction(phrase,expected))||variants.at(-1);
  // Keep the six familiar quick-start cards in their established order.
  if(present('scene','Start'))action('Start Szene öffnen','Startszene auswählen','scene','Start');
  if(present('navigate','dashboard'))action('Multi Chat öffnen','Chat anzeigen','navigate','dashboard');
  if(present('scene','Pause'))action('Mach bitte Pause','Pausenszene auswählen','scene','Pause');
  for(const [id,name]of [['touchdeck','Touch Deck'],['dualstream','Dual Stream'],['settings','Einstellungen']])if(present('navigate',id))action(`Öffne ${name}`,`${name} anzeigen`,'navigate',id);
  if(present('scene','Spiel'))action('Wechsel zur Spielszene','Spielszene auswählen','scene','Spiel');
  if(present('source','camera'))action('Kamera an','Kamerabild einschalten','source','camera',{op:'on'});
  if(present('control','broadcast.master'))action('Auto-Broadcast aus','Automatische Broadcasts abschalten','control','broadcast.master',{op:'off'});
  if(present('jarvis','chatEnabled'))action('Chat vorlesen aus','Keine weiteren Chatnachrichten vorlesen','jarvis','chatEnabled',{op:'off'});
  if(present('connect','twitch'))action('Verbinde Twitch','Twitch-Chat verbinden','connect','twitch',{op:'on'});
  if(present('start','both'))action('Starte beide virtuelle Kameras','Virtuelle Kameras für beide Ausgaben starten','start','both');
  if(has('gaming'))action('Gaming-Modus an','Oberfläche schließen, Dienste weiterlaufen lassen','gaming');
  if(has('show'))action('Zeige das Hauptfenster','Batto anzeigen','show');
  add('Windows Lautstärke auf 35 Prozent','Windows-Lautstärke einstellen','Lautstärke',null,{expectedKind:'audio',expectedIntent:{kind:'audio',targetQuery:'Windows',patch:{volume:35}}});
  add('Mach Jarvis leiser','Jarvis-Stimme um 5 Prozentpunkte leiser stellen','Lautstärke',null,{expectedKind:'audio',expectedIntent:{kind:'audio',targetQuery:'Jarvis',delta:-5}});
  for(const [id,prefix,last]of [['broadcast-profile','Auto-Broadcast',' an'],['chain','Starte Aktionskette',''],['media','Spiele Medium',' ab'],['broadcast','Sende Broadcast','']]){
    for(const item of choices(catalog,id)){const phrase=`${prefix} ${spokenChoiceName(item,id)}${last}`,extra=id==='broadcast-profile'?{op:'on'}:{};
      if(sameAction(phrase,{action:id,target:item.id,...extra})){action(phrase,`${definition(catalog,id).name}: ${item.name}`,id,item.id,extra);break;}
    }
  }
  const literal=(id,item)=>{
    const name=spokenChoiceName(item,id),duplicate=choices(catalog,id).filter(other=>spokenChoiceName(other,id)===name||other.name===name).length>1;
    return duplicate?`mit Kennung ${JSON.stringify(item.id)}`:JSON.stringify(name);
  };
  const switchExample=(id,item,noun)=>{for(const [op,last]of [['on','einschalten'],['off','ausschalten'],['toggle','umschalten']]){
    const ending=op==='toggle'?'um':op==='on'?'ein':'aus',name=spokenChoiceName(item,id);
    const natural=id==='source'?{camera:'Kamera',game:'Spielbild'}[item.id]||name:id==='overlay'?{chat:'Chat-Einblendung',events:'Ereignis-Einblendung'}[item.id]||name:id==='broadcast-profile'?`Auto-Broadcast Profil ${name}`:item.id==='chatWindow.detached'?'Chatfenster Entkopplung':name;
    const expected={action:id,target:item.id,op},phrase=choose([`Schalte ${natural} ${ending}`,`Schalte ${noun} ${name} ${ending}`,`Schalte ${noun} ${literal(id,item)} ${ending}`],expected),typedOnly=phrase.includes('"');
    action(phrase,`${item.name}: ${last}`+(typedOnly?'. Eindeutige Textvariante; für Sprache bei Bedarf einen einfachen, eindeutigen Namen vergeben.':''),id,item.id,{op},{...(typedOnly?{typedOnly:true}:{})});
  }};
  for(const definition of catalog.actions||[]){
    const id=definition.id;
    if(id==='command')continue; // Saved-command recursion is intentionally not a voice capability.
    for(const item of choices(catalog,id)){
      if(id==='navigate')action(`Öffne ${item.name}`,`${item.name} anzeigen`,id,item.id);
      else if(id==='scene')action(choose([`Szene ${item.name} öffnen`,`Öffne Szene ${literal(id,item)}`],{action:id,target:item.id}),`${item.name} als Programmszene auswählen`,id,item.id);
      else if(id==='transition')action(`Übergang auf ${item.name}`,`${item.name} für folgende Szenenwechsel`,id,item.id);
      else if(id==='start'||id==='stop')action(`${item.id==='both'?'Beide virtuelle Kameras':item.id==='twitch'?'Twitch virtuelle Kamera':'TikTok virtuelle Kamera'} ${id==='start'?'starten':'stoppen'}`,`${item.name}: virtuelle Kamera ${id==='start'?'starten':'stoppen'}`,id,item.id);
      else if(['source','overlay','jarvis','control','broadcast-profile'].includes(id)){
        const noun={source:'Bildquelle',overlay:'Einblendung',jarvis:'Jarvis-Schalter',control:'Funktion','broadcast-profile':'Auto-Broadcast Profil'}[id];
        switchExample(id,item,noun);
        if(id==='control'&&item.id==='chatWindow.detached'){
          action('Chatfenster entkoppeln','Chatfenster separat anzeigen',id,item.id,{op:'on'});action('Chatfenster koppeln','Chatfenster wieder im Hauptfenster anzeigen',id,item.id,{op:'off'});
        }
      }else if(['chain','event','hotkey','broadcast','media'].includes(id)){
        const spec={chain:['Starte Aktionskette',''],event:['Löse Ereignis',' aus'],hotkey:['Drücke Hotkey',''],broadcast:['Sende Broadcast',''],media:['Spiele Medium',' ab']}[id];
        const phrase=choose([`${spec[0]} ${spokenChoiceName(item,id)}${spec[1]}`,`${spec[0]} ${literal(id,item)}${spec[1]}`],{action:id,target:item.id}),typedOnly=phrase.includes('"');
        action(phrase,`${definition.name}: ${item.name}`+(typedOnly?'. Eindeutige Textvariante; für Sprache bei Bedarf einen einfachen, eindeutigen Namen vergeben.':''),id,item.id,{},{...(typedOnly?{typedOnly:true}:{})});
      }else if(id==='connect'){
        const name={twitch:'Twitch',youtube:'YouTube',tikfinity:'TikFinity'}[item.id];
        if(name){action(`Verbinde ${name}`,`${name}: Chat-Verbindung herstellen`,id,item.id,{op:'on'});action(`Trenne ${name}`,`${name}: Chat-Verbindung trennen`,id,item.id,{op:'off'});action(`Schalte ${name} Verbindung um`,`${name}: Verbindung umschalten`,id,item.id,{op:'toggle'});}
      }
    }
  }
  for(const [id,phrase,description]of [
    ['listen','Hör zu','Einmal auf einen gesprochenen Befehl hören'],['speech-stop','Stopp','Sprachausgabe und aktuelle Aufnahme stoppen'],
    ['microphones','Mikrofone neu laden','Verfügbare Mikrofone erneut suchen'],['jarvis-settings','Öffne deine Einstellungen','Jarvis-Einstellungen anzeigen'],
    ['likes-reset','Setze den Like Zähler zurück','Like-Meilensteine für die laufende Sitzung zurücksetzen'],['cancel','Automationen abbrechen','Laufende Aktionsketten abbrechen'],
    ['tikfinity','Öffne TikFinity','TikFinity-Web öffnen'],['show','Zeige das Hauptfenster','Batto anzeigen'],['gaming','Gaming-Modus an','Oberfläche schließen, Dienste weiterlaufen lassen'],
    ['prepare','Bereite die Bildquellen vor','Bildquellen für den Sender vorbereiten'],['release','Bildquellen freigeben','Video-Dienst beenden, nachdem die Ausgaben gestoppt sind']
  ])if(has(id))action(phrase,description,id);
  if(has('companion'))for(const [op,phrase]of [['on','LIVE Studio Sitzung an'],['off','LIVE Studio Sitzung aus'],['toggle','Schalte LIVE Studio Sitzung um']])action(phrase,'LIVE-Studio-Sitzung im Tool markieren','companion',undefined,{op});
  if(has('listen'))action('Mikrofon testen','Einmal auf einen gesprochenen Testbefehl hören','listen');
  if(present('jarvis','events.subscriptions'))action('Bedanke dich für Abos','Abo-Danksagungen einschalten','jarvis','events.subscriptions',{op:'on'});
  const settings=[
    ['chatMode','all','Lies alle Chatnachrichten vor','Alle Personen auf den gewählten Plattformen vorlesen'],
    ['chatMode','moderators','Lies nur Moderatoren vor','Nur Moderatoren und Kanalinhaber vorlesen'],
    ['chatMode','allowlist','Lies nur die Freigabeliste vor','Nur freigegebene Personen vorlesen'],
    ['chatSource','window','Lies aus dem Chatfenster vor','Nachrichten aus der Chatfenster-Auswahl'],
    ['chatSource','connected','Lies aus verbundenen Chats vor','Nachrichten aus verbundenen Chats'],
    ['events.giftAnnouncement','gift','Geschenk-Ansage auf Geschenkname','Den Namen des Geschenks vorlesen'],
    ['events.giftAnnouncement','coins','Geschenk-Ansage auf Coins','Den übermittelten Coin-Wert vorlesen'],
    ['events.giftAnnouncement','both','Geschenk-Ansage auf Geschenkname und Coins','Geschenkname und übermittelten Coin-Wert vorlesen'],
    ['events.likeThreshold',1000,'Likes ab 1000 ansagen','Like-Schwelle je Person einstellen'],
    ['events.giftMinimum',10,'Geschenk-Mindestwert auf 10 Coins','Mindestwert für Geschenk-Ansagen einstellen'],
    ['events.cooldown',8,'Ereignis-Abstand auf 8 Sekunden','Mindestpause zwischen Ereignis-Ansagen'],
    ['speechRate',160,'Sprechtempo auf 160','Sprechtempo in Wörtern pro Minute'],
    ['chatCooldown',5,'Chat-Abstand auf 5 Sekunden','Mindestpause zwischen vorgelesenen Chatnachrichten'],
    ['chatMaxLength',280,'Chat-Länge auf 280 Zeichen','Maximale Länge vorgelesener Chatnachrichten'],
    ['fanAlerts.threshold',80,'Lüfterwarnung ab 80 Prozent','Lüfter-Warnschwelle einstellen'],
    ['fanAlerts.cooldown',90,'Lüfterwarnung-Abstand auf 90 Sekunden','Mindestpause zwischen Lüfterwarnungen']
  ];
  for(const [target,value,phrase,description]of settings)if(present('jarvis-setting',target)){
    const spec=SETTING_SPECS[target];action(phrase,description+(spec.min===undefined?'':`; ${spec.min}–${spec.max} ${spec.unit}. Zahl frei wählbar.`),'jarvis-setting',target,{value});
  }
  if(present('jarvis-setting','speechRate'))for(const [phrase,delta]of [['Sprich langsamer',-10],['Sprich schneller',10]])action(phrase,'Sprechtempo um 10 Wörter pro Minute ändern','jarvis-setting','speechRate',{delta});
  if(has('transition-duration'))action('Übergangsdauer auf 500 Millisekunden','Dauer für folgende Szenenwechsel; 100–2000 Millisekunden','transition-duration',undefined,{value:500});
  for(const targetQuery of ['Windows','Jarvis']){
    const audio=(phrase,description,patch)=>add(phrase,description,'Lautstärke',null,{expectedKind:'audio',expectedIntent:{kind:'audio',targetQuery,...patch}});
    audio(`${targetQuery} Lautstärke auf 35 Prozent`,'Lautstärke von 0 bis 100 Prozent einstellen',{patch:{volume:35}});
    audio(`Mach ${targetQuery} leiser`,'Lautstärke um 5 Prozentpunkte senken',{delta:-5});audio(`Mach ${targetQuery} lauter`,'Lautstärke um 5 Prozentpunkte erhöhen',{delta:5});
    audio(`${targetQuery} stumm`,'Ton stummschalten',{patch:{muted:true}});audio(`Hebe die Stummschaltung von ${targetQuery} auf`,'Ton wieder einschalten',{patch:{muted:false}});
  }
  for(const [phrase,description]of [['CPU Temperatur','Temperatur des Prozessors'],['GPU Temperatur','Temperatur der Grafikkarte'],['GPU Spannung','Übermittelte GPU-Spannung'],['CPU Auslastung','Auslastung des Prozessors'],['RAM Auslastung','Belegung des Arbeitsspeichers'],['Lüfterdrehzahl','Drehzahlen der verbundenen Lüfter'],['PC Werte','Wichtigste verfügbare PC-Messwerte']])add(phrase,description+'; nur tatsächlich verfügbare Messwerte.','PC-Messwerte',null,{expectedKind:'sensor'});
  const template=(phrase,description,category,requiresInput,expectedKind)=>add(phrase,description,category,null,{template:true,requiresInput,expectedKind});
  template('<Programm> Lautstärke auf 35 Prozent','Programm durch einen eindeutigen aktiven Audiokanal ersetzen.','Lautstärke',['Programm'],'audio');
  for(const platform of ['Twitch','YouTube'])for(const [verb,last,description]of [['Blockiere','','Person dauerhaft sperren'],['Entblocke','','Person entsperren'],['Sperre',' für 10 Minuten','Person zeitweise stummschalten']])template(`${verb} <Benutzername> auf ${platform}${last}`,`${description}. Namen ersetzen; verbundene Moderationsrechte und separate Bestätigung nötig.`,'Moderation',['Benutzername'],'moderation');
  template('Filterwort <Begriff> hinzufügen','Begriff ersetzen; passende Nachrichten im Chat ausblenden.','Chat-Filter',['Begriff'],'filter');
  template('Filterwort <Begriff> entfernen','Begriff ersetzen; vorhandene Filterregel entfernen.','Chat-Filter',['Begriff'],'filter');
  add('Bestätigen','Nur einen gerade vorgemerkten Moderationsauftrag bestätigen.','Moderation',null,{expectedKind:'confirmation'});
  add('Abbrechen','Eine vorgemerkte Moderation verwerfen.','Moderation',null,{expectedKind:'cancel-confirmation'});
  return Number.isFinite(limit)?examples.slice(0,Math.max(0,Math.floor(limit))):examples;
}
module.exports = {normalize, normalizeCommand, resolveCommand, commandExamples};
