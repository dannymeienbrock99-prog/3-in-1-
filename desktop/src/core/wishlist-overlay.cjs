'use strict';
const fs=require('node:fs'),path=require('node:path');
function wishlistImage(config,key,assetsDir){
 if(typeof key!=='string'||!key.startsWith('file:'))return null;
 const items=config.chatExtras?.wishlist?.items;
 const item=Array.isArray(items)&&items.find(x=>x?.key===key&&x.enabled!==false);
 if(!item||item.url)return null;
 const name=key.slice(5);
 if(!name||name!==path.basename(name)||/[\\/\0:]/.test(name)||!name.toLowerCase().endsWith('.png'))return null;
 try{
  const dir=path.resolve(config.chatExtras.wishlist.folderPath||path.join(assetsDir,'gifts'));
  const file=fs.realpathSync(path.join(dir,name)),base=fs.realpathSync(dir),relative=path.relative(base,file);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!fs.statSync(file).isFile())return null;
  return file;
 }catch{return null;}
}
function httpsAddress(raw){
 try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
// OBS needs display properties, never local folders or account settings.
function wishlistState(config){
 const w=config.chatExtras?.wishlist||{},layout={};
 for(const k of ['enabled','title','caption','width','height','scale','anchor','x','y','durationMs','permanent','fadeInMs','fadeOutMs','queueMode','maxQueue'])if(w[k]!==undefined)layout[k]=w[k];
 const items=[];
 for(const item of Array.isArray(w.items)?w.items:[]){
  if(!item||item.enabled===false||typeof item.key!=='string')continue;
  const url=item.url?httpsAddress(item.url):item.key.startsWith('file:')?'/overlay/wishlist/image?key='+encodeURIComponent(item.key):'';
  if(!url)continue;
  items.push({key:item.key,name:String(item.name||''),sourceType:item.sourceType==='widget'?'widget':'image',giftId:String(item.giftId||''),giftIdVerified:item.giftIdVerified===true,url});
 }
 return {...layout,items};
}
// Local previews carry their definition; public OBS notifications only need identity and timing.
function overlayWidgetTrigger(payload={}){
 const result={};
 for(const key of ['kind','id','widgetId','visible','durationMs','triggerId','timestamp','preview'])if(payload[key]!==undefined)result[key]=payload[key];
 return result;
}
function registerWishlistRoutes(app,{configStore,assetsDir}){
 const renderer=path.join(__dirname,'../renderer');
 app.get('/overlay/wishlist',(_req,res)=>res.type('html').sendFile(path.join(renderer,'wishlist-overlay.html')));
 app.get('/overlay/wishlist/client.js',(_req,res)=>res.type('application/javascript').sendFile(path.join(renderer,'wishlist-overlay.js')));
 app.get('/overlay/wishlist/style.css',(_req,res)=>res.type('text/css').sendFile(path.join(renderer,'chat-extras-ui.css')));
 app.get('/api/wishlist',(_req,res)=>res.json(wishlistState(configStore.get())));
 app.get('/overlay/wishlist/image',(req,res)=>{
  const file=wishlistImage(configStore.get(),req.query.key,assetsDir);
  if(!file)return res.sendStatus(404);
  res.type('image/png').sendFile(file);
 });
}
module.exports={registerWishlistRoutes,wishlistState,wishlistImage,overlayWidgetTrigger};
