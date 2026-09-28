"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { atomicWrite, clone, ensureDir, normalizeError, readJson } = require("./runtime-utils-v2.cjs");

const BUILTIN = Object.freeze([
  {
    id: "batto.obs", name: "OBS Studio", version: "2.0.0", category: "Streaming", native: true,
    description: "Szenen, Quellen, Stream, Aufnahme, virtuelle Kamera, Screenshots und Audio.",
    actions: [
      ["scene", "Szene schalten", "obs.scene"], ["source", "Quelle ein/aus", "obs.source.toggle"], ["mute", "Audio Mute", "obs.mute"],
      ["stream", "Stream Start/Stop", "obs.stream.toggle"], ["record", "Aufnahme Start/Stop", "obs.record.toggle"], ["virtualcam", "Virtuelle Kamera", "obs.virtualCam.toggle"]
    ]
  },
  {
    id: "batto.discord", name: "Discord", version: "2.0.0", category: "Kommunikation", native: true,
    description: "Discord öffnen und frei konfigurierbare Hotkeys verwenden.",
    actions: [["open", "Discord öffnen", "discord.open"], ["hotkey", "Discord-Hotkey", "system.hotkey"]]
  },
  {
    id: "batto.discord-volume", name: "Discord Volume Mixer", version: "2.0.0", category: "Audio", native: true,
    description: "System- und Discord-Lautstärke über native Windows-Aktionen steuern.",
    actions: [["mute", "Stummschalten", "system.volume"], ["up", "Lauter", "system.volume"], ["down", "Leiser", "system.volume"]]
  },
  {
    id: "batto.advanced-launcher", name: "Advanced Launcher", version: "2.0.0", category: "System", native: true,
    description: "Programme, Dateien, Webseiten und Parameter starten.",
    actions: [["launch", "Programm/Datei öffnen", "system.launch"], ["url", "Webseite öffnen", "system.openUrl"], ["hotkey", "Tastenkombination", "system.hotkey"]]
  },
  {
    id: "batto.icue", name: "iCUE", version: "2.0.0", category: "Hardware", native: true,
    description: "iCUE öffnen; erkannte Originalaktionen werden zusätzlich angezeigt.",
    actions: [["open", "iCUE öffnen", "system.launch"], ["profile", "Profil-Hotkey", "system.hotkey"]], dependency: "Corsair iCUE"
  },
  {
    id: "batto.bambulab", name: "BambuLab Printer Monitor", version: "2.0.0", category: "Hardware", native: true,
    description: "Bambu Studio beziehungsweise den Druckermonitor öffnen.",
    actions: [["open", "Bambu Studio öffnen", "system.launch"], ["url", "Drucker-Webseite öffnen", "system.openUrl"]], dependency: "Bambu Studio oder lokaler Druckerzugang"
  },
  {
    id: "batto.spotify", name: "Spotify / Mediensteuerung", version: "2.0.0", category: "Audio", native: true,
    description: "Play/Pause, nächster/vorheriger Titel, Stop, Mute und Lautstärke.",
    actions: [["play", "Play/Pause", "spotify.media"], ["next", "Nächster Titel", "spotify.media"], ["previous", "Vorheriger Titel", "spotify.media"], ["mute", "Mute", "system.volume"]]
  },
  {
    id: "batto.volume", name: "Volume Controller", version: "2.0.0", category: "Audio", native: true,
    description: "Windows-Lautstärke und Medientasten ohne zusätzliche Laufzeit.",
    actions: [["mute", "Mute", "system.volume"], ["up", "Lauter", "system.volume"], ["down", "Leiser", "system.volume"], ["set", "Lautstärke setzen", "system.volume"]]
  },
  {
    id: "batto.tikfinity", name: "TikFinity", version: "2.0.0", category: "TikTok", native: true,
    description: "TikFinity öffnen und Chat-/Overlay-Ereignisse über den lokalen Webhook annehmen.",
    actions: [["open", "TikFinity öffnen", "tikfinity.open"], ["event", "Overlay-Ereignis", "overlay.event"]], dependency: "TikFinity für direkte TikTok-LIVE-Ereignisse"
  },
  {
    id: "batto.tiktok-live", name: "TikTok LIVE Studio", version: "2.0.0", category: "TikTok", native: true,
    description: "TikTok LIVE Studio öffnen; Plattform-Einladungen bleiben eine TikTok-Funktion.",
    actions: [["open", "LIVE Studio öffnen", "tiktok.open"], ["event", "Lokales TikTok-Ereignis", "overlay.event"]], dependency: "TikTok LIVE Studio"
  },
  {
    id: "batto.twitch-giveaway", name: "Twitch Giveaway", version: "2.0.0", category: "Twitch", native: true,
    description: "Teilnehmer aus Chatereignissen sammeln und lokale Ziehung auslösen.",
    actions: [["add", "Teilnehmer hinzufügen", "overlay.event"], ["draw", "Gewinner ziehen", "overlay.event"]]
  },
  {
    id: "batto.youtube-music", name: "YouTube Music Desktop Connector", version: "2.3-native", category: "YouTube", native: true,
    description: "Native Medientasten als Ersatz, wenn die Original-Desktop-App oder Elgato-Laufzeit fehlt.",
    actions: [["play", "Play/Pause", "system.media"], ["next", "Nächster Titel", "system.media"], ["previous", "Vorheriger Titel", "system.media"], ["like", "Like-Hotkey", "system.hotkey"], ["dislike", "Dislike-Hotkey", "system.hotkey"], ["mute", "Mute", "system.volume"], ["shuffle", "Shuffle-Hotkey", "system.hotkey"], ["repeat", "Repeat-Hotkey", "system.hotkey"]], dependency: "Optional: YouTube Music Desktop App"
  },
  {
    id: "batto.youtube", name: "YouTube", version: "3.0.1.5-native", category: "YouTube", native: true,
    description: "Dashboard, Chat-Empfang und lokale Statusaktionen. Schreibaktionen benötigen die passenden Google-OAuth-Rechte.",
    actions: [["dashboard", "YouTube-Dashboard öffnen", "youtube.open"], ["refresh", "Live-Status aktualisieren", "youtube.refresh"], ["chat", "Chatnachricht lokal senden", "multichat.send"]], dependency: "API-Schlüssel für Chat-Lesen; OAuth für Schreibaktionen"
  },
  {
    id: "batto.youtube-ticker", name: "YouTube Ticker", version: "2.7.2-native", category: "YouTube", native: true,
    description: "Kanal, letztes Video oder Livestream öffnen und Daten aktualisieren.",
    actions: [["channel", "Kanal öffnen", "youtube.open"], ["latest", "Letztes Video öffnen", "youtube.open"], ["refresh", "Ticker aktualisieren", "youtube.refresh"]]
  },
  {
    id: "batto.obsbot", name: "OBSBOT WebCam", version: "2.2-native", category: "Kamera", native: true,
    description: "OBSBOT Center öffnen und frei konfigurierbare Kamera-Hotkeys verwenden.",
    actions: [["open", "OBSBOT Center öffnen", "obsbot.open"], ["set", "Kamera-Hotkey", "system.hotkey"], ["reset", "Kamera zurücksetzen", "system.hotkey"]], dependency: "OBSBOT Center und unterstützte Kamera"
  },
  {
    id: "batto.polls-wheel", name: "Polls, Word Clouds & Spinner Wheels", version: "2.0.0", category: "Overlay", native: true,
    description: "Lokale Umfragen, Wortwolken und Glücksrad-Ereignisse für die transparente Browserquelle.",
    actions: [["poll", "Umfrage", "overlay.event"], ["wordcloud", "Wortwolke", "overlay.event"], ["wheel", "Glücksrad", "overlay.wheel"]]
  },
  {
    id: "batto.stream-overlay", name: "Batto Stream-Overlay", version: "2.0.0", category: "Overlay", native: true,
    description: "Chat, Ziele, Timer, Geschenke, Likes, Herzfrequenz, Wheel und Team-Alpha-Logo.",
    actions: [["chat", "Chat anzeigen", "overlay.event"], ["gift", "Geschenk anzeigen", "overlay.event"], ["like", "Likes aktualisieren", "overlay.event"], ["heart", "Herzfrequenz", "overlay.event"], ["cohost", "Co-Host-Status", "overlay.event"]]
  }
]);

