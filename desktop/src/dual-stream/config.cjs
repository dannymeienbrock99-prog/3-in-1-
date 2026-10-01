'use strict';
const spec=require('./project-specification.json');
const platforms=['tiktok','twitch'],sourceIds=['game','camera','microphone','desktop'];
const copy=x=>JSON.parse(JSON.stringify(x));
function defaults(){return {version:1,profile:spec.active_profile,obsRoot:'',sources:{game:{enabled:false,kind:'game',target:'',name:''},camera:{enabled:false,target:'',name:''},microphone:{enabled:false,target:'default',name:'Windows-Standard'},desktop:{enabled:false,target:'default',name:'Windows-Standard'}},layouts:{tiktok:[{source:'game',x:0,y:0.22,width:1,height:0.56,fit:'contain',visible:true},{source:'camera',x:0.53,y:0.02,width:0.44,height:0.19,fit:'contain',visible:true}],twitch:[{source:'game',x:0,y:0,width:1,height:1,fit:'contain',visible:true},{source:'camera',x:0.73,y:0.61,width:0.25,height:0.36,fit:'contain',visible:true}]},destinations:{tiktok:{server:'',muted:false},twitch:{server:'rtmp://live.twitch.tv/app',muted:false}}};}
function str(v,max=2048){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f]/.test(v))throw Error('Ungültiger Text in der Dual-Stream-Konfiguration.');return v;}
function boolean(v){if(typeof v!=='boolean')throw Error('Ungültiger Schalter.');return v;}
function number(v,min,max){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Position oder Größe liegt außerhalb der Leinwand.');return v;}
function server(v){str(v);if(!v)return '';let u;try{u=new URL(v);}catch{throw Error('Bitte eine gültige RTMP- oder RTMPS-Serveradresse eintragen.');}if(!['rtmp:','rtmps:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash||u.search)throw Error('Serveradresse ohne Zugangsdaten oder Stream-Key eintragen.');return v;}
function validate(input){
 if(!input||input.version!==1)throw Error('Dieses Dual-Stream-Format wird nicht unterstützt.');
 const c=defaults();if(!Object.hasOwn(spec.profiles,input.profile))throw Error('Unbekanntes Qualitätsprofil.');c.profile=input.profile;c.obsRoot=str(input.obsRoot||'');
 for(const id of sourceIds){const s=input.sources?.[id];if(!s)throw Error('Aufnahmequelle fehlt.');c.sources[id]={enabled:boolean(s.enabled),target:str(s.target),name:str(s.name||'',300)};if(id==='game'){if(!['game','window','screen'].includes(s.kind))throw Error('Unbekannte Aufnahmeart.');c.sources[id].kind=s.kind;}if(s.enabled&&!s.target)throw Error('Bitte für eingeschaltete Quellen ein Gerät oder Fenster auswählen.');}
 for(const p of platforms){const list=input.layouts?.[p];if(!Array.isArray(list)||list.length!==2||new Set(list.map(x=>x.source)).size!==2||list.some(x=>!['game','camera'].includes(x.source)))throw Error('Jede Leinwand braucht genau Spiel und Kamera als gemeinsame Bildquellen.');
  c.layouts[p]=list.map(item=>{const x=number(item.x,0,1),y=number(item.y,0,1),width=number(item.width,0.02,1),height=number(item.height,0.02,1);if(x+width>1.00001||y+height>1.00001)throw Error('Quelle liegt außerhalb der Leinwand.');if(!['contain','cover'].includes(item.fit))throw Error('Ungültige Einpassung.');return {source:item.source,x,y,width,height,fit:item.fit,visible:boolean(item.visible)};});
  c.destinations[p]={server:server(input.destinations?.[p]?.server??''),muted:boolean(input.destinations?.[p]?.muted??false)};
 }return c;
}
function importProject(data){
 if(data?.document_type==='project_configuration_specification'){
  if(data.config_version!==1||data.canvases?.length!==2||!data.canvases.some(x=>x.id==='tiktok_vertical')||!data.canvases.some(x=>x.id==='twitch_landscape'))throw Error('Das Projekt muss genau TikTok 9:16 und Twitch 16:9 enthalten.');
  const c=defaults();c.profile=data.active_profile;return validate(c);
 }return validate(data);
}
function profile(config){const p=copy(spec.profiles[config.profile]);return {fps:p.fps,tiktok:p.outputs.tiktok_vertical,twitch:p.outputs.twitch_landscape,uploadMbps:(p.outputs.tiktok_vertical.video_bitrate_kbps+p.outputs.twitch_landscape.video_bitrate_kbps+256)/1000};}
module.exports={defaults,validate,importProject,profile,platforms,server};
