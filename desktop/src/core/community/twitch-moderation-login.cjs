'use strict';
const {jsonRequest,PlatformError}=require('./moderation-service.cjs');
const SCOPES='channel:manage:moderators moderator:manage:banned_users moderation:read user:read:moderated_channels';
class TwitchModerationLogin {
  constructor({secrets,fetchImpl=fetch,onChange=()=>{},onConnected=async()=>{}}){Object.assign(this,{secrets,fetchImpl,onChange,onConnected});this.state={status:'idle'};this.generation=0;this.timer=null;this.refreshing=null;}
  snapshot(){return {...this.state};}
  emit(){this.onChange(this.snapshot());}
  cancel(){this.generation++;clearTimeout(this.timer);this.timer=null;this.state={status:'idle'};this.emit();}
  session(){try{return JSON.parse(this.secrets.get('community-twitch-session')||'null');}catch{return null;}}
  async request(endpoint,body){let response;try{response=await this.fetchImpl('https://id.twitch.tv/oauth2/'+endpoint,{method:'POST',body:new URLSearchParams(body),redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new Error('Twitch-Anmeldung derzeit nicht erreichbar.');}return {ok:response.ok,data:await response.json()};}
  async start(clientId){
    this.cancel();if(!/^[a-z0-9]{10,100}$/i.test(clientId||''))throw new Error('Öffentliche Twitch-App-Kennung fehlt.');
    const generation=this.generation,initial=await this.request('device',{client_id:clientId,scopes:SCOPES});
    if(!initial.ok||!initial.data.device_code)throw new Error('Twitch hat die Geräteanmeldung abgelehnt. Eine öffentliche Twitch-App-Kennung verwenden.');
    const data=initial.data,url=new URL(data.verification_uri);if(url.protocol!=='https:'||url.hostname!=='www.twitch.tv'||url.pathname!=='/activate')throw new Error('Unerwartete Twitch-Anmeldeadresse.');
    if(generation!==this.generation)return this.snapshot();
    this.state={status:'pending',code:String(data.user_code),url:url.href};this.emit();let interval=Math.max(5,Number(data.interval)||5)*1000;const expires=Date.now()+Math.min(1800,Number(data.expires_in)||600)*1000;
    const poll=async()=>{
      if(generation!==this.generation)return;
      try{
        if(Date.now()>expires)throw new Error('Twitch-Anmeldung abgelaufen.');
        const response=await this.request('token',{client_id:clientId,device_code:data.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code',scopes:SCOPES});
        if(generation!==this.generation)return;
        if(response.ok){const identity=await jsonRequest(this.fetchImpl,'https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+response.data.access_token}},response.data.access_token);if(identity.client_id!==clientId)throw new Error('Twitch-App-Kennung stimmt nicht überein.');if(generation!==this.generation)return;this.save(clientId,response.data);this.state={status:'connected',username:identity.login};this.emit();await this.onConnected();return;}
        const reason=response.data.message||response.data.error;if(reason==='slow_down')interval+=5000;else if(reason!=='authorization_pending')throw new Error('Twitch-Anmeldung wurde nicht bestätigt.');
        this.timer=setTimeout(poll,interval);this.timer.unref?.();
      }catch(error){if(generation===this.generation){this.state={status:'error',error:error.message};this.emit();}}
    };
    this.timer=setTimeout(poll,interval);this.timer.unref?.();return this.snapshot();
  }
  save(clientId,data){if(!data.access_token||!data.refresh_token)throw new Error('Twitch hat keine vollständige Anmeldung geliefert.');this.secrets.set('community-twitch-session',JSON.stringify({clientId,accessToken:data.access_token,refreshToken:data.refresh_token,expires:Date.now()+(Number(data.expires_in)||0)*1000}));}
  async token(){const session=this.session();if(!session)return this.secrets.get('community-twitch-token');if(session.expires>Date.now()+60000)return session.accessToken;if(this.refreshing)return this.refreshing;const generation=this.generation;this.refreshing=(async()=>{const response=await this.request('token',{client_id:session.clientId,grant_type:'refresh_token',refresh_token:session.refreshToken});if(!response.ok)throw new PlatformError('Twitch-Moderationsanmeldung abgelaufen. Erneut verbinden.','AUTH_REQUIRED');if(generation!==this.generation)throw new Error('Anmeldung wurde geändert.');this.save(session.clientId,response.data);return response.data.access_token;})().finally(()=>{this.refreshing=null;});return this.refreshing;}
  disconnect(){this.cancel();this.secrets.delete('community-twitch-session');this.secrets.delete('community-twitch-token');}
}
module.exports={TwitchModerationLogin,SCOPES};
