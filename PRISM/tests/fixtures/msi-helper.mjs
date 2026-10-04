import readline from 'node:readline';
import {createHash} from 'node:crypto';
const effect=(name,modeId,controls={})=>({id:'msi:style:'+createHash('sha256').update(name.trim().toLowerCase()).digest('hex').slice(0,16),name,modeId,...controls});
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { requestId, command, deviceId, colors, modeId, brightness, speed } = JSON.parse(line);
  let result;
  if (command === 'enumerate') result = {devices:[
    {id:20000,name:'MSI MEG X670E GODLIKE · Dragon',vendor:'MSI',type:0,ledCount:2,provider:'msi',directMode:true,directModeId:0,colors:[0,0],colorsKnown:false,leds:[{name:'Dragon LED'},{name:'Logo LED'}],zones:[{id:0,name:'Dragon',startIndex:0,ledCount:2}],modes:[{id:0,name:'Direct Lighting Control'},{id:1,name:'Rainbow'}],nativeEffects:[effect('Direct Lighting Control',0,{brightnessMax:10,speedMax:5}),effect('Rainbow',1,{brightnessMax:10,speedMax:5})]},
    {id:20001,name:'Kingston FURY Beast RGB · DIMM 1',vendor:'Kingston',type:1,ledCount:1,ledGranularity:'area',provider:'msi',directMode:true,directModeId:0,colors:[0x123456],colorsKnown:true,zones:[{id:0,name:'DIMM 1',startIndex:0,ledCount:1}],modes:[{id:0,name:'Steady'},{id:1,name:'Rainbow'}],nativeEffects:[effect('Steady',0),effect('Rainbow',1,{brightnessMax:10,speedMax:5})]},
    {id:20002,name:'SDK area without direct color support',vendor:'MSI',ledCount:1,provider:'msi',directMode:false,modes:[{id:0,name:'Unfamiliar mode'}],nativeEffects:[effect('Unfamiliar mode',0)]},
    {id:20003,name:'Elgato Stream Deck',vendor:'Elgato',ledCount:15,provider:'msi'}
  ],environment:{msi:{status:'connected',deviceCount:3,backgroundSupported:true}},discovery:[],warnings:[],excludedCount:1};
  else if(command==='set') result={updated:true,deviceId,colors};
  else if(command==='effect') result={updated:true,deviceId,modeId,brightness,speed};
  else if(command==='release') result={released:true};
  else result={};
  process.stdout.write(JSON.stringify({requestId,ok:true,result})+'\n');
}
