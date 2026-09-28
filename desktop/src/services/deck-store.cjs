"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { clampNumber, deepClone, randomId, readJson, safeText, writeJsonAtomic } = require("./common.cjs");

function normalizeAction(action = {}) {
  return {
    id: safeText(action.id || randomId("action"), 120),
    type: safeText(action.type || action.action || "none", 160),
    title: safeText(action.title || action.name || "", 200),
    settings: action.settings && typeof action.settings === "object" ? deepClone(action.settings) : {},
    delayMs: Math.round(clampNumber(action.delayMs, 0, 120_000, 0))
  };
}

function normalizeButton(button = {}, index = 0) {
  const actions = Array.isArray(button.actions)
    ? button.actions.map(normalizeAction)
    : button.action && typeof button.action === "object"
      ? [normalizeAction(button.action)]
      : [];
  return {
    id: safeText(button.id || `button-${index + 1}`, 120),
    title: safeText(button.title || button.name || "", 120),
    subtitle: safeText(button.subtitle || "", 160),
    icon: safeText(button.icon || button.image || "", 2_000_000),
    color: /^#[0-9a-f]{6}$/i.test(String(button.color || "")) ? String(button.color).toLowerCase() : "#152130",
    textColor: /^#[0-9a-f]{6}$/i.test(String(button.textColor || "")) ? String(button.textColor).toLowerCase() : "#ffffff",
    folderId: safeText(button.folderId || "", 120),
    actions,
    enabled: button.enabled !== false
  };
}

function normalizeFolder(folder = {}, index = 0, defaults = {}) {
  const rows = Math.round(clampNumber(folder.rows, 1, 10, defaults.rows || 3));
  const columns = Math.round(clampNumber(folder.columns, 1, 10, defaults.columns || 5));
  const capacity = rows * columns;
  const buttons = Array.isArray(folder.buttons) ? folder.buttons.slice(0, 100).map(normalizeButton) : [];
  while (buttons.length < capacity) buttons.push(normalizeButton({}, buttons.length));
  return {
    id: safeText(folder.id || (index === 0 ? "root" : randomId("folder")), 120),
    name: safeText(folder.name || (index === 0 ? "Hauptseite" : `Ordner ${index}`), 120),
    parentId: safeText(folder.parentId || "", 120),
    rows,
    columns,
    hideUnused: Boolean(folder.hideUnused),
    buttonSize: Math.round(clampNumber(folder.buttonSize, 64, 260, 116)),
    gap: Math.round(clampNumber(folder.gap, 0, 40, 12)),
    opacity: clampNumber(folder.opacity, 0.2, 1, 1),
    background: /^#[0-9a-f]{6}$/i.test(String(folder.background || "")) ? String(folder.background).toLowerCase() : "#090f18",
    buttons
  };
}

function normalizeProfile(profile = {}, index = 0) {
  const baseRows = Math.round(clampNumber(profile.rows, 1, 10, 3));
  const baseColumns = Math.round(clampNumber(profile.columns, 1, 10, 5));
  let folders = Array.isArray(profile.folders) ? profile.folders.map((folder, folderIndex) => normalizeFolder(folder, folderIndex, { rows: baseRows, columns: baseColumns })) : [];
  if (!folders.length) {
    const legacyButtons = Array.isArray(profile.buttons) ? profile.buttons : Array.isArray(profile.keys) ? profile.keys : [];
    folders = [normalizeFolder({ id: "root", name: "Hauptseite", rows: baseRows, columns: baseColumns, buttons: legacyButtons }, 0)];
  }
  if (!folders.some((folder) => folder.id === "root")) folders.unshift(normalizeFolder({ id: "root", name: "Hauptseite", rows: baseRows, columns: baseColumns }, 0));
  return {
    id: safeText(profile.id || randomId("profile"), 120),
    name: safeText(profile.name || `Profil ${index + 1}`, 120),
    description: safeText(profile.description || "", 300),
    activeFolderId: folders.some((folder) => folder.id === profile.activeFolderId) ? profile.activeFolderId : "root",
    folders
  };
}

function defaultState() {
  return {
    version: 2,
    activeProfileId: "default",
    profiles: [normalizeProfile({ id: "default", name: "Standard", rows: 3, columns: 5 }, 0)],
    updatedAt: Date.now()
  };
}

function normalizeState(value) {
  if (!value || typeof value !== "object") return defaultState();
  const rawProfiles = Array.isArray(value.profiles) ? value.profiles : [];
  const profiles = rawProfiles.length ? rawProfiles.map(normalizeProfile) : defaultState().profiles;
  const activeProfileId = profiles.some((profile) => profile.id === value.activeProfileId) ? value.activeProfileId : profiles[0].id;
  return { version: 2, activeProfileId, profiles, updatedAt: Number(value.updatedAt) || Date.now() };
}

class DeckStore {
  constructor(file) {
    this.file = file;
    this.state = normalizeState(readJson(file, null));
    this.save();
  }

  save() {
    this.state.updatedAt = Date.now();
    writeJsonAtomic(this.file, this.state);
    return this.snapshot();
  }

  snapshot() { return deepClone(this.state); }

  activeProfile() {
    return this.state.profiles.find((profile) => profile.id === this.state.activeProfileId) || this.state.profiles[0];
  }

  getProfile(profileId) {
    return this.state.profiles.find((profile) => profile.id === profileId) || null;
  }

  createProfile(name, templateProfileId = "") {
    const source = templateProfileId ? this.getProfile(templateProfileId) : null;
    const profile = source
      ? normalizeProfile({ ...deepClone(source), id: randomId("profile"), name: safeText(name || `${source.name} Kopie`, 120) })
      : normalizeProfile({ id: randomId("profile"), name: safeText(name || "Neues Profil", 120) });
    this.state.profiles.push(profile);
    this.state.activeProfileId = profile.id;
    return this.save();
  }

