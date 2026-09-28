'use strict';

class TwitchLogin {
  constructor({ secrets, validate, fetchImpl = fetch, now = Date.now }) {
    Object.assign(this,{secrets,validate,fetchImpl,now});
    this.generation=0;this.timer=null;this.state={status:'idle'};this.refreshing=null;
  }
  session(){try{return JSON.parse(this.secrets.get('twitch-device-session')||'null');}catch{return null;}}
  status(){return {...this.state,connected:!!this.session()};}
  cancel(){this.generation++;clearTimeout(this.timer);this.timer=null;this.state={status:'idle'};}
  disconnect(){this.cancel();this.secrets.delete('twitch-device-session');}
  async request(endpoint,body){
    const r=await this.fetchImpl('https://id.twitch.tv/oauth2/'+endpoint,{method:'POST',body:new URLSearchParams(body),redirect:'error',signal:AbortSignal.timeout(10000)});
    const data=await r.json();return {ok:r.ok,data};
  }
  async start(clientId){
    this.cancel();const generation=this.generation;
    if(!/^[a-z\d]{10,100}$/i.test(clientId||''))throw new Error('Für dieses Programm fehlt die registrierte Twitch-App-Kennung.');
    const {ok,data}=await this.request('device',{client_id:clientId,scopes:'user:write:chat'});
    if(generation!==this.generation)return this.status();
    if(!ok||!data.device_code||!data.user_code)throw new Error('Twitch-Anmeldung konnte nicht gestartet werden. Öffentliche Twitch-App-Kennung prüfen.');
    const url=new URL(data.verification_uri);
    if(url.protocol!=='https:'||url.hostname!=='www.twitch.tv'||url.pathname!=='/activate')throw new Error('Unerwartete Twitch-Anmeldeadresse.');
    let interval=Math.max(5,Number(data.interval)||5)*1000;
    const expires=this.now()+Math.min(1800,Number(data.expires_in)||600)*1000;
    this.state={status:'pending',code:String(data.user_code),url:url.href};
    const poll=async()=>{
      if(generation!==this.generation)return;
      if(this.now()>=expires){this.state={status:'error',error:'Anmeldung abgelaufen. Bitte erneut verbinden.'};return;}
      try{
        const result=await this.request('token',{client_id:clientId,scopes:'user:write:chat',device_code:data.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'});
        if(generation!==this.generation)return;
        if(result.ok){
          const identity=await this.validate(result.data.access_token);
          if(identity.client_id!==clientId)throw new Error('App-Kennung stimmt nicht überein.');
          if(generation!==this.generation)return;
          this.save(clientId,result.data,identity.login);
          this.state={status:'connected',username:identity.login};return;
        }
        const reason=result.data.message||result.data.error;
        if(reason==='slow_down')interval+=5000;
        else if(reason!=='authorization_pending'){this.state={status:'error',error:'Twitch-Anmeldung wurde abgelehnt oder ist abgelaufen.'};return;}
      }catch{if(generation===this.generation)this.state={status:'error',error:'Twitch-Anmeldung fehlgeschlagen. Bitte erneut verbinden.'};return;}
      if(generation===this.generation){this.timer=setTimeout(poll,interval);this.timer.unref?.();}
    };
    this.timer=setTimeout(poll,interval);this.timer.unref?.();return this.status();
  }
  save(clientId,data,username){
    if(!data.access_token||!data.refresh_token||!Number.isFinite(data.expires_in))throw new Error('Unvollständige Twitch-Anmeldung.');
    this.secrets.set('twitch-device-session',JSON.stringify({clientId,accessToken:data.access_token,refreshToken:data.refresh_token,expires:this.now()+data.expires_in*1000,username}));
  }
  async token(){
    const current=this.session();
    if(!current)return this.secrets.get('twitch-write-token');
    if(current.expires>this.now()+60000)return current.accessToken;
    if(this.refreshing)return this.refreshing;
    const generation=this.generation;
    this.refreshing=(async()=>{
      const {ok,data}=await this.request('token',{client_id:current.clientId,grant_type:'refresh_token',refresh_token:current.refreshToken});
      if(!ok)throw new Error('Twitch-Anmeldung abgelaufen. Unter Plattformen erneut mit Twitch verbinden.');
      const identity=await this.validate(data.access_token);
      if(generation!==this.generation||identity.client_id!==current.clientId)throw new Error('Twitch-Anmeldung wurde geändert.');
      this.save(current.clientId,data,identity.login);return data.access_token;
    })().finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
}
module.exports={TwitchLogin};