function builtinPlugin(definition) {
  return {
    ...definition,
    source: "Batto OBS Tool – native Aktion",
    installed: true,
    enabled: true,
    actions: definition.actions.map(([id, name, actionType]) => ({ id: `${definition.id}.${id}`, name, actionType }))
  };
}

function manifestCandidates(directory) {
  const names = ["manifest.json", "plugin.json", "Manifest.json"];
  return names.map((name) => path.join(directory, name)).filter(fs.existsSync);
}

function actionFromManifest(entry, pluginId, index) {
  const id = String(entry.UUID || entry.uuid || entry.id || entry.Name || `action-${index}`);
  return {
    id,
    name: String(entry.Name || entry.name || entry.Title || id),
    tooltip: String(entry.Tooltip || entry.tooltip || ""),
    icon: String(entry.Icon || entry.icon || ""),
    propertyInspector: String(entry.PropertyInspectorPath || entry.propertyInspector || ""),
    states: Array.isArray(entry.States || entry.states) ? clone(entry.States || entry.states) : [],
    actionType: "plugin.action",
    pluginId
  };
}

function readManifest(manifestPath) {
  try { return JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { return null; }
}

function walkDirectories(root, depth = 3) {
  const results = [];
  function visit(directory, level) {
    if (level > depth) return;
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(directory, entry.name);
      results.push(full);
      visit(full, level + 1);
    }
  }
  visit(root, 0);
  return results;
}

