"use strict";

const ROLE_PRIORITY = ["broadcaster", "moderator", "vip", "subscriber", "viewer"];

const DEFAULT_STYLE = Object.freeze({
  enabled: true,
  colors: ["#54f4ff", "#9867ff", "#ff55c8", "#ffe66d"],
  angle: 110,
  speedSeconds: 4.5,
  glow: 18,
  brightness: 1.15,
  saturation: 1.2,
  fontWeight: 800,
  permanent: true
});

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  applyToName: true,
  applyToMessage: true,
  useOriginalTwitchColorWhenDisabled: true,
  reducedMotion: false,
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
});

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

function normalizeColors(value, fallback = DEFAULT_STYLE.colors) {
  const colors = (Array.isArray(value) ? value : [])
    .map((entry) => normalizedHexColor(entry, ""))
    .filter(Boolean)
    .slice(0, 6);
  if (colors.length >= 2) return colors;
  return [...fallback].slice(0, 6);
}

function normalizeStyle(value = {}, fallback = DEFAULT_STYLE) {
  return {
    enabled: value.enabled === undefined ? fallback.enabled !== false : value.enabled !== false,
    colors: normalizeColors(value.colors, fallback.colors || DEFAULT_STYLE.colors),
    angle: boundedNumber(value.angle, 0, 360, fallback.angle ?? DEFAULT_STYLE.angle),
    speedSeconds: boundedNumber(
      value.speedSeconds,
      0.6,
      30,
      fallback.speedSeconds ?? DEFAULT_STYLE.speedSeconds
    ),
    glow: boundedNumber(value.glow, 0, 50, fallback.glow ?? DEFAULT_STYLE.glow),
    brightness: boundedNumber(
      value.brightness,
      0.5,
      2,
      fallback.brightness ?? DEFAULT_STYLE.brightness
    ),
    saturation: boundedNumber(
      value.saturation,
      0,
      3,
      fallback.saturation ?? DEFAULT_STYLE.saturation
    ),
    fontWeight: Math.round(boundedNumber(
      value.fontWeight,
      300,
      1000,
      fallback.fontWeight ?? DEFAULT_STYLE.fontWeight
    )),
    permanent: value.permanent === undefined
      ? fallback.permanent !== false
      : value.permanent !== false
  };
}

function normalizeUserKey(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase().slice(0, 80);
}

function normalizeConfig(value = {}) {
  const defaultStyle = normalizeStyle(value.defaultStyle, DEFAULT_STYLE);
  const roleStyles = {};
  for (const role of ROLE_PRIORITY) {
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

function resolveStyle(message = {}, configValue = DEFAULT_CONFIG) {
  const config = normalizeConfig(configValue);
  const role = roleFromMessage(message);
  const userKey = userKeysFromMessage(message)
    .find((key) => Object.prototype.hasOwnProperty.call(config.userStyles, key));
  const style = userKey
    ? config.userStyles[userKey]
    : config.roleStyles[role] || config.defaultStyle;
  return {
    role,
    userKey: userKey || null,
    style: normalizeStyle(style, config.defaultStyle),
    config
  };
}

function cssVariables(styleValue, reducedMotion = false) {
  const style = normalizeStyle(styleValue);
  return {
    "--batto-holo-gradient": `linear-gradient(${style.angle}deg, ${style.colors.join(", ")})`,
    "--batto-holo-speed": `${reducedMotion ? 0 : style.speedSeconds}s`,
    "--batto-holo-glow": `${style.glow}px`,
    "--batto-holo-brightness": String(style.brightness),
    "--batto-holo-saturation": String(style.saturation),
    "--batto-holo-font-weight": String(style.fontWeight)
  };
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_STYLE,
  ROLE_PRIORITY,
  cssVariables,
  normalizeColors,
  normalizeConfig,
  normalizeStyle,
  normalizeUserKey,
  resolveStyle,
  roleFromMessage,
  userKeysFromMessage
};
