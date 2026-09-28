"use strict";

(() => {
  const view = document.getElementById("view-settings");
  if (!view) return;

  const mappings = [
    ["settings-platform", "cs-platform", "twitch"],
    ["settings-resolution", "cs-resolution", "1920x1080"],
    ["settings-fps", "cs-fps", "60"]
  ];

  function correctTransportLabels() {
    const twitch = document.querySelector("#cs-twitch-transport option");
    if (twitch) twitch.textContent = "Twitch IRC WebSocket";
    const youtube = document.querySelector("#cs-youtube-transport option");
    if (youtube) youtube.textContent = "YouTube Data API – liveChatMessages.list";
  }

  function ensureCompatFields() {
    let host = document.getElementById("settings-compat-fields");
    if (!host) {
      host = document.createElement("div");
      host.id = "settings-compat-fields";
      host.hidden = true;
      view.appendChild(host);
    }

    for (const [legacyId, currentId, fallback] of mappings) {
      let legacy = document.getElementById(legacyId);
      if (!legacy) {
        legacy = document.createElement("input");
        legacy.id = legacyId;
        legacy.value = fallback;
        host.appendChild(legacy);
      }
      const current = document.getElementById(currentId);
      if (current) {
        legacy.value = current.value || fallback;
        if (!current.dataset.legacySyncBound) {
          current.dataset.legacySyncBound = "1";
          const sync = () => { legacy.value = current.value || fallback; };
          current.addEventListener("input", sync);
          current.addEventListener("change", sync);
        }
      }
    }
    correctTransportLabels();
  }

  ensureCompatFields();
  const observer = new MutationObserver(() => ensureCompatFields());
  observer.observe(view, { childList: true, subtree: true });
})();
