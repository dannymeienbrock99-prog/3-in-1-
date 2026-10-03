'use strict';
const spec=require('./project-specification.json');
const {validateObsCollection,sceneChoices,resolveScene}=require('./obs-collection.cjs');
const platforms=['tiktok','twitch'],cameraIds=['camera','camera2','camera3'],visualIds=['game',...cameraIds],sourceIds=[...visualIds,'microphone','desktop'];
const copy=x=>JSON.parse(JSON.stringify(x));
function defaults(){return {program:{scene:'Spiel',transition:'fade',durationMs:350,chat:false,events:true,backgrounds:{}},version:1,layoutRevision:2,profile:spec.active_profile,obsRoot:'',sources:{game:{enabled:false,kind:'game',target:'',name:''},...Object.fromEntries(cameraIds.map(id=>[id,{enabled:false,target:'',name:''}])),microphone:{enabled:false,target:'default',name:'Windows-Standard'},desktop:{enabled:false,target:'default',name:'Windows-Standard'}},layouts:{tiktok:[{source:'game',x:0,y:0.48,width:1,height:0.52,fit:'contain',visible:true},{source:'camera',x:0,y:0,width:1,height:0.48,fit:'cover',visible:true},{source:'camera2',x:.02,y:.70,width:.22,height:.25,fit:'contain',visible:true},{source:'camera3',x:.27,y:.70,width:.22,height:.25,fit:'contain',visible:true}],twitch:[{source:'game',x:0,y:0,width:1,height:1,fit:'contain',visible:true},{source:'camera',x:0.73,y:0.61,width:0.25,height:0.36,fit:'contain',visible:true},{source:'camera2',x:.02,y:.70,width:.20,height:.28,fit:'contain',visible:true},{source:'camera3',x:.25,y:.70,width:.20,height:.28,fit:'contain',visible:true}]},destinations:{tiktok:{server:'',muted:false},twitch:{server:'rtmp://live.twitch.tv/app',muted:false}}};}
function str(v,max=2048){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f]/.test(v))throw Error('Ungültiger Text in der Dual-Stream-Konfiguration.');return v;}
function boolean(v){if(typeof v!=='boolean')throw Error('Ungültiger Schalter.');return v;}
function number(v,min,max){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Position oder Größe liegt außerhalb der Leinwand.');return v;}
function server(v){str(v);if(!v)return '';let u;try{u=new URL(v);}catch{throw Error('Bitte eine gültige RTMP- oder RTMPS-Serveradresse eintragen.');}if(!['rtmp:','rtmps:'].includes(u.protocol)||!u.hostname||u.username||u.password||u.hash||u.search)throw Error('Serveradresse ohne Zugangsdaten oder Stream-Key eintragen.');return v;}
function validate(input){
 if(!input||input.version!==1)throw Error('Dieses Dual-Stream-Format wird nicht unterstützt.');
 const c=defaults();if(!Object.hasOwn(spec.profiles,input.profile))throw Error('Unbekanntes Qualitätsprofil.');c.profile=input.profile;c.obsRoot=str(input.obsRoot||'');
 for(const id of sourceIds){const s=input.sources?.[id]??(['camera2','camera3'].includes(id)&&!Object.hasOwn(input.sources||{},id)?c.sources[id]:null);if(!s)throw Error('Aufnahmequelle fehlt.');c.sources[id]={enabled:boolean(s.enabled),target:str(s.target),name:str(s.name||'',300)};if(id==='game'){if(!['game','window','screen'].includes(s.kind))throw Error('Unbekannte Aufnahmeart.');c.sources[id].kind=s.kind;}if(s.enabled&&!s.target.trim())throw Error('Bitte für eingeschaltete Quellen ein Gerät oder Fenster auswählen.');}
 const cameraTargets=new Set();for(const id of cameraIds){const s=c.sources[id];if(!s.enabled)continue;const target=s.target.trim().toLowerCase();if(cameraTargets.has(target))throw Error('Dasselbe Kameragerät darf nur einmal eingeschaltet sein. Bitte für jede Kamera ein anderes Gerät auswählen.');cameraTargets.add(target);}
 for(const p of platforms){const list=input.layouts?.[p];if(!Array.isArray(list)||list.length<2||list.length>4||new Set(list.map(x=>x?.source)).size!==list.length||list.some(x=>!visualIds.includes(x?.source))||!['game','camera'].every(id=>list.some(x=>x.source===id)))throw Error('Jede Leinwand braucht Spiel und Kamera 1; Kamera 2 und 3 können ergänzt werden.');
  const additional=c.layouts[p].filter(x=>!list.some(item=>item.source===x.source));
  c.layouts[p]=list.map(item=>{const x=number(item.x,0,1),y=number(item.y,0,1),width=number(item.width,0.02,1),height=number(item.height,0.02,1);if(x+width>1.00001||y+height>1.00001)throw Error('Quelle liegt außerhalb der Leinwand.');if(!['contain','cover'].includes(item.fit))throw Error('Ungültige Einpassung.');return {source:item.source,x,y,width,height,fit:item.fit,visible:boolean(item.visible)};});
  c.layouts[p].push(...additional);
  c.destinations[p]={server:server(input.destinations?.[p]?.server??''),muted:boolean(input.destinations?.[p]?.muted??false)};
 }
 // Upgrade only the old factory layout; preserve deliberately arranged layouts.
 if(!input.layoutRevision){const [g,camera]=['game','camera'].map(id=>c.layouts.tiktok.find(x=>x.source===id));if(g.x===0&&g.y===.22&&g.width===1&&g.height===.56&&camera.x===.53&&camera.y===.02&&camera.width===.44&&camera.height===.19)c.layouts.tiktok=c.layouts.tiktok.map(item=>['game','camera'].includes(item.source)?defaults().layouts.tiktok.find(x=>x.source===item.source):item);}
 const collection=validateObsCollection(input.obsCollection);if(collection)c.obsCollection=collection;
 const program=input.program||{};let selectedScene='Spiel';if(typeof program.scene==='string'){try{selectedScene=resolveScene(c,program.scene);}catch{if(program.scene.startsWith('obs:'))throw Error('Die ausgewählte OBS-Szene ist nicht mehr vorhanden.');}}
 c.program={scene:selectedScene,transition:program.transition==='cut'?'cut':'fade',durationMs:Number.isInteger(program.durationMs)?Math.max(100,Math.min(2000,program.durationMs)):350,chat:program.chat===true,events:program.events!==false,backgrounds:{}};
 // null means deliberately removed; empty/absent keeps the legacy factory background.
 for(const scene of ['Pause','Start','Ende'])c.program.backgrounds[scene]=program.backgrounds?.[scene]===null?null:str(program.backgrounds?.[scene]||'',2000);
 c.program.platformBackgrounds={tiktok:{},twitch:{}};
 for(const p of platforms)for(const scene of ['Pause','Start','Ende']){
  const value=program.platformBackgrounds?.[p]?.[scene];
  if(value!==undefined)c.program.platformBackgrounds[p][scene]=value===null?null:str(value,2000);
 }
 return c;
}
function importProject(data){
 if(data?.document_type==='project_configuration_specification'){
  if(data.config_version!==1||data.canvases?.length!==2||!data.canvases.some(x=>x.id==='tiktok_vertical')||!data.canvases.some(x=>x.id==='twitch_landscape'))throw Error('Das Projekt muss genau TikTok 9:16 und Twitch 16:9 enthalten.');
  const c=defaults();c.profile=data.active_profile;return validate(c);
 }return validate(data);
}
function profile(config){const p=copy(spec.profiles[config.profile]);return {fps:p.fps,tiktok:p.outputs.tiktok_vertical,twitch:p.outputs.twitch_landscape,uploadMbps:(p.outputs.tiktok_vertical.video_bitrate_kbps+p.outputs.twitch_landscape.video_bitrate_kbps+256)/1000};}
module.exports={defaults,validate,importProject,profile,platforms,cameraIds,visualIds,server,sceneChoices,resolveScene};
