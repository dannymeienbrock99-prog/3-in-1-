(() => {
  'use strict';
  const root = document.getElementById('touch-deck-root');
  if (!root) return;
  const detached = document.body.hasAttribute('data-td-detached');
  const $ = id => document.getElementById('td-' + id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => crypto.randomUUID();
  const symbols = ['◆', '▶', '⏸', '■', '🎙', '🔊', '🔇', '📷', '💡', '🌡', '🌀', '📁', '↗', '★'];
  let state, draft, catalog = {actions:[]}, path = [], selected = -1;
  let dirty = false, editing = false, busy = false, loading = false, initialized = false;
  let sensorTimer, pollBusy = false, catalogBusy = false, dragIndex = -1, confirmCallback, pendingFocus;
  let packages = {plugins:[],iconPacks:[]}, packagesLoaded = false, presentation = {};
  let draftRevision, conflict = false, libraryItem = null, libraryPack = '', libraryOffset = 0, libraryRequest = 0, libraryTotal = 0;
  let presenceKey = '';
  let layoutFrame;
  let pairingUrl = '', clipboardButton = null, contextTarget = null, contextRequest = 0;
  let longPressTimer, longPressPointer = null, longPressTriggered = false, suppressKeyClickUntil = 0;
  let audioTargets = [], audioValues = {}, audioTimer, audioBusy = false, audioEpoch = 0;
  let pendingEditRequest;
  const volumeWrites = new Map();
  const active = () => !document.hidden && !window.BattoResources?.suspended && document.getElementById('view-touchdeck')?.classList.contains('active');
  const call = (command, value) => window.batto.touch(command, value);
  const configOf = value => ({version:1, activeProfile:value.activeProfile, profiles:clone(value.profiles)});
  const profile = () => draft?.profiles.find(item => item.id === draft.activeProfile) || draft?.profiles[0];
  const page = () => { let items = profile()?.buttons || []; for (const index of path) { if (items[index]?.type !== 'folder') return []; items = items[index].buttons; } return items; };
  const current = () => page()[selected];
  const option = (id, name, value) => `<option value="${esc(id)}"${String(id) === String(value) ? ' selected' : ''}>${esc(name)}</option>`;
  function message(text, error = false) { if (!$('message')) return; $('message').textContent = text; $('message').classList.toggle('td-error', error); }
  function cleanError(error) { return String(error?.message || error).replace(/^Error invoking remote method [^:]+: Error: /, ''); }
  function run(fn) {
    return async event => {
      event?.preventDefault();
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      const locked = [...root.querySelectorAll('button, input, select')].map(el => [el, el.disabled]);
      locked.forEach(([el]) => { el.disabled = true; });
      try { await fn(event); }
      catch (error) { message(cleanError(error), true); }
      finally {
        busy = false;
        root.removeAttribute('aria-busy');
        locked.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
        if (pendingFocus) { $(pendingFocus)?.focus(); pendingFocus = null; }
        status(); scheduleSensors();
      }
    };
  }
  const on = (id, fn) => $(id)?.addEventListener('click', run(fn));
  function changed() { dirty = true; status(); }
  function status() {
    if (!initialized) return;
    $('save').disabled = busy || !dirty || conflict;
    $('discard').disabled = busy || !dirty;
    $('dirty').textContent = conflict ? 'In einem anderen Fenster geändert · bitte neu laden' : dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert';
    $('dirty').classList.toggle('td-unsaved', dirty);
    $('mode').textContent = editing ? 'Zur Bedienung' : 'Tasten bearbeiten';
    $('mode').setAttribute('aria-pressed', String(editing));
    $('mode-note').textContent = editing ? 'Bearbeiten: Taste wählen oder verschieben. Rechtsklick oder langes Drücken öffnet die Tastenoptionen.' : dirty ? 'Bitte zuerst speichern oder Änderungen verwerfen. Danach sind die Tasten wieder bedienbar.' : 'Bedienen: Taste auslösen oder Ordner öffnen. Tastenoptionen mit Rechtsklick oder langem Drücken.';
    root.classList.toggle('td-editing', editing);
    if ($('detach')) $('detach').textContent = state?.window?.detached || state?.detached ? 'Touch-Fenster zeigen' : 'Entkoppeln';
    if ($('top')) { const pinned = !!(state?.window?.alwaysOnTop ?? state?.alwaysOnTop); $('top').textContent = pinned ? 'Immer oben: An' : 'Immer oben: Aus'; $('top').setAttribute('aria-pressed', String(pinned)); }
    if ($('library').open) { $('library-prev').disabled = busy || libraryOffset <= 0; $('library-next').disabled = busy || libraryOffset + 24 >= libraryTotal; }
    root.querySelectorAll('[data-td-volume-controls] input, [data-td-volume-controls] button').forEach(element => { element.disabled = busy || dirty || editing || element.dataset.unavailable === 'true'; });
    fitDetachedKeys();
  }
  function ask(text, callback) {
    confirmCallback = callback;
    $('confirm-text').textContent = text;
    $('confirm').hidden = false;
    pendingFocus = 'confirm-no';
  }
  function closeConfirm() { $('confirm').hidden = true; confirmCallback = null; }
  function build() {
    root.classList.toggle('td-detached', detached);
    root.innerHTML = `<div class="td-heading"><div><h2>Batto Touch Deck</h2><p>${detached ? 'Dein separates Bedienfeld.' : 'Deine Tasten für Jarvis, Szenen, Bot und PC-Messwerte.'}</p></div><div class="td-heading-tools">${detached ? '<button id="td-top" aria-pressed="false">Immer oben: Aus</button><button id="td-attach">Andocken</button>' : '<button id="td-detach">Entkoppeln</button>'}<button id="td-mode" aria-pressed="false">Tasten bearbeiten</button></div></div>
      <div class="td-toolbar td-main-only"><button id="td-save" class="primary">Änderungen speichern</button><button id="td-discard">Verwerfen</button><span id="td-dirty" class="td-help"></span><div class="td-spacer"></div><button id="td-package-open">Plugins &amp; Icons</button><button id="td-import">Projekt importieren</button><button id="td-export">Exportieren</button></div>
      <div id="td-message" class="td-message" role="status" aria-live="polite"></div>
      <div id="td-confirm" class="td-confirm" hidden><span id="td-confirm-text"></span><div class="td-toolbar"><button id="td-confirm-yes">Bestätigen</button><button id="td-confirm-no" class="primary">Abbrechen</button></div></div>
      <article class="td-panel"><div class="td-profilebar"><label>Profil<select id="td-profile" aria-label="Touch-Deck-Profil"></select></label><label class="td-edit-only">Name<input id="td-profile-name" maxlength="60"></label><button id="td-profile-add" class="td-edit-only">Neues Profil</button><button id="td-profile-delete" class="td-edit-only td-danger">Profil löschen</button><label class="td-edit-only">Raster<select id="td-grid-size"><option value="3x2">3 × 2 · große Tasten</option><option value="5x3">5 × 3 · Standard</option><option value="8x4">8 × 4 · viele Tasten</option></select></label><label class="td-key-size-mode">Tastengröße<select id="td-key-size-mode"><option value="auto">Automatisch</option><option value="custom">Selbst einstellen</option></select></label><label id="td-key-size-wrap" class="td-key-size-range" hidden><span>Tasten: <output id="td-key-size-value">140 px</output></span><input id="td-key-size" type="range" min="80" max="220" step="10" value="140" aria-label="Tastengröße in Pixeln"></label></div>
      <div class="td-workspace"><div class="td-deck-area"><nav id="td-breadcrumb" class="td-breadcrumb" aria-label="Touch-Deck-Ordner"></nav><p id="td-mode-note" class="td-help"></p><div id="td-grid" class="td-grid" aria-label="Touch-Deck-Tasten"></div></div><aside id="td-editor" class="td-editor td-edit-only" aria-label="Taste bearbeiten"></aside></div></article>
      <details class="td-panel td-mobile-panel"><summary>Handy &amp; Tablet verbinden <span id="td-mobile-summary" class="td-help"></span></summary><p class="td-help">Im selben privaten WLAN den QR-Code mit dem Handy oder Tablet scannen. Alternativ die Adresse öffnen und die PIN eingeben. Der Handy-Dienst läuft nur bei eingeschalteter Verbindung, auch im Gaming-Modus.</p><div id="td-mobile"></div></details>
      <div id="td-context" class="td-context-menu" role="menu" aria-label="Tastenoptionen" hidden><span id="td-context-title" class="td-context-title"></span><button id="td-context-edit" role="menuitem">Bearbeiten</button><button id="td-context-copy" role="menuitem">Kopieren</button><button id="td-context-paste" role="menuitem">Einfügen</button><button id="td-context-delete" role="menuitem" class="td-danger">Löschen</button></div>
      <p class="td-footnote td-main-only">Das Touch Deck nutzt die vorhandenen Batto-Aktionen. PC-Werte werden nur bei sichtbaren Messwert-Tasten aktualisiert.</p>
      <dialog id="td-packages-dialog" class="td-dialog" aria-labelledby="td-packages-title"><div class="td-dialog-heading"><h3 id="td-packages-title">Plugins &amp; Icon-Pakete</h3><button id="td-packages-close" aria-label="Paketverwaltung schließen">Schließen</button></div><p class="td-help">Lade eine .streamDeckPlugin- oder .streamDeckIconPack-Datei. Plugins können zusätzliche Programme oder Dienste benötigen. Nicht jedes Stream-Deck-Plugin unterstützt diesen Host.</p><button id="td-package-import" class="primary">Paket laden</button><div id="td-packages-list"></div><p id="td-packages-message" class="td-help" role="status"></p></dialog>
      <dialog id="td-library" class="td-dialog" aria-labelledby="td-library-title"><div class="td-dialog-heading"><h3 id="td-library-title">Icon auswählen</h3><button id="td-library-close">Schließen</button></div><label>Icon-Paket<select id="td-library-pack"></select></label><div id="td-library-icons" class="td-icon-library"></div><div class="td-toolbar"><button id="td-library-prev">Zurück</button><span id="td-library-page" class="td-help"></span><button id="td-library-next">Weiter</button><div class="td-spacer"></div><button id="td-library-import">Icon-Paket laden</button></div><p id="td-library-message" class="td-help" role="status"></p></dialog>`;
    on('save', save);
    on('discard', () => ask('Alle ungespeicherten Änderungen am Touch Deck verwerfen?', () => { adopt(state, true); message('Änderungen verworfen.'); }));
    on('mode', async () => { if (detached) { await call('edit-main'); return; } if (!editing) { await refreshCatalog(); await refreshPackages(); } editing = !editing; selected = -1; render(); });
    on('detach', () => call('detach'));
    on('attach', () => call('attach'));
    on('top', async () => { const next = await call('always-on-top', !(state?.window?.alwaysOnTop ?? state?.alwaysOnTop)); if (next?.profiles) adopt(next); });
    on('package-open', async () => { await refreshPackages(); renderPackages(); $('packages-dialog').showModal(); });
    on('package-import', async () => { try { const next = await call('package-import'); if (next && !next.canceled) { packages = next; packagesLoaded = true; renderPackages(); renderEditor(); $('packages-message').textContent = 'Paket geladen. Die Aktionen und Icons stehen jetzt im Tasten-Editor bereit.'; } } catch (error) { $('packages-message').textContent = cleanError(error); } });
    on('packages-close', () => $('packages-dialog').close());
    on('library-close', closeLibrary);
    $('library').addEventListener('close', () => { libraryRequest++; libraryItem = null; $('library-icons').replaceChildren(); });
    $('library-pack').onchange = run(async () => { libraryPack = $('library-pack').value; libraryOffset = 0; await loadLibraryPage(); });
    on('library-prev', async () => { libraryOffset = Math.max(0, libraryOffset - 24); await loadLibraryPage(); });
    on('library-next', async () => { libraryOffset += 24; await loadLibraryPage(); });
    on('library-import', async () => { try { const next = await call('package-import'); if (next && !next.canceled) { packages = next; packagesLoaded = true; libraryPack = packages.iconPacks?.at(-1)?.id || ''; libraryOffset = 0; renderLibraryPacks(); await loadLibraryPage(); } } catch (error) { $('library-message').textContent = cleanError(error); } });
    on('confirm-yes', async () => { const next = confirmCallback; closeConfirm(); await next?.(); });
    on('confirm-no', closeConfirm);
    on('profile-add', () => {
      if (draft.profiles.length >= 20) throw Error('Es sind höchstens 20 Profile möglich.');
      let name = 'Neues Profil', suffix = 2;
      while (draft.profiles.some(p => p.name === name)) name = 'Neues Profil ' + suffix++;
      const p = {id:uid(),name,columns:5,rows:3,keySize:'auto',buttons:Array(15).fill(null)};
      draft.profiles.push(p); draft.activeProfile = p.id; path = []; selected = -1; changed(); render(); pendingFocus = 'profile-name';
    });
    on('profile-delete', () => {
      if (draft.profiles.length <= 1) throw Error('Mindestens ein Profil muss bleiben.');
      const item = profile();
      ask(`Profil „${item.name}“ mit seinen Tasten und Ordnern löschen?`, () => { draft.profiles = draft.profiles.filter(p => p.id !== item.id); draft.activeProfile = draft.profiles[0].id; path = []; selected = -1; changed(); render(); });
    });
    $('profile').onchange = run(async () => { const wasDirty = dirty; draft.activeProfile = $('profile').value; path = []; selected = -1; closeConfirm(); changed(); render(); if (!wasDirty) { await save(); message(`Profil „${profile().name}“ ausgewählt.`); } });
    $('profile-name').oninput = () => { profile().name = $('profile-name').value; changed(); const selectedOption = $('profile').selectedOptions[0]; if (selectedOption) selectedOption.textContent = profile().name || 'Unbenannt'; renderBreadcrumb(); };
    $('key-size-mode').onchange = run(async () => { profile().keySize = $('key-size-mode').value === 'auto' ? 'auto' : Number($('key-size').value); changed(); renderSize(); applySize(); if (detached) await save(); });
    $('key-size').oninput = () => { profile().keySize = Number($('key-size').value); changed(); $('key-size-value').textContent = profile().keySize + ' px'; applySize(); };
    $('key-size').onchange = run(async () => { if (detached) await save(); });
    $('grid-size').onchange = () => {
      const p = profile(), [columns, rows] = $('grid-size').value.split('x').map(Number), size = columns * rows;
      const overflow = list => list.slice(size).some(Boolean) || list.some(item => item?.type === 'folder' && overflow(item.buttons || []));
      if (overflow(p.buttons)) { $('grid-size').value = `${p.columns}x${p.rows}`; message('Das kleinere Raster würde belegte Tasten abschneiden. Verschiebe oder lösche diese Tasten zuerst, auch in Ordnern.', true); return; }
      const resize = list => Array.from({length:size}, (_, index) => { const item = list[index] || null; if (item?.type === 'folder') item.buttons = resize(item.buttons || []); return item; });
      p.columns = columns; p.rows = rows; p.buttons = resize(p.buttons); selected = -1; changed(); render();
    };
    on('import', async () => {
      if (dirty) throw Error('Bitte Änderungen vor dem Import speichern oder verwerfen.');
      const next = await call('import');
      if (next && !next.canceled) { adopt(next, true); message('Touch-Deck-Projekt importiert. Prüfe die Tastenbelegungen vor dem Bedienen.'); }
    });
    on('export', async () => { if (dirty) throw Error('Bitte Änderungen vor dem Export speichern.'); const result = await call('export'); if (result?.ok || result?.saved) message('Touch-Deck-Projekt exportiert.'); });
    const grid = $('grid');
    const pressKey = run(async event => {
      if (Date.now() < suppressKeyClickUntil) return;
      closeContext(false);
      const tile = event.target.closest('[data-td-key]');
      if (!tile) return;
      const index = Number(tile.dataset.tdKey), item = page()[index];
      closeConfirm();
      if (editing) { selected = index; renderGrid(); renderEditor(); return; }
      if (item?.type === 'folder') { path.push(index); selected = -1; renderDeck(); return; }
      if (!item) return;
      if (item.type === 'sensor') { message('Diese Taste zeigt einen PC-Messwert an.'); return; }
      if (item.type === 'volume') return;
      if (dirty) throw Error('Bitte zuerst Änderungen speichern oder verwerfen.');
      const result = await call('press', {profileId:profile().id,path:[...path],index});
      if (result?.ok === false) throw Error(result.error || 'Die Tastenaktion konnte nicht ausgeführt werden.');
      message(`„${item.title || 'Taste ' + (index + 1)}“ ausgeführt.`);
    });
    grid.addEventListener('click', event => { if (!event.target.closest('[data-td-volume-controls]')) void pressKey(event); });
    grid.addEventListener('input', event => {
      if (!event.target.matches('[data-td-volume-range]')) return;
      queueVolume(Number(event.target.closest('[data-td-key]').dataset.tdKey), {volume:Number(event.target.value)});
    });
    grid.addEventListener('change', event => {
      if (event.target.matches('[data-td-volume-range]')) queueVolume(Number(event.target.closest('[data-td-key]').dataset.tdKey), {volume:Number(event.target.value)}, true);
    });
    grid.addEventListener('click', event => {
      const control = event.target.closest('[data-td-volume-step], [data-td-volume-mute]');
      if (!control) return;
      const index = Number(control.closest('[data-td-key]').dataset.tdKey), value = audioValues[page()[index]?.id];
      if (!value?.available) return;
      if (control.hasAttribute('data-td-volume-mute')) queueVolume(index, {muted:!value.muted}, true);
      else queueVolume(index, {volume:Math.max(0,Math.min(100, Math.round(value.volume) + Number(control.dataset.tdVolumeStep)))}, true);
    });
    grid.addEventListener('dragstart', event => {
      const tile = event.target.closest('[data-td-key]');
      if (!editing || busy || !tile || !page()[Number(tile.dataset.tdKey)]) { event.preventDefault(); return; }
      dragIndex = Number(tile.dataset.tdKey); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(dragIndex)); tile.classList.add('td-dragging');
    });
    grid.addEventListener('dragover', event => { if (editing && dragIndex >= 0 && event.target.closest('[data-td-key]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
    grid.addEventListener('drop', event => {
      const tile = event.target.closest('[data-td-key]');
      if (!editing || busy || dragIndex < 0 || !tile) return;
      event.preventDefault(); swap(dragIndex, Number(tile.dataset.tdKey)); dragIndex = -1;
    });
    grid.addEventListener('dragend', () => { dragIndex = -1; root.querySelectorAll('.td-dragging').forEach(el => el.classList.remove('td-dragging')); });
    grid.addEventListener('contextmenu', event => {
      const tile = event.target.closest('[data-td-key]');
      if (!tile) return;
      event.preventDefault(); cancelLongPress();
      if (busy) return;
      const bounds = tile.getBoundingClientRect();
      void openContext(Number(tile.dataset.tdKey), event.clientX || bounds.left + 20, event.clientY || bounds.top + 20);
    });
    grid.addEventListener('keydown', event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const tile = event.target.closest('[data-td-key]');
      if (!tile || busy) return;
      event.preventDefault();
      const bounds = tile.getBoundingClientRect();
      void openContext(Number(tile.dataset.tdKey), bounds.left + 20, bounds.top + 20);
    });
    grid.addEventListener('pointerdown', event => {
      cancelLongPress();
      if (busy || !['touch','pen'].includes(event.pointerType) || event.button !== 0) return;
      const tile = event.target.closest('[data-td-key]');
      if (!tile || event.target.closest('[data-td-volume-controls]')) return;
      longPressPointer = {id:event.pointerId,x:event.clientX,y:event.clientY};
      longPressTimer = setTimeout(() => {
        longPressTimer = null; longPressTriggered = true; suppressKeyClickUntil = Date.now() + 1200;
        void openContext(Number(tile.dataset.tdKey), event.clientX, event.clientY);
      }, 600);
    });
    grid.addEventListener('pointermove', event => { if (longPressPointer?.id === event.pointerId && Math.hypot(event.clientX - longPressPointer.x, event.clientY - longPressPointer.y) > 12) cancelLongPress(); });
    ['pointerup','pointercancel','pointerleave','dragstart'].forEach(name => grid.addEventListener(name, cancelLongPress));
    ['pointerup','pointercancel'].forEach(name => document.addEventListener(name, () => { if (longPressTriggered) { suppressKeyClickUntil = Date.now() + 750; longPressTriggered = false; } }, true));
    document.addEventListener('pointerdown', event => { if (contextTarget && !$('context').contains(event.target)) closeContext(false); });
    document.addEventListener('keydown', event => { if (contextTarget && event.key === 'Escape') { event.preventDefault(); closeContext(); } });
    document.addEventListener('scroll', () => closeContext(false), true);
    $('context').addEventListener('keydown', event => {
      if (event.key === 'Tab') { closeContext(false); return; }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...$('context').querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    });
    on('context-edit', async () => {
      const target = contextTarget; closeContext(false); if (!target) return;
      if (detached) { await call('edit-main', target); return; }
      await openEditorAt(target);
    });
    on('context-copy', async () => {
      const target = contextTarget, item = locate(target)?.items[target?.index]; closeContext();
      if (!item) return;
      clipboardButton = copyButton(item, false);
      await call('clipboard-set', clipboardButton);
      message('Taste kopiert. Mit „Einfügen“ setzt du sie auf eine andere Position oder in ein anderes Profil.');
    });
    on('context-paste', async () => {
      const target = contextTarget; closeContext(false);
      const source = await call('clipboard-get');
      if (!source) throw Error('Kopiere zuerst eine Taste.');
      await pasteAt(target, source);
    });
    on('context-delete', () => { const target = contextTarget; closeContext(false); deleteAt(target); });
  }
  function cancelLongPress() { clearTimeout(longPressTimer); longPressTimer = null; longPressPointer = null; }
  function locate(target) {
    if (!target || !Array.isArray(target.path) || !Number.isInteger(target.index)) return null;
    const targetProfile = draft?.profiles.find(value => value.id === target.profileId);
    if (!targetProfile) return null;
    let items = targetProfile.buttons;
    for (const index of target.path) { if (!Number.isInteger(index) || items[index]?.type !== 'folder') return null; items = items[index].buttons; }
    return target.index >= 0 && target.index < items.length ? {profile:targetProfile,items} : null;
  }
  function closeContext(restoreFocus = true) {
    const target = contextTarget; contextTarget = null; contextRequest++;
    if ($('context')) $('context').hidden = true;
    if (restoreFocus && target && target.profileId === profile()?.id && JSON.stringify(target.path) === JSON.stringify(path)) $('grid')?.querySelector(`[data-td-key="${target.index}"]`)?.focus();
  }
  async function openContext(index, x, y) {
    closeConfirm(); closeContext(false);
    const item = page()[index], menu = $('context');
    contextTarget = {profileId:profile().id,path:[...path],index};
    const request = ++contextRequest;
    $('context-title').textContent = item?.title || `Taste ${index + 1}`;
    $('context-edit').textContent = item ? 'Bearbeiten' : 'Taste belegen';
    $('context-copy').disabled = !item; $('context-delete').disabled = !item;
    $('context-paste').disabled = true;
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    $('context-edit').focus({preventScroll:true});
    try {
      const next = await call('clipboard-get');
      if (request !== contextRequest) return;
      clipboardButton = next || null; $('context-paste').disabled = !clipboardButton;
    } catch { /* Editing and deletion remain available if no clipboard can be read. */ }
  }
  function copyButton(source, renewIds = true, depth = 0, size = null) {
    if (!source || typeof source !== 'object' || !['action','plugin','sensor','folder','volume'].includes(source.type)) throw Error('Diese Taste kann nicht kopiert werden.');
    const next = {id:renewIds ? uid() : source.id,type:source.type,title:source.title || '',symbol:source.symbol || '◆'};
    if (safeIcon(source.icon)) next.icon = source.icon;
    if (source.type === 'plugin') { next.pluginId = source.pluginId; next.actionId = source.actionId; }
    else if (source.type === 'volume') next.volumeTarget = source.volumeTarget;
    else if (source.type === 'sensor') next.sensorId = source.sensorId;
    else if (source.type === 'action') next.steps = clone(source.steps || []);
    else {
      if (depth >= 4) throw Error('Ordner können höchstens vier Ebenen tief angelegt werden. Wähle einen übergeordneten Ordner.');
      const buttons = Array.isArray(source.buttons) ? source.buttons : [];
      if (size !== null && buttons.slice(size).some(Boolean)) throw Error('Der kopierte Ordner enthält mehr belegte Tasten als in dieses Raster passen. Vergrößere zuerst das Raster.');
      next.buttons = Array.from({length:size ?? buttons.length}, (_, index) => buttons[index] ? copyButton(buttons[index], renewIds, depth + 1, size) : null);
    }
    return next;
  }
  async function openEditorAt(target) {
    await refreshCatalog(); await refreshPackages();
    if (target && !locate(target)) throw Error('Diese Taste wurde inzwischen verschoben. Wähle sie erneut.');
    if (target) { draft.activeProfile = target.profileId; path = [...target.path]; selected = target.index; }
    editing = true; render();
    if (dirty) message('Deine ungespeicherten Änderungen bleiben erhalten.');
    $('editor')?.scrollIntoView({block:'nearest'});
    $('title')?.focus();
  }
  function ensureTarget(target, expectedId) {
    const found = locate(target);
    if (!found || (found.items[target.index]?.id || null) !== expectedId) throw Error('Die Taste wurde inzwischen geändert. Öffne ihre Optionen erneut.');
    if (conflict) throw Error('Das Touch Deck wurde in einem anderen Fenster geändert. Lade zuerst den aktuellen Stand.');
    return found;
  }
  async function finishContextChange(target, text) {
    if (!detached) editing = true;
    draft.activeProfile = target.profileId; path = [...target.path]; selected = target.index;
    changed(); render();
    if (detached) { await save(); message(text + ' Gespeichert.'); }
    else message(text + ' Zum Übernehmen speichern.');
  }
  async function pasteAt(target, source) {
    const found = locate(target);
    if (!found) throw Error('Diese Position ist nicht mehr verfügbar.');
    const next = copyButton(source, true, target.path.length, found.profile.columns * found.profile.rows);
    const previous = found.items[target.index], expectedId = previous?.id || null;
    const paste = async () => { ensureTarget(target, expectedId).items[target.index] = next; await finishContextChange(target, 'Taste eingefügt.'); };
    if (previous) ask(`„${previous.title || 'Taste ' + (target.index + 1)}“${previous.type === 'folder' ? ' und seinen Inhalt' : ''} durch die kopierte Taste ersetzen?`, paste);
    else await paste();
  }
  function deleteAt(target) {
    const item = locate(target)?.items[target?.index];
    if (!item) return;
    ask(`„${item.title || 'Taste ' + (target.index + 1)}“${item.type === 'folder' ? ' mit allen enthaltenen Tasten' : ''} löschen?`, async () => {
      ensureTarget(target, item.id).items[target.index] = null;
      await finishContextChange(target, 'Taste gelöscht.');
    });
  }
  function normalizePath() {
    let items = profile()?.buttons || [];
    for (let i = 0; i < path.length; i++) { if (items[path[i]]?.type !== 'folder') { path = path.slice(0, i); break; } items = items[path[i]].buttons; }
    if (selected >= page().length) selected = -1;
  }
  function adopt(next, force = false) {
    if (!next?.profiles?.length) return;
    const previous = draft && JSON.stringify(draft);
    const previousSaved = state?.profiles && JSON.stringify(configOf(state));
    const nextSaved = JSON.stringify(configOf(next));
    if (!force && dirty && previousSaved && previousSaved !== nextSaved) conflict = true;
    state = clone(next);
    if (next.presentation) presentation = next.presentation;
    if (force || !dirty) {
      const incoming = configOf(next);
      // Keep handlers attached to the same draft objects on metadata-only updates.
      if (force || previous !== JSON.stringify(incoming)) draft = incoming;
      dirty = false; conflict = false; draftRevision = next.revision; normalizePath(); if (force) { path = []; selected = -1; }
    }
    if (force || previous !== JSON.stringify(draft)) render();
    else { renderMobile(); updateSensorValues(); updatePluginValues(); status(); }
    if (next.error) message(next.error, true);
  }
  async function save() {
    if (conflict) {
      if (detached) { adopt(state, true); throw Error('Das Touch Deck wurde inzwischen im Hauptfenster geändert. Der aktuelle Stand wurde geladen; stelle die Größe bei Bedarf erneut ein.'); }
      throw Error('Das Touch Deck wurde inzwischen in einem anderen Fenster geändert. Verwirf deinen Entwurf, um den aktuellen Stand zu laden.');
    }
    if (!draft.profiles.every(p => p.name.trim())) throw Error('Bitte jedem Profil einen Namen geben.');
    let next;
    try { next = await call('save', {...clone(draft),baseRevision:draftRevision}); }
    catch (error) { if (detached) adopt(state, true); throw error; }
    const oldPath = [...path], oldSelected = selected;
    adopt(next, true); path = oldPath; selected = oldSelected; normalizePath(); render(); message('Touch Deck gespeichert. Die Tasten sind auch auf verbundenen Geräten verfügbar.');
  }
  function render() {
    if (!draft) return;
    closeContext(false);
    $('profile').innerHTML = draft.profiles.map(p => option(p.id, p.name || 'Unbenannt', draft.activeProfile)).join('');
    $('profile-name').value = profile().name;
    const size = `${profile().columns}x${profile().rows}`;
    const sizes = [['3x2','3 × 2 · große Tasten'],['5x3','5 × 3 · Standard'],['8x4','8 × 4 · viele Tasten']];
    if (!sizes.some(([id]) => id === size)) sizes.push([size,`${profile().columns} × ${profile().rows} · importiertes Raster`]);
    $('grid-size').innerHTML = sizes.map(([id,name]) => option(id,name,size)).join('');
    $('profile-delete').disabled = draft.profiles.length <= 1;
    renderSize();
    renderDeck(); renderMobile(); status();
  }
  function renderSize() {
    const size = profile().keySize, custom = Number.isFinite(size);
    $('key-size-mode').value = custom ? 'custom' : 'auto';
    $('key-size-wrap').hidden = !custom;
    if (custom) $('key-size').value = String(size);
    $('key-size-value').textContent = (custom ? size : $('key-size').value) + ' px';
  }
  function applySize() {
    const size = profile().keySize;
    $('grid').classList.toggle('td-grid-sized', Number.isFinite(size));
    if (Number.isFinite(size)) $('grid').style.setProperty('--td-key-size', `${Math.max(80, Math.min(220, size))}px`);
    else $('grid').style.removeProperty('--td-key-size');
  }
  function fitDetachedKeys() {
    if (!detached || !initialized || !active()) return;
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      const grid = $('grid');
      if (!grid || Number.isFinite(profile()?.keySize)) return;
      const css = getComputedStyle(grid), rows = profile().rows;
      const available = innerHeight - grid.getBoundingClientRect().top - 34 - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - (rows - 1) * parseFloat(css.rowGap);
      grid.style.setProperty('--td-tile-height', `${Math.max(80, Math.min(240, Math.floor(available / rows)))}px`);
    });
  }
  function renderDeck() { renderBreadcrumb(); renderGrid(); renderEditor(); scheduleSensors(); scheduleAudio(true); sendPresence(); }
  function renderBreadcrumb() {
    const crumbs = [{name:profile().name || 'Unbenannt', depth:0}];
    let items = profile().buttons;
    path.forEach((index, offset) => { crumbs.push({name:items[index]?.title || 'Ordner', depth:offset + 1}); items = items[index]?.buttons || []; });
    $('breadcrumb').innerHTML = crumbs.map(crumb => `<button data-td-depth="${crumb.depth}"${crumb.depth === path.length ? ' aria-current="page"' : ''}>${esc(crumb.name)}</button>`).join('<span aria-hidden="true">›</span>');
    $('breadcrumb').querySelectorAll('button').forEach(button => { button.onclick = () => { if (busy) return; path = path.slice(0, Number(button.dataset.tdDepth)); selected = -1; closeConfirm(); renderDeck(); }; });
  }
  function safeIcon(value) { return typeof value === 'string' && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(value) ? value : ''; }
  function sensorText(item) {
    const sensor = state?.sensors?.find(value => value.id === item.sensorId);
    if (!sensor || sensor.value === null || sensor.value === undefined || sensor.value === '' || !Number.isFinite(Number(sensor.value))) return '—';
    const value = Number(sensor.value), formatted = Number.isInteger(value) ? String(value) : value.toLocaleString('de-DE', {maximumFractionDigits:1});
    return `${formatted}${sensor.unit ? ' ' + sensor.unit : ''}`;
  }
  function renderGrid() {
    $('grid').style.setProperty('--td-columns', profile().columns);
    $('grid').style.setProperty('--td-rows', profile().rows);
    $('grid').classList.toggle('td-grid-dense', profile().columns > 5);
    $('grid').classList.toggle('td-grid-audio', page().some(item => item?.type === 'volume'));
    applySize();
    $('grid').innerHTML = page().map((item, index) => {
      const live = item?.type === 'plugin' ? presentation[item.id] || {} : {};
      const icon = safeIcon(item?.icon) || safeIcon(live.image), title = item?.title || (item?.type === 'folder' ? 'Ordner' : `Taste ${index + 1}`);
      if (item?.type === 'volume' && !editing) {
        const value = audioValues[item.id], available = !!value?.available && Number.isFinite(value.volume), volume = available ? Math.round(value.volume) : 0;
        return `<div class="td-key td-volume-key" data-td-key="${index}" tabindex="0" role="group" aria-label="Lautstärke ${esc(title)}" aria-haspopup="menu"><span class="td-key-number">${index + 1}</span><span class="td-volume-heading">${icon ? `<img src="${icon}" alt="">` : `<span aria-hidden="true">${esc(item.symbol || '🔊')}</span>`}<span class="td-key-title">${esc(title)}</span></span><div data-td-volume-controls="${index}" class="td-volume-controls"><output class="td-volume-value">${available ? (value.muted ? 'Stumm' : volume + ' %') : '—'}</output><input type="range" min="0" max="100" step="1" value="${volume}" aria-label="${esc(title)} Lautstärke" data-td-volume-range data-unavailable="${!available}"${!available || dirty ? ' disabled' : ''}><div class="td-volume-buttons"><button data-td-volume-step="-5" data-unavailable="${!available}" aria-label="${esc(title)} leiser"${!available || dirty ? ' disabled' : ''}>−</button><button data-td-volume-mute data-unavailable="${!available}" aria-label="${esc(title)} ${value?.muted ? 'einschalten' : 'stummschalten'}" aria-pressed="${!!value?.muted}"${!available || dirty ? ' disabled' : ''}>${value?.muted ? '🔇' : '🔊'}</button><button data-td-volume-step="5" data-unavailable="${!available}" aria-label="${esc(title)} lauter"${!available || dirty ? ' disabled' : ''}>+</button></div></div></div>`;
      }
      return `<button class="td-key${!item ? ' td-empty' : ''}${editing && selected === index ? ' td-selected' : ''}" data-td-key="${index}" draggable="${editing && !!item}" aria-label="${esc(!item ? (editing ? 'Leere Taste ' + (index + 1) + ' belegen' : 'Leere Taste ' + (index + 1)) : title)}" aria-haspopup="menu"${editing ? ` aria-pressed="${selected === index}"` : ''}><span class="td-key-number">${index + 1}</span>${item ? `<span class="td-key-art">${icon ? `<img src="${icon}" alt="" draggable="false">` : `<span class="td-symbol" aria-hidden="true">${esc(item.symbol || (item.type === 'folder' ? '📁' : '◆'))}</span>`}${item.type === 'sensor' ? `<strong class="td-key-value" data-td-sensor-value="${index}">${esc(sensorText(item))}</strong>` : ''}</span><span class="td-key-title">${esc(title)}</span><span class="td-key-kind">${item.type === 'folder' ? 'Ordner öffnen' : item.type === 'sensor' ? 'PC-Messwert' : item.type === 'plugin' ? esc(live.error || live.title || 'Plugin') : item.steps?.length > 1 ? item.steps.length + ' Aktionen' : ''}</span>` : '<span class="td-plus" aria-hidden="true">+</span><span class="td-key-title">' + (editing ? 'Belegen' : 'Frei') + '</span>'}</button>`;
    }).join('');
  }
  function updateSensorValues() { $('grid')?.querySelectorAll('[data-td-sensor-value]').forEach(el => { const item = page()[Number(el.dataset.tdSensorValue)]; if (item?.type === 'sensor') el.textContent = sensorText(item); }); }
  function updatePluginValues() {
    if (!initialized || !active()) return;
    $('grid')?.querySelectorAll('[data-td-key]').forEach(tile => {
      const item = page()[Number(tile.dataset.tdKey)];
      if (item?.type !== 'plugin') return;
      const live = presentation[item.id] || {}, value = live.error || live.title || 'Plugin';
      const kind = tile.querySelector('.td-key-kind');
      if (kind && kind.textContent !== value) { kind.textContent = value; kind.title = value; }
      if (item.icon) return;
      const icon = safeIcon(live.image), art = tile.querySelector('.td-key-art');
      if (!art) return;
      if (icon) { let img = art.querySelector('img'); if (!img) { img = document.createElement('img'); img.alt = ''; img.draggable = false; art.replaceChildren(img); } if (img.getAttribute('src') !== icon) img.src = icon; }
      else if (art.querySelector('img')) { const span = document.createElement('span'); span.className = 'td-symbol'; span.textContent = item.symbol || '◆'; span.setAttribute('aria-hidden','true'); art.replaceChildren(span); }
    });
  }
  function sendPresence() {
    if (!initialized || !profile()) return;
    const next = {profileId:profile().id,visible:active()}, key = JSON.stringify(next);
    if (key === presenceKey) return;
    presenceKey = key;
    void call('presence', next).catch(() => { presenceKey = ''; });
  }
  function defaultStep(id = 'listen') {
    const definition = catalog.actions.find(item => item.id === id) || catalog.actions[0];
    if (!definition) return {action:'listen'};
    const step = {action:definition.id};
    if (definition.choices) step.target = definition.choices[0]?.id || '';
    if (definition.switch) step.op = 'toggle';
    if (definition.text) step.text = '';
    if (definition.transition) { step.transition = 'fade'; step.durationMs = 350; }
    return step;
  }
  function createButton(type) {
    if (type === 'folder' && path.length >= 4) { message('Ordner können höchstens vier Ebenen tief angelegt werden.', true); return false; }
    const item = {id:uid(),type,title:type === 'folder' ? 'Neuer Ordner' : type === 'sensor' ? 'PC-Messwert' : type === 'plugin' ? 'Plugin-Aktion' : type === 'volume' ? 'Lautstärke' : 'Jarvis fragen',symbol:type === 'folder' ? '📁' : type === 'sensor' ? '🌡' : type === 'plugin' ? '◆' : type === 'volume' ? '🔊' : '🎙'};
    if (type === 'folder') item.buttons = Array(profile().columns * profile().rows).fill(null);
    else if (type === 'sensor') item.sensorId = state?.sensors?.[0]?.id || '';
    else if (type === 'plugin') { item.pluginId = packages.plugins?.[0]?.id || ''; item.actionId = packages.plugins?.[0]?.actions?.[0]?.id || ''; }
    else if (type === 'volume') item.volumeTarget = audioTargets[0]?.id || 'master';
    else item.steps = [defaultStep()];
    page()[selected] = item; changed(); renderGrid(); renderEditor(); scheduleSensors(); return true;
  }
  function swap(from, to) {
    const items = page();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
    [items[from], items[to]] = [items[to], items[from]]; selected = to; changed(); renderGrid(); renderEditor(); message('Tasten getauscht. Zum Übernehmen speichern.');
  }
  function renderEditor() {
    const editor = $('editor');
    if (!editing) { editor.replaceChildren(); return; }
    if (selected < 0) { editor.innerHTML = '<h3>Taste bearbeiten</h3><p class="td-help">Wähle eine Taste im Deck. Du kannst Aktionen verbinden, Ordner anlegen oder einzelne PC-Werte anzeigen.</p>'; return; }
    const item = current();
    if (!item) {
      editor.innerHTML = `<h3>Taste ${selected + 1} belegen</h3><div class="td-create"><button id="td-create-action">Aktion / Kombination</button><button id="td-create-plugin">Plugin-Aktion</button><button id="td-create-volume">Lautstärkeregler</button><button id="td-create-folder">Ordner</button><button id="td-create-sensor">PC-Messwert</button></div><p class="td-help">Eine Kombination führt bis zu acht Aktionen nacheinander aus.</p>`;
      ['action','folder','sensor','plugin','volume'].forEach(type => on('create-' + type, () => createButton(type)));
      return;
    }
    editor.innerHTML = `<h3>Taste ${selected + 1}</h3><label>Beschriftung<input id="td-title" maxlength="80" value="${esc(item.title)}"></label><label>Art<select id="td-type">${[['action','Aktion / Kombination'],['plugin','Plugin-Aktion'],['volume','Lautstärkeregler'],['folder','Ordner'],['sensor','PC-Messwert']].map(([id, name]) => option(id,name,item.type)).join('')}</select></label>
      <div class="td-symbol-row"><label>Symbol<select id="td-symbol">${[...new Set([item.symbol || '◆', ...symbols])].map(symbol => option(symbol,symbol,item.symbol || '◆')).join('')}</select></label><button id="td-icon">Eigenes Bild</button><button id="td-icon-library">Icon-Bibliothek</button>${safeIcon(item.icon) ? '<button id="td-icon-remove" title="Eigenes Bild entfernen">Bild entfernen</button>' : ''}</div>
      <div id="td-type-editor"></div><hr><label>Tauschen mit<select id="td-move-target">${page().map((target, index) => index === selected ? '' : option(index, `${index + 1} · ${target?.title || 'Frei'}`, '')).join('')}</select></label><button id="td-move">Tasten tauschen</button><button id="td-delete" class="td-danger">Taste löschen</button>`;
    $('title').oninput = () => { item.title = $('title').value; changed(); renderGrid(); };
    $('symbol').onchange = () => { item.symbol = $('symbol').value; changed(); renderGrid(); };
    $('type').onchange = () => {
      const type = $('type').value;
      if (item.type === 'folder' && item.buttons?.some(Boolean)) { $('type').value = item.type; message('Ein belegter Ordner kann nicht umgewandelt werden. Verschiebe oder lösche zuerst seine Tasten.', true); return; }
      const title = item.title, symbol = item.symbol, icon = item.icon, id = item.id;
      if (!createButton(type)) { renderEditor(); return; } Object.assign(current(), {id,title,symbol}); if (icon) current().icon = icon; renderGrid(); renderEditor();
    };
    on('icon', async () => { const result = await call('icon'); const value = typeof result === 'string' ? result : result?.dataPNG || result?.icon; if (safeIcon(value)) { item.icon = value; changed(); renderGrid(); renderEditor(); } });
    on('icon-library', async () => { await refreshPackages(); libraryItem = item; libraryPack = packages.iconPacks?.some(pack => pack.id === libraryPack) ? libraryPack : packages.iconPacks?.[0]?.id || ''; libraryOffset = 0; renderLibraryPacks(); $('library').showModal(); await loadLibraryPage(); });
    on('icon-remove', () => { delete item.icon; changed(); renderGrid(); renderEditor(); });
    on('move', () => swap(selected, Number($('move-target').value)));
    on('delete', () => deleteAt({profileId:profile().id,path:[...path],index:selected}));
    if (item.type === 'folder') {
      $('type-editor').innerHTML = '<button id="td-folder-open" class="primary">Ordner bearbeiten</button><p class="td-help">Ordner haben das Raster dieses Profils. Über die Leiste über den Tasten gelangst du zurück.</p>';
      on('folder-open', () => { path.push(selected); selected = -1; renderDeck(); });
    } else if (item.type === 'sensor') {
      const sensors = state?.sensors || [], known = sensors.some(sensor => sensor.id === item.sensorId);
      $('type-editor').innerHTML = `<label>Messwert<select id="td-sensor">${!known ? option(item.sensorId || '', item.sensorId ? 'Gespeicherter Sensor · derzeit nicht verfügbar' : 'Messwert auswählen', item.sensorId) : ''}${sensors.map(sensor => option(sensor.id, sensor.name + (sensor.unit ? ' (' + sensor.unit + ')' : ''), item.sensorId)).join('')}</select></label><p class="td-help">Nicht verfügbare Messwerte zeigen „—“. Lüfterdrehzahlen und Prozentwerte erscheinen nur, wenn der Sensor sie liefert.</p><button id="td-sensors-refresh">Messwerte neu laden</button>`;
      $('sensor').onchange = () => { item.sensorId = $('sensor').value; changed(); renderGrid(); scheduleSensors(); };
      on('sensors-refresh', async () => { const next = await call('state', {sensorsOnly:true}); state.sensors = next.sensors || []; renderEditor(); updateSensorValues(); message('Verfügbare PC-Messwerte geladen.'); });
    } else if (item.type === 'plugin') renderPluginEditor(item);
    else if (item.type === 'volume') void renderVolumeEditor(item);
    else renderSteps(item);
  }
  async function refreshPackages() {
    const next = await call('packages');
    if (next && Array.isArray(next.plugins) && Array.isArray(next.iconPacks)) { packages = next; packagesLoaded = true; }
  }
  function renderPackages() {
    const plugins = packages.plugins || [], packs = packages.iconPacks || [];
    $('packages-list').innerHTML = `<h4>Plugins</h4>${plugins.length ? '<ul class="td-package-list">' + plugins.map(plugin => `<li><strong>${esc(plugin.name)}</strong><span>${esc(plugin.version || '')} · ${plugin.actions?.length || 0} Aktionen</span>${typeof plugin.compatibility === 'string' ? `<small>${esc(plugin.compatibility)}</small>` : ''}</li>`).join('') + '</ul>' : '<p class="td-help">Noch keine Plugins geladen. Batto-Aktionen kannst du auch ohne Plugin direkt belegen.</p>'}<h4>Icon-Pakete</h4>${packs.length ? '<ul class="td-package-list">' + packs.map(pack => `<li><strong>${esc(pack.name)}</strong><span>${Number(pack.count) || 0} Icons${pack.version ? ' · ' + esc(pack.version) : ''}</span></li>`).join('') + '</ul>' : '<p class="td-help">Noch kein Icon-Paket geladen. Eigene Bilder lassen sich im Tasten-Editor auswählen.</p>'}`;
  }
  function renderLibraryPacks() {
    $('library-pack').innerHTML = packages.iconPacks?.length ? packages.iconPacks.map(pack => option(pack.id, `${pack.name} · ${pack.count || 0} Icons`, libraryPack)).join('') : option('', 'Noch keine Icon-Pakete', '');
  }
  function closeLibrary() { $('library').close(); pendingFocus = 'icon-library'; }
  async function loadLibraryPage() {
    const request = ++libraryRequest;
    libraryTotal = 0;
    $('library-icons').replaceChildren();
    $('library-message').textContent = libraryPack ? 'Icons werden geladen …' : 'Lade zuerst ein Icon-Paket oder wähle im Editor „Eigenes Bild“.';
    $('library-page').textContent = '';
    $('library-prev').disabled = true; $('library-next').disabled = true;
    if (!libraryPack) return;
    try {
      const result = await call('pack-icons', {packId:libraryPack,offset:libraryOffset,limit:24});
      if (request !== libraryRequest || !$('library').open) return;
      const icons = result?.icons || [], total = Number(result?.total) || 0;
      libraryTotal = total;
      $('library-message').textContent = icons.length ? 'Tippe auf ein Icon, um es auf die gewählte Taste zu setzen.' : 'Dieses Paket enthält keine passenden Icons.';
      $('library-page').textContent = total ? `${libraryOffset + 1}–${Math.min(libraryOffset + icons.length, total)} von ${total}` : '0 Icons';
      $('library-prev').disabled = libraryOffset <= 0;
      $('library-next').disabled = libraryOffset + icons.length >= total;
      $('library-icons').innerHTML = icons.map((icon, index) => `<button class="td-library-icon" data-td-library-icon="${index}" title="${esc(icon.name)}" aria-label="Icon ${esc(icon.name)} auswählen">${safeIcon(icon.image) ? `<img src="${icon.image}" alt="" loading="lazy">` : '<span aria-hidden="true">◆</span>'}<span>${esc(icon.name)}</span></button>`).join('');
      $('library-icons').querySelectorAll('[data-td-library-icon]').forEach(button => { button.onclick = run(async () => {
        if (!libraryItem) return;
        const selectedIcon = icons[Number(button.dataset.tdLibraryIcon)];
        try {
          const next = await call('pack-icon', {packId:libraryPack,iconId:selectedIcon.id});
          const value = typeof next === 'string' ? next : next?.dataPNG || next?.icon;
          if (!safeIcon(value)) throw Error('Dieses Icon konnte nicht als Bild geladen werden.');
          if (!libraryItem) return;
          libraryItem.icon = value; changed(); renderGrid(); renderEditor(); closeLibrary(); message('Icon auf die Taste gesetzt. Zum Übernehmen speichern.');
        } catch (error) { $('library-message').textContent = cleanError(error); }
      }); });
    } catch (error) { if (request === libraryRequest) $('library-message').textContent = cleanError(error); }
  }
  function renderPluginEditor(item) {
    const plugins = packages.plugins || [], plugin = plugins.find(value => value.id === item.pluginId);
    const actions = plugin?.actions || [], action = actions.find(value => value.id === item.actionId);
    $('type-editor').innerHTML = `<label>Plugin<select id="td-plugin">${!plugin ? option(item.pluginId || '', item.pluginId ? 'Gespeichertes Plugin · nicht verfügbar' : 'Plugin auswählen', item.pluginId) : ''}${plugins.map(value => option(value.id,value.name,item.pluginId)).join('')}</select></label><label>Plugin-Aktion<select id="td-plugin-action">${!action ? option(item.actionId || '', item.actionId ? 'Gespeicherte Aktion · nicht verfügbar' : 'Aktion auswählen', item.actionId) : ''}${actions.map(value => option(value.id,value.name,item.actionId)).join('')}</select></label><button id="td-plugin-settings"${!action?.hasInspector ? ' disabled' : ''}>Plugin-Einstellungen</button><p class="td-help">${action?.hasInspector ? 'Öffnet die Einstellungen dieses Plugins. Die Tastenbelegung wird vorher gespeichert.' : action ? 'Diese Aktion bietet kein eigenes Einstellungsfenster.' : 'Lade ein Plugin über „Plugins & Icons“ und wähle eine Aktion aus.'}</p>${typeof plugin?.compatibility === 'string' ? `<p class="td-help">${esc(plugin.compatibility)}</p>` : ''}<button id="td-plugin-load">Plugin laden</button>`;
    $('plugin').onchange = () => { item.pluginId = $('plugin').value; const next = plugins.find(value => value.id === item.pluginId); item.actionId = next?.actions?.[0]?.id || ''; changed(); renderPluginEditor(item); };
    $('plugin-action').onchange = () => { item.actionId = $('plugin-action').value; changed(); renderPluginEditor(item); };
    on('plugin-settings', async () => { const buttonId = item.id; if (dirty) await save(); const result = await call('plugin-settings', {buttonId}); if (result?.ok === false) throw Error(result.error || 'Die Plugin-Einstellungen konnten nicht geöffnet werden.'); });
    on('plugin-load', async () => { const next = await call('package-import'); if (next && !next.canceled) { packages = next; packagesLoaded = true; renderPluginEditor(item); message('Plugin geladen. Wähle jetzt die gewünschte Aktion.'); } });
  }
  async function renderVolumeEditor(item, force = false) {
    const target = $('type-editor');
    const draw = () => {
      if (!target?.isConnected || current() !== item || item.type !== 'volume') return;
      const known = audioTargets.some(value => value.id === item.volumeTarget);
      target.innerHTML = `<label>Tonquelle<select id="td-volume-target">${!known ? option(item.volumeTarget || '', item.volumeTarget ? 'Gespeicherte Tonquelle · derzeit nicht verfügbar' : 'Tonquelle auswählen', item.volumeTarget) : ''}${audioTargets.map(value => option(value.id,value.name + (value.available === false ? ' · derzeit nicht aktiv' : ''),item.volumeTarget)).join('')}</select></label><button id="td-audio-refresh">Tonquellen neu laden</button><p class="td-help">Wähle die Gesamtlautstärke oder ein laufendes Programm. Programme erscheinen, sobald sie Ton ausgeben. Beschriftung und Bild kannst du frei wählen.</p><p class="td-help">In der Bedienung gibt es einen Schieberegler, + / − und Stumm. Für gut erreichbare Regler wird das Raster bei Bedarf etwas größer.</p>`;
      $('volume-target').onchange = () => { item.volumeTarget = $('volume-target').value; changed(); };
      on('audio-refresh', () => renderVolumeEditor(item, true));
    };
    if (!audioTargets.length || force) {
      target.innerHTML = '<p class="td-help" role="status">Tonquellen werden geladen …</p>';
      try { const next = await call('audio-targets'); if (Array.isArray(next)) audioTargets = next; }
      catch (error) { if (target?.isConnected) message('Tonquellen konnten nicht geladen werden: ' + cleanError(error), true); }
    }
    draw();
  }
  function updateAudioValues() {
    if (!initialized || !active()) return;
    $('grid')?.querySelectorAll('[data-td-volume-controls]').forEach(controls => {
      const item = page()[Number(controls.dataset.tdVolumeControls)], value = audioValues[item?.id], available = !!value?.available && Number.isFinite(value.volume);
      const slider = controls.querySelector('input'), output = controls.querySelector('output'), mute = controls.querySelector('[data-td-volume-mute]');
      if (!slider || !output || !mute) return;
      if (document.activeElement !== slider) slider.value = String(Math.round(value?.volume || 0));
      output.textContent = available ? value.muted ? 'Stumm' : Math.round(value.volume) + ' %' : '—';
      output.title = available ? value.name || '' : 'Tonquelle ist derzeit nicht verfügbar';
      mute.textContent = value?.muted ? '🔇' : '🔊'; mute.setAttribute('aria-pressed',String(!!value?.muted));
      mute.setAttribute('aria-label',`${item?.title || 'Tonquelle'} ${value?.muted ? 'einschalten' : 'stummschalten'}`);
      controls.querySelectorAll('input,button').forEach(element => { element.dataset.unavailable = String(!available); element.disabled = busy || dirty || editing || !available; });
    });
  }
  function scheduleAudio(immediate = false) {
    clearTimeout(audioTimer); audioTimer = null;
    if (!initialized || !active() || editing || !page().some(item => item?.type === 'volume')) return;
    audioTimer = setTimeout(async () => {
      audioTimer = null;
      if (!active() || editing || audioBusy) { scheduleAudio(); return; }
      audioBusy = true;
      try {
        const epoch = audioEpoch;
        const next = await call('audio-state',{profileId:profile().id,path:[...path]});
        if (epoch !== audioEpoch) return;
        const values = next?.values || {};
        for (const [id, pending] of volumeWrites) if (pending.pending || pending.sending) values[id] = audioValues[id];
        audioValues = values; updateAudioValues();
      } catch { audioValues = {}; updateAudioValues(); }
      finally { audioBusy = false; scheduleAudio(); }
    }, immediate ? 0 : 2500);
  }
  function queueVolume(index, patch, immediate = false) {
    const item = page()[index], value = audioValues[item?.id];
    if (busy || dirty || editing || item?.type !== 'volume' || !value?.available || !Number.isFinite(value.volume)) return;
    if (typeof patch.volume === 'number') patch.volume = Math.max(0,Math.min(100,Math.round(patch.volume)));
    let entry = volumeWrites.get(item.id);
    if (!entry && Object.keys(patch).every(field => value[field] === patch[field])) return;
    audioEpoch++;
    audioValues[item.id] = {...value,...patch}; updateAudioValues();
    if (!entry) { entry = {position:{profileId:profile().id,path:[...path],index,buttonId:item.id,baseRevision:draftRevision},pending:null,sending:false,timer:null}; volumeWrites.set(item.id,entry); }
    entry.pending ||= {};
    for (const field of Object.keys(patch)) {
      if (entry.sending && entry.inflight?.[field] === patch[field]) delete entry.pending[field];
      else entry.pending[field] = patch[field];
    }
    if (!Object.keys(entry.pending).length) entry.pending = null;
    if (immediate) { clearTimeout(entry.timer); entry.timer = null; void flushVolume(item.id, entry); }
    else if (!entry.timer && !entry.sending) entry.timer = setTimeout(() => { entry.timer = null; void flushVolume(item.id, entry); }, 180);
  }
  async function flushVolume(id, entry) {
    if (entry.sending || !entry.pending) return;
    const field = Object.hasOwn(entry.pending, 'volume') ? 'volume' : 'muted';
    const patch = {[field]:entry.pending[field]}; delete entry.pending[field];
    if (!Object.keys(entry.pending).length) entry.pending = null;
    entry.sending = true; entry.inflight = patch;
    try {
      const result = await call('volume',{...entry.position,...patch});
      if (result?.ok === false) throw Error(result.error || 'Die Lautstärke konnte nicht geändert werden.');
      if (result?.value) { audioValues[id] = {...result.value,...entry.pending}; updateAudioValues(); }
    } catch (error) { entry.pending = null; audioValues[id] = {...audioValues[id],volume:null,available:false}; updateAudioValues(); message(cleanError(error),true); scheduleAudio(true); }
    finally {
      entry.sending = false; entry.inflight = null;
      if (entry.pending) { clearTimeout(entry.timer); entry.timer = setTimeout(() => { entry.timer = null; void flushVolume(id,entry); },180); }
      else { clearTimeout(entry.timer); volumeWrites.delete(id); }
    }
  }
  function renderSteps(item) {
    const steps = item.steps || (item.steps = [defaultStep()]);
    $('type-editor').innerHTML = `<h4>Aktionen nacheinander</h4><div class="td-steps">${steps.map((step, index) => {
      const definition = catalog.actions.find(action => action.id === step.action);
      return `<fieldset class="td-step"><legend>Aktion ${index + 1}</legend><label>Aktion<select data-td-step="${index}" data-td-field="action">${!definition ? option(step.action,'Nicht verfügbare Aktion',step.action) : ''}${catalog.actions.map(action => option(action.id,action.name,step.action)).join('')}</select></label>${definition?.choices ? `<label>Ziel<select data-td-step="${index}" data-td-field="target">${!definition.choices.some(choice => choice.id === step.target) ? option(step.target || '', definition.choices.length ? 'Ziel auswählen' : 'Noch keine Einträge vorhanden',step.target) : ''}${definition.choices.map(choice => option(choice.id,choice.name || choice.title || choice.id,step.target)).join('')}</select></label>` : ''}${definition?.switch ? `<label>Schalten<select data-td-step="${index}" data-td-field="op">${[['toggle','Umschalten'],['on','Einschalten'],['off','Ausschalten']].map(([id,name]) => option(id,name,step.op || 'toggle')).join('')}</select></label>` : ''}${definition?.text ? `<label>Gespeicherter Befehl<input data-td-step="${index}" data-td-field="text" maxlength="500" value="${esc(step.text)}" placeholder="Zum Beispiel: Wie warm ist die Grafikkarte?"></label>` : ''}${definition?.transition ? `<div class="td-two"><label>Übergang<select data-td-step="${index}" data-td-field="transition">${[['fade','Überblenden'],['cut','Schnitt']].map(([id,name]) => option(id,name,step.transition || 'fade')).join('')}</select></label><label>Dauer (ms)<input data-td-step="${index}" data-td-field="durationMs" type="number" min="100" max="2000" step="50" value="${esc(step.durationMs ?? 350)}"></label></div>` : ''}<div class="td-step-tools"><button data-td-up="${index}"${index === 0 ? ' disabled' : ''} aria-label="Aktion ${index + 1} nach oben">↑</button><button data-td-down="${index}"${index === steps.length - 1 ? ' disabled' : ''} aria-label="Aktion ${index + 1} nach unten">↓</button><button data-td-remove-step="${index}"${steps.length === 1 ? ' disabled' : ''}>Entfernen</button></div></fieldset>`;
    }).join('')}</div><button id="td-step-add"${steps.length >= 8 ? ' disabled' : ''}>+ Aktion hinzufügen</button><p class="td-help">Szenen und Übergänge steuern die vorhandenen Batto-Ausgaben. Chat- und Bot-Aktionen verwenden deine bestehenden Einstellungen.</p>`;
    $('type-editor').querySelectorAll('[data-td-field]').forEach(input => {
      input.addEventListener(input.tagName === 'INPUT' ? 'input' : 'change', () => {
        if (busy) return;
        const index = Number(input.dataset.tdStep), field = input.dataset.tdField;
        if (field === 'action') { steps[index] = defaultStep(input.value); changed(); renderSteps(item); renderGrid(); return; }
        steps[index][field] = field === 'durationMs' ? Number(input.value) : input.value; changed();
      });
    });
    for (const direction of ['up','down']) $('type-editor').querySelectorAll(`[data-td-${direction}]`).forEach(button => { button.onclick = () => { if (busy) return; const index = Number(button.dataset[direction === 'up' ? 'tdUp' : 'tdDown']), next = index + (direction === 'up' ? -1 : 1); if (next < 0 || next >= steps.length) return; [steps[index], steps[next]] = [steps[next], steps[index]]; changed(); renderSteps(item); }; });
    $('type-editor').querySelectorAll('[data-td-remove-step]').forEach(button => { button.onclick = () => { if (busy || steps.length <= 1) return; steps.splice(Number(button.dataset.tdRemoveStep),1); changed(); renderSteps(item); renderGrid(); }; });
    on('step-add', () => { if (steps.length < 8) { steps.push(defaultStep()); changed(); renderSteps(item); renderGrid(); } });
  }
  function renderMobile() {
    if (!state || !$('mobile') || detached) return;
    const mobile = state.mobile || {}, urls = Array.isArray(mobile.urls) ? mobile.urls.filter(url => typeof url === 'string') : [];
    const clients = Array.isArray(mobile.clients) ? mobile.clients.length : Number(mobile.clients || 0);
    if (!urls.includes(pairingUrl)) pairingUrl = urls[0] || '';
    const qr = (Array.isArray(mobile.qrCodes) ? mobile.qrCodes : []).find(value => value.url === pairingUrl);
    $('mobile-summary').textContent = mobile.running ? `· Aktiv · ${clients} verbunden` : '· Aus';
    $('mobile').innerHTML = `<div class="td-toolbar"><span class="td-mobile-status${mobile.running ? ' td-online' : ''}">${mobile.running ? 'Verbindung eingeschaltet' : 'Verbindung ausgeschaltet'}</span><button id="td-mobile-toggle"${!mobile.running ? ' class="primary"' : ''}>${mobile.running ? 'Verbindung ausschalten' : 'Handy-Verbindung einschalten'}</button>${mobile.running ? '<button id="td-mobile-pin">Neue PIN / Geräte trennen</button>' : ''}</div>${mobile.running ? `<div class="td-pairing"><div class="td-qr-panel">${safeIcon(qr?.image) ? `<img id="td-pairing-qr" src="${qr.image}" width="224" height="224" alt="QR-Code zum Verbinden mit dem Batto Touch Deck"><span class="td-help">Mit der Kamera-App scannen</span>` : `<p class="td-help">${pairingUrl ? 'QR-Code wird vorbereitet. Die Adresse und PIN funktionieren bereits.' : 'Verbinde diesen PC mit deinem privaten WLAN oder LAN.'}</p>`}</div><div class="td-pairing-details">${urls.length > 1 ? `<label>Netzwerkadresse<select id="td-mobile-address">${urls.map(url => option(url,url,pairingUrl)).join('')}</select></label><p class="td-help">Wähle die Adresse des Netzwerks, in dem auch dein Handy oder Tablet ist.</p>` : ''}${urls.length ? `<div class="td-address"><code>${esc(pairingUrl)}</code><button id="td-mobile-copy" aria-label="Handy-Adresse kopieren">Kopieren</button></div>` : '<p class="td-help">Keine Netzwerkadresse verfügbar. Prüfe deine WLAN- oder LAN-Verbindung.</p>'}<div class="td-pairing-pin"><div><span class="td-help">PIN zum Verbinden</span><strong class="td-pin">${esc(mobile.pin || '—')}</strong></div><span class="td-help">${clients} Gerät${clients === 1 ? '' : 'e'} verbunden</span></div><p class="td-help">Der QR-Code enthält die PIN. Teile beides nur mit deinen Geräten. Eine neue PIN trennt alle verbundenen Geräte.</p><p class="td-help">iPhone / iPad: In Safari öffnen → Teilen → Zum Home-Bildschirm. Android: Die Touch-Deck-App oder deinen Browser verwenden.</p></div></div>` : ''}`;
    on('mobile-toggle', async () => { const next = await call(mobile.running ? 'mobile-stop' : 'mobile-start'); adopt(next); message(mobile.running ? 'Handy-Verbindung ausgeschaltet.' : 'Handy-Verbindung eingeschaltet. Scanne den QR-Code mit deinem Gerät.'); });
    on('mobile-pin', async () => { const next = await call('mobile-pin'); adopt(next); message('Neue PIN erstellt. Der QR-Code wurde erneuert. Verbundene Geräte müssen sich erneut anmelden.'); });
    on('mobile-copy', async () => { await window.batto.copyText(pairingUrl); message('Handy-Adresse kopiert.'); });
    if ($('mobile-address')) $('mobile-address').onchange = () => { pairingUrl = $('mobile-address').value; renderMobile(); $('mobile-address')?.focus(); };
  }
  function scheduleSensors() {
    clearTimeout(sensorTimer); sensorTimer = null;
    if (!initialized || !active() || !page().some(item => item?.type === 'sensor')) return;
    sensorTimer = setTimeout(async () => {
      sensorTimer = null;
      if (!active() || busy || pollBusy) { scheduleSensors(); return; }
      pollBusy = true;
      try { const next = await call('state', {sensorsOnly:true}); if (state) state.sensors = next.sensors || []; if (active()) updateSensorValues(); }
      catch { /* Keep unavailable values explicit; a visible action reports connection errors. */ if (state) state.sensors = []; if (active()) updateSensorValues(); }
      finally { pollBusy = false; scheduleSensors(); }
    }, 3000);
  }
  async function refreshCatalog() {
    if (catalogBusy) return;
    catalogBusy = true;
    try {
      const next = await call('catalog');
      if (Array.isArray(next?.actions)) {
        catalog = next;
        if (editing && !root.contains(document.activeElement)) renderEditor();
      }
    } catch (error) { message('Aktionen konnten nicht aktualisiert werden: ' + cleanError(error), true); }
    finally { catalogBusy = false; }
  }
  async function init() {
    if (initialized || loading) return;
    loading = true;
    root.innerHTML = '<p class="td-help" role="status">Touch Deck wird geladen …</p>';
    try {
      const [next, actions] = await Promise.all([call('state'), call('catalog')]);
      if (!next?.profiles?.length) throw Error('Touch-Deck-Profile konnten nicht geladen werden.');
      catalog = actions || {actions:[]};
      state = clone(next); draft = configOf(next); draftRevision = next.revision; presentation = next.presentation || {}; initialized = true; build(); render();
      if (next.error) message(next.error, true);
    } catch (error) { root.innerHTML = `<p class="td-message td-error" role="alert">${esc(cleanError(error))}</p><button id="td-retry">Erneut laden</button>`; $('retry').onclick = () => { void init(); }; }
    finally { loading = false; if (initialized && pendingEditRequest !== undefined) { const target = pendingEditRequest; pendingEditRequest = undefined; void openEditorAt(target).catch(error => message(cleanError(error),true)); } }
  }
  document.addEventListener('batto:view', () => { closeContext(false); cancelLongPress(); if (active()) { if (initialized) { void refreshCatalog(); updatePluginValues(); } else void init(); scheduleSensors(); } else { clearTimeout(sensorTimer); sensorTimer = null; } scheduleAudio(true); sendPresence(); });
  document.addEventListener('visibilitychange', () => { closeContext(false); cancelLongPress(); scheduleSensors(); scheduleAudio(true); sendPresence(); updatePluginValues(); fitDetachedKeys(); });
  window.addEventListener('resize', () => { closeContext(false); fitDetachedKeys(); });
  window.addEventListener('focus', sendPresence);
  window.batto.onPresentationState?.(() => queueMicrotask(() => { scheduleSensors(); scheduleAudio(true); sendPresence(); updatePluginValues(); }));
  window.batto.onTouchState?.(next => { if (initialized) adopt(next); });
  window.batto.onTouchEdit?.(target => { if (detached) return; if (!initialized) { pendingEditRequest = target || null; void init(); return; } void openEditorAt(target).catch(error => message(cleanError(error),true)); });
  window.batto.onTouchPresentation?.(next => { presentation = next || {}; updatePluginValues(); });
  if (active()) void init();
})();
