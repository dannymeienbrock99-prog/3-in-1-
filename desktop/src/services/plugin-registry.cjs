"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

function existingDirectories(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))].filter((directory) => {
    try { return fs.statSync(directory).isDirectory(); } catch { return false; }
  });
}

function defaultPluginRoots(programData = process.env.ProgramData, appData = process.env.APPDATA, localAppData = process.env.LOCALAPPDATA) {
  return existingDirectories([
    path.join(programData || "C:\\ProgramData", "Batto OBS Tool", "Plugins"),
    path.join(programData || "C:\\ProgramData", "Creator Hub", "Plugins"),
    path.join(programData || "C:\\ProgramData", "Elgato", "StreamDeck", "Plugins"),
    path.join(appData || path.join(os.homedir(), "AppData", "Roaming"), "Elgato", "StreamDeck", "Plugins"),
    path.join(localAppData || path.join(os.homedir(), "AppData", "Local"), "Programs", "Creator Hub", "resources", "plugins"),
    path.join(localAppData || path.join(os.homedir(), "AppData", "Local"), "Programs", "Batto OBS Tool", "resources", "plugins")
  ]);
}

function defaultIconPackRoots(programData = process.env.ProgramData, appData = process.env.APPDATA) {
  return existingDirectories([
    path.join(programData || "C:\\ProgramData", "Batto OBS Tool", "IconPacks"),
    path.join(programData || "C:\\ProgramData", "Creator Hub", "IconPacks"),
    path.join(appData || path.join(os.homedir(), "AppData", "Roaming"), "Elgato", "StreamDeck", "IconPacks")
  ]);
}

function walk(directory, maximumDepth = 4, depth = 0, result = []) {
  if (depth > maximumDepth) return result;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, maximumDepth, depth + 1, result);
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

function findManifest(directory) {
  const names = ["manifest.json", "plugin.json", "Manifest.json"];
  for (const name of names) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) return file;
  }
  return walk(directory, 2).find((file) => names.includes(path.basename(file))) || null;
}

function resolveManifestAsset(pluginRoot, value) {
  if (!value || typeof value !== "string") return null;
  const candidates = [
    path.resolve(pluginRoot, value),
    path.resolve(pluginRoot, `${value}.png`),
    path.resolve(pluginRoot, `${value}.svg`),
    path.resolve(pluginRoot, `${value}.jpg`)
  ];
  return candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function fileToDataUrl(file, maximumBytes = 1_500_000) {
  if (!file) return "";
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maximumBytes) return "";
    const extension = path.extname(file).toLowerCase();
    const mime = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml"
    }[extension];
    if (!mime) return "";
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

function actionFromManifest(action, pluginRoot, index) {
  const uuid = safeText(action.UUID || action.uuid || action.id || `action-${index}`, 200);
  const name = safeText(action.Name || action.name || action.Title || uuid, 200);
  const iconFile = resolveManifestAsset(pluginRoot, action.Icon || action.icon || action.Image || action.image);
  const states = Array.isArray(action.States || action.states)
    ? (action.States || action.states).map((state, stateIndex) => ({
        index: stateIndex,
        title: safeText(state.Title || state.title || "", 200),
        image: fileToDataUrl(resolveManifestAsset(pluginRoot, state.Image || state.image))
      }))
    : [];
  return {
    id: uuid,
    name,
    tooltip: safeText(action.Tooltip || action.tooltip || action.Description || "", 500),
    icon: fileToDataUrl(iconFile),
    states,
    controllers: Array.isArray(action.Controllers) ? action.Controllers : [],
    propertyInspectorPath: action.PropertyInspectorPath || action.propertyInspectorPath || "",
    raw: {
      uuid,
      name,
      propertyInspectorPath: action.PropertyInspectorPath || action.propertyInspectorPath || ""
    }
  };
}

