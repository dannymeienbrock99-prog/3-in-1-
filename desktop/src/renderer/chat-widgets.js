(() => {
 'use strict';
 const safely=fn=>async()=>{try{await fn();}catch(e){toast(e.message,true);}};
 const validUrl=value=>{if(!value)return '';try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='tikfinity.zerody.one'&&u.pathname.startsWith('/widget/')&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const frames=new Map();
 function frame(kind,url,parent){
  let el=frames.get(kind);
  if(!url){el?.remove();frames.delete(kind);return;}
  if(!el){el=document.createElement('iframe');el.title={snow:'TikFinity Schnee',likes:'TikFinity Like-Ziel',viewers:'TikFinity Zuschauerzahl'}[kind];el.className='chat-widget-frame';el.setAttribute('sandbox','allow-scripts allow-same-origin');el.setAttribute('referrerpolicy','no-referrer');el.tabIndex=-1;parent.append(el);frames.set(kind,el);}
  if(window.BattoResources)window.BattoResources.setFrameSource(el,url);else if(el.getAttribute('src')!==url)el.src=url;
 }
 let snow,stats,likes,viewers;
 window.applyChatWidgets=()=>{
  if(!S.config)return;
  const c=S.config.appearance?.chatWidgets||{};
  document.body.classList.toggle('chat-hide-brand',c.hideBrand!==false);
  const card=document.querySelector('.chat-card');if(!card)return;
  if(!snow){snow=document.createElement('div');snow.className='chat-snow';snow.setAttribute('aria-hidden','true');card.append(snow);stats=document.createElement('div');stats.className='chat-widget-stats';likes=document.createElement('div');viewers=document.createElement('div');stats.append(likes,viewers);card.querySelector('.card-head').after(stats);new ResizeObserver(()=>scaleSnow()).observe(card);}
  const enabled=c.enabled!==false;
  frame('snow',enabled&&c.snowEnabled!==false?validUrl(c.snowUrl):'',snow);frame('likes',enabled&&c.likesEnabled!==false?validUrl(c.likesUrl):'',likes);frame('viewers',enabled?validUrl(c.viewersUrl):'',viewers);
  stats.hidden=!frames.has('likes')&&!frames.has('viewers');likes.hidden=!frames.has('likes');viewers.hidden=!frames.has('viewers');
  likes.style.height=Math.max(50,Math.min(400,Number(c.likesHeight)||140))+'px';viewers.style.height=Math.max(50,Math.min(400,Number(c.viewersHeight)||100))+'px';scaleSnow();
  renderQuickControls();
 };
 function renderQuickControls(){
  if(detached)return;let box=document.querySelector('#dashboardQuickControls');if(!box){box=document.createElement('div');box.id='dashboardQuickControls';box.className='dashboard-quick';document.querySelector('.holo-card .card-head').after(box);}
  let audioHost=box.querySelector('[data-quick-audio-output]');
  if(!audioHost){audioHost=document.createElement('div');audioHost.dataset.quickAudioOutput='';}
  const c=S.config.appearance?.chatWidgets||{},events=S.config.events||[];
  box.innerHTML=`<div class="quick-switches"><label><span>Schnee</span><input id="quickSnow" role="switch" type="checkbox" ${c.enabled!==false&&c.snowEnabled!==false?'checked':''}><small>${c.enabled!==false&&c.snowEnabled!==false?'An':'Aus'}</small></label><label><span>Like-Balken</span><input id="quickLikes" role="switch" type="checkbox" ${c.enabled!==false&&c.likesEnabled!==false?'checked':''}><small>${c.enabled!==false&&c.likesEnabled!==false?'An':'Aus'}</small></label></div><div class="quick-events-head"><h3>Deine Events <small>(${events.length})</small></h3><button id="quickEventsOpen">Events öffnen</button></div><div class="quick-events-list">${events.length?events.map(e=>{const chain=S.config.actionChains?.find(x=>x.id===e.chainId);return `<div class="quick-event"><span class="quick-event-state ${e.enabled!==false?'on':''}" title="${e.enabled!==false?'Aktiv':'Deaktiviert'}"></span><div><strong>${esc(e.name||chain?.name||e.event||'Event')}</strong><small>${esc(e.platform||'Alle')} · ${esc(e.event||'custom')} · ${e.enabled!==false?'Aktiv':'Deaktiviert'}</small>${chain?`<small>${esc(chain.name)}</small>`:''}</div></div>`;}).join(''):'<p>Noch keine Events angelegt.</p>'}</div>`;
  box.querySelector('.quick-switches').after(audioHost);
  window.BattoAudioOutputUI?.mount(audioHost,{compact:true});
  for(const [id,field] of [['quickSnow','snowEnabled'],['quickLikes','likesEnabled']])document.getElementById(id).onchange=safely(async()=>{const checked=document.getElementById(id).checked;await saveAndSync({appearance:{chatWidgets:{enabled:true,snowEnabled:c.enabled!==false&&c.snowEnabled!==false,likesEnabled:c.enabled!==false&&c.likesEnabled!==false,[field]:checked}}});});
  document.getElementById('quickEventsOpen').onclick=()=>setView('events');
 }
 function scaleSnow(){const f=frames.get('snow');if(!f||!snow)return;const {width,height}=snow.getBoundingClientRect();f.style.transform=`translate(-50%, -50%) scale(${Math.max(width/1920,height/1080)})`;}
 const base=renderSettingsModule;
 renderSettingsModule=function(){base();const c=S.config.appearance?.chatWidgets||{};const box=document.createElement('section');box.className='panel-section';box.innerHTML=`<h3>TikFinity im Chatfenster</h3><p>Schnee liegt über dem Chat. Im eigenen Chatfenster sitzen Like-Ziel und Zuschauerzahl kompakt im oberen Streifen. Die Schneequelle läuft auf einer automatisch angepassten Fläche mit 1920 × 1080 Pixeln.</p><label class="check"><input id="cwEnabled" type="checkbox" ${c.enabled!==false?'checked':''}>Widgets anzeigen</label><label class="check"><input id="cwBrand" type="checkbox" ${c.hideBrand!==false?'checked':''}>Logo und Werbetext im eigenen Chatfenster ausblenden</label><label>Schnee – TikFinity-HTTPS-URL<input id="cwSnow" type="url" value="${esc(c.snowUrl||'')}" placeholder="https://tikfinity.zerody.one/widget/…"></label><label>Like-Balken – TikFinity-HTTPS-URL<input id="cwLikes" type="url" value="${esc(c.likesUrl||'')}"></label><label>Zuschauerzahl – TikFinity-HTTPS-URL<input id="cwViewers" type="url" value="${esc(c.viewersUrl||'')}"></label><div class="form-grid"><label>Höhe Like-Balken (Pixel)<input id="cwLikesHeight" type="number" min="50" max="400" value="${Number(c.likesHeight)||140}"></label><label>Höhe Zuschauerzahl (Pixel)<input id="cwViewersHeight" type="number" min="50" max="400" value="${Number(c.viewersHeight)||100}"></label></div><button class="primary" id="cwSave">Chat-Widgets speichern</button>`;$('#settingsModule').append(box);
  $('#cwSave').onclick=safely(async()=>{const snowUrl=$('#cwSnow').value.trim(),likesUrl=$('#cwLikes').value.trim(),viewersUrl=$('#cwViewers').value.trim();for(const url of [snowUrl,likesUrl,viewersUrl])if(url&&!validUrl(url))throw Error('Bitte eine HTTPS-Widget-URL von tikfinity.zerody.one eintragen.');await saveAndSync({appearance:{chatWidgets:{enabled:$('#cwEnabled').checked,hideBrand:$('#cwBrand').checked,snowUrl,likesUrl,viewersUrl,likesHeight:Math.max(50,Math.min(400,Number($('#cwLikesHeight').value)||140)),viewersHeight:Math.max(50,Math.min(400,Number($('#cwViewersHeight').value)||100))}}},'Chat-Widgets gespeichert.');});
 };
 window.applyChatWidgets();
})();
