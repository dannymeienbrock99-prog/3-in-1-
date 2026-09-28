'use strict';
// A threshold crossing is latched. Missing/stale data and elapsed time never re-arm it.
class FanAlertEngine {
 constructor(saved={}) { this.states=new Map(Object.entries(saved)); }
 snapshot(){return Object.fromEntries(this.states);}
 evaluate(fans,settings,now=Date.now()) {
  if(!settings.enabled)return [];
  const events=[];
  for(const fan of fans){
   const p=fan.percent,age=now-Date.parse(p?.updatedUtc);
   if(fan.announce===false||p?.fresh!==true||!Number.isFinite(p.value)||p.value<0||p.value>100||!Number.isFinite(age)||age< -5000||age>=15000)continue;
   const signature=JSON.stringify([settings.threshold,settings.hysteresis,p.basis,fan.reference]);
   let state=this.states.get(fan.id);
   if(!state||state.signature!==signature)state={signature,armed:true,last:null};
   if(p.value<=settings.threshold-settings.hysteresis)state.armed=true;
   if(state.armed&&p.value>=settings.threshold&&(state.last===null||now-state.last>=settings.cooldown*1000)){
    events.push(fan);state.armed=false;state.last=now;
   }
   this.states.set(fan.id,state);
  }
  // Removed fans cannot grow persistent state without bound.
  const ids=new Set(fans.map(f=>f.id));
  if(fans.length)for(const id of this.states.keys())if(!ids.has(id))this.states.delete(id);
  return events;
 }
}
module.exports={FanAlertEngine};
