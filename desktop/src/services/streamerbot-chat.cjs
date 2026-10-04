'use strict';
const {normalizeMessage,identityPatch}=require('../core/chat-core.cjs');

function ingestStreamerBotChat(eventCore,chatCore,message,source='streamerbot-chat'){
 const result=eventCore.ingestChat(message,source);
 if(!result.duplicate||result.event?.user?.identityVerified!==true)return result;
 // The first transport may still be waiting in the event bus. Add verified
 // identity to that original event; never publish a second command/event.
 const pending=eventCore.bus.queue.find(event=>event.type==='chat'&&event.eventId===result.event.eventId&&event.platform===result.event.platform);
 if(pending){
  const patch=identityPatch(normalizeMessage(pending),normalizeMessage(result.event));
  if(patch){pending.channelId=patch.channelId;pending.user={...pending.user,id:patch.userId,username:patch.username,displayName:patch.displayName,identityVerified:true,isModerator:patch.moderator,isBroadcaster:patch.isBroadcaster,badges:patch.badges,moderatorConfirmedAt:patch.moderatorConfirmedAt,roleConfirmedAt:patch.roleConfirmedAt};}
 }else chatCore.enrichIdentity(result.event);
 return result;
}
module.exports={ingestStreamerBotChat};
