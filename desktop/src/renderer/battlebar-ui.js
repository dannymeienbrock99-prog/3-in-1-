(() => {
  'use strict';
  const ID='batto-battlebar';
  const defaults={enabled:false,provider:'tikfinity',username:'',widgetUrl:'',width:360,height:90,anchor:'top-right',x:8,y:8};
  let state={status:'waiting',teams:[]},hasKey=false,chatHost,previewUntil=0,previewTimer;
  const config=()=>({...defaults,...S.config?.battleBar});
  const message=()=>window.BattoBattleView.describe(state,config());
  const obsUrl=()=>`${overlayBase()}/overlay/battle`;
  const safely=fn=>async(...args)=>{try{await fn(...args);}catch(error){toast(error.message,true);}};
  function apply(){
    const tabs=document.querySelector('.chat-card #chatTabs');if(!tabs||!window.BattoBattleView)return;
    if(!chatHost){chatHost=document.createElement('div');chatHost.className='batto-battle-chat';chatHost.setAttribute('aria-label','TikTok Match');tabs.before(chatHost);}
    const item=config(),visible=item.enabled||previewUntil>Date.now();chatHost.hidden=!visible;
    chatHost.style.justifyContent=item.anchor.endsWith('left')?'flex-start':item.anchor==='center'?'center':'flex-end';
    window.BattoBattleView.render(chatHost,state,item,{visible,compact:true});updateStatus();
  }
  function preview(payload={}){
    const duration=Math.max(500,Math.min(30000,Number(payload.durationMs)||8000));
    previewUntil=Date.now()+duration;clearTimeout(previewTimer);previewTimer=setTimeout(()=>{previewUntil=0;apply();},duration);apply();
  }
  function updateStatus(){
    document.querySelectorAll('[data-battlebar-status]').forEach(el=>{el.textContent=message();});
    document.querySelectorAll('[data-battlebar-key-status]').forEach(el=>{el.textContent=hasKey?'Eulerstream-Schlüssel ist geschützt gespeichert.':'Noch kein Eulerstream-Schlüssel gespeichert.';});
  }
  async function reload(){
    if(!api.battleGetState)return;const result=await api.battleGetState();
    if(result.ok===false)throw Error(result.error||'Match-Status konnte nicht gelesen werden.');
    state=result.state||{status:'waiting',teams:[]};hasKey=result.hasKey===true;apply();
  }
  function read(form){
    const data=new FormData(form),provider=String(data.get('provider'));
    const widgetUrl=form.elements.widgetUrl.value.trim(),username=form.elements.username.value.trim().replace(/^@/,'');
    if(provider==='widget'&&!window.BattoBattleView.validWidgetUrl(widgetUrl))throw Error('Bitte die vollständige HTTPS-Widget-Adresse aus TikFinity einfügen.');
    if(provider==='euler'&&!/^[\w.]{2,32}$/.test(username))throw Error('Bitte deinen TikTok-Benutzernamen ohne Link eingeben.');
    return {...config(),provider,username,widgetUrl,enabled:data.get('enabled')==='on',width:Number(data.get('width')),height:Number(data.get('height')),anchor:String(data.get('anchor')),x:Number(data.get('x')),y:Number(data.get('y'))};
  }
  async function save(form){
    if(!form.reportValidity())return false;
    const next=read(form),key=form.elements.eulerKey.value.trim();
    if(next.provider==='euler'&&key){const result=await api.battleSaveKey(key);if(result.ok===false)throw Error(result.error||'Schlüssel konnte nicht gespeichert werden.');form.elements.eulerKey.value='';hasKey=result.hasKey===true;}
    await saveAndSync({battleBar:next});apply();return true;
  }
  function mount(host){
    if(!host||host.querySelector('[data-battlebar-form]'))return;
    const item=config(),section=document.createElement('section');section.className='panel-section battlebar-settings';
    section.innerHTML=`<form data-battlebar-form><h3>TikTok Match · Battle-Bar</h3>
      <p>Namen, Match-Punkte und die übermittelte Restzeit. Die Stream-Deck-Taste schaltet die Anzeige im Chat und in der Browserquelle an und aus.</p>
      <label class="check"><input name="enabled" type="checkbox" ${item.enabled?'checked':''}>Battle-Bar anzeigen</label>
      <label>Datenquelle<select name="provider"><option value="tikfinity" ${item.provider==='tikfinity'?'selected':''}>TikFinity · lokale Verbindung</option><option value="euler" ${item.provider==='euler'?'selected':''}>Eulerstream · direkte Match-Daten</option><option value="widget" ${item.provider==='widget'?'selected':''}>TikFinity · eigene Widget-Adresse</option></select></label>
      <div data-battlebar-provider="tikfinity"><p>TikFinity muss mit deinem LIVE verbunden sein und Match-Ereignisse an Batto weitergeben. Ohne eingehende Match-Daten bleibt die Anzeige auf „Warte auf Match“.</p></div>
      <div data-battlebar-provider="euler"><label>Dein TikTok-Benutzername<input name="username" maxlength="32" autocomplete="off" spellcheck="false" placeholder="crazy_batto" value="${esc(item.username)}"></label><label>Eulerstream-API-Schlüssel<input name="eulerKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="Neuen Schlüssel hier einfügen"></label><div class="toolbar"><button type="button" data-battlebar-save-key>Schlüssel geschützt speichern</button><button type="button" data-battlebar-remove-key>Schlüssel entfernen</button></div><p data-battlebar-key-status role="status"></p><p>Den Schlüssel erhältst du in deinem Eulerstream-Konto. Er wird getrennt von den normalen Einstellungen geschützt gespeichert.</p></div>
      <div data-battlebar-provider="widget"><label>Vollständige TikFinity-HTTPS-Widget-Adresse<input name="widgetUrl" type="url" value="${esc(item.widgetUrl)}" placeholder="Adresse aus TikFinity einfügen"></label><p>Diese Anzeige verwendet die Inhalte deiner Widget-Seite. Eine geladene Seite bestätigt noch keine laufenden Match-Daten.</p></div>
      <div class="form-grid three"><label>Breite (Pixel)<input name="width" type="number" min="80" max="1920" value="${Number(item.width)}" required></label><label>Höhe (Pixel)<input name="height" type="number" min="40" max="1080" value="${Number(item.height)}" required></label><label>Position in der Browserquelle<select name="anchor">${[['top-left','Oben links'],['top-right','Oben rechts'],['center','Mitte'],['bottom-left','Unten links'],['bottom-right','Unten rechts']].map(([id,label])=>`<option value="${id}" ${item.anchor===id?'selected':''}>${label}</option>`).join('')}</select></label><label>Abstand X (Pixel)<input name="x" type="number" min="0" max="1920" value="${Number(item.x)}" required></label><label>Abstand Y (Pixel)<input name="y" type="number" min="0" max="1080" value="${Number(item.y)}" required></label></div>
      <p>Im Chat sitzt die Battle-Bar platzsparend oberhalb der Nachrichten. Die Positionsabstände gelten für die Browserquelle.</p>
      <div class="toolbar"><button type="submit" class="primary">Battle-Bar speichern</button><button type="button" data-battlebar-connect>Verbindung neu aufbauen</button><button type="button" data-battlebar-test>8 Sekunden im Chat ansehen</button></div>
      <p data-battlebar-status role="status"></p><p class="hint">Die Vorschau zeigt den tatsächlichen Stand. Ohne Match werden keine Beispielpunkte erzeugt.</p>
      <div class="url-row"><span>OBS / LIVE Studio</span><code data-battlebar-url>${esc(obsUrl())}</code><button type="button" data-battlebar-copy>URL kopieren</button></div><p>Als Browserquelle mit 1920 × 1080 Pixeln einfügen. Der Hintergrund bleibt transparent.</p></form>`;
    host.prepend(section);const form=section.querySelector('form'),provider=form.elements.provider;
    const showProvider=()=>{
      section.querySelectorAll('[data-battlebar-provider]').forEach(el=>{el.hidden=el.dataset.battlebarProvider!==provider.value;});
      form.elements.username.required=provider.value==='euler';form.elements.widgetUrl.required=provider.value==='widget';
      form.elements.username.disabled=provider.value!=='euler';form.elements.widgetUrl.disabled=provider.value!=='widget';
    };
    provider.onchange=showProvider;showProvider();
    form.onsubmit=safely(async event=>{event.preventDefault();if(await save(form))toast('Battle-Bar gespeichert.');});
    section.querySelector('[data-battlebar-test]').onclick=safely(async()=>{if(!await save(form))return;preview();setView('dashboard');toast('Aktueller Match-Stand wird für 8 Sekunden im Chat angezeigt.');});
    section.querySelector('[data-battlebar-connect]').onclick=safely(async()=>{
      if(!await save(form))return;const result=await api.battleReconnect();if(result.ok===false)throw Error(result.error||'Verbindung konnte nicht aufgebaut werden.');await reload();toast(message());
    });
    section.querySelector('[data-battlebar-save-key]').onclick=safely(async()=>{
      const field=form.elements.eulerKey,key=field.value.trim();if(!key)throw Error('Bitte zuerst deinen Eulerstream-API-Schlüssel einfügen.');
      const result=await api.battleSaveKey(key);if(result.ok===false)throw Error(result.error||'Schlüssel konnte nicht gespeichert werden.');
      field.value='';hasKey=result.hasKey===true;updateStatus();toast('Eulerstream-Schlüssel geschützt gespeichert.');
    });
    section.querySelector('[data-battlebar-remove-key]').onclick=safely(async()=>{
      const result=await api.battleSaveKey('');if(result.ok===false)throw Error(result.error||'Schlüssel konnte nicht entfernt werden.');form.elements.eulerKey.value='';hasKey=false;await reload();toast('Eulerstream-Schlüssel entfernt.');
    });
    section.querySelector('[data-battlebar-copy]').onclick=safely(async()=>{await api.copyText(obsUrl());toast('Battle-Bar-Adresse kopiert.');});updateStatus();
  }
  const renderWidgets=window.BattoChatExtras?.renderWidgets;
  if(renderWidgets)window.BattoChatExtras.renderWidgets=function(...args){const result=renderWidgets(...args);mount(document.querySelector('#widgetsModule'));return result;};
  const settings=window.renderSettingsModule;
  if(settings)window.renderSettingsModule=function(...args){const result=settings(...args);mount(document.querySelector('#settingsModule'));return result;};
  const appearance=window.applyAppearance;
  if(appearance)window.applyAppearance=function(...args){const result=appearance(...args);apply();return result;};
  api.onBattleState?.(next=>{state=next?.state||next||{status:'waiting',teams:[]};if(typeof next?.hasKey==='boolean')hasKey=next.hasKey;apply();});
  api.onBattlePreview?.(preview);
  window.BattoBattlebar={id:ID,config,mount,apply,reload,preview};
  void reload().catch(error=>{state={status:'error',error:error.message,teams:[]};apply();});
  setInterval(()=>{if(chatHost&&!chatHost.hidden&&window.BattoResources?.chatVisible()!==false)apply();},1000);
})();
