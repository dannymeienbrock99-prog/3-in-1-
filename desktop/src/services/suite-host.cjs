'use strict';
function chatForJarvis(message){return {...message,role:message.isBroadcaster===true?'broadcaster':message.moderator===true?'moderator':''};}
function obsForJarvis(getObs){return {get connected(){return getObs()?.connected===true;},request:(name,data)=>{const obs=getObs();if(!obs?.connected)throw Error('OBS ist nicht verbunden.');return obs.call(name,data);}};}
module.exports={chatForJarvis,obsForJarvis};
