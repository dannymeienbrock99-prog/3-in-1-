"use strict";
const { OverlayServer: BaseOverlayServer, isLoopback } = require('./overlay-server-base.cjs');

// Own the lifecycle of the HTTP/WS transport separately from page templates.
// ws forwards HTTP listen failures as its own error event; both emitters need
// listeners before the first asynchronous listen result, including EADDRINUSE.
class OverlayServer extends BaseOverlayServer {
  constructor(options) {
    super(options);
    this.networkError = null;
    this.actionWaiters = new Map();
  }

  getStatus() {
    return { ...super.getStatus(), error: this.networkError };
  }

  async start() {
    if (this.server?.listening) return this.getStatus();
    this.networkError = null;
    const pending = super.start();
    const report = error => {
      this.networkError = { code: error.code || 'OVERLAY_NETWORK_ERROR', message: error.message };
    };
    this.server?.on('error', report);
    this.wss?.on('error', report);
    this.wss?.on('connection', socket => {socket.on('error',report);socket.on('message',bytes=>{let p;try{p=JSON.parse(bytes);}catch{return;}if(!p||typeof p!=='object'||Array.isArray(p))return;if(p.type==='action:ack'){const waiter=this.actionWaiters.get(p.id);if(waiter){p.ok?waiter.resolve({ok:true,completed:true}):waiter.reject(new Error(p.error||'Overlay meldet einen Fehler.'));}}});});
    try { await pending; return this.getStatus(); }
    catch (error) {
      report(error);
      await this.stop();
      throw error;
    }
  }

  async runAction(payload,{signal,timeoutMs=30000}={}){
    if(!this.server?.listening)throw new Error('Overlay-Server läuft nicht.');
    const id=require('crypto').randomUUID();let timer,cancel;
    try{return await new Promise((resolve,reject)=>{
      this.actionWaiters.set(id,{resolve,reject});
      timer=setTimeout(()=>reject(new Error('Keine Ausführungsbestätigung vom OBS-Overlay. Passende Browserquelle öffnen.')),timeoutMs);
      cancel=()=>{this.broadcast({type:'action:cancel',id});reject(new Error('Overlay-Aktion abgebrochen.'));};
      if(signal?.aborted)return cancel();signal?.addEventListener('abort',cancel,{once:true});
      this.broadcast({type:'event',data:{...payload,event:payload.type,data:{...payload.data,overlayActionId:id}}});
    });}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.actionWaiters.delete(id);}
  }
  async stop() {
    for(const waiter of this.actionWaiters.values())waiter.reject(new Error('Overlay-Server beendet.'));this.actionWaiters.clear();

    this.chatCore?.off('message', this.boundMessage);
    const wss = this.wss;
    const server = this.server;
    this.wss = null;
    this.server = null;
    this.startedAt = null;
    if (wss) {
      // Terminate owned clients so a dead browser cannot delay app shutdown.
      for (const client of wss.clients) client.terminate();
      wss.close();
    }
    if (!server) return;
    await new Promise(resolve => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
  }
}
module.exports = { OverlayServer, isLoopback };