  updateProfile(profileId, patch = {}) {
    const index = this.state.profiles.findIndex((profile) => profile.id === profileId);
    if (index < 0) throw new Error("Profil wurde nicht gefunden.");
    const current = this.state.profiles[index];
    this.state.profiles[index] = normalizeProfile({ ...current, ...patch, id: current.id, folders: patch.folders || current.folders }, index);
    return this.save();
  }

  deleteProfile(profileId) {
    if (this.state.profiles.length <= 1) throw new Error("Das letzte Profil kann nicht gelöscht werden.");
    this.state.profiles = this.state.profiles.filter((profile) => profile.id !== profileId);
    if (this.state.activeProfileId === profileId) this.state.activeProfileId = this.state.profiles[0].id;
    return this.save();
  }

  activateProfile(profileId) {
    if (!this.getProfile(profileId)) throw new Error("Profil wurde nicht gefunden.");
    this.state.activeProfileId = profileId;
    return this.save();
  }

  createFolder(profileId, name, parentId = "root") {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error("Profil wurde nicht gefunden.");
    const parent = profile.folders.find((folder) => folder.id === parentId) || profile.folders[0];
    const folder = normalizeFolder({
      id: randomId("folder"), name: safeText(name || "Neuer Ordner", 120), parentId: parent.id,
      rows: parent.rows, columns: parent.columns, buttonSize: parent.buttonSize, gap: parent.gap
    }, profile.folders.length);
    profile.folders.push(folder);
    profile.activeFolderId = folder.id;
    return this.save();
  }

  deleteFolder(profileId, folderId) {
    if (folderId === "root") throw new Error("Die Hauptseite kann nicht gelöscht werden.");
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error("Profil wurde nicht gefunden.");
    profile.folders = profile.folders.filter((folder) => folder.id !== folderId);
    for (const folder of profile.folders) {
      for (const button of folder.buttons) if (button.folderId === folderId) button.folderId = "";
    }
    if (profile.activeFolderId === folderId) profile.activeFolderId = "root";
    return this.save();
  }

  updateFolder(profileId, folderId, patch = {}) {
    const profile = this.getProfile(profileId);
    const index = profile?.folders.findIndex((folder) => folder.id === folderId) ?? -1;
    if (!profile || index < 0) throw new Error("Ordner wurde nicht gefunden.");
    const current = profile.folders[index];
    const normalized = normalizeFolder({ ...current, ...patch, id: current.id, buttons: current.buttons }, index);
    const capacity = normalized.rows * normalized.columns;
    if (normalized.buttons.length < capacity) {
      while (normalized.buttons.length < capacity) normalized.buttons.push(normalizeButton({}, normalized.buttons.length));
    }
    profile.folders[index] = normalized;
    return this.save();
  }

  activateFolder(profileId, folderId) {
    const profile = this.getProfile(profileId);
    if (!profile?.folders.some((folder) => folder.id === folderId)) throw new Error("Ordner wurde nicht gefunden.");
    profile.activeFolderId = folderId;
    return this.save();
  }

  updateButton(profileId, folderId, buttonIndex, button) {
    const profile = this.getProfile(profileId);
    const folder = profile?.folders.find((item) => item.id === folderId);
    if (!folder) throw new Error("Ordner wurde nicht gefunden.");
    const index = Math.round(Number(buttonIndex));
    if (index < 0 || index >= 100) throw new Error("Ungültiger Tastenplatz.");
    while (folder.buttons.length <= index) folder.buttons.push(normalizeButton({}, folder.buttons.length));
    folder.buttons[index] = normalizeButton({ ...button, id: folder.buttons[index]?.id || button?.id }, index);
    return this.save();
  }

  moveButton(profileId, folderId, fromIndex, toIndex) {
    const profile = this.getProfile(profileId);
    const folder = profile?.folders.find((item) => item.id === folderId);
    if (!folder) throw new Error("Ordner wurde nicht gefunden.");
    const from = Math.round(Number(fromIndex));
    const to = Math.round(Number(toIndex));
    if (from < 0 || to < 0 || from >= folder.buttons.length || to >= folder.buttons.length) throw new Error("Ungültiger Tastenplatz.");
    [folder.buttons[from], folder.buttons[to]] = [folder.buttons[to], folder.buttons[from]];
    return this.save();
  }

  clearButton(profileId, folderId, buttonIndex) {
    return this.updateButton(profileId, folderId, buttonIndex, {});
  }

  exportTo(file) {
    fs.writeFileSync(file, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    return file;
  }

  importFrom(file, mode = "replace") {
    const imported = normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
    if (mode === "merge") {
      const existingIds = new Set(this.state.profiles.map((profile) => profile.id));
      for (const profile of imported.profiles) {
        if (existingIds.has(profile.id)) profile.id = randomId("profile");
        this.state.profiles.push(profile);
      }
    } else {
      this.state = imported;
    }
    return this.save();
  }

  mergeLegacy(value) {
    const imported = normalizeState(value);
    const existingNames = new Set(this.state.profiles.map((profile) => profile.name.toLowerCase()));
    let added = 0;
    for (const profile of imported.profiles) {
      if (existingNames.has(profile.name.toLowerCase())) continue;
      profile.id = randomId("profile");
      this.state.profiles.push(profile);
      existingNames.add(profile.name.toLowerCase());
      added += 1;
    }
    if (added) this.save();
    return { added, state: this.snapshot() };
  }
}

module.exports = { DeckStore, defaultState, normalizeAction, normalizeButton, normalizeFolder, normalizeProfile, normalizeState };
