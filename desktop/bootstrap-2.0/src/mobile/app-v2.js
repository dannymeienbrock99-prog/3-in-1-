"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const saved = JSON.parse(localStorage.getItem("batto-mobile-pairing") || "{}");
  const params = new URLSearchParams(location.search);
  const connection = {
    host: params.get("host") || saved.host || location.hostname,
    port: Number(params.get("port") || saved.port || location.port || 48620),
    pin: params.get("pin") || saved.pin || "",
    name: saved.name || `Handy ${navigator.platform || "Browser"}`,
    clientId: saved.clientId || crypto.randomUUID()
  };
  let socket = null;
  let appState = null;
  let currentProfileId = "";
  let currentFolderId = "root";
  let reconnectTimer = null;
  let requestCounter = 0;
  const pending = new Map();

  function persist() {
    localStorage.setItem("batto-mobile-pairing", JSON.stringify({
      host: connection.host,
      port: connection.port,
      pin: connection.pin,
      name: connection.name,
      clientId: connection.clientId
    }));
  }

  function setStatus(text, kind = "") {
    const target = $("status");
    if (!target) return;
    target.textContent = text;
    target.dataset.kind = kind;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (!connection.pin) { setStatus("PIN fehlt", "error"); return; }
    persist();
    const url = `ws://${connection.host}:${connection.port}/ws?pin=${encodeURIComponent(connection.pin)}&name=${encodeURIComponent(connection.name)}&clientId=${encodeURIComponent(connection.clientId)}`;
    try { socket?.close(); } catch {}
    const current = new WebSocket(url);
    socket = current;
    setStatus("Verbindung wird hergestellt …", "pending");
    current.addEventListener("open", () => current.send(JSON.stringify({ type: "hello", clientId: connection.clientId, name: connection.name })));
    current.addEventListener("message", (event) => {
      try { handle(JSON.parse(event.data)); }
      catch { setStatus("Ungültige Serverantwort", "error"); }
    });
    current.addEventListener("close", (event) => {
      if (socket !== current) return;
      socket = null;
      for (const request of pending.values()) request.reject(new Error("Verbindung getrennt"));
      pending.clear();
      setStatus(event.code === 4003 ? "PIN falsch oder Kopplung abgelehnt" : "Verbindung getrennt", "error");
      if (event.code !== 4003) reconnectTimer = setTimeout(connect, 3000);
    });
    current.addEventListener("error", () => current.close());
  }

  function handle(message) {
    if (message.type === "pending") { setStatus("Kopplung am PC bestätigen", "pending"); return; }
    if (message.type === "rejected") { setStatus("Kopplung wurde abgelehnt", "error"); return; }
    if (message.type === "paired") {
      connection.clientId = message.clientId || connection.clientId;
      persist();
      setStatus("Verbunden", "success");
      if (message.state) applyState(message.state);
      return;
    }
    if (message.type === "state") { applyState(message.state); return; }
    if (message.type === "result") {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      message.ok === false ? request.reject(new Error(message.error?.message || message.error || "Aktion fehlgeschlagen")) : request.resolve(message.result);
      return;
    }
    if (message.type === "toast") showToast(message.text || "");
  }

  function command(commandName, payload = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Nicht verbunden"));
    const requestId = `mobile-${Date.now()}-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Zeitüberschreitung")); }, 10000);
      pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      socket.send(JSON.stringify({ type: "command", requestId, command: commandName, payload }));
    });
  }

  function applyState(next) {
    appState = next || {};
    const profiles = appState.deck?.profiles || [];
    if (!currentProfileId || !profiles.some((profile) => profile.id === currentProfileId)) currentProfileId = appState.deck?.activeProfileId || profiles[0]?.id || "";
    renderProfiles(); renderDeck(); renderObs();
  }

  function renderProfiles() {
    const select = $("profile-select");
    if (!select) return;
    select.replaceChildren();
    for (const profile of appState?.deck?.profiles || []) {
      const option = document.createElement("option");
      option.value = profile.id; option.textContent = profile.name; option.selected = profile.id === currentProfileId;
      select.append(option);
    }
  }

  function profile() { return appState?.deck?.profiles?.find((entry) => entry.id === currentProfileId) || null; }

  function folder(profileValue) {
    if (!profileValue || currentFolderId === "root") return { ...profileValue, id: "root", name: "Hauptseite", parentId: null };
    return profileValue.folders?.find((entry) => entry.id === currentFolderId) || { ...profileValue, id: "root", name: "Hauptseite", parentId: null };
  }

  function renderDeck() {
    const root = $("deck");
    if (!root) return;
    root.replaceChildren();
    const profileValue = profile();
    if (!profileValue) return;
    const folderValue = folder(profileValue);
    currentFolderId = folderValue.id;
    const rows = folderValue.rows || profileValue.rows || 3;
    const columns = folderValue.columns || profileValue.columns || 5;
    const buttons = folderValue.id === "root" ? profileValue.buttons || [] : folderValue.buttons || [];
    root.style.gridTemplateColumns = `repeat(${columns}, minmax(64px, 1fr))`;
    $("folder-title").textContent = folderValue.name || "Hauptseite";
    $("folder-back").hidden = folderValue.id === "root";
    for (let index = 0; index < rows * columns; index += 1) {
      const value = buttons[index];
      if (!value && (folderValue.hideUnused ?? profileValue.hideUnused)) continue;
      const button = document.createElement("button");
      button.className = value ? "deck-key" : "deck-key empty";
      button.style.background = value?.color || "#182536";
      button.style.color = value?.textColor || "#fff";
      if (value?.icon) {
        const image = document.createElement("img"); image.src = value.icon; image.alt = ""; button.append(image);
      }
      const title = document.createElement("strong"); title.textContent = value?.title || `Taste ${index + 1}`; button.append(title);
      if (value?.subtitle) { const subtitle = document.createElement("small"); subtitle.textContent = value.subtitle; button.append(subtitle); }
      button.addEventListener("click", async () => {
        if (!value) return;
        if (value.folderId) { currentFolderId = value.folderId; renderDeck(); return; }
        try { await command("deck.execute", { profileId: profileValue.id, folderId: folderValue.id, index }); vibrate(); }
        catch (error) { showToast(error.message, true); }
      });
      root.append(button);
    }
  }

  function renderObs() {
    const obs = appState?.obs || {};
    $("obs-state").textContent = obs.connected ? "OBS verbunden" : "OBS getrennt";
    $("obs-state").dataset.kind = obs.connected ? "success" : "error";
    const scenes = $("scene-select"); scenes.replaceChildren();
    for (const item of obs.scenes || []) {
      const name = typeof item === "string" ? item : item.sceneName || item.name;
      const option = document.createElement("option"); option.value = name; option.textContent = name; option.selected = name === obs.currentScene; scenes.append(option);
    }
  }

  function showToast(text, error = false) {
    const target = $("toast"); target.textContent = text; target.className = `show${error ? " error" : ""}`;
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { target.className = ""; }, 3500);
  }

  function vibrate() { try { navigator.vibrate?.(25); } catch {} }

  $("profile-select")?.addEventListener("change", () => { currentProfileId = $("profile-select").value; currentFolderId = "root"; renderDeck(); });
  $("folder-back")?.addEventListener("click", () => { const current = folder(profile()); currentFolderId = current.parentId || "root"; renderDeck(); });
  $("refresh")?.addEventListener("click", () => { socket?.send(JSON.stringify({ type: "refresh" })); });
  $("scene-switch")?.addEventListener("click", () => command("obs.scene", { sceneName: $("scene-select").value }).catch((error) => showToast(error.message, true)));
  $("stream-toggle")?.addEventListener("click", () => command("obs.call", { requestType: "ToggleStream", requestData: {} }).catch((error) => showToast(error.message, true)));
  $("record-toggle")?.addEventListener("click", () => command("obs.call", { requestType: "ToggleRecord", requestData: {} }).catch((error) => showToast(error.message, true)));
  $("virtualcam-toggle")?.addEventListener("click", () => command("obs.call", { requestType: "ToggleVirtualCam", requestData: {} }).catch((error) => showToast(error.message, true)));

  persist();
  connect();
})();
