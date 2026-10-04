'use strict';
function chatForJarvis(message){
 // Narration hints belong only to Jarvis. They do not change the platform
 // roles or identity used by chat commands and moderation.
 const narration=['owner','self','moderator'].includes(message.narrationRole)?message.narrationRole:'';
 return {...message,role:message.isBroadcaster===true?'broadcaster':message.moderator===true?'moderator':narration==='self'?'owner':narration};
}
function obsForJarvis(getObs){return {get connected(){return getObs()?.connected===true;},request:(name,data)=>{const obs=getObs();if(!obs?.connected)throw Error('OBS ist nicht verbunden.');return obs.call(name,data);}};}
module.exports={chatForJarvis,obsForJarvis};
