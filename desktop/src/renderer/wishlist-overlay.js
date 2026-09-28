(() => {
 'use strict';
 const host=document.getElementById('wishlist'),cells=new Map();
 const title=document.createElement('strong'),caption=document.createElement('div'),grid=document.createElement('div');
 title.className='wish-overlay-title';caption.className='wish-overlay-caption';grid.className='wish-overlay-items';host.append(title,caption,grid);
 let config={enabled:false,items:[]},active=false,previewActive=false,hiddenOverride=false,previewHidden=false;
 let timer,fadeTimer,reconnectTimer,socket,attempt=0,closed=false,pending=Promise.resolve();
 const queue=[],seen=new Set();
 const bounded=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
 function paint(){
  const c=config,s=bounded(c.scale,1,.1,5);
  Object.assign(host.style,{width:bounded(c.width,180,40,1920)*s+'px',height:bounded(c.height,80,30,1080)*s+'px',left:'auto',right:'auto',top:'auto',bottom:'auto',transform:''});
  const anchor=c.anchor||'top-right',x=Number(c.x)||0,y=Number(c.y)||0;
  if(anchor==='center'){host.style.left='50%';host.style.top='50%';host.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;}
  else{host.style[anchor.endsWith('right')?'right':'left']=x+'px';host.style[anchor.startsWith('bottom')?'bottom':'top']=y+'px';}
  title.textContent=c.title??'Wunschgeschenke';title.hidden=!title.textContent;caption.textContent=c.caption||'';caption.hidden=!caption.textContent;
  const allowed=new Set();
  for(const item of c.enabled||previewActive?c.items||[]:[]){
   if(allowed.has(item.key))continue;allowed.add(item.key);
   const kind=item.sourceType==='widget'?'iframe':'img';let cell=cells.get(item.key);
   if(cell&&cell.kind!==kind){cell.node.remove();cells.delete(item.key);cell=null;}
   if(!cell){
    const node=document.createElement('div'),media=document.createElement(kind),label=document.createElement('span');node.className='wish-overlay-item';
    if(kind==='iframe'){media.setAttribute('sandbox','allow-scripts allow-same-origin');media.setAttribute('allow',"autoplay 'none'; camera 'none'; microphone 'none'");media.referrerPolicy='no-referrer';}
    else media.onerror=()=>{media.hidden=true;node.dataset.missing='true';};
    node.append(media,label);cell={node,media,label,kind,url:null};cells.set(item.key,cell);
   }
   cell.label.textContent=item.name;if(kind==='iframe')cell.media.title=item.name;else cell.media.alt=item.name;
   if(cell.url!==item.url){cell.media.hidden=false;delete cell.node.dataset.missing;cell.media.src=item.url;cell.url=item.url;}
   const index=allowed.size-1;if(grid.children[index]!==cell.node)grid.insertBefore(cell.node,grid.children[index]||null);
  }
  for(const[key,cell]of cells)if(!allowed.has(key)){cell.node.remove();cells.delete(key);}
 }
 function restorePermanent(){if(config.enabled&&config.permanent&&!hiddenOverride&&(config.items||[]).length)show({});}
 function hide(advance=true){
  clearTimeout(timer);clearTimeout(fadeTimer);
  const wasPreview=previewActive;host.style.transition=`opacity ${bounded(config.fadeOutMs,0,0,10000)}ms`;host.style.opacity='0';
  fadeTimer=setTimeout(()=>{
   active=false;previewActive=false;host.style.visibility='hidden';if(!config.enabled)paint();
   if(wasPreview)hiddenOverride=previewHidden;
   if(advance&&queue.length)show(queue.shift());else if(advance&&wasPreview)restorePermanent();
  },bounded(config.fadeOutMs,0,0,10000));
 }
 function show(p){
  if(!(config.items||[]).length)return;
  clearTimeout(timer);clearTimeout(fadeTimer);
  if(p.preview===true&&!previewActive)previewHidden=hiddenOverride;
  hiddenOverride=false;active=true;previewActive=p.preview===true;paint();
  host.style.visibility='visible';host.style.transition=`opacity ${bounded(config.fadeInMs,0,0,10000)}ms`;host.style.opacity='1';
  if(previewActive||!config.permanent||Number(p.durationMs)>0)timer=setTimeout(()=>{if(!previewActive&&config.permanent)hiddenOverride=true;hide();},bounded(Number(p.durationMs)>0?p.durationMs:config.durationMs,8000,250,120000));
 }
 async function refresh(){
  const response=await fetch('/api/wishlist',{cache:'no-store'});if(!response.ok)throw Error('Wunschgeschenke nicht erreichbar');
  const next=await response.json();if(closed)return;const old=config;config=next;paint();
  if(old.enabled!==next.enabled)hiddenOverride=false;
  if(!(config.items||[]).length){queue.length=0;hide(false);return;}
  if(previewActive)return;
  if(!config.enabled){queue.length=0;hide(false);}
  else if(old.permanent&&!next.permanent){queue.length=0;hide(false);}
  else if(config.permanent&&!hiddenOverride&&!active)restorePermanent();
  // A timed trigger keeps its expiry through unrelated configuration updates.
 }
 function trigger(p){
  const id=p.triggerId||p.eventId;if(id){if(seen.has(id))return;seen.add(id);if(seen.size>500)seen.delete(seen.values().next().value);}
  if(p.visible===false){queue.length=0;hiddenOverride=true;previewHidden=true;hide(false);return;}
  if((!p.preview&&!config.enabled)||!(config.items||[]).length)return;
  if(active&&!p.preview&&config.queueMode==='discard')return;
  if(active&&!p.preview&&config.queueMode==='queue'&&!config.permanent){if(queue.length<bounded(config.maxQueue,10,1,100))queue.push(p);return;}
  show(p);
 }
 async function message(event){
  const p=JSON.parse(event.data);if(!p||typeof p!=='object'||Array.isArray(p))return;
  if(p.type==='config'&&(!p.sections||p.sections.includes('chatExtras')))await refresh();
  else if(p.type==='chat-widgets:trigger'&&p.data?.kind==='wishlist'){await refresh();trigger(p.data);}
  else if(p.type==='event'){
   const e=p.data||{},type=String(e.type||e.event||'').toLowerCase();if(type!=='gift'||e.platform!=='tiktok')return;
   await refresh();const id=String(e.gift?.id??e.data?.gift?.id??e.data?.gift?.giftId??e.data?.giftId??e.giftId??'');
   if(id&&(config.items||[]).some(x=>x.giftIdVerified&&String(x.giftId)===id))trigger({eventId:e.eventId||e.id||e.data?.msgId});
  }
 }
 function enqueue(work){pending=pending.then(()=>{if(!closed)return work();}).catch(()=>{});return pending;}
 function connect(){
  if(closed)return;const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');socket=ws;
  ws.onopen=()=>{attempt=0;enqueue(refresh);};
  ws.onmessage=event=>enqueue(()=>{if(socket===ws)return message(event);});
  ws.onerror=()=>ws.close();ws.onclose=()=>{if(!closed&&socket===ws)reconnectTimer=setTimeout(connect,[1000,2000,5000,10000][Math.min(attempt++,3)]);};
 }
 addEventListener('beforeunload',()=>{closed=true;socket?.close();clearTimeout(timer);clearTimeout(fadeTimer);clearTimeout(reconnectTimer);},{once:true});
 enqueue(refresh);connect();
})();
