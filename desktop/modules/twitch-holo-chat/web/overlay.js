"use strict";

(() => {
  const chat = document.getElementById("batto-holo-chat");
  if (!chat) return;

  const DEFAULT_STYLE = {
    enabled: true,
    colors: ["#54f4ff", "#9867ff", "#ff55c8", "#ffe66d"],
    angle: 110,
    speedSeconds: 4.5,
    glow: 18,
    brightness: 1.15,
    saturation: 1.2,
    fontWeight: 800
  };

  const DEFAULT_CONFIG = {
    enabled: true,
    applyToName: true,
    applyToMessage: true,
    useOriginalTwitchColorWhenDisabled: true,
    reducedMotion: false,
    transparentBubbles: false,
    showRole: false,
    showTime: false,
    align: "left",
    newest: "bottom",
    maximumMessages: 40,
    displayMs: 20000,
    defaultStyle: DEFAULT_STYLE,
    roleStyles: {
      broadcaster: {
        colors: ["#ff3b3b", "#ffb347", "#fff08a", "#ff3b3b"],
        glow: 22,
        speedSeconds: 3.2
      },
      moderator: {
        colors: ["#00f5a0", "#00d9f5", "#6dffb8"],
        glow: 18,
        speedSeconds: 4
      },
      vip: {
        colors: ["#ff4ecd", "#8d5cff", "#ff8fe7"],
        glow: 20,
        speedSeconds: 3.8
      },
      subscriber: {
        colors: ["#ffd166", "#ff8c42", "#fff1a8"],
        glow: 14,
        speedSeconds: 5
      },
      viewer: {
        colors: ["#54f4ff", "#9867ff", "#ff55c8", "#ffe66d"],
        glow: 14,
        speedSeconds: 5.5
      }
    },
    userStyles: {}
  };

  const timers = new Map();
  let config = normalizeConfig(DEFAULT_CONFIG);
  let socket = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  function boundedNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.max(minimum, Math.min(maximum, number))
      : fallback;
  }

  function normalizedHexColor(value, fallback) {
    const text = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
  }

  function normalizeColors(value, fallback) {
    const colors = (Array.isArray(value) ? value : [])
      .map((entry) => normalizedHexColor(entry, ""))
      .filter(Boolean)
      .slice(0, 6);
    return colors.length >= 2 ? colors : [...fallback].slice(0, 6);
  }

  function normalizeStyle(value = {}, fallback = DEFAULT_STYLE) {
    return {
      enabled: value.enabled === undefined ? fallback.enabled !== false : value.enabled !== false,
      colors: normalizeColors(value.colors, fallback.colors || DEFAULT_STYLE.colors),
      angle: boundedNumber(value.angle, 0, 360, fallback.angle ?? 110),
      speedSeconds: boundedNumber(value.speedSeconds, 0.6, 30, fallback.speedSeconds ?? 4.5),
      glow: boundedNumber(value.glow, 0, 50, fallback.glow ?? 18),
      brightness: boundedNumber(value.brightness, 0.5, 2, fallback.brightness ?? 1.15),
      saturation: boundedNumber(value.saturation, 0, 3, fallback.saturation ?? 1.2),
      fontWeight: Math.round(boundedNumber(value.fontWeight, 300, 1000, fallback.fontWeight ?? 800))
    };
  }

  function normalizeUserKey(value) {
    return String(value || "").trim().replace(/^@/, "").toLowerCase().slice(0, 80);
  }

  function normalizeConfig(value = {}) {
    const defaultStyle = normalizeStyle(value.defaultStyle, DEFAULT_STYLE);
    const roleStyles = {};
    for (const role of ["broadcaster", "moderator", "vip", "subscriber", "viewer"]) {
      roleStyles[role] = normalizeStyle(
        value.roleStyles?.[role],
        { ...defaultStyle, ...(DEFAULT_CONFIG.roleStyles[role] || {}) }
      );
    }
    const userStyles = {};
    for (const [rawKey, rawStyle] of Object.entries(value.userStyles || {}).slice(0, 1000)) {
      const key = normalizeUserKey(rawKey);
      if (key) userStyles[key] = normalizeStyle(rawStyle, defaultStyle);
    }
    return {
      enabled: value.enabled !== false,
      applyToName: value.applyToName !== false,
      applyToMessage: value.applyToMessage !== false,
      useOriginalTwitchColorWhenDisabled: value.useOriginalTwitchColorWhenDisabled !== false,
      reducedMotion: Boolean(value.reducedMotion),
      transparentBubbles: Boolean(value.transparentBubbles),
      showRole: Boolean(value.showRole),
      showTime: Boolean(value.showTime),
      align: value.align === "right" ? "right" : "left",
      newest: value.newest === "top" ? "top" : "bottom",
      maximumMessages: Math.round(boundedNumber(value.maximumMessages, 1, 200, 40)),
      displayMs: Math.round(boundedNumber(value.displayMs, 1000, 300000, 20000)),
      defaultStyle,
      roleStyles,
      userStyles
    };
  }

  function roleFromMessage(message = {}) {
    const roles = message.roles || {};
    if (roles.broadcaster || roles.streamer || roles.owner) return "broadcaster";
    if (roles.moderator || roles.mod) return "moderator";
    if (roles.vip) return "vip";
    if (roles.subscriber || roles.sub) return "subscriber";
    return "viewer";
  }

  function userKeysFromMessage(message = {}) {
    return [message.userId, message.login, message.username, message.displayName, message.user]
      .map(normalizeUserKey)
      .filter(Boolean);
  }

  function resolveStyle(message = {}) {
    const role = roleFromMessage(message);
    const userKey = userKeysFromMessage(message)
      .find((key) => Object.prototype.hasOwnProperty.call(config.userStyles, key));
    const style = userKey
      ? config.userStyles[userKey]
      : config.roleStyles[role] || config.defaultStyle;
    return { role, userKey: userKey || null, style: normalizeStyle(style, config.defaultStyle) };
  }

  function applyStyleVariables(element, style) {
    element.style.setProperty(
      "--batto-holo-gradient",
      `linear-gradient(${style.angle}deg, ${style.colors.join(", ")})`
    );
    element.style.setProperty("--batto-holo-speed", `${config.reducedMotion ? 0 : style.speedSeconds}s`);
    element.style.setProperty("--batto-holo-glow", `${style.glow}px`);
    element.style.setProperty("--batto-holo-brightness", String(style.brightness));
    element.style.setProperty("--batto-holo-saturation", String(style.saturation));
    element.style.setProperty("--batto-holo-font-weight", String(style.fontWeight));
    element.style.fontWeight = String(style.fontWeight);
  }

  function setRootClasses() {
    chat.classList.toggle("batto-reduced-motion", config.reducedMotion);
    chat.classList.toggle("batto-transparent-bubbles", config.transparentBubbles);
    chat.classList.toggle("batto-align-right", config.align === "right");
    chat.classList.toggle("batto-newest-top", config.newest === "top");
  }

  function clearTimer(messageId) {
    const timer = timers.get(messageId);
    if (timer) clearTimeout(timer);
    timers.delete(messageId);
  }

  function removeMessage(messageId, immediate = false) {
    const id = String(messageId || "");
    if (!id) return false;
    const selector = `[data-message-id="${CSS.escape(id)}"]`;
    const row = chat.querySelector(selector);
    clearTimer(id);
    if (!row) return false;
    if (immediate) {
      row.remove();
      return true;
    }
    row.classList.add("is-removing");
    row.addEventListener("animationend", () => row.remove(), { once: true });
    setTimeout(() => row.remove(), 400);
    return true;
  }

  function trimMessages() {
    while (chat.children.length > config.maximumMessages) {
      const row = config.newest === "top" ? chat.lastElementChild : chat.firstElementChild;
      if (!row) break;
      removeMessage(row.dataset.messageId, true);
    }
  }

  function scheduleRemoval(messageId) {
    clearTimer(messageId);
    if (config.displayMs <= 0) return;
    const timer = setTimeout(() => removeMessage(messageId), config.displayMs);
    timers.set(messageId, timer);
  }

  function textNodeElement(className, value) {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = String(value ?? "");
    return element;
  }

  function addMessage(input = {}) {
    const id = String(input.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    removeMessage(id, true);

    const displayName = String(input.displayName || input.user || input.username || "Twitch-Zuschauer");
    const text = String(input.text || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, 5000);
    if (!text) return null;

    const { role, style } = resolveStyle(input);
    const row = document.createElement("article");
    row.className = "batto-holo-row";
    row.dataset.messageId = id;
    row.dataset.userId = String(input.userId || "");
    row.dataset.userLogin = normalizeUserKey(input.login || input.username || input.user || displayName);
    row.dataset.role = role;
    row.dataset.showRole = String(config.showRole);

    const meta = document.createElement("div");
    meta.className = "batto-holo-meta";
    const name = textNodeElement("batto-holo-name", displayName);
    const roleBadge = textNodeElement("batto-holo-role", role);
    const time = textNodeElement(
      "batto-holo-time",
      new Date(input.timestamp || Date.now()).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      })
    );
    time.hidden = !config.showTime;
    meta.append(name, roleBadge, time);

    const message = textNodeElement("batto-holo-message", text);
    const holoEnabled = config.enabled && style.enabled;
    if (holoEnabled && config.applyToName) {
      name.classList.add("batto-holo-text");
      applyStyleVariables(name, style);
    } else if (config.useOriginalTwitchColorWhenDisabled) {
      name.style.color = normalizedHexColor(input.color, "#ffffff");
    }
    if (holoEnabled && config.applyToMessage) {
      message.classList.add("batto-holo-text");
      applyStyleVariables(message, style);
    }

    row.append(meta, message);
    if (config.newest === "top") chat.prepend(row);
    else chat.append(row);
    trimMessages();
    scheduleRemoval(id);
    return id;
  }

  function clearUser(userValue) {
    const key = normalizeUserKey(userValue);
    if (!key) return 0;
    let removed = 0;
    for (const row of [...chat.children]) {
      if (normalizeUserKey(row.dataset.userId) === key || normalizeUserKey(row.dataset.userLogin) === key) {
        if (removeMessage(row.dataset.messageId, true)) removed += 1;
      }
    }
    return removed;
  }

  function clearChat() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    chat.replaceChildren();
  }

  function configure(nextConfig = {}) {
    config = normalizeConfig({
      ...config,
      ...nextConfig,
      defaultStyle: { ...config.defaultStyle, ...(nextConfig.defaultStyle || {}) },
      roleStyles: { ...config.roleStyles, ...(nextConfig.roleStyles || {}) },
      userStyles: { ...config.userStyles, ...(nextConfig.userStyles || {}) }
    });
    setRootClasses();
    return structuredClone(config);
  }

  function setUserStyle(user, style) {
    const key = normalizeUserKey(user);
    if (!key) throw new Error("Twitch-Benutzername oder Benutzer-ID fehlt.");
    config.userStyles[key] = normalizeStyle(style, config.defaultStyle);
    return structuredClone(config.userStyles[key]);
  }

  function removeUserStyle(user) {
    const key = normalizeUserKey(user);
    if (!key) return false;
    return delete config.userStyles[key];
  }

  function setRoleStyle(role, style) {
    const key = String(role || "").toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(config.roleStyles, key)) {
      throw new Error("Unbekannte Twitch-Rolle.");
    }
    config.roleStyles[key] = normalizeStyle(style, config.defaultStyle);
    return structuredClone(config.roleStyles[key]);
  }

  function handleEnvelope(envelope) {
    const type = String(envelope?.type || "message");
    if (type === "message" || type === "chat") return addMessage(envelope.message || envelope);
    if (type === "delete") return removeMessage(envelope.messageId || envelope.id);
    if (type === "clear-user") return clearUser(envelope.userId || envelope.user);
    if (type === "clear") return clearChat();
    if (type === "config") return configure(envelope.config || envelope);
    if (type === "set-user-style") return setUserStyle(envelope.user, envelope.style);
    if (type === "remove-user-style") return removeUserStyle(envelope.user);
    if (type === "set-role-style") return setRoleStyle(envelope.role, envelope.style);
    return null;
  }

  function connectWebSocket(url) {
    const target = String(url || "").trim();
    if (!/^wss?:\/\//i.test(target)) return false;
    clearTimeout(reconnectTimer);
    try { socket?.close(); } catch {}
    const current = new WebSocket(target);
    socket = current;
    current.addEventListener("open", () => {
      reconnectDelay = 1000;
      current.send(JSON.stringify({ type: "hello", client: "batto-twitch-holo-overlay" }));
    });
    current.addEventListener("message", (event) => {
      try {
        handleEnvelope(JSON.parse(event.data));
      } catch {
        // Invalid external data must never break the OBS overlay.
      }
    });
    current.addEventListener("close", () => {
      if (socket !== current) return;
      socket = null;
      reconnectTimer = setTimeout(() => connectWebSocket(target), reconnectDelay);
      reconnectDelay = Math.min(30000, reconnectDelay * 2);
    });
    current.addEventListener("error", () => current.close());
    return true;
  }

  window.BattoHoloChat = Object.freeze({
    addMessage,
    clear: clearChat,
    clearUser,
    configure,
    connectWebSocket,
    getConfig: () => structuredClone(config),
    handleEnvelope,
    removeMessage,
    removeUserStyle,
    setRoleStyle,
    setUserStyle,
    testMessage(options = {}) {
      return addMessage({
        id: `test-${Date.now()}`,
        displayName: options.displayName || "Crazy_Batto",
        text: options.text || "Kostenloser Hologramm-Chat – ohne Server-Boost.",
        color: options.color || "#55d6ff",
        roles: options.roles || { broadcaster: true }
      });
    }
  });

  setRootClasses();
  const query = new URLSearchParams(location.search);
  const socketUrl = query.get("ws");
  if (socketUrl) connectWebSocket(socketUrl);
  if (query.get("demo") === "1") {
    addMessage({
      displayName: "Crazy_Batto",
      text: "Streamer-Name im kostenlosen Hologramm-Stil.",
      roles: { broadcaster: true }
    });
    addMessage({
      displayName: "Moderator",
      text: "Name und Nachricht können getrennt holografisch angezeigt werden.",
      roles: { moderator: true }
    });
    addMessage({
      displayName: "VIP_User",
      text: "Keine Server-Boosts und keine Discord-Abhängigkeit.",
      roles: { vip: true }
    });
  }
})();
