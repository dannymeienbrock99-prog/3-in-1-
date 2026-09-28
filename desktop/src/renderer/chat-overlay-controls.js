"use strict";

(() => {
  const api = window.batto;
  if (!api?.chatOverlayStatus) return;
  let timer;
  function install() {
    const settings = document.querySelector("#chat-settings");
    if (!settings || settings.querySelector("#chat-overlay-controls")) return;
    const section = document.createElement("div");
    section.id = "chat-overlay-controls";
    section.className = "settings-section";
    section.innerHTML = `<h3>OBS-Chat-Overlay</h3><p id="chat-overlay-state">Overlay wird geladen …</p><label>OBS-Quellenname<input id="chat-overlay-source" value="Batto Multi-Chat" maxlength="120"></label><label>OBS-Szene (leer = aktuelle Szene)<input id="chat-overlay-scene" placeholder="Aktive Programmszene"></label><label>Breite<input id="chat-overlay-width" type="number" min="320" max="7680" value="1920"></label><label>Höhe<input id="chat-overlay-height" type="number" min="240" max="4320" value="1080"></label><label><input id="chat-overlay-auto" type="checkbox"> Beim OBS-Verbinden automatisch aktualisieren</label><div class="settings-actions"><button id="chat-overlay-copy">URL kopieren</button><button id="chat-overlay-open">Vorschau</button><button id="chat-overlay-install">In OBS anlegen/aktualisieren</button><button id="chat-overlay-remove">Aus OBS entfernen</button></div>`;
    settings.insertBefore(section, settings.querySelector(".settings-actions"));
    const state = section.querySelector("#chat-overlay-state");
    const refresh = async () => { try { const value = await api.chatOverlayStatus(); state.textContent = value.url ? `URL: ${value.url} · OBS: ${value.obs?.connected ? "verbunden" : "nicht verbunden"}` : "Lokaler Overlay-Server wird gestartet …"; section.querySelector("#chat-overlay-source").value = value.sourceName || "Batto Multi-Chat"; section.querySelector("#chat-overlay-scene").value = value.sceneName || ""; section.querySelector("#chat-overlay-width").value = value.width || 1920; section.querySelector("#chat-overlay-height").value = value.height || 1080; section.querySelector("#chat-overlay-auto").checked = value.autoInstall === true; } catch (error) { state.textContent = error.message; } };
    const options = () => ({ sourceName: section.querySelector("#chat-overlay-source").value, sceneName: section.querySelector("#chat-overlay-scene").value, width: Number(section.querySelector("#chat-overlay-width").value), height: Number(section.querySelector("#chat-overlay-height").value), autoInstall: section.querySelector("#chat-overlay-auto").checked });
    section.querySelector("#chat-overlay-copy").onclick = async () => { try { await api.chatOverlayCopyUrl(); state.textContent = "Overlay-URL wurde kopiert."; } catch (error) { alert(error.message); } };
    section.querySelector("#chat-overlay-open").onclick = async () => { try { await api.chatOverlayOpen(); } catch (error) { alert(error.message); } };
    section.querySelector("#chat-overlay-install").onclick = async () => { try { const result = await api.chatOverlayInstall(options()); state.textContent = `OBS-Quelle „${result.sourceName}“ ist eingerichtet.`; } catch (error) { alert(error.message); } };
    section.querySelector("#chat-overlay-remove").onclick = async () => { if (!confirm("Die Batto-Chatquelle aus OBS entfernen?")) return; try { const result = await api.chatOverlayRemove(); state.textContent = result.removed ? "OBS-Quelle entfernt." : "OBS-Quelle war nicht vorhanden."; } catch (error) { alert(error.message); } };
    void refresh();
  }
  timer = setInterval(install, 250);
  install();
  window.addEventListener("beforeunload", () => clearInterval(timer));
})();