class PluginRegistry {
  constructor({ settingsFile, roots = [], iconRoots = [] } = {}) {
    this.settingsFile = settingsFile;
    this.roots = roots;
    this.iconRoots = iconRoots;
    this.settings = readJson(settingsFile, { enabled: {} });
    this.items = [];
    this.iconPacks = [];
    this.errors = [];
    this.executor = null;
  }

  setExecutor(executor) { this.executor = executor; }

  setRoots(roots = [], iconRoots = []) {
    this.roots = [...new Set(roots.filter(Boolean).map((entry) => path.resolve(entry)))];
    this.iconRoots = [...new Set(iconRoots.filter(Boolean).map((entry) => path.resolve(entry)))];
  }

  saveSettings() { atomicWrite(this.settingsFile, this.settings); }

  scan() {
    const items = BUILTIN.map(builtinPlugin);
    const errors = [];
    const seen = new Set(items.map((item) => item.id));
    for (const root of this.roots) {
      if (!fs.existsSync(root)) continue;
      const directories = [root, ...walkDirectories(root, 2)];
      for (const directory of directories) {
        const manifestPath = manifestCandidates(directory)[0];
        if (!manifestPath) continue;
        const manifest = readManifest(manifestPath);
        if (!manifest) { errors.push({ path: manifestPath, error: "Manifest konnte nicht gelesen werden" }); continue; }
        const id = String(manifest.UUID || manifest.uuid || manifest.id || path.basename(directory)).toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        const actionsSource = manifest.Actions || manifest.actions || manifest.Commands || [];
        const actions = (Array.isArray(actionsSource) ? actionsSource : []).map((entry, index) => actionFromManifest(entry, id, index));
        const iconPath = manifest.Icon || manifest.icon || "";
        items.push({
          id,
          name: String(manifest.Name || manifest.name || path.basename(directory)),
          version: String(manifest.Version || manifest.version || ""),
          author: String(manifest.Author || manifest.author || ""),
          description: String(manifest.Description || manifest.description || ""),
          category: String(manifest.Category || manifest.category || "Installierte Plugins"),
          source: directory,
          manifestPath,
          installed: true,
          native: false,
          enabled: this.settings.enabled[id] !== false,
          icon: iconPath ? this.resolveAsset(directory, iconPath) : "",
          actions,
          os: manifest.OS || manifest.os || [],
          sdkVersion: manifest.SDKVersion || manifest.sdkVersion || null
        });
      }
    }
    items.forEach((item) => { item.enabled = this.settings.enabled[item.id] !== false; });
    this.items = items;
    this.iconPacks = this.scanIconPacks();
    this.errors = errors;
    return this.snapshot();
  }

