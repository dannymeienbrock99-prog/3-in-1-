(function (root, factory) {
  'use strict';
  const ui = factory();
  if (typeof module === 'object' && module.exports) module.exports = ui;
  if (root?.document && new URLSearchParams(root.location?.search || '').get('detached') !== '1') ui.mount(root.document.querySelector('#widgetWindowsRoot'), root.batto);
})(typeof window === 'object' ? window : null, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function address(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    let parsed;
    try { parsed = new URL(text); } catch { throw Error('Bitte eine vollständige Adresse mit https:// eingeben.'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) throw Error('Bitte eine HTTPS-Adresse ohne Zugangsdaten eingeben.');
    if (parsed.href.length > 2048) throw Error('Die Adresse darf höchstens 2048 Zeichen lang sein.');
    return parsed.href;
  }
  function captureSlot(id, name, url) {
    const label = String(name ?? '').trim();
    if (label.length > 80) throw Error('Der Name darf höchstens 80 Zeichen lang sein.');
    const href = address(url);
    if (href && !label) throw Error('Gib deiner Adresse zuerst einen Namen.');
    return {id, name:label, url:href};
  }
  function hostname(url) { try { return new URL(url).hostname; } catch { return ''; } }
  function background(value) {
    const fit = ['cover','contain','stretch'].includes(value?.fit) ? value.fit : 'cover';
    let imageUrl = '';
    if (value?.hasImage && value.imageUrl) {
      try {
        const parsed = new URL(value.imageUrl);
        if (parsed.protocol === 'file:' && (!parsed.hostname || parsed.hostname === 'localhost') && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) imageUrl = parsed.href;
      } catch {}
    }
    return {hasImage:!!imageUrl,name:imageUrl ? String(value?.name || 'Hintergrundbild') : '',fit,imageUrl};
  }
  function mount(host, api) {
    if (!host || !api?.widgetWindowsStatus) return;
    host.classList.add('widget-windows');
    host.innerHTML = `<div class="ww-intro"><div><span class="ww-kicker">DEINE STREAM-ANSICHTEN</span><h2>Zwei Fenster für deine Widgets</h2><p>Öffne TikFinity und weitere Webseiten neben deinem Stream. Jedes Fenster lässt sich unabhängig verschieben und vergrößern.</p></div><span class="ww-count">2 Zusatzfenster</span></div>
      <p class="ww-notice" role="status" aria-live="polite" data-ww-notice>Einstellungen werden geladen …</p>
      <p class="ww-error" role="alert" data-ww-error hidden></p>
      <div class="ww-windows" data-ww-windows></div>
      <p class="ww-background-hint">Hintergrundbilder erscheinen hinter transparenten Widgets. Webseiten mit eigenem Hintergrund können das Bild verdecken.</p>
      <section class="ww-address-book" aria-labelledby="ww-address-heading"><div class="ww-section-heading"><div><h3 id="ww-address-heading">Deine HTTPS-Adressen</h3><p>Sechs Plätze für TikFinity, Overlays und weitere Seiten. Speichere eine Adresse und wähle sie oben für dein Fenster aus.</p></div><span class="ww-count">6 Speicherplätze</span></div><div class="ww-slots" data-ww-slots></div></section>`;
    const notice = host.querySelector('[data-ww-notice]');
    const errorBox = host.querySelector('[data-ww-error]');
    const windowsHost = host.querySelector('[data-ww-windows]');
    const slotsHost = host.querySelector('[data-ww-slots]');
    const drafts = new Map();
    let state = {slots:[], windows:[]}, busy = false, message = '', error = '', windowsSignature = '', slotsSignature = '';
    const reportError = value => { error = String(value?.message ?? value ?? 'Die Änderung konnte nicht gespeichert werden.'); render(); };
    function accept(value) {
      if (value?.ok === false) throw Error(value.error || 'Die Änderung konnte nicht übernommen werden.');
      const next = value?.state || value;
      if (Array.isArray(next?.slots) && Array.isArray(next?.windows)) state = next;
      render();
    }
    async function request(operation, success) {
      if (busy) return;
      busy = true; error = ''; render();
      try { const result = await operation(); accept(result); if (success && !result?.canceled && !result?.cancelled) message = success; }
      catch (value) { error = String(value.message || value); }
      finally { busy = false; render(); }
    }
    function readDrafts() {
      for (const row of slotsHost.querySelectorAll('[data-ww-slot]')) {
        const id = row.dataset.wwSlot;
        if (!drafts.has(id)) continue;
        const previous = drafts.get(id);
        previous.name = row.querySelector('[name="name"]').value;
        previous.url = row.querySelector('[name="url"]').value;
      }
    }
    function render() {
      host.setAttribute('aria-busy', String(busy));
      notice.textContent = message || (state.slots.length ? 'Wähle eine gespeicherte Adresse und öffne das gewünschte Fenster.' : 'Einstellungen werden geladen …');
      errorBox.hidden = !error; errorBox.textContent = error;
      const nextSlotsSignature = state.slots.map(slot => slot.id).join('|');
      if (nextSlotsSignature !== slotsSignature) {
        readDrafts(); slotsSignature = nextSlotsSignature;
        slotsHost.innerHTML = state.slots.map((slot, index) => `<form class="ww-slot" data-ww-slot="${escape(slot.id)}"><div class="ww-slot-heading"><span class="ww-slot-number">${index + 1}</span><strong>Adresse ${index + 1}</strong><span class="ww-slot-saved" data-ww-saved>Leer</span></div><label>Name<input name="name" type="text" maxlength="80" autocomplete="off" placeholder="z. B. TikFinity" aria-label="Name für Adresse ${index + 1}"></label><label>HTTPS-Adresse<input name="url" type="url" maxlength="2048" autocomplete="off" spellcheck="false" placeholder="https://" aria-label="HTTPS-Adresse ${index + 1}"></label><div class="ww-slot-footer"><small data-ww-draft></small><button type="submit" data-ww-save>Speichern</button></div></form>`).join('');
      }
      for (const slot of state.slots) {
        if (!drafts.has(slot.id)) drafts.set(slot.id, {name:slot.name || '',url:slot.url || '',dirty:false});
        const draft = drafts.get(slot.id);
        if (!draft.dirty) {draft.name = slot.name || '';draft.url = slot.url || '';}
        const row = [...slotsHost.querySelectorAll('[data-ww-slot]')].find(item => item.dataset.wwSlot === slot.id);
        if (!row) continue;
        row.querySelector('[name="name"]').value = draft.name;
        row.querySelector('[name="url"]').value = draft.url;
        row.querySelector('[data-ww-saved]').textContent = slot.url ? 'Gespeichert' : 'Leer';
        row.querySelector('[data-ww-draft]').textContent = draft.dirty ? 'Noch nicht gespeichert' : slot.url ? hostname(slot.url) : 'Platz für deine nächste Ansicht';
        row.querySelector('[data-ww-save]').disabled = busy || !draft.dirty;
        row.querySelector('[name="name"]').disabled = busy;
        row.querySelector('[name="url"]').disabled = busy;
      }
      const nextWindowsSignature = JSON.stringify([state.windows.map(win => [win.id,win.name]),state.slots.map(slot => [slot.id,slot.name,slot.url])]);
      if (nextWindowsSignature !== windowsSignature) {
        windowsSignature = nextWindowsSignature;
        windowsHost.innerHTML = state.windows.map((win, index) => `<article class="ww-window" data-ww-window="${escape(win.id)}"><div class="ww-window-heading"><span class="ww-window-icon" aria-hidden="true">↗</span><div><h3>${escape(win.name || `Fenster ${index + 2}`)}</h3><small>Eigene Webseite · eigener Hintergrund</small></div><span class="ww-window-state" data-ww-state>Geschlossen</span></div><div class="ww-window-screen" data-ww-screen><img class="ww-background-preview" data-ww-background-preview alt="" hidden><span class="ww-screen-icon" data-ww-screen-icon aria-hidden="true">▧</span><strong data-ww-source>Noch keine Adresse</strong><small data-ww-hostname></small></div><div class="ww-background-controls"><div class="ww-background-heading"><strong>Hintergrundbild</strong><span data-ww-background-name>Kein Hintergrundbild</span></div><div class="ww-background-actions"><button type="button" data-ww-action="choose-background">Bild auswählen</button><button type="button" data-ww-action="clear-background">Bild entfernen</button><label>Bildanpassung<select data-ww-background-fit aria-label="Bildanpassung für ${escape(win.name || `Fenster ${index + 2}`)}"><option value="cover">Ausfüllen</option><option value="contain">Ganzes Bild</option><option value="stretch">Strecken</option></select></label></div></div><label class="ww-source-label">Gespeicherte Adresse<select data-ww-select aria-label="Adresse für ${escape(win.name || `Fenster ${index + 2}`)}"><option value="">Adresse auswählen …</option>${state.slots.map((slot, slotIndex) => `<option value="${escape(slot.id)}" ${slot.url ? '' : 'disabled'}>${slotIndex + 1} · ${escape(slot.name || 'Freier Platz')}${slot.url ? '' : ' — leer'}</option>`).join('')}</select></label><div class="ww-window-actions"><button class="primary" type="button" data-ww-action="open">↗ Fenster öffnen</button><button type="button" data-ww-action="reload">Neu laden</button><button type="button" data-ww-action="close">Schließen</button></div><div class="ww-window-footer"><label><input type="checkbox" data-ww-top> Immer im Vordergrund</label><small data-ww-detail>Öffnet sich erst auf deinen Klick.</small></div><p class="ww-window-error" data-ww-window-error hidden></p></article>`).join('');
      }
      for (const win of state.windows) {
        const card = [...windowsHost.querySelectorAll('[data-ww-window]')].find(item => item.dataset.wwWindow === win.id);
        if (!card) continue;
        const slot = state.slots.find(item => item.id === win.slotId);
        const image = background(win.background);
        const preview = card.querySelector('[data-ww-background-preview]');
        card.querySelector('[data-ww-screen]').dataset.hasBackground = String(image.hasImage);
        preview.hidden = !image.hasImage;
        if (image.hasImage) {
          if (preview.getAttribute('src') !== image.imageUrl) preview.src = image.imageUrl;
          preview.style.objectFit = image.fit === 'stretch' ? 'fill' : image.fit;
        } else preview.removeAttribute('src');
        card.querySelector('[data-ww-screen-icon]').hidden = image.hasImage;
        const imageName = card.querySelector('[data-ww-background-name]');
        imageName.textContent = image.name || 'Kein Hintergrundbild'; imageName.title = image.name;
        card.querySelector('[data-ww-background-fit]').value = image.fit;
        card.querySelector('[data-ww-background-fit]').disabled = busy || !image.hasImage;
        card.querySelector('[data-ww-action="choose-background"]').disabled = busy;
        card.querySelector('[data-ww-action="clear-background"]').disabled = busy || !image.hasImage;
        card.dataset.open = String(!!win.open);
        card.querySelector('[data-ww-state]').textContent = win.error ? 'Bitte prüfen' : win.open ? (win.loading ? 'Wird geladen …' : 'Geöffnet') : 'Geschlossen';
        card.querySelector('[data-ww-source]').textContent = slot?.name || 'Noch keine Adresse';
        card.querySelector('[data-ww-hostname]').textContent = hostname(win.url || slot?.url);
        card.querySelector('[data-ww-select]').value = win.slotId || '';
        card.querySelector('[data-ww-select]').disabled = busy;
        card.querySelector('[data-ww-action="open"]').textContent = win.open ? '↗ Fenster anzeigen' : '↗ Fenster öffnen';
        card.querySelector('[data-ww-action="open"]').disabled = busy || !slot?.url;
        card.querySelector('[data-ww-action="reload"]').disabled = busy || !win.open;
        card.querySelector('[data-ww-action="close"]').disabled = busy || !win.open;
        card.querySelector('[data-ww-top]').checked = !!win.alwaysOnTop;
        card.querySelector('[data-ww-top]').disabled = busy;
        card.querySelector('[data-ww-detail]').textContent = win.open ? (win.loading ? 'Die Webseite wird geladen.' : 'Position und Größe werden gemerkt.') : 'Öffnet sich erst auf deinen Klick.';
        card.querySelector('[data-ww-window-error]').hidden = !win.error;
        card.querySelector('[data-ww-window-error]').textContent = win.error || '';
      }
    }
    slotsHost.addEventListener('input', event => {
      const row = event.target.closest('[data-ww-slot]');
      if (!row) return;
      const draft = drafts.get(row.dataset.wwSlot);
      if (!draft) return;
      draft.name = row.querySelector('[name="name"]').value;
      draft.url = row.querySelector('[name="url"]').value;
      const saved = state.slots.find(slot => slot.id === row.dataset.wwSlot);
      draft.dirty = draft.name !== (saved?.name || '') || draft.url !== (saved?.url || '');
      row.querySelector('[data-ww-draft]').textContent = draft.dirty ? 'Noch nicht gespeichert' : saved?.url ? hostname(saved.url) : 'Platz für deine nächste Ansicht';
      row.querySelector('[data-ww-save]').disabled = busy || !draft.dirty;
    });
    slotsHost.addEventListener('submit', event => {
      event.preventDefault();
      const row = event.target.closest('[data-ww-slot]');
      if (!row || busy) return;
      let payload;
      try { payload = captureSlot(row.dataset.wwSlot,row.querySelector('[name="name"]').value,row.querySelector('[name="url"]').value); }
      catch (value) { reportError(value);return; }
      request(async () => {
        const result = await api.widgetWindowSaveSlot(payload);
        if (result?.ok === false) throw Error(result.error || 'Die Adresse konnte nicht gespeichert werden.');
        drafts.set(payload.id,{name:payload.name,url:payload.url,dirty:false});
        return result;
      }, payload.url ? 'Adresse gespeichert. Du kannst sie jetzt für ein Fenster auswählen.' : 'Der Speicherplatz wurde geleert.');
    });
    windowsHost.addEventListener('change', event => {
      const card = event.target.closest('[data-ww-window]');
      if (!card || busy) return;
      if (event.target.matches('[data-ww-select]')) {
        const slotId = event.target.value;
        if (slotId) request(() => api.widgetWindowSelect({id:card.dataset.wwWindow,slotId}));
      } else if (event.target.matches('[data-ww-top]')) {
        const value = event.target.checked;
        request(() => api.widgetWindowAlwaysOnTop({id:card.dataset.wwWindow,value}));
      } else if (event.target.matches('[data-ww-background-fit]')) {
        const fit = event.target.value;
        request(() => api.widgetWindowSetBackground({id:card.dataset.wwWindow,fit}));
      }
    });
    windowsHost.addEventListener('click', event => {
      const button = event.target.closest('[data-ww-action]');
      const card = button?.closest('[data-ww-window]');
      if (!card || button.disabled || busy) return;
      const id = card.dataset.wwWindow;
      const action = button.dataset.wwAction;
      if (action === 'open') request(() => api.widgetWindowOpen({id,slotId:card.querySelector('[data-ww-select]').value}));
      else if (action === 'reload') request(() => api.widgetWindowReload({id}));
      else if (action === 'close') request(() => api.widgetWindowClose({id}));
      else if (action === 'choose-background') request(() => api.widgetWindowChooseBackground({id}), 'Hintergrundbild gespeichert. Es gilt nur für dieses Zusatzfenster.');
      else if (action === 'clear-background') request(() => api.widgetWindowClearBackground({id}), 'Hintergrundbild entfernt.');
    });
    api.onWidgetWindowsUpdate?.(value => { try { accept(value); } catch (value) { reportError(value); } });
    render(); request(() => api.widgetWindowsStatus());
    return {update:accept};
  }
  return {address,captureSlot,hostname,background,mount};
});
