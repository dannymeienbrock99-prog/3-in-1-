"use strict";

const { atomicWrite, clone, readJson, safeId } = require("./runtime-utils-v2.cjs");

const DEFAULT_PROFILE = Object.freeze({
  id: "profile-default",
  name: "Streaming",
  rows: 3,
  columns: 5,
  buttonSize: 112,
  gap: 10,
  hideUnused: false,
  buttons: [],
  folders: []
});

function normalizeLayout(value = {}, fallback = DEFAULT_PROFILE) {
  return {
    rows: Math.max(1, Math.min(10, Math.round(Number(value.rows) || fallback.rows || 3))),
    columns: Math.max(1, Math.min(10, Math.round(Number(value.columns) || fallback.columns || 5))),
    buttonSize: Math.max(64, Math.min(220, Math.round(Number(value.buttonSize) || fallback.buttonSize || 112))),
    gap: Math.max(0, Math.min(30, Math.round(Number(value.gap ?? fallback.gap ?? 10)))),
    hideUnused: Boolean(value.hideUnused ?? fallback.hideUnused)
  };
}

function normalizeAction(value = {}) {
  const action = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  action.type = String(action.type || "delay").slice(0, 120);
  action.delayMs = Math.max(0, Math.min(600_000, Math.round(Number(action.delayMs) || 0)));
  return action;
}

function normalizeButton(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const actions = Array.isArray(value.actions)
    ? value.actions.map(normalizeAction).slice(0, 50)
    : value.action ? [normalizeAction(value.action)] : [];
  return {
    title: String(value.title || "").slice(0, 120),
    subtitle: String(value.subtitle || "").slice(0, 160),
    color: /^#[0-9a-f]{6}$/i.test(String(value.color || "")) ? value.color : "#182536",
    textColor: /^#[0-9a-f]{6}$/i.test(String(value.textColor || "")) ? value.textColor : "#ffffff",
    icon: String(value.icon || "").slice(0, 20_000),
    folderId: value.folderId ? String(value.folderId).slice(0, 160) : null,
    actions
  };
}

function normalizeButtons(value, maximum = 100) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: Math.min(maximum, source.length) }, (_, index) => normalizeButton(source[index]));
}

function normalizeFolder(value = {}, profile = DEFAULT_PROFILE) {
  const layout = normalizeLayout(value, profile);
  return {
    id: String(value.id || safeId("folder")),
    name: String(value.name || "Ordner").slice(0, 120),
    parentId: value.parentId && value.parentId !== "root" ? String(value.parentId) : "root",
    ...layout,
    buttons: normalizeButtons(value.buttons, layout.rows * layout.columns)
  };
}

function normalizeProfile(value = {}) {
  const layout = normalizeLayout(value, DEFAULT_PROFILE);
  const profile = {
    id: String(value.id || safeId("profile")),
    name: String(value.name || "Profil").slice(0, 120),
    ...layout,
    buttons: normalizeButtons(value.buttons, layout.rows * layout.columns),
    folders: []
  };
  profile.folders = (Array.isArray(value.folders) ? value.folders : []).map((folder) => normalizeFolder(folder, profile)).slice(0, 250);
  const ids = new Set(["root"]);
  profile.folders = profile.folders.filter((folder) => {
    if (ids.has(folder.id)) return false;
    ids.add(folder.id); return true;
  });
  profile.folders.forEach((folder) => { if (!ids.has(folder.parentId)) folder.parentId = "root"; });
  return profile;
}

function defaultData() {
  return { version: 2, activeProfileId: DEFAULT_PROFILE.id, profiles: [clone(DEFAULT_PROFILE)] };
}

class DeckManager {
  constructor(filePath, executor) {
    this.filePath = filePath;
    this.executor = executor;
    this.data = this.load();
  }

  load() {
    const source = readJson(this.filePath, defaultData());
    const profiles = (Array.isArray(source.profiles) ? source.profiles : []).map(normalizeProfile);
    if (!profiles.length) profiles.push(clone(DEFAULT_PROFILE));
    return {
      version: 2,
      activeProfileId: profiles.some((profile) => profile.id === source.activeProfileId) ? source.activeProfileId : profiles[0].id,
      profiles
    };
  }

  save() {
    atomicWrite(this.filePath, this.data);
    return this.snapshot();
  }

  snapshot() {
    return clone(this.data);
  }

  profile(profileId) {
    return this.data.profiles.find((profile) => profile.id === profileId) || null;
  }

  folder(profile, folderId) {
    if (!profile || !folderId || folderId === "root") return profile ? { ...profile, id: "root", parentId: null } : null;
    return profile.folders.find((folder) => folder.id === folderId) || null;
  }

  buttons(profile, folderId) {
    return folderId && folderId !== "root" ? this.folder(profile, folderId)?.buttons : profile?.buttons;
  }

