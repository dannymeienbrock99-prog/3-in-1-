'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('../src/renderer/chat-appearance.js');
const {ConfigStore,DEFAULT_CONFIG,migrateConfig}=require('../src/core/config-store.cjs');
const {SettingsService}=require('../src/core/settings/settings-service.cjs');
const {validateConfig}=require('../src/core/settings/schema.cjs');
const {OverlayServer}=require('../src/core/overlay-server-base.cjs');
const {normalizeMessage}=require('../src/core/chat-core.cjs');
const ownStore=t=>{const base=path.resolve(process.env.BATTO_TEST_TEMP_ROOT||os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'batto-chat-appearance-'));t.after(()=>{if(!directory.startsWith(base+path.sep))throw Error('Test directory escaped its temporary root');fs.rmSync(directory,{recursive:true,force:true});});return new ConfigStore(directory);};

test('legacy colors, typography and timestamp choices migrate without activating a new appearance',()=>{
 const old=A.clone(DEFAULT_CONFIG);delete old.chatAppearance;old.chatColors={enabled:true,username:'#123456',message:'#abcdef',broadcastUsername:'#224466',broadcastMessage:'#abcdef'};old.multiChat.fontSize=31;old.multiChat.fontFamily='Georgia';old.multiChat.showTimestamp=false;
 const next=migrateConfig(old);assert.equal(next.chatAppearance.configured,false);assert.equal(next.chatAppearance.common.roles.normal.username,'#123456');assert.equal(next.chatAppearance.common.roles.autoBroadcast.username,'#224466');assert.equal(next.chatAppearance.typography.fontSize,31);assert.equal(next.chatAppearance.typography.fontFamily,'Georgia');assert.equal(next.chatAppearance.common.timestamps,false);assert.equal(next.chatAppearance.detached.inherit,true);
 assert.deepEqual(next.chatColors,old.chatColors);assert.deepEqual(next.multiChat,old.multiChat);assert.deepEqual(next.chatDesign,old.chatDesign);assert.equal(validateConfig(next).ok,true);
 assert.equal(A.forMessage(A.resolve(next),{}).username,'#123456');
 old.multiChat.fontFamily='Bahnschrift';old.multiChat.fontSize='31';const custom=migrateConfig(old);assert.equal(custom.chatAppearance.typography.fontFamily,'Bahnschrift');assert.equal(custom.chatAppearance.typography.fontSize,31);assert.equal(custom.multiChat.fontSize,'31');
});

test('all role and platform profiles persist independently through a real settings save and reload',t=>{
 const store=ownStore(t),service=new SettingsService({configStore:store}),value=A.clone(store.get().chatAppearance);value.configured=true;value.colorMode='platform';value.common.roles.normal.username='#123456';value.platforms.tiktok.roles.self.username='#f27aff';value.platforms.twitch.roles.moderator.message='#88ccaa';value.platforms.youtube.roles.bot.username='#aabbcc';value.platforms.cng.roles.system.message='#eeddcc';value.favorites=['#f27aff','#aabbcc'];value.common.opacity=0;value.common.timestamps=false;
 const result=service.savePatch({chatAppearance:value});assert.equal(result.ok,true);const reloaded=new ConfigStore(path.dirname(store.dir)).get();assert.deepEqual(reloaded.chatAppearance,value);
 assert.equal(A.forMessage(A.resolve(reloaded),{platform:'tiktok',narrationRole:'self'}).username,'#f27aff');assert.equal(A.forMessage(A.resolve(reloaded),{platform:'twitch',moderator:true}).message,'#88ccaa');assert.equal(A.forMessage(A.resolve(reloaded),{platform:'youtube',isBot:true}).username,'#aabbcc');assert.equal(A.forMessage(A.resolve(reloaded),{platform:'cng',system:true}).message,'#eeddcc');
});

