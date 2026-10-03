// RELEASE_213_COMPLETE
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, nativeImage, globalShortcut, Tray, Menu } = require('electron');
const { BroadcastService } = require('../src/core/broadcast/service.cjs');
const { isAutoBroadcast } = require('../src/core/broadcast/visibility.cjs');
const { PlatformWriter } = require('../src/core/broadcast/platform-writer.cjs');
const { TikTokWriter } = require('../src/core/broadcast/tiktok-writer.cjs');
let tiktokWriter;
const { WelcomeService } = require('../src/core/broadcast/welcome.cjs');
let welcomeService;
const { BroadcastEchoTracker } = require('../src/core/broadcast/echo-tracker.cjs');
let broadcastEchoes;
let platformWriter;
const { TwitchLogin } = require('../src/core/broadcast/twitch-login.cjs');
let twitchLogin;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const { ChatCore } = require('../src/core/chat-core.cjs');
const { ConfigStore, DEFAULT_CONFIG } = require('../src/core/config-store.cjs');
const { SettingsService } = require('../src/core/settings/settings-service.cjs');
const { SecretsService } = require('../src/core/settings/secrets-service.cjs');
const { validateConfig } = require('../src/core/settings/schema.cjs');
const { EventCore } = require('../src/core/events/event-core.cjs');
const { ConnectorManager } = require('../src/core/connectors/connector-manager.cjs');
const { OverlayServer } = require('../src/core/overlay-server.cjs');
const { AudioOutputService } = require('../src/core/audio-output-service.cjs');
const { PiperTtsService, PIPER_VOICE_ID, PIPER_VOICE_NAME } = require('../src/core/tts-piper.cjs');
const { TikTokMatchService } = require('../src/core/tiktok-match.cjs');
const { OBSController } = require('../src/core/obs-controller.cjs');
const { StatusMonitor } = require('../src/core/status-monitor.cjs');
const { StreamerBotAdapter } = require('../src/adapters/streamerbot.cjs');
const { ChainService } = require('../src/core/chain-service.cjs');
const { InputHotkeys } = require('../src/core/input-hotkeys.cjs');
const { PhysicalInputBackend } = require('../src/core/physical-input.cjs');
const { createCommunityServices } = require('./community-services.cjs');
const { createChatExtrasService } = require('./chat-extras-service.cjs');
const { GiftRegistry } = require('../src/core/gifts/gift-registry.cjs');
let community,chatExtras;
const {SupportEvents}=require('../src/core/events/support-events.cjs');
const {NavigationService}=require('../src/core/navigation-service.cjs');
let streamerbot,chainService,inputHotkeys,supportEvents,navigation;
const { ActionEngine } = require('../src/core/action-engine.cjs');
const { Logger, redact } = require('../src/core/logging/logger.cjs');
const { diagnosticEntry, diagnosticContext } = require('../src/core/community/diagnostic-privacy.cjs');
const { HealthService } = require('../src/core/health/health-service.cjs');
const { AuditStore } = require('../src/core/storage/audit-store.cjs');
const { FFmpegService } = require('../src/core/media/ffmpeg-service.cjs');
const { validateChatBackgroundFile, isPathInside } = require('../src/core/media/chat-background.cjs');
const { LOCAL_CHAT_ICON_SIZE, validateLocalChatIconSource } = require('../src/core/media/local-chat-icon.cjs');
const { TikFinityAdapter } = require('../src/adapters/tikfinity.cjs');
const { TwitchPopout } = require('./twitch-popout.cjs');
const { YouTubeAdapter } = require('../src/adapters/youtube.cjs');
const { MockAdapter } = require('../src/adapters/mock.cjs');

let mainWindow;
let gamingMode=false, gamingTray, restoreDetached=false, gamingTimer, restoringWindow;
async function showMainWindow(){
 clearTimeout(gamingTimer);gamingTimer=null;gamingMode=false;
 if(restoringWindow)return restoringWindow;
 restoringWindow=(async()=>{
  if(!mainWindow||mainWindow.isDestroyed()){
   const win=createWindow(false);mainWindow=win;
   win.on('closed',()=>{if(mainWindow===win)mainWindow=null;if(!gamingMode&&!detachedWindow&&!require('../src/touch-bootstrap.cjs').getDetachedWindow()&&!require('../src/dual-stream/bootstrap.cjs').getDetachedWindow())app.quit();});
   await new Promise((resolve,reject)=>{win.webContents.once('did-finish-load',resolve);win.webContents.once('did-fail-load',()=>reject(Error('Batto-Fenster konnte nicht geladen werden.')));});
  }
  if(restoreDetached){restoreDetached=false;setChatDetached(true);}
  if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.restore();mainWindow.show();mainWindow.focus();}
  return mainWindow;
 })();
 try{return await restoringWindow;}finally{restoringWindow=null;}
}
function openFromTray(){void showMainWindow().catch(error=>bridgeLog('error','Gaming','WINDOW_RESTORE_FAILED',{message:error.message}));}
function enterGaming(){
 if(gamingMode||gamingTimer)return {ok:true};
 if(!gamingTray||gamingTray.isDestroyed()){
  gamingTray=new Tray(nativeImage.createFromPath(path.join(__dirname,'..','src','assets','app-icon.png')).resize({width:32,height:32}));
  gamingTray.setToolTip('Batto 3-in-1 – Gaming-Modus');gamingTray.setContextMenu(Menu.buildFromTemplate([{label:'Batto öffnen',click:openFromTray},{label:'Beenden',click:()=>app.quit()}]));gamingTray.on('double-click',openFromTray);
 }
 // Finish the IPC reply first. A quick Show action cancels this pending switch.
 gamingTimer=setTimeout(()=>{
  gamingTimer=null;gamingMode=true;
  const chat=detachedWindow,main=mainWindow;restoreDetached=!!chat&&!chat.isDestroyed();
  try{if(restoreDetached)chat.destroy();if(main&&!main.isDestroyed())main.destroy();}
  catch(error){bridgeLog('error','Gaming','WINDOW_RELEASE_FAILED',{message:error.message});openFromTray();}
 },200);return {ok:true};
}
let detachedWindow;
let configStore;
let settingsService;
let secretsService;
let chatCore;
let eventCore;
let connectorManager;
let overlayServer;
let audioOutput;
const audioPlayer=new (require('./audio-player.cjs').AudioPlayer)();
let piperTts, tiktokMatch;
let ttsEnabled = false;
let obs;
let statusMonitor;
let actionEngine;
let logger;
let healthService;
let auditStore;
let ffmpeg;
let adapters = {};
let broadcastService = null;
let autoBroadcastTimer = null;
let autoBroadcastDelayTimer = null;
let autoBroadcastIndex = 0;
let quitting = false, shutdownComplete = false;
let obsWasLive = false;

const SECRET_REFS = {
  obs: 'obs-password',
  youtube: 'youtube-api-key',
  discord: 'discord-webhook',
  cng: 'cng-obs-chat-url'
};
const CHAT_BACKGROUND_PRESET_URL = '../assets/source/crazy-batto-chat-default.jpg';

function send(channel, payload) {
  for (const win of [mainWindow, detachedWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      try { win.webContents.send(channel, payload); }
      catch (error) { if (!win.isDestroyed() && !win.webContents.isDestroyed()) throw error; }
    }
  }
}

function bridgeLog(level, module, code, context = {}) {
  const normalized = String(level || 'info').toLowerCase();
  const message = context?.message ? `${code}: ${context.message}` : String(code || '');
  if (chatCore) chatCore.log(normalized.toUpperCase(), module, message, { code, ...redact(context) });
  else logger?.write(normalized, module, code, message, diagnosticContext(context));
}

function migrateLegacySecrets(userDataPath) {
  try {
    const oldFile = path.join(userDataPath, 'BattoMultiChat', 'secrets.json');
    if (!fs.existsSync(oldFile) || !safeStorage.isEncryptionAvailable()) return;
    const old = JSON.parse(fs.readFileSync(oldFile, 'utf8')) || {};
    const mapping = {
      'obs.password': SECRET_REFS.obs,
      'youtube.apiKey': SECRET_REFS.youtube,
      'discord.webhook': SECRET_REFS.discord,
      'cng.obsChatUrl': SECRET_REFS.cng
    };
    for (const [legacyKey, ref] of Object.entries(mapping)) {
      if (secretsService.has(ref) || !old[legacyKey]) continue;
      try {
        const value = safeStorage.decryptString(Buffer.from(String(old[legacyKey]), 'base64'));
        if (value) secretsService.set(ref, value);
      } catch {}
    }
  } catch {}
}

