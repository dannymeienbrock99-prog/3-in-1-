import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENES,DEFAULT_CONFIG,importProfileDocument,validProfile,readProfiles} from '../src/data.js';
import {availableSceneTargets,saveScene,sceneLibrary,validateSceneCollection} from '../src/scene-library.js';
import {renderFrame} from '../server/effect-renderer.mjs';
import {STRIMER_LCONNECT_MODES,STRIMER_CABLE_TYPES,strimerCapabilities} from '../server/strimer-capabilities.mjs';

test('all original scene names and colors survive while ten complete renderable scenes are added',()=>{
 assert.deepEqual(SCENES.slice(0,8).map(scene=>scene.name),['Neon Night','Aurora','Sunset','Ice Blue','Kaminfeuer','Polarlicht','Neon-Komet','Neon-Lauflicht']);
 assert.deepEqual(SCENES[0].colors,['#a044ff','#e443c9','#4c37fa','#8d54ff']);
 assert.deepEqual(SCENES.slice(8).map(scene=>scene.name),['Goldglanz','Schwarz-Gold','Eissturm','Glut','Lava','Ozean','Sternenfeld','Waldlicht','Polarweiß','Cyberpunk']);
 assert.equal(new Set(SCENES.map(scene=>scene.id)).size,18);
 for(const scene of SCENES){validProfile(scene);const frames=[0,.8,2.4].flatMap(time=>renderFrame(64,scene.config,time));assert.ok(frames.some(color=>color!==0),scene.name);assert.ok(frames.every(color=>Number.isInteger(color)&&color>=0&&color<=0xffffff),scene.name);}
});

test('editing a standard scene creates a saved override and resetting restores its original template',()=>{
 const original=structuredClone(SCENES[0]);
 const saved=saveScene([],{...SCENES[0],name:'Mein Neon',favorite:true,category:'Studio',targetDevices:[50001],config:{...SCENES[0].config,brightness:37}});
 const list=sceneLibrary(saved);assert.equal(list.length,18);assert.equal(list[0].name,'Mein Neon');assert.equal(list[0].config.brightness,37);assert.equal(list[0].favorite,true);assert.equal(list[0].modified,true);
 assert.deepEqual(SCENES[0],original);assert.deepEqual(sceneLibrary([])[0],original);
 const custom={id:'my-scene',name:'Studio 2',config:DEFAULT_CONFIG,targetDevices:[]};assert.equal(sceneLibrary(saveScene(saved,custom)).length,19);
 assert.equal(saveScene(saved,{...saved[0],name:'Update'}).length,1);
});

test('scene target restoration never substitutes missing hardware or invents a target for a template',()=>{
 assert.equal(availableSceneTargets(SCENES[0],[{id:2}]),null);
 assert.deepEqual(availableSceneTargets({targetDevices:[2,60001]},[{id:2},{id:60002}]),{available:[2],missing:[60001]});
 assert.deepEqual(availableSceneTargets({targetDevices:[]},[{id:2}]),{available:[],missing:[]});
});

test('version 1 and 2 imports validate the entire file and allocate fresh IDs while keeping metadata',()=>{
 for(const version of [1,2]){const source={id:'preset-0',name:'Import',config:DEFAULT_CONFIG,category:'Studio',favorite:true,targetDevices:[4]};const result=importProfileDocument({app:'PRISM',version,profiles:[source,source]});assert.equal(result.length,2);assert.notEqual(result[0].id,source.id);assert.notEqual(result[0].id,result[1].id);assert.deepEqual(result[0].targetDevices,[4]);assert.equal(result[0].category,'Studio');assert.equal(result[0].favorite,true);}
 assert.throws(()=>importProfileDocument({app:'PRISM',version:3,profiles:[]}),/unterstützte/);
 assert.throws(()=>importProfileDocument({app:'PRISM',version:2,profiles:[{id:'valid',name:'Valid',config:DEFAULT_CONFIG},{id:'bad',name:'Invalid',config:{...DEFAULT_CONFIG,effect:'unknown'}}]}),/ungültige/);
 assert.throws(()=>importProfileDocument({app:'PRISM',version:2,profiles:[{name:'x',config:DEFAULT_CONFIG,favorite:'yes'}]}),/Favoriten/);
 assert.throws(()=>importProfileDocument({app:'PRISM',version:2,profiles:[{name:'x',config:DEFAULT_CONFIG}],ignored:'x'.repeat(128*1024)}),/zu groß/);
});

test('local storage remains compatible with old arrays and versioned libraries; unsafe fields are removed',t=>{
 const previous=globalThis.localStorage;t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
 const profile={id:'legacy',name:'Alt',config:DEFAULT_CONFIG};
 for(const data of [[profile],{app:'PRISM',version:1,profiles:[profile]},{app:'PRISM',version:2,profiles:[{...profile,category:'Studio',favorite:true,targetDevices:[2]}]}]){globalThis.localStorage={getItem:()=>JSON.stringify(data)};assert.equal(readProfiles()[0].id,'legacy');}
 const unsafe=JSON.parse('{"id":"safe","name":"Safe","__proto__":{"polluted":true}}');const safe=validProfile({...unsafe,config:DEFAULT_CONFIG});assert.equal(Object.hasOwn(safe,'__proto__'),false);assert.equal({}.polluted,undefined);
 assert.throws(()=>validateSceneCollection([profile,profile]),/doppelte/);
});

test('the manufacturer catalog cannot grant transport capabilities or confuse Wireless with Plus V2',()=>{
 assert.equal(STRIMER_LCONNECT_MODES.length,24);assert.equal(STRIMER_LCONNECT_MODES.filter(mode=>mode.documentedGroup==='individual').length,13);
 assert.ok(STRIMER_LCONNECT_MODES.every(mode=>mode.nativeAvailable===false&&mode.firmwareModeId===null&&mode.parameterRanges===null));
 assert.equal(STRIMER_CABLE_TYPES.find(cable=>cable.id==='dual8pin').channels,4);
 assert.equal(STRIMER_CABLE_TYPES.find(cable=>cable.id==='24pin').channels,6);
 const absent=strimerCapabilities();assert.equal(absent.nativeAvailable,false);assert.equal(absent.directAvailable,false);assert.equal(absent.separateChannelOutput,false);
 const wired=strimerCapabilities({name:'Strimer Plus V2',directMode:true,ledCount:120});assert.equal(wired.directAvailable,true);assert.equal(wired.nativeAvailable,false);assert.equal(wired.physicalOutputVerified,false);assert.equal(wired.separateChannelOutput,false);
 const wireless=strimerCapabilities({name:'Strimer Wireless',backend:'lianli-wireless',nativeEffects:[{id:'Static',name:'Statisch'}]});assert.equal(wireless.family,'wireless');assert.equal(wireless.nativeEffects.length,1);assert.equal(wireless.separateChannelOutput,false);
 assert.equal(strimerCapabilities({name:'Lian Li UNI FAN',nativeEffects:[{id:'Static'}]}).nativeAvailable,false);
});
