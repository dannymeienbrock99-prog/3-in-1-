"use strict";

(() => {
  const api = window.batto;
  if (!api?.invoke) return;

  const html = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const actionTransferType = "application/x-batto-touch-deck-action";
  const keyTransferType = "application/x-batto-touch-deck-key";
  const blankButton = (index) => ({
    id: `button-${index + 1}`,
    title: "",
    subtitle: "",
    icon: "",
    color: "#152130",
    textColor: "#ffffff",
    folderId: "",
    actions: [],
    enabled: true
  });

  let view = null;
  let state = null;
  let selectedIndex = -1;
  let draft = null;
  let draftDirty = false;
  let buttonClipboard = null;
  let libraryTab = "actions";
  let searchText = "";
  let gridSettingsOpen = true;
  const groupState = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function toast(message, error = false) {
    const target = document.getElementById("toast");
    if (!target) return;
    target.textContent = String(message || "");
    target.className = `toast${error ? " error" : ""}`;
    target.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { target.hidden = true; }, 3600);
  }

  async function call(channel, payload = {}) {
    try {
      return await api.invoke(channel, payload);
    } catch (error) {
      toast(error?.message || String(error), true);
      throw error;
    }
  }

  function profile() {
    const profiles = state?.deck?.profiles || [];
    const id = $("#tdp-profile")?.value || state?.deck?.activeProfileId;
    return profiles.find((entry) => entry.id === id) || profiles[0] || null;
  }

  function folder(currentProfile = profile()) {
    if (!currentProfile) return null;
    const id = $("#tdp-folder")?.value || currentProfile.activeFolderId || "root";
    return currentProfile.folders?.find((entry) => entry.id === id)
      || currentProfile.folders?.find((entry) => entry.id === "root")
      || currentProfile.folders?.[0]
      || null;
  }

  function actionCatalog() {
    const result = [];
    for (const plugin of state?.plugins?.plugins || []) {
      if (!plugin.enabled) continue;
      for (const action of plugin.actions || []) {
        result.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          pluginIcon: plugin.icon || "",
          pluginNative: Boolean(plugin.native),
          actionId: action.id,
          actionName: action.name,
          actionIcon: action.icon || action.states?.find((entry) => entry.image)?.image || plugin.icon || "",
          tooltip: action.tooltip || plugin.description || ""
        });
      }
    }
    return result.sort((a, b) => `${a.pluginName} ${a.actionName}`.localeCompare(`${b.pluginName} ${b.actionName}`, "de"));
  }

  function filteredPlugins() {
    const query = searchText.trim().toLocaleLowerCase("de");
    return (state?.plugins?.plugins || []).filter((plugin) => {
      if (!query) return true;
      return [plugin.name, plugin.description, plugin.category, ...(plugin.actions || []).flatMap((action) => [action.name, action.id])]
        .some((value) => String(value || "").toLocaleLowerCase("de").includes(query));
    });
  }

  function iconMarkup(icon, fallback = "◆") {
    return icon
      ? `<img src="${html(icon)}" alt="">`
      : `<span class="tdp-fallback-icon" aria-hidden="true">${html(fallback)}</span>`;
  }

  function pluginFallback(plugin) {
    const name = String(plugin?.name || "").toLowerCase();
    if (name.includes("youtube")) return "▶";
    if (name.includes("twitch")) return "◩";
    if (name.includes("discord")) return "◉";
    if (name.includes("obs")) return "◍";
    if (name.includes("music") || name.includes("spotify")) return "♫";
    if (name.includes("camera") || name.includes("obsbot")) return "◫";
    if (name.includes("window") || name.includes("launcher")) return "↔";
    return "◆";
  }

  function markup() {
    return `
      <div class="tdp-shell">
        <header class="tdp-heading">
          <div>
            <span class="eyebrow">PROFILE · ORDNER · PLUGIN-AKTIONEN</span>
            <h2>Touch-Deck Pro</h2>
            <p>Links Aktionen suchen, in der Mitte das Deck gestalten und rechts die ausgewählte Taste konfigurieren.</p>
          </div>
          <div class="button-row">
            <button id="tdp-import" type="button">Importieren</button>
            <button id="tdp-export" type="button">Exportieren</button>
          </div>
        </header>

        <section class="tdp-profilebar">
          <label>Profil<select id="tdp-profile"></select></label>
          <button id="tdp-add-profile" type="button">+ Profil</button>
          <label>Ordner<select id="tdp-folder"></select></label>
          <button id="tdp-back-folder" type="button">← Zurück</button>
          <button id="tdp-add-folder" type="button">+ Ordner</button>
          <button id="tdp-grid-settings" class="tdp-icon-button" type="button" aria-pressed="true" title="Rastereinstellungen ein- oder ausblenden">⚙</button>
        </section>

        <div class="tdp-editor-layout">
          <aside class="tdp-library" aria-label="Plugin- und Aktionsbibliothek">
            <div class="tdp-search-row">
              <span aria-hidden="true">⌕</span>
              <input id="tdp-search" type="search" placeholder="Suchen" autocomplete="off">
              <button id="tdp-rescan" type="button" title="Plugins neu scannen">☷</button>
            </div>
            <div class="tdp-library-tabs" role="tablist" aria-label="Bibliotheksansicht">
              <button id="tdp-tab-actions" class="active" type="button" role="tab" aria-selected="true"><span>▣</span>Tasten</button>
              <button id="tdp-tab-plugins" type="button" role="tab" aria-selected="false">Plugins</button>
            </div>
            <div id="tdp-library-content" class="tdp-library-content"></div>
          </aside>

          <main class="tdp-stage">
            <section id="tdp-grid-panel" class="tdp-grid-panel">
              <label>Zeilen<input id="tdp-rows" type="number" min="1" max="10"></label>
              <label>Spalten<input id="tdp-columns" type="number" min="1" max="10"></label>
              <label>Tastengröße<input id="tdp-size" type="number" min="64" max="260"></label>
              <label>Abstand<input id="tdp-gap" type="number" min="0" max="40"></label>
              <label class="tdp-check"><input id="tdp-hide-unused" type="checkbox"> Unbenutzte Tasten ausblenden</label>
              <button id="tdp-apply-grid" type="button">Raster übernehmen</button>
            </section>
            <div class="tdp-stage-meta">
              <span id="tdp-capacity">0 Tasten</span>
              <span id="tdp-draft-state">Alle Änderungen gespeichert</span>
            </div>
            <div class="tdp-grid-viewport">
              <div id="tdp-grid" class="tdp-grid" aria-label="Touch-Deck-Tasten"></div>
            </div>
            <p class="tdp-stage-help">Aktion links anklicken oder auf eine Taste ziehen. Tasten lassen sich untereinander verschieben.</p>
          </main>

          <aside class="tdp-inspector">
            <header>
              <div><h3>Taste bearbeiten</h3><p id="tdp-selected">Keine Taste ausgewählt.</p></div>
              <div class="tdp-mini-actions">
                <button id="tdp-copy-key" type="button" title="Taste kopieren">⧉</button>
                <button id="tdp-paste-key" type="button" title="Taste einfügen">▣</button>
              </div>
            </header>
            <div id="tdp-inspector-body" class="tdp-inspector-body">
              <label>Titel<input id="tdp-title" maxlength="120"></label>
              <label>Untertitel<input id="tdp-subtitle" maxlength="160"></label>
              <div class="tdp-two-fields">
                <label>Tastenfarbe<input id="tdp-color" type="color" value="#152130"></label>
                <label>Schriftfarbe<input id="tdp-text-color" type="color" value="#ffffff"></label>
              </div>
              <label>Zielordner<select id="tdp-target-folder"><option value="">Kein Ordner</option></select></label>
              <hr>
              <div class="tdp-subheading"><h3>Mehrfachaktionen</h3><span id="tdp-action-count">0</span></div>
              <div id="tdp-actions" class="tdp-action-list"></div>
              <label>Aktion<select id="tdp-action-type"></select></label>
              <label>Einstellungen als JSON<textarea id="tdp-action-settings" rows="5">{}</textarea></label>
              <label>Verzögerung in ms<input id="tdp-action-delay" type="number" min="0" max="120000" value="0"></label>
              <button id="tdp-add-action" type="button">Aktion hinzufügen</button>
              <div class="tdp-save-row">
                <button id="tdp-save-key" class="primary" type="button">Taste speichern</button>
                <button id="tdp-discard-key" type="button">Abbrechen</button>
                <button id="tdp-clear-key" type="button">Leeren</button>
              </div>
            </div>
            <div id="tdp-no-selection" class="tdp-no-selection">Wähle eine Taste aus oder ziehe links eine Aktion auf das Deck.</div>
          </aside>
        </div>
      </div>`;
  }

  function bind() {
    $("#tdp-search").addEventListener("input", (event) => {
      searchText = event.currentTarget.value;
      renderLibrary();
    });
    $("#tdp-tab-actions").addEventListener("click", () => setLibraryTab("actions"));
    $("#tdp-tab-plugins").addEventListener("click", () => setLibraryTab("plugins"));
    $("#tdp-rescan").addEventListener("click", async () => {
      state.plugins = await call("plugins:scan");
      renderLibrary();
      renderInspector();
      toast("Plugins und Aktionen neu eingelesen.");
    });
    $("#tdp-profile").addEventListener("change", async (event) => {
      if (!discardDraftIfNeeded()) { render(); return; }
      selectedIndex = -1;
      draft = null;
      await call("deck:activate-profile", { profileId: event.currentTarget.value });
      await refresh();
    });
    $("#tdp-folder").addEventListener("change", async (event) => {
      if (!discardDraftIfNeeded()) { render(); return; }
      const currentProfile = profile();
      selectedIndex = -1;
      draft = null;
      await call("deck:activate-folder", { profileId: currentProfile.id, folderId: event.currentTarget.value });
      await refresh();
    });
    $("#tdp-add-profile").addEventListener("click", createProfile);
    $("#tdp-add-folder").addEventListener("click", createFolder);
    $("#tdp-back-folder").addEventListener("click", goBackFolder);
    $("#tdp-apply-grid").addEventListener("click", applyGrid);
    $("#tdp-grid-settings").addEventListener("click", () => {
      gridSettingsOpen = !gridSettingsOpen;
      renderGridSettingsVisibility();
    });
    $("#tdp-import").addEventListener("click", async () => { await call("deck:import", { mode: "merge" }); await refresh(); });
    $("#tdp-export").addEventListener("click", () => call("deck:export"));
    $("#tdp-add-action").addEventListener("click", addActionFromInspector);
    $("#tdp-save-key").addEventListener("click", saveKey);
    $("#tdp-discard-key").addEventListener("click", discardKey);
    $("#tdp-clear-key").addEventListener("click", clearKey);
    $("#tdp-copy-key").addEventListener("click", copyKey);
    $("#tdp-paste-key").addEventListener("click", pasteKey);

    for (const id of ["tdp-title", "tdp-subtitle", "tdp-color", "tdp-text-color", "tdp-target-folder"]) {
      $("#" + id).addEventListener("input", updateDraftFromFields);
      $("#" + id).addEventListener("change", updateDraftFromFields);
    }

    document.addEventListener("keydown", handleKeyboardShortcut);
  }

  function setLibraryTab(next) {
    libraryTab = next;
    $("#tdp-tab-actions").classList.toggle("active", next === "actions");
    $("#tdp-tab-plugins").classList.toggle("active", next === "plugins");
    $("#tdp-tab-actions").setAttribute("aria-selected", String(next === "actions"));
    $("#tdp-tab-plugins").setAttribute("aria-selected", String(next === "plugins"));
    renderLibrary();
  }

  function renderLibrary() {
    const target = $("#tdp-library-content");
    if (!target) return;
    target.replaceChildren();
    const plugins = filteredPlugins();
    if (libraryTab === "plugins") {
      if (!plugins.length) {
        target.innerHTML = '<p class="tdp-library-empty">Keine installierten Plugins gefunden.</p>';
        return;
      }
      for (const plugin of plugins) target.append(pluginRow(plugin));
      return;
    }

    const enabled = plugins.filter((plugin) => plugin.enabled && (plugin.actions || []).length);
    if (!enabled.length) {
      target.innerHTML = '<p class="tdp-library-empty">Keine passende Aktion gefunden.</p>';
      return;
    }
    enabled.forEach((plugin, index) => target.append(actionGroup(plugin, index === 0)));
  }

  function pluginRow(plugin) {
    const row = document.createElement("article");
    row.className = `tdp-plugin-row${plugin.enabled ? "" : " disabled"}`;
    row.innerHTML = `
      <div class="tdp-plugin-icon">${iconMarkup(plugin.icon, pluginFallback(plugin))}</div>
      <div class="tdp-plugin-copy"><strong>${html(plugin.name)}</strong><small>${html(plugin.version || (plugin.native ? "Native Batto-Aktion" : "Installiert"))}</small><span>${html(plugin.status || plugin.description || "")}</span></div>
      <label class="tdp-switch" title="Plugin aktivieren oder deaktivieren"><input type="checkbox" ${plugin.enabled ? "checked" : ""}><span></span></label>`;
    $("input", row).addEventListener("change", async (event) => {
      state.plugins = await call("plugins:enable", { pluginId: plugin.id, enabled: event.currentTarget.checked });
      renderLibrary();
      renderInspector();
    });
    return row;
  }

  function actionGroup(plugin, first) {
    const section = document.createElement("section");
    section.className = "tdp-action-group";
    const open = groupState.has(plugin.id) ? groupState.get(plugin.id) : first;
    const actions = (plugin.actions || []).filter((action) => {
      const query = searchText.trim().toLocaleLowerCase("de");
      return !query || [plugin.name, action.name, action.id, action.tooltip]
        .some((value) => String(value || "").toLocaleLowerCase("de").includes(query));
    });
    section.innerHTML = `
      <button class="tdp-action-group-toggle" type="button" aria-expanded="${open}">
        <span class="tdp-disclosure">${open ? "⌄" : "›"}</span>
        <span class="tdp-plugin-icon">${iconMarkup(plugin.icon, pluginFallback(plugin))}</span>
        <strong>${html(plugin.name)}</strong>
        ${plugin.native ? '<em>NATIV</em>' : ""}
      </button>
      <div class="tdp-action-group-body" ${open ? "" : "hidden"}></div>`;
    $(".tdp-action-group-toggle", section).addEventListener("click", () => {
      groupState.set(plugin.id, !open);
      renderLibrary();
    });
    const body = $(".tdp-action-group-body", section);
    for (const action of actions) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tdp-action-item";
      item.draggable = true;
      const transfer = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        actionId: action.id,
        actionName: action.name,
        icon: action.icon || action.states?.find((entry) => entry.image)?.image || plugin.icon || ""
      };
      item.innerHTML = `<span class="tdp-drag-handle">⠿</span><span class="tdp-action-icon">${iconMarkup(transfer.icon, pluginFallback(plugin))}</span><span><strong>${html(action.name)}</strong><small>${html(action.tooltip || action.id)}</small></span>`;
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(actionTransferType, JSON.stringify(transfer));
        event.dataTransfer.setData("text/plain", action.id);
      });
      item.addEventListener("click", () => addLibraryAction(transfer));
      body.append(item);
    }
    return section;
  }

  function render() {
    if (!view || !state) return;
    const deck = state.deck || { profiles: [] };
    const profileSelect = $("#tdp-profile");
    profileSelect.innerHTML = (deck.profiles || []).map((entry) => `<option value="${html(entry.id)}" ${entry.id === deck.activeProfileId ? "selected" : ""}>${html(entry.name)}</option>`).join("");
    const currentProfile = profile();
    if (!currentProfile) return;
    const folderSelect = $("#tdp-folder");
    folderSelect.innerHTML = (currentProfile.folders || []).map((entry) => `<option value="${html(entry.id)}" ${entry.id === currentProfile.activeFolderId ? "selected" : ""}>${html(entry.name)}</option>`).join("");
    const currentFolder = folder(currentProfile);
    if (!currentFolder) return;

    $("#tdp-rows").value = currentFolder.rows;
    $("#tdp-columns").value = currentFolder.columns;
    $("#tdp-size").value = currentFolder.buttonSize;
    $("#tdp-gap").value = currentFolder.gap;
    $("#tdp-hide-unused").checked = Boolean(currentFolder.hideUnused);
    $("#tdp-back-folder").disabled = !currentFolder.parentId;

    renderGrid(currentProfile, currentFolder);
    renderInspector(currentProfile, currentFolder);
    renderLibrary();
    renderGridSettingsVisibility();
  }

  function renderGridSettingsVisibility() {
    const panel = $("#tdp-grid-panel");
    const button = $("#tdp-grid-settings");
    if (!panel || !button) return;
    panel.hidden = !gridSettingsOpen;
    button.setAttribute("aria-pressed", String(gridSettingsOpen));
    button.classList.toggle("active", gridSettingsOpen);
  }

  function renderGrid(currentProfile, currentFolder) {
    const capacity = currentFolder.rows * currentFolder.columns;
    const visible = Array.from({ length: capacity }, (_, index) => currentFolder.buttons?.[index] || blankButton(index));
    const usedCount = visible.filter(isUsed).length;
    const freeCount = capacity - usedCount;
    $("#tdp-capacity").textContent = `${freeCount} von ${capacity} Tasten frei · ${usedCount} belegt`;
    $("#tdp-draft-state").textContent = draftDirty ? "Nicht gespeicherte Vorschau" : "Alle Änderungen gespeichert";
    $("#tdp-draft-state").classList.toggle("dirty", draftDirty);

    const grid = $("#tdp-grid");
    grid.style.setProperty("--tdp-columns", String(currentFolder.columns));
    grid.style.setProperty("--tdp-button-size", `${currentFolder.buttonSize}px`);
    grid.style.setProperty("--tdp-gap", `${currentFolder.gap}px`);
    grid.style.setProperty("--tdp-folder-background", currentFolder.background || "#090f18");
    grid.replaceChildren(...visible.map((button, index) => keyElement(currentProfile, currentFolder, button, index)));
  }

  function isUsed(button) {
    return Boolean(button?.actions?.length || button?.folderId || button?.title || button?.subtitle || button?.icon);
  }

  function keyElement(currentProfile, currentFolder, sourceButton, index) {
    const button = index === selectedIndex && draft ? draft : sourceButton;
    const used = isUsed(button);
    const element = document.createElement("button");
    element.type = "button";
    element.className = `tdp-key${used ? " used" : " empty"}${index === selectedIndex ? " selected" : ""}${index === selectedIndex && draftDirty ? " preview" : ""}`;
    element.dataset.index = String(index);
    element.draggable = true;
    element.style.setProperty("--tdp-key-color", button.color || "#152130");
    element.style.setProperty("--tdp-key-text", button.textColor || "#ffffff");
    element.setAttribute("aria-label", used ? (button.title || `Belegte Taste ${index + 1}`) : `Unbelegte Taste ${index + 1}`);
    element.hidden = Boolean(currentFolder.hideUnused && !used);

    if (used) {
      const image = button.icon && /^data:image\//.test(button.icon)
        ? `<img src="${html(button.icon)}" alt="">`
        : button.folderId
          ? '<span class="tdp-key-folder" aria-hidden="true">▰</span>'
          : "";
      element.innerHTML = `${image}<strong>${html(button.title || (button.folderId ? "Ordner" : ""))}</strong>${button.subtitle ? `<span>${html(button.subtitle)}</span>` : ""}<small>${button.actions?.length > 1 ? `${button.actions.length} Aktionen` : button.actions?.[0]?.title || ""}</small>`;
    }

    element.addEventListener("click", () => selectKey(index, sourceButton));
    element.addEventListener("dblclick", async () => {
      if (button.folderId) {
        await call("deck:activate-folder", { profileId: currentProfile.id, folderId: button.folderId });
        selectedIndex = -1;
        draft = null;
        draftDirty = false;
        await refresh();
      }
    });
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(keyTransferType, String(index));
    });
    element.addEventListener("dragover", (event) => {
      if (event.dataTransfer.types.includes(actionTransferType) || event.dataTransfer.types.includes(keyTransferType)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(actionTransferType) ? "copy" : "move";
        element.classList.add("drop-target");
      }
    });
    element.addEventListener("dragleave", () => element.classList.remove("drop-target"));
    element.addEventListener("drop", async (event) => {
      event.preventDefault();
      element.classList.remove("drop-target");
      const actionJson = event.dataTransfer.getData(actionTransferType);
      if (actionJson) {
        selectKey(index, sourceButton, true);
        addLibraryAction(JSON.parse(actionJson));
        return;
      }
      const from = Number(event.dataTransfer.getData(keyTransferType));
      if (Number.isInteger(from) && from !== index) {
        if (!discardDraftIfNeeded()) return;
        await call("deck:move-button", { profileId: currentProfile.id, folderId: currentFolder.id, fromIndex: from, toIndex: index });
        selectedIndex = index;
        draft = null;
        draftDirty = false;
        await refresh();
      }
    });
    return element;
  }

  function selectKey(index, button, force = false) {
    if (!force && index !== selectedIndex && !discardDraftIfNeeded()) return;
    selectedIndex = index;
    draft = structuredClone(button || blankButton(index));
    draft.actions ||= [];
    draftDirty = false;
    render();
  }

  function discardDraftIfNeeded() {
    if (!draftDirty) return true;
    return window.confirm("Die nicht gespeicherte Vorschau dieser Taste verwerfen?");
  }

  function updateDraftFromFields() {
    if (!draft || selectedIndex < 0) return;
    draft.title = $("#tdp-title").value.trim();
    draft.subtitle = $("#tdp-subtitle").value.trim();
    draft.color = $("#tdp-color").value;
    draft.textColor = $("#tdp-text-color").value;
    draft.folderId = $("#tdp-target-folder").value;
    draftDirty = true;
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    if (currentProfile && currentFolder) renderGrid(currentProfile, currentFolder);
  }

  function renderInspector(currentProfile = profile(), currentFolder = folder(currentProfile)) {
    const selected = selectedIndex >= 0 && draft;
    $("#tdp-inspector-body").hidden = !selected;
    $("#tdp-no-selection").hidden = Boolean(selected);
    $("#tdp-copy-key").disabled = !selected;
    $("#tdp-paste-key").disabled = selectedIndex < 0 || !buttonClipboard;
    $("#tdp-selected").textContent = selected ? `Taste ${selectedIndex + 1}${draftDirty ? " · Vorschau" : ""}` : "Keine Taste ausgewählt.";
    if (!selected) return;

    $("#tdp-title").value = draft.title || "";
    $("#tdp-subtitle").value = draft.subtitle || "";
    $("#tdp-color").value = draft.color || "#152130";
    $("#tdp-text-color").value = draft.textColor || "#ffffff";
    const targetFolder = $("#tdp-target-folder");
    targetFolder.innerHTML = '<option value="">Kein Ordner</option>' + (currentProfile?.folders || [])
      .filter((entry) => entry.id !== currentFolder?.id)
      .map((entry) => `<option value="${html(entry.id)}">${html(entry.name)}</option>`).join("");
    targetFolder.value = draft.folderId || "";

    const catalog = actionCatalog();
    const actionSelect = $("#tdp-action-type");
    actionSelect.innerHTML = catalog.length
      ? catalog.map((entry) => `<option value="${html(entry.actionId)}">${html(entry.pluginName)} · ${html(entry.actionName)}</option>`).join("")
      : '<option value="">Keine Aktion verfügbar</option>';

    $("#tdp-action-count").textContent = String(draft.actions?.length || 0);
    const list = $("#tdp-actions");
    list.replaceChildren(...(draft.actions || []).map((action, actionIndex) => {
      const row = document.createElement("article");
      row.className = "tdp-action-row";
      row.innerHTML = `<span class="tdp-action-order">${actionIndex + 1}</span><div><strong>${html(action.title || action.type)}</strong><code>${html(action.type)}</code><small>${Number(action.delayMs || 0)} ms</small></div><div class="tdp-action-row-buttons"><button type="button" data-direction="up" title="Nach oben">↑</button><button type="button" data-direction="down" title="Nach unten">↓</button><button type="button" data-remove title="Entfernen">×</button></div>`;
      $("[data-remove]", row).addEventListener("click", () => {
        draft.actions.splice(actionIndex, 1);
        draftDirty = true;
        renderInspector(currentProfile, currentFolder);
        renderGrid(currentProfile, currentFolder);
      });
      $$('[data-direction]', row).forEach((control) => control.addEventListener("click", () => {
        const direction = control.dataset.direction === "up" ? -1 : 1;
        const next = actionIndex + direction;
        if (next < 0 || next >= draft.actions.length) return;
        [draft.actions[actionIndex], draft.actions[next]] = [draft.actions[next], draft.actions[actionIndex]];
        draftDirty = true;
        renderInspector(currentProfile, currentFolder);
      }));
      return row;
    }));
  }

  function addLibraryAction(transfer) {
    if (selectedIndex < 0 || !draft) {
      toast("Zuerst eine leere oder belegte Taste auswählen.", true);
      return;
    }
    draft.actions ||= [];
    draft.actions.push({
      id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: transfer.actionId,
      title: `${transfer.pluginName} · ${transfer.actionName}`,
      settings: {},
      delayMs: 0
    });
    if (!draft.title) draft.title = transfer.actionName;
    if (!draft.icon && transfer.icon) draft.icon = transfer.icon;
    draftDirty = true;
    render();
    toast("Aktion zur Vorschau hinzugefügt. Rechts speichern.");
  }

  function addActionFromInspector() {
    if (selectedIndex < 0 || !draft) return toast("Zuerst eine Taste auswählen.", true);
    let settings;
    try { settings = JSON.parse($("#tdp-action-settings").value || "{}"); }
    catch { return toast("Die Aktionseinstellungen enthalten kein gültiges JSON.", true); }
    const type = $("#tdp-action-type").value;
    if (!type) return toast("Keine Aktion verfügbar.", true);
    const title = $("#tdp-action-type").selectedOptions[0]?.textContent || type;
    draft.actions ||= [];
    draft.actions.push({
      id: `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      title,
      settings,
      delayMs: Math.max(0, Math.min(120000, Number($("#tdp-action-delay").value) || 0))
    });
    if (!draft.title) draft.title = title.split(" · ").at(-1) || title;
    draftDirty = true;
    render();
  }

  async function saveKey() {
    if (selectedIndex < 0 || !draft) return;
    updateDraftFromFields();
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    await call("deck:update-button", {
      profileId: currentProfile.id,
      folderId: currentFolder.id,
      buttonIndex: selectedIndex,
      button: draft
    });
    draftDirty = false;
    await refresh();
    toast("Taste gespeichert.");
  }

  function discardKey() {
    if (selectedIndex < 0) return;
    const currentFolder = folder();
    draft = structuredClone(currentFolder?.buttons?.[selectedIndex] || blankButton(selectedIndex));
    draft.actions ||= [];
    draftDirty = false;
    render();
  }

  async function clearKey() {
    if (selectedIndex < 0) return;
    if (isUsed(draft) && !window.confirm(`Taste ${selectedIndex + 1} wirklich leeren? Diese Aktion kann nicht automatisch rückgängig gemacht werden.`)) return;
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    await call("deck:clear-button", { profileId: currentProfile.id, folderId: currentFolder.id, buttonIndex: selectedIndex });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    await refresh();
    toast("Taste geleert.");
  }

  function copyKey() {
    if (!draft) return;
    buttonClipboard = structuredClone(draft);
    $("#tdp-paste-key").disabled = false;
    toast("Taste kopiert.");
  }

  function pasteKey() {
    if (selectedIndex < 0 || !buttonClipboard) return;
    const id = draft?.id || `button-${selectedIndex + 1}`;
    draft = structuredClone(buttonClipboard);
    draft.id = id;
    draftDirty = true;
    render();
    toast("Kopierte Taste als Vorschau eingefügt.");
  }

  async function createProfile() {
    const name = window.prompt("Name des neuen Profils:", "Neues Profil")?.trim();
    if (!name) return;
    await call("deck:create-profile", { name });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    await refresh();
  }

  async function createFolder() {
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    const name = window.prompt("Name des neuen Ordners:", "Neuer Ordner")?.trim();
    if (!name) return;
    await call("deck:create-folder", { profileId: currentProfile.id, name, parentId: currentFolder.id });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    await refresh();
  }

  async function goBackFolder() {
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    if (!currentFolder?.parentId) return;
    if (!discardDraftIfNeeded()) return;
    await call("deck:activate-folder", { profileId: currentProfile.id, folderId: currentFolder.parentId });
    selectedIndex = -1;
    draft = null;
    draftDirty = false;
    await refresh();
  }

  async function applyGrid() {
    const currentProfile = profile();
    const currentFolder = folder(currentProfile);
    const rows = Math.max(1, Math.min(10, Number($("#tdp-rows").value) || 3));
    const columns = Math.max(1, Math.min(10, Number($("#tdp-columns").value) || 5));
    const newCapacity = rows * columns;
    const hiddenUsed = (currentFolder.buttons || []).slice(newCapacity).filter(isUsed).length;
    if (hiddenUsed > 0) {
      const proceed = window.confirm(`${hiddenUsed} belegte Taste(n) werden nur ausgeblendet, aber nicht gelöscht. Raster trotzdem übernehmen?`);
      if (!proceed) return;
    }
    await call("deck:update-folder", {
      profileId: currentProfile.id,
      folderId: currentFolder.id,
      patch: {
        rows,
        columns,
        buttonSize: Math.max(64, Math.min(260, Number($("#tdp-size").value) || 116)),
        gap: Math.max(0, Math.min(40, Number($("#tdp-gap").value) || 12)),
        hideUnused: $("#tdp-hide-unused").checked
      }
    });
    await refresh();
    toast("Raster gespeichert. Verdeckte Belegungen bleiben erhalten.");
  }

  function handleKeyboardShortcut(event) {
    if (!view?.classList.contains("active") || selectedIndex < 0) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copyKey();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteKey();
    } else if (event.key === "Delete") {
      event.preventDefault();
      void clearKey();
    }
  }

  async function refresh(options = {}) {
    state = await call("state:get");
    if (options.scanPlugins && !(state?.plugins?.plugins || []).length) {
      state.plugins = await call("plugins:scan");
    }
    if (selectedIndex >= 0 && !draftDirty) {
      const currentFolder = folder(profile());
      draft = structuredClone(currentFolder?.buttons?.[selectedIndex] || blankButton(selectedIndex));
      draft.actions ||= [];
    }
    render();
    return state;
  }

  function mount(target) {
    if (view) return;
    view = target;
    view.classList.add("touch-deck-pro-v2");
    view.innerHTML = markup();
    bind();
    api.onStateChanged((next) => {
      state = next;
      if (view.classList.contains("active")) {
        if (selectedIndex >= 0 && !draftDirty) {
          const currentFolder = folder(profile());
          draft = structuredClone(currentFolder?.buttons?.[selectedIndex] || blankButton(selectedIndex));
          draft.actions ||= [];
        }
        render();
      }
    });
    $("[data-view='deck-pro']")?.addEventListener("click", () => window.setTimeout(() => refresh(), 0));
    refresh({ scanPlugins: true }).catch((error) => console.error("Touch-Deck Pro V2:", error));
  }

  function waitForView() {
    const existing = document.getElementById("view-deck-pro");
    if (existing) return mount(existing);
    const observer = new MutationObserver(() => {
      const target = document.getElementById("view-deck-pro");
      if (!target) return;
      observer.disconnect();
      mount(target);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  waitForView();
})();
