"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bootstrap = path.join(root, "bootstrap-2.0", "src");
const source = path.join(root, "src");

function copyFile(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Quelldatei fehlt: ${path.relative(root, from)}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function edit(file, callback) {
  const before = fs.readFileSync(file, "utf8");
  const after = callback(before);
  if (typeof after !== "string" || !after.trim()) throw new Error(`Patch für ${path.relative(root, file)} lieferte keinen gültigen Inhalt.`);
  fs.writeFileSync(file, after, "utf8");
}

function requireReplace(text, search, replacement, label) {
  if (text.includes(replacement)) return text;
  if (!text.includes(search)) throw new Error(`${label} wurde nicht gefunden.`);
  return text.replace(search, replacement);
}

copyFile(path.join(bootstrap, "services", "native-plugin-additions.cjs"), path.join(source, "services", "native-plugin-additions.cjs"));

const registry = path.join(source, "services", "plugin-registry.cjs");
edit(registry, (text) => {
  text = requireReplace(
    text,
    'const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");',
    'const { ensureDirectory, readJson, safeText, writeJsonAtomic } = require("./common.cjs");\nconst { EXTRA_BUILT_IN_PLUGINS } = require("./native-plugin-additions.cjs");',
    "Native Plugin-Erweiterungen"
  );
  text = requireReplace(
    text,
    'const plugins = [...BUILT_IN_PLUGINS.map((plugin) => ({ ...plugin, actions: plugin.actions.map((action) => ({ ...action })) }))];',
    'const plugins = [...BUILT_IN_PLUGINS, ...EXTRA_BUILT_IN_PLUGINS].map((plugin) => ({ ...plugin, actions: plugin.actions.map((action) => ({ ...action })) }));',
    "Zusammenführung der nativen Plugin-Liste"
  );
  return text;
});

const executor = path.join(source, "services", "action-executor.cjs");
edit(executor, (text) => {
  if (!text.includes('youtubeMusic: [path.join(local, "Programs", "YouTube Music Desktop App"')) {
    const match = text.match(/(const known = \{[\s\S]*?)(\r?\n\s*\};\r?\n\s*return findExecutable)/);
    if (!match) throw new Error("Programmliste in action-executor.cjs wurde nicht gefunden.");
    const addition = [
      ',\n    icue: [path.join(programFiles, "Corsair", "Corsair iCUE5 Software", "iCUE.exe"), path.join(programFiles, "Corsair", "CORSAIR iCUE 4 Software", "iCUE.exe")]',
      ',\n    bambulab: [path.join(programFiles, "Bambu Studio", "bambu-studio.exe"), path.join(local, "Programs", "Bambu Studio", "bambu-studio.exe")]',
      ',\n    youtubeMusic: [path.join(local, "Programs", "YouTube Music Desktop App", "YouTube Music Desktop App.exe"), path.join(local, "Programs", "YouTube Music", "YouTube Music.exe"), path.join(process.env.APPDATA || "", "YouTube Music", "YouTube Music.exe")]'
    ].join("");
    text = text.replace(match[0], `${match[1].replace(/,?\s*$/, "")}${addition}${match[2]}`);
  }

  if (!text.includes('case "volume.mixer":')) {
    const marker = '      case "discord.webhook": {';
    if (!text.includes(marker)) throw new Error("Einfügepunkt für native Desktop-Aktionen wurde nicht gefunden.");
    const cases = `      case "volume.mixer":
      case "discord.volume.mixer": {
        childProcess.spawn("sndvol.exe", [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return { executable: "sndvol.exe" };
      }
      case "spotify.launch": {
        const executable = installedProgramCandidates("spotify");
        if (executable) childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        else await this.shell.openExternal("spotify:");
        return { executable: executable || "spotify:" };
      }
      case "icue.launch":
      case "icue.profile": {
        const executable = installedProgramCandidates("icue");
        if (!executable) throw new Error("Corsair iCUE wurde nicht gefunden.");
        const args = type === "icue.profile" && settings.profile ? ["--profile", String(settings.profile)] : [];
        childProcess.spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return { executable, args };
      }
      case "bambulab.launch":
      case "bambulab.monitor": {
        const executable = installedProgramCandidates("bambulab");
        if (!executable) throw new Error("Bambu Studio wurde nicht gefunden. Ein Druckerstatus wird ohne lokale Bambu-Verbindung nicht vorgetäuscht.");
        childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return { executable };
      }
      case "youtube.music.open": {
        const executable = installedProgramCandidates("youtubeMusic");
        if (executable) childProcess.spawn(executable, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        else await this.shell.openExternal("https://music.youtube.com/");
        return { executable: executable || "https://music.youtube.com/" };
      }
      case "youtube.music.playlist": {
        const target = String(settings.url || settings.playlistUrl || "").trim();
        if (!/^https:\/\/music\.youtube\.com\//i.test(target)) throw new Error("Für die Playlist-Aktion wird eine gültige YouTube-Music-Playlist-Adresse benötigt.");
        await this.shell.openExternal(target);
        return { target };
      }
      case "youtube.music.like":
      case "youtube.music.dislike":
      case "youtube.music.shuffle":
      case "youtube.music.repeat":
      case "youtube.music.info": {
        if (settings.keys) return this._execute("system.hotkey", { keys: settings.keys }, context);
        throw new Error("Diese YouTube-Music-App-Aktion benötigt einen im Aktionseditor konfigurierten Desktop-App-Hotkey. Ohne passende Laufzeit wird kein Erfolg gemeldet.");
      }
`;
    text = text.replace(marker, `${cases}${marker}`);
  }

  if (!text.includes('case "youtube.ticker.status":')) {
    const match = text.match(/\s*case "youtube\.refresh":\s*\r?\n\s*return \{ videoId: await this\.youtubeLatestVideo\(settings\) \};/);
    if (!match) throw new Error("YouTube-Refresh-Aktion wurde nicht gefunden.");
    text = text.replace(match[0], '\n      case "youtube.refresh":\n      case "youtube.ticker.status":\n        return { videoId: await this.youtubeLatestVideo(settings) };');
  }
  return text;
});

for (const relative of [
  "src/services/native-plugin-additions.cjs",
  "src/services/plugin-registry.cjs",
  "src/services/action-executor.cjs"
]) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`Patch-Ergebnis fehlt: ${relative}`);
}

console.log("Native Plugin-Kompatibilität und Desktop-Aktionen ergänzt.");
