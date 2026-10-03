'use strict';
const path=require('node:path');
const {validWidgetUrl}=require('../renderer/battlebar-view.js');
// OBS receives display data, never keys, configuration accounts or raw provider errors.
function publicBattleState(state={}){
  const number=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
  const statuses=['disabled','waiting','live','awaiting-result','ended','unsupported','disconnected','error'];
  return {status:statuses.includes(state.status)?state.status:'waiting',connected:state.connected===true,endsAt:number(state.endsAt),updatedAt:number(state.updatedAt),lastEventAt:number(state.lastEventAt),battleId:state.battleId==null?null:String(state.battleId).slice(0,100),teams:(Array.isArray(state.teams)?state.teams:[]).slice(0,2).map(team=>({name:String(team?.name||'').slice(0,80),points:/^\d{1,40}$/.test(String(team?.points??''))?String(team.points):null}))};
}
function publicBattleConfig(full={}){
  const config=full.battleBar||full,bound=(value,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):fallback));
  return {enabled:config.enabled===true,provider:['tikfinity','euler','widget'].includes(config.provider)?config.provider:'tikfinity',widgetUrl:validWidgetUrl(config.widgetUrl),width:bound(config.width,80,1920,360),height:bound(config.height,40,1080,90),anchor:['top-left','top-right','center','bottom-left','bottom-right'].includes(config.anchor)?config.anchor:'top-right',x:bound(config.x,0,1920,8),y:bound(config.y,0,1080,8)};
}
function registerBattleRoutes(app,{getState,getConfig}){
  const renderer=path.join(__dirname,'../renderer');
  app.get('/overlay/battle',(_req,res)=>{
    res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src https://tikfinity.zerody.one https://widgets.tikfinity.com; base-uri 'none'; form-action 'none'");
    res.type('html').send('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Batto · TikTok Match</title><link rel="stylesheet" href="/overlay/battle/style.css"><script defer src="/overlay/battle/url.js"></script><script defer src="/overlay/battle/view.js"></script></head><body class="batto-battle-overlay"><main data-batto-battle-overlay aria-label="TikTok Match Battle-Bar"></main></body></html>');
  });
  app.get('/overlay/battle/url.js',(_req,res)=>res.type('application/javascript').sendFile(path.join(renderer,'tikfinity-url.js')));
  app.get('/overlay/battle/view.js',(_req,res)=>res.type('application/javascript').sendFile(path.join(renderer,'battlebar-view.js')));
  app.get('/overlay/battle/style.css',(_req,res)=>res.type('text/css').sendFile(path.join(renderer,'battlebar.css')));
  app.get('/battle/state',(_req,res)=>{res.set('Cache-Control','no-store');res.json({state:publicBattleState(getState?.()||{}),config:publicBattleConfig(getConfig?.()||{})});});
}
module.exports={registerBattleRoutes,publicBattleState,publicBattleConfig};
