'use strict';
function viewerConfig(v={}){return {enabled:v.enabled!==false,tiktok:v.tiktok!==false,twitch:v.twitch!==false};}
class ViewerService {
  constructor({getTwitch,config={},onChange=()=>{},now=Date.now,staleAfterMs=90000}){Object.assign(this,{getTwitch,onChange,now,staleAfterMs});this.config=viewerConfig(config);this.values={tiktok:{state:'unknown',count:null,updatedAt:null,error:''},twitch:{state:'unknown',count:null,updatedAt:null,error:''}};this.timer=null;this.polling=false;this.failures=0;}
  snapshot(){const output={settings:{...this.config}};for(const p of ['tiktok','twitch']){const v={...this.values[p]};if(!this.config.enabled||!this.config[p])v.state='disabled';else if(v.updatedAt&&this.now()-v.updatedAt>this.staleAfterMs&&['live','offline'].includes(v.state))v.state='stale';output[p]=v;}return output;}
  emit(){this.onChange(this.snapshot());}
  configure(config){this.config=viewerConfig(config);this.emit();}
  update(platform,state,count=null,error=''){this.values[platform]={state,count:Number.isInteger(count)&&count>=0?count:null,updatedAt:this.now(),error};this.emit();}
  ingestTikFinity(packet={}){
    if(!this.config.enabled||!this.config.tiktok)return false;
    const raw=packet.raw||packet.meta?.rawData||packet, data=packet.data||raw.data||raw;
    const event=String(packet.event||raw.event||data.event||raw.type||packet.type||'').toLowerCase().replace(/[^a-z]/g,'');
    if(['streamend','liveend','streamended'].includes(event)){this.update('tiktok','offline');return true;}
    // A disconnected bridge is not proof that the stream itself ended.
    if(['disconnected','disconnect','error'].includes(event)){this.update('tiktok','unavailable',null,'TikFinity liefert derzeit keine Zuschauerzahl.');return true;}
    if(!['roomuser','roomuserseq','roomuserseqevent','webcastroomuserseqmessage','viewerupdate','viewercount','roomstats'].includes(event))return false;
    const value=data.viewerCount??data.viewer_count??data.roomUserCount;
    if(value===null||value===undefined||value===''||typeof value==='boolean')return false;
    const count=Number(value);if(!Number.isSafeInteger(count)||count<0)return false;
    this.update('tiktok','live',count);return true;
  }
  async poll(){if(this.polling)return;this.polling=true;try{if(this.config.enabled&&this.config.twitch){const result=await this.getTwitch();if(result.state==='live'&&(!Number.isSafeInteger(result.count)||result.count<0))throw new Error('Twitch liefert keinen gültigen Messwert.');this.update('twitch',result.state,result.count);this.failures=0;}else this.emit();}catch(error){this.failures++;this.update('twitch','unavailable',null,error.message);}finally{this.polling=false;}}
  start(){if(this.timer)return;this.stopped=false;const tick=async()=>{await this.poll();if(this.stopped)return;this.timer=setTimeout(tick,Math.min(300000,30000*2**Math.min(this.failures,3)));this.timer.unref?.();};this.timer=setTimeout(tick,50);this.timer.unref?.();this.staleTimer=setInterval(()=>this.emit(),15000);this.staleTimer.unref?.();}
  stop(){this.stopped=true;clearTimeout(this.timer);clearInterval(this.staleTimer);this.timer=null;this.staleTimer=null;}
}
module.exports={ViewerService,viewerConfig};
