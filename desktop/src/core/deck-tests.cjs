'use strict';
function createDeckTests({getConfig,chains,engine,broadcast,widgetTest,battleTest}){
 return {
  catalog:()=>[...(getConfig().keyActions||[]).map(x=>({id:x.id,name:'Hotkey: '+(x.name||x.id),kind:'hotkey',enabled:x.enabled!==false})),...['actionChains','events'].flatMap((key,i)=>(getConfig()[key]||[]).map(x=>({id:x.id,name:x.name||x.event||x.id,kind:i?'event':'chain',enabled:x.enabled!==false}))),...(broadcast?(getConfig().autoBroadcast?.items||[]).map(x=>({id:x.id,name:'Auto-Broadcast: '+(x.name||x.id),kind:'broadcast',enabled:true})):[]),...(widgetTest?(getConfig().chatExtras?.widgets||[]).map(x=>({id:x.id,name:'Widget-Vorschau: '+(x.name||x.id),kind:'widget',enabled:true})):[]),...(battleTest&&getConfig().battleBar?[{id:'batto-battlebar',name:'Match Battle-Bar: Anzeige prüfen',kind:'widget',enabled:true}]:[])],
  test:async(kind,id)=>{
   if(kind==='hotkey'){
    if(!engine)throw new Error('Hotkey-Ausgabe ist nicht verfügbar.');
    return engine.executeRule({id:'deck-key-action:'+String(id),cooldownSeconds:0,onlyWhenLive:false,actions:[{type:'key-action',keyActionId:id}]},{source:'stream-deck-test',platform:'internal',user:'Batto Test'},'hotkey-test');
   }
   if(kind==='widget'){
    if(id==='batto-battlebar'&&battleTest&&getConfig().battleBar)return battleTest();
    if(!widgetTest||typeof id!=='string'||!(getConfig().chatExtras?.widgets||[]).some(w=>w.id===id))throw new Error('Widget fehlt. Liste im Plugin aktualisieren.');
    return widgetTest({id,kind:'widget',preview:true,durationMs:8000});
   }
   if(kind==='broadcast'){
    const item=(getConfig().autoBroadcast?.items||[]).find(x=>typeof id==='string'&&x.id===id);
    if(!item||!broadcast)throw new Error('Broadcast fehlt. Liste im Plugin aktualisieren.');
    const result=await broadcast.test(item);
    if(result?.ok===false&&!result.error)return {...result,error:(result.results||[]).filter(x=>x.ok===false).map(x=>`${x.target}: ${x.error||x.message||'Versand fehlgeschlagen'}`).join(' · ')||result.actionResult?.error||result.soundResult?.error||'Broadcast nicht vollständig ausgeführt.'};
    return result;
   }
   if(!['chain','event'].includes(kind)||typeof id!=='string')throw new Error('Aktion oder Event auswählen.');
   const item=(getConfig()[kind==='chain'?'actionChains':'events']||[]).find(x=>x.id===id);
   if(!item)throw new Error('Eintrag fehlt. Liste im Plugin aktualisieren.');
   if(item.enabled===false)throw new Error('Eintrag ist deaktiviert. In Batto aktivieren.');
   const ctx={source:'stream-deck-test',platform:kind==='event'&&item.platform!=='all'?item.platform:'internal',user:'Batto Test',username:'Batto Test',nickname:'Batto Test',message:'Test',text:'Test',count:1,value:1,event:item.event,data:{username:'Batto Test',count:1,value:1}};
   if(kind==='chain')return chains.trigger(id,ctx);
   // Explicitly test this rule's actions only; never emit a fake platform event
   // that could unexpectedly activate other rules or alter live cooldowns.
   return engine.executeRule({...item,id:'deck-test:'+id,cooldownSeconds:0,onlyWhenLive:false},ctx,'event-test');
  }
 };
}
module.exports={createDeckTests};
