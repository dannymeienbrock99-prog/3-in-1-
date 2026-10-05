(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BattoChatAppearance=factory();})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const roles=['normal','moderator','self','bot','autoBroadcast','system','mention'],platforms=['tiktok','twitch','youtube','cng'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 const hex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
 const families=['Segoe UI','Arial','Verdana','Tahoma','Trebuchet MS','Georgia','Consolas','Courier New'];
 const validFont=value=>typeof value==='string'&&/^[\p{L}\p{N} ._-]{1,80}$/u.test(value)&&Boolean(value.trim());
 const typography={sizeMode:'joint',fontSize:14,usernameSize:14,messageSize:14,timestampSize:11,fontFamily:'Segoe UI',fontWeight:400,usernameWeight:700,lineHeight:1.45,messageGap:8};
 const colors={normal:{username:'#00d4ff',message:'#f0eae0'},moderator:{username:'#88ce98',message:'#e7f7eb'},self:{username:'#ffd166',message:'#fff0cb'},bot:{username:'#90bfff',message:'#d9e9ff'},autoBroadcast:{username:'#ffd166',message:'#ffd166'},system:{username:'#b5ad9b',message:'#c9c1b1'},mention:{username:'#f27aff',message:'#ffe0ff'}};
 const common={roles:colors,background:'#11110f',opacity:.6,timestampColor:'#bca988',timestamps:true,platformIcons:true,separators:true,separatorColor:'#493c28',highlights:true,highlightColor:'#d9aa57',highlightOpacity:.12,mentionTerms:[]};
 function profile(){return {colorMode:'common',common:clone(common),platforms:Object.fromEntries(platforms.map(p=>[p,clone(common)])),typography:clone(typography)};}
 const defaults={configured:false,...profile(),favorites:[],detached:{configured:false,inherit:true,...profile()}};
 function fromLegacy(config={}){
  const value=clone(defaults),old=config.chatColors||{},main=config.multiChat||{};
  for(const c of [value.common,...Object.values(value.platforms),value.detached.common,...Object.values(value.detached.platforms)]){
   if(hex(old.username))c.roles.normal.username=old.username;if(hex(old.message))c.roles.normal.message=old.message;
   if(hex(old.broadcastUsername))c.roles.autoBroadcast.username=old.broadcastUsername;if(hex(old.broadcastMessage))c.roles.autoBroadcast.message=old.broadcastMessage;
   c.timestamps=main.showTimestamp!==false;c.platformIcons=main.showPlatform!==false;
  }
  for(const t of [value.typography,value.detached.typography]){
   if(Number.isInteger(Number(main.fontSize))&&Number(main.fontSize)>=8&&Number(main.fontSize)<=72)t.fontSize=t.usernameSize=t.messageSize=Number(main.fontSize);
   if(validFont(main.fontFamily))t.fontFamily=main.fontFamily;
  }
  return value;
 }
 function merge(base,value){const out=clone(base);if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const key of Object.keys(base)){if(value[key]===undefined)continue;out[key]=base[key]&&typeof base[key]==='object'&&!Array.isArray(base[key])?merge(base[key],value[key]):clone(value[key]);}return out;}
 function resolve(config={},options={}){
  const value=merge(fromLegacy(config),config.chatAppearance),active=options.detached&&value.detached.inherit===false?value.detached:value;
  return {...active,configured:active.configured,legacy:config.chatColors||{},legacyDesign:config.chatDesign||{},overlay:options.overlay===true};
 }
 const sourceFor=m=>String(m?.raw?.meta?.sourceConnector||m?.meta?.sourceConnector||m?.raw?.source||'');
 const broadcast=m=>/^(?:(?:local|cng-local)-)?(?:auto-broadcast|broadcast-manual-test|broadcast(?:-run)?:[a-zA-Z0-9_-]{1,100})$/.test(sourceFor(m));
 function roleFor(message={},scheme=common){
  const raw=message.raw?.meta?.rawData||message.raw||{};
  if(broadcast(message))return 'autoBroadcast';
  if(message.system===true||raw.system===true||message.type==='system'||message.platform==='system')return 'system';
  if(['self','owner'].includes(message.narrationRole)||message.isBroadcaster===true)return 'self';
  if(message.moderator===true||message.narrationRole==='moderator')return 'moderator';
  if(message.bot===true||message.isBot===true||raw.bot===true||raw.isBot===true||message.raw?.user?.isBot===true||raw.user?.isBot===true)return 'bot';
  const text=String(message.message||'');
  if(message.mentionsSelf===true||raw.mentionsSelf===true||(scheme.mentionTerms||[]).some(term=>typeof term==='string'&&term.trim()&&text.toLocaleLowerCase().includes(term.trim().toLocaleLowerCase())))return 'mention';
  return 'normal';
 }
 function rgba(color,opacity){if(!hex(color))return '';const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));return `rgba(${rgb.join(',')},${Number(opacity)})`;}
 function forMessage(appearance,message={}){
  const scheme=appearance.colorMode==='platform'&&appearance.platforms[message.platform]||appearance.common,role=roleFor(message,scheme),t=appearance.typography,joint=t.sizeMode==='joint';
  const size={username:joint?t.fontSize:t.usernameSize,message:joint?t.fontSize:t.messageSize,timestamp:joint?Math.max(8,t.fontSize-3):t.timestampSize};
  if(!appearance.configured){const c=appearance.legacy||{},auto=role==='autoBroadcast';return {role,scheme,size,username:c.enabled?c[auto?'broadcastUsername':'username']:'',message:c.enabled?c[auto?'broadcastMessage':'message']:'',legacy:true};}
  return {role,scheme,size,username:scheme.roles[role].username,message:scheme.roles[role].message,legacy:false};
 }
 function apply(container,config,options={}){
  if(!container)return;const a=resolve(config,options),t=a.typography;
  container.classList.toggle('chat-styled',a.configured);
  if(!a.configured){container.style.fontFamily='';container.style.removeProperty('--chat-message-gap');if(!options.overlay)container.style.background='';return;}
  container.style.fontFamily=`"${t.fontFamily}", sans-serif`;container.style.setProperty('--chat-message-gap',t.messageGap+'px');
  if(!options.overlay)container.style.background=rgba(a.common.background,a.common.opacity);
  for(const row of container.querySelectorAll('[data-chat-role]')){
   const scheme=a.colorMode==='platform'&&a.platforms[row.dataset.chatPlatform]||a.common,role=row.dataset.chatRole,highlight=scheme.highlights&&role!=='normal';
   row.style.borderBottom=scheme.separators?`1px solid ${scheme.separatorColor}`:'0';
   const base=options.overlay||a.colorMode==='platform'?rgba(scheme.background,scheme.opacity):'transparent';
   row.style.background=highlight?`linear-gradient(${rgba(scheme.highlightColor,scheme.highlightOpacity)},${rgba(scheme.highlightColor,scheme.highlightOpacity)}),${base}`:base;
   row.style.lineHeight=String(t.lineHeight);row.style.paddingBottom=t.messageGap+'px';
   if(options.overlay)row.style.marginBottom=t.messageGap+'px';
   const user=row.querySelector('.chat-user,.user'),text=row.querySelector('.chat-text,.text'),timestamp=row.querySelector('.chat-time');
   const visual=forMessage(a,{platform:row.dataset.chatPlatform,narrationRole:role==='self'?'self':'',moderator:role==='moderator',bot:role==='bot',system:role==='system',mentionsSelf:role==='mention',meta:{sourceConnector:role==='autoBroadcast'?'auto-broadcast':''}});
   if(user){user.style.color=scheme.roles[role].username;user.style.fontSize=visual.size.username+'px';user.style.fontWeight=t.usernameWeight;}
   if(text){text.style.color=scheme.roles[role].message;text.style.fontSize=visual.size.message+'px';text.style.fontWeight=t.fontWeight;}
   if(timestamp){timestamp.hidden=!scheme.timestamps;timestamp.style.color=scheme.timestampColor;timestamp.style.fontSize=visual.size.timestamp+'px';}
   const icon=row.querySelector('.platform-icon,.platform');if(icon)icon.hidden=!scheme.platformIcons;
  }
 }
 function validate(value){
  const errors=[],issue=(path,message)=>errors.push({path:'chatAppearance.'+path,message}),obj=v=>v&&typeof v==='object'&&!Array.isArray(v),number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  if(!obj(value))return [{path:'chatAppearance',message:'Chatdarstellung muss ein Objekt sein.'}];
  if(typeof value.configured!=='boolean')issue('configured','Chatdarstellung muss an oder aus sein.');
  function scheme(c,path){if(!obj(c)){issue(path,'Farbschema fehlt.');return;}for(const role of roles)for(const kind of ['username','message'])if(!hex(c.roles?.[role]?.[kind]))issue(path+'.roles.'+role+'.'+kind,'Eine sechsstellige HEX-Farbe eingeben.');for(const field of ['background','timestampColor','separatorColor','highlightColor'])if(!hex(c[field]))issue(path+'.'+field,'Eine sechsstellige HEX-Farbe eingeben.');for(const field of ['timestamps','platformIcons','separators','highlights'])if(typeof c[field]!=='boolean')issue(path+'.'+field,'Auswahl muss an oder aus sein.');for(const field of ['opacity','highlightOpacity'])if(!number(c[field],0,1))issue(path+'.'+field,'Deckkraft muss zwischen 0 und 100 Prozent liegen.');if(!Array.isArray(c.mentionTerms)||c.mentionTerms.length>20||c.mentionTerms.some(x=>typeof x!=='string'||!x.trim()||x.length>80))issue(path+'.mentionTerms','Bis zu 20 kurze Begriffe zur Hervorhebung eingeben.');}
  function typographyCheck(t,path){if(!obj(t)){issue(path,'Schrifteinstellungen fehlen.');return;}if(!['joint','separate'].includes(t.sizeMode))issue(path+'.sizeMode','Gemeinsame oder getrennte Schriftgrößen wählen.');if(!validFont(t.fontFamily))issue(path+'.fontFamily','Einen gültigen Namen einer installierten Schriftart eingeben.');for(const field of ['fontSize','usernameSize','messageSize','timestampSize'])if(!Number.isInteger(t[field])||!number(t[field],8,72))issue(path+'.'+field,'Schriftgröße muss zwischen 8 und 72 Pixel liegen.');for(const field of ['fontWeight','usernameWeight'])if(![400,500,600,700,800,900].includes(t[field]))issue(path+'.'+field,'Eine angebotene Schriftstärke wählen.');if(!number(t.lineHeight,1,3))issue(path+'.lineHeight','Zeilenabstand muss zwischen 1 und 3 liegen.');if(!Number.isInteger(t.messageGap)||!number(t.messageGap,0,40))issue(path+'.messageGap','Nachrichtenabstand muss zwischen 0 und 40 Pixel liegen.');}
  function check(p,path){if(!obj(p)){issue(path,'Darstellungsprofil fehlt.');return;}if(!['common','platform'].includes(p.colorMode))issue(path+'colorMode','Gemeinsame Farben oder Plattformfarben wählen.');scheme(p.common,path+'common');for(const platform of platforms)scheme(p.platforms?.[platform],path+'platforms.'+platform);typographyCheck(p.typography,path+'typography');}
  check(value,'');check(value.detached,'detached.');if(typeof value.detached?.configured!=='boolean')issue('detached.configured','Eigenes Darstellungsprofil muss an oder aus sein.');if(typeof value.detached?.inherit!=='boolean')issue('detached.inherit','Übernahme der Hauptchat-Einstellungen muss an oder aus sein.');if(!Array.isArray(value.favorites)||value.favorites.length>32||value.favorites.some(c=>!hex(c)))issue('favorites','Bis zu 32 gültige Lieblingsfarben speichern.');return errors;
 }
 return {defaults,fromLegacy,resolve,forMessage,roleFor,apply,validate,roles,platforms,families,validFont,hex,rgba,merge,clone};
});
