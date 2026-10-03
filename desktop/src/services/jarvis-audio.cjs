'use strict';
const {normalize}=require('./jarvis-commands.cjs');

// Shares the Touch Deck audio service. Listing or changing audio starts no
// persistent poller, and Jarvis's own volume needs no Windows helper at all.
async function controlAudio(audio,intent){
 const query=normalize(intent.targetQuery);let id,name;
 if(['jarvis','javis','deine stimme'].includes(query)){id='jarvis';name='Jarvis';}
 else if(['windows','windows lautstarke','pc','computer','system','master','sound'].includes(query)){id='master';name='Windows';}
 else {
  const targets=await audio.targets();
  const matches=targets.filter(t=>t.available&&normalize(t.name)===query);
  if(matches.length!==1)return {ok:false,text:matches.length?'Mehrere Tonquellen heißen so. Wähle die gewünschte Quelle im Touch Deck.':'Diese Tonquelle ist gerade nicht verfügbar. Öffne das Programm und nenne seinen Namen aus den Audioreglern.'};
  ({id,name}=matches[0]);
 }
 let patch=intent.patch;
 if(intent.delta!==undefined){
  if(!Number.isFinite(intent.delta)||Math.abs(intent.delta)>100)throw Error('Ungültige Lautstärkeänderung.');
  const value=(await audio.state([id]))[id];
  if(!value?.available)throw Error('Diese Tonquelle ist gerade nicht verfügbar.');
  patch={volume:Math.min(100,Math.max(0,value.volume+intent.delta))};
 }
 const value=await audio.set(id,patch);
 if(!value?.available)throw Error('Die Tonquelle hat die Änderung nicht bestätigt.');
 const expected=patch.volume;
 if(expected!==undefined&&Math.abs(value.volume-expected)>1||patch.muted!==undefined&&value.muted!==patch.muted)throw Error('Die Tonquelle hat die gewünschte Einstellung nicht übernommen.');
 return {ok:true,text:patch.muted!==undefined?`${name}: ${value.muted?'stummgeschaltet':'wieder hörbar'}.`:`${name}: ${Math.round(value.volume)} Prozent${value.muted?', weiterhin stummgeschaltet':''}.`};
}
module.exports={controlAudio};
