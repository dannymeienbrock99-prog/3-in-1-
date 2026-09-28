"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { clone, ensureDir, normalizeError, readJson } = require("./runtime-utils-v2.cjs");

function copyMissing(source, destination, report, category) {
  if (!source || !fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    ensureDir(destination);
    for (const entry of fs.readdirSync(source)) copyMissing(path.join(source, entry), path.join(destination, entry), report, category);
    return;
  }
  if (fs.existsSync(destination)) {
    report.skipped.push({ category, source, destination, reason: "Zieldatei existiert bereits" });
    return;
  }
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  report.copied.push({ category, source, destination });
}

function normalizeLegacyButton(value) {
  if (!value || typeof value !== "object") return null;
  const title = value.title || value.name || value.label || "";
  const color = /^#[0-9a-f]{6}$/i.test(String(value.color || value.backgroundColor || "")) ? value.color || value.backgroundColor : "#182536";
  let actions = [];
  const sourceActions = value.actions || value.multiActions || (value.action ? [value.action] : value.type ? [value] : []);
  if (Array.isArray(sourceActions)) {
    actions = sourceActions.map((action) => {
      const rawType = String(action.type || action.action || action.id || "").toLowerCase();
      const mapping = {
        launch: "system.launch", open: "system.launch", url: "system.openUrl", website: "system.openUrl", hotkey: "system.hotkey",
        media: "system.media", obs_scene: "obs.scene", scene: "obs.scene", obs_mute: "obs.mute", mute: "obs.mute",
        stream: "obs.stream.toggle", record: "obs.record.toggle", virtualcam: "obs.virtualCam.toggle", delay: "delay"
      };
      return { ...action, type: mapping[rawType] || action.type || "plugin.action", delayMs: Number(action.delayMs || action.delay || 0) || 0 };
    });
  }
  return {
    title: String(title).slice(0, 120), subtitle: String(value.subtitle || value.description || "").slice(0, 160), color,
    textColor: /^#[0-9a-f]{6}$/i.test(String(value.textColor || "")) ? value.textColor : "#ffffff",
    icon: String(value.icon || value.image || "").slice(0, 20000), folderId: value.folderId || null, actions
  };
}

function convertLegacyProfiles(source) {
  const profilesSource = Array.isArray(source) ? source : source?.profiles || source?.decks || [];
  const profiles = profilesSource.map((profile, index) => {
    const rows = Math.max(1, Math.min(10, Number(profile.rows || profile.gridRows || 3)));
    const columns = Math.max(1, Math.min(10, Number(profile.columns || profile.gridColumns || 5)));
    const buttonsSource = profile.buttons || profile.keys || profile.actions || [];
    const buttons = Array.isArray(buttonsSource) ? buttonsSource.map(normalizeLegacyButton) : [];
    return {
      id: String(profile.id || `legacy-profile-${index + 1}`), name: String(profile.name || profile.title || `Import ${index + 1}`),
      rows, columns, buttonSize: Number(profile.buttonSize || 112), gap: Number(profile.gap || 10), hideUnused: Boolean(profile.hideUnused),
      buttons, folders: Array.isArray(profile.folders) ? clone(profile.folders) : []
    };
  });
  return profiles;
}

class LegacyMigration {
  constructor({ appData, programData, userData, deckManager, pluginDestination, iconDestination } = {}) {
    this.appData = appData;
    this.programData = programData;
    this.userData = userData;
    this.deckManager = deckManager;
    this.pluginDestination = pluginDestination;
    this.iconDestination = iconDestination;
    this.lastReport = null;
  }

  candidates(extraRoots = []) {
    const roots = [
      path.join(this.appData || "", "Creator Hub"),
      path.join(this.appData || "", "creator-hub"),
      path.join(this.appData || "", "CreatorHub"),
      path.join(this.programData || "", "Creator Hub"),
      path.join(this.programData || "", "CreatorHub"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Creator Hub"),
      path.join(process.env.ProgramFiles || "", "Creator Hub"),
      ...extraRoots
    ].filter(Boolean);
    return [...new Set(roots.map((entry) => path.resolve(entry)))].filter(fs.existsSync);
  }

  run(extraRoots = []) {
    const report = { startedAt: new Date().toISOString(), roots: this.candidates(extraRoots), copied: [], skipped: [], profiles: [], errors: [] };
    for (const root of report.roots) {
      try {
        const profileFiles = ["profiles.json", "decks.json", "deck-profiles.json", "config/profiles.json", "data/profiles.json"];
        for (const relative of profileFiles) {
          const sourcePath = path.join(root, relative);
          if (!fs.existsSync(sourcePath)) continue;
          const source = readJson(sourcePath, null);
          const profiles = convertLegacyProfiles(source);
          for (const profile of profiles) {
            if (this.deckManager.data.profiles.some((current) => current.id === profile.id || current.name.toLowerCase() === profile.name.toLowerCase())) {
              report.skipped.push({ category: "profile", source: sourcePath, reason: `Profil bereits vorhanden: ${profile.name}` });
              continue;
            }
            this.deckManager.data.profiles.push(profile);
            report.profiles.push(profile.name);
          }
        }
        const pluginRoots = ["Plugins", "plugins", "StreamDeckPlugins", "resources/Plugins", "resources/plugins"];
        for (const relative of pluginRoots) copyMissing(path.join(root, relative), this.pluginDestination, report, "plugin");
        const iconRoots = ["IconPacks", "icon-packs", "Icons", "resources/IconPacks", "resources/icons"];
        for (const relative of iconRoots) copyMissing(path.join(root, relative), this.iconDestination, report, "icon-pack");
        const mobileCandidates = ["Creator-Hub-.apk", "Creator-Hub.apk", "resources/Creator-Hub-.apk", "mobile/Creator-Hub-.apk"];
        for (const relative of mobileCandidates) copyMissing(path.join(root, relative), path.join(this.userData, "LegacyMobile", path.basename(relative)), report, "mobile-apk");
        const overlayCandidates = ["overlay", "overlays", "resources/overlay", "resources/overlays"];
        for (const relative of overlayCandidates) copyMissing(path.join(root, relative), path.join(this.userData, "LegacyOverlayAssets", path.basename(relative)), report, "legacy-overlay-asset");
      } catch (error) { report.errors.push({ root, error: normalizeError(error) }); }
    }
    if (report.profiles.length) this.deckManager.save();
    report.completedAt = new Date().toISOString();
    this.lastReport = report;
    return clone(report);
  }

  snapshot() { return clone(this.lastReport || { completed: false, roots: this.candidates(), copied: [], skipped: [], profiles: [], errors: [] }); }
}

module.exports = { LegacyMigration, convertLegacyProfiles };
