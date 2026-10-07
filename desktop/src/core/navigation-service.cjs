'use strict';

const {WebSocketServer}=require('ws'),crypto=require('crypto');

const ROUTES=['touchdeck','dualstream','jarvis','sensors','fans','rgb','start','dashboard','wishlist','widgets','widget-windows','livecenter','moderation','chatarchive','filters','hologram','platforms','commands','broadcast','hotkeys','events','media','pools','tts','discord','streamerbot','backups','settings','diagnostics'];

class NavigationService{

  constructor({token,navigate,catalog=()=>[],test=async()=>({ok:false,error:'Tests nicht verfügbar.'}),controls=null,onError=()=>{}}){Object.assign(this,{token,navigate,catalog,test,controls,onError});this.view='start';this.ready=false;this.chain=Promise.resolve();this.replies=new Map();this.testing=false;}

  publish(view){if(!ROUTES.includes(view))return;this.view=view;this.ready=true;this.uiReady=true;this.broadcast();}

  configure({enabled=true,port=17778}={}){
    const change=async()=>{
      if(!enabled){await this.closeServer();return;}
      if(this.server&&this.port===port&&this.server.address())return;
      await this.closeServer();this.ready=this.uiReady===true;this.start(port);
      const server=this.server;
      await new Promise((resolve,reject)=>{
        const done=()=>{server.off('error',failed);resolve();};
        const failed=error=>{server.off('listening',done);reject(error);};
        server.once('listening',done);server.once('error',failed);
      });
    };
    this.configuration=(this.configuration||Promise.resolve()).catch(()=>{}).then(change);
    return this.configuration;
  }

  closeServer(){
    this.ready=false;const server=this.server;this.server=null;
    if(!server)return Promise.resolve();
    for(const ws of server.clients)ws.terminate();
    return new Promise(resolve=>server.close(()=>resolve()));
  }

  connectionPort(){return this.server?.address()?.port||null;}

  state(){return {type:'state',view:this.view,ready:this.ready,routes:ROUTES,...(this.controls?{capabilities:{controls:true,controlApi:2},controls:this.controls.snapshot().states}:{})};}

  broadcast(){for(const ws of this.server?.clients||[])if(ws.authenticated&&ws.readyState===1)ws.send(JSON.stringify(this.state()));}

  start(port=17778){

    if(this.server)return;this.port=port;this.server=new WebSocketServer({host:'127.0.0.1',port,maxPayload:8192,verifyClient:info=>!info.origin});

    this.server.on('error',e=>this.onError(e.message));

    this.server.on('connection',ws=>{

      const timeout=setTimeout(()=>{if(!ws.authenticated)ws.close(1008,'Authentication required');},3000);

      ws.on('close',()=>clearTimeout(timeout));ws.on('error',()=>{});

      ws.on('message',bytes=>{let p;try{p=JSON.parse(bytes);}catch{ws.close(1008,'Invalid JSON');return;}
        if(!p||typeof p!=='object'||Array.isArray(p)){ws.close(1008,'Invalid message');return;}

        if(!ws.authenticated){const supplied=Buffer.from(String(p.token||'')),expected=Buffer.from(this.token);if(p.type!=='auth'||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){ws.close(1008,'Invalid token');return;}ws.authenticated=true;clearTimeout(timeout);ws.send(JSON.stringify(this.state()));return;}

        if(p.type==='state'){ws.send(JSON.stringify(this.state()));return;}

        if(!['navigate','catalog','test','control','control-state:get','control-catalog'].includes(p.type)||typeof p.id!=='string'||!p.id||p.id.length>100)return;

        const respond=result=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'ack',id:p.id,...result}));};

        const cached=this.replies.get(p.id);if(cached){cached.then(respond);return;}

        if(p.type==='control-state:get'||p.type==='control-catalog'){respond(this.controls?{ok:true,...this.controls.snapshot()}:{ok:false,error:'Batto auf Version 2.4.1 aktualisieren.'});return;}

        if(p.type==='control'){

          const job=this.chain.then(async()=>{if(!this.ready)throw new Error('Batto-Oberfläche noch nicht bereit.');if(!this.controls)throw new Error('Batto auf Version 2.4.1 aktualisieren.');const result=await this.controls.control(p);this.broadcast();return result;}).catch(e=>({ok:false,error:e.message}));

          this.replies.set(p.id,job);if(this.replies.size>1000)this.replies.delete(this.replies.keys().next().value);this.chain=job;job.then(respond);return;

        }

        if(p.type==='catalog'){respond({ok:true,items:this.catalog()});return;}

        if(p.type==='test'){

          if(this.testing){respond({ok:false,error:'Ein Stream-Deck-Test läuft bereits.'});return;}

          this.testing=true;

          const job=Promise.resolve().then(()=>this.test(p.kind,p.targetId)).then(r=>({ok:r?.ok===true,error:r?.error||(r?.skipped?'Nicht ausgeführt: '+r.skipped:undefined)})).catch(e=>({ok:false,error:e.message})).finally(()=>{this.testing=false;});

          this.replies.set(p.id,job);if(this.replies.size>1000)this.replies.delete(this.replies.keys().next().value);job.then(respond);return;

        }

        if(this.replies.size>1000)this.replies.delete(this.replies.keys().next().value);

        const job=this.chain.then(async()=>{if(!this.ready)return {ok:false,error:'Batto-Oberfläche noch nicht bereit.'};let target=p.view==='cohost'?'dashboard':p.view;

          if(p.direction){const current=ROUTES.indexOf(this.view),delta=p.direction==='previous'?-1:p.direction==='next'?1:0;let next=current+delta;next=p.wrap?((next+ROUTES.length)%ROUTES.length):Math.max(0,Math.min(ROUTES.length-1,next));target=ROUTES[next];}

          if(!ROUTES.includes(target))return {ok:false,error:'Unbekannter Bereich.'};

          try{const actual=await this.navigate(target,p.focus!==false);if(actual!==target)throw new Error('Seitenwechsel nicht bestätigt.');this.publish(actual);return {ok:true,view:actual};}catch(e){return {ok:false,error:e.message};}

        });this.replies.set(p.id,job);this.chain=job.catch(()=>{});job.then(respond);

      });

    });

  }

  stop(){this.ready=false;for(const ws of this.server?.clients||[])ws.terminate();this.server?.close();this.server=null;}

}

function showNavigationWindow(window,focus){
  if(focus){if(window.isMinimized())window.restore();window.show();window.focus();}
  else window.showInactive();
}
module.exports={NavigationService,ROUTES,showNavigationWindow};
