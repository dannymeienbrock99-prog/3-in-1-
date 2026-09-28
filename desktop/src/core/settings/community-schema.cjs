'use strict';
const issue=(path,message)=>({path,message});
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function safeHttps(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&String(value).length<=4096;}catch{return false;}}
function validateAdditions(c){
 const errors=[],community=c.community||{},archive=community.archive||{},viewers=community.viewers||{};
 for(const name of ['enabled','moderationEnabled','excerptsEnabled'])if(typeof archive[name]!=='boolean')errors.push(issue('community.archive.'+name,'Ein-/Aus-Auswahl erforderlich.'));
 if(typeof archive.directory!=='string'||archive.directory.length>4096)errors.push(issue('community.archive.directory','Speicherort ist ungültig.'));
 if(!Number.isInteger(archive.retentionDays)||archive.retentionDays<0||archive.retentionDays>3650)errors.push(issue('community.archive.retentionDays','Aufbewahrung: 0 (unbegrenzt) bis 3650 Tage.'));
 for(const name of ['enabled','tiktok','twitch'])if(typeof viewers[name]!=='boolean')errors.push(issue('community.viewers.'+name,'Ein-/Aus-Auswahl erforderlich.'));
 for(const [platform,keys] of [['twitch',['clientId','broadcasterId','channel']],['youtube',['channelId','liveChatId']]])for(const k of keys){const v=community.moderation?.[platform]?.[k];if(typeof v!=='string'||v.length>256)errors.push(issue('community.moderation.'+platform+'.'+k,'Kennung ist ungültig.'));}
 if(community.moderation?.twitch?.channel&&!/^[a-zA-Z0-9_]{1,25}$/.test(community.moderation.twitch.channel))errors.push(issue('community.moderation.twitch.channel','Twitch-Anmeldename ohne @ oder URL erforderlich.'));
 const extras=c.chatExtras||{},widgets=extras.widgets||[];
 if(!Array.isArray(widgets)||widgets.length>50)errors.push(issue('chatExtras.widgets','Maximal 50 Widgets erlaubt.'));
 else {const ids=new Set();for(const [i,w] of widgets.entries()){
  const p='chatExtras.widgets.'+i;
  if(!w||typeof w!=='object'||Array.isArray(w)){errors.push(issue(p,'Widget muss ein Objekt sein.'));continue;}
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(w.id||'')||ids.has(w.id))errors.push(issue(p+'.id','Eindeutige Widget-ID erforderlich.'));ids.add(w.id);
  if(!String(w.name||'').trim()||String(w.name).length>100)errors.push(issue(p+'.name','Name mit maximal 100 Zeichen erforderlich.'));
  if(!safeHttps(w.url))errors.push(issue(p+'.url','Gültige HTTPS-Widget-Adresse ohne Zugangsdaten erforderlich.'));
  if(typeof w.enabled!=='boolean')errors.push(issue(p+'.enabled','Widget-Status ist ungültig.'));
  if(!['tiktok','twitch','youtube','cng','internal','all'].includes(w.platform||'tiktok'))errors.push(issue(p+'.platform','Plattform ist ungültig.'));
  if(!['follow','gift','join','like','share','subscribe','manual','custom','chat'].includes(w.event||'manual'))errors.push(issue(p+'.event','Widget-Auslöser ist ungültig.'));
 }}
 const list=extras.wishlist;
 if(list)for(const [key,max] of [['title',100],['caption',300]])if(list[key]!==undefined&&(typeof list[key]!=='string'||list[key].length>max))errors.push(issue('chatExtras.wishlist.'+key,'Text ist zu lang oder ungültig.'));
 if(!list||!Array.isArray(list.items)||list.items.length>797)errors.push(issue('chatExtras.wishlist.items','Maximal 797 ausgewählte Geschenke.'));
 if(list&&typeof list.folderPath!=='string')errors.push(issue('chatExtras.wishlist.folderPath','Geschenkeordner ist ungültig.'));
 if(Array.isArray(list?.items)){
  const keys=new Set();
  for(const [i,item] of list.items.entries()){
   const p='chatExtras.wishlist.items.'+i;
   if(!item||typeof item!=='object'||Array.isArray(item)){errors.push(issue(p,'Geschenk muss ein Objekt sein.'));continue;}
   if(typeof item.key!=='string'||!item.key.trim()||item.key.length>512||item.key.includes('\0')||keys.has(item.key))errors.push(issue(p+'.key','Eindeutiger Dateischlüssel erforderlich.'));
   keys.add(item.key);
   if(typeof item.name!=='string'||!item.name.trim()||item.name.length>200)errors.push(issue(p+'.name','Name mit maximal 200 Zeichen erforderlich.'));
   if(typeof item.enabled!=='boolean')errors.push(issue(p+'.enabled','Geschenk-Status ist ungültig.'));
   if(!['image','widget'].includes(item.sourceType))errors.push(issue(p+'.sourceType','Quelle muss Bild/Animation oder Browser-Widget sein.'));
   if(typeof item.url!=='string'||(item.url&&!safeHttps(item.url)))errors.push(issue(p+'.url','Zusatzquelle muss eine gültige HTTPS-Adresse sein.'));
   if(String(item.key||'').startsWith('url:')&&!item.url)errors.push(issue(p+'.url','Für eine eigene Anzeige fehlt die HTTPS-Adresse.'));
   if(typeof item.giftIdVerified!=='boolean')errors.push(issue(p+'.giftIdVerified','Die ID-Bestätigung muss ein Ein-/Aus-Wert sein.'));
   if(item.giftId!==undefined&&item.giftId!==null&&((typeof item.giftId!=='string'&&typeof item.giftId!=='number')||String(item.giftId).length>100))errors.push(issue(p+'.giftId','Geschenk-ID ist ungültig.'));
   if(item.giftIdVerified&&!String(item.giftId??'').trim())errors.push(issue(p+'.giftId','Eine bestätigte Zuordnung benötigt eine echte Geschenk-ID.'));
  }
 }
 const targets=[...(Array.isArray(widgets)?widgets:[]),...(list?[list]:[])];
 for(const [i,t] of targets.entries()){
  if(!t||typeof t!=='object'||Array.isArray(t))continue;
  if(t.anchor!==undefined&&!['top-left','top-right','center','bottom-left','bottom-right'].includes(t.anchor))errors.push(issue('chatExtras.layout.'+i+'.anchor','Ankerposition ist ungültig.'));
  if(t.queueMode!==undefined&&!['queue','replace','discard'].includes(t.queueMode))errors.push(issue('chatExtras.layout.'+i+'.queueMode','Warteschlange ist ungültig.'));
  if(t.maxQueue!==undefined&&(!Number.isInteger(t.maxQueue)||t.maxQueue<1||t.maxQueue>100))errors.push(issue('chatExtras.layout.'+i+'.maxQueue','Warteschlange: 1 bis 100.'));
  for(const [key,min,max] of [['width',40,1920],['height',30,1080],['scale',.1,3],['x',-1920,1920],['y',-1080,1080],['durationMs',250,120000],['fadeInMs',0,10000],['fadeOutMs',0,10000]])if(t[key]!==undefined&&!finite(t[key],min,max))errors.push(issue('chatExtras.layout.'+i+'.'+key,'Größe, Position oder Dauer außerhalb des erlaubten Bereichs.'));
 }
 for(const [i,key] of (c.hotkeys||[]).entries()){
  if(key.scope!==undefined&&!['global','app'].includes(key.scope))errors.push(issue('hotkeys.'+i+'.scope','Geltungsbereich ist ungültig.'));
  if(key.passthrough!==undefined&&typeof key.passthrough!=='boolean')errors.push(issue('hotkeys.'+i+'.passthrough','Weitergabe ist ungültig.'));
  if(key.triggerMode!==undefined&&!['down','up','repeat'].includes(key.triggerMode))errors.push(issue('hotkeys.'+i+'.triggerMode','Auslösemodus ist ungültig.'));
  if(key.debounceMs!==undefined&&!finite(key.debounceMs,50,5000))errors.push(issue('hotkeys.'+i+'.debounceMs','Mindestabstand: 50 bis 5000 ms.'));
 }
 if(c.streamerbot?.tiktokActionId!==undefined&&(typeof c.streamerbot.tiktokActionId!=='string'||c.streamerbot.tiktokActionId.length>100))errors.push(issue('streamerbot.tiktokActionId','Aktions-ID ist ungültig.'));
 return errors;
}
module.exports={validateAdditions,safeHttps};
