"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { app, ipcMain } = require("electron");

const execFileAsync = promisify(execFile);
const MEDIA_KEYS = Object.freeze({ mute: 0xAD, volumeup: 0xAF, volumedown: 0xAE });
const SOURCE_COMMIT = "51be33d29c07f50323b19d58782804af391b8394";

function scriptFor(command) {
  const code = MEDIA_KEYS[String(command || "").toLowerCase()];
  if (!code) throw new Error("Nicht erlaubte Audio-Schnellaktion.");
  return `$signature='[DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';Add-Type -MemberDefinition $signature -Name Native -Namespace BattoQuickAudio;[BattoQuickAudio.Native]::keybd_event(${code},0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 40;[BattoQuickAudio.Native]::keybd_event(${code},0,2,[UIntPtr]::Zero)`;
}

async function execute(command) {
  await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", scriptFor(command)], { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 });
  return { ok: true, command: String(command || "").toLowerCase() };
}

function candidateTouchDeckPaths() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "touchdeck-0802", "CreatorHub.TouchDeck.exe"));
  candidates.push(path.join(__dirname, "..", "resources", "touchdeck-0802", "CreatorHub.TouchDeck.exe"));
  for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
    candidates.push(path.join(root, "CreatorHub TouchDeck", "CreatorHub.TouchDeck.exe"));
    candidates.push(path.join(root, "Creator Hub", "CreatorHub.TouchDeck.exe"));
    candidates.push(path.join(root, "CreatorHub", "CreatorHub.TouchDeck.exe"));
    candidates.push(path.join(root, "Programs", "CreatorHub TouchDeck", "CreatorHub.TouchDeck.exe"));
    candidates.push(path.join(root, "Programs", "Creator Hub", "CreatorHub.TouchDeck.exe"));
  }
  return [...new Set(candidates)];
}

function touchDeckExe() {
  return candidateTouchDeckPaths().find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || "";
}

function touchDeckStatus() {
  const exe = touchDeckExe();
  return {
    available: Boolean(exe),
    exe,
    sourceCommit: SOURCE_COMMIT,
    sourceDate: "02.08.2026",
    installRequired: !exe,
    component: "CreatorHub TouchDeck"
  };
}

async function launchOriginalTouchDeck() {
  const status = touchDeckStatus();
  if (!status.available) throw new Error("CreatorHub TouchDeck vom 02.08.2026 ist noch nicht installiert. Bitte die TouchDeck-Komponente aus dem Batto-Suite-Paket installieren.");
  const child = spawn(status.exe, [], { detached: true, stdio: "ignore", windowsHide: false, cwd: path.dirname(status.exe) });
  child.unref();
  return { ...status, launched: true };
}

ipcMain.handle("deck:quick-media", (_event, payload = {}) => execute(payload.command));
ipcMain.handle("deck:original-0802-status", () => touchDeckStatus());
ipcMain.handle("deck:open-original-0802", () => launchOriginalTouchDeck());

module.exports = { execute, scriptFor, touchDeckStatus, launchOriginalTouchDeck, candidateTouchDeckPaths };
