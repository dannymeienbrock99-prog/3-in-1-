"use strict";

const CNG_HOST = "cng-plattform.com";
const CNG_CHAT_PATH = /^\/chat-popout\/(\d+)$/;
const CNG_ALERT_PATH = /^\/alert-overlay$/;

function assertHttpUrl(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} fehlt.`);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} ist keine gültige HTTP(S)-URL.`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`${label} muss HTTP oder HTTPS verwenden.`);
  }
  return url;
}

function parseCngChatUrl(value) {
  const url = assertHttpUrl(value, "CNG-Chat-URL");
  if (url.hostname.toLowerCase() !== CNG_HOST) {
    throw new Error("Die CNG-Chat-URL muss auf cng-plattform.com zeigen.");
  }
  const match = url.pathname.match(CNG_CHAT_PATH);
  if (!match) throw new Error("Erwartet wird /chat-popout/{creatorId}.");
  const creatorId = match[1];
  const mode = url.searchParams.get("mode") || "obs";
  if (!["obs", "ghost"].includes(mode)) {
    throw new Error("CNG-Chat-Modus muss obs oder ghost sein.");
  }
  return {
    creatorId,
    mode,
    url: url.toString(),
    obsChatToken: url.searchParams.get("obsChatToken") || ""
  };
}

function parseCngAlertUrl(value) {
  const url = assertHttpUrl(value, "CNG-Alert-URL");
  if (url.hostname.toLowerCase() !== CNG_HOST) {
    throw new Error("Die CNG-Alert-URL muss auf cng-plattform.com zeigen.");
  }
  if (!CNG_ALERT_PATH.test(url.pathname)) {
    throw new Error("Erwartet wird /alert-overlay.");
  }
  const creatorId = url.searchParams.get("creatorId") || "";
  if (!/^\d+$/.test(creatorId)) {
    throw new Error("Die CNG-Alert-URL benötigt eine numerische creatorId.");
  }
  return {
    creatorId,
    url: url.toString(),
    alertTts: url.searchParams.get("alertTts") === "1",
    chatTts: url.searchParams.get("chatTts") === "1"
  };
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "••••••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function sanitizeForLog(config) {
  const chat = config?.chat || {};
  const alerts = config?.alerts || {};
  return {
    enabled: Boolean(config?.enabled),
    creatorId: String(config?.creatorId || ""),
    chat: {
      enabled: chat.enabled !== false,
      mode: chat.mode || "obs",
      hasToken: Boolean(chat.obsChatToken),
      token: maskSecret(chat.obsChatToken)
    },
    alerts: {
      enabled: alerts.enabled !== false,
      alertTts: Boolean(alerts.alertTts),
      chatTts: Boolean(alerts.chatTts)
    }
  };
}

function normalizeCngConfig(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const chatUrl = String(source.chat?.url || "").trim();
  const alertUrl = String(source.alerts?.url || "").trim();
  const chat = chatUrl ? parseCngChatUrl(chatUrl) : null;
  const alerts = alertUrl ? parseCngAlertUrl(alertUrl) : null;
  const creatorId = String(source.creatorId || chat?.creatorId || alerts?.creatorId || "");
  if (creatorId && !/^\d+$/.test(creatorId)) throw new Error("CNG creatorId muss numerisch sein.");
  if (chat && chat.creatorId !== creatorId) throw new Error("CNG Chat und creatorId gehören zu unterschiedlichen Creatorn.");
  if (alerts && alerts.creatorId !== creatorId) throw new Error("CNG Alerts und creatorId gehören zu unterschiedlichen Creatorn.");

  return {
    enabled: source.enabled !== false,
    creatorId,
    chat: {
      enabled: source.chat?.enabled !== false,
      mode: chat?.mode || source.chat?.mode || "obs",
      url: chat?.url || chatUrl,
      obsChatToken: chat?.obsChatToken || String(source.chat?.obsChatToken || "")
    },
    alerts: {
      enabled: source.alerts?.enabled !== false,
      url: alerts?.url || alertUrl,
      alertTts: alerts ? alerts.alertTts : Boolean(source.alerts?.alertTts),
      chatTts: alerts ? alerts.chatTts : Boolean(source.alerts?.chatTts)
    }
  };
}

module.exports = {
  CNG_HOST,
  parseCngChatUrl,
  parseCngAlertUrl,
  normalizeCngConfig,
  sanitizeForLog,
  maskSecret
};
