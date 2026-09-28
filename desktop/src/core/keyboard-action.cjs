'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {parseAccelerator}=require('./input-hotkeys.cjs');
function parseLegacyKeys(text){
 let at=0;const result=[];
 const aliases={BACKSPACE:'Back',BS:'Back',BKSP:'Back',DEL:'Delete',INS:'Insert',PGUP:'Prior',PGDN:'Next',ESC:'Escape',ENTER:'Return',RETURN:'Return','+':'Oemplus'};
 function read(inherited=[],group=false){
  while(at<text.length){if(text[at]===')'){if(!group)throw Error('Unpassende schließende Klammer im SendKeys-Text.');at++;return;}
   const mods=[...inherited];while('^%+'.includes(text[at]||'\0')){const m={'^':'Control','%':'Alt','+':'Shift'}[text[at++]];if(!mods.includes(m))mods.push(m);}
   if(at>=text.length)throw Error('Nach einer Zusatztaste fehlt die Haupttaste.');
   if(text[at]==='('){at++;read(mods,true);continue;}
   let key,count=1;if(text[at]==='{'){const end=text.indexOf('}',++at);if(end<0)throw Error('Nicht geschlossene SendKeys-Taste.');const token=text.slice(at,end);at=end+1;const m=token.match(/^(.+?)(?:\s+(\d+))?$/);if(!m)throw Error('Leere SendKeys-Taste.');count=Number(m[2]||1);if(count<1||count>100)throw Error('Maximal 100 Wiederholungen pro Taste.');const raw=aliases[m[1].toUpperCase()]||m[1];try{const parsed=parseAccelerator(raw);if(parsed.keys.length!==1||parsed.modifiers.length)throw Error('Eine einzelne Taste erforderlich.');key=parsed.keys[0];}catch{if(m[1].length===1)key='Unicode'+m[1].charCodeAt(0).toString(16).padStart(4,'0');else throw Error('SendKeys-Taste nicht unterstützt: '+m[1]);}}
   else{const ch=text[at++];if(ch==='~')key='Return';else if(ch===' ')key='Space';else if(/[a-z0-9]/i.test(ch)){key=ch.toUpperCase();if(/[A-Z]/.test(ch)&&!mods.includes('Shift'))mods.push('Shift');}else key='Unicode'+ch.charCodeAt(0).toString(16).padStart(4,'0');}
   for(let n=0;n<count;n++){if(result.length>=200)throw Error('Maximal 200 Tasten in einer SendKeys-Folge.');result.push([...mods,key].join('+'));}
  }
  if(group)throw Error('Nicht geschlossene SendKeys-Gruppe.');
 }
 read();if(!result.length)throw Error('Leere SendKeys-Folge.');return result;
}
function planKeyboardAction(action){
 const target=String(action.process||'').trim().replace(/\.exe$/i,'');
 if(!target||target.length>100||!/^[\p{L}\p{N}_ .-]+$/u.test(target))throw new Error('Gültigen Zielprozess für die Tastatur-/Mausaktion angeben.');
 const text=String(action.keys||'').trim();if(!text||text.length>2048)throw new Error('Eine Tastenkombination eingeben oder aufnehmen.');
 if(action.keyFormat!==undefined&&!['chord','legacy'].includes(action.keyFormat))throw new Error('Unbekanntes Tastenformat.');
 // Unmarked saved actions used SendKeys historically; preserve that meaning.
 const mode=action.keyFormat==='chord'?'chord':'sequence';
 const value=mode==='chord'?parseAccelerator(text).accelerator:JSON.stringify(parseLegacyKeys(text));
 const holdMs=Number(action.holdMs??100);if(!Number.isInteger(holdMs)||holdMs<10||holdMs>3000)throw new Error('Tastendauer: 10 bis 3000 Millisekunden.');
 return {target,mode,value,holdMs};
}
function sendKeyboardAction(action,signal,launch=spawn){
 const plan=planKeyboardAction(action);if(signal?.aborted)return Promise.reject(new Error('Tastaturaktion abgebrochen.'));
 const budget=Math.max(250,Math.min(60000,Number(action.timeoutMs)||5000)),cancelPath=path.join(os.tmpdir(),'batto-input-'+crypto.randomUUID()+'.cancel');
 const executable=path.join(__dirname,'physical-input.exe').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
 return new Promise((resolve,reject)=>{
  let child,timer,killTimer,settled=false,cancellation;
  const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',cancel);try{fs.unlinkSync(cancelPath);}catch{}};
  const finish=error=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve({ok:true,inputSent:true,confirmed:false,keys:plan.value});};
  const cancel=()=>{if(cancellation)return;cancellation=new Error('Tastatur-/Mausaktion abgebrochen.');try{fs.writeFileSync(cancelPath,'cancel');}catch{};killTimer=setTimeout(()=>{child?.kill();finish(cancellation);},500);};
  try{child=launch(executable,['--send',plan.target,String(Date.now()+budget),cancelPath,plan.mode,plan.value,String(plan.holdMs)],{windowsHide:true,stdio:'ignore'});}catch(error){finish(error);return;}
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  timer=setTimeout(cancel,budget);
  child.on('error',finish);child.on('exit',code=>{
   const messages={7:'Zielprogramm ist nicht mehr im Vordergrund.',9:'Tastaturaktion ist abgelaufen.',10:'Windows hat die Eingabe abgelehnt.',11:'Eine zu sendende Taste ist bereits gedrückt. Erst loslassen.',14:'Tastaturaktion abgebrochen.',16:'Ungültige Tastaturaktion.',18:'Kein eindeutiges geöffnetes Zielfenster gefunden.',19:'Mauszeiger zuerst in das Zielfenster bewegen.'};
   finish(cancellation||(code===0?null:new Error(messages[code]||'Tastatur-/Mausaktion fehlgeschlagen.')));
  });
 });
}
module.exports={planKeyboardAction,sendKeyboardAction,parseLegacyKeys};
