'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../../components/fanatlas-src/FanAtlas/Web/overlay.js'),'utf8');
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.textContent='';this.hidden=false;this.attributes={};this.classes=new Set();this.classList={add:value=>this.classes.add(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
 setAttribute(key,value){this.attributes[key]=value;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
}
async function overlay(){
 const stage=new Node('stage'),notice=new Node('notice');let poll,time=Date.now();const fixture={generatedUtc:new Date(time).toISOString(),sensors:[{id:'cpu',unit:'RPM',value:0,fresh:true}],scene:{background:'',showNormalFans:false,tiles:[{id:'cpu-tile',kind:'normal',name:'CPU Fan',x:1000,y:35,size:150,visible:true,centerMode:'rpm',rpmSensorId:'cpu'}]}};
 class Clock extends Date{static now(){return time;}}
 const context=vm.createContext({document:{getElementById:id=>id==='stage'?stage:notice,createElement:tag=>new Node(tag)},location:{search:'?token=fixture'},innerWidth:1920,innerHeight:1080,addEventListener(){},setInterval(fn){poll=fn;},URLSearchParams,AbortSignal,Date:Clock,fetch:async()=>({ok:true,json:async()=>structuredClone(fixture)})});
 vm.runInContext(script,context);await new Promise(resolve=>setImmediate(resolve));return {stage,notice,fixture,poll:async()=>{await poll();},offline:()=>{context.fetch=async()=>{throw Error('offline');};time+=6000;}};
}
test('OBS normal fan toggle hides saved tile; zero RPM remains a genuine reading when enabled',async()=>{
 const ui=await overlay(),tile=ui.stage.children[0],center=tile.children[0].children[1],rpm=tile.children[1].children[1];assert.equal(tile.hidden,true);assert.equal(center.textContent,'0 RPM');ui.fixture.scene.showNormalFans=true;await ui.poll();assert.equal(tile.hidden,false);assert.equal(center.textContent,'0 RPM');assert.equal(rpm.textContent,'0 RPM');assert.equal(tile.style.left,'1000px');assert(tile.classes.has('normal-fan'));
 ui.fixture.scene.showNormalFans=false;await ui.poll();assert.equal(tile.hidden,true);assert.equal(tile.style.left,'1000px');
});
test('OBS stale, wrong-unit, negative or missing RPM never reuse the last speed',async()=>{
 const ui=await overlay(),tile=ui.stage.children[0],center=tile.children[0].children[1],rpm=tile.children[1].children[1];
 for(const reading of [{id:'cpu',unit:'RPM',value:930,fresh:false},{id:'cpu',unit:'%',value:80,fresh:true},{id:'cpu',unit:'RPM',value:-1,fresh:true}]){ui.fixture.sensors=[reading];await ui.poll();assert.equal(center.textContent,'—');assert.equal(rpm.textContent,'—');}
 ui.fixture.sensors=[];await ui.poll();assert.equal(center.textContent,'—');assert.equal(rpm.textContent,'—');
});
test('OBS offline state clears all readings and does not invent fallback values',async()=>{
 const ui=await overlay(),tile=ui.stage.children[0];ui.offline();await ui.poll();assert.equal(tile.children[0].children[1].textContent,'—');assert.equal(tile.children[1].children[1].textContent,'—');assert.match(ui.notice.textContent,/keine aktuellen Messwerte/);
});
