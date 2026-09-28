"use strict";

const path = require("node:path");
const { BrowserWindow, screen } = require("electron");

class ChatWindowManager {
  constructor({ mainWindow, userDataFile, broadcast } = {}) {
    this.mainWindow = mainWindow;
    this.userDataFile = userDataFile;
    this.broadcast = broadcast || (() => {});
    this.window = null;
    this.settings = { undocked: false, x: null, y: null, width: 560, height: 760, alwaysOnTop: false };
  }

  async loadSettings() {
    try {
      const fs = require("node:fs/promises");
      this.settings = { ...this.settings, ...JSON.parse(await fs.readFile(this.userDataFile, "utf8")) };
    } catch {}
    return this.settings;
  }

  async saveSettings() {
    try {
      const fs = require("node:fs/promises");
      await fs.mkdir(path.dirname(this.userDataFile), { recursive: true });
      await fs.writeFile(this.userDataFile, JSON.stringify(this.settings, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("Multi-Chat-Fensterposition konnte nicht gespeichert werden:", error);
    }
  }

  create() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return this.window;
    }
    const display = screen.getAllDisplays().find((item) => item.bounds.x !== 0 || item.bounds.y !== 0) || screen.getPrimaryDisplay();
    const bounds = display.workArea;
    const x = Number.isFinite(this.settings.x) ? this.settings.x : bounds.x + Math.max(0, Math.round((bounds.width - this.settings.width) / 2));
    const y = Number.isFinite(this.settings.y) ? this.settings.y : bounds.y + Math.max(0, Math.round((bounds.height - this.settings.height) / 2));
    this.window = new BrowserWindow({
      title: "Batto Multi-Chat",
      width: this.settings.width,
      height: this.settings.height,
      minWidth: 420,
      minHeight: 520,
      x, y,
      backgroundColor: "#070b12",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "..", "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    this.window.loadFile(path.join(__dirname, "..", "renderer", "multi-chat.html"));
    this.window.once("ready-to-show", () => this.window?.show());
    this.window.on("move", () => this.captureBounds());
    this.window.on("resize", () => this.captureBounds());
    this.window.on("closed", async () => {
      this.captureBounds();
      this.window = null;
      this.settings.undocked = false;
      await this.saveSettings();
      this.broadcast({ type: "window", undocked: false });
    });
    this.settings.undocked = true;
    this.saveSettings();
    this.broadcast({ type: "window", undocked: true });
    return this.window;
  }

  captureBounds() {
    if (!this.window || this.window.isDestroyed()) return;
    const b = this.window.getBounds();
    this.settings = { ...this.settings, x: b.x, y: b.y, width: b.width, height: b.height };
    void this.saveSettings();
  }

  dock() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this.settings.undocked = false;
    void this.saveSettings();
    this.broadcast({ type: "window", undocked: false });
    this.mainWindow?.show();
    this.mainWindow?.focus();
  }

  toggle() { return this.window && !this.window.isDestroyed() ? this.dock() : this.create(); }
  isUndocked() { return Boolean(this.window && !this.window.isDestroyed()); }

  setAlwaysOnTop(value) {
    this.settings.alwaysOnTop = Boolean(value);
    this.window?.setAlwaysOnTop(this.settings.alwaysOnTop);
    void this.saveSettings();
    return { alwaysOnTop: this.settings.alwaysOnTop };
  }

  status() { return { ...this.settings, undocked: this.isUndocked(), windowId: this.window?.id || null }; }
}

module.exports = { ChatWindowManager };