function createWindow(detached = false) {
  const saved = configStore?.get()?.windows?.[detached ? 'detachedBounds' : 'mainBounds'];
  const win = new BrowserWindow({
    width: saved?.width || (detached ? 720 : 1600),
    height: saved?.height || 980,
    x: Number.isFinite(saved?.x) ? saved.x : undefined,
    y: Number.isFinite(saved?.y) ? saved.y : undefined,
    minWidth: detached ? 520 : 1180,
    autoHideMenuBar: true,
    minHeight: 700,
    show: false,
    title: detached ? 'Batto OBS Tool 2.1 – Multi-Chat' : 'Batto OBS Tool 2.1',
    backgroundColor: '#0b0b0c',
    icon: path.join(__dirname, '..', 'src', 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  const present=value=>{if(win.isDestroyed()||win.webContents.isDestroyed())return;try{win.webContents.send('suite:presentation',value);}catch{ /* The renderer may already be closing. */ }};
  for(const name of ['minimize','hide'])win.on(name,()=>present(true));
  for(const name of ['restore','show'])win.on(name,()=>present(false));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), {
    query: { detached: detached ? '1' : '0' }
  });
  win.once('ready-to-show', () => { if(!win.isDestroyed()&&!process.argv.some(x=>x.startsWith('--batto-qa')))win.show(); });
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url).catch(()=>{});return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(pathToFileURL(path.join(__dirname,'..','src','renderer','index.html')).href))event.preventDefault();});
  let timer;
  const saveBounds = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win.isDestroyed()) configStore.merge({ windows: { [detached ? 'detachedBounds' : 'mainBounds']: win.getBounds() } });
    }, 300);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.once('closed',()=>clearTimeout(timer));
  return win;
}

function normalizedToChat(event) {
  return {
    id: event.eventId,
    platform: event.platform,
    userId: event.user?.id,
    channelId:event.channelId||event.meta?.channelId||'',
    username: event.user?.username,
    displayName: event.user?.displayName,
    message: event.message?.text || '',
    timestamp: event.timestamp,
    badges: event.user?.badges || [],
    moderator: Boolean(event.user?.isModerator),
    identityVerified: event.user?.identityVerified===true,
    moderatorConfirmedAt: event.user?.moderatorConfirmedAt||null,
    isBroadcaster: event.user?.isBroadcaster===true,
    raw: event
  };
}

function normalizedToUiEvent(event) {
  const data = {
    user: event.user,
    message: event.message,
    gift: event.gift,
    moderation: event.moderation,
    username: event.user?.username,
    nickname: event.user?.displayName,
    uniqueId: event.user?.username,
    text: event.message?.text,
    giftName: event.gift?.name,
    count: event.gift?.count,
    value: event.gift?.value
  };
  return {
    source: event.meta?.sourceConnector,
    platform: event.platform,
    type: event.type,
    event: event.type,
    data,
    timestamp: event.timestamp,
    eventId: event.eventId
  };
}

function assetStatus() {
  const cfg = configStore.get();
  const missing = [];
  for (const media of cfg.media || []) {
    if (media.path && !fs.existsSync(media.path)) missing.push({ type: 'media', id: media.id, name: media.name });
  }
  const font = cfg.chatDesign?.customFontPath;
  if (font && !fs.existsSync(font)) missing.push({ type: 'font', name: path.basename(font) });
  const chatBackground = cfg.appearance?.chatBackground;
  if (chatBackground?.mode === 'custom') {
    const validation = validateChatBackgroundFile(chatBackground.customPath);
    if (!validation.ok) missing.push({ type:'chat-background', name:chatBackground.customName || 'Chatfenster-Bild', error:validation.error });
  }
  const localIcon = cfg.appearance?.chatIcons?.local;
  if (localIcon?.mode === 'custom') {
    const asset = localChatIconAsset(cfg);
    if (asset.missing) missing.push({ type:'local-chat-icon', name:localIcon.customName || 'Lokaler Chat / Overlay', error:asset.error });
  }
  return { missing: missing.length, invalid: 0, items: missing.slice(0, 100) };
}

async function sendDiscord(text) {
  const url = secretsService.get(SECRET_REFS.discord);
  if (!url) throw new Error('Kein Discord Webhook gespeichert.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: String(text || 'CRAZY_BATTO') }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
    return { ok: true };
  } finally { clearTimeout(timer); }
}

async function safeHttpAction(action = {}) {
  const url = new URL(String(action.url || ''));
  const cfg = configStore.get();
  const allowed = new Set(['127.0.0.1', 'localhost', '::1', ...((cfg.rules?.httpAllowlist || []).map(String))]);
  if (!allowed.has(url.hostname)) throw new Error(`HTTP-Ziel ${url.hostname} ist nicht in der Allowlist.`);
  const method = String(action.method || 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('HTTP-Methode ist nicht erlaubt.');
  const controller = new AbortController();
  const timeoutMs = Math.max(500, Math.min(15000, Number(action.timeoutMs || 5000)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: action.body ? { 'content-type': 'application/json' } : undefined,
      body: action.body && method !== 'GET' ? String(action.body) : undefined,
      signal: controller.signal
    });
    return { ok: response.ok, status: response.status };
  } finally { clearTimeout(timer); }
}

async function sendOutbound(platform, text, { source = 'manual' } = {}) {
  const target = String(platform || 'local').toLowerCase();
  const message = String(text || '').trim();
  if (!message) throw new Error('Nachricht ist leer.');
  if (target === 'tiktok') return tiktokWriter.send(message, { source });

  if(target==='twitch')return adapters.twitch.sendChat(message,{source});
  if (target === 'youtube') {
    const done = broadcastEchoes.begin(target);
    try { return await platformWriter.send(target, message, { source }); }
    finally { done(); }
  }

  if (target === 'local') {
    const accepted=eventCore.ingestChat({ id:crypto.randomUUID(), platform: 'internal', username: configStore.get().general.displayName, text: message }, `local-${source}`);
    if(!accepted.ok)throw new Error(accepted.error||'Lokale Chat-Ausgabe wurde nicht angenommen.');
    return { ok: true, mode: 'local' };
  }

  if (target === 'cng') {
    const cfg = configStore.get();
    if (cfg.platforms.cng?.localBroadcastEnabled !== false && cfg.autoBroadcast?.localCngOverlay !== false) {
      const accepted=eventCore.ingestChat({ id:crypto.randomUUID(), platform: 'cng', username: cfg.general.displayName, displayName: cfg.general.displayName, text: message }, `cng-local-${source}`);
      if(!accepted.ok)throw new Error(accepted.error||'CNG-Overlay-Ausgabe wurde nicht angenommen.');
      bridgeLog('info', 'CNG', 'LOCAL_OVERLAY_ONLY', { message: 'CNG Nachricht im lokalen Overlay ausgegeben; kein Plattform-Post simuliert.' });
      return { ok: true, mode: 'cng-local-overlay' };
    }
    throw new Error('CNG Schreiben ist nicht über eine dokumentierte Plattform-Schnittstelle verbunden.');
  }

  const adapter = connectorManager.get(target);
  if (adapter && typeof adapter.sendChat === 'function') {
    await adapter.sendChat(message);
    return { ok: true, mode: target };
  }
  throw new Error(`Senden an ${target} ist ohne autorisierte Schreib-Verbindung deaktiviert.`);
}

function stripTtsText(text, cfg) {
  let value = String(text || '');
  if (cfg?.stripUrls) value = value.replace(/https?:\/\/\S+/gi, ' Link ');
  return value.replace(/\s+/g, ' ').trim();
}

function handleNormalizedEvent(event) {
  chatExtras?.observe(event);
  event=community?.enrichChat?.(event)||event;
  community?.onEvent(event);
  auditStore?.writeEvent(event);
  if (event.type === 'chat') {
    const accepted = chatCore.ingest(normalizedToChat(event));
    if (!accepted) return;
    welcomeService?.handle(event).catch(error => bridgeLog('warn','Begrüßung','WELCOME_FAILED',{message:error.message}));
    const source=String(event.meta?.sourceConnector || '');
    if (!/automation|broadcast|mock|fake|test|local/i.test(source)) broadcastService?.noteChat(event.platform);
    actionEngine.handleMessage(event).catch((error) => bridgeLog('warn', 'Rules', 'COMMAND_FAILED', { message: error.message }));
    const tts = configStore.get().tts || {};
    if (tts.enabled && tts.readChat && (tts.platforms || []).includes(event.platform)) {
      const text = stripTtsText(`${event.user?.displayName || event.user?.username}: ${event.message?.text || ''}`, tts);
      if (text) send('tts:speak', { text, voice: tts.voice, rate: tts.rate, pitch: tts.pitch, volume: tts.volume, outputDeviceId: tts.outputDeviceId });
    }
    return;
  }

  welcomeService?.handle(event).catch(error => bridgeLog('warn','Begrüßung','WELCOME_FAILED',{message:error.message}));
  overlayServer.emitEvent(event);
  send('platform:event', normalizedToUiEvent(event));
  require('../src/suite-bootstrap.cjs').onEvent(event);
  actionEngine.handleEvent(event).catch((error) => bridgeLog('warn', 'Rules', 'EVENT_RULE_FAILED', { message: error.message }));
}

function restartAutoBroadcast() {
  clearTimeout(autoBroadcastDelayTimer);clearInterval(autoBroadcastTimer);
  autoBroadcastDelayTimer=null;autoBroadcastTimer=null;
  broadcastService?.start();
}

