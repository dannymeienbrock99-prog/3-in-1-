'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const os=require('node:os'),crypto=require('node:crypto');

function parseMouseHotkey(keys){
  const match=String(keys||'').trim().match(/^([a-z0-9])\s*\+\s*(?:rechte\s*maustaste|rechtsklick|rightmouse|rbutton|mouse2)$/i);
  return match?{button:'right',holdKey:match[1].toUpperCase(),keyMode:'tap',keyDelayMs:0}:null;
}

function buildMouseScript(action,deadline,validateOnly=false,cancelPath=''){
  const target=String(action.process||'').trim().replace(/\.exe$/i,'');
  if(!target||target.length>100||!/^[\p{L}\p{N}_ .-]+$/u.test(target))throw new Error('Gültigen Zielprozess angeben, z. B. SonsOfTheForest.');
  if(action.button!=='right')throw new Error('Nicht unterstützte Maustaste.');
  const holdKey=String(action.holdKey||'').trim().toUpperCase();
  if(holdKey&&!/^[A-Z0-9]$/.test(holdKey))throw new Error('Begleittaste muss ein Buchstabe oder eine Ziffer sein.');
  if(action.keyMode&&!['hold','tap'].includes(action.keyMode))throw new Error('Ungültige Tastenfolge.');
  if(action.keyDelayMs!==undefined&&(!Number.isInteger(action.keyDelayMs)||action.keyDelayMs<0||action.keyDelayMs>3000))throw new Error('Pause zwischen Taste und Klick: 0 bis 3000 ms.');
  if(!Number.isSafeInteger(deadline))throw new Error('Ungültige Frist.');
  return `$TargetProcess='${target}'\n$Deadline=${deadline}\n$HoldKey=${holdKey?holdKey.charCodeAt(0):0}\n$CancelPath='${cancelPath.replaceAll("'","''")}'\n$ValidateOnly=$${validateOnly?'true':'false'}\n`+fs.readFileSync(path.join(__dirname,'mouse-action.ps1'),'utf8');
}

function rightClick(action,signal,launch=spawn){
  if(process.platform!=='win32')return Promise.reject(new Error('Mausaktionen sind nur unter Windows verfügbar.'));
  const budget=Math.max(250,Math.min(5000,Number(action.timeoutMs)||5000));
  const cancelPath=path.join(os.tmpdir(),'batto-mouse-'+crypto.randomUUID()+'.cancel');
  const deadline=Date.now()+budget;
  buildMouseScript(action,deadline,false,cancelPath);
  const helper=path.join(__dirname,'mouse-input.exe').replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2');
  const target=String(action.process).trim().replace(/\.exe$/i,''),key=String(action.holdKey||'').trim().toUpperCase();
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('Mausaktion abgebrochen.'));
    const child=launch(helper,[target,String(deadline),String(key?key.charCodeAt(0):0),cancelPath,action.keyMode||'hold',String(action.keyDelayMs??600)],{windowsHide:true});
    let timer,settled=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve({ok:true,button:'right',inputSent:true});};
    // Let the bounded helper release injected keys in finally before exiting.
    const markCancelled=()=>{try{fs.writeFileSync(cancelPath,'cancel');}catch{}};
    const cancel=()=>{markCancelled();finish(new Error('Mausaktion abgebrochen.'));};
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    timer=setTimeout(()=>{markCancelled();finish(new Error('Mausaktion nicht rechtzeitig ausgeführt.'));},budget);
    child.on('error',finish);
    child.on('exit',code=>{try{fs.unlinkSync(cancelPath);}catch{}const messages={7:'Zielprogramm muss im Vordergrund sein.',8:'Mauszeiger muss über dem Zielprogramm stehen.',9:'Mausaktion ist abgelaufen.',10:'Windows hat die Mausaktion nicht vollständig angenommen.',11:'Maustaste oder Zusatztaste ist bereits gedrückt.',14:'Mausaktion abgebrochen.',18:'Kein eindeutiges geöffnetes Spielfenster gefunden.'};finish(code===0?null:new Error(messages[code]||'Mausaktion fehlgeschlagen.'));});
  });
}
module.exports={rightClick,buildMouseScript,parseMouseHotkey};
