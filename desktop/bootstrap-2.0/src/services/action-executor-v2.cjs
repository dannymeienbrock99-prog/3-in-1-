"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { shell } = require("electron");
const { delay, normalizeError } = require("./runtime-utils-v2.cjs");

const execFileAsync = promisify(execFile);

function powershell(script, timeout = 20_000) {
  return execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024
  });
}

function psQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function mediaKeyScript(key) {
  const mapping = {
    playpause: 0xB3,
    next: 0xB0,
    previous: 0xB1,
    stop: 0xB2,
    mute: 0xAD,
    volumeup: 0xAF,
    volumedown: 0xAE
  };
  const code = mapping[String(key || "").toLowerCase()];
  if (!code) throw new Error("Unbekannte Medientaste");
  return `$signature='[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';Add-Type -MemberDefinition $signature -Name Native -Namespace Batto;[Batto.Native]::keybd_event(${code},0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40;[Batto.Native]::keybd_event(${code},0,2,[UIntPtr]::Zero)`;
}

function hotkeyScript(keys) {
  const tokens = Array.isArray(keys) ? keys : String(keys || "").split(/[+,\s]+/).filter(Boolean);
  const normalized = tokens.map((entry) => String(entry).trim().toUpperCase());
  if (!normalized.length) throw new Error("Tastenkombination fehlt");
  const special = { CTRL: "^", CONTROL: "^", ALT: "%", SHIFT: "+", WIN: "#", WINDOWS: "#" };
  const modifiers = normalized.filter((key) => special[key]).map((key) => special[key]).join("");
  const keysOnly = normalized.filter((key) => !special[key]);
  const target = keysOnly.length === 1 && keysOnly[0].length === 1 ? keysOnly[0].toLowerCase() : `{${keysOnly.join("+")}}`;
  return `$ws=New-Object -ComObject WScript.Shell;Start-Sleep -Milliseconds 80;$ws.SendKeys(${psQuote(modifiers + target)})`;
}

