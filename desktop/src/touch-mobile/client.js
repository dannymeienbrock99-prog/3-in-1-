(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const storage={get:(kind,key)=>{try{return window[kind].getItem(key);}catch{return null;}},set:(kind,key,value)=>{try{value===null?window[kind].removeItem(key):window[kind].setItem(key,value);}catch{}}};
 let token=storage.get('sessionStorage','batto-touch-session')||'',state,profileId,path=[],timer,inFlight=false,pressing=false,epoch=0,suspended=false,offline=false;
 let localSize=Number(storage.get('localStorage','batto-touch-size'));if(!Number.isFinite(localSize)||localSize<80||localSize>220)localSize=null;
 const status=(text,error=false)=>{ $('status').textContent=text; $('status').classList.toggle('error',error); };
 const fmt=reading=>reading&&Number.isFinite(reading.value)?reading.value.toLocaleString('de-DE',{maximumFractionDigits:reading.unit==='V'?2:1})+' '+(reading.unit||''):'—';
 async function request(route,body){
  const generation=epoch;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(token&&profileId?{'X-Batto-Profile':profileId}:{}),...(token&&Number.isFinite(state?.visualRevision)?{'X-Batto-Visual-Revision':String(state.visualRevision)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   let result={};try{result=await response.json();}catch{}
   if(!response.ok){if(generation===epoch&&response.status===401&&route!=='/api/pair')disconnect('Verbindung abgelaufen. Bitte erneut koppeln.');throw Error(result.error||result.message||'Verbindung nicht möglich. Prüfe den PC und das Netzwerk.');}
   return result;
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw Error('PC nicht erreichbar. Batto und WLAN prüfen – die Verbindung wird automatisch erneut versucht.');throw error;}finally{clearTimeout(timeout);}
 }
 function active(){return state?.profiles.find(p=>p.id===profileId)||state?.profiles[0];}
 function page(){let p=active(),buttons=p?.buttons||[],titles=[];const valid=[];for(const index of path){const folder=buttons[index];if(folder?.type!=='folder')break;buttons=folder.buttons||[];titles.push(folder.title);valid.push(index);}path=valid;return {buttons,titles};}
 function size(){const profile=active();if(!profile)return;const inherited=Number(profile.keySize),selected=localSize||(inherited>=80&&inherited<=220?inherited:null),grid=$('keys');grid.classList.toggle('fixed-size',!!selected);if(selected)grid.style.setProperty('--key-size',selected+'px');else grid.style.removeProperty('--key-size');$('key-size').value=selected||120;$('key-size-value').textContent=localSize?localSize+' px':selected?'Vom PC · '+selected+' px':'Vom PC · automatisch';}
 const png=value=>typeof value==='string'&&value.startsWith('data:image/png;base64,')?value:'';
 function pluginVisual(button,value){const visual=(state?.presentation||{})[value.id]||{},src=png(value.icon)||png(visual.image);let image=button.querySelector('img'),symbol=button.querySelector('.symbol');if(src){if(!image){image=document.createElement('img');image.alt='';button.prepend(image);}if(image.getAttribute('src')!==src)image.src=src;symbol?.remove();}else{image?.remove();if(!symbol){symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=value.symbol||'◆';button.prepend(symbol);}}let text=button.querySelector('.plugin-status');const message=String(visual.error||visual.title||'').slice(0,160);if(message){if(!text){text=document.createElement('span');text.className='plugin-status';button.append(text);}if(text.textContent!==message)text.textContent=message;}else text?.remove();button.classList.toggle('plugin-error',!!visual.error);}
 function visuals(next){if(!state||!Number.isFinite(next.visualRevision))return;state.visualRevision=next.visualRevision;if(next.visuals!==undefined||next.presentation!==undefined)state.presentation=next.visuals||next.presentation||{};const byId=new Map(page().buttons.filter(Boolean).map(value=>[value.id,value]));document.querySelectorAll('[data-plugin]').forEach(button=>{const value=byId.get(button.dataset.plugin);if(value)pluginVisual(button,value);});}
 function render(){
  const profile=active();if(!profile)return;profileId=profile.id;
  $('pairing').hidden=true;$('deck').hidden=false;$('disconnect').hidden=false;
  const select=$('profiles');select.replaceChildren(...state.profiles.map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name;return option;}));select.value=profileId;
  const {buttons,titles}=page();$('breadcrumb').textContent=[profile.name,...titles].join(' / ');$('back').hidden=!path.length;
  const grid=$('keys');grid.style.setProperty('--cols',profile.columns);size();grid.replaceChildren();
  for(let index=0;index<profile.columns*profile.rows;index++){
   const value=buttons[index],button=document.createElement('button');button.className='key';button.type='button';button.dataset.index=index;
   if(!value){button.disabled=true;button.classList.add('empty');button.setAttribute('aria-label','Unbelegte Taste');grid.append(button);continue;}
   button.setAttribute('aria-label',value.title);button.classList.toggle('folder',value.type==='folder');
   if(value.icon?.startsWith('data:image/png;base64,')){const image=document.createElement('img');image.src=value.icon;image.alt='';button.append(image);}else{const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=value.symbol||(value.type==='folder'?'▣':value.type==='sensor'?'◴':'◆');button.append(symbol);}
   const label=document.createElement('span');label.className='title';label.textContent=value.title;button.append(label);
   if(value.type==='sensor'){const reading=document.createElement('span');reading.className='reading';reading.dataset.reading=value.id;reading.textContent=fmt(state.readings?.[value.id]);button.append(reading);}
   if(value.type==='plugin'){button.dataset.plugin=value.id;pluginVisual(button,value);}
   button.onclick=async()=>{
    if(value.type==='folder'){path.push(index);render();return;}
    if(value.type==='sensor'||pressing)return;
    pressing=true;button.classList.add('busy');status(value.title+' …');
    try{await request('/api/press',{profileId,path:[...path],index});status(value.title+(value.type==='plugin'?' · an Plugin gesendet':' · ausgeführt'));}catch(error){status(error.message,true);}finally{pressing=false;button.classList.remove('busy');}
   };
   grid.append(button);
  }
 }
 function readings(values){state.readings=values||{};document.querySelectorAll('[data-reading]').forEach(node=>{const text=fmt(state.readings[node.dataset.reading]);if(node.textContent!==text)node.textContent=text;});}
 function schedule(){clearTimeout(timer);if(token&&!document.hidden&&!suspended)timer=setTimeout(refresh,3000);}
 async function refresh(){
  if(!token||document.hidden||suspended||inFlight)return;inFlight=true;const generation=epoch;
  try{const next=await request('/api/readings');if(generation!==epoch)return;if(!state||next.revision!==state.revision){const updated=await request('/api/state');if(generation!==epoch)return;state=updated;render();}else{readings(next.readings);visuals(next);}if(offline){offline=false;status('Wieder verbunden · Tasten bereit');}}catch(error){if(generation===epoch){offline=true;status(error.message,true);}}finally{inFlight=false;schedule();}
 }
 function disconnect(message='Verbindung getrennt.'){
  ++epoch;clearTimeout(timer);token='';state=null;offline=false;storage.set('sessionStorage','batto-touch-session',null);$('pairing').hidden=false;$('deck').hidden=true;$('disconnect').hidden=true;$('keys').replaceChildren();status(message);
 }
 $('pair-form').onsubmit=async event=>{
  event.preventDefault();const generation=++epoch;const button=event.submitter||$('pair-form').querySelector('button');button.disabled=true;
  try{const paired=await request('/api/pair',{pin:$('pin').value.trim()});if(generation!==epoch)return;token=paired.token;storage.set('sessionStorage','batto-touch-session',token);state=paired.state;profileId=state.activeProfile;path=[];render();$('pin').value='';status('Verbunden · Tasten bereit');schedule();}catch(error){status(error.message,true);}finally{button.disabled=false;}
 };
 $('profiles').onchange=()=>{profileId=$('profiles').value;path=[];render();};
 $('back').onclick=()=>{path.pop();render();};
 $('disconnect').onclick=()=>{void request('/api/disconnect',{}).catch(()=>{});disconnect();};
 $('key-size').oninput=()=>{localSize=Number($('key-size').value);storage.set('localStorage','batto-touch-size',String(localSize));size();};
 $('size-reset').onclick=()=>{localSize=null;storage.set('localStorage','batto-touch-size',null);size();};
 window.addEventListener('batto:suspend',()=>{suspended=true;clearTimeout(timer);});
 window.addEventListener('batto:resume',()=>{suspended=false;if(!document.hidden)void refresh();});
 document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)void refresh();});
 if(navigator.standalone||window.matchMedia('(display-mode: standalone)').matches||navigator.userAgent.includes('BattoTouchDeck/'))$('install-help').hidden=true;
 if(token)void (async()=>{const generation=epoch;try{const restored=await request('/api/state');if(generation!==epoch)return;state=restored;profileId=state.activeProfile;render();status('Wieder verbunden');schedule();}catch(error){if(generation===epoch)disconnect(error.message);}})();
})();
