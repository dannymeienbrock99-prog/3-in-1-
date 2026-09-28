'use strict';
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocketServer}=require('ws');
const {StreamerBotAdapter,hash}=require('../src/adapters/streamerbot.cjs');
const {ChainService}=require('../src/core/chain-service.cjs');
const {ActionEngine}=require('../src/core/action-engine.cjs');
const {InputHotkeys}=require('../src/core/input-hotkeys.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  let calls=0,finish=true,auth=false;
  server.on('connection',ws=>{
    ws.send(JSON.stringify({request:'Hello',info:{source:'websocketServer',version:'fixture'},authentication:{salt:'salt',challenge:'challenge'}}));
    ws.on('message',bytes=>{const p=JSON.parse(bytes);let response={id:p.id,status:'ok'};
      if(p.request==='Authenticate'){assert.equal(p.authentication,hash(hash('passwordsalt')+'challenge'));auth=true;}
      if(p.request==='GetEvents')response.events={Twitch:['Cheer'],Raw:['ActionCompleted']};
      if(p.request==='GetActions')response.actions=[{id:'a',name:'Fixture action',enabled:true}];
      ws.send(JSON.stringify(response));
      if(p.request==='DoAction'){calls++;if(finish)setTimeout(()=>ws.send(JSON.stringify({batto:{kind:'completion',actionId:'a',runId:p.args.battoRunId,ok:true}})),25);}
    });
  });
  const adapter=new StreamerBotAdapter({getConfig:()=>({url:`ws://127.0.0.1:${server.address().port}/`}),getPassword:()=> 'password'});
  try{
    await adapter.connect();assert.equal(auth,true);assert.equal(adapter.status().connected,true);
    assert.equal((await adapter.execute('a',{},undefined,1000,{waitForCompletion:true})).completed,true);
    finish=false;const accepted=await adapter.execute('a');assert.equal(accepted.accepted,true);assert.equal(accepted.completed,false);assert.equal(accepted.delivery,'unconfirmed');await assert.rejects(adapter.execute('a',{},undefined,80,{waitForCompletion:true}),/nicht bestätigt/);
    await assert.rejects(adapter.execute('missing'),/fehlt/);assert.equal(calls,3);
  }finally{adapter.disconnect();for(const ws of server.clients)ws.terminate();await new Promise(r=>server.close(r));}
  const cfg={commands:[],actionChains:[{id:'chain',name:'Chain',actions:[{type:'delay',ms:30}],queueMode:'queue'}]};
  const audit=[];const engine=new ActionEngine({getConfig:()=>cfg,isLive:()=>false,onAudit:x=>audit.push(x)});
  const chains=new ChainService({getConfig:()=>cfg,engine});engine.runChain=(id,ctx)=>chains.trigger(id,ctx);
  assert.equal((await engine.executeRule({id:'r',chainId:'chain',onlyWhenLive:true},{},'event')).skipped,'not-live');
  assert.equal(chains.history.length,0);
  await engine.executeRule({id:'r',chainId:'chain',cooldownSeconds:60},{},'event');
  assert.equal((await engine.executeRule({id:'r',chainId:'chain',cooldownSeconds:60},{},'event')).skipped,'cooldown');
  const first=chains.trigger('chain');const second=chains.trigger('chain');assert.equal(chains.status().queued[0].count,1);await Promise.all([first,second]);
  const pending=chains.trigger('chain');const removed=chains.trigger('chain');const rejection=assert.rejects(removed,/fehlt/);cfg.actionChains=[];await pending;await rejection;
  const result=await engine.execute([{type:'unknown',failurePolicy:'continue'},{type:'delay',ms:1}]);assert.equal(result.ok,false);assert.equal(audit.at(-1).result,'failed');
  cfg.commands=[{id:'cmd',trigger:'hello',prefix:'!',aliases:['hi'],roles:['moderator'],actions:[{type:'delay',ms:1}]}];
  const before=audit.length;await engine.handleMessage({platform:'twitch',username:'u',message:'!hi text',user:{}});assert.equal(audit.length,before);
  await engine.handleMessage({platform:'twitch',username:'u',message:'!hi text',user:{isModerator:true}});assert.ok(audit.length>before);
  const callbacks=new Map();let triggered=0;
  const keys=new InputHotkeys({register:(key,fn)=>{callbacks.set(key,fn);return true;},unregister:key=>callbacks.delete(key),trigger:()=>triggered++,stop:()=>{}});
  const states=keys.configure([{id:'1',accelerator:'Control+F8',chainId:'c'},{id:'2',accelerator:'Control+F8',chainId:'c'}]);assert.equal(states[0].registered,true);assert.equal(states[1].registered,false);
  callbacks.get('Control+F8')();callbacks.get('Control+F8')();assert.equal(triggered,1);keys.clear();assert.equal(callbacks.size,0);
  const {SupportEvents}=require('../src/core/events/support-events.cjs');
  let provider='none',support=[];const supportAdapter=new SupportEvents({getProvider:()=>provider,onEvent:e=>support.push(e)});
  const donation={event:{source:'Streamlabs',type:'Donation'},data:{id:'donation-1',amount:3,currency:'EUR'}};
  assert.equal(supportAdapter.ingest(donation),false);provider='streamlabs';assert.equal(supportAdapter.ingest(donation),true);assert.equal(supportAdapter.ingest(donation),false);
  supportAdapter.ingest({event:{source:'Twitch',type:'Cheer'},data:{id:'cheer-1',bits:100}});assert.equal(support[0].data.unit,'money');assert.equal(support[1].data.unit,'bits');
  for(const count of [1,3,3])supportAdapter.ingest({bridge:true,platform:'tiktok',type:'gift',seriesId:'series-1',count,coinsPerGift:2,username:'u'});
  assert.deepEqual(support.slice(2).map(e=>e.data.value),[2,4]);
  await sleep(10);console.log('Automation connector regression: PASS (local fixtures; no platform messages sent)');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