function findKnownProgram(names) {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean);
  for (const root of roots) {
    for (const relative of names) {
      const candidate = path.join(root, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

class ActionExecutor {
  constructor({ obs, streamOverlay, multiChat, holo, pluginRegistry, stateProvider, logger = console } = {}) {
    this.obs = obs;
    this.streamOverlay = streamOverlay;
    this.multiChat = multiChat;
    this.holo = holo;
    this.pluginRegistry = pluginRegistry;
    this.stateProvider = stateProvider;
    this.logger = logger;
  }

  async executeMany(actions, context = {}) {
    const results = [];
    for (const action of Array.isArray(actions) ? actions : []) {
      if (action.delayMs) await delay(action.delayMs);
      try {
        const result = await this.execute(action, context);
        results.push({ ok: true, type: action.type, result });
      } catch (error) {
        const failure = { ok: false, type: action.type, error: normalizeError(error) };
        results.push(failure);
        if (action.continueOnError !== true) break;
      }
    }
    return results;
  }

  async execute(action = {}, context = {}) {
    const type = String(action.type || "delay");
    switch (type) {
      case "delay":
        await delay(action.ms ?? action.durationMs ?? 0);
        return { waitedMs: Number(action.ms ?? action.durationMs ?? 0) || 0 };
      case "system.launch": {
        const target = String(action.path || action.command || action.target || "").trim();
        if (!target) throw new Error("Programm- oder Dateipfad fehlt");
        if (/^https?:\/\//i.test(target)) { await shell.openExternal(target); return { opened: target }; }
        if (!fs.existsSync(target) && !/^[a-z0-9_.-]+\.exe$/i.test(target)) throw new Error(`Datei nicht gefunden: ${target}`);
        const child = spawn(target, Array.isArray(action.arguments) ? action.arguments.map(String) : [], { detached: true, windowsHide: false, shell: false });
        child.unref();
        return { started: target };
      }
      case "system.openUrl": {
        const url = String(action.url || action.target || "").trim();
        if (!/^https?:\/\//i.test(url)) throw new Error("Gültige HTTPS- oder HTTP-Adresse erforderlich");
        await shell.openExternal(url); return { opened: url };
      }
      case "system.hotkey":
        await powershell(hotkeyScript(action.keys || action.hotkey)); return { sent: action.keys || action.hotkey };
      case "system.media":
      case "spotify.media":
        await powershell(mediaKeyScript(action.command || action.key || "playpause")); return { command: action.command || action.key || "playpause" };
      case "system.volume": {
        const command = String(action.command || "mute").toLowerCase();
        if (["mute", "volumeup", "volumedown"].includes(command)) {
          await powershell(mediaKeyScript(command)); return { command };
        }
        const value = Math.max(0, Math.min(100, Math.round(Number(action.value))));
        if (!Number.isFinite(value)) throw new Error("Lautstärkewert fehlt");
        const script = `$code='using System.Runtime.InteropServices; public class Audio { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }';Add-Type $code;1..50|%{[Audio]::keybd_event(0xAE,0,0,[UIntPtr]::Zero);[Audio]::keybd_event(0xAE,0,2,[UIntPtr]::Zero)};1..${Math.round(value / 2)}|%{[Audio]::keybd_event(0xAF,0,0,[UIntPtr]::Zero);[Audio]::keybd_event(0xAF,0,2,[UIntPtr]::Zero)}`;
        await powershell(script); return { value };
      }
      case "obs.scene":
        return this.requireObs("SetCurrentProgramScene", { sceneName: action.sceneName || action.scene });
      case "obs.source.toggle": {
        const sceneName = action.sceneName || action.scene || this.stateProvider?.()?.obs?.currentScene;
        const sourceName = action.sourceName || action.source;
        if (!sceneName || !sourceName) throw new Error("OBS-Szene und Quelle erforderlich");
        const list = await this.requireObs("GetSceneItemList", { sceneName });
        const item = (list.sceneItems || []).find((entry) => entry.sourceName === sourceName || entry.inputKind === sourceName);
        if (!item) throw new Error(`OBS-Quelle nicht gefunden: ${sourceName}`);
        const current = await this.requireObs("GetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId });
        return this.requireObs("SetSceneItemEnabled", { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: !current.sceneItemEnabled });
      }
      case "obs.mute": {
        const inputName = action.inputName || action.sourceName || action.source;
        if (!inputName) throw new Error("OBS-Audioquelle fehlt");
        return this.requireObs("ToggleInputMute", { inputName });
      }
      case "obs.stream.toggle": return this.requireObs("ToggleStream", {});
      case "obs.record.toggle": return this.requireObs("ToggleRecord", {});
      case "obs.virtualCam.toggle": return this.requireObs("ToggleVirtualCam", {});
      case "overlay.event":
        if (!this.streamOverlay?.emitEvent) throw new Error("Stream-Overlay nicht aktiv");
        return this.streamOverlay.emitEvent(action.payload || action);
      case "overlay.wheel":
        if (!this.streamOverlay?.emitEvent) throw new Error("Stream-Overlay nicht aktiv");
        return this.streamOverlay.emitEvent({ type: "wheel", ...action });
      case "multichat.send":
        if (!this.multiChat?.sendMessage) throw new Error("Multi-Chat nicht aktiv");
        return this.multiChat.sendMessage(action.text || action.message, action.platform || "twitch");
      case "tts.speak":
        if (!this.multiChat?.speak) throw new Error("Text-to-Speech nicht aktiv");
        return this.multiChat.speak(action.text || action.message || "");
      case "discord.open": {
        const executable = findKnownProgram(["Discord\\Update.exe", "DiscordCanary\\Update.exe", "DiscordPTB\\Update.exe"]);
        if (executable) {
          const child = spawn(executable, ["--processStart", "Discord.exe"], { detached: true, windowsHide: false }); child.unref(); return { started: executable };
        }
        await shell.openExternal("https://discord.com/app"); return { opened: "https://discord.com/app" };
      }
      case "youtube.open": {
        const url = action.url || action.channelUrl || "https://studio.youtube.com/";
        await shell.openExternal(url); return { opened: url };
      }
      case "youtube.refresh":
        if (!this.multiChat?.refreshYouTube) throw new Error("YouTube-Verbindung nicht aktiv");
        return this.multiChat.refreshYouTube();
      case "tiktok.open": return this.launchKnown("TikTok LIVE Studio", ["TikTok LIVE Studio\\TikTok LIVE Studio.exe", "TikTok LIVE Studio\\TikTokLiveStudio.exe"]);
      case "tikfinity.open": return this.launchKnown("TikFinity", ["TikFinity\\TikFinity.exe", "Programs\\tikfinity\\TikFinity.exe"]);
      case "obsbot.open": return this.launchKnown("OBSBOT Center", ["OBSBOT Center\\OBSBOT Center.exe", "OBSBOT Center\\OBSBOT_Center.exe"]);
      case "plugin.action": {
        if (!this.pluginRegistry?.executeAction) throw new Error("Plugin-Laufzeit nicht verfügbar");
        return this.pluginRegistry.executeAction(action.pluginId, action.actionId, action.settings || action.payload || {}, context);
      }
      default: throw new Error(`Aktion wird nicht unterstützt: ${type}`);
    }
  }

  async launchKnown(label, relativePaths) {
    const executable = findKnownProgram(relativePaths);
    if (!executable) throw new Error(`${label} wurde nicht gefunden`);
    const child = spawn(executable, [], { detached: true, windowsHide: false, shell: false }); child.unref();
    return { started: executable };
  }

  async requireObs(requestType, requestData) {
    if (!this.obs?.connected) throw new Error("OBS ist nicht verbunden");
    return this.obs.call(requestType, requestData || {});
  }
}

module.exports = { ActionExecutor };
