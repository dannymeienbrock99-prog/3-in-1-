(()=>{'use strict';
const root=document.getElementById('dual-root'),$=id=>document.getElementById('dual-'+id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const detached=document.body.hasAttribute('data-dual-detached');
let baseRevision=0,conflict=false;
let state,config,initialized=false,dirty=false,selected='tiktok',layer='game',drag=null,busy=false,snapshot=null;
let previewEnabled=true,previewMode='program',previewTimer,previewBusy=false,previewEpoch=0,sourceTimer,obsImport=null;
const labels={tiktok:'TikTok',twitch:'Twitch',game:'Spiel / Bildschirm',camera:'Kamera',microphone:'Mikrofon',desktop:'PC-Ton'};
const visible=()=>!window.BattoResources?.suspended&&!document.hidden&&document.getElementById('view-dualstream').classList.contains('active');
const active=()=>visible()&&(detached||!state?.detached);
const live=()=>Object.values(state?.state.outputs||{}).some(o=>['camera','live','connecting','test'].includes(o.state));
function message(text){$('message').textContent=text;}
async function api(command,value){return window.batto.dual(command,value);}
function run(fn){return async event=>{event?.preventDefault();if(busy)return;busy=true;status();try{await fn(event);}catch(e){const text=String(e.message).replace(/^Error invoking remote method [^:]+: Error: /,'');message(text);if($('obs-dialog')?.open)$('obs-status').textContent=text;}finally{busy=false;status();schedulePreview();}};}
function on(id,fn){$(id).addEventListener('click',run(fn));}
function build(){
 root.innerHTML=`<div class="dual-toolbar dual-window-controls"><button id="dual-detach">Entkoppeln</button><button id="dual-attach" hidden>Andocken</button><label class="suite-check" id="dual-top-label" hidden><input id="dual-top" type="checkbox"> Immer oben</label><button id="dual-reload" hidden>Aktuellen Stand neu laden</button><button id="dual-import">Projekt importieren</button><button id="dual-obs-import">OBS-Szenensammlung importieren</button><button id="dual-export">Projekt exportieren</button><button id="dual-save" class="primary">Änderungen speichern</button><span id="dual-dirty" class="suite-help"></span></div>
 <div id="dual-message" class="dual-message" role="status" aria-live="polite"></div>
 <div id="dual-detached-note" class="dual-detached-note" hidden>Dual Stream ist in einem eigenen Fenster geöffnet. Die Vorschau läuft dort. <button id="dual-focus">Fenster anzeigen</button><button id="dual-dock">Hier andocken</button></div><div id="dual-workspace"><article class="suite-panel"><div class="dual-toolbar"><label>Qualität <select id="dual-profile"><option value="economy_720p30">Sparprofil · 720p / 30 FPS</option><option value="fullhd_1080p30">Full HD · 1080p / 30 FPS</option></select></label><button id="dual-probe">Geräte erkennen</button><button id="dual-library">Videobibliotheken wählen</button><button id="dual-register">Virtuelle Kameras einrichten</button></div><div id="dual-readiness" class="dual-readiness"></div><div id="dual-sources">${['game','camera'].map(s=>`<div class="dual-source-row"><label class="suite-check"><input id="dual-source-${s}" type="checkbox"> ${labels[s]}</label>${s==='game'?'<select id="dual-kind" aria-label="Aufnahmeart"><option value="game">Spielaufnahme</option><option value="window">Fensteraufnahme</option><option value="screen">Bildschirmaufnahme</option></select>':'<span class="suite-help">Für beide Ziele gemeinsam</span>'}<select id="dual-target-${s}" aria-label="${labels[s]} auswählen"></select></div>`).join('')}</div></article>
 <article class="suite-panel"><h3>Szenen &amp; Einblendungen</h3><div class="dual-toolbar"><label>Szene<select id="dual-scene"><option>Spiel</option><option>Pause</option><option>Start</option><option>Ende</option></select></label><label>Übergang<select id="dual-transition"><option value="fade">Überblenden</option><option value="cut">Schnitt</option></select></label><label>Dauer (ms)<input id="dual-transition-ms" type="number" min="100" max="2000" step="50" value="350"></label><button id="dual-scene-apply" class="primary">Szene auf beide Ausgaben schalten</button><button id="dual-background">Hintergrund wählen</button><button id="dual-background-clear">Hintergrund löschen</button></div><p id="dual-background-note" class="suite-help"></p><div class="dual-toolbar"><label class="suite-check"><input id="dual-chat-overlay" type="checkbox"> Chat im Stream zeigen</label><label class="suite-check"><input id="dual-events-overlay" type="checkbox"> Ereignisse im Stream zeigen</label><button id="dual-program-save">Einblendungen speichern</button></div><div class="dual-toolbar"><button id="dual-companion">LIVE-Studio-Sitzung markieren</button><button id="dual-chat-url">Chat-Adresse für LIVE Studio kopieren</button><button id="dual-events-url">Ereignis-Adresse kopieren</button></div><p id="dual-current-scene" class="suite-help"></p><p class="suite-help">Start, Pause und Ende verwenden deine Hintergrundbilder. Die Chat-Einblendung zeigt die letzten vier Nachrichten. Für TikTok LIVE Studio kannst du die vorhandene Stream-Ansicht als Browserquelle verwenden; der eigene Video-Dienst kann dabei ausgeschaltet bleiben.</p></article>
 <article class="suite-panel"><div class="dual-toolbar" role="tablist" aria-label="Leinwand"><button id="dual-tab-tiktok" class="dual-tab" role="tab">TikTok · 9:16</button><button id="dual-tab-twitch" class="dual-tab" role="tab">Twitch · 16:9</button><span id="dual-dimensions" class="suite-help"></span></div><div class="dual-toolbar"><label>Vorschau<select id="dual-preview-mode"><option value="program">Aktuelle Ausgabe</option><option value="sources">Kamera &amp; Spiel prüfen</option></select></label><span id="dual-preview-title" class="suite-help"></span></div>
 <div id="dual-scene-note" class="dual-scene-note" hidden><span id="dual-scene-note-text"></span> <button id="dual-show-game">Spiel-Szene auswählen</button></div><div class="dual-editor"><div><div class="dual-canvas-wrap"><div id="dual-canvas" class="dual-canvas tiktok" aria-label="Leinwand mit verschiebbaren Quellen"></div></div><p id="dual-preview-note" class="suite-help" role="status"></p><p id="dual-camera-note" class="suite-help" role="status"></p><div class="dual-toolbar"><button id="dual-prepare">Quellen vorbereiten</button><button id="dual-preview">Vorschau starten</button><label class="suite-check"><input id="dual-auto-preview" type="checkbox" checked> Sparsame Vorschau · 1 Bild/s</label><button id="dual-release">Video-Dienst ausschalten</button></div></div>
 <div><h3>Quelle anordnen</h3><button id="dual-template">Kamera oben, Spiel darunter</button><label>Bildquelle<select id="dual-layer"><option value="game">Spiel / Bildschirm</option><option value="camera">Kamera</option></select></label><label class="suite-check"><input id="dual-visible" type="checkbox"> Auf dieser Leinwand zeigen</label><div class="dual-form-grid">${[['x','Links (%)'],['y','Oben (%)'],['width','Breite (%)'],['height','Höhe (%)']].map(([k,t])=>`<label>${t}<input id="dual-${k}" type="number" min="${k==='width'||k==='height'?2:0}" max="100" step="0.1"></label>`).join('')}</div><label>Einpassen<select id="dual-fit"><option value="contain">Vollständig zeigen</option><option value="cover">Fläche füllen / beschneiden</option></select></label><p class="suite-help">Quelle im Bild verschieben oder Prozentwerte eintragen. Beide Leinwände speichern ihre Anordnung getrennt.</p></div></div></article>
 <div class="dual-output-grid">${['tiktok','twitch'].map(p=>`<article class="suite-panel"><div class="dual-output-title"><h3>${labels[p]} · virtuelle Kamera</h3><span id="dual-status-${p}" class="dual-status">Aus</span></div><div id="dual-metrics-${p}" class="dual-metrics"></div><div class="dual-toolbar"><button id="dual-start-${p}" class="primary">Kamera starten</button><button id="dual-stop-${p}">Stoppen</button></div><div id="dual-error-${p}" class="suite-help"></div></article>`).join('')}</div>
 <div class="dual-toolbar"><button id="dual-start-both" class="primary">Beide Kameras starten</button><button id="dual-stop-both">Beide stoppen</button><button id="dual-gaming">Gaming-Modus</button></div><p class="suite-help">Ohne Streamkey: Kamera hier starten und in LIVE Studio „Batto TikTok“ als Kamera wählen. Für Querformat „Batto Twitch“ wählen. Fehlen die Geräte dort, „Virtuelle Kameras einrichten“ drücken und LIVE Studio danach neu starten. Mikrofon und PC-Ton direkt in LIVE Studio einstellen. Virtuelle Kameras übertragen nur Bild; den Stream startest du in LIVE Studio. Gaming-Modus speichert dieses Layout und schließt die Bedienoberfläche, um RAM freizugeben. Dienste, Jarvis und Kameras laufen weiter. Über das Taskleisten-Symbol oder Stream Deck öffnest du das Fenster wieder. Ein entkoppeltes Dual-Stream-Fenster bleibt bedienbar; du kannst es zum Sparen ebenfalls schließen.</p></div>
 <dialog id="dual-obs-dialog" class="dual-import-dialog" aria-labelledby="dual-obs-title"><h3 id="dual-obs-title">OBS-Szenensammlung übernehmen</h3><p id="dual-obs-name"></p><p class="suite-help">Ordne deine OBS-Szenen den vier Szenentasten zu. TikTok und Twitch behalten eigene Formate; Kamera und Spielquelle werden gemeinsam verwendet.</p><div id="dual-obs-mapping" class="dual-import-mapping"></div><div id="dual-obs-sources" class="dual-import-mapping"></div><details id="dual-obs-details"><summary>Quellen und Hinweise prüfen</summary><div id="dual-obs-warnings"></div></details><p id="dual-obs-status" class="suite-help" role="status"></p><div class="dual-toolbar"><button id="dual-obs-apply" class="primary">Sammlung übernehmen</button><button id="dual-obs-cancel">Abbrechen</button></div></dialog>`;
 on('detach',async()=>{if(dirty)await save();state=await api('detach');status();});
 on('focus',async()=>{state=await api('detach');status();});
 const dock=async()=>{if(dirty)await save();state=await api('attach');status();};on('attach',dock);on('dock',dock);
 $('top').onchange=event=>{const value=event.target.checked;return run(async()=>{state=await api('always-on-top',value);})(event);};
 on('reload',async()=>{if(dirty&&!confirm('Ungespeicherte Änderungen verwerfen und den aktuellen Stand laden?'))return;adopt(await api('state'));message('Aktueller Stand geladen.');});
 on('register',async()=>{if(dirty)await save();state=await api('register-cameras');fillDevices();message('Virtuelle Kameras eingerichtet. LIVE Studio neu starten und „Batto TikTok“ oder „Batto Twitch“ auswählen.');});
 on('template',()=>{config.layouts.tiktok=[{source:'game',x:0,y:.48,width:1,height:.52,fit:'contain',visible:true},{source:'camera',x:0,y:0,width:1,height:.48,fit:'cover',visible:true}];config.layoutRevision=2;selected='tiktok';layer='camera';changed();editor();canvas();message('Kamera füllt den gesamten oberen Bereich. Änderungen speichern.');});
 on('gaming',async()=>{clearTimeout(sourceTimer);invalidatePreview(false);if(dirty)await save();await api('gaming');});
 on('companion',async()=>{await api('companion');state=await api('state');message('Live-Markierung gilt für Bot-Regeln und Auto-Broadcast. LIVE Studio selbst wird dadurch nicht gestartet oder gestoppt.');});
 for(const kind of ['chat','events'])on(kind+'-url',async()=>{await api('copy-overlay',kind);message('Adresse kopiert. In LIVE Studio als Browserquelle hinzufügen.');});
 const chooseScene=async scene=>{if(dirty)await save();adopt(await api('scene',{scene,transition:$('transition').value,durationMs:Number($('transition-ms').value),baseRevision}));message('Szene '+config.program.scene+' ausgewählt.');};
 on('scene-apply',()=>chooseScene($('scene').value));on('show-game',()=>chooseScene('Spiel'));
 on('program-save',async()=>{if(dirty)await save();state=await api('program',{...state.config.program,chat:$('chat-overlay').checked,events:$('events-overlay').checked,baseRevision});config.program=JSON.parse(JSON.stringify(state.config.program));message('Einblendungen gespeichert.');});
 on('background',async()=>{if(dirty)await save();const scene=$('scene').value;if(scene==='Spiel')throw Error('Für Spiel wählst du die Bildquelle im oberen Bereich.');const next=await api('background',{scene,platform:selected,baseRevision});if(next){adopt(next);message('Hintergrund für '+labels[selected]+' gespeichert.');}});
 on('background-clear',async()=>{if(dirty)await save();const scene=$('scene').value;adopt(await api('background-clear',{scene,platform:selected,baseRevision}));message('Hintergrund für '+labels[selected]+' · '+scene+' gelöscht. Die Originaldatei bleibt erhalten.');});
 $('scene').onchange=()=>{backgroundNote();status();};
 on('save',save);on('probe',async()=>{if(dirty)await save();state=await api('probe');fillDevices();status();message('Aufnahmegeräte erkannt. Virtuelle Kameras benötigen keinen Stream-Encoder.');});
 on('library',async()=>{if(dirty)await save();const next=await api('library');if(next)adopt(next);});
 on('import',async()=>{if(dirty&&!confirm('Ungespeicherte Änderungen verwerfen und ein Projekt importieren?'))return;const next=await api('import');if(next){adopt(next);message('Projekt übernommen. Aufnahmequellen bitte zuordnen.');}});
 on('obs-import',async()=>{if(dirty)await save();const next=await api('obs-import-preview');if(next)showObsImport(next);});
 on('obs-apply',async()=>{if(!obsImport)throw Error('Bitte zuerst eine OBS-Szenensammlung auswählen.');const mapping=Object.fromEntries(['tiktok','twitch'].map(p=>[p,Object.fromEntries(['Spiel','Start','Pause','Ende'].map(scene=>[scene,document.querySelector(`[data-obs-platform="${p}"][data-obs-scene="${scene}"]`).value]))])),sources=Object.fromEntries(['camera','game'].map(id=>[id,$('obs-source-'+id).value]));const next=await api('obs-import-apply',{token:obsImport.token,mapping,sources,baseRevision:obsImport.baseRevision??baseRevision});adopt(next);$('obs-dialog').close();obsImport=null;message('OBS-Szenensammlung übernommen. Kamera und Spielquelle prüfen; die virtuellen Ausgaben bleiben ausgeschaltet.'+(next.importWarnings?.length?' '+next.importWarnings.length+' Hinweise aus der Importprüfung beachten.':''));});
 on('obs-cancel',()=>{$('obs-dialog').close();obsImport=null;});$('obs-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else obsImport=null;});
 on('export',async()=>{if(dirty)await save();const r=await api('export');if(r.saved)message('Projekt exportiert.');});
 on('prepare',async()=>{if(dirty)await save();state=await api('prepare');message('Quellen vorbereitet. Vorschau wird geladen; die virtuellen Ausgaben sind noch aus.');schedulePreview(150);});
 on('release',async()=>{state=await api('release');snapshot=null;canvas();message('Video-Dienst ausgeschaltet.');});
 on('preview',async()=>{if(dirty)await save();if(!state.state.prepared)state=await api('prepare');previewEnabled=true;$('auto-preview').checked=true;snapshot=await api('snapshot',{platform:selected,mode:previewMode});canvas();schedulePreview();});
 $('preview-mode').onchange=()=>{previewMode=$('preview-mode').value;invalidatePreview();canvas();schedulePreview(0);};
 for(const p of ['tiktok','twitch']){
  $('tab-'+p).onclick=()=>{selected=p;invalidatePreview();editor();canvas();schedulePreview(0);};
  on('start-'+p,()=>start(p));on('stop-'+p,async()=>{state=await api('stop',p);});
 }
 on('start-both',()=>start('both'));on('stop-both',async()=>{state=await api('stop','both');});
 $('profile').onchange=()=>{config.profile=$('profile').value;changed();canvas();};
 $('kind').onchange=()=>{config.sources.game.kind=$('kind').value;config.sources.game.target='';config.sources.game.name='';config.sources.game.enabled=false;changed();fillDevices();canvas();};
 for(const s of ['game','camera']){
  $('source-'+s).onchange=()=>{config.sources[s].enabled=$('source-'+s).checked;changed();canvas();scheduleSources();};
  $('target-'+s).onchange=()=>{config.sources[s].target=$('target-'+s).value;config.sources[s].name=$('target-'+s).selectedOptions[0]?.textContent||'';changed();scheduleSources();};
 }
 $('auto-preview').onchange=()=>{previewEnabled=$('auto-preview').checked;invalidatePreview(false);previewNote();schedulePreview(0);};
 $('layer').onchange=()=>{layer=$('layer').value;editor();canvas();};
 for(const k of ['x','y','width','height','visible','fit'])$(''+k).addEventListener('change',()=>{const item=config.layouts[selected].find(x=>x.source===layer);if(k==='visible')item[k]=$('visible').checked;else if(k==='fit')item[k]=$('fit').value;else{const n=Number($(k).value)/100;if(!Number.isFinite(n))return;item[k]=Math.max(k==='width'||k==='height'?.02:0,Math.min(1,n));if(item.x+item.width>1)item.x=1-item.width;if(item.y+item.height>1)item.y=1-item.height;}changed();editor();canvas();});
 const stage=$('canvas');stage.addEventListener('pointerdown',e=>{const el=e.target.closest('[data-dual-source]');if(!el||live())return;layer=el.dataset.dualSource;const item=config.layouts[selected].find(x=>x.source===layer);drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,startX:item.x,startY:item.y,rect:stage.getBoundingClientRect()};stage.setPointerCapture(e.pointerId);editor();e.preventDefault();});
 stage.addEventListener('pointermove',e=>{if(!drag||drag.pointer!==e.pointerId)return;const item=config.layouts[selected].find(x=>x.source===layer);item.x=Math.max(0,Math.min(1-item.width,drag.startX+(e.clientX-drag.x)/drag.rect.width));item.y=Math.max(0,Math.min(1-item.height,drag.startY+(e.clientY-drag.y)/drag.rect.height));changed();editor();canvas();});
 const end=e=>{if(drag?.pointer===e.pointerId){drag=null;if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);}};stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);
}
function changed(){dirty=true;invalidatePreview();status();}
async function save(){if(conflict)throw Error('Der gespeicherte Stand wurde geändert. Bitte zuerst neu laden.');state=await api('save',{...config,baseRevision});adopt(state);message('Dual-Stream-Einstellungen gespeichert.');}
async function start(p){if(dirty)await save();state=await api('start',p);message('Virtuelle Kamera läuft. Jetzt in LIVE Studio als Kamera auswählen.');schedulePreview(150);}
function showObsImport(preview){
 obsImport=preview;$('obs-name').textContent=preview.name||'OBS-Szenensammlung';$('obs-status').textContent='Die aktuelle Konfiguration wird erst nach „Sammlung übernehmen“ geändert.';
 const scenes=Array.isArray(preview.scenes)?preview.scenes:[];
 $('obs-mapping').innerHTML=['tiktok','twitch'].map(platform=>`<fieldset><legend>${labels[platform]} · ${platform==='tiktok'?'9:16':'16:9'}</legend>${['Spiel','Start','Pause','Ende'].map(scene=>`<label>${scene}<select data-obs-platform="${platform}" data-obs-scene="${scene}"><option value="">Aktuelle Szene behalten</option>${scenes.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}${item.width&&item.height?' · '+esc(item.width)+' × '+esc(item.height):''}</option>`).join('')}</select></label>`).join('')}</fieldset>`).join('');
 for(const platform of ['tiktok','twitch'])for(const scene of ['Spiel','Start','Pause','Ende']){const select=document.querySelector(`[data-obs-platform="${platform}"][data-obs-scene="${scene}"]`);select.value=preview.suggestedMapping?.[platform]?.[scene]||'';if(select.selectedIndex<0)select.value='';}
 $('obs-sources').innerHTML=['camera','game'].map(id=>`<label>${id==='camera'?'Gemeinsame Kamera':'Gemeinsames Spiel / Fenster'}<select id="dual-obs-source-${id}"><option value="">Aktuelle Quelle behalten</option>${(preview.sources?.[id]||[]).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label>`).join('');
 for(const id of ['camera','game']){$('obs-source-'+id).value=preview.suggestedSources?.[id]||'';if($('obs-source-'+id).selectedIndex<0)$('obs-source-'+id).value='';}
 const notes=[...(preview.warnings||[])];for(const item of scenes){for(const note of item.warnings||[])notes.push(item.name+': '+note);for(const asset of item.assets||[])if(asset.exists===false)notes.push(item.name+': Datei fehlt – '+(asset.name||asset.path||'unbekannte Datei'));}
 $('obs-warnings').innerHTML=notes.length?'<ul>'+[...new Set(notes)].map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul>':'<p>Keine Probleme bei den unterstützten Quellen erkannt.</p>';
 $('obs-details').open=notes.length>0;$('obs-dialog').showModal();
}
function adopt(next){state=next;baseRevision=next.revision;config=JSON.parse(JSON.stringify(next.config));dirty=false;conflict=false;invalidatePreview();$('scene').value=config.program.scene;$('transition').value=config.program.transition;$('transition-ms').value=config.program.durationMs;$('chat-overlay').checked=config.program.chat;$('events-overlay').checked=config.program.events;$('profile').value=config.profile;$('kind').value=config.sources.game.kind;fillDevices();editor();canvas();status();}
function fillDevices(){for(const s of ['game','camera']){const current=config.sources[s],items=state.probe?.devices?.[s==='game'?current.kind:s]||[],valid=items.filter(x=>x.id&&!(s==='camera'&&/27b05c2d-93dc-474a-a5da-9bba34cb2a9[cd]/i.test(x.id)));$('target-'+s).innerHTML='<option value="">Bitte auswählen</option>'+valid.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');if(current.target&&!valid.some(x=>x.id===current.target))$('target-'+s).insertAdjacentHTML('beforeend',`<option value="${esc(current.target)}">${esc(current.name||'Gespeicherte Quelle')} · noch nicht geprüft</option>`);$('target-'+s).value=current.target;$('source-'+s).checked=current.enabled;}}
function editor(){const item=config.layouts[selected].find(x=>x.source===layer);$('layer').value=layer;for(const k of ['x','y','width','height'])$(k).value=(item[k]*100).toFixed(1);$('visible').checked=item.visible;$('fit').value=item.fit;}
function canvas(){if(!config)return;const stage=$('canvas');stage.className='dual-canvas '+selected+(snapshot?' has-preview':'');for(const p of ['tiktok','twitch'])$('tab-'+p).setAttribute('aria-selected',String(p===selected));const hd=config.profile==='fullhd_1080p30';$('dimensions').textContent=(selected==='tiktok'?(hd?'1080 × 1920':'720 × 1280'):(hd?'1920 × 1080':'1280 × 720'))+' · 30 FPS';
 const showSources=previewMode==='sources'||config.program.scene==='Spiel';stage.innerHTML=(snapshot?`<img alt="${previewMode==='sources'?'Quellenprüfung':'Ausgabe · '+esc(config.program.scene)} · ${labels[selected]}" src="${snapshot.image}">`:'')+(showSources?config.layouts[selected].filter(x=>x.visible).map(x=>`<button type="button" data-dual-source="${x.source}" class="dual-layer ${x.source===layer?'selected':''} ${config.sources[x.source].enabled?'':'disabled'}" style="left:${x.x*100}%;top:${x.y*100}%;width:${x.width*100}%;height:${x.height*100}%" aria-label="${labels[x.source]} verschieben"><span>${labels[x.source]}${config.sources[x.source].enabled?'':' · aus'}</span></button>`).join(''):!snapshot?`<div class="dual-canvas-empty">${esc(config.program.scene)}<small>Vorschau starten</small></div>`:'');
 previewNote();backgroundNote();
}
function invalidatePreview(clear=true){previewEpoch++;clearTimeout(previewTimer);previewTimer=null;if(clear)snapshot=null;}
function previewNote(){
 if(!initialized)return;
 if(!config)return;
 $('preview-title').textContent=previewMode==='sources'?'Nur Quellenprüfung – die ausgegebene Szene bleibt '+config.program.scene+'.':'Ausgabe: '+config.program.scene+' · '+labels[selected];
 $('scene-note').hidden=config.program.scene==='Spiel';$('scene-note-text').textContent='Aktuell wird „'+config.program.scene+'“ ausgegeben. Diese Szene zeigt ihren Hintergrund. Die Kamera siehst du unter „Kamera & Spiel prüfen“ oder nach dem Wechsel zur Spiel-Szene.';
 let text=snapshot?'Vorschaubild · '+new Date(snapshot.capturedAt).toLocaleTimeString('de-DE')+(previewEnabled?' · 1 Bild/s, pausiert außerhalb dieses Bereichs.':' · angehalten.'):'Noch kein Vorschaubild. Quellen auswählen und einschalten, dann „Vorschau starten“ drücken.';
 const camera=snapshot?.sources?.find(x=>x.id==='camera'),source=config.sources.camera,item=config.layouts[selected].find(x=>x.source==='camera');let cameraText;
 if(!source.target)cameraText='Kamera: Bitte oben ein Aufnahmegerät auswählen.';
 else if(!source.enabled)cameraText='Kamera: ausgeschaltet. Den Schalter „Kamera“ bei den gemeinsamen Quellen einschalten.';
 else if(!state?.state.prepared)cameraText='Kamera: ausgewählt; noch nicht gestartet. „Vorschau starten“ drücken.';
 else if(camera?.width>0&&camera?.height>0)cameraText='Kamera liefert '+camera.width+' × '+camera.height+'.';
 else cameraText='Kamera: Noch kein Bild empfangen. Kamera anschließen und gegebenenfalls die Hersteller-App prüfen. Ein anderes Programm kann das Gerät belegen.';
 if(source.enabled&&!item?.visible)cameraText+=' Auf '+labels[selected]+' ist die Kamera ausgeblendet. Unter „Quelle anordnen“ die Kamera auswählen und „Auf dieser Leinwand zeigen“ einschalten.';
 $('camera-note').textContent=cameraText;$('camera-note').classList.toggle('dual-camera-warning',source.enabled&&state?.state.prepared&&!(camera?.width>0&&camera?.height>0));
 $('preview-note').textContent=text;$('preview').textContent=state?.state.prepared?'Vorschau aktualisieren':'Vorschau starten';
}
function backgroundNote(){if(!config)return;const scene=$('scene').value,platformValue=config.program.platformBackgrounds?.[selected]?.[scene],value=platformValue!==undefined?platformValue:config.program.backgrounds?.[scene];$('background-note').textContent=scene==='Spiel'?'Spiel zeigt deine gemeinsamen Bildquellen.':'Hintergrund für '+labels[selected]+' · '+scene+': '+(value===null?'gelöscht – leere Fläche.':value?'eigene Datei.':'mitgeliefertes Bild.');}
function canPreview(){return initialized&&active()&&previewEnabled&&!dirty&&state?.state.prepared;}
function schedulePreview(ms=1000){
 if(previewTimer||previewBusy||!canPreview())return;
 previewTimer=setTimeout(refreshPreview,ms);
}
async function refreshPreview(){
 previewTimer=null;if(!canPreview())return;if(busy||state.busy){schedulePreview();return;}
 previewBusy=true;const epoch=previewEpoch,platform=selected;
 try{const next=await api('snapshot',{platform,mode:previewMode});if(epoch!==previewEpoch||platform!==selected||!canPreview())return;snapshot=next;const img=$('canvas').querySelector('img');if(img){img.src=next.image;previewNote();}else canvas();}
 catch(e){if(epoch===previewEpoch&&active()){previewEnabled=false;$('auto-preview').checked=false;message('Vorschau angehalten: '+String(e.message).replace(/^Error invoking remote method [^:]+: Error: /,''));previewNote();}}
 finally{previewBusy=false;schedulePreview();}
}
function scheduleSources(){
 clearTimeout(sourceTimer);sourceTimer=setTimeout(run(async()=>{
  if(!active()||live()||!dirty||conflict)return;
  if(['camera','game'].some(k=>config.sources[k].enabled&&!config.sources[k].target)){message('Bitte für die eingeschaltete Quelle ein Gerät auswählen.');return;}
  await save();if(['camera','game'].some(k=>config.sources[k].enabled)){state=await api('prepare');schedulePreview(150);message('Quelle eingeschaltet. Vorschau wird geladen.');}else message('Bildquellen ausgeschaltet.');
 }),600);
}

function status(){if(!initialized||!state||!config)return;const working=busy||state.busy,streaming=live(),delegated=state.detached&&!detached;$('dirty').textContent=conflict?'In anderem Fenster geändert':dirty?'Ungespeicherte Änderungen':'Gespeichert';
 $('workspace').hidden=delegated;$('detached-note').hidden=!delegated;$('detach').hidden=detached||delegated;$('attach').hidden=!detached;$('top-label').hidden=!detached;$('top').checked=state.alwaysOnTop===true;$('reload').hidden=!conflict;for(const id of ['import','obs-import','export','save','dirty'])$(id).hidden=delegated;
 if(delegated){clearTimeout(sourceTimer);invalidatePreview();if($('canvas').querySelector('img'))canvas();}
 for(const id of ['detach','attach','focus','dock'])$(id).disabled=working;
 $('companion').textContent=state.companionLive?'LIVE-Studio-Sitzung beenden':'LIVE-Studio-Sitzung markieren';$('companion').setAttribute('aria-pressed',String(state.companionLive));
 $('current-scene').textContent='Ausgabe auf beiden Zielen: '+state.config.program.scene+' · '+(state.engineRunning?'im eigenen Sender':'wird beim Vorbereiten übernommen');for(const id of ['scene-apply','program-save','show-game'])$(id).disabled=working||conflict;
 for(const id of ['background','background-clear'])$(id).disabled=working||streaming||conflict||$('scene').value==='Spiel';backgroundNote();
 for(const id of ['obs-apply','obs-cancel'])$(id).disabled=working;$('obs-dialog').querySelectorAll('select').forEach(select=>{select.disabled=working;});
 $('readiness').textContent=(state.libraryFound?'Videobibliotheken vorhanden. ':'Videobibliotheken fehlen; vorhandenen OBS-Ordner auswählen. ')+(state.engineRunning?'Video-Dienst eingeschaltet.':'Video-Dienst aus – keine laufende Aufnahme.')+' Ton wählst du in LIVE Studio.';
 for(const p of ['tiktok','twitch']){const o=state.state.outputs?.[p],running=['camera','live','connecting','test'].includes(o?.state),camera=state.state.virtualCameras?.[p]||state.probe?.virtualCameras?.[p];$('status-'+p).textContent=running?'Kamera läuft':o?.state==='error'?'Fehler':'Aus';$('status-'+p).classList.toggle('live',running);$('metrics-'+p).textContent=(o?.cameraName||camera?.name||'Batto '+labels[p])+(o?` · ${o.width} × ${o.height} · 30 FPS\n${o.frames} Bilder`:' · noch nicht gestartet');$('error-'+p).textContent=o?.error||(!camera?.ready?camera?.error||'':'');$('start-'+p).disabled=working||running;$('stop-'+p).disabled=working||!running;}
 for(const id of ['save','import','obs-import','probe','library','register','template','prepare','profile','kind','layer','visible','x','y','width','height','fit'])$(id).disabled=working||streaming;
 $('save').disabled=working||streaming||conflict;$('export').disabled=working||conflict;
 for(const s of ['game','camera']){$('source-'+s).disabled=working||streaming;$('target-'+s).disabled=working||streaming;}
 $('gaming').disabled=working;previewNote();
 $('release').disabled=working||streaming||!state.engineRunning;$('preview').disabled=working||(!state.state.prepared&&streaming);$('preview-mode').disabled=working;$('start-both').disabled=working||streaming;$('stop-both').disabled=working||!streaming;
}
async function init(){if(initialized)return;if(!visible())return;initialized=true;build();try{adopt(await api('state'));schedulePreview(0);if(state.error)message(state.error);}catch(e){message(e.message);}}
document.addEventListener('batto:view',()=>{if(active()){void init();status();schedulePreview(0);}else invalidatePreview(false);});document.addEventListener('visibilitychange',()=>{if(active()){status();schedulePreview(0);}else invalidatePreview(false);});
window.batto.onPresentationState?.(()=>{if(active())schedulePreview(0);else invalidatePreview(false);});
window.batto.onDualState(next=>{
 const changedRevision=next.revision!==baseRevision;state=next;
 if(initialized&&config){
  if(changedRevision&&!dirty)adopt(next);
  else if(changedRevision&&dirty){conflict=true;clearTimeout(sourceTimer);invalidatePreview();message('Dual Stream wurde inzwischen geändert. Dein Entwurf bleibt erhalten; lade vor dem Speichern den aktuellen Stand.');}
  if(!next.state.prepared){invalidatePreview();canvas();}
  status();if(active())schedulePreview();else invalidatePreview();
 }
});
if(detached)void init();
})();
