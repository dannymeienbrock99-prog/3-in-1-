(function(root,factory){const view=factory();if(typeof module==='object'&&module.exports)module.exports=view;else root.BattoBattleView=view;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const bound=(value,min,max,fallback)=>Math.max(min,Math.min(max,finite(value,fallback)));
  const widgetUrls=typeof module==='object'&&module.exports?require('./tikfinity-url.js'):window.BattoTikfinityUrl;
  const validWidgetUrl=value=>widgetUrls?.normalize(value)||'';
  function points(value){const raw=value===null||value===undefined?'':String(value);return /^\d{1,40}$/.test(raw)?BigInt(raw):null;}
  function describe(state={},config={}){
    if(config.provider==='widget')return validWidgetUrl(config.widgetUrl)?'TikFinity-Widget · Sichtbare Inhalte werden von TikFinity geliefert.':'TikFinity-Widget-Adresse fehlt.';
    if(state.status==='error')return String(state.error||'Match-Verbindung fehlgeschlagen. Einstellungen prüfen.').slice(0,240);
    return ({disabled:'Match-Verbindung ausgeschaltet.',disconnected:'Match-Verbindung getrennt.',waiting:'Warte auf Match-Daten.',live:'Match läuft.','awaiting-result':'Match-Zeit abgelaufen · warte auf das Ergebnis.',ended:'Match beendet.',unsupported:'Dieses Match-Format kann noch nicht als Battle-Bar angezeigt werden.'})[state.status]||'Warte auf Match-Daten.';
  }
  function model(state={},config={},now=Date.now()){
    const teams=Array.isArray(state.teams)?state.teams.slice(0,2):[];
    const showTeams=config.provider!=='widget'&&teams.length===2&&['live','awaiting-result','ended','disconnected','error'].includes(state.status),parsed=teams.map(team=>points(team?.points));
    let share=null;if(showTeams&&parsed.every(value=>value!==null)){const total=parsed[0]+parsed[1];share=total===0n?50:Number(parsed[0]*100000n/total)/1000;}
    const rawEnd=state.endsAt,end=rawEnd===null||rawEnd===undefined?NaN:Number(rawEnd);
    const seconds=Number.isFinite(end)&&end>0&&state.status==='live'?Math.max(0,Math.ceil((end-now)/1000)):null;
    return {showTeams,teams:teams.map((team,i)=>({name:String(team?.name||'Name noch nicht übermittelt').slice(0,80),score:parsed[i]===null?'—':parsed[i].toLocaleString('de-DE')})),share,timer:seconds===null?'':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,status:describe(state,config),knownScores:showTeams&&share!==null};
  }
  const mounted=new WeakMap();
  function render(host,state={},config={},options={}){
    const doc=host.ownerDocument;let ctx=mounted.get(host);
    if(!ctx){const bar=doc.createElement('section');bar.className='batto-battle-bar';bar.setAttribute('aria-label','TikTok Match');host.append(bar);ctx={bar,kind:null};mounted.set(host,ctx);}
    const {bar}=ctx,width=bound(config.width,80,1920,360),height=bound(config.height,40,1080,90);bar.hidden=options.visible===false;
    // A reserved row keeps the chat readable. OBS uses the configured full size.
    bar.style.width=`${options.compact?Math.min(width,480):width}px`;bar.style.height=`${options.compact?Math.min(height,110):height}px`;bar.dataset.density=height<65?'small':'normal';
    if(bar.hidden){if(ctx.frame){ctx.frame.remove();ctx.frame=null;ctx.kind=null;}return;}
    if(config.provider==='widget'&&validWidgetUrl(config.widgetUrl)){
      if(ctx.kind!=='widget'){bar.replaceChildren();const frame=doc.createElement('iframe');frame.className='batto-battle-frame';frame.title='TikFinity Battle-Bar';frame.tabIndex=-1;frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.setAttribute('referrerpolicy','no-referrer');frame.setAttribute('allow',"autoplay 'none'; camera 'none'; microphone 'none'");bar.append(frame);ctx.frame=frame;ctx.kind='widget';}
      const url=validWidgetUrl(config.widgetUrl);if(doc.defaultView?.BattoResources)doc.defaultView.BattoResources.setFrameSource(ctx.frame,url);else if(ctx.frame.getAttribute('src')!==url)ctx.frame.src=url;bar.classList.add('batto-battle-widget');return;
    }
    if(ctx.kind!=='native'){
      bar.replaceChildren();bar.classList.remove('batto-battle-widget');ctx.frame=null;ctx.kind='native';
      const header=doc.createElement('div');header.className='batto-battle-heading';const title=doc.createElement('b');title.textContent='TikTok Match';const timer=doc.createElement('span');timer.className='batto-battle-timer';header.append(title,timer);
      const teams=doc.createElement('div');teams.className='batto-battle-teams';const rows=[];
      for(let i=0;i<2;i++){const row=doc.createElement('div'),name=doc.createElement('span'),score=doc.createElement('strong');name.className='batto-battle-name';score.className='batto-battle-score';row.append(name,score);teams.append(row);rows.push({name,score});}
      const track=doc.createElement('div');track.className='batto-battle-track';const fill=doc.createElement('i');track.append(fill);const status=doc.createElement('div');status.className='batto-battle-status';bar.append(header,teams,track,status);Object.assign(ctx,{timer,teams,rows,track,fill,status});
    }
    const data=model(state,config);bar.dataset.status=state.status||'waiting';ctx.timer.textContent=data.timer;ctx.timer.hidden=!data.timer;ctx.teams.hidden=!data.showTeams;ctx.track.hidden=!data.knownScores;
    for(let i=0;i<2;i++){ctx.rows[i].name.textContent=data.teams[i]?.name||'';ctx.rows[i].name.title=data.teams[i]?.name||'';ctx.rows[i].score.textContent=data.teams[i]?.score||'';}
    ctx.fill.style.width=`${data.share===null?50:data.share}%`;ctx.track.setAttribute('aria-label',data.knownScores?`${data.teams[0].name}: ${data.teams[0].score}; ${data.teams[1].name}: ${data.teams[1].score}`:'Punkte noch nicht übermittelt');ctx.status.textContent=data.status;ctx.status.title=data.status;ctx.status.hidden=state.status==='live'&&data.knownScores;
    if(state.status==='live'&&!data.knownScores){ctx.status.textContent='Punkte noch nicht übermittelt.';ctx.status.title=ctx.status.textContent;}
  }
  function position(host,config={}){
    for(const key of ['left','right','top','bottom','transform'])host.style[key]='';
    const x=bound(config.x,0,1920,8),y=bound(config.y,0,1080,8),anchor=String(config.anchor||'top-right');
    if(anchor==='center'){host.style.left='50%';host.style.top='50%';host.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;}
    else{host.style[anchor.endsWith('left')?'left':'right']=`${x}px`;host.style[anchor.startsWith('bottom')?'bottom':'top']=`${y}px`;}
  }
  if(typeof document==='object')document.addEventListener('DOMContentLoaded',()=>{
    const host=document.querySelector('[data-batto-battle-overlay]');if(!host)return;
    let stopped=false,config={enabled:false},state={status:'waiting',teams:[]},nextPoll,requestTimeout,controller;
    const update=async()=>{
      if(stopped)return;
      controller=new AbortController();requestTimeout=setTimeout(()=>controller?.abort(),5000);
      try{
        const response=await fetch('/battle/state',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();
        const result=await response.json();
        if(!result.state||typeof result.state!=='object'||!result.config||typeof result.config!=='object')throw Error();
        config=result.config;state=result.state;
      }catch{state={status:'disconnected',connected:false,teams:[],endsAt:null,error:null};}
      finally{clearTimeout(requestTimeout);requestTimeout=null;controller=null;}
      if(stopped)return;
      position(host,config);render(host,state,config,{visible:config.enabled===true});nextPoll=setTimeout(update,1000);
    };
    window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(nextPoll);clearTimeout(requestTimeout);controller?.abort();},{once:true});void update();
  });
  return {validWidgetUrl,points,describe,model,render,position};
});
