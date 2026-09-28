"use strict";

(() => {
  const apiTab = document.querySelector('[data-cs-tab="tiktok-api"]');
  const apiPage = document.querySelector('[data-cs-page="tiktok-api"]');
  if (apiTab) apiTab.textContent = "TikTok / TikFinity";
  if (apiPage) {
    apiPage.innerHTML = `<article class="panel form-panel"><h3>TikTok LIVE · TikFinity lokal</h3>
      <label class="cs-toggle"><input id="cs-tiktok-api-enabled" type="checkbox"><span><strong>TikTok Live-Ereignisse aktivieren</strong><small>Primär lokal über TikFinity Desktop.</small></span></label>
      <label>Quelle<select id="cs-tiktok-provider"><option value="tikfinity">TikFinity lokal · ws://127.0.0.1:21213/</option><option value="connector">Direkter Connector als Fallback</option></select></label>
      <div class="info-banner"><strong>Kein Euler-Key erforderlich.</strong><br>TikFinity Desktop muss auf diesem PC laufen und mit deinem TikTok LIVE verbunden sein. Batto liest Chat und unterstützte Live-Ereignisse über den lokalen WebSocket ein.</div>
      <label class="cs-toggle"><input id="cs-api-reconnect" type="checkbox"><span><strong>Automatisch wiederverbinden</strong><small>Wenn TikFinity neu gestartet wird, verbindet Batto lokal erneut.</small></span></label>
      <label class="cs-toggle"><input id="cs-api-ratelimit" type="checkbox"><span><strong>Verbindungsfehler abfangen</strong><small>Ein TikTok-Fehler darf OBS und die restliche App nicht blockieren.</small></span></label>
      <label>Min. Reconnect<input id="cs-api-min" type="number" min="1000" max="60000" step="1000"><small>Millisekunden</small></label>
      <label>Max. Reconnect<input id="cs-api-max" type="number" min="5000" max="300000" step="5000"><small>Millisekunden</small></label>
      <div class="cs-check-grid">
        ${toggle("cs-api-chat", "Chat")}${toggle("cs-api-gifts", "Geschenke")}${toggle("cs-api-follows", "Follower")}${toggle("cs-api-shares", "Shares")}${toggle("cs-api-likes", "Likes")}${toggle("cs-api-joins", "Joins")}${toggle("cs-api-subs", "Subscriptions")}${toggle("cs-api-mod", "Moderationsdaten")}
      </div>
      <div hidden aria-hidden="true"><input id="cs-euler-key"><button id="cs-euler-save"></button><button id="cs-euler-forget"></button><span id="cs-euler-state"></span></div>
    </article>`;
  }

  const diagnostics = document.getElementById("cs-diagnostics")?.closest("label");
  diagnostics?.remove();
  const monitor = document.getElementById("cs-overlay-monitor")?.closest("label");
  monitor?.remove();
  const statusApi = document.getElementById("cs-status-api")?.previousElementSibling;
  if (statusApi) statusApi.textContent = "TikTok / TikFinity";

  function toggle(id, title) {
    return `<label class="cs-toggle"><input id="${id}" type="checkbox"><span><strong>${title}</strong></span></label>`;
  }

  const provider = document.getElementById("cs-tiktok-provider");
  if (provider && ![...provider.options].some((option) => option.value === "eulerstream")) provider.value = "tikfinity";

  // The original settings module starts its async load after registering handlers.
  // Keep compatibility with its old ids, then correct the visible values on the next task.
  setTimeout(() => {
    const p = document.getElementById("cs-tiktok-provider");
    if (p && p.value === "eulerstream") p.value = "tikfinity";
  }, 0);
})();
