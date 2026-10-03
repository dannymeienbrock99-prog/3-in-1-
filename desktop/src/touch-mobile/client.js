(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const storage={get:(kind,key)=>{try{return window[kind].getItem(key);}catch{return null;}},set:(kind,key,value)=>{try{value===null?window[kind].removeItem(key):window[kind].setItem(key,value);}catch{}}};
 let qrPin='';
 try{const fragment=new URLSearchParams(location.hash.slice(1));const value=fragment.get('pin');if(/^\d{6}$/.test(value||''))qrPin=value;if(location.hash)history.replaceState(null,'',location.pathname+location.search);}catch{}
 let token=storage.get('sessionStorage','batto-touch-session')||'',state,profileId,path=[],timer,inFlight=false,pressing=false,epoch=0,suspended=false,offline=false;
 let localSize=Number(storage.get('localStorage','batto-touch-size'));if(!Number.isFinite(localSize)||localSize<80||localSize>220)localSize=null;
 const status=(text,error=false)=>{ $('status').textContent=text; $('status').classList.toggle('error',error); };
 const fmt=reading=>reading&&Number.isFinite(reading.value)?reading.value.toLocaleString('de-DE',{maximumFractionDigits:reading.unit==='V'?2:1})+' '+(reading.unit||''):'—';
 async function request(route,body){
  const generation=epoch;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(token&&profileId?{'X-Batto-Profile':profileId,'X-Batto-Path':JSON.stringify(path)}:{}),...(token&&Number.isFinite(state?.revision)?{'X-Batto-Revision':String(state.revision)}:{}),...(token&&Number.isFinite(state?.visualRevision)?{'X-Batto-Visual-Revision':String(state.visualRevision)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   let result={};try{result=await response.json();}catch{}
   if(!response.ok){if(generation===epoch&&response.status===401&&route!=='/api/pair')disconnect('Verbindung abgelaufen. Bitte erneut koppeln.');throw Error(result.error||result.message||'Verbindung nicht möglich. Prüfe den PC und das Netzwerk.');}
   return result;
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw Error('PC nicht erreichbar. Batto und WLAN prüfen – die Verbindung wird automatisch erneut versucht.');throw error;}finally{clearTimeout(timeout);}
 }
 function active(){return state?.profiles.find(p=>p.id===profileId)||state?.profiles[0];}
 function page(){let p=active(),buttons=p?.buttons||[],titles=[];const valid=[];for(const index of path){const folder=buttons[index];if(folder?.type!=='folder')break;buttons=folder.buttons||[];titles.push(folder.title);valid.push(index);}path=valid;return {buttons,titles};}
 function size(){const profile=active();if(!profile)return;const inherited=Number(profile.keySize),selected=localSize||(inherited>=80&&inherited<=220?inherited:null),grid=$('keys');grid.classList.toggle('fixed-size',!!selected);if(selected)grid.style.setProperty('--key-size',selected+'px');else grid.style.removeProperty('--key-size');$('key-size').value=selected||120;$('key-size-value').textContent=localSize?localSize+' px':selected?'Vom PC · '+selected+' px':'Vom PC · automatisch';}
 const png=value=>typeof value==='string'&&value.startsWith('data:image/png;base64,')?value:'';
 const volumeControls=new Map();
 function releaseVolumeControls(){for(const control of volumeControls.values()){clearTimeout(control.timer);control.pending={};}volumeControls.clear();}
 function updateVolume(control,reading){
  if(!reading?.available||!Number.isFinite(reading.volume)){control.available=false;control.value.textContent='Nicht verfügbar';for(const node of [control.slider,control.minus,control.plus,control.mute])node.disabled=true;return;}
  control.available=true;for(const node of [control.slider,control.minus,control.plus,control.mute])node.disabled=false;
  if(!control.busy&&!control.timer&&!Object.keys(control.pending).length){control.slider.value=Math.max(0,Math.min(100,Math.round(reading.volume)));control.muted=!!reading.muted;}
  control.value.textContent=control.slider.value+' %'+(control.muted?' · Stumm':'');control.mute.textContent=control.muted?'Ton an':'Stumm';control.mute.setAttribute('aria-pressed',String(control.muted));
 }
 function volumes(values){if(!state)return;state.volumes=values||{};for(const [id,control] of volumeControls)updateVolume(control,state.volumes[id]);}
 async function flushVolume(control){
  clearTimeout(control.timer);control.timer=null;if(control.busy||!control.available||!token||volumeControls.get(control.id)!==control)return;
  const field=Object.hasOwn(control.pending,'volume')?'volume':Object.hasOwn(control.pending,'muted')?'muted':null;if(!field)return;
  const value=control.pending[field];delete control.pending[field];control.busy=true;const generation=epoch;
  try{const result=await request('/api/volume',{...control.position,[field]:value});if(generation!==epoch||volumeControls.get(control.id)!==control)return;if(result.value?.available!==undefined)state.volumes[control.id]=result.value;else if(result.volumes)state.volumes=result.volumes;else if(state.volumes?.[control.id])state.volumes[control.id][field]=value;if(!Object.keys(control.pending).length)status(control.title+' · Lautstärke übernommen');}
  catch(error){if(generation===epoch&&volumeControls.get(control.id)===control){control.pending={};status(error.message,true);}}
  finally{control.busy=false;if(generation===epoch&&volumeControls.get(control.id)===control){updateVolume(control,state?.volumes?.[control.id]);if(Object.keys(control.pending).length)void flushVolume(control);}}
 }
 function queueVolume(control,change,immediate=false){if(!control.available)return;Object.assign(control.pending,change);if(Object.hasOwn(change,'volume'))control.slider.value=change.volume;if(Object.hasOwn(change,'muted'))control.muted=change.muted;control.value.textContent=control.slider.value+' %'+(control.muted?' · Stumm':'');control.mute.textContent=control.muted?'Ton an':'Stumm';control.mute.setAttribute('aria-pressed',String(control.muted));clearTimeout(control.timer);control.timer=null;if(immediate)void flushVolume(control);else control.timer=setTimeout(()=>flushVolume(control),150);}
 function volumeKey(element,button,index){
  element.classList.add('volume-key');element.setAttribute('role','group');element.dataset.volume=button.id;
  const control={id:button.id,title:button.title,position:{profileId,path:[...path],index,buttonId:button.id,baseRevision:state.revision},pending:{},timer:null,busy:false,available:false,muted:false};
  const value=document.createElement('output');value.className='volume-value';control.value=value;element.append(value);
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.step='1';slider.value='0';slider.className='volume-slider';slider.setAttribute('aria-label',button.title+' Lautstärke');control.slider=slider;element.append(slider);
  const actions=document.createElement('div');actions.className='volume-actions';
  for(const [key,text,label] of [['minus','−','Leiser'],['mute','Stumm','Stummschalten'],['plus','+','Lauter']]){const item=document.createElement('button');item.type='button';item.textContent=text;item.setAttribute('aria-label',button.title+' · '+label);control[key]=item;actions.append(item);}element.append(actions);
  slider.oninput=event=>{event.stopPropagation();queueVolume(control,{volume:Number(slider.value)});};slider.onchange=event=>{event.stopPropagation();queueVolume(control,{volume:Number(slider.value)},true);};
  control.minus.onclick=event=>{event.stopPropagation();queueVolume(control,{volume:Math.max(0,Number(slider.value)-5)},true);};control.plus.onclick=event=>{event.stopPropagation();queueVolume(control,{volume:Math.min(100,Number(slider.value)+5)},true);};control.mute.onclick=event=>{event.stopPropagation();queueVolume(control,{muted:!control.muted},true);};
  volumeControls.set(button.id,control);updateVolume(control,state?.volumes?.[button.id]);
 }
 function pluginVisual(button,value){const visual=(state?.presentation||{})[value.id]||{},src=png(value.icon)||png(visual.image);let image=button.querySelector('img'),symbol=button.querySelector('.symbol');if(src){if(!image){image=document.createElement('img');image.alt='';button.prepend(image);}if(image.getAttribute('src')!==src)image.src=src;symbol?.remove();}else{image?.remove();if(!symbol){symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=value.symbol||'◆';button.prepend(symbol);}}let text=button.querySelector('.plugin-status');const message=String(visual.error||visual.title||'').slice(0,160);if(message){if(!text){text=document.createElement('span');text.className='plugin-status';button.append(text);}if(text.textContent!==message)text.textContent=message;}else text?.remove();button.classList.toggle('plugin-error',!!visual.error);}
 function visuals(next){if(!state||!Number.isFinite(next.visualRevision))return;state.visualRevision=next.visualRevision;if(next.visuals!==undefined||next.presentation!==undefined)state.presentation=next.visuals||next.presentation||{};const byId=new Map(page().buttons.filter(Boolean).map(value=>[value.id,value]));document.querySelectorAll('[data-plugin]').forEach(button=>{const value=byId.get(button.dataset.plugin);if(value)pluginVisual(button,value);});}
 function render(){
  const profile=active();if(!profile)return;if(profileId!==profile.id)path=[];profileId=profile.id;
  document.body.classList.remove('pairing-screen');$('pairing').hidden=true;$('deck').hidden=false;$('disconnect').hidden=false;
  const select=$('profiles');select.replaceChildren(...state.profiles.map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name;return option;}));select.value=profileId;
  const {buttons,titles}=page();$('breadcrumb').textContent=[profile.name,...titles].join(' / ');$('back').hidden=!path.length;
  const grid=$('keys');grid.style.setProperty('--cols',profile.columns);size();releaseVolumeControls();grid.replaceChildren();
  for(let index=0;index<profile.columns*profile.rows;index++){
   const value=buttons[index],button=document.createElement(value?.type==='volume'?'div':'button');button.className='key';if(value?.type!=='volume')button.type='button';button.dataset.index=index;
   if(!value){button.disabled=true;button.classList.add('empty');button.setAttribute('aria-label','Unbelegte Taste');grid.append(button);continue;}
   button.setAttribute('aria-label',value.title);button.classList.toggle('folder',value.type==='folder');
   if(value.icon?.startsWith('data:image/png;base64,')){const image=document.createElement('img');image.src=value.icon;image.alt='';button.append(image);}else{const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=value.symbol||(value.type==='folder'?'▣':value.type==='sensor'?'◴':'◆');button.append(symbol);}
   const label=document.createElement('span');label.className='title';label.textContent=value.title;button.append(label);
   if(value.type==='volume'){volumeKey(button,value,index);grid.append(button);continue;}
   if(value.type==='sensor'){const reading=document.createElement('span');reading.className='reading';reading.dataset.reading=value.id;reading.textContent=fmt(state.readings?.[value.id]);button.append(reading);}
   if(value.type==='plugin'){button.dataset.plugin=value.id;pluginVisual(button,value);}
   button.onclick=async()=>{
    if(value.type==='folder'){path.push(index);render();return;}
    if(value.type==='sensor'||pressing)return;
    pressing=true;button.classList.add('busy');status(value.title+' …');
    try{await request('/api/press',{profileId,path:[...path],index,buttonId:value.id,baseRevision:state.revision});status(value.title+(value.type==='plugin'?' · an Plugin gesendet':' · ausgeführt'));}catch(error){status(error.message,true);}finally{pressing=false;button.classList.remove('busy');}
   };
   grid.append(button);
  }
 }
 function readings(values){state.readings=values||{};document.querySelectorAll('[data-reading]').forEach(node=>{const text=fmt(state.readings[node.dataset.reading]);if(node.textContent!==text)node.textContent=text;});}
 function schedule(){clearTimeout(timer);if(token&&!document.hidden&&!suspended)timer=setTimeout(refresh,volumeControls.size?2500:3000);}
 async function refresh(){
  if(!token||document.hidden||suspended||inFlight)return;inFlight=true;const generation=epoch;
  try{const next=await request('/api/readings');if(generation!==epoch)return;if(!state||next.revision!==state.revision){const updated=await request('/api/state');if(generation!==epoch)return;state=updated;render();}else{readings(next.readings);visuals(next);volumes(next.volumes);}if(offline){offline=false;status('Wieder verbunden · Tasten bereit');}}catch(error){if(generation===epoch){offline=true;status(error.message,true);}}finally{inFlight=false;schedule();}
 }
 function disconnect(message='Verbindung getrennt.'){
  ++epoch;clearTimeout(timer);releaseVolumeControls();token='';state=null;offline=false;storage.set('sessionStorage','batto-touch-session',null);document.body.classList.add('pairing-screen');$('pairing').hidden=false;$('deck').hidden=true;$('disconnect').hidden=true;$('keys').replaceChildren();status(message);
 }
 $('pair-form').onsubmit=async event=>{
  event.preventDefault();const generation=++epoch;const button=event.submitter||$('pair-form').querySelector('button');button.disabled=true;
  try{const paired=await request('/api/pair',{pin:$('pin').value.trim()});if(generation!==epoch)return;token=paired.token;storage.set('sessionStorage','batto-touch-session',token);state=paired.state;profileId=state.activeProfile;path=[];render();$('pin').value='';qrPin='';$('android-open').removeAttribute('href');$('android-open').hidden=true;status('Verbunden · Tasten bereit');schedule();}catch(error){status(error.message,true);}finally{button.disabled=false;}
 };
 function androidLink(){const link=$('android-open');if(!/Android/i.test(navigator.userAgent)||navigator.userAgent.includes('BattoTouchDeck/')){link.hidden=true;return;}const pin=$('pin').value.trim();link.href='batto-touch://connect?url='+encodeURIComponent(location.origin+'/')+(/^\d{6}$/.test(pin)?'&pin='+encodeURIComponent(pin):'');link.hidden=false;}
 if(qrPin){$('pin').value=qrPin;$('qr-note').hidden=false;status('QR-Code erkannt · Verbinden antippen');}
 $('pin').addEventListener('input',androidLink);androidLink();
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