function normalizePlugin(manifest, manifestFile, root) {
  const pluginRoot = path.dirname(manifestFile);
  const actions = Array.isArray(manifest.Actions || manifest.actions)
    ? (manifest.Actions || manifest.actions).map((action, index) => actionFromManifest(action, pluginRoot, index))
    : [];
  const id = safeText(manifest.UUID || manifest.uuid || manifest.id || path.basename(pluginRoot), 200);
  const name = safeText(manifest.Name || manifest.name || id, 200);
  const iconFile = resolveManifestAsset(pluginRoot, manifest.Icon || manifest.icon || manifest.Logo || manifest.logo)
    || walk(pluginRoot, 2).find((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    || null;
  const executable = manifest.CodePathWin || manifest.codePathWin || manifest.CodePath || manifest.codePath || "";
  const executablePath = executable ? path.resolve(pluginRoot, executable) : "";
  return {
    id,
    name,
    version: safeText(manifest.Version || manifest.version || "", 80),
    author: safeText(manifest.Author || manifest.author || "", 120),
    description: safeText(manifest.Description || manifest.description || "", 500),
    category: safeText(manifest.Category || manifest.category || "Plugin", 80),
    icon: fileToDataUrl(iconFile),
    root: pluginRoot,
    sourceRoot: root,
    manifestFile,
    executablePath,
    executableExists: Boolean(executablePath && fs.existsSync(executablePath)),
    propertyInspectorPath: manifest.PropertyInspectorPath || manifest.propertyInspectorPath || "",
    actions,
    rawName: name,
    native: false,
    enabled: true,
    status: actions.length ? "Bereit zur Konfiguration" : "Manifest erkannt – keine Aktionen veröffentlicht"
  };
}

const BUILT_IN_PLUGINS = Object.freeze([
  {
    id: "batto.obs",
    name: "OBS Studio",
    version: "2.0.0",
    category: "Streaming",
    description: "Native OBS-WebSocket-Aktionen ohne zusätzliche Stream-Deck-Laufzeit.",
    actions: [
      ["obs.scene", "Szene wechseln"], ["obs.source.toggle", "Quelle ein/aus"],
      ["obs.input.mute", "Audio stummschalten"], ["obs.input.volume", "Lautstärke setzen"],
      ["obs.stream.toggle", "Stream Start/Stop"], ["obs.record.toggle", "Aufnahme Start/Stop"],
      ["obs.virtualcam.toggle", "Virtuelle Kamera Start/Stop"]
    ]
  },
  {
    id: "batto.system",
    name: "Advanced Launcher",
    version: "2.0.0",
    category: "System",
    description: "Programme, Dateien, Ordner, Webseiten und Hotkeys starten.",
    actions: [
      ["system.launch", "Programm oder Datei öffnen"], ["system.url", "Webseite öffnen"],
      ["system.hotkey", "Tastenkombination"], ["system.command", "Befehl ausführen"]
    ]
  },
  {
    id: "batto.media",
    name: "Mediensteuerung",
    version: "2.0.0",
    category: "Audio",
    description: "Spotify, YouTube Music und andere Windows-Medienprogramme über Medientasten steuern.",
    actions: [
      ["media.playpause", "Play/Pause"], ["media.next", "Nächster Titel"],
      ["media.previous", "Vorheriger Titel"], ["media.stop", "Stop"],
      ["media.volume.up", "Lautstärke erhöhen"], ["media.volume.down", "Lautstärke verringern"],
      ["media.mute", "Systemton stummschalten"]
    ]
  },
  {
    id: "batto.youtube",
    name: "YouTube Live und Ticker",
    version: "2.0.0",
    category: "Streaming",
    description: "YouTube-Livechat, Kanalstatus, letztes Video, Dashboard und Ticker.",
    actions: [
      ["youtube.dashboard", "YouTube-Dashboard öffnen"], ["youtube.channel", "Kanal öffnen"],
      ["youtube.latest", "Letztes Video öffnen"], ["youtube.refresh", "Ticker aktualisieren"],
      ["youtube.chat.send", "Chat-Nachricht senden"]
    ]
  },
  {
    id: "batto.tiktok",
    name: "TikTok LIVE Studio und TikFinity",
    version: "2.0.0",
    category: "Streaming",
    description: "LIVE Studio starten und lokale TikFinity/TikTok-Ereignisse an das Overlay senden.",
    actions: [
      ["tiktok.live-studio.launch", "TikTok LIVE Studio starten"],
      ["tiktok.event", "TikTok-Ereignis auslösen"], ["tikfinity.webhook", "TikFinity-Webhook senden"]
    ]
  },
  {
    id: "batto.discord",
    name: "Discord",
    version: "2.0.0",
    category: "Kommunikation",
    description: "Discord öffnen, Mikrofon/Audio-Hotkeys und optionale Webhook-Nachrichten.",
    actions: [
      ["discord.launch", "Discord öffnen"], ["discord.webhook", "Webhook-Nachricht senden"],
      ["system.hotkey", "Discord-Hotkey ausführen"]
    ]
  },
  {
    id: "batto.obsbot",
    name: "OBSBOT WebCam",
    version: "2.0.0",
    category: "Kamera",
    description: "OBSBOT Center erkennen und öffnen; Original-Plugin-Aktionen werden angezeigt, wenn das Plugin installiert ist.",
    actions: [["obsbot.center", "OBSBOT Center öffnen"]]
  },
  {
    id: "batto.giveaway",
    name: "Twitch Giveaway",
    version: "2.0.0",
    category: "Streaming",
    description: "Lokale Giveaway-Liste verwalten und zufällig einen Gewinner ziehen.",
    actions: [["giveaway.add", "Teilnehmer hinzufügen"], ["giveaway.draw", "Gewinner ziehen"]]
  },
  {
    id: "batto.creator-tools",
    name: "Umfragen, Word Clouds und Glücksrad",
    version: "2.0.0",
    category: "Overlay",
    description: "Lokale Overlay-Aktionen für Umfragen, Wortwolken und das Glücksrad.",
    actions: [["overlay.poll", "Umfrage anzeigen"], ["overlay.wordcloud", "Wortwolke aktualisieren"], ["overlay.wheel", "Glücksrad drehen"]]
  }
].map((plugin) => ({
  ...plugin,
  native: true,
  enabled: true,
  status: "Native Batto-Aktionen verfügbar",
  icon: "",
  root: "",
  sourceRoot: "",
  manifestFile: "",
  executablePath: "",
  executableExists: true,
  actions: plugin.actions.map(([id, name]) => ({ id, name, tooltip: "", icon: "", states: [], controllers: ["Keypad"], propertyInspectorPath: "", raw: { id, name } }))
})));

class PluginRegistry extends EventEmitter {
  constructor({ stateFile, pluginRoots, iconPackRoots } = {}) {
    super();
    this.stateFile = stateFile || path.join(process.cwd(), "plugin-state.json");
    this.pluginRoots = pluginRoots || defaultPluginRoots();
    this.iconPackRoots = iconPackRoots || defaultIconPackRoots();
    this.state = readJson(this.stateFile, { disabled: [], settings: {} }) || { disabled: [], settings: {} };
    this.plugins = [];
    this.iconPacks = [];
  }

  scan() {
    const plugins = [...BUILT_IN_PLUGINS.map((plugin) => ({ ...plugin, actions: plugin.actions.map((action) => ({ ...action })) }))];
    const seen = new Set(plugins.map((plugin) => plugin.id.toLowerCase()));
    for (const root of this.pluginRoots) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        const manifestFile = findManifest(directory);
        if (!manifestFile) continue;
        const manifest = readJson(manifestFile, null);
        if (!manifest || typeof manifest !== "object") continue;
        const plugin = normalizePlugin(manifest, manifestFile, root);
        const key = plugin.id.toLowerCase();
        if (seen.has(key)) {
          const existing = plugins.find((item) => item.id.toLowerCase() === key);
          if (existing?.native) {
            existing.originalPlugin = plugin;
            existing.status = `Native Aktionen + Originalpaket ${plugin.version || "erkannt"}`;
          }
          continue;
        }
        seen.add(key);
        plugins.push(plugin);
      }
    }
    const disabled = new Set((this.state.disabled || []).map((value) => String(value).toLowerCase()));
    for (const plugin of plugins) plugin.enabled = !disabled.has(plugin.id.toLowerCase());
    this.plugins = plugins.sort((left, right) => left.category.localeCompare(right.category, "de") || left.name.localeCompare(right.name, "de"));
    this.iconPacks = this.scanIconPacks();
    this.emit("changed", this.snapshot());
    return this.snapshot();
  }

  scanIconPacks() {
    const result = [];
    const seen = new Set();
    for (const root of this.iconPackRoots) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        const manifestFile = findManifest(directory);
        const manifest = manifestFile ? readJson(manifestFile, {}) : {};
        const id = safeText(manifest.UUID || manifest.uuid || manifest.id || entry.name, 200);
        if (seen.has(id.toLowerCase())) continue;
        seen.add(id.toLowerCase());
        const images = walk(directory, 5).filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())).slice(0, 500);
        result.push({
          id,
          name: safeText(manifest.Name || manifest.name || entry.name, 200),
          version: safeText(manifest.Version || manifest.version || "", 80),
          root: directory,
          count: images.length,
          icons: images.slice(0, 80).map((file) => ({ name: path.basename(file), dataUrl: fileToDataUrl(file, 600_000) })).filter((item) => item.dataUrl)
        });
      }
    }
    return result;
  }

  snapshot() {
    return {
      plugins: this.plugins.map((plugin) => ({ ...plugin, settings: this.state.settings?.[plugin.id] || {} })),
      iconPacks: this.iconPacks,
      roots: { plugins: this.pluginRoots, iconPacks: this.iconPackRoots },
      scannedAt: Date.now()
    };
  }

  setEnabled(pluginId, enabled) {
    const key = String(pluginId || "").toLowerCase();
    const disabled = new Set((this.state.disabled || []).map((value) => String(value).toLowerCase()));
    if (enabled) disabled.delete(key); else disabled.add(key);
    this.state.disabled = [...disabled];
    writeJsonAtomic(this.stateFile, this.state);
    return this.scan();
  }

  saveSettings(pluginId, settings) {
    this.state.settings ||= {};
    this.state.settings[String(pluginId)] = settings && typeof settings === "object" ? settings : {};
    writeJsonAtomic(this.stateFile, this.state);
    return this.state.settings[String(pluginId)];
  }

  importDirectory(sourceDirectory, destinationRoot) {
    if (!sourceDirectory || !fs.existsSync(sourceDirectory)) throw new Error("Plugin-Quellordner wurde nicht gefunden.");
    const destination = ensureDirectory(destinationRoot || this.pluginRoots[0] || path.join(process.env.ProgramData || "C:\\ProgramData", "Batto OBS Tool", "Plugins"));
    const sourceStat = fs.statSync(sourceDirectory);
    if (!sourceStat.isDirectory()) throw new Error("Plugin-Quelle ist kein Ordner.");
    const target = path.join(destination, path.basename(sourceDirectory));
    fs.cpSync(sourceDirectory, target, { recursive: true, force: false, errorOnExist: true });
    this.pluginRoots = existingDirectories([destination, ...this.pluginRoots]);
    return this.scan();
  }
}

module.exports = {
  BUILT_IN_PLUGINS,
  PluginRegistry,
  defaultIconPackRoots,
  defaultPluginRoots,
  fileToDataUrl,
  normalizePlugin
};