function registerBroadcastIpc() {
  const wrap=fn=>async(_event,payload)=>{try{return await fn(payload);}catch(e){return{ok:false,error:e.message};}};
  ipcMain.handle('broadcast:status',()=>broadcastService.status());
  ipcMain.handle('broadcast:upsert',wrap(x=>broadcastService.upsert(x)));
  ipcMain.handle('broadcast:delete',wrap(x=>broadcastService.remove(x)));
  ipcMain.handle('broadcast:duplicate',wrap(x=>broadcastService.duplicate(x)));
  ipcMain.handle('broadcast:master',wrap(x=>broadcastService.master(x)));
  ipcMain.handle('broadcast:testItem',wrap(x=>broadcastService.test(x)));
}

function powershell(script) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Diese TTS-Funktion ist für Windows vorgesehen.'));
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    child.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `PowerShell Code ${code}`)));
  });
}

function psString(value) { return String(value || '').replace(/'/g, "''"); }

async function listTtsVoices() {
  const local = { name:PIPER_VOICE_ID, label:PIPER_VOICE_NAME, culture:'de-DE', available:piperTts.status().available };
  if (process.platform !== 'win32') return [local];
  const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v=$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Select-Object Name,@{n='Culture';e={$_.Culture.Name}},Gender,Age; $s.Dispose(); $v | ConvertTo-Json -Compress`;
  try {
    const raw = await powershell(script);
    const parsed = raw ? JSON.parse(raw) : [];
    return [local, ...(Array.isArray(parsed) ? parsed : [parsed]).map((voice) => ({ name: voice.Name, culture: voice.Culture, gender: String(voice.Gender || ''), age: String(voice.Age || '') }))];
  } catch { return [local]; }
}

async function synthesizeTts(payload = {}) {
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('TTS-Text ist leer.');
  const cfg = configStore.get().tts || {};
  const voice = String(payload.voice ?? cfg.voice ?? '');
  const rate = Number(payload.rate ?? cfg.rate ?? 1);
  if (voice === PIPER_VOICE_ID) {
    const wav = await piperTts.synthesize(text, { rate });
    return { ok:true, path:wav.filePath, url:pathToFileURL(wav.filePath).href, voice, durationMs:wav.durationMs, outputDeviceId:payload.outputDeviceId || cfg.outputDeviceId || 'default' };
  }
  if (voice.startsWith('piper:')) throw new Error('Diese lokale Piper-Stimme ist nicht installiert.');
  const sapiRate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 5)));
  const file = path.join(configStore.ttsDir, `tts-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.wav`);
  const script = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voice ? `$s.SelectVoice('${psString(voice)}');` : ''} $s.Rate=${sapiRate}; $s.Volume=100; $s.SetOutputToWaveFile('${psString(file)}'); $s.Speak('${psString(text)}'); $s.Dispose();`;
  await powershell(script);
  return { ok: true, path: file, url: pathToFileURL(file).href, outputDeviceId: payload.outputDeviceId || cfg.outputDeviceId || 'default' };
}

function setChatDetached(open) {
  if(open){
    if(!detachedWindow||detachedWindow.isDestroyed()){
      const window=createWindow(true);detachedWindow=window;
      window.on('closed',()=>{if(detachedWindow===window)detachedWindow=null;if(!gamingMode)configStore.merge({windows:{detachedOpen:false}});navigation?.broadcast();});
    } else detachedWindow.focus();
    configStore.merge({windows:{detachedOpen:true}});
  } else {const window=detachedWindow;detachedWindow=null;window?.close();configStore.merge({windows:{detachedOpen:false}});}
  navigation?.broadcast();
}
function currentConfig() { return configStore.get(); }

function chatBackgroundAsset(cfg = currentConfig()) {
  const selected = cfg.appearance?.chatBackground || {};
  if (selected.mode === 'custom') {
    const validation = validateChatBackgroundFile(selected.customPath);
    if (validation.ok) return { mode:'custom', url:pathToFileURL(validation.path).href, name:selected.customName || path.basename(validation.path), missing:false };
    return { mode:'preset', url:CHAT_BACKGROUND_PRESET_URL, name:'Crazy_Batto Social-Media-Motiv', missing:true, error:validation.error };
  }
  return { mode:'preset', url:CHAT_BACKGROUND_PRESET_URL, name:'Crazy_Batto Social-Media-Motiv', missing:false };
}

function configuredLocalChatIcon(cfg = currentConfig()) {
  const selected = cfg.appearance?.chatIcons?.local || {};
  if (selected.mode !== 'custom') return { ok:false, default:true };
  if (!isPathInside(selected.customPath, configStore.imageDir)) return { ok:false, error:'Das lokale Chat-Icon liegt nicht im geschützten App-Bildordner.' };
  const validation = validateLocalChatIconSource(selected.customPath);
  if (!validation.ok) return validation;
  if (validation.ext !== '.png') return { ok:false, error:'Das gespeicherte lokale Chat-Icon ist kein PNG.' };
  const decoded = nativeImage.createFromPath(validation.path);
  const size = decoded.getSize();
  if (decoded.isEmpty() || size.width !== LOCAL_CHAT_ICON_SIZE || size.height !== LOCAL_CHAT_ICON_SIZE) return { ok:false, error:`Das lokale Chat-Icon muss ${LOCAL_CHAT_ICON_SIZE} × ${LOCAL_CHAT_ICON_SIZE} Pixel groß sein.` };
  return { ...validation, width:size.width, height:size.height };
}

function localChatIconAsset(cfg = currentConfig()) {
  const selected = cfg.appearance?.chatIcons?.local || {};
  if (selected.mode === 'custom') {
    const validation = configuredLocalChatIcon(cfg);
    if (validation.ok) return { mode:'custom', url:pathToFileURL(validation.path).href, overlayUrl:'/assets/custom/local-chat-icon.png', name:selected.customName || path.basename(validation.path), width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, missing:false };
    return { mode:'default', url:'', overlayUrl:'', name:'Standardpunkt', width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, missing:true, error:validation.error };
  }
  return { mode:'default', url:'', overlayUrl:'', name:'Standardpunkt', width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, missing:false };
}

function normalizeLocalChatIcon(sourcePath) {
  const decoded = nativeImage.createFromPath(sourcePath);
  const sourceSize = decoded.getSize();
  if (decoded.isEmpty() || sourceSize.width < 1 || sourceSize.height < 1) throw new Error('Das ausgewählte Icon konnte nicht gelesen werden.');
  if (sourceSize.width > 12000 || sourceSize.height > 12000) throw new Error('Das Ausgangsbild darf höchstens 12000 × 12000 Pixel groß sein.');
  const side = Math.min(sourceSize.width, sourceSize.height);
  const square = decoded.crop({ x:Math.floor((sourceSize.width-side)/2), y:Math.floor((sourceSize.height-side)/2), width:side, height:side });
  const normalized = square.resize({ width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE, quality:'best' });
  const outputSize = normalized.getSize();
  const bytes = normalized.toPNG();
  if (normalized.isEmpty() || outputSize.width !== LOCAL_CHAT_ICON_SIZE || outputSize.height !== LOCAL_CHAT_ICON_SIZE || !bytes.length) throw new Error('Das Icon konnte nicht auf 128 × 128 Pixel aufbereitet werden.');
  return { bytes, sourceWidth:sourceSize.width, sourceHeight:sourceSize.height };
}

function removeManagedImage(filePath) {
  try {
    if (isPathInside(filePath, configStore.imageDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function applyConfig(next, patch = {}) {
  if (ttsEnabled && !next.tts.enabled) { piperTts?.stop(); send('tts:cancel'); }
  ttsEnabled = next.tts.enabled===true;
  if (patch.battleBar) tiktokMatch?.updateConfig(next.battleBar);
  if(patch.navigation)navigation?.configure(next.navigation).catch(error=>bridgeLog('error','Stream Deck','NAVIGATION_RECONFIGURE_FAILED',{message:error.message}));
  navigation?.broadcast();
  community?.applyConfig(next,patch)?.catch(error=>bridgeLog('warn','Community','CONFIG_APPLY_FAILED',{message:error.message}));
  chatCore.setConfig(next);
  if(patch.hotkeys)inputHotkeys?.configure(next.hotkeys);
  if(patch.streamerbot){streamerbot?.disconnect();if(next.streamerbot.autoConnect)setTimeout(()=>streamerbot.connect().catch(()=>{}),250);}
  for (const name of ['tikfinity', 'twitch', 'youtube']) {
    const pcfg = next.platforms?.[name];
    if (!pcfg) continue;
    connectorManager.configure(name, { enabled: pcfg.enabled !== false });
    const adapter = connectorManager.get(name);
    if (patch.platforms?.[name] && typeof adapter?.updateConfig === 'function') {
      adapter.updateConfig(name === 'youtube' ? { ...pcfg, apiKey: secretsService.get(SECRET_REFS.youtube) } : pcfg);
    }
  }
  if (patch.obs) obs.updateConfig({ ...next.obs, password: secretsService.get(SECRET_REFS.obs) });
  if (patch.mediaEngine) ffmpeg.updateConfig({ ffmpegPath: next.mediaEngine.ffmpegPath });
  if (patch.autoBroadcast) restartAutoBroadcast();
  send('config:changed', next);
  if(patch.autoBroadcast)send('chat:history',chatCore.getMultiChatMessages());
  overlayServer.broadcast({type:'config',sections:Object.keys(patch)});
}

function diagnosticsSnapshot() {
  const cfg = currentConfig();
  return redact({
    generatedAt: new Date().toISOString(),
    app: { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: process.platform, arch: process.arch },
    paths: { userData: configStore.dir, logs: configStore.logDir, data: configStore.dataDir, assets: configStore.assetsDir },
    settings: { validation: validateConfig(cfg), dirty: settingsService.isDirty(), schemaVersion: cfg.schemaVersion, version: cfg.version },
    obs: obs.getStatus(), overlay: overlayServer.getStatus(), connectors: connectorManager.statuses(), eventCore: eventCore.getMetrics(),
    ffmpeg: ffmpeg.getStatus(), database: auditStore.getStatus(), assets: assetStatus(), health: healthService?.getStatus(),
    logs: chatCore.getLogs().slice(-100)
  });
}

function saveCommunityConfig(patch) {
  const next = configStore.merge(patch);
  settingsService.syncIfClean();
  applyConfig(next, patch);
  return next;
}

function initCore() {
  const userDataPath = app.getPath('userData');
  configStore = new ConfigStore(userDataPath);
  const piperRoot = app.isPackaged ? path.join(process.resourcesPath, 'piper') : path.join(__dirname, '..', 'vendor', 'piper');
  piperTts = new PiperTtsService({ runtimeDir:path.join(piperRoot, 'runtime'), modelPath:path.join(piperRoot, 'voices', 'de_DE-thorsten-medium.onnx'), outputDir:configStore.ttsDir });
  settingsService = new SettingsService({ configStore });
  secretsService = new SecretsService({ userDataPath, safeStorage });
  tiktokMatch = new TikTokMatchService({ getApiKey:()=>secretsService.get('eulerstream-api-key') });
  tiktokMatch.on('change', state=>send('battle:state', state));
  welcomeService = new WelcomeService({getConfig:()=>configStore.get(),send:sendOutbound,onError:(platform,message)=>bridgeLog('warn','Begrüßung','WELCOME_FAILED',{platform,message})});
  tiktokWriter = new TikTokWriter({ getConfig: () => configStore.get(), getStreamerBot:()=>streamerbot });
  platformWriter = new PlatformWriter({
    getConfig: () => configStore.get(),
    getToken: platform => platform==='twitch' ? twitchLogin.token() : secretsService.get(`${platform}-write-token`),
    onSent: message => broadcastEchoes.remember(message)
  });
  twitchLogin = new TwitchLogin({secrets:secretsService,validate:token=>platformWriter.validateTwitch(token)});
  migrateLegacySecrets(userDataPath);
  const cfg = currentConfig();
  logger = new Logger({ dir: configStore.logDir, level: cfg.logging.level, retentionDays: cfg.logging.retentionDays, maxFileBytes: cfg.logging.maxFileBytes });
  ttsEnabled = cfg.tts.enabled===true;
  logger.cleanup();
  broadcastEchoes = new BroadcastEchoTracker({
    file: path.join(secretsService.dir, 'broadcast-echoes.json'),
    onStorageError: message => bridgeLog('warn', 'Auto-Broadcast', 'ECHO_STORAGE_FAILED', { message })
  });
  chatCore = new ChatCore(cfg);
  eventCore = new EventCore({ ...cfg.eventCore, onLog: bridgeLog });
  overlayServer = new OverlayServer({ host: cfg.http.host, port: cfg.http.port, chatCore, configStore, getBattleState:()=>tiktokMatch.getState() });
  obs = new OBSController({ ...cfg.obs, password: secretsService.get(SECRET_REFS.obs), onStatus: status => {
    send('obs:status',status);
    if(status.connected && typeof status.outputActive==='boolean' && status.outputActive!==obsWasLive){obsWasLive=status.outputActive;eventCore.ingestEvent({platform:'internal',type:obsWasLive?'stream_start':'stream_end',id:'obs-stream-'+Date.now(),data:{username:currentConfig().general.displayName}},'obs');}
  } });
  auditStore = new AuditStore({ dataDir: configStore.dataDir, onStatus: (status) => send('database:status', status), onLog: bridgeLog });
  community=createCommunityServices({dataDir:configStore.dataDir,getConfig:currentConfig,saveConfig:saveCommunityConfig,secrets:secretsService,send,dialog,shell,getParent:()=>mainWindow});
  chatExtras=createChatExtrasService({getConfig:currentConfig,saveConfig:saveCommunityConfig,send:(channel,payload)=>{send(channel,payload);if(channel==='chat-widgets:trigger')overlayServer?.broadcast({type:channel,data:require('../src/core/wishlist-overlay.cjs').overlayWidgetTrigger(payload)});},dialog,shell,BrowserWindow,getParent:()=>mainWindow,assetsDir:path.join(__dirname,'..','src','assets'),allowCatalogFetch:!process.argv.some(x=>x.startsWith('--batto-qa')),giftRegistry:new GiftRegistry({dataDir:configStore.dataDir,bundledFile:path.join(__dirname,'..','src','assets','gift-catalog.json')})});
  ffmpeg = new FFmpegService({ ffmpegPath: cfg.mediaEngine.ffmpegPath, onStatus: (status) => send('ffmpeg:status', status), onLog: bridgeLog });
  connectorManager = new ConnectorManager({ connectTimeoutMs: 12000, onLog: bridgeLog });

  const callbacks = (name) => ({
    onMessage: (message) => {
      connectorManager.markEvent(name);
      broadcastEchoes.ingest(message, tiktokWriter.sourceFor(message, name), (input, source) => eventCore.ingestChat(input, source))
        .catch(() => bridgeLog('warn', name, 'CHAT_INGEST_FAILED', { message: 'Chatnachricht konnte nicht verarbeitet werden.' }));
    },
    onEvent: (event) => { connectorManager.markEvent(name);if(name==='tikfinity'){community?.onTikFinityEvent(event);tiktokMatch.ingest(event,{source:'tikfinity'});}if(name==='tikfinity'&&currentConfig().streamerbot.tiktokEvents==='bridge')return;
      if(name==='tikfinity'){const d=event.data||{};if(event.event==='gift'&&(d.repeatEnd===false||(Number(d.giftType)===1&&d.repeatEnd!==true)))return;event={...event,data:{...d,unit:event.event==='gift'?'coins':'count',value:d.coins??d.value??d.diamondCount,count:d.likeCount??d.count??d.repeatCount??1,skipAggregation:true}};}
      eventCore.ingestEvent(event, name); },
    onStatus: (status) => { connectorManager.observeAdapterStatus(name, status); if(name==='tikfinity')tiktokMatch.setConnection(status,'tikfinity'); }
  });

  adapters = {
    tikfinity: new TikFinityAdapter({ ...cfg.platforms.tikfinity, ...callbacks('tikfinity') }),
    twitch: new TwitchPopout({getConfig:()=>currentConfig().platforms.twitch,getParent:()=>mainWindow,onStatus:callbacks('twitch').onStatus,onMessage:(message,source)=>{connectorManager.markEvent('twitch');eventCore.ingestChat(message,source);}}),
    youtube: new YouTubeAdapter({ liveChatId: cfg.platforms.youtube.liveChatId, apiKey: secretsService.get(SECRET_REFS.youtube), pollMs: cfg.platforms.youtube.pollMs, ...callbacks('youtube') }),
    mock: new MockAdapter({ onMessage: (message) => eventCore.ingestChat(message, 'mock'), onStatus: (status) => send('adapter:status', status) })
  };

  for (const name of ['tikfinity','twitch','youtube']) {
    connectorManager.register(name, adapters[name], { enabled: cfg.platforms[name]?.enabled !== false, autoReconnect: false });
  }
  connectorManager.on('state', (status) => { auditStore?.writeConnectorState(status); send('adapter:status', status); });

  audioOutput = new AudioOutputService({ getConfig: currentConfig,
    getPlayers: () => audioPlayer.players(),
    ensurePlayer:()=>audioPlayer.ensure(),onIdle:()=>audioPlayer.idle(),
    overlay: overlayServer,
    onWarning: message => bridgeLog('warn', 'Tonausgabe', 'AUDIO_DEVICE_FALLBACK', { message })
  });
  actionEngine = new ActionEngine({
    getConfig: currentConfig,
    isLive:()=>{const d=require('../src/dual-stream/bootstrap.cjs').getService();return Boolean(d?.live()||d?.companionLive);},
    sendChat: (platform, text) => sendOutbound(platform, text, { source: 'automation' }),
    onTts: (payload) => send('tts:speak', payload),
    onOverlay: (event,options) => {const d=require('../src/dual-stream/bootstrap.cjs').getService();if(d?.state.prepared&&event.type==='media'){const media=currentConfig().media.find(m=>m.id===event.data?.mediaId);if(!media)throw Error('Medium fehlt.');return d.media(media.path,{...event.data,...options});}if(d?.state.prepared&&event.type!=='media'){d.eventText=String(event.data?.text||'').slice(0,200);d.scheduleOverlay();clearTimeout(d.eventTimer);d.eventTimer=setTimeout(()=>{d.eventText='';d.scheduleOverlay();},10000);d.eventTimer.unref();return {ok:true};}return audioOutput.run(event,options);},
    onChatWidget:payload=>chatExtras.trigger(payload),
    onDiscord: sendDiscord,
    onHttp: safeHttpAction,
    onAudit: (entry) => auditStore?.writeRuleRun(entry),
    onLog: bridgeLog
  });

  supportEvents=new SupportEvents({getProvider:()=>currentConfig().streamerbot.tipProvider,onEvent:(event,source)=>eventCore.ingestEvent(event,source),onLog:message=>bridgeLog('warn','Support-Events','EVENT_IGNORED',{message})});
  streamerbot=new StreamerBotAdapter({getConfig:()=>currentConfig().streamerbot,getPassword:()=>secretsService.get('streamerbot-password'),onStatus:status=>send('streamerbot:status',status),onEvent:event=>{if(event.bridge&&event.platform==='tiktok'&&currentConfig().streamerbot.tiktokEvents!=='bridge')return;supportEvents.ingest(event);}});
  chainService=new ChainService({getConfig:currentConfig,engine:actionEngine,onStatus:status=>send('chains:status',status)});
  actionEngine.runChain=(id,ctx)=>chainService.trigger(id,ctx);
  actionEngine.onStreamerBot=(id,ctx,signal,timeout,options)=>streamerbot.execute(id,ctx,signal,timeout,options);
  actionEngine.onObs=(request,data)=>require('../src/dual-stream/bootstrap.cjs').getService().obs(request,data);
  const cancelLegacy=actionEngine.cancelAll.bind(actionEngine);
  actionEngine.cancelAll=()=>{chainService.cancelAll();return cancelLegacy();};
  inputHotkeys=new InputHotkeys({backend:new PhysicalInputBackend({appPid:process.pid,onError:message=>bridgeLog('warn','Hotkeys','INPUT_HOOK_FAILED',{message})}),register:(key,fn)=>globalShortcut.register(key,fn),unregister:key=>globalShortcut.unregister(key),trigger:(id,ctx)=>chainService.trigger(id,ctx),stop:()=>actionEngine.cancelAll(),onStatus:status=>send('hotkeys:status',status)});

  broadcastService = new BroadcastService({store:configStore,send:sendOutbound,
    onActions:(item,context)=>chainService.trigger(item.chainId,{source:context.source,message:context.text,text:context.text,platform:'internal',user:'Auto-Broadcast'}, {signal:context.signal}),
    onSound: (item, context) => audioOutput.playSound(item, context),
    isLive:()=>{const d=require('../src/dual-stream/bootstrap.cjs').getService();return Boolean(d?.live()||d?.companionLive);},
    onStatus:status=>send('broadcast:status',status),
    onConfig:next=>{settingsService.syncIfClean();applyConfig(next,{autoBroadcast:next.autoBroadcast});}
  });
  chatCore.on('message', (message) => {
    require('../src/suite-bootstrap.cjs').onChat([require('../src/services/suite-host.cjs').chatForJarvis(message)]);
    if (chatCore.isMultiChatVisible(message)) send('chat:message', message);
  });
  chatCore.on('moderation', (entry) => { auditStore?.writeModeration(entry); send('moderation:event', entry); });
  chatCore.on('filter-hit', (entry) => send('filter:hit', entry));
  chatCore.on('log', (entry) => {
    const diagnostic=diagnosticEntry(entry);
    logger.write(diagnostic.level,diagnostic.category,diagnostic.code,diagnostic.message,diagnostic.context);
    send('log:event', entry);
  });
  chatCore.on('config-dirty', (config) => {
    try { configStore.merge({ moderation: config.moderation, filters: config.filters }); } catch {}
  });
  eventCore.on('event', handleNormalizedEvent);

  statusMonitor = new StatusMonitor({ obs, onStatus: (status) => send('system:status', status) });
  healthService = new HealthService({
    getObs: () => obs.getStatus(), getOverlay: () => overlayServer.getStatus(), getConnectors: () => connectorManager.statuses(),
    getEventCore: () => eventCore.getMetrics(), getFfmpeg: () => ffmpeg.getStatus(), getSettings: () => validateConfig(currentConfig()),
    getDatabase: () => auditStore.getStatus(), getAssets: assetStatus, onUpdate: (status) => send('health:status', status)
  });
}

async function startExternalServices() {
  const cfg = currentConfig();
  tiktokMatch.updateConfig(cfg.battleBar);
  auditStore.open();
  await community.start();
  inputHotkeys.configure(cfg.hotkeys);
  let navigationToken=secretsService.get('navigation-token');if(!navigationToken){navigationToken=crypto.randomBytes(32).toString('hex');secretsService.set('navigation-token',navigationToken);}
  const deckControls=require('../src/core/deck-controls.cjs').createDeckControls({getConfig:currentConfig,saveConfig:async patch=>{const next=saveCommunityConfig(patch);if(patch.community)await community.applyConfig(next,patch);},isDetached:()=>!!detachedWindow&&!detachedWindow.isDestroyed(),setDetached:setChatDetached});
  navigation=new NavigationService({controls:deckControls,...require('../src/core/deck-tests.cjs').createDeckTests({getConfig:currentConfig,chains:chainService,engine:actionEngine,broadcast:broadcastService,widgetTest:payload=>chatExtras.trigger(payload),battleTest:()=>{send('battle:preview',{durationMs:8000});return {ok:true,message:'Match-Anzeige für 8 Sekunden eingeblendet.'};}}),token:navigationToken,navigate:async(view,focus)=>{if(!mainWindow||mainWindow.isDestroyed())await showMainWindow();require('../src/core/navigation-service.cjs').showNavigationWindow(mainWindow,focus&&currentConfig().navigation.focus!==false);return mainWindow.webContents.executeJavaScript('setView('+JSON.stringify(view)+'); S.view');},onError:message=>bridgeLog('error','Stream Deck','NAVIGATION_SERVER',{message})});
  navigation.configure(cfg.navigation).catch(error=>bridgeLog('error','Stream Deck','NAVIGATION_START_FAILED',{message:error.message}));

  if(cfg.streamerbot.autoConnect)streamerbot.connect().catch(()=>{});
  if (cfg.http.enabled && cfg.http.autoStart !== false) overlayServer.start().catch((error) => bridgeLog('error', 'Overlay', error.code || 'START_FAILED', { message: error.message }));
  statusMonitor.start();
  healthService.start();
  restartAutoBroadcast();

  ffmpeg.detect().then(async (result) => {
    if (!result.ok) return;
    try { await ffmpeg.chooseEncoder(cfg.mediaEngine.encoder || 'auto'); }
    catch (error) { bridgeLog('warn', 'FFmpeg', 'ENCODER_SELECTION_FAILED', { message: error.message }); }
  }).catch((error) => bridgeLog('warn', 'FFmpeg', 'DETECT_FAILED', { message: error.message }));

  for (const name of ['tikfinity','twitch','youtube']) {
    if (cfg.platforms[name]?.autoConnect) connectorManager.connect(name).catch(() => {});
  }
  // The suite uses its own sender. Preserve imported OBS settings for manual use.
  if (app.getName() !== 'Batto 3-in-1' && cfg.obs.autoConnect) obs.connect().catch(() => {});
}

function registerIpc() {
  community.registerIpc(ipcMain);
  chatExtras.registerIpc(ipcMain);
  ipcMain.on('audio:ready', event => {audioOutput.registerPlayer(event.sender);audioPlayer.ready(event.sender);});
  ipcMain.on('audio:result', (event, result) => audioOutput.acknowledge(event.sender, result));
  ipcMain.handle('audio:testOutput', async (_event, output) => {
    try { return await audioOutput.test(output); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  registerBroadcastIpc();
  const result=fn=>async(_event,...args)=>{try{return {ok:true,result:await fn(...args)};}catch(e){return {ok:false,error:e.message};}};
  ipcMain.handle('streamerbot:connect',result(()=>streamerbot.connect()));
  ipcMain.handle('streamerbot:disconnect',()=>{streamerbot.disconnect();return {ok:true};});
  ipcMain.handle('streamerbot:status',()=>streamerbot.status());
  ipcMain.handle('streamerbot:actions',result(()=>streamerbot.loadActions()));
  ipcMain.handle('streamerbot:password',(_event,password)=>{secretsService.set('streamerbot-password',String(password||''));return {ok:true};});
  ipcMain.handle('chains:trigger',result((id)=>chainService.trigger(id,{source:'manual',platform:'internal',user:'Batto Test',message:'Test'})));
  ipcMain.handle('chains:status',()=>chainService.status());
  ipcMain.handle('events:custom',(_event,payload={})=>{const name=String(payload.name||'').trim();if(!name||name.length>100)return {ok:false,error:'Kurzer Ereignisname erforderlich.'};const parameters=payload.parameters;if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||JSON.stringify(parameters).length>8000)return {ok:false,error:'Parameter müssen ein kleines JSON-Objekt sein.'};return eventCore.ingestEvent({platform:'internal',type:'custom',id:crypto.randomUUID(),data:{text:name,parameters,username:'Batto Test'}},'manual-custom-test');});

  ipcMain.handle('hotkeys:status',()=>inputHotkeys.states);
  ipcMain.handle('hotkeys:capture',async()=>{try{return await inputHotkeys.capture();}catch(e){return{ok:false,error:e.message};}});
  ipcMain.handle('hotkeys:cancel-capture',()=>inputHotkeys.cancelCapture());
  ipcMain.on('navigation:state',(event,view)=>{if(event.sender===mainWindow?.webContents)navigation?.publish(view);});
  ipcMain.handle('navigation:copy',async()=>{await navigation.configure(currentConfig().navigation);const port=navigation.connectionPort();if(!port)throw new Error('Die Stream-Deck-Verbindung ist deaktiviert.');clipboard.writeText(JSON.stringify({url:'ws://127.0.0.1:'+port,token:secretsService.get('navigation-token')}));return {ok:true};});


  ipcMain.handle('state:get', () => ({
    appVersion:app.getVersion(),
    community:community.snapshot(),
    config: currentConfig(), messages: chatCore.getMultiChatMessages(), logs: chatCore.getLogs(), moderation: chatCore.getModerationState(),
    moderationHistory: chatCore.getModerationHistory(), overlay: overlayServer.getStatus(), adapters: connectorManager.statuses(), obs: obs.getStatus(),
    eventCore: eventCore.getMetrics(), ffmpeg: ffmpeg.getStatus(), database: auditStore.getStatus(), health: healthService.getStatus(),
    settings: { dirty: settingsService.isDirty(), validation: validateConfig(settingsService.getDraft()) },
    assets: { chatBackground:chatBackgroundAsset(), localChatIcon:localChatIconAsset() },
    secrets: { obsPassword: secretsService.has(SECRET_REFS.obs), youtubeApiKey: secretsService.has(SECRET_REFS.youtube), discordWebhook: secretsService.has(SECRET_REFS.discord), cngObsChatUrl: secretsService.has(SECRET_REFS.cng), twitchWriteToken: secretsService.has('twitch-write-token') || secretsService.has('twitch-device-session'), youtubeWriteToken: secretsService.has('youtube-write-token') }
  }));

  ipcMain.handle('config:save', async (_event, patch = {}) => {
    const applied = settingsService.savePatch(patch);
    if (!applied.ok) throw new Error(applied.error || applied.validation?.errors?.map((x) => `${x.path}: ${x.message}`).join(' | ') || 'Einstellungen konnten nicht gespeichert werden.');
    const next = applied.config;
    applyConfig(next, patch);
    if (patch.http) {
      if (next.http.enabled) await overlayServer.restart(next.http.host, next.http.port);
      else await overlayServer.stop();
    }
    return next;
  });
  ipcMain.handle('config:reset', async (_event, section) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, section)) throw new Error('Unbekannter Bereich.');
    const applied = settingsService.savePatch({ [section]: structuredClone(DEFAULT_CONFIG[section]) });
    if (!applied.ok) throw new Error(applied.error || applied.validation?.errors?.map((x) => `${x.path}: ${x.message}`).join(' | ') || 'Zurücksetzen fehlgeschlagen.');
    applyConfig(applied.config, { [section]: applied.config[section] });
    if(section==='http'){const h=applied.config.http;if(h.enabled)await overlayServer.restart(h.host,h.port);else await overlayServer.stop();}
    return applied.config;
  });
  ipcMain.handle('settings:draft', (_event, patch) => settingsService.patch(patch || {}));
  ipcMain.handle('settings:apply', async () => {
    const result = settingsService.apply();
    if (result.ok) {
      applyConfig(result.config,result.config);
      const h=result.config.http,status=overlayServer.getStatus();
      if(!h.enabled)await overlayServer.stop();
      else if(!status.running||status.host!==h.host||status.port!==h.port)await overlayServer.restart(h.host,h.port);
    }
    return result;
  });
  ipcMain.handle('settings:discard', () => settingsService.discard());
  ipcMain.handle('settings:reset', (_event, section) => settingsService.resetSection(section));
  ipcMain.handle('settings:test', (_event, section) => settingsService.test(section));

  ipcMain.handle('adapter:connect', (_event, name) => connectorManager.connect(name));
  ipcMain.handle('adapter:disconnect', (_event, name) => connectorManager.disconnect(name));
  ipcMain.handle('adapter:health', (_event, name) => connectorManager.healthCheck(name));

  ipcMain.handle('chat:test', (_event, payload = {}) => { eventCore.ingestChat({ platform: payload.platform || 'internal', username: payload.username || 'Crazy_User', text: payload.text || 'Testnachricht' }, 'fake-connector'); return { ok: true }; });
  ipcMain.handle('chat:send', async (_event, payload = {}) => { try { return await sendOutbound(payload.platform, payload.text, { source: 'manual' }); } catch (error) { return { ok: false, error: error.message }; } });
  ipcMain.handle('moderation:act', async (_event,payload) => {try{return await community.perform(payload);}catch(e){return{ok:false,error:e.message};}});
  ipcMain.handle('filter:add', (_event, payload) => { const result = chatCore.addFilter(payload); if (result.ok) configStore.merge({ filters: chatCore.config.filters }); return result; });
  ipcMain.handle('filter:remove', (_event, id) => { const result = chatCore.removeFilter(id); if (result.ok) configStore.merge({ filters: chatCore.config.filters }); return result; });
  ipcMain.handle('chat:clear', () => { chatCore.clearMessages(); return { ok: true }; });
  ipcMain.handle('logs:clear', () => { chatCore.clearLogs(); return { ok: true }; });

  ipcMain.handle('obs:connect', async (_event, payload = {}) => {
    try {
      if (payload.password) secretsService.set(SECRET_REFS.obs, payload.password);
      const cfg = currentConfig();
      const url = payload.url || cfg.obs.url || 'ws://127.0.0.1:4455';
      const next = configStore.merge({ obs: { ...cfg.obs, url, autoConnect: Boolean(payload.autoConnect) } });
      settingsService.syncIfClean();
      obs.updateConfig({ ...next.obs, password: secretsService.get(SECRET_REFS.obs) });
      send('config:changed', next);
      return await obs.connect();
    } catch (error) { return { ok: false, error: error.message, status: obs.getStatus() }; }
  });
  ipcMain.handle('obs:disconnect', async () => { await obs.disconnect(); return { ok: true, status: obs.getStatus() }; });
  ipcMain.handle('obs:test', async () => { try { return await obs.testConnection(); } catch (error) { return { ok: false, error: error.message, status: obs.getStatus() }; } });

  ipcMain.handle('youtube:saveKey', (_event, key) => { secretsService.set(SECRET_REFS.youtube, key); adapters.youtube.updateConfig({ ...currentConfig().platforms.youtube, apiKey: secretsService.get(SECRET_REFS.youtube) }); return { ok: true, hasKey: Boolean(key) }; });
  ipcMain.handle('twitch:login', async () => {try{return {ok:true,...await twitchLogin.start(currentConfig().platforms.twitch.clientId)};}catch(error){return {ok:false,error:error.message};}});
  ipcMain.handle('twitch:loginStatus', () => twitchLogin.status());
  ipcMain.handle('twitch:openLogin', async () => {const state=twitchLogin.status();if(state.status==='pending')await shell.openExternal(state.url);return {ok:state.status==='pending'};});
  ipcMain.handle('twitch:cancelLogin', () => {twitchLogin.cancel();return {ok:true};});
  ipcMain.handle('platform:saveWriteToken', async (_event, payload = {}) => {
    try {
      const { platform } = payload;
      if (!['twitch', 'youtube'].includes(platform)) throw new Error('Ungültige Plattform.');
      const token = String(payload.token || '').trim();
      if (token && (!/^[a-zA-Z0-9._~+\/-]+={0,2}$/.test(token) || token.length > 4096)) throw new Error('Ungültiger Schreibzugang.');
      if (token && platform === 'twitch') await platformWriter.validateTwitch(token);
      if(platform==='twitch')twitchLogin.disconnect();
      secretsService.set(`${platform}-write-token`, token);
      return { ok: true, stored: Boolean(token) };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('platform:copyTikTokBridge', () => {
    clipboard.writeText(fs.readFileSync(path.join(__dirname, '../src/assets/Batto-TikTok-Broadcast.cs'), 'utf8'));
    return { ok: true };
  });
  ipcMain.handle('discord:saveWebhook', (_event, url) => { secretsService.set(SECRET_REFS.discord, url); return { ok: true, hasWebhook: Boolean(url) }; });
  ipcMain.handle('discord:test', async (_event, text) => { try { return await sendDiscord(text || 'CRAZY_BATTO Test'); } catch (error) { return { ok: false, error: error.message }; } });

  ipcMain.handle('cng:saveChatUrl', (_event, url) => {
    const value = String(url || '').trim();
    if (value && !/^https:\/\/cng-plattform\.com\//i.test(value)) return { ok: false, error: 'Die CNG Chat-URL muss von cng-plattform.com stammen.' };
    secretsService.set(SECRET_REFS.cng, value);
    return { ok: true, hasUrl: Boolean(value) };
  });
  ipcMain.handle('cng:clearChatUrl', () => { secretsService.delete(SECRET_REFS.cng); return { ok: true }; });
  ipcMain.handle('cng:copyUrl', (_event, kind) => {
    const cfg = currentConfig().platforms.cng || {};
    const value = kind === 'alert' ? cfg.alertOverlayUrl : kind === 'ghost' ? cfg.ghostChatUrl : secretsService.get(SECRET_REFS.cng);
    if (!value) return { ok: false, error: 'Keine URL gespeichert.' };
    clipboard.writeText(value); return { ok: true };
  });
  ipcMain.handle('cng:openUrl', async (_event, kind) => {
    const cfg = currentConfig().platforms.cng || {};
    const value = kind === 'alert' ? cfg.alertOverlayUrl : kind === 'ghost' ? cfg.ghostChatUrl : secretsService.get(SECRET_REFS.cng);
    if (!value) return { ok: false, error: 'Keine URL gespeichert.' };
    await shell.openExternal(value); return { ok: true };
  });

  ipcMain.handle('tts:listVoices', async () => { try { return { ok: true, voices: await listTtsVoices() }; } catch (error) { return { ok: false, error: error.message, voices: [] }; } });
  ipcMain.handle('battle:getState', () => ({ok:true,state:tiktokMatch.getState(),hasKey:secretsService.has('eulerstream-api-key')}));
  ipcMain.handle('battle:saveKey', (_event, value) => {
    try {
      if(typeof value!=='string'||value.length>4096||/[\r\n\0]/.test(value))throw new Error('Ungültiger Eulerstream-Schlüssel.');
      secretsService.set('eulerstream-api-key',value.trim());
      tiktokMatch.updateConfig(currentConfig().battleBar);
      return {ok:true,hasKey:secretsService.has('eulerstream-api-key')};
    } catch(error) { return {ok:false,error:error.message}; }
  });
  ipcMain.handle('battle:reconnect', () => {
    tiktokMatch.stop();
    tiktokMatch.updateConfig(currentConfig().battleBar);
    if(currentConfig().battleBar.provider==='tikfinity')tiktokMatch.setConnection(adapters.tikfinity.getStatus(),'tikfinity');
    return {ok:true,state:tiktokMatch.getState()};
  });
  ipcMain.handle('tts:synthesize', async (_event, payload) => { try { return await synthesizeTts(payload); } catch (error) { return { ok: false, error: error.message }; } });
  ipcMain.handle('tts:cleanup', (_event, filePath) => { try { const resolved = path.resolve(String(filePath || '')); if (resolved.startsWith(path.resolve(configStore.ttsDir)+path.sep) && fs.existsSync(resolved)) fs.unlinkSync(resolved); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });

  ipcMain.handle('dialog:chatBackground', async () => {
    const result = await dialog.showOpenDialog({ title:'Eigenes Chatfenster-Bild auswählen', properties:['openFile'], filters:[{ name:'Bilder', extensions:['png','jpg','jpeg','webp'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true };
    const validation = validateChatBackgroundFile(result.filePaths[0]);
    if (!validation.ok) return validation;
    const decoded = nativeImage.createFromPath(validation.path);
    const size = decoded.getSize();
    if (decoded.isEmpty() || size.width < 1 || size.height < 1) return { ok:false, error:'Das ausgewählte Bild konnte nicht gelesen werden.' };
    if (size.width > 12000 || size.height > 12000) return { ok:false, error:'Das Chatbild darf höchstens 12000 × 12000 Pixel groß sein.' };
    const destination = path.join(configStore.imageDir, `chat-background-${Date.now()}-${crypto.randomUUID().slice(0,8)}${validation.ext}`);
    try {
      fs.copyFileSync(validation.path, destination);
      const copied = validateChatBackgroundFile(destination);
      if (!copied.ok) throw new Error(copied.error);
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatBackground?.customPath;
      const next = configStore.merge({ appearance:{ chatBackground:{ ...(cfg.appearance?.chatBackground || {}), enabled:true, mode:'custom', customPath:destination, customName:path.basename(validation.path).slice(0,260) } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = chatBackgroundAsset(next);
      send('chat-background:changed', { config:next, asset });
      if (previousPath && previousPath !== destination) removeManagedImage(previousPath);
      return { ok:true, config:next, asset, width:size.width, height:size.height };
    } catch (error) {
      removeManagedImage(destination);
      return { ok:false, error:error.message };
    }
  });

  ipcMain.handle('chat-background:reset', () => {
    try {
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatBackground?.customPath;
      const next = configStore.merge({ appearance:{ chatBackground:{ ...(cfg.appearance?.chatBackground || {}), enabled:true, mode:'preset', customPath:'', customName:'' } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = chatBackgroundAsset(next);
      send('chat-background:changed', { config:next, asset });
      removeManagedImage(previousPath);
      return { ok:true, config:next, asset };
    } catch (error) { return { ok:false, error:error.message }; }
  });

  ipcMain.handle('dialog:localChatIcon', async () => {
    const result = await dialog.showOpenDialog({ title:'Icon für Lokaler Chat / Overlay auswählen', properties:['openFile'], filters:[{ name:'Bilder', extensions:['png','jpg','jpeg','webp'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true };
    const validation = validateLocalChatIconSource(result.filePaths[0]);
    if (!validation.ok) return validation;
    const destination = path.join(configStore.imageDir, `local-chat-icon-${Date.now()}-${crypto.randomUUID().slice(0,8)}.png`);
    try {
      const normalized = normalizeLocalChatIcon(validation.path);
      fs.writeFileSync(destination, normalized.bytes, { flag:'wx' });
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatIcons?.local?.customPath;
      const next = configStore.merge({ appearance:{ chatIcons:{ local:{ mode:'custom', customPath:destination, customName:path.basename(validation.path).slice(0,260) } } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = localChatIconAsset(next);
      if (asset.missing) throw new Error(asset.error || 'Das lokale Chat-Icon konnte nicht gespeichert werden.');
      send('local-chat-icon:changed', { config:next, asset });
      if (previousPath && previousPath !== destination) removeManagedImage(previousPath);
      return { ok:true, config:next, asset, sourceWidth:normalized.sourceWidth, sourceHeight:normalized.sourceHeight, width:LOCAL_CHAT_ICON_SIZE, height:LOCAL_CHAT_ICON_SIZE };
    } catch (error) {
      removeManagedImage(destination);
      return { ok:false, error:error.message };
    }
  });

  ipcMain.handle('local-chat-icon:reset', () => {
    try {
      const cfg = currentConfig();
      const previousPath = cfg.appearance?.chatIcons?.local?.customPath;
      const next = configStore.merge({ appearance:{ chatIcons:{ local:{ mode:'default', customPath:'', customName:'' } } } });
      settingsService.discard();
      applyConfig(next, { appearance:next.appearance });
      const asset = localChatIconAsset(next);
      send('local-chat-icon:changed', { config:next, asset });
      removeManagedImage(previousPath);
      return { ok:true, config:next, asset };
    } catch (error) { return { ok:false, error:error.message }; }
  });

  ipcMain.handle('dialog:font', async () => {
    const result = await dialog.showOpenDialog({ title: 'Eigene Schrift auswählen', properties: ['openFile'], filters: [{ name: 'Fonts', extensions: ['ttf','otf','woff','woff2'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const src = result.filePaths[0]; const ext = path.extname(src).toLowerCase(); const dest = path.join(configStore.fontDir, `custom${ext}`);
    fs.copyFileSync(src, dest); const next = configStore.merge({ chatDesign: { customFontPath: dest, fontFamily: 'BattoCustom' } }); settingsService.discard(); send('config:changed', next); return { ok: true, path: dest, config: next };
  });
  ipcMain.handle('dialog:media', async () => {
    const result = await dialog.showOpenDialog({ title: 'Medien hinzufügen', properties: ['openFile','multiSelections'], filters: [{ name: 'Medien', extensions: ['mp3','wav','ogg','mp4','webm','gif','png','jpg','jpeg','webp','json'] }] });
    if (result.canceled) return { ok: false, canceled: true };
    const cfg = currentConfig(); const items = [...(cfg.media || [])]; const added = [];
    for (const src of result.filePaths) { const ext = path.extname(src); const name = `${Date.now()}-${crypto.randomUUID().slice(0,8)}${ext}`; const dest = path.join(configStore.mediaDir, name); fs.copyFileSync(src, dest); const item = { id: crypto.randomUUID(), name: path.basename(src), path: dest, type: ext.replace('.','').toLowerCase() }; items.push(item); added.push(item); }
    const next = configStore.merge({ media: items }); settingsService.discard(); send('config:changed', next); return { ok: true, config: next, items: added };
  });
  ipcMain.handle('media:remove', (_event, id) => {
    const cfg = currentConfig(); const item = (cfg.media || []).find((x) => x.id === id); if (!item) return { ok: false, error: 'Medium nicht gefunden.' };
    try { if (item.path && fs.existsSync(item.path)) fs.unlinkSync(item.path); } catch {}
    const media = (cfg.media || []).filter((x) => x.id !== id); const mediaPools = (cfg.mediaPools || []).map((pool) => ({ ...pool, mediaIds: (pool.mediaIds || []).filter((mediaId) => mediaId !== id) }));
    const next = configStore.merge({ media, mediaPools }); settingsService.discard(); send('config:changed', next); return { ok: true, config: next };
  });

  ipcMain.handle('automation:testSequence',async(_event,payload={})=>{
    try{
      if(!Array.isArray(payload.actions)||!payload.actions.length||payload.actions.length>50)throw new Error('1 bis 50 Aktionen erforderlich.');
      return await actionEngine.executeRule({id:'manual-sequence-test:'+crypto.randomUUID(),actions:payload.actions,cooldownSeconds:0,onlyWhenLive:false,failurePolicy:payload.failurePolicy || 'stop-sequence',timeoutMs:Math.min(60000,Math.max(250,Number(payload.timeoutMs)||5000))},payload.context || {platform:'internal',user:'Crazy_User',username:'Crazy_User',message:'Test'},'manual-test');
    }catch(e){return{ok:false,error:e.message};}
  });
  ipcMain.handle('automation:testAction', async (_event, action) => { try { return await actionEngine.executeRule({id:'manual-action-test:'+crypto.randomUUID(),actions:[action],cooldownSeconds:0,onlyWhenLive:false,failurePolicy:'stop-sequence',timeoutMs:5000}, { user:'Crazy_User', username:'Crazy_User', platform:'internal', message:'Test' },'manual-test'); } catch (error) { return { ok:false, error:error.message }; } });
  ipcMain.handle('welcome:reset', () => {welcomeService.reset();return {ok:true};});
  ipcMain.handle('broadcast:test',async()=>{try{return await broadcastService.test();}catch(e){return{ok:false,error:e.message};}});

  ipcMain.handle('overlay:open', async (_event, route = '/overlay/chat') => { const status = overlayServer.getStatus(); if (!status.running) return { ok:false, error:'Overlay-Server läuft nicht.' }; const url = `http://${status.host}:${status.port}${route}`; await shell.openExternal(url); return { ok:true, url }; });
  ipcMain.handle('overlay:testEvent', (_event, type = 'gift') => { eventCore.ingestEvent({ platform:'tiktok', type, id:`test-${Date.now()}`, data:{ uniqueId:'Crazy_User', nickname:'Crazy_User', giftName:'Rose', count:1, value:100, text:'Test Event' } }, 'fake-connector'); return { ok:true }; });
  ipcMain.handle('clipboard:write', (_event, text) => { clipboard.writeText(String(text || '')); return { ok:true }; });

  ipcMain.handle('ffmpeg:detect', () => ffmpeg.detect());
  ipcMain.handle('ffmpeg:testEncoder', async (_event, encoder) => { try { return await ffmpeg.testEncoder(encoder); } catch (error) { return { ok:false, error:error.message, status:ffmpeg.getStatus() }; } });
  ipcMain.handle('ffmpeg:start', (_event, args, options) => { try { return ffmpeg.start(args, options); } catch (error) { return { ok:false, error:error.message }; } });
  ipcMain.handle('ffmpeg:stop', () => ffmpeg.stop());
  ipcMain.handle('ffmpeg:status', () => ffmpeg.getStatus());

  ipcMain.handle('health:get', () => healthService.getStatus());
  ipcMain.handle('diagnostics:get', () => diagnosticsSnapshot());
  ipcMain.handle('diagnostics:export', async () => {
    const result = await dialog.showSaveDialog({ title:'Diagnose exportieren', defaultPath:`batto-obs-tool-2.1-diagnose-${Date.now()}.json`, filters:[{ name:'JSON', extensions:['json'] }] });
    if (result.canceled || !result.filePath) return { ok:false, canceled:true };
    fs.writeFileSync(result.filePath, JSON.stringify(diagnosticsSnapshot(), null, 2), 'utf8'); return { ok:true, filePath:result.filePath };
  });

  ipcMain.handle('backup:now', () => ({ ok:true, filePath:configStore.backupNow(), backups:configStore.listBackups() }));
  ipcMain.handle('backup:list', () => ({ ok:true, backups:configStore.listBackups() }));
  ipcMain.handle('backup:restore', async (_event, file) => { const next = configStore.restoreBackup(file); settingsService.discard(); applyConfig(next, next); return { ok:true, config:next }; });
  ipcMain.handle('dialog:exportConfig', async () => { const result = await dialog.showSaveDialog({ title:'Settings exportieren', defaultPath:'batto-obs-tool-2.1-settings.json', filters:[{ name:'JSON', extensions:['json'] }] }); if (result.canceled || !result.filePath) return { ok:false, canceled:true }; configStore.exportTo(result.filePath); return { ok:true, filePath:result.filePath }; });
  ipcMain.handle('dialog:importConfig', async () => { const result = await dialog.showOpenDialog({ title:'Settings importieren', properties:['openFile'], filters:[{ name:'JSON', extensions:['json'] }] }); if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true }; const next = configStore.importFrom(result.filePaths[0]); settingsService.discard(); applyConfig(next, next); return { ok:true, config:next }; });

  ipcMain.handle('window:detach', () => {setChatDetached(true);return {ok:true};});
  ipcMain.handle('window:closeDetached', () => {setChatDetached(false);return {ok:true};});
}

async function shutdown() {
  await Promise.allSettled([require('../src/touch-bootstrap.cjs').close(),require('../src/dual-stream/bootstrap.cjs').close(),require('../src/suite-bootstrap.cjs').close()]);
  piperTts?.stop();
  tiktokMatch?.stop();
  chatExtras?.close();
  await community?.close();
  audioOutput?.stop();audioPlayer.dispose();
  navigation?.stop();
  streamerbot?.disconnect();
  inputHotkeys?.clear();
  twitchLogin?.cancel();
  broadcastService?.stop();
  actionEngine?.cancelAll();
  clearTimeout(autoBroadcastDelayTimer);
  clearInterval(autoBroadcastTimer);
  healthService?.stop();
  statusMonitor?.stop();
  await connectorManager?.stopAll?.();
  await ffmpeg?.stop?.().catch?.(() => {});
  await obs?.disconnect?.().catch?.(() => {});
  await overlayServer?.stop?.().catch?.(() => {});
  eventCore?.stop?.();
  auditStore?.close?.();
  logger?.cleanup?.();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  require('../src/services/obs-settings-import.cjs').initialize(app);
  app.on('second-instance', () => {
    openFromTray();
  });

  app.whenReady().then(() => {
    initCore();
    registerIpc();
    mainWindow = createWindow(false);
    mainWindow.on('closed', () => { mainWindow = null;if(!gamingMode&&!detachedWindow&&!require('../src/touch-bootstrap.cjs').getDetachedWindow()&&!require('../src/dual-stream/bootstrap.cjs').getDetachedWindow())app.quit(); });
    if (currentConfig().windows.detachedOpen) setChatDetached(true);
    app.on('activate', () => { openFromTray(); });
    startExternalServices().catch((error) => bridgeLog('error', 'Runtime', 'START_EXTERNAL_FAILED', { message:error.message }));
  });
}

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  shutdown().finally(() => {shutdownComplete=true;app.quit();});
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin'&&!gamingMode) app.quit(); });

// Adapter shares the existing OBS connection with Jarvis.
module.exports.getObsClient=()=>require('../src/services/suite-host.cjs').obsForJarvis(()=>obs);
module.exports.getMainWindow=()=>mainWindow;
module.exports.getGamingMode=()=>gamingMode;

module.exports.getSuiteHost=()=>({
 overlayStatus:()=>overlayServer?.getStatus(),
 catalog:()=>({...navigation?.controls?.snapshot(),items:[...(navigation?.catalog?.()||[]),...(currentConfig().media||[]).map(x=>({id:x.id,name:x.name||x.id,kind:'media'}))]}),
 control:value=>navigation.controls.control(value),
 run:(kind,id)=>kind==='media'?actionEngine.executeRule({id:'deck-media:'+id,cooldownSeconds:0,onlyWhenLive:false,actions:[{type:'media',mediaId:id}]},{platform:'internal',source:'stream-deck'},'deck-media'):navigation.test(kind,id),
 cancel:()=>{actionEngine.cancelAll();return {ok:true};},
 connect:async(name,op)=>{const a=adapters[name];if(!a)throw Error('Chat-Verbindung fehlt.');const on=op==='on'||op==='toggle'&&!a.getStatus().connected;await (on?a.connect():a.disconnect());return {ok:true};},
 navigate:view=>{if(!require('../src/services/suite-controls.cjs').VIEWS[view])throw Error('Unbekannter Bereich.');return navigation.navigate(view,true);},
 show:async()=>{await showMainWindow();return {ok:true};},
 gaming:enterGaming,
 tikfinity:()=>shell.openExternal('https://tikfinity.zerody.one/tiktok/')
});

if(process.env.BATTO_TEST_INSTANCE==='1')module.exports.getAudioOutputForTest=()=>audioOutput;
