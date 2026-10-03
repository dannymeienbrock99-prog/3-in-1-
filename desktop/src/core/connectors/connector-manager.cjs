const { EventEmitter } = require('events');

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const TERMINAL_ERROR_STATES = new Set(['error', 'auth_required', 'disabled']);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class ConnectorManager extends EventEmitter {
  constructor({ connectTimeoutMs = 12000, onLog } = {}) {
    super();
    this.connectTimeoutMs = Math.max(1000, Number(connectTimeoutMs || 12000));
    this.onLog = onLog;
    this.entries = new Map();
  }

  register(name, adapter, { enabled = true, autoReconnect = true } = {}) {
    if (!name || !adapter) throw new Error('ConnectorManager.register benötigt name und adapter.');
    this.entries.set(name, { name, adapter, enabled:enabled!==false, autoReconnect:autoReconnect!==false, attempt:0, timer:null, lastError:null, state:enabled===false?'DISABLED':'IDLE', connectedAt:null, lastEventAt:null, generation:0, pending:null, stopPromise:null, stopped:enabled===false });
    return adapter;
  }

  get(name) { return this.entries.get(name)?.adapter; }

  configure(name, patch = {}) {
    const entry = this.entries.get(name);
    if (!entry) return false;
    if (patch.enabled !== undefined) entry.enabled = patch.enabled !== false;
    if (patch.autoReconnect !== undefined) entry.autoReconnect = patch.autoReconnect !== false;
    if (!entry.autoReconnect) { clearTimeout(entry.timer); entry.timer=null; }
    if (!entry.enabled) void this.disconnect(name);
    else if (entry.state === 'DISABLED') this.setState(entry,'IDLE');
    return true;
  }

  status(name) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const adapterStatus = typeof entry.adapter.getStatus === 'function' ? entry.adapter.getStatus() : {};
    return { ...adapterStatus, name, state:entry.state, connected:entry.state==='CONNECTED', attempt:entry.attempt, lastError:['IDLE','DISABLED'].includes(entry.state)?null:entry.lastError||adapterStatus.error||adapterStatus.lastError||null, connectedAt:entry.connectedAt, lastEventAt:entry.lastEventAt };
  }
  statuses(){return Object.fromEntries([...this.entries.keys()].map(name=>[name,this.status(name)]));}

  setState(entry,state,error=null){if(!entry)return;entry.state=state;entry.lastError=error?String(error.message||error):null;if(state==='CONNECTED'&&!entry.connectedAt)entry.connectedAt=new Date().toISOString();if(state!=='CONNECTED')entry.connectedAt=null;this.emit('state',this.status(entry.name));}
  markEvent(name){const entry=this.entries.get(name);if(entry)entry.lastEventAt=new Date().toISOString();}
  observeAdapterStatus(name,status={}){const entry=this.entries.get(name);if(!entry)return;const raw=String(status.state||'').toLowerCase();if(!entry.enabled||entry.stopped)return;if(status.connected||raw==='connected'){entry.attempt=0;return this.setState(entry,'CONNECTED')}if(raw==='connecting')return this.setState(entry,'CONNECTING');if(raw==='retrying'||raw==='disconnected')return this.setState(entry,'RETRYING',status.error||status.lastError||null);if(raw==='auth_required')return this.setState(entry,'AUTH_REQUIRED',status.error||status.lastError||null);if(raw==='degraded')return this.setState(entry,'DEGRADED',status.error||status.lastError||null);if(raw==='stopped'||raw==='disabled')return this.setState(entry,'DISABLED');if(status.error||raw==='error')return this.setState(entry,'ERROR',status.error||status.lastError||'Connector-Fehler');if(['idle','configured','not-configured'].includes(raw))return this.setState(entry,'IDLE');this.emit('state',this.status(name));}

  async waitUntilReady(entry,deadline,generation){while(Date.now()<deadline){if(entry.generation!==generation)throw new Error('Verbindung abgebrochen.');const s=typeof entry.adapter.getStatus==='function'?entry.adapter.getStatus():{};const state=String(s.state||'').toLowerCase();if(s.connected||state==='connected')return true;if(TERMINAL_ERROR_STATES.has(state)||s.error)throw new Error(s.error||`Connector ${entry.name}: ${state}`);await sleep(100)}throw new Error(`Connector ${entry.name}: Verbindungs-Timeout nach ${this.connectTimeoutMs} ms`);}

  async connect(name){
    const entry=this.entries.get(name);
    if(!entry)throw new Error(`Unbekannter Connector: ${name}`);
    if(!entry.enabled)return{ok:false,disabled:true,error:'Diese Chat-Verbindung ist deaktiviert.',status:this.status(name)};
    if(entry.pending)return entry.pending.promise;
    if(entry.state==='CONNECTED')return{ok:true,status:this.status(name)};
    clearTimeout(entry.timer);entry.timer=null;entry.stopped=false;
    const generation=++entry.generation, pending={};
    const cancelled=new Promise((_,reject)=>{pending.cancel=()=>reject(new Error('Verbindung abgebrochen.'));});
    entry.pending=pending;
    pending.promise=(async()=>{
      let timeout;
      try{
        const stopped=await Promise.race([entry.stopPromise||Promise.resolve(),cancelled]);
        if(stopped?.ok===false)throw new Error(stopped.error||stopped.message||'Die vorherige Verbindung konnte nicht beendet werden.');
        if(entry.generation!==generation)throw new Error('Verbindung abgebrochen.');
        this.setState(entry,entry.attempt?'RETRYING':'CONNECTING');
        const deadline=Date.now()+this.connectTimeoutMs;
        const call=Promise.resolve().then(()=>typeof entry.adapter.connect==='function'?entry.adapter.connect():entry.adapter.start?.());
        const started=await Promise.race([call,cancelled,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(`Connector ${name}: Start-Timeout nach ${this.connectTimeoutMs} ms`)),this.connectTimeoutMs);})]);
        if(started?.ok===false)throw new Error(started.error||started.message||`Connector ${name}: Verbindungsaufbau fehlgeschlagen.`);
        clearTimeout(timeout);
        await Promise.race([this.waitUntilReady(entry,deadline,generation),cancelled]);
        if(entry.generation!==generation)throw new Error('Verbindung abgebrochen.');
        entry.attempt=0;this.setState(entry,'CONNECTED');return{ok:true,status:this.status(name)};
      }catch(error){
        if(entry.generation!==generation)return{ok:false,cancelled:true,status:this.status(name)};
        this.setState(entry,'ERROR',error);
        this.onLog?.('warn',`connector:${name}`,'CONNECT_FAILED',{message:entry.lastError,attempt:entry.attempt+1});
        if(entry.autoReconnect)this.scheduleRetry(entry);
        return{ok:false,error:entry.lastError,status:this.status(name)};
      }finally{clearTimeout(timeout);if(entry.pending===pending)entry.pending=null;}
    })();
    return pending.promise;
  }

  scheduleRetry(entry){clearTimeout(entry.timer);if(!entry.enabled||entry.stopped||!entry.autoReconnect)return;const generation=entry.generation;const delay=BACKOFF_MS[Math.min(entry.attempt,BACKOFF_MS.length-1)];entry.attempt+=1;this.setState(entry,'RETRYING',entry.lastError);entry.timer=setTimeout(()=>{entry.timer=null;if(entry.generation===generation)void this.connect(entry.name);},delay);entry.timer.unref?.();this.emit('retry',{name:entry.name,delayMs:delay,attempt:entry.attempt});}

  async disconnect(name){
    const entry=this.entries.get(name);if(!entry)return{ok:false,error:`Unbekannter Connector: ${name}`};
    ++entry.generation;entry.stopped=true;entry.pending?.cancel();entry.pending=null;
    clearTimeout(entry.timer);entry.timer=null;entry.attempt=0;this.setState(entry,'DISABLED');
    if(entry.stopPromise)return entry.stopPromise;
    const stopped=Promise.resolve().then(async()=>{
      try{const result=typeof entry.adapter.disconnect==='function'?await entry.adapter.disconnect():await entry.adapter.stop?.();if(result?.ok===false)throw new Error(result.error||result.message||`Connector ${name}: Trennen fehlgeschlagen.`);return{ok:true,status:this.status(name)};}
      catch(error){this.setState(entry,'ERROR',error);this.onLog?.('warn',`connector:${name}`,'STOP_FAILED',{message:error.message});return{ok:false,error:error.message,status:this.status(name)};}
    });
    entry.stopPromise=stopped;
    try{return await stopped;}finally{if(entry.stopPromise===stopped)entry.stopPromise=null;}
  }

  async healthCheck(name){const entry=this.entries.get(name);if(!entry)return{ok:false,error:`Unbekannter Connector: ${name}`};if(typeof entry.adapter.healthCheck==='function'){try{return await entry.adapter.healthCheck()}catch(error){return{ok:false,error:error.message,status:this.status(name)}}}const status=this.status(name);return{ok:Boolean(status?.connected),status};}
  async stopAll(){await Promise.allSettled([...this.entries.keys()].map(name=>this.disconnect(name)));}
}
module.exports={ConnectorManager,BACKOFF_MS};
