"use strict";

const DEFAULT_SOURCE_NAME = "Batto Multi-Chat";

function normalizeOverlayOptions(input = {}) {
  const width = Math.max(320, Math.min(7680, Math.round(Number(input.width) || 1920)));
  const height = Math.max(240, Math.min(4320, Math.round(Number(input.height) || 1080)));
  const sourceName = String(input.sourceName || DEFAULT_SOURCE_NAME).trim().slice(0, 120) || DEFAULT_SOURCE_NAME;
  const sceneName = String(input.sceneName || "").trim().slice(0, 120);
  const url = String(input.url || "").trim();
  if (!/^http:\/\/127\.0\.0\.1:\d+\/chat-overlay(?:[?#]|$)/.test(url)) {
    throw new Error("Die lokale Multi-Chat-Overlay-Adresse ist ungültig.");
  }
  return { sourceName, sceneName, url, width, height };
}

async function currentSceneName(obs, requested) {
  if (requested) return requested;
  const current = await obs.call("GetCurrentProgramScene");
  const sceneName = String(current?.currentProgramSceneName || "").trim();
  if (!sceneName) throw new Error("OBS hat keine aktive Programmszene gemeldet.");
  return sceneName;
}

async function ensureObsChatOverlay(obs, input = {}) {
  if (!obs?.status?.().connected) throw new Error("OBS ist nicht verbunden.");
  const options = normalizeOverlayOptions(input);
  const sceneName = await currentSceneName(obs, options.sceneName);
  const listed = await obs.call("GetInputList");
  const existing = (listed?.inputs || []).find((item) => item.inputName === options.sourceName);
  const inputSettings = {
    url: options.url,
    width: options.width,
    height: options.height,
    shutdown: false,
    restart_when_active: false,
    reroute_audio: false
  };

  let created = false;
  if (!existing) {
    await obs.call("CreateInput", {
      sceneName,
      inputName: options.sourceName,
      inputKind: "browser_source",
      inputSettings,
      sceneItemEnabled: true
    });
    created = true;
  } else {
    if (existing.inputKind && existing.inputKind !== "browser_source") {
      throw new Error(`In OBS existiert „${options.sourceName}“ bereits, ist aber keine Browserquelle.`);
    }
    await obs.call("SetInputSettings", { inputName: options.sourceName, inputSettings, overlay: true });
    const sceneItem = await obs.safeCall("GetSceneItemId", { sceneName, sourceName: options.sourceName }, null);
    if (!sceneItem?.sceneItemId) {
      await obs.call("CreateSceneItem", { sceneName, sourceName: options.sourceName, sceneItemEnabled: true });
    } else {
      await obs.call("SetSceneItemEnabled", { sceneName, sceneItemId: sceneItem.sceneItemId, sceneItemEnabled: true });
    }
  }

  return { installed: true, created, sourceName: options.sourceName, sceneName, url: options.url, width: options.width, height: options.height };
}

async function removeObsChatOverlay(obs, sourceName = DEFAULT_SOURCE_NAME) {
  if (!obs?.status?.().connected) throw new Error("OBS ist nicht verbunden.");
  const name = String(sourceName || DEFAULT_SOURCE_NAME).trim().slice(0, 120) || DEFAULT_SOURCE_NAME;
  const listed = await obs.call("GetInputList");
  if (!(listed?.inputs || []).some((item) => item.inputName === name)) return { removed: false, sourceName: name };
  await obs.call("RemoveInput", { inputName: name });
  return { removed: true, sourceName: name };
}

function toOverlayChatEvent(message = {}) {
  return {
    id: String(message.id || ""),
    type: "chat",
    platform: String(message.platform || "local"),
    name: String(message.username || message.displayName || "Zuschauer"),
    text: String(message.message || message.text || ""),
    userId: String(message.userId || ""),
    avatarUrl: String(message.avatar || ""),
    timestamp: Number(message.timestamp) || Date.now(),
    data: {
      color: String(message.color || ""),
      role: String(message.role || ""),
      badges: Array.isArray(message.badges) ? message.badges.slice(0, 12).map(String) : []
    }
  };
}

module.exports = {
  DEFAULT_SOURCE_NAME,
  ensureObsChatOverlay,
  normalizeOverlayOptions,
  removeObsChatOverlay,
  toOverlayChatEvent
};
