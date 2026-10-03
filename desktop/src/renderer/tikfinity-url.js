(function(root,factory){const policy=factory();if(typeof module==='object'&&module.exports)module.exports=policy;else root.BattoTikfinityUrl=policy;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function normalize(value,{allowHttp=false,giftsOnly=false}={}){
  if(typeof value!=='string'||!value.trim()||value.length>4096)return '';
  try{const u=new URL(value.trim());if(!['https:',...(allowHttp?['http:']:[])].includes(u.protocol)||u.username||u.password||u.port)return '';
   const legacy=u.hostname==='tikfinity.zerody.one'&&/^\/widget(?:\/|$)/i.test(u.pathname)&&(!giftsOnly||u.pathname==='/widget/gifts');
   const token=u.hostname==='widgets.tikfinity.com'&&/^\/[A-Za-z0-9_-]{6,128}\/?$/.test(u.pathname);
   if(!legacy&&!token)return '';u.protocol='https:';return u.href;
  }catch{return '';}
 }
 return Object.freeze({normalize,isValid:value=>!!normalize(value),isGifts:value=>!!normalize(value,{giftsOnly:true})});
});