test('detached own typography can be saved without enabling or changing the main profile',t=>{
 const store=ownStore(t),before=store.get(),profile=A.clone(before.chatAppearance.detached);profile.inherit=false;profile.configured=true;profile.typography={...profile.typography,sizeMode:'separate',fontSize:28,usernameSize:26,messageSize:30,timestampSize:12,fontFamily:'Consolas',fontWeight:600,lineHeight:1.8,messageGap:17};
 store.merge({chatAppearance:{detached:profile}});const next=new ConfigStore(path.dirname(store.dir)).get();assert.equal(next.chatAppearance.configured,false);assert.deepEqual(next.chatAppearance.common,before.chatAppearance.common);assert.deepEqual(next.multiChat,before.multiChat);assert.deepEqual(next.chatAppearance.typography,before.chatAppearance.typography);assert.equal(A.resolve(next,{detached:true}).configured,true);assert.deepEqual(A.forMessage(A.resolve(next,{detached:true}),{}).size,{username:26,message:30,timestamp:12});
 store.merge({chatAppearance:{detached:{inherit:true}}});assert.equal(A.resolve(store.get(),{detached:true}).configured,false);assert.deepEqual(store.get().chatAppearance.detached.typography,profile.typography,'switching inheritance retains the own profile for later use');
});

test('role styling uses explicit canonical flags and cannot change role identity or moderation rights',()=>{
 const appearance=A.resolve({...DEFAULT_CONFIG,chatAppearance:{...A.clone(A.defaults),configured:true}}),viewer={username:'Owner Moderator Bot',displayName:'Streamer',message:'Hallo',userId:'owner'};const before=structuredClone(viewer);
 assert.equal(A.forMessage(appearance,viewer).role,'normal');assert.deepEqual(viewer,before);assert.equal(A.roleFor({...viewer,narrationRole:'owner'}),'self');assert.equal(A.roleFor({...viewer,narrationRole:'moderator'}),'moderator');assert.equal(A.roleFor({...viewer,raw:{user:{isBot:true}}}),'bot');assert.equal(A.roleFor({...viewer,raw:{meta:{sourceConnector:'broadcast-run:fixture'}},moderator:true}),'autoBroadcast');assert.equal(A.roleFor({...viewer,raw:{meta:{sourceConnector:'broadcast-run:../fake'}}}),'normal');
 const scheme={...A.defaults.common,mentionTerms:['@my_channel']};assert.equal(A.roleFor({...viewer,message:'Hallo @my_channel'},scheme),'mention');assert.equal(A.roleFor({...viewer,message:'Das ist keine Erwähnung'},scheme),'normal');
 for(const [flag,role]of [['bot','bot'],['system','system'],['mentionsSelf','mention']])assert.equal(A.roleFor(normalizeMessage({...viewer,platform:'local',[flag]:true})),role,'explicit visual flag survives the existing ChatCore normalization');
});

test('invalid colors, sizes, fonts, opacity, weights and oversized favorites are rejected before persistence',t=>{
 const store=ownStore(t),service=new SettingsService({configStore:store}),before=store.get();
 for(const patch of [{common:{roles:{normal:{username:'red'}}}},{common:{background:'#fff'}},{common:{opacity:1.1}},{common:{highlightOpacity:-.1}},{common:{timestamps:'false'}},{common:{mentionTerms:['x'.repeat(81)]}},{typography:{fontSize:73}},{typography:{timestampSize:7}},{typography:{fontFamily:'url(evil)'}},{typography:{fontWeight:333}},{typography:{lineHeight:0}},{typography:{messageGap:41}},{favorites:Array(33).fill('#123456')}]){
  const result=service.savePatch({chatAppearance:patch});assert.equal(result.ok,false,JSON.stringify(patch));assert.deepEqual(store.get(),before);
 }
});

test('own chat overlay embeds only appearance data, escapes text safely and refreshes when it changes',()=>{
 const config=A.clone(DEFAULT_CONFIG);config.chatAppearance.configured=true;config.chatAppearance.common.mentionTerms=['</script><script>bad()</script>'];config.platforms.youtube.apiKey='never-expose-this';
 const server=new OverlayServer({configStore:{get:()=>config},chatCore:{}}),html=server.chatHtml();assert(html.includes('/chat-appearance.js'));assert(html.includes('BattoChatAppearance.forMessage'));assert(html.includes('BattoChatAppearance.apply'));assert(!html.includes('never-expose-this'));assert(!html.includes('</script><script>bad()'));assert(html.includes('\\u003c/script>'));
 const source=fs.readFileSync(path.join(__dirname,'../src/core/overlay-server-base.cjs'),'utf8');assert(source.includes("sections.includes('chatAppearance')"));
});
