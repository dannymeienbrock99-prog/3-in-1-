'use strict';

function hologramPage(design = {}, preview = false) {
  const number = (v, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : fallback));
  const color = (v, fallback) => /^#[a-f\d]{6}$/i.test(v || '') ? v : fallback;
  const options = {
    enabled: design.enabled !== false, username: design.usernameEnabled !== false,
    message: design.messageEnabled !== false, seconds: number(design.displaySeconds,12,2,120), preview
  };
  const font = ['Segoe UI','Arial','Impact','Verdana','BattoCustom'].includes(design.fontFamily) ? design.fontFamily : 'Segoe UI';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Batto Twitch-Hologramm</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @font-face{font-family:BattoCustom;src:url('/font/custom')}
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
  body{font-family:'${font}',sans-serif;color:${color(design.messageColor,'#ffffff')};font-size:${number(design.fontSize,20,10,80)}px}
  body.preview{background:radial-gradient(ellipse at bottom,#102d43,#050d18 75%)}
  #chat{position:absolute;bottom:24px;left:24px;right:24px;display:flex;flex-direction:column;gap:12px}
  .holo{position:relative;isolation:isolate;overflow:hidden;padding:14px 18px;border:1px solid #6cddff88;border-left:3px solid #93edff;border-radius:4px 14px 14px 4px;background:linear-gradient(110deg,#092539e8,#062036b8);box-shadow:0 0 ${number(design.glow,10,0,60)}px #55dcff66,inset 0 0 18px #67dfff18;opacity:${number(design.opacity,.92,0,1)};animation:appear .35s ease-out;overflow-wrap:anywhere}
  .holo::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:repeating-linear-gradient(0deg,transparent 0 3px,#7ee8ff12 3px 4px)}
  .preview .holo{animation:none}
  .heading{display:flex;gap:8px;align-items:center;margin-bottom:5px;color:${color(design.usernameColor,'#00d4ff')};font-weight:700;text-shadow:0 0 ${number(design.glow,10,0,60)}px currentColor}
  img{width:20px;height:20px}.text{line-height:1.4;white-space:pre-wrap}
  #preview{position:absolute;top:14px;left:24px;font:14px 'Segoe UI';color:#b5eeff;background:#112638;padding:8px 12px;border-radius:6px}
  @keyframes appear{from{transform:translateY(12px);opacity:0}to{transform:translateY(0)}}
  @media(prefers-reduced-motion:reduce){.holo{animation:none}}
  </style><script src="/overlay-client.js"></script></head><body class="${preview ? 'preview' : 'live'}"><main id="chat"></main><script>
  const options=${JSON.stringify(options)};const chat=document.getElementById('chat');const seen=new Set();
  function add(m){if(!options.enabled||m.platform!=='twitch'||(!options.username&&!options.message))return;
    if(m.id&&seen.has(m.id))return;if(m.id){seen.add(m.id);if(seen.size>500)seen.delete(seen.values().next().value);}
    const row=document.createElement('article');row.className='holo';
    if(options.username){const h=document.createElement('div');h.className='heading';const icon=document.createElement('img');icon.src='/assets/platforms/twitch.svg';icon.alt='Twitch';const name=document.createElement('span');name.textContent=m.displayName||m.username||'';h.append(icon,name);row.append(h);}
    if(options.message){const t=document.createElement('div');t.className='text';t.textContent=m.message||m.text||'';row.append(t);}
    chat.append(row);while(chat.children.length>6||chat.scrollHeight>innerHeight-100&&chat.children.length>1)chat.firstElementChild.remove();if(!options.preview)setTimeout(()=>row.remove(),options.seconds*1000);
  }
  if(options.preview){connectBatto();const label=document.createElement('div');label.id='preview';label.textContent='Vorschau · sendet keine Chatnachrichten'+(!options.enabled?' · Hologramm ausgeschaltet':'');document.body.append(label);add({platform:'twitch',username:'Crazy_Batto',message:'Willkommen im Stream!'});add({platform:'twitch',username:'Zuschauer',message:'So sieht dein Twitch-Chat als Hologramm aus.'});}
  else{const ws=connectBatto();ws.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type==='chat')add(x.data);}catch{}};fetch('/state').then(r=>r.json()).then(s=>(s.messages||[]).filter(m=>m.platform==='twitch'&&Date.now()-Date.parse(m.timestamp)<options.seconds*1000).slice(-6).forEach(add)).catch(()=>{});}
  </script></body></html>`;
}
module.exports = { hologramPage };
