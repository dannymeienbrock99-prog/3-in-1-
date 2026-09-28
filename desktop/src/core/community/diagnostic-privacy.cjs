'use strict';
const omitted=/^(raw|rawData|payload|body|text|message|comment|lastMessage|last_message|excerpt|args|arguments|parameters|user|username|displayName|reason|target|actor|executor)$/i;
const secret=/token|password|secret|authorization|cookie|apikey|api_key/i;
function diagnosticContext(value,depth=0){
  if(depth>5)return '[Tiefe begrenzt]';
  if(Array.isArray(value))return value.slice(0,50).map(x=>diagnosticContext(x,depth+1));
  if(value&&typeof value==='object'){const result={};for(const [key,item]of Object.entries(value)){if(secret.test(key))result[key]='[geschützt]';else if(!omitted.test(key))result[key]=diagnosticContext(item,depth+1);}return result;}
  return typeof value==='string'?value.slice(0,1000):value;
}
function diagnosticEntry(entry){const category=String(entry.category||'app'),code=String(entry.meta?.code||'APP_LOG');return {level:String(entry.level||'info').toLowerCase(),category,code,message:/Moderation|Chat-Filter/i.test(category)?'Lokales Chatereignis (kein Nachrichtentext im Diagnoseprotokoll).':String(entry.message||'').slice(0,2000),context:diagnosticContext(entry.meta||{})};}
module.exports={diagnosticContext,diagnosticEntry};
