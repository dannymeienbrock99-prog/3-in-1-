"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const INSTALL_ROOTS = [
  "%LOCALAPPDATA%\\TikTok LIVE Studio",
  "%PROGRAMFILES%\\TikTok LIVE Studio",
  "%PROGRAMFILES(X86)%\\TikTok LIVE Studio"
];

const DEFAULT_CANDIDATES = [
  ...INSTALL_ROOTS.map((root) => `${root}\\TikTok LIVE Studio.exe`),
  ...INSTALL_ROOTS.map((root) => `${root}\\TikTok LIVE Studio Launcher.exe`)
];

function expandEnvironment(input) {
  return String(input || "").replace(/%([^%]+)%/g, (_match, name) => process.env[name] || process.env[name.toUpperCase()] || "");
}

async function exists(filename) {
  try {
    const stat = await fs.stat(filename);
    return stat.isFile();
  } catch {
    return false;
  }
}

function versionParts(value) {
  return String(value || "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}

function compareVersionLikeDesc(a, b) {
  const av = versionParts(a);
  const bv = versionParts(b);
  const length = Math.max(av.length, bv.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (bv[index] || 0) - (av[index] || 0);
    if (diff) return diff;
  }
  return String(b).localeCompare(String(a));
}

async function findVersionedExecutable(root) {
  if (!root) return "";
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return "";
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionLikeDesc);

  const executableNames = ["TikTok LIVE Studio.exe", "TikTok LIVE Studio Launcher.exe"];
  for (const directory of directories) {
    for (const executableName of executableNames) {
      const candidate = path.join(root, directory, executableName);
      if (await exists(candidate)) return candidate;
    }
  }
  return "";
}

function spawnDetached(executablePath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(executablePath, [], {
        cwd: path.dirname(executablePath),
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.once("error", finishError);
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.removeListener("error", finishError);
      // Fehler nach erfolgreichem Spawn dürfen niemals als ungefangene
      // main-process Exception die komplette Batto-App beenden.
      child.on("error", () => {});
      child.unref();
      resolve();
    });
  });
}

async function startViaWindowsShell(executablePath) {
  await execFileAsync("cmd.exe", ["/d", "/s", "/c", "start", "", executablePath], {
    windowsHide: true,
    cwd: path.dirname(executablePath),
    timeout: 10000
  });
}

class TikTokLiveStudioService {
  constructor(options = {}) {
    this.configuredPath = String(options.executablePath || "").trim();
    this.lastDetectedPath = "";
    this.lastProcessCheck = null;
  }

  configure(options = {}) {
    this.configuredPath = String(options.executablePath || "").trim();
  }

  async detectExecutable() {
    const candidates = [];
    if (this.configuredPath) candidates.push(expandEnvironment(this.configuredPath));
    candidates.push(...DEFAULT_CANDIDATES.map(expandEnvironment));

    for (const candidate of [...new Set(candidates.filter(Boolean))]) {
      if (await exists(candidate)) {
        this.lastDetectedPath = path.resolve(candidate);
        return this.lastDetectedPath;
      }
    }

    for (const rawRoot of INSTALL_ROOTS) {
      const root = expandEnvironment(rawRoot);
      const nested = await findVersionedExecutable(root);
      if (nested) {
        this.lastDetectedPath = path.resolve(nested);
        return this.lastDetectedPath;
      }
    }

    this.lastDetectedPath = "";
    return "";
  }

  async isRunning() {
    if (process.platform !== "win32") {
      this.lastProcessCheck = { running: false, supported: false, checkedAt: Date.now() };
      return false;
    }

    try {
      const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024
      });
      const output = String(stdout || "");
      const running = /"TikTok LIVE Studio\.exe"/i.test(output);
      const launcherRunning = /"TikTok LIVE Studio Launcher\.exe"/i.test(output);
      this.lastProcessCheck = {
        running,
        launcherRunning,
        supported: true,
        checkedAt: Date.now()
      };
      return running;
    } catch (error) {
      this.lastProcessCheck = {
        running: false,
        supported: true,
        checkedAt: Date.now(),
        error: String(error?.message || error)
      };
      return false;
    }
  }

  async status() {
    const executablePath = await this.detectExecutable();
    const running = await this.isRunning();
    return {
      available: Boolean(executablePath),
      installed: Boolean(executablePath),
      running,
      executablePath,
      integrationMode: executablePath ? "live-studio" : "api-fallback",
      process: this.lastProcessCheck
    };
  }

  async launch() {
    const executablePath = await this.detectExecutable();
    if (!executablePath) throw new Error("TikTok LIVE Studio wurde nicht gefunden. Installationspfad in den Einstellungen prüfen.");

    if (await this.isRunning()) {
      return { launched: false, alreadyRunning: true, executablePath };
    }

    try {
      await spawnDetached(executablePath);
      return { launched: true, alreadyRunning: false, executablePath, method: "spawn" };
    } catch (error) {
      if (process.platform === "win32" && ["EACCES", "EPERM"].includes(String(error?.code || ""))) {
        try {
          await startViaWindowsShell(executablePath);
          return { launched: true, alreadyRunning: false, executablePath, method: "windows-shell" };
        } catch (shellError) {
          throw new Error(`TikTok LIVE Studio konnte nicht gestartet werden (${error.code}). Bitte LIVE Studio einmal direkt als Windows-Benutzer starten. ${String(shellError?.message || shellError)}`);
        }
      }
      throw new Error(`TikTok LIVE Studio konnte nicht gestartet werden: ${String(error?.message || error)}`);
    }
  }
}

module.exports = {
  TikTokLiveStudioService,
  DEFAULT_CANDIDATES,
  INSTALL_ROOTS,
  expandEnvironment,
  findVersionedExecutable,
  compareVersionLikeDesc,
  spawnDetached
};
