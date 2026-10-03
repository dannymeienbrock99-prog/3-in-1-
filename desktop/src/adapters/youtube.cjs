class YouTubeAdapter {
  constructor({liveChatId='',apiKey='',pollMs=2500,onMessage,onStatus}) {
    this.name='youtube';this.liveChatId=liveChatId;this.apiKey=apiKey;this.pollMs=pollMs;this.onMessage=onMessage;this.onStatus=onStatus;
    this.running=false;this.timer=null;this.pageToken='';this.backoff=pollMs;this.lastSuccessAt=null;this.generation=0;this.requestController=null;
    this.capabilities={readChat:true,sendChat:false,moderation:false,events:false};
    this.status={name:this.name,connected:false,state:'not-configured',error:null};
  }
  getStatus(){return{...this.status,lastSuccessAt:this.lastSuccessAt,backoffMs:this.backoff,capabilities:{...this.capabilities}}}
  setStatus(p){this.status={...this.status,...p};this.onStatus?.(this.getStatus())}
  updateConfig(c={}){this.liveChatId=c.liveChatId??this.liveChatId;this.apiKey=c.apiKey??this.apiKey;this.pollMs=Math.max(1000,Number(c.pollMs||this.pollMs||2500));this.setStatus({state:this.liveChatId&&this.apiKey?(this.running?'connected':'configured'):'not-configured'})}
  healthCheck(){const s=this.getStatus();return Promise.resolve({ok:Boolean(s.connected),status:s});}
  async connect(){if(!this.liveChatId||!this.apiKey)throw new Error('YouTube benötigt Live Chat ID und API Key.');if(this.running)return{ok:true,status:this.getStatus()};const generation=++this.generation;this.running=true;this.backoff=this.pollMs;this.setStatus({state:'connecting',connected:false,error:null});await this.poll(generation);if(!this.running||generation!==this.generation)throw new Error('YouTube-Verbindung wurde beendet.');return{ok:Boolean(this.status.connected),status:this.getStatus()}}
  async poll(generation=this.generation){
    const current=()=>this.running&&generation===this.generation;
    if(!current())return;
    const controller=new AbortController();this.requestController=controller;
    const timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const qs=new URLSearchParams({liveChatId:this.liveChatId,part:'snippet,authorDetails',maxResults:'200',key:this.apiKey});if(this.pageToken)qs.set('pageToken',this.pageToken);
      const r=await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?${qs}`,{signal:controller.signal});
      if(!current())return;
      if(!r.ok){const body=await r.text().catch(()=>'');throw new Error(`YouTube API ${r.status}${body?`: ${body.slice(0,300)}`:''}`)}
      const j=await r.json();if(!current())return;
      for(const item of j.items||[]){const s=item.snippet||{},a=item.authorDetails||{};this.onMessage?.({platform:'youtube',id:item.id,userId:a.channelId,channelId:this.liveChatId,identityVerified:Boolean(a.channelId),username:a.displayName||'YouTubeUser',displayName:a.displayName,message:s.displayMessage||'',timestamp:s.publishedAt||new Date().toISOString(),moderator:Boolean(a.isChatModerator),isBroadcaster:Boolean(a.isChatOwner),subscriber:Boolean(a.isChatSponsor),raw:item})}
      this.pageToken=j.nextPageToken||this.pageToken;this.backoff=Math.max(this.pollMs,Number(j.pollingIntervalMillis||this.pollMs));this.lastSuccessAt=new Date().toISOString();this.setStatus({state:'connected',connected:true,error:null});
    }catch(e){if(current()){this.backoff=Math.min(60000,Math.max(5000,this.backoff*2));this.setStatus({state:this.lastSuccessAt?'degraded':'error',connected:Boolean(this.lastSuccessAt),error:e.name==='AbortError'?'YouTube API: Zeitüberschreitung.':e.message})}}
    finally{clearTimeout(timeout);if(this.requestController===controller)this.requestController=null;if(current()){clearTimeout(this.timer);this.timer=setTimeout(()=>this.poll(generation),this.backoff);this.timer.unref?.();}}
  }
  async sendChat(){throw new Error('YouTube Senden ist ohne autorisierte OAuth-Schreibverbindung deaktiviert.');}
  disconnect(){++this.generation;this.running=false;this.requestController?.abort();this.requestController=null;clearTimeout(this.timer);this.timer=null;this.setStatus({state:'stopped',connected:false,error:null})}
}
module.exports={YouTubeAdapter};
