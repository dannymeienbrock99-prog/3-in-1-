'use strict';
const {ipcRenderer}=require('electron');
if(location.hostname==='dashboard.twitch.tv'||location.hostname==='www.twitch.tv'){
  let root,observer,ready=false,serial=0;const seen=new WeakSet();
  const session=String(Date.now())+'-'+Math.random().toString(36).slice(2);
  const rows=el=>[...(el.matches?.('[data-a-target="chat-line-message"],.chat-line__message')?[el]:[]),...el.querySelectorAll?.('[data-a-target="chat-line-message"],.chat-line__message')||[]];
  function canonicalLogin(user){const value=user?.getAttribute('data-a-user')||'';return /^[a-z0-9_]{1,25}$/i.test(value)?value.toLowerCase():'';}
  function hasModeratorBadge(row){
    // Only Twitch's badge element and badge CDN can supply a narration hint.
    // Text/emotes in the message body and arbitrary image titles cannot.
    return [...row.querySelectorAll('img[data-a-target="chat-badge"], [data-a-target="chat-badge"] img')].some(image=>{
      if(String(image.getAttribute('alt')||'').trim().toLowerCase()!=='moderator')return false;
      try{const url=new URL(image.getAttribute('src'));return url.protocol==='https:'&&url.hostname==='static-cdn.jtvnw.net'&&/^\/badges\/v1\/[a-f0-9-]{36}\/[123]$/.test(url.pathname)&&!url.username&&!url.password;}catch{return false;}
    });
  }
  function ingest(row){
    if(seen.has(row))return;
    const user=row.querySelector('[data-a-target="chat-message-username"],.chat-author__display-name');
    const content=row.querySelector('[data-a-target="chat-line-message-body"],.chat-line__message-container');
    let text='';const pieces=row.querySelectorAll('.text-fragment,.mention-fragment,.link-fragment,img.chat-image');
    if(pieces.length)text=[...pieces].map(p=>p.tagName==='IMG'?p.alt:p.textContent).join('');
    else if(content)text=content.textContent;
    // Twitch mounts rows in several passes; system rows have no author at all.
    // Neither case means the logged-in composer has disconnected.
    if(!user||!text.trim())return;
    seen.add(row);
    const login=canonicalLogin(user);
    ipcRenderer.send('twitch-popout:message',{id:row.getAttribute('data-id')||row.getAttribute('data-message-id')||session+':'+(++serial),canonicalLogin:login,moderatorBadge:!!login&&hasModeratorBadge(row),username:login||user.textContent.trim(),displayName:user.textContent.trim(),message:text.trim(),timestamp:new Date().toISOString(),isModerator:false,isBroadcaster:false});
  }
  function attach(){
    const next=document.querySelector('[data-test-selector="chat-scrollable-area__message-container"],.chat-scrollable-area__message-container');
    if(next===root&&root?.isConnected)return;
    observer?.disconnect();root=next;ready=false;
    if(!root){ipcRenderer.send('twitch-popout:status',{state:'waiting-chat',connected:false,error:'Twitch-Chat noch nicht bereit. Anmeldung oder Webseite prüfen.'});return;}
    rows(root).forEach(r=>seen.add(r));
    // Loading/reloading the chat establishes a baseline. It must never replay commands.
    const baseline=setTimeout(()=>{if(root===next){rows(root).forEach(r=>seen.add(r));ready=true;ipcRenderer.send('twitch-popout:status',{state:'connected',connected:true,error:null});}},2000);
    observer=new MutationObserver(()=>{for(const row of rows(next)){if(ready)ingest(row);else seen.add(row);}});
    observer.observe(root,{childList:true,characterData:true,subtree:true});
    window.addEventListener('beforeunload',()=>clearTimeout(baseline),{once:true});
  }
  window.addEventListener('DOMContentLoaded',()=>{attach();setInterval(attach,3000);});
  ipcRenderer.on('twitch-popout:send',(_e,{id,text})=>{
    const input=document.querySelector('[data-a-target="chat-input"]');
    const button=document.querySelector('[data-a-target="chat-send-button"]');
    if(!ready||!input||!button){ipcRenderer.send('twitch-popout:sent',{id,ok:false,error:'Twitch-Sendefeld ist nicht bereit. Im Popout anmelden und Schreibrechte prüfen.'});return;}
    // Preserve a message the user is currently composing.
    const editorText=()=>{
      // React/Slate may replace the editor after native input. Read the live node.
      const input=document.querySelector('[data-a-target="chat-input"]');
      if(!input)return null;
      if(input.tagName==='TEXTAREA')return input.value.trim();
      const copy=input.cloneNode(true);
      copy.querySelectorAll('[data-slate-placeholder],[aria-hidden="true"]').forEach(el=>el.remove());
      copy.querySelectorAll('img[alt]').forEach(el=>el.replaceWith(document.createTextNode(el.alt)));
      return (copy.textContent||'').replace(/[\u200B\uFEFF]/g,'').trim();
    };
    if(editorText()){ipcRenderer.send('twitch-popout:sent',{id,ok:false,error:'Im Twitch-Popout steht ein ungesendeter Entwurf. Bitte den Text dort zuerst selbst senden oder entfernen.'});return;}
    input.focus();
    if(input.tagName!=='TEXTAREA'&&!input.isContentEditable){ipcRenderer.send('twitch-popout:sent',{id,ok:false,error:'Twitch-Sendefeld wurde geändert.'});return;}
    // Let Chromium edit the focused control so Slate/React receive native input.
    const submit=(_event,p)=>{if(p.id!==id)return;ipcRenderer.removeListener('twitch-popout:submit',submit);clearTimeout(expiry);
      setTimeout(()=>{const currentButton=document.querySelector('[data-a-target="chat-send-button"]');if(!currentButton||currentButton.disabled){ipcRenderer.send('twitch-popout:sent',{id,ok:false,error:'Twitch hat das Sendefeld nicht freigegeben. Der eingefügte Text steht noch im Popout.'});return;}if(editorText()!==text.trim()){ipcRenderer.send('twitch-popout:sent',{id,ok:false,error:'Der Text im Twitch-Popout wurde verändert. Bitte dort prüfen.'});return;}currentButton.click();ipcRenderer.send('twitch-popout:sent',{id,ok:true,queued:true});},150);
    };
    const expiry=setTimeout(()=>ipcRenderer.removeListener('twitch-popout:submit',submit),10000);
    ipcRenderer.on('twitch-popout:submit',submit);
    ipcRenderer.send('twitch-popout:sent',{id,ok:true,phase:'compose'});
  });
}
