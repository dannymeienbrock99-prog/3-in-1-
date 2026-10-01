(() => {
  'use strict';
  const valid = value => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && u.hostname === 'tikfinity.zerody.one'
        && u.pathname === '/widget/gifts' && !u.username && !u.password && !u.port ? u.href : '';
    } catch { return ''; }
  };
  let panel, frame;
  function applyGifts() {
    if (detached || !S.config) return;
    const c = S.config.appearance?.chatWidgets || {};
    const url = c.enabled !== false && c.giftsEnabled !== false ? valid(c.giftsUrl) : '';
    if (!panel) {
      const history = document.querySelector('.moderation-card .history-wrap');
      if (!history) return;
      panel = document.createElement('section');
      panel.className = 'dashboard-gifts';
      panel.setAttribute('aria-labelledby', 'dashboardGiftsTitle');
      panel.innerHTML = '<h3 id="dashboardGiftsTitle">TikTok-Geschenke</h3><div class="dashboard-gifts-viewport"><p data-resource-note>Sparmodus · Bei Bedarf oben „Widgets starten“ wählen.</p></div>';
      history.append(panel);
    }
    panel.hidden = !url;
    panel.closest('.moderation-card').classList.toggle('has-gift-widget', Boolean(url));
    if (!url) { frame?.remove(); frame = null; return; }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'dashboard-gifts-frame';
      frame.title = 'TikFinity – empfangene TikTok-Geschenke';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.tabIndex = -1;
      panel.querySelector('.dashboard-gifts-viewport').append(frame);
    }
    // Keep the widget session when unrelated settings or chat content update.
    if (window.BattoResources) { window.BattoResources.setFrameSource(frame, url); window.BattoResources.refresh(); }
    else if (frame.getAttribute('src') !== url) frame.src = url;
  }
  const baseWidgets = window.applyChatWidgets;
  window.applyChatWidgets = function () { baseWidgets?.(); applyGifts(); };
  const baseSettings = renderSettingsModule;
  renderSettingsModule = function () {
    baseSettings();
    const c = S.config.appearance?.chatWidgets || {};
    const box = document.createElement('section');
    box.className = 'panel-section';
    box.innerHTML = `<h3>TikTok-Geschenke im Dashboard</h3><p>Unter dem Moderationsverlauf: kompakte Anzeige mit verkleinerten Bildern und Texten. Geschenke erscheinen, sobald TikFinity sie an das Widget überträgt.</p><label class="check"><input id="giftsEnabled" type="checkbox" ${c.giftsEnabled !== false ? 'checked' : ''}>Geschenk-Widget anzeigen</label><label for="giftsUrl">TikFinity-Geschenke-URL</label><input id="giftsUrl" type="url" value="${esc(c.giftsUrl || '')}" placeholder="https://tikfinity.zerody.one/widget/gifts?cid=…"><div class="toolbar"><button id="giftsSave" class="primary">Geschenk-Widget speichern</button></div>`;
    document.querySelector('#settingsModule').append(box);
    box.querySelector('#giftsSave').onclick = async () => {
      try {
        const giftsUrl = box.querySelector('#giftsUrl').value.trim();
        if (giftsUrl && !valid(giftsUrl)) throw new Error('Bitte eine HTTPS-Adresse von tikfinity.zerody.one/widget/gifts eintragen.');
        await saveAndSync({ appearance: { chatWidgets: {
          giftsEnabled: box.querySelector('#giftsEnabled').checked, giftsUrl
        } } }, 'Geschenk-Widget gespeichert.');
      } catch (error) { toast(error.message, true); }
    };
  };
  applyGifts();
})();
