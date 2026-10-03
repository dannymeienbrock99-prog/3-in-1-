'use strict';

// These IDs are the public contract used by existing Elgato keys.
const CONTROLS = [
  ['overlay.snow', 'Schnee an/aus'], ['overlay.likeBar', 'Like-Balken an/aus'],
  ['battleBar.enabled', 'TikTok Match Battle-Bar an/aus'],
  ['chatWindow.detached', 'Chatfenster koppeln/entkoppeln'],
  ['broadcast.master', 'Auto-Broadcast an/aus'], ['tts.enabled', 'TTS an/aus'],
  ['chatArchive.enabled', 'Chatarchiv an/aus'], ['viewerCount.enabled', 'Zuschauerzahl an/aus'],
  ['chatFilter.enabled', 'Chat-Filter an/aus']
];
function createDeckControls({getConfig,saveConfig,isDetached,setDetached}) {
  function snapshot() {
    const c=getConfig(), w=c.appearance?.chatWidgets||{};
    const states={
      'overlay.snow':w.enabled!==false&&w.snowEnabled!==false,
      'overlay.likeBar':w.enabled!==false&&w.likesEnabled!==false,
      'battleBar.enabled':c.battleBar ? c.battleBar.enabled===true : (c.chatExtras?.widgets||[]).some(w=>w.id==='batto-battlebar'&&w.enabled===true),
      'chatWindow.detached':!!isDetached(),
      'broadcast.master':c.autoBroadcast?.enabled===true,'tts.enabled':c.tts?.enabled===true,
      'chatArchive.enabled':c.community?.archive?.enabled===true,
      'viewerCount.enabled':c.community?.viewers?.enabled!==false,'chatFilter.enabled':c.filters?.enabled!==false
    };
    const broadcastProfiles=(c.autoBroadcast?.items||[]).map((p,i)=>({id:p.id,name:p.name||'Broadcast '+(i+1),enabled:p.enabled===true,slot:i+1}));
    for(const p of broadcastProfiles){states['broadcast.profile:'+p.id]=p.enabled;states['broadcast.slot:'+p.slot]=p.enabled;}
    return {states,broadcastProfiles,controls:CONTROLS.map(([id,name])=>({id,name}))};
  }
  async function control({target,op='toggle',args={}}={}) {
    if(!CONTROLS.some(([id])=>id===target)&&target!=='broadcast.profile')throw new Error('Diese Funktion ist in Batto nicht verfügbar: '+String(target));
    if(!['toggle','on','off'].includes(op))throw new Error('Schaltvorgang muss toggle, on oder off sein.');
    const c=getConfig(), before=snapshot();let key=target,profile;
    if(target==='broadcast.profile'){
      profile=args.profileId?before.broadcastProfiles.find(p=>p.id===args.profileId):before.broadcastProfiles.find(p=>p.slot===Number(args.slot));
      if(!profile)throw new Error('Broadcast fehlt. Im Plugin ein vorhandenes Profil auswählen.');
      key='broadcast.profile:'+profile.id;
    }
    if(!Object.prototype.hasOwnProperty.call(before.states,key))throw new Error('Diese Funktion ist in Batto nicht verfügbar: '+String(target));
    const enabled=op==='toggle'?!before.states[key]:op==='on';let patch;
    if(target==='chatWindow.detached')await setDetached(enabled);
    else {
      if(target==='battleBar.enabled'){
        if(c.battleBar)patch={battleBar:{enabled}};
        else {
        const widgets=c.chatExtras?.widgets||[],widget=widgets.find(w=>w.id==='batto-battlebar');
        if(!widget)throw new Error('Die Battle-Bar-Adresse fehlt. In Batto unter TikFinity-Widgets → Battle-Bar speichern.');
        if(enabled){const valid=require('../renderer/tikfinity-url.js').isValid(widget.url);
          if(!valid)throw new Error('Bitte zuerst eine gültige TikFinity-Battle-Bar-Widget-Adresse in Batto speichern.');}
        patch={chatExtras:{widgets:widgets.map(w=>w.id===widget.id?{...w,enabled,permanent:true}:w)}};
        }
      } else if(target==='overlay.snow'||target==='overlay.likeBar'){
        const w=c.appearance?.chatWidgets||{},field=target==='overlay.snow'?'snowEnabled':'likesEnabled';
        patch={appearance:{chatWidgets:{...(field==='snowEnabled'?{snowAutoStart:enabled}:{}),enabled:true,snowEnabled:w.enabled!==false&&w.snowEnabled!==false,likesEnabled:w.enabled!==false&&w.likesEnabled!==false,[field]:enabled}}};
      } else if(target==='broadcast.profile')patch={autoBroadcast:{items:(c.autoBroadcast.items||[]).map(p=>p.id===profile.id?{...p,enabled}:p)}};
      else if(target==='broadcast.master')patch={autoBroadcast:{enabled}};
      else if(target==='tts.enabled')patch={tts:{enabled}};
      else if(target==='chatArchive.enabled')patch={community:{archive:{enabled}}};
      else if(target==='viewerCount.enabled')patch={community:{viewers:{enabled}}};
      else if(target==='chatFilter.enabled')patch={filters:{enabled}};
      await saveConfig(patch);
    }
    const after=snapshot();
    if(after.states[key]!==enabled)throw new Error('Batto hat die Änderung nicht bestätigt.');
    return {ok:true,state:enabled,...after};
  }
  return {snapshot,control};
}
module.exports={createDeckControls,CONTROLS};
