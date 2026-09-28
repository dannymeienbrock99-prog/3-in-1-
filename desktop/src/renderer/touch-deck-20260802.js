"use strict";
(() => {
  const api = window.batto;
  const host = document.getElementById("view-deck-0802");
  if (!api || !host) return;

  let launching = false;

  function showDeckView() {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view === host));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === "deck-0802"));
    const title = document.getElementById("page-title");
    const subtitle = document.getElementById("page-subtitle");
    if (title) title.textContent = "Touch-Deck";
    if (subtitle) subtitle.textContent = "Original vom 02.08.2026 · unverändert aus dem damaligen Projektstand.";
  }

  function render(status = {}) {
    host.innerHTML = `<div class="touchdeck-original-shell">
      <article class="panel touchdeck-original-card">
        <div>
          <span class="eyebrow">ORIGINAL · 02.08.2026</span>
          <h2>CreatorHub Touch Deck</h2>
          <p>Hier wird nicht mehr das nachgebaute Touch-Deck Pro verwendet. Batto startet das originale WPF-TouchDeck direkt aus dem damaligen GitHub-Commit.</p>
          <dl class="details-list">
            <div><dt>Quelle</dt><dd>CrazyBattoSoftwareManager_vol.1</dd></div>
            <div><dt>Commit</dt><dd><code>51be33d29c07f50323b19d58782804af391b8394</code></dd></div>
            <div><dt>Stand</dt><dd>02.08.2026</dd></div>
            <div><dt>Status</dt><dd id="td-original-status">${status.available ? "Original vorhanden" : "Original fehlt in diesem Build"}</dd></div>
          </dl>
        </div>
        <div class="touchdeck-original-actions">
          <button id="td-open-original" class="primary" ${status.available ? "" : "disabled"}>Original Touch-Deck öffnen</button>
          <button id="td-check-original">Erneut prüfen</button>
        </div>
        <output id="td-original-message" class="inline-message"></output>
      </article>
    </div>`;
    host.querySelector("#td-open-original")?.addEventListener("click", () => void launch());
    host.querySelector("#td-check-original")?.addEventListener("click", () => void refresh());
  }

  async function refresh() {
    try {
      const status = await api.invoke("deck:original-0802-status");
      render(status || {});
      return status;
    } catch (error) {
      render({ available: false });
      const out = host.querySelector("#td-original-message");
      if (out) out.textContent = error?.message || String(error);
      return null;
    }
  }

  async function launch() {
    if (launching) return;
    launching = true;
    const button = host.querySelector("#td-open-original");
    const out = host.querySelector("#td-original-message");
    if (button) button.disabled = true;
    if (out) out.textContent = "Original Touch-Deck wird gestartet …";
    try {
      await api.invoke("deck:open-original-0802");
      if (out) out.textContent = "Original Touch-Deck gestartet.";
    } catch (error) {
      if (out) out.textContent = error?.message || String(error);
    } finally {
      launching = false;
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.('[data-view="deck-0802"]');
    if (!button) return;
    event.preventDefault();
    showDeckView();
    void refresh();
  });

  void refresh();
})();
