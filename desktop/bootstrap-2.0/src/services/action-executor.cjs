"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { EventEmitter } = require("node:events");
const { readJson, safeText, writeJsonAtomic } = require("./common.cjs");

const execFile = promisify(childProcess.execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));

function powershellEncoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script, timeout = 15000) {
  const { stdout, stderr } = await execFile(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", powershellEncoded(script)],
    { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }
  );
  return { stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
}

const MEDIA_KEYS = Object.freeze({
  "media.playpause": 0xB3,
  "media.stop": 0xB2,
  "media.next": 0xB0,
  "media.previous": 0xB1,
  "media.volume.up": 0xAF,
  "media.volume.down": 0xAE,
  "media.mute": 0xAD
});

async function pressVirtualKey(code) {
  const key = Number(code);
  const script = `Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class BattoKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint flags, UIntPtr extra); }\n'@; [BattoKeys]::keybd_event(${key},0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [BattoKeys]::keybd_event(${key},0,2,[UIntPtr]::Zero)`;
  await runPowerShell(script, 5000);
}

function findExecutable(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return "";
}

function installedProgramCandidates(name) {
  const local = process.env.LOCALAPPDATA || "";
  const roaming = process.env.APPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const known = {
    discord: [
      path.join(local, "Discord", "Update.exe"),
      path.join(local, "DiscordCanary", "Update.exe")
    ],
    obsbot: [
      path.join(programFiles, "OBSBOT Center", "OBSBOT Center.exe"),
      path.join(programFilesX86, "OBSBOT Center", "OBSBOT Center.exe")
    ],
    tiktok: [
      path.join(local, "Programs", "TikTok LIVE Studio", "TikTok LIVE Studio.exe"),
      path.join(programFiles, "TikTok LIVE Studio", "TikTok LIVE Studio.exe")
    ],
    spotify: [
      path.join(roaming, "Spotify", "Spotify.exe"),
      path.join(local, "Microsoft", "WindowsApps", "Spotify.exe")
    ],
    icue: [
      path.join(programFiles, "Corsair", "Corsair iCUE5 Software", "iCUE.exe"),
      path.join(programFiles, "Corsair", "CORSAIR iCUE 4 Software", "iCUE.exe")
    ],
    bambulab: [
      path.join(programFiles, "Bambu Studio", "bambu-studio.exe"),
      path.join(local, "Programs", "Bambu Studio", "bambu-studio.exe")
    ],
    youtubeMusic: [
      path.join(local, "Programs", "YouTube Music Desktop App", "YouTube Music Desktop App.exe"),
      path.join(local, "Programs", "YouTube Music", "YouTube Music.exe"),
      path.join(roaming, "YouTube Music", "YouTube Music.exe")
    ]
  };
  return findExecutable(known[name] || []);
}

function launchDetached(executable, args = []) {
  childProcess.spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return { executable, args };
}

function validateHttpUrl(value, allowedHosts = []) {
  const url = new URL(String(value || ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error("Nur HTTP- oder HTTPS-Adressen sind erlaubt.");
  if (allowedHosts.length && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("Die Webadresse gehört nicht zum erlaubten Dienst.");
  }
  return url.toString();
}

class ActionExecutor extends EventEmitter {
  constructor({ obs, shell, overlayServer, multiChat, dataFile } = {}) {
    super();
    this.obs = obs;
    this.shell = shell;
    this.overlayServer = overlayServer;
    this.multiChat = multiChat;
    this.dataFile = dataFile;
    this.data = readJson(dataFile, { giveaway: [], lastWinner: null }) || { giveaway: [], lastWinner: null };
  }

  persist() {
    if (this.dataFile) writeJsonAtomic(this.dataFile, this.data);
  }

  async executeMany(actions = [], context = {}) {
    const results = [];
    for (const action of Array.isArray(actions) ? actions : []) {
      if (action?.delayMs) await sleep(action.delayMs);
      results.push(await this.execute(action, context));
    }
    return results;
  }

  async execute(action = {}, context = {}) {
    const type = safeText(action.type || action.action || "none", 160);
    const settings = action.settings && typeof action.settings === "object" ? action.settings : {};
    const startedAt = Date.now();
    try {
      const value = await this._execute(type, settings, context);
      const result = { ok: true, type, value, startedAt, finishedAt: Date.now() };
      this.emit("executed", result);
      return result;
    } catch (error) {
      const result = { ok: false, type, error: String(error?.message || error), startedAt, finishedAt: Date.now() };
      this.emit("failed", result);
      throw Object.assign(new Error(result.error), { actionResult: result });
    }
  }

  async _execute(type, settings, context) {
    if (!type || type === "none") return { skipped: true };
    if (MEDIA_KEYS[type]) {
      await pressVirtualKey(MEDIA_KEYS[type]);
      return { key: MEDIA_KEYS[type] };
    }

    switch (type) {
      case "obs.scene":
        return this.obs.setScene(settings.sceneName);
      case "obs.source.toggle": {
        const sceneName = settings.sceneName || context.sceneName;
        if (!sceneName) throw new Error("OBS-Szene fehlt.");
        let sceneItemId = Number(settings.sceneItemId);
        if (!Number.isFinite(sceneItemId) && settings.sourceName) {
          const response = await this.obs.call("GetSceneItemId", { sceneName, sourceName: settings.sourceName, searchOffset: 0 });
          sceneItemId = response.sceneItemId;
        }
        if (!Number.isFinite(sceneItemId)) throw new Error("OBS-Quellen-ID fehlt.");
        const current = await this.obs.call("GetSceneItemEnabled", { sceneName, sceneItemId });
        return this.obs.setSceneItemEnabled(sceneName, sceneItemId, !current.sceneItemEnabled);
      }
      case "obs.input.mute":
        return settings.toggle !== false
          ? this.obs.toggleInputMute(settings.inputName)
          : this.obs.setInputMute(settings.inputName, settings.muted);
      case "obs.input.volume":
        return this.obs.setInputVolume(settings.inputName, Number(settings.volumeMul ?? settings.volume ?? 1));
      case "obs.stream.toggle":
        return this.obs.toggleStream();
      case "obs.record.toggle":
        return this.obs.toggleRecord();
      case "obs.virtualcam.toggle":
        return this.obs.toggleVirtualCam();

      case "system.launch": {
        const target = String(settings.path || settings.target || "").trim();
        if (!target) throw new Error("Programm- oder Dateipfad fehlt.");
        const error = await this.shell.openPath(target);
        if (error) throw new Error(error);
        return { target };
      }
      case "system.url": {
        const target = validateHttpUrl(settings.url || settings.target);
        await this.shell.openExternal(target);
        return { target };
      }
      case "system.command": {
        const file = String(settings.file || "").trim();
        const args = Array.isArray(settings.args) ? settings.args.map(String) : [];
        if (!file) throw new Error("Ausführbare Datei fehlt.");
        const result = await execFile(file, args, {
          windowsHide: true,
          timeout: Math.max(1000, Math.min(120000, Number(settings.timeoutMs) || 15000)),
          maxBuffer: 4 * 1024 * 1024
        });
        return { stdout: safeText(result.stdout, 4000), stderr: safeText(result.stderr, 4000) };
      }
      case "system.hotkey":
        return this.executeHotkey(settings.keys);

      case "volume.mixer":
      case "discord.volume.mixer":
        return launchDetached("sndvol.exe");
      case "spotify.launch": {
        const executable = installedProgramCandidates("spotify");
        if (executable) return launchDetached(executable);
        await this.shell.openExternal("spotify:");
        return { executable: "spotify:" };
      }
      case "discord.launch": {
        const executable = installedProgramCandidates("discord");
        if (executable) return launchDetached(executable, ["--processStart", "Discord.exe"]);
        await this.shell.openExternal("discord://");
        return { executable: "discord://" };
      }
      case "discord.webhook": {
        const target = validateHttpUrl(settings.webhookUrl, ["discord.com", "discordapp.com"]);
        const url = new URL(target);
        if (!url.pathname.startsWith("/api/webhooks/")) throw new Error("Ungültige Discord-Webhook-Adresse.");
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: safeText(settings.message, 1900) })
        });
        if (!response.ok) throw new Error(`Discord-Webhook meldet HTTP ${response.status}.`);
        return { status: response.status };
      }

      case "icue.launch":
      case "icue.profile": {
        const executable = installedProgramCandidates("icue");
        if (!executable) throw new Error("Corsair iCUE wurde nicht gefunden.");
        const args = type === "icue.profile" && settings.profile ? ["--profile", String(settings.profile)] : [];
        return launchDetached(executable, args);
      }
      case "bambulab.launch":
      case "bambulab.monitor": {
        const executable = installedProgramCandidates("bambulab");
        if (!executable) throw new Error("Bambu Studio wurde nicht gefunden. Ein Druckerstatus wird ohne lokale Bambu-Verbindung nicht vorgetäuscht.");
        return launchDetached(executable);
      }
      case "obsbot.center":
      case "obsbot.camera.select":
      case "obsbot.camera.settings":
      case "obsbot.camera.reset": {
        if (settings.keys) return this.executeHotkey(settings.keys);
        const executable = installedProgramCandidates("obsbot");
        if (!executable) throw new Error("OBSBOT Center oder eine unterstützte OBSBOT-Kamera wurde nicht gefunden.");
        return launchDetached(executable);
      }
      case "tiktok.live-studio.launch": {
        const executable = installedProgramCandidates("tiktok");
        if (!executable) throw new Error("TikTok LIVE Studio wurde nicht gefunden.");
        return launchDetached(executable);
      }

      case "tiktok.event":
      case "tikfinity.webhook":
        return this.publishOverlayEvent({
          type: settings.eventType || "tiktok",
          platform: settings.platform || (type.startsWith("tikfinity") ? "tikfinity" : "tiktok"),
          name: safeText(settings.name || context.name || "Zuschauer", 120),
          text: safeText(settings.text || settings.gift || "Ereignis", 500),
          value: Number(settings.value) || 0,
          timestamp: Date.now()
        });
      case "overlay.poll":
      case "overlay.wordcloud":
      case "overlay.wheel":
        return this.publishOverlayEvent({ type: type.split(".")[1], ...settings, timestamp: Date.now() });

      case "youtube.dashboard":
        await this.shell.openExternal("https://studio.youtube.com/");
        return { opened: true };
      case "youtube.channel": {
        const channel = String(settings.channelUrl || settings.channelId || "").trim();
        const target = /^https?:\/\//i.test(channel)
          ? validateHttpUrl(channel, ["youtube.com", "youtu.be"])
          : `https://www.youtube.com/channel/${encodeURIComponent(channel)}`;
        await this.shell.openExternal(target);
        return { url: target };
      }
      case "youtube.latest": {
        const videoId = await this.youtubeLatestVideo(settings);
        const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        await this.shell.openExternal(target);
        return { videoId, url: target };
      }
      case "youtube.refresh":
      case "youtube.ticker.status":
        return { videoId: await this.youtubeLatestVideo(settings) };
      case "youtube.viewer.count":
        return this.youtubeViewerCount(settings);
      case "youtube.chat.send":
        return this.youtubeSendChat(settings);
      case "youtube.stream.start":
        return this.youtubeTransition(settings, "live");
      case "youtube.stream.stop":
        return this.youtubeTransition(settings, "complete");
      case "youtube.ad.start":
        return this.youtubeCueAd(settings);
      case "youtube.ad.pause":
      case "youtube.ad.resume":
      case "youtube.ad.enable":
      case "youtube.ad.disable":
        throw new Error("Diese YouTube-Werbeaktion wird von der verwendeten YouTube-API nicht als zuverlässiger Schalter angeboten. Es wird kein Erfolg vorgetäuscht.");

      case "youtube.music.open": {
        const executable = installedProgramCandidates("youtubeMusic");
        if (executable) return launchDetached(executable);
        await this.shell.openExternal("https://music.youtube.com/");
        return { executable: "https://music.youtube.com/" };
      }
      case "youtube.music.playlist": {
        const target = validateHttpUrl(settings.url || settings.playlistUrl, ["music.youtube.com"]);
        await this.shell.openExternal(target);
        return { target };
      }
      case "youtube.music.like":
      case "youtube.music.dislike":
      case "youtube.music.shuffle":
      case "youtube.music.repeat":
      case "youtube.music.info":
        if (settings.keys) return this.executeHotkey(settings.keys);
        throw new Error("Diese YouTube-Music-App-Aktion benötigt einen im Aktionseditor konfigurierten Desktop-App-Hotkey. Ohne passende Laufzeit wird kein Erfolg gemeldet.");

      case "giveaway.add": {
        const name = safeText(settings.name || context.name, 120).trim();
        if (!name) throw new Error("Teilnehmername fehlt.");
        if (!this.data.giveaway.some((entry) => entry.toLowerCase() === name.toLowerCase())) this.data.giveaway.push(name);
        this.persist();
        return { participants: this.data.giveaway.length };
      }
      case "giveaway.draw": {
        if (!this.data.giveaway.length) throw new Error("Die Giveaway-Liste ist leer.");
        const winner = this.data.giveaway[Math.floor(Math.random() * this.data.giveaway.length)];
        this.data.lastWinner = { name: winner, timestamp: Date.now() };
        this.persist();
        this.overlayServer?.publishEvent({ type: "giveaway", name: winner, text: "Gewinner", timestamp: Date.now() });
        return this.data.lastWinner;
      }
      default:
        throw new Error(`Aktion „${type}“ wird ohne passende Laufzeit nicht ausgeführt.`);
    }
  }

  async executeHotkey(keysValue) {
    const keys = Array.isArray(keysValue) ? keysValue : String(keysValue || "").split("+");
    const map = {
      CTRL: 0x11, CONTROL: 0x11, ALT: 0x12, SHIFT: 0x10, WIN: 0x5B, WINDOWS: 0x5B,
      ENTER: 0x0D, ESC: 0x1B, ESCAPE: 0x1B, SPACE: 0x20, TAB: 0x09
    };
    const codes = keys.filter(Boolean).map((key) => {
      const text = String(key).trim().toUpperCase();
      if (map[text]) return map[text];
      if (/^[A-Z0-9]$/.test(text)) return text.charCodeAt(0);
      if (/^F(?:[1-9]|1[0-2])$/.test(text)) return 0x70 + Number(text.slice(1)) - 1;
      throw new Error(`Unbekannte Taste: ${text}`);
    });
    if (!codes.length) throw new Error("Tastenkombination fehlt.");
    const down = codes.map((code) => `[BattoKeys]::keybd_event(${code},0,0,[UIntPtr]::Zero);`).join(" ");
    const up = [...codes].reverse().map((code) => `[BattoKeys]::keybd_event(${code},0,2,[UIntPtr]::Zero);`).join(" ");
    await runPowerShell(`Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class BattoKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint flags, UIntPtr extra); }\n'@; ${down} Start-Sleep -Milliseconds 50; ${up}`, 5000);
    return { keys };
  }

  publishOverlayEvent(event) {
    if (!this.overlayServer) throw new Error("Stream-Overlay ist nicht aktiv.");
    return this.overlayServer.publishEvent(event);
  }

  async youtubeLatestVideo(settings = {}) {
    const apiKey = String(settings.apiKey || "").trim();
    const channelId = String(settings.channelId || "").trim();
    if (!apiKey || !channelId) throw new Error("YouTube-API-Schlüssel und Kanal-ID werden benötigt.");
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("channelId", channelId);
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("type", "video");
    url.searchParams.set("key", apiKey);
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `YouTube API HTTP ${response.status}`);
    const videoId = body?.items?.[0]?.id?.videoId;
    if (!videoId) throw new Error("Kein Video für diesen Kanal gefunden.");
    return videoId;
  }

  async youtubeViewerCount(settings = {}) {
    const apiKey = String(settings.apiKey || "").trim();
    const videoId = String(settings.videoId || "").trim();
    if (!apiKey || !videoId) throw new Error("YouTube-API-Schlüssel und Video-ID werden benötigt.");
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `YouTube API HTTP ${response.status}`);
    const viewers = Number(body?.items?.[0]?.liveStreamingDetails?.concurrentViewers);
    if (!Number.isFinite(viewers)) throw new Error("YouTube meldet für dieses Video keine aktuelle Zuschauerzahl.");
    return { viewers, videoId };
  }

  async youtubeAuthorizedRequest(settings, url, options = {}) {
    const accessToken = String(settings.accessToken || settings.oauthToken || "").trim();
    if (!accessToken) throw new Error("Für diese YouTube-Aktion wird eine OAuth-Anmeldung mit passender Berechtigung benötigt.");
    const response = await fetch(url, {
      ...options,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
    if (!response.ok) throw new Error(body?.error?.message || `YouTube API HTTP ${response.status}`);
    return body;
  }

  async youtubeSendChat(settings = {}) {
    const liveChatId = String(settings.liveChatId || "").trim();
    const messageText = safeText(settings.message || settings.text, 200).trim();
    if (!liveChatId || !messageText) throw new Error("YouTube-Live-Chat-ID und Nachricht werden benötigt.");
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("part", "snippet");
    return this.youtubeAuthorizedRequest(settings, url, {
      method: "POST",
      body: JSON.stringify({ snippet: { liveChatId, type: "textMessageEvent", textMessageDetails: { messageText } } })
    });
  }

  async youtubeTransition(settings = {}, status) {
    const broadcastId = String(settings.broadcastId || "").trim();
    if (!broadcastId) throw new Error("YouTube-Broadcast-ID fehlt.");
    const url = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts/transition");
    url.searchParams.set("part", "status");
    url.searchParams.set("id", broadcastId);
    url.searchParams.set("broadcastStatus", status);
    return this.youtubeAuthorizedRequest(settings, url, { method: "POST", body: "{}" });
  }

  async youtubeCueAd(settings = {}) {
    const broadcastId = String(settings.broadcastId || "").trim();
    if (!broadcastId) throw new Error("YouTube-Broadcast-ID fehlt.");
    const url = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts/cuepoint");
    url.searchParams.set("part", "id");
    url.searchParams.set("id", broadcastId);
    return this.youtubeAuthorizedRequest(settings, url, {
      method: "POST",
      body: JSON.stringify({ cueType: "cueTypeAd", durationSecs: Math.max(15, Math.min(180, Number(settings.durationSecs) || 30)) })
    });
  }
}

module.exports = {
  ActionExecutor,
  MEDIA_KEYS,
  installedProgramCandidates,
  pressVirtualKey,
  runPowerShell,
  validateHttpUrl
};
