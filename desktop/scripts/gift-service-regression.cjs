'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createChatExtrasService } = require('../electron/chat-extras-service.cjs');
const { GiftRegistry } = require('../src/core/gifts/gift-registry.cjs');
const { normalizeEvent } = require('../src/core/events/normalizer.cjs');
const { DEFAULT_CONFIG } = require('../src/core/config-store.cjs');
const { validateAdditions } = require('../src/core/settings/community-schema.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'batto-gift-service-'));
const assetsDir = path.join(temp,'assets');fs.mkdirSync(path.join(assetsDir,'gifts'),{recursive:true});fs.writeFileSync(path.join(assetsDir,'gifts','001_Rose.png'),'PNG fixture');
const event = normalizeEvent({platform:'tiktok',event:'gift',id:'provider-68719',data:{giftId:5655,giftName:'Rose',diamondCount:1}},'tikfinity');
let config = structuredClone(DEFAULT_CONFIG), saved = [], sent = [], networkCalls = 0;
config.chatExtras.wishlist.items=[{key:'file:001_Rose.png',name:'Rose',enabled:true,url:'',sourceType:'image',giftId:'',giftIdVerified:false}];
const registry = new GiftRegistry({dataDir:path.join(temp,'data'),fetchImpl:()=>{networkCalls++;throw Error('No test networking');}});
const service = createChatExtrasService({getConfig:()=>config,saveConfig:patch=>{saved.push(patch);config.chatExtras.wishlist={...config.chatExtras.wishlist,...patch.chatExtras.wishlist};},send:(channel,payload)=>sent.push({channel,payload}),assetsDir,giftRegistry:registry,allowCatalogFetch:false});

(async()=>{
  const before=await service.library({refreshCatalog:true});assert.equal(before.items[0].giftId,null);assert.equal(networkCalls,0,'isolated QA explicitly disables even forced fetch');
  assert.equal(service.observe(event),true);
  assert.equal(config.chatExtras.wishlist.items[0].giftId,'5655','first genuine gift persists the matching ID before event routing continues');
  assert.equal(config.chatExtras.wishlist.items[0].giftIdVerified,true);
  assert.equal(config.chatExtras.wishlist.items[0].coins,1);
  assert.equal(config.chatExtras.wishlist.items[0].verificationSource,'tikfinity');
  assert.deepEqual(validateAdditions(config),[],'resolved first gift remains valid for real configuration schema');
  assert.equal(sent[0].channel,'gifts:catalog-changed');assert.equal(saved.length,1);
  service.observe(event);assert.equal(saved.length,1,'repeated gift does not rewrite identical selection');
  const library=await service.library();assert.equal(library.items[0].giftId,'5655');assert.equal(library.catalog[0].giftId,'5655');
  const explicit=service.resolveItems({items:[{name:'Rose',giftId:'111111',giftIdVerified:true,verificationSource:'pretend',coins:9999}]}).items[0];
  assert.equal(explicit.giftId,'111111');assert.equal(explicit.giftIdVerified,false);assert.equal(explicit.coins,null);assert.equal(explicit.verificationSource,'');
  assert.equal(service.resolveItems({items:[{name:'Unrelated display label',giftId:'0005655'}]}).items[0].giftIdVerified,true,'known explicit ID does not require same display label');
  assert.equal(service.resolveItems({items:[{name:'Rose',giftId:'9999999999999999999'}]}).items[0].giftIdVerified,false);
  for(const invalid of [Number.MAX_SAFE_INTEGER+1,0,-1,{},'1.2','1e3','18446744073709551616'])assert.throws(()=>service.resolveItems({items:[{name:'Rose',giftId:invalid}]}));
  for(const invalid of [[[]],[null],Array(798).fill({name:'Rose'})])assert.throws(()=>service.resolveItems({items:invalid}));
  assert.equal(service.resolveItems({items:[{name:'Unknown',giftId:'',giftIdVerified:true}]}).items[0].giftIdVerified,false,'blank IDs can be saved as display-only');
  const makeFragile=overrides=>createChatExtrasService({getConfig:()=>config,saveConfig:()=>{},send:()=>{},giftRegistry:registry,allowCatalogFetch:false,assetsDir,...overrides});
  const failures=[
    {giftRegistry:{observe:()=>{throw Error('registry unavailable');}}},
    {send:()=>{throw Error('closed renderer');}},
    {getConfig:()=>{throw Error('config unavailable');}},
    {getConfig:()=>({chatExtras:{wishlist:{items:[{name:'Rose',giftId:'bad'}]}}})},
    {getConfig:()=>({chatExtras:{wishlist:{items:[{name:'Rose',giftId:''}]}}}),saveConfig:()=>{throw Error('disk full');}},
    {getConfig:()=>({chatExtras:{wishlist:{items:[{name:'Rose',giftId:''}]}}}),saveConfig:()=>Promise.reject(Error('async disk full'))}
  ];
  for(const fail of failures){let continued=false;assert.doesNotThrow(()=>{makeFragile(fail).observe(event);continued=true;});assert.equal(continued,true,'metadata failure never aborts main event pipeline');}
  await new Promise(resolve=>setImmediate(resolve));
  service.close();const reopened=new GiftRegistry({dataDir:path.join(temp,'data')});assert.equal(reopened.match('Rose').match.giftId,'5655');reopened.close();
  console.log('PASS gift service integration: first-event persistence, explicit IDs, no false confirmation, size/numeric validation, isolated network gate, unchanged selection and pipeline resilience.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