  async command(command, payload = {}) {
    switch (command) {
      case "setActiveProfile": {
        if (!this.profile(payload.profileId)) throw new Error("Profil nicht gefunden");
        this.data.activeProfileId = payload.profileId;
        return this.save();
      }
      case "createProfile": {
        const profile = normalizeProfile({ id: safeId("profile"), name: payload.name || "Neues Profil" });
        this.data.profiles.push(profile); this.data.activeProfileId = profile.id; return this.save();
      }
      case "renameProfile": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        profile.name = String(payload.name || profile.name).trim().slice(0, 120) || profile.name; return this.save();
      }
      case "deleteProfile": {
        if (this.data.profiles.length <= 1) throw new Error("Mindestens ein Profil muss erhalten bleiben");
        this.data.profiles = this.data.profiles.filter((profile) => profile.id !== payload.profileId);
        if (!this.profile(this.data.activeProfileId)) this.data.activeProfileId = this.data.profiles[0].id;
        return this.save();
      }
      case "createFolder": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        const parent = this.folder(profile, payload.parentId || "root"); if (!parent) throw new Error("Zielordner nicht gefunden");
        const folder = normalizeFolder({ id: safeId("folder"), name: payload.name || "Neuer Ordner", parentId: parent.id === "root" ? "root" : parent.id }, profile);
        profile.folders.push(folder); return this.save();
      }
      case "deleteFolder": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        if (!payload.folderId || payload.folderId === "root") throw new Error("Hauptseite kann nicht gelöscht werden");
        const descendants = new Set([payload.folderId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const folder of profile.folders) if (descendants.has(folder.parentId) && !descendants.has(folder.id)) { descendants.add(folder.id); changed = true; }
        }
        profile.folders = profile.folders.filter((folder) => !descendants.has(folder.id));
        const cleanButtons = (buttons) => buttons.map((button) => button?.folderId && descendants.has(button.folderId) ? { ...button, folderId: null } : button);
        profile.buttons = cleanButtons(profile.buttons); profile.folders.forEach((folder) => { folder.buttons = cleanButtons(folder.buttons); });
        return this.save();
      }
      case "updateLayout": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        const target = this.folder(profile, payload.folderId || "root"); if (!target) throw new Error("Ordner nicht gefunden");
        const layout = normalizeLayout(payload, target);
        Object.assign(target, layout);
        const maximum = layout.rows * layout.columns;
        const buttonArray = this.buttons(profile, payload.folderId || "root");
        if (buttonArray.length > maximum) {
          const overflow = buttonArray.slice(maximum).filter(Boolean);
          if (overflow.length) throw new Error(`Raster zu klein: ${overflow.length} belegte Taste(n) würden verloren gehen`);
        }
        buttonArray.length = Math.min(buttonArray.length, maximum);
        return this.save();
      }
      case "setButton": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        const target = this.folder(profile, payload.folderId || "root"); if (!target) throw new Error("Ordner nicht gefunden");
        const buttons = this.buttons(profile, payload.folderId || "root");
        const maximum = target.rows * target.columns;
        const index = Math.max(0, Math.min(maximum - 1, Math.round(Number(payload.index) || 0)));
        while (buttons.length <= index) buttons.push(null);
        buttons[index] = normalizeButton(payload.button);
        return this.save();
      }
      case "moveButton": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        const buttons = this.buttons(profile, payload.folderId || "root");
        const from = Math.round(Number(payload.from)); const to = Math.round(Number(payload.to));
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) throw new Error("Ungültige Tastenposition");
        const maximum = (this.folder(profile, payload.folderId || "root")?.rows || profile.rows) * (this.folder(profile, payload.folderId || "root")?.columns || profile.columns);
        if (from >= maximum || to >= maximum) throw new Error("Tastenposition außerhalb des Rasters");
        while (buttons.length < maximum) buttons.push(null);
        [buttons[from], buttons[to]] = [buttons[to], buttons[from]];
        while (buttons.length && buttons.at(-1) == null) buttons.pop();
        return this.save();
      }
      case "execute": {
        const profile = this.profile(payload.profileId); if (!profile) throw new Error("Profil nicht gefunden");
        const button = this.buttons(profile, payload.folderId || "root")?.[Math.round(Number(payload.index))];
        if (!button) throw new Error("Taste ist nicht belegt");
        if (button.folderId) return { navigation: button.folderId };
        if (!this.executor) throw new Error("Aktionsausführung nicht verfügbar");
        return { execution: await this.executor.executeMany(button.actions || [], { profileId: profile.id, folderId: payload.folderId || "root", buttonIndex: payload.index }) };
      }
      case "replaceAll": {
        const replacement = payload.data && typeof payload.data === "object" ? payload.data : null;
        if (!replacement) throw new Error("Ungültige Importdatei");
        const profiles = (Array.isArray(replacement.profiles) ? replacement.profiles : []).map(normalizeProfile);
        if (!profiles.length) throw new Error("Import enthält keine Profile");
        this.data = { version: 2, activeProfileId: profiles.some((profile) => profile.id === replacement.activeProfileId) ? replacement.activeProfileId : profiles[0].id, profiles };
        return this.save();
      }
      default: throw new Error(`Unbekannter Deck-Befehl: ${command}`);
    }
  }
}

module.exports = { DeckManager, normalizeAction, normalizeButton, normalizeProfile };