  resolveAsset(root, value) {
    const raw = String(value || "").replace(/\\/g, path.sep).replace(/^\.\//, "");
    const candidates = [raw, `${raw}.png`, `${raw}.svg`, `${raw}.jpg`].map((entry) => path.resolve(root, entry));
    const valid = candidates.find((candidate) => candidate.startsWith(path.resolve(root)) && fs.existsSync(candidate));
    return valid ? `file://${valid.replace(/\\/g, "/")}` : "";
  }

  scanIconPacks() {
    const packs = [];
    for (const root of this.iconRoots) {
      if (!fs.existsSync(root)) continue;
      for (const directory of [root, ...walkDirectories(root, 1)]) {
        let images = [];
        try { images = fs.readdirSync(directory).filter((name) => /\.(png|jpe?g|svg|webp|ico)$/i.test(name)); } catch {}
        if (!images.length) continue;
        packs.push({ id: path.basename(directory).toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: path.basename(directory), path: directory, imageCount: images.length });
      }
    }
    const nativeNames = ["LS25 Buttons", "Team Alpha", "Batto System", "OBS Controls"];
    nativeNames.forEach((name) => { if (!packs.some((pack) => pack.name.toLowerCase() === name.toLowerCase())) packs.push({ id: `native-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, path: "", imageCount: 0, native: true }); });
    return packs;
  }

  snapshot() {
    return { items: clone(this.items), iconPacks: clone(this.iconPacks), errors: clone(this.errors), roots: clone(this.roots) };
  }

  setEnabled(id, enabled) {
    this.settings.enabled[String(id)] = Boolean(enabled);
    this.saveSettings();
    const item = this.items.find((entry) => entry.id === id);
    if (item) item.enabled = Boolean(enabled);
    return this.snapshot();
  }

  async executeAction(pluginId, actionId, settings = {}, context = {}) {
    const plugin = this.items.find((item) => item.id === pluginId);
    if (!plugin) throw new Error(`Plugin nicht gefunden: ${pluginId}`);
    if (plugin.enabled === false) throw new Error(`Plugin ist deaktiviert: ${plugin.name}`);
    const action = plugin.actions.find((entry) => entry.id === actionId || entry.id.endsWith(`.${actionId}`));
    if (!action) throw new Error(`Plugin-Aktion nicht gefunden: ${actionId}`);
    if (plugin.native) {
      if (!this.executor) throw new Error("Native Aktionslaufzeit fehlt");
      const nativeSettings = this.nativeDefaults(plugin.id, action.id, action.actionType, settings);
      return this.executor.execute({ type: action.actionType, ...nativeSettings }, context);
    }
    throw new Error(`Das Original-Plugin „${plugin.name}“ wurde erkannt, benötigt aber seine eigene Elgato-/Hersteller-Laufzeit. Verwende die gleichwertige native Batto-Aktion oder installiere die erforderliche Laufzeit.`);
  }

  nativeDefaults(pluginId, actionId, type, settings) {
    const id = actionId.split(".").at(-1);
    const defaults = { ...settings };
    if (type === "system.media" || type === "spotify.media") defaults.command ||= id === "play" ? "playpause" : id;
    if (type === "system.volume") defaults.command ||= id === "up" ? "volumeup" : id === "down" ? "volumedown" : id;
    if (pluginId === "batto.icue" && id === "open") defaults.path ||= path.join(process.env.ProgramFiles || "C:\\Program Files", "Corsair", "CORSAIR iCUE5 Software", "iCUE.exe");
    if (pluginId === "batto.bambulab" && id === "open") defaults.path ||= path.join(process.env.LOCALAPPDATA || "", "Programs", "Bambu Studio", "bambu-studio.exe");
    return defaults;
  }

  importDirectory(source, destinationRoot) {
    const sourcePath = path.resolve(source);
    if (!fs.existsSync(sourcePath)) throw new Error("Plugin-Ordner nicht gefunden");
    const destination = path.join(ensureDir(destinationRoot), path.basename(sourcePath));
    if (fs.existsSync(destination)) throw new Error("Plugin-Ordner ist bereits vorhanden");
    fs.cpSync(sourcePath, destination, { recursive: true, errorOnExist: true });
    if (!this.roots.includes(destinationRoot)) this.roots.push(destinationRoot);
    return this.scan();
  }
}

module.exports = { BUILTIN, PluginRegistry };
