(() => {
  'use strict';
  const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { toast(error.message, true); } };
  const clone = value => structuredClone(value);
  const https = value => { if (!value) return ''; const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw Error('Bitte eine vollständige HTTPS-Adresse ohne Zugangsdaten eingeben.'); return u.href; };
  const defaults = { enabled:true, width:360, height:160, scale:1, anchor:'top-right', x:0, y:0, durationMs:8000, permanent:false, fadeInMs:250, fadeOutMs:250, queueMode:'queue', maxQueue:10, keepAspect:true };
  const extra = () => S.config?.chatExtras || {};
  const widgets = () => extra().widgets || [];
  const wishes = () => ({...defaults, enabled:false, items:[], ...extra().wishlist});
  let giftCatalog = [], catalogStatus = {}, library = [], libraryPath, requestedLibraryPath, wishlistRenderVersion=0, editor = null, wishDraft = null, query = '', page = 0, rootLayer;
  const frames = new Map(), seen = new Map(), runtime = new Map(), libraryLoads=new Map();
  function notice(message) { const target = document.querySelector('[data-extra-status]'); if (target) target.textContent = message; }
  async function getLibrary(force=false, folderPath=wishes().folderPath||'') {
    requestedLibraryPath=folderPath;
    if (!force && libraryPath===folderPath) return library;
    if (!libraryLoads.has(folderPath)) libraryLoads.set(folderPath,api.giftLibrary({folderPath,refreshCatalog:force}).then(result => {
      if (result.ok===false) throw Error(result.error || 'Geschenkordner konnte nicht gelesen werden.');
      if(requestedLibraryPath===folderPath){library=result.items||[];giftCatalog=result.catalog||[];catalogStatus=result.catalogStatus||{};libraryPath=folderPath;}
      return result.items||[];
    }).finally(()=>libraryLoads.delete(folderPath)));
    return libraryLoads.get(folderPath);
  }
  function fields(item) {
    const c={...defaults,...item};
    return `<div class="form-grid three"><label>Breite (Pixel)<input name="width" type="number" min="80" max="1920" value="${c.width}" required></label><label>Höhe (Pixel)<input name="height" type="number" min="40" max="1080" value="${c.height}" required></label><label>Skalierung (%)<input name="scale" type="number" min="25" max="200" value="${Math.round(c.scale*100)}" required></label><label>Position<select name="anchor">${[['top-left','Oben links'],['top-right','Oben rechts'],['center','Mitte'],['bottom-left','Unten links'],['bottom-right','Unten rechts']].map(([v,t])=>`<option value="${v}" ${v===c.anchor?'selected':''}>${t}</option>`).join('')}</select></label><label>Abstand X (Pixel)<input name="x" type="number" min="0" max="1920" value="${c.x}"></label><label>Abstand Y (Pixel)<input name="y" type="number" min="0" max="1080" value="${c.y}"></label><label>Anzeigedauer (Sekunden)<input name="durationMs" type="number" min="1" max="120" step="0.1" value="${c.durationMs/1000}" required></label><label>Einblenden (ms)<input name="fadeInMs" type="number" min="0" max="3000" value="${c.fadeInMs}"></label><label>Ausblenden (ms)<input name="fadeOutMs" type="number" min="0" max="3000" value="${c.fadeOutMs}"></label><label>Bei erneutem Auslösen<select name="queueMode">${[['queue','Nacheinander'],['replace','Aktuelle Anzeige verlängern'],['discard','Während Anzeige ignorieren']].map(([v,t])=>`<option value="${v}" ${v===c.queueMode?'selected':''}>${t}</option>`).join('')}</select></label><label class="check"><input name="permanent" type="checkbox" ${c.permanent?'checked':''}>Dauerhaft anzeigen</label><label class="check"><input name="keepAspect" type="checkbox" ${c.keepAspect?'checked':''}>Seitenverhältnis beibehalten</label></div>`;
  }
  function capture(form, prior) {
    const item={...prior};
    for(const input of form.querySelectorAll('[name]')) item[input.name]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
    if(form.elements.scale)item.scale=Number(form.elements.scale.value)/100;
    if(form.elements.durationMs)item.durationMs=Number(form.elements.durationMs.value)*1000;
    Object.assign(prior,item);return prior;
  }
  const anchors = item => {
    const c={...defaults,...item},style={left:'auto',right:'auto',top:'auto',bottom:'auto',transform:''};
    if(c.anchor==='center'){style.left='50%';style.top='50%';style.transform=`translate(calc(-50% + ${c.x}px), calc(-50% + ${c.y}px))`;}
    else {style[c.anchor.endsWith('right')?'right':'left']=`${c.x}px`;style[c.anchor.startsWith('bottom')?'bottom':'top']=`${c.y}px`;}
    return style;
  };
  function setupLayer() {
    if(rootLayer)return rootLayer;
    const list=document.querySelector('#chatList');if(!list)return;
    const surface=document.createElement('div');surface.className='chat-display-surface';list.before(surface);surface.append(list);
    rootLayer=document.createElement('div');rootLayer.className='chat-extras-layer';rootLayer.setAttribute('aria-hidden','true');surface.append(rootLayer);
    return rootLayer;
  }
  function frame(key,url,parent,title) {
    let el=frames.get(key);
    if(!el){el=document.createElement('iframe');el.className='extra-frame';el.title=title;el.setAttribute('sandbox','allow-scripts allow-same-origin');el.setAttribute('referrerpolicy','no-referrer');el.setAttribute('allow',"autoplay 'none'; camera 'none'; microphone 'none'; clipboard-read 'none'; clipboard-write 'none'");el.tabIndex=-1;el.addEventListener('load',()=>{el.dataset.load='loaded';notice(`${title}: Seite geladen. Sichtbare Inhalte hängen vom Widget und TikFinity ab.`);});el.addEventListener('error',()=>{el.dataset.load='error';notice(`${title}: Seite konnte nicht geladen werden.`);});parent.append(el);frames.set(key,el);}
    if(window.BattoResources)window.BattoResources.setFrameSource(el,url);else if(el.getAttribute('src')!==url){el.dataset.load='loading';el.src=url;}
    if(el.parentElement!==parent)parent.append(el);return el;
  }
  function source(item) { const source=library.find(x=>x.key===item.key); if(item.url){try{return https(item.url);}catch{return '';}} return source?.url||''; }
  function wishlistContent(host,c) {
    const rows=c.items.filter(i=>i.enabled!==false),fingerprint=JSON.stringify([c.title,c.caption,rows.map(i=>[i.key,i.name,i.url,i.sourceType,source(i)])]);
    if(host.dataset.content===fingerprint)return;host.dataset.content=fingerprint;
    const retained=new Set();
    const title=document.createElement('strong');title.className='wish-overlay-title';title.textContent=c.title??'Wunschgeschenke';title.hidden=!title.textContent;
    const caption=document.createElement('div');caption.className='wish-overlay-caption';caption.textContent=c.caption||'';caption.hidden=!caption.textContent;
    const grid=document.createElement('div');grid.className='wish-overlay-items';
    for(const item of rows){const cell=document.createElement('div');cell.className='wish-overlay-item';const url=source(item);if(url&&item.sourceType==='widget'&&item.url){const key=`wish:${item.key}`;retained.add(key);frame(key,url,cell,item.name);}else if(url){const img=document.createElement('img');img.src=url;img.alt=item.name;img.addEventListener('error',()=>{img.hidden=true;cell.dataset.missing='true';});cell.append(img);}else cell.dataset.missing='true';const label=document.createElement('span');label.textContent=item.name;cell.append(label);grid.append(cell);}
    host.replaceChildren(title,caption,grid);
    for(const [key,f] of frames)if(key.startsWith('wish:')&&!retained.has(key)){f.remove();frames.delete(key);}
  }
  function getRuntime(id,item,kind) {
    let r=runtime.get(id);if(!r){const node=document.createElement('div');node.className='chat-extra-slot';node.dataset.extraId=id;setupLayer()?.append(node);r={id,node,active:false,queue:[],timer:null,hideTimer:null};runtime.set(id,r);}
    r.item={...defaults,...item};r.kind=kind;
    Object.assign(r.node.style,anchors(r.item),{width:`min(${r.item.width*r.item.scale}px, 100%)`,height:`min(${r.item.height*r.item.scale}px, 100%)`});
    if(kind==='wishlist'){r.node.classList.add('wish-overlay');wishlistContent(r.node,r.item);}
    else if(r.item.url){const f=frame(id,r.item.url,r.node,r.item.name);f.style.width=r.item.width+'px';f.style.height=r.item.height+'px';f.style.transformOrigin='top left';const resize=()=>{const fit=r.item.keepAspect?Math.min(r.node.clientWidth/r.item.width,r.node.clientHeight/r.item.height):r.item.scale;f.style.transform=`scale(${fit})`;if(!r.item.keepAspect){f.style.width=(r.node.clientWidth/fit)+'px';f.style.height=(r.node.clientHeight/fit)+'px';}};if(!r.observer){r.observer=new ResizeObserver(resize);r.observer.observe(r.node);}resize();}
    return r;
  }
  function hide(r,advance=true) {
    clearTimeout(r.timer);clearTimeout(r.hideTimer);r.node.style.transition=`opacity ${r.item.fadeOutMs}ms`;r.node.style.opacity='0';
    r.hideTimer=setTimeout(()=>{r.node.style.visibility='hidden';window.BattoResources?.refresh();r.active=false;r.timer=null;r.hideTimer=null;if(r.ephemeral){r.ephemeral=false;r.hiddenOverride=Boolean(r.previewHidden||r.hiddenOverride);delete r.previewHidden;apply();}if(runtime.get(r.id)===r&&advance&&r.queue.length&&!r.active)show(r,r.queue.shift());},r.item.fadeOutMs);
  }
  function show(r, payload={}) {
    clearTimeout(r.timer);clearTimeout(r.hideTimer);r.timer=null;r.hideTimer=null;r.hiddenOverride=false;r.active=true;r.node.style.visibility='visible';r.node.style.transition=`opacity ${r.item.fadeInMs}ms`;r.node.style.opacity='1';
    window.BattoResources?.refresh();
    if(!r.item.permanent||payload.durationMs){r.timer=setTimeout(()=>{if(r.item.permanent&&!r.ephemeral)r.hiddenOverride=true;hide(r);},Math.max(250,Math.min(120000,Number(payload.durationMs)||r.item.durationMs)));}
  }
  function trigger(payload={}) {
    const id=payload.kind==='wishlist'?'wishlist':String(payload.id||payload.widgetId||'');const r=runtime.get(id);if(!r||r.item.enabled===false)return;
    const eventId=payload.triggerId||payload.eventId;
    if(eventId){const key=`${id}:${eventId}`;if(seen.has(key))return;seen.set(key,Date.now());if(seen.size>500)seen.delete(seen.keys().next().value);}
    if(payload.visible===false){r.queue=[];r.hiddenOverride=true;hide(r,false);return;}
    if(r.active&&!payload.preview&&r.item.queueMode==='discard')return;
    if(r.active&&!payload.preview&&r.item.queueMode==='queue'&&!r.item.permanent){if(r.queue.length<(r.item.maxQueue||10))r.queue.push(payload);return;}
    show(r,payload);
  }
  function apply() {
    if(!S.config)return;setupLayer();const allowed=new Set();
    function reconcile(id,item,kind){
      const old=runtime.get(id),previous=old?.savedItem||old?.item,ephemeral=old?.ephemeral;
      allowed.add(id);const r=getRuntime(id,ephemeral?{...item,enabled:true,permanent:false}:item,kind);r.savedItem={...item};
      if(ephemeral)return;
      if(previous&&previous.permanent!==item.permanent){r.hiddenOverride=false;if(item.permanent){clearTimeout(r.timer);r.timer=null;show(r);}else if(r.active)hide(r,false);}
      else if(item.permanent&&!r.active&&!r.hiddenOverride)show(r);
    }
    for(const item of widgets()){if((item.enabled===false&&!runtime.get(item.id)?.ephemeral)||!item.url)continue;let url;try{url=https(item.url);}catch{continue;}reconcile(item.id,{...item,url},'widget');}
    const w=wishes();if((w.enabled||runtime.get('wishlist')?.ephemeral)&&w.items.some(x=>x.enabled!==false)){reconcile('wishlist',w,'wishlist');if(libraryPath!==(w.folderPath||''))getLibrary().then(()=>apply()).catch(e=>notice(e.message));}
    for(const [id,r]of runtime)if(!allowed.has(id)){clearTimeout(r.timer);clearTimeout(r.hideTimer);r.observer?.disconnect();r.node.remove();runtime.delete(id);frames.get(id)?.remove();frames.delete(id);if(id==='wishlist')for(const[key,f]of frames)if(key.startsWith('wish:')){f.remove();frames.delete(key);}}
  }
  const baseApply=window.applyChatWidgets;window.applyChatWidgets=function(){baseApply?.();apply();};
  api.onChatWidgetTrigger?.(payload=>{apply();if(payload.preview&&payload.definition){const id=payload.kind==='wishlist'?'wishlist':String(payload.id||payload.widgetId||'');const r=getRuntime(id,{...payload.definition,enabled:true,permanent:false},payload.kind);r.savedItem={...(payload.kind==='wishlist'?wishes():widgets().find(item=>item.id===id)||payload.definition)};if(!r.ephemeral)r.previewHidden=Boolean(r.hiddenOverride);r.ephemeral=true;}trigger(payload);});
  api.onPlatformEvent(event=>{
    const rawType=String(event.event||event.type||'').toLowerCase(),type=['sub','subscription'].includes(rawType)?'subscribe':rawType,platform=String(event.platform||'').toLowerCase();
    for(const item of widgets())if(item.event!=='manual'&&item.event===type&&(item.platform==='all'||item.platform===platform))trigger({id:item.id,kind:'widget',eventId:event.id||event.eventId||event.data?.msgId});
    if(type==='gift'){const id=String(event.data?.gift?.id??event.data?.gift?.giftId??event.data?.giftId??event.giftId??'');if(id&&wishes().items.some(x=>x.enabled!==false&&x.giftIdVerified&&String(x.giftId)===id))trigger({kind:'wishlist',eventId:event.id||event.eventId||event.data?.msgId});}
  });
  function preview(host,item) {
    host.innerHTML='<div class="extras-position-preview"><div class="extra-placement">Anzeige hierher ziehen</div><span>Chatbereich · Vorschau der Position</span></div>';
    const stage=host.querySelector('.extras-position-preview'),marker=host.querySelector('.extra-placement');
    const update=()=>Object.assign(marker.style,anchors(item),{width:`min(${item.width*.55*item.scale}px, 80%)`,height:`min(${item.height*.55*item.scale}px, 75%)`});update();
    marker.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();marker.setPointerCapture(event.pointerId);const bounds=stage.getBoundingClientRect();const move=ev=>{const x=Math.max(0,Math.min(bounds.width-marker.offsetWidth,ev.clientX-bounds.left)),y=Math.max(0,Math.min(bounds.height-marker.offsetHeight,ev.clientY-bounds.top));item.anchor='top-left';item.x=Math.round(x/.55);item.y=Math.round(y/.55);Object.assign(marker.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto',transform:''});};marker.onpointermove=move;marker.onpointerup=()=>{marker.onpointermove=null;const f=host.closest('form');for(const n of['anchor','x','y'])f.elements[n].value=item[n];};};
  }
  function renderWidgets() {
    const host=$('#widgetsModule');if(!host)return;
    host.innerHTML=`<p>Die Einblendung liegt über dem Chat. Schnee, Scrollen und Schreiben bleiben unabhängig. Für einen neuen Follower die passende Alert-Adresse speichern und „Neuer Follower“ auswählen.</p><div class="toolbar"><button class="primary" data-new-widget>Widget hinzufügen</button><button data-widget-base>Schnee / Like-Balken einstellen</button></div><p data-extra-status role="status"></p><div class="extra-widget-list">${widgets().map(w=>`<article class="extra-summary"><div><strong>${esc(w.name)}</strong><small>${esc(w.platform)} · ${esc(w.event)} · ${w.permanent?'Dauerhaft':Math.round(w.durationMs/1000)+' Sekunden'} · ${w.enabled?'Aktiv':'Aus'}</small></div><button data-widget-edit="${esc(w.id)}">Bearbeiten</button><button data-widget-test="${esc(w.id)}" ${w.enabled===false?'disabled':''}>Im Chat testen</button><button data-widget-toggle="${esc(w.id)}">${w.enabled?'Aus':'An'}</button><button class="danger" data-widget-delete="${esc(w.id)}">Löschen</button></article>`).join('')||'<p>Noch keine zusätzlichen Widgets. Deine bisherigen Schnee- und Like-Einstellungen bleiben erhalten.</p>'}</div><div data-widget-editor></div>`;
    host.querySelector('[data-new-widget]').onclick=()=>{editor={...defaults,id:cryptoId(),name:'Neue Follower',url:'',event:'follow',platform:'tiktok'};renderWidgets();};
    host.querySelector('[data-widget-base]').onclick=()=>setView('settings');
    for(const button of host.querySelectorAll('[data-widget-edit]'))button.onclick=()=>{editor=clone(widgets().find(x=>x.id===button.dataset.widgetEdit));renderWidgets();};
    for(const button of host.querySelectorAll('[data-widget-test]'))button.onclick=safely(async()=>{const r=await api.chatWidgetTest({id:button.dataset.widgetTest,kind:'widget'});if(r.ok===false)throw Error(r.error);setView('dashboard');});
    for(const button of host.querySelectorAll('[data-widget-toggle]'))button.onclick=safely(async()=>{await saveAndSync({chatExtras:{widgets:widgets().map(w=>w.id===button.dataset.widgetToggle?{...w,enabled:!w.enabled}:w)}});renderWidgets();});
    for(const button of host.querySelectorAll('[data-widget-delete]'))button.onclick=safely(async()=>{if(!confirm('Dieses Widget löschen?'))return;await saveAndSync({chatExtras:{widgets:widgets().filter(w=>w.id!==button.dataset.widgetDelete)}});if(editor?.id===button.dataset.widgetDelete)editor=null;renderWidgets();});
    if(!editor)return;const form=document.createElement('form');form.className='extra-editor';host.querySelector('[data-widget-editor]').append(form);
    form.innerHTML=`<h3>Widget bearbeiten</h3><div class="form-grid"><label>Name<input name="name" required maxlength="100" value="${esc(editor.name)}"></label><label>Vollständige HTTPS-Adresse<input name="url" type="url" required value="${esc(editor.url)}" placeholder="https://tikfinity.zerody.one/widget/…"></label><label>Plattform<select name="platform">${['tiktok','twitch','internal','all'].map(p=>`<option ${editor.platform===p?'selected':''}>${p}</option>`).join('')}</select></label><label>Auslöser<select name="event">${[['follow','Neuer Follower'],['join','Stream betreten (TikTok)'],['gift','Geschenk'],['like','Like (TikTok)'],['share','Teilen (TikTok)'],['subscribe','Abo'],['manual','Manuell / Aktionskette']].map(([v,t])=>`<option value="${v}" ${editor.event===v?'selected':''}>${t}</option>`).join('')}</select></label></div><label class="check"><input name="enabled" type="checkbox" ${editor.enabled?'checked':''}>Aktiv</label>${fields(editor)}<div data-position-preview></div><div class="toolbar"><button type="submit" class="primary">Speichern</button><button type="button" data-widget-close>Schließen</button></div><p>Die Adresse bleibt jederzeit änderbar. Für die automatische Follow-Anzeige muss TikFinity echte Follow-Ereignisse liefern. Seiten ohne erlaubte Einbettung bleiben leer; ein Laden der Seite bestätigt kein sichtbares Alert. Ton dieser Chat-Widgets ist deaktiviert; verwende für Ton eine Audio-Aktion.</p>`;
    form.oninput=()=>{editor=capture(form,editor);};form.onchange=form.oninput;preview(form.querySelector('[data-position-preview]'),editor);
    form.querySelector('[data-widget-close]').onclick=()=>{editor=null;renderWidgets();};
    form.onsubmit=safely(async e=>{e.preventDefault();if(!form.reportValidity())return;editor=capture(form,editor);editor.url=https(editor.url);const all=widgets().slice(),i=all.findIndex(x=>x.id===editor.id);if(i<0)all.push(editor);else all[i]=editor;await saveAndSync({chatExtras:{widgets:all}},'Widget gespeichert.');editor=null;renderWidgets();});
  }
  function renderLibraryGrid(host) {
    const list=library.filter(g=>g.name.toLowerCase().includes(query.toLowerCase())),perPage=60;page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(list.length/perPage)-1)));
    const grid=host.querySelector('[data-gift-grid]');grid.innerHTML=list.slice(page*perPage,(page+1)*perPage).map(g=>`<button type="button" class="gift-library-item ${wishDraft.items.some(x=>x.key===g.key)?'selected':''}" data-gift-add="${esc(g.key)}" aria-pressed="${wishDraft.items.some(x=>x.key===g.key)}"><img loading="lazy" src="${esc(g.url)}" alt=""><span>${esc(g.name)}</span></button>`).join('')||'<p>Keine passenden Bilder im Ordner.</p>';
    host.querySelector('[data-gift-count]').textContent=`${list.length} Bilder · Seite ${page+1} / ${Math.max(1,Math.ceil(list.length/perPage))}`;
    host.querySelector('[data-gift-prev]').disabled=page===0;host.querySelector('[data-gift-next]').disabled=(page+1)*perPage>=list.length;
    grid.querySelectorAll('[data-gift-add]').forEach(button=>button.onclick=()=>{const existing=wishDraft.items.find(x=>x.key===button.dataset.giftAdd);if(existing)wishDraft.items=wishDraft.items.filter(x=>x.key!==existing.key);else{const gift=library.find(x=>x.key===button.dataset.giftAdd);wishDraft.items.push({key:gift.key,name:gift.name,enabled:true,url:'',sourceType:'image',giftId:gift.giftId||'',giftIdVerified:gift.giftIdVerified===true,verificationSource:gift.verificationSource||''});}renderWishlist();});
  }
  async function renderWishlist() {
    const host=$('#wishlistModule');if(!host)return;const renderVersion=++wishlistRenderVersion;wishDraft||=clone(wishes());
    host.innerHTML='<p>Geschenk-Bibliothek wird geladen …</p>';
    try{await getLibrary(false,wishDraft.folderPath||'');if(renderVersion!==wishlistRenderVersion)return;}catch(e){host.innerHTML=`<p class="error">${esc(e.message)}</p><button data-retry>Erneut laden</button><button data-reset-folder>Mitgelieferte Bibliothek verwenden</button>`;host.querySelector('[data-retry]').onclick=()=>renderWishlist();host.querySelector('[data-reset-folder]').onclick=()=>{wishDraft.folderPath='';libraryPath=undefined;renderWishlist();};return;}
    host.innerHTML=`<p>Bilder auswählen und speichern. Bekannte Geschenk-IDs werden automatisch zugeordnet. Die Anzeige funktioniert auch ohne ID; echte TikFinity-Geschenke ergänzen die Erkennung.</p><p data-gift-catalog-status role="status">${giftCatalog.length} bekannte Geschenke${catalogStatus.error?" · Katalog momentan nicht erreichbar; vorhandene Daten bleiben verfügbar.":""}</p><datalist id="knownGiftIds">${giftCatalog.map(g=>`<option value="${esc(g.giftId)}">${esc(g.name)}${g.coins!=null?" · "+g.coins+" Coins":""}</option>`).join("")}</datalist><div class="toolbar"><button data-gift-refresh>Geschenk-Daten aktualisieren</button><button data-gift-folder>Anderen Ordner wählen</button><button data-gift-bundled>Mitgelieferte Bilder</button><small>${esc(wishDraft.folderPath||'Mitgelieferte Geschenk-Bibliothek')}</small></div><label>Geschenke suchen<input data-gift-search type="search" value="${esc(query)}" placeholder="z. B. Rose"></label><div class="gift-library-grid" data-gift-grid></div><div class="toolbar"><button data-gift-prev>← Zurück</button><small data-gift-count></small><button data-gift-next>Weiter →</button></div><form class="extra-editor"><h3>Deine Auswahl (${wishDraft.items.length})</h3><div class="form-grid"><label>Überschrift<input name="title" maxlength="100" value="${esc(wishDraft.title??'Wunschgeschenke')}"></label><label>Dein Text<textarea name="caption" maxlength="300" placeholder="z. B. Mein Wunschgeschenk heute">${esc(wishDraft.caption||'')}</textarea></label></div><div class="toolbar"><button type="button" data-wish-compact>Kompakte Größe</button></div><div class="url-row"><span>OBS-Browserquelle</span><code data-wish-obs-url>${esc(overlayBase())}/overlay/wishlist</code><button type="button" data-wish-copy>URL kopieren</button><button type="button" data-wish-obs>Öffnen</button></div><p>Diese Adresse als Browserquelle in OBS oder Link-Quelle in LIVE Studio einfügen (1920 × 1080). Sie zeigt die gespeicherte Auswahl und deinen Text.</p><div class="wish-edit-list">${wishDraft.items.map((g,i)=>`<details><summary>${esc(g.name)} <small>${g.enabled===false?'Aus':'Aktiv'}${!library.some(x=>x.key===g.key)&&!g.url?' · Datei fehlt':''}</small></summary><div class="form-grid"><label>Name<input data-wish-field="name" data-i="${i}" value="${esc(g.name)}" required></label><label>Zusätzliche HTTPS-Adresse<input type="url" data-wish-field="url" data-i="${i}" value="${esc(g.url||'')}"></label><label>Art der Adresse<select data-wish-field="sourceType" data-i="${i}"><option value="image" ${g.sourceType!=='widget'?'selected':''}>Bild / Animation</option><option value="widget" ${g.sourceType==='widget'?'selected':''}>Browser-Widget</option></select></label><label>Geschenk-Auslöser (optional)<input data-wish-field="giftId" data-i="${i}" list="knownGiftIds" inputmode="numeric" value="${esc(g.giftId||'')}" placeholder="Automatisch erkennen"></label><p class="composer-hint">${g.giftIdVerified?'Zugeordnet: Geschenk-ID '+esc(g.giftId):'Ohne Zuordnung: Bildanzeige und manueller Test funktionieren. Für Geschenk-Ereignisse wird eine bekannte ID benötigt.'}</p><label class="check"><input data-wish-field="enabled" data-i="${i}" type="checkbox" ${g.enabled!==false?'checked':''}>Anzeigen</label></div><div class="toolbar"><button type="button" data-wish-up="${i}" ${i===0?'disabled':''}>↑</button><button type="button" data-wish-down="${i}" ${i===wishDraft.items.length-1?'disabled':''}>↓</button><button type="button" data-wish-remove="${i}">Entfernen</button></div></details>`).join('')||'<p>Oben ein Geschenk auswählen.</p>'}</div><button type="button" data-wish-url>Eigene HTTPS-Quelle hinzufügen</button><label class="check"><input name="enabled" type="checkbox" ${wishDraft.enabled?'checked':''}>Wunschgeschenke im Chat anzeigen</label>${fields(wishDraft)}<div class="toolbar"><button type="submit" class="primary">Auswahl speichern</button><button type="button" data-wish-test>Gespeicherte Anzeige im Chat testen</button><button type="button" data-wish-reset>Änderungen verwerfen</button></div><p data-extra-status role="status"></p></form>`;
    renderLibraryGrid(host);host.querySelector('[data-gift-search]').oninput=e=>{query=e.target.value;page=0;renderLibraryGrid(host);};
    host.querySelector('[data-gift-prev]').onclick=()=>{page--;renderLibraryGrid(host);};host.querySelector('[data-gift-next]').onclick=()=>{page++;renderLibraryGrid(host);};
    host.querySelector('[data-gift-folder]').onclick=safely(async()=>{const r=await api.chooseGiftFolder();if(r.canceled)return;if(r.ok===false)throw Error(r.error);wishDraft.folderPath=r.folderPath;libraryPath=undefined;await renderWishlist();});
    host.querySelector('[data-gift-bundled]').onclick=()=>{wishDraft.folderPath='';libraryPath=undefined;renderWishlist();};
    host.querySelector('[data-gift-refresh]').onclick=safely(async()=>{host.querySelector('form')?.oninput?.();host.querySelector('[data-gift-catalog-status]').textContent='Geschenk-Daten werden geladen …';await getLibrary(true,wishDraft.folderPath||'');const resolved=await api.resolveGiftItems({items:wishDraft.items});if(resolved.ok)wishDraft.items=resolved.items;renderWishlist();});
    const form=host.querySelector('form');form.oninput=()=>{wishDraft=capture(form,wishDraft);for(const f of form.querySelectorAll('[data-wish-field]'))wishDraft.items[Number(f.dataset.i)][f.dataset.wishField]=f.type==='checkbox'?f.checked:f.value;};form.onchange=form.oninput;
    for(const direction of ['up','down','remove'])for(const button of host.querySelectorAll(`[data-wish-${direction}]`))button.onclick=()=>{form.oninput();const i=Number(button.getAttribute(`data-wish-${direction}`));if(direction==='remove')wishDraft.items.splice(i,1);else{const j=i+(direction==='up'?-1:1);[wishDraft.items[i],wishDraft.items[j]]=[wishDraft.items[j],wishDraft.items[i]];}renderWishlist();};
    host.querySelector('[data-wish-url]').onclick=()=>{form.oninput();wishDraft.items.push({key:'url:'+cryptoId(),name:'Eigene Anzeige',enabled:true,url:'',sourceType:'image',giftId:'',giftIdVerified:false});renderWishlist();};
    host.querySelector('[data-wish-copy]').onclick=()=>copy(host.querySelector('[data-wish-obs-url]').textContent);
    host.querySelector('[data-wish-obs]').onclick=()=>api.openOverlay('/overlay/wishlist');
    host.querySelector('[data-wish-compact]').onclick=()=>{form.oninput();Object.assign(wishDraft,{width:180,height:80,scale:1,layoutVersion:2});renderWishlist();};
    host.querySelector('[data-wish-reset]').onclick=()=>{wishDraft=null;renderWishlist();};
    host.querySelector('[data-wish-test]').onclick=safely(async()=>{const r=await api.chatWidgetTest({kind:'wishlist',preview:true,durationMs:8000});if(r.ok===false)throw Error(r.error);setView('dashboard');});
    form.onsubmit=safely(async e=>{e.preventDefault();if(!form.reportValidity())return;form.oninput();for(const gift of wishDraft.items){gift.url=https(gift.url);gift.giftId=String(gift.giftId||'').trim();if(!gift.giftId)gift.giftIdVerified=false;if(gift.key.startsWith('url:')&&!gift.url)throw Error('Bitte eine HTTPS-Adresse für die eigene Anzeige eingeben.');}const resolved=await api.resolveGiftItems({items:wishDraft.items});if(resolved.ok===false)throw Error(resolved.error);wishDraft.items=resolved.items;await saveAndSync({chatExtras:{wishlist:wishDraft}},'Wunschgeschenke gespeichert.');wishDraft=null;renderWishlist();});
  }
  function renderLiveCenter(){const host=$('#livecenterModule');host.innerHTML='<section class="livecenter-intro"><div class="livecenter-symbol">◉</div><h2>TikTok LIVE Center</h2><p>Statistiken, LIVE-Verwaltung und TikTok-Funktionen in einem eigenen Fenster. Melde dich dort direkt bei TikTok an.</p><button class="primary" data-livecenter-open>LIVE Center öffnen</button><p>Deine Anmeldung wird für dieses TikTok-Fenster gespeichert. Die Widget-Adressen und der Chat bleiben getrennt einstellbar.</p></section>';host.querySelector('[data-livecenter-open]').onclick=safely(async()=>{const r=await api.openLiveCenter();if(r?.ok===false)throw Error(r.error);});}
  const basePlatforms=renderPlatformsModule;renderPlatformsModule=function(){basePlatforms();const old=[...$('#platformsModule').querySelectorAll('.panel-section')].find(x=>x.querySelector('h3')?.textContent.includes('Weitere TikFinity-Widgets'));if(old){old.replaceChildren();const p=document.createElement('p');p.textContent='Follower- und weitere Chat-Einblendungen findest du unter TikFinity-Widgets neben Multi-Chat.';const button=document.createElement('button');button.textContent='TikFinity-Widgets öffnen';button.onclick=()=>setView('widgets');old.append(p,button);}};
  api.onGiftCatalogChanged?.(()=>{libraryPath=undefined;});
  window.BattoChatExtras={renderWidgets,renderWishlist,renderLiveCenter,apply,trigger};apply();
})();
