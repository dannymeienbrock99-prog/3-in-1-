"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const ui = {
    connectionLabel: $("#connection-label"), pairPanel: $("#pair-panel"), controlPanel: $("#control-panel"),
    host: $("#host-input"), port: $("#port-input"), pin: $("#pin-input"), name: $("#name-input"),
    pair: $("#pair-button"), pairStatus: $("#pair-status"), settings: $("#settings-button"),
    profile: $("#profile-select"), folderBack: $("#folder-back"), folderTitle: $("#folder-title"), deck: $("#deck-grid"),
    scene: $("#scene-select"), audio: $("#audio-list"), refresh: $("#refresh-button"), disconnect: $("#disconnect-button"),
    status: $("#status-list"), toast: $("#toast")
  };
  const query = new URLSearchParams(location.search);
  const saved = JSON.parse(localStorage.getItem("batto-mobile-pair") || "{}");
  ui.host.value = query.get("host") || saved.host || location.hostname || "";
  ui.port.value = query.get("port") || saved.port || location.port || "48620";
  ui.pin.value = query.get("pin") || "";
  ui.name.value = saved.name || `Handy ${Math.floor(Math.random() * 999)}`;

  let socket = null;
  let state = null;
  let token = saved.token || "";
  let currentProfileId = "";
  let currentFolderId = "root";
  let reconnectTimer = null;
  let manualDisconnect = false;

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2400);
  }

  function endpoint() {
    const host = ui.host.value.trim();
    const port = Number(ui.port.value) || 48620;
    return { host, port, url: `ws://${host.includes(":") ? `[${host}]` : host}:${port}/ws` };
  }

  function persist() {
    const { host, port } = endpoint();
    localStorage.setItem("batto-mobile-pair", JSON.stringify({ host, port, name: ui.name.value.trim(), token }));
  }

  function setConnected(connected, message = "") {
    ui.pairPanel.hidden = connected;
    ui.controlPanel.hidden = !connected;
    ui.connectionLabel.textContent = connected ? "Lokal verbunden" : message || "Nicht verbunden";
    if (!connected) ui.pairStatus.textContent = message;
  }

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Keine Verbindung zum PC.");
    socket.send(JSON.stringify(message));
  }

  function connect(useToken = true) {
    manualDisconnect = false;
    clearTimeout(reconnectTimer);
    const target = endpoint();
    if (!target.host) return ui.pairStatus.textContent = "PC-Adresse fehlt.";
    try { socket?.close(); } catch {}
    ui.pairStatus.textContent = "Verbindung wird aufgebaut …";
    const current = new WebSocket(target.url);
    socket = current;
    current.addEventListener("open", () => {
      send({
        type: "pair",
        clientId: saved.clientId || crypto.randomUUID?.() || `mobile-${Date.now()}`,
        name: ui.name.value.trim() || "Handy",
        pin: ui.pin.value.trim(),
        token: useToken ? token : "",
        protocol: query.get("legacy") === "1" ? "creatorhub" : "batto"
      });
    });
    current.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      handleMessage(message);
    });
    current.addEventListener("close", () => {
      if (socket !== current) return;
      socket = null;
      setConnected(false, manualDisconnect ? "Verbindung getrennt" : "PC-Verbindung unterbrochen");
      if (!manualDisconnect && token) reconnectTimer = setTimeout(() => connect(true), 2500);
    });
    current.addEventListener("error", () => {
      ui.pairStatus.textContent = "PC ist unter dieser Adresse nicht erreichbar.";
    });
  }

  function handleMessage(message) {
    switch (message.type) {
      case "hello":
        ui.pairStatus.textContent = message.approvalRequired ? "PIN wird geprüft …" : "Kopplung läuft …";
        break;
      case "pair-pending":
        ui.pairStatus.textContent = "Bitte die Kopplung am PC bestätigen.";
        break;
      case "pair-approved":
        token = message.token || token;
        if (message.clientId) saved.clientId = message.clientId;
        persist();
        setConnected(true);
        state = message.state || state;
        render();
        toast("Handy verbunden");
        break;
      case "pair-denied":
      case "error":
        ui.pairStatus.textContent = message.error || "Verbindung abgelehnt.";
        break;
      case "state":
        state = message.state;
        render();
        break;
      case "action-result":
        if (message.result?.ok === false) toast(message.result.error || "Aktion fehlgeschlagen");
        else toast("Aktion ausgeführt");
        break;
      case "revoked":
        token = "";
        persist();
        manualDisconnect = true;
        socket?.close();
        setConnected(false, "Kopplung wurde am PC entfernt.");
        break;
    }
  }

  function profileState() {
    const profiles = state?.deck?.profiles || [];
    const id = currentProfileId || state?.deck?.activeProfileId || profiles[0]?.id;
    return profiles.find((profile) => profile.id === id) || profiles[0] || null;
  }

  function folderState(profile) {
    if (!profile) return null;
    return profile.folders?.find((folder) => folder.id === currentFolderId)
      || profile.folders?.find((folder) => folder.id === profile.activeFolderId)
      || profile.folders?.[0]
      || null;
  }

  function render() {
    if (!state) return;
    renderDeck();
    renderObs();
    renderStatus();
  }

  function renderDeck() {
    const profiles = state.deck?.profiles || [];
    const previous = currentProfileId;
    currentProfileId = currentProfileId || state.deck?.activeProfileId || profiles[0]?.id || "";
    ui.profile.replaceChildren(...profiles.map((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      option.selected = profile.id === currentProfileId;
      return option;
    }));
    if (previous && !profiles.some((profile) => profile.id === previous)) currentProfileId = profiles[0]?.id || "";
    const profile = profileState();
    const folder = folderState(profile);
    if (!folder) {
      ui.deck.replaceChildren();
      return;
    }
    currentFolderId = folder.id;
    ui.folderTitle.textContent = `${profile.name} · ${folder.name}`;
    ui.folderBack.hidden = !folder.parentId;
    ui.deck.style.setProperty("--deck-columns", String(Math.min(6, Math.max(1, folder.columns || 3))));
    const buttons = (folder.buttons || []).slice(0, Math.max(1, (folder.rows || 3) * (folder.columns || 5)));
    ui.deck.replaceChildren(...buttons.map((button, index) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `deck-button${button.actions?.length || button.folderId ? " has-action" : ""}`;
      element.style.setProperty("--button-color", button.color || "#51d6ff");
      element.style.setProperty("--button-text", button.textColor || "#ffffff");
      if (button.icon && /^data:image\//.test(button.icon)) {
        const image = document.createElement("img");
        image.src = button.icon;
        image.alt = "";
        element.append(image);
      }
      const title = document.createElement("span");
      title.textContent = button.title || (button.folderId ? "Ordner" : "");
      element.append(title);
      if (button.actions?.length > 1) {
        const count = document.createElement("small");
        count.textContent = `${button.actions.length}×`;
        element.append(count);
      }
      element.addEventListener("click", () => {
        if (button.folderId) {
          currentFolderId = button.folderId;
          return renderDeck();
        }
        if (!button.actions?.length) return;
        send({ type: "execute", requestId: `${Date.now()}-${index}`, payload: { kind: "deck-button", profileId: profile.id, folderId: folder.id, buttonIndex: index } });
      });
      return element;
    }));
  }

  function renderObs() {
    const obs = state.obs || {};
    const scenes = obs.scenes || [];
    ui.scene.replaceChildren(...scenes.map((scene) => {
      const option = document.createElement("option");
      option.value = scene.sceneName;
      option.textContent = scene.sceneName;
      option.selected = scene.sceneName === obs.currentProgramSceneName;
      return option;
    }));
    const audio = obs.audioInputs || [];
    ui.audio.replaceChildren(...audio.map((input) => {
      const row = document.createElement("div");
      row.className = "audio-row";
      const name = document.createElement("strong");
      name.textContent = input.inputName;
      const mute = document.createElement("button");
      mute.type = "button";
      mute.textContent = input.inputMuted ? "Ton an" : "Mute";
      mute.addEventListener("click", () => send({ type: "execute", payload: { kind: "action", action: { type: "obs.input.mute", settings: { inputName: input.inputName, toggle: true } } } }));
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "2";
      slider.step = "0.01";
      slider.value = String(input.inputVolumeMul ?? 1);
      slider.addEventListener("change", () => send({ type: "execute", payload: { kind: "action", action: { type: "obs.input.volume", settings: { inputName: input.inputName, volumeMul: Number(slider.value) } } } }));
      row.append(name, mute, slider);
      return row;
    }));
  }

  function renderStatus() {
    const hardware = state.hardware || {};
    const obs = state.obs || {};
    const rows = [
      ["OBS", obs.connected ? "Verbunden" : "Getrennt"],
      ["Szene", obs.currentProgramSceneName || "–"],
      ["CPU", hardware.cpu?.model || hardware.cpu?.name || "–"],
      ["GPU", hardware.preferredGpu?.name || hardware.gpus?.find?.((gpu) => gpu.dedicated)?.name || "–"],
      ["RAM", hardware.memory?.totalGb ? `${hardware.memory.totalGb} GB` : "–"],
      ["Monitoring", state.modules?.monitoring?.active ? "Aktiv" : "Nicht aktiv"],
      ["Stream-Overlay", state.modules?.streamOverlay?.active ? "Aktiv" : "Nicht aktiv"]
    ];
    ui.status.replaceChildren(...rows.map(([label, value]) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      wrapper.append(term, description);
      return wrapper;
    }));
  }

  ui.pair.addEventListener("click", () => {
    token = "";
    persist();
    connect(false);
  });
  ui.settings.addEventListener("click", () => setConnected(false, "Verbindungsdaten ändern"));
  ui.disconnect.addEventListener("click", () => {
    manualDisconnect = true;
    token = "";
    persist();
    socket?.close();
    setConnected(false, "Verbindung getrennt");
  });
  ui.profile.addEventListener("change", () => {
    currentProfileId = ui.profile.value;
    currentFolderId = "root";
    renderDeck();
  });
  ui.folderBack.addEventListener("click", () => {
    const profile = profileState();
    const folder = folderState(profile);
    currentFolderId = folder?.parentId || "root";
    renderDeck();
  });
  ui.scene.addEventListener("change", () => send({ type: "execute", payload: { kind: "action", action: { type: "obs.scene", settings: { sceneName: ui.scene.value } } } }));
  ui.refresh.addEventListener("click", () => send({ type: "get-state" }));
  $$('[data-action]').forEach((button) => button.addEventListener("click", () => send({ type: "execute", payload: { kind: "action", action: { type: button.dataset.action, settings: {} } } })));
  $$('[data-page]').forEach((button) => button.addEventListener("click", () => {
    $$('[data-page]').forEach((item) => item.classList.toggle("active", item === button));
    $$('[data-page-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === button.dataset.page));
  }));

  if (token && ui.host.value) connect(true);
  else setConnected(false);
})();
