(() => {
  'use strict';
  const api = window.widgetWindow;
  if (!api?.status) return;
  const name = document.querySelector('#widgetWindowName');
  const status = document.querySelector('#widgetWindowStatus');
  const select = document.querySelector('#widgetWindowSlot');
  const reload = document.querySelector('#widgetWindowReload');
  const close = document.querySelector('#widgetWindowClose');
  const top = document.querySelector('#widgetWindowTop');
  const toolbar = document.querySelector('.widget-window-toolbar');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  let state = null, ownId = '', busy = false, lastError = '';
  function update(value) {
    if (value?.ok === false) throw Error(value.error || 'Die Änderung konnte nicht übernommen werden.');
    const next = value?.state || value;
    if (next?.windowId) ownId = next.windowId;
    if (Array.isArray(next?.slots) && Array.isArray(next?.windows)) state = next;
    render();
  }
  function render() {
    const own = state?.windows.find(item => item.id === ownId);
    toolbar.setAttribute('aria-busy',String(busy));
    name.textContent = own?.name || 'Zusatzfenster';
    status.textContent = lastError || own?.error || (own ? own.loading ? 'Seite wird geladen …' : 'Webseite geöffnet' : 'Einstellungen werden geladen …');
    status.dataset.error = String(!!(lastError || own?.error));
    status.title = lastError || own?.error || '';
    if (state) {
      const signature = JSON.stringify(state.slots.map(slot => [slot.id,slot.name,slot.url]));
      if (select.dataset.signature !== signature) {
        select.dataset.signature = signature;
        select.innerHTML = `<option value="">Adresse auswählen …</option>${state.slots.map((slot,index) => `<option value="${escape(slot.id)}" ${slot.url ? '' : 'disabled'}>${index + 1} · ${escape(slot.name || 'Freier Platz')}${slot.url ? '' : ' — leer'}</option>`).join('')}`;
      }
    }
    select.value = own?.slotId || '';
    select.disabled = busy || !own;
    reload.disabled = busy || !own?.open;
    close.disabled = busy || !own;
    top.checked = !!own?.alwaysOnTop;
    top.disabled = busy || !own;
  }
  async function request(operation) {
    if (busy) return;
    busy = true;lastError = '';render();
    try {update(await operation());}
    catch (error) {lastError = error.message || String(error);}
    finally {busy = false;render();}
  }
  select.addEventListener('change',() => {const slotId = select.value;if (slotId) request(() => api.select({slotId}));});
  reload.addEventListener('click',() => request(() => api.reload()));
  close.addEventListener('click',() => request(() => api.close()));
  top.addEventListener('change',() => {const value = top.checked;request(() => api.alwaysOnTop({value}));});
  api.onUpdate?.(value => {try {update(value);} catch (error) {lastError = error.message || String(error);render();}});
  render();request(() => api.status());
})();
