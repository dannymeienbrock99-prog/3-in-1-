'use strict';
const {spawn}=require('node:child_process'),{EventEmitter}=require('node:events'),readline=require('node:readline');
class NativeClient extends EventEmitter {
 constructor(executable,root,options={}){super();this.executable=executable;this.root=root;this.options=options;this.pending=new Map();this.sequence=0;}
 async open(){
  if(this.process)throw Error('Video-Dienst läuft bereits.');
  return new Promise((resolve,reject)=>{
   let ready=false;const child=spawn(this.executable,[this.root],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,...this.options.env}});this.process=child;
   const timeout=setTimeout(()=>{reject(Error('Video-Dienst antwortet nicht.'));child.kill();},20000);
   const input=readline.createInterface({input:child.stdout});
   input.on('line',line=>{if(!line.startsWith('BATTO_JSON:'))return;let message;try{message=JSON.parse(line.slice(11));}catch{return;}
    if(Object.hasOwn(message,'ready')){clearTimeout(timeout);if(message.ready){ready=true;resolve();}else{reject(Error(message.error||'Video-Dienst konnte nicht starten.'));child.kill();}return;}
    const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);message.ok?pending.resolve(message.result):pending.reject(Error(message.error||'Video-Aktion fehlgeschlagen.'));
   });
   child.stderr.on('data',()=>{}); // Do not expose native logs, device identifiers or keys.
   child.stdin.on('error',()=>{}); // A write callback rejects its request; EPIPE must not crash Electron.
   let finished=false;
   const finish=error=>{if(finished)return;finished=true;clearTimeout(timeout);input.close();if(this.process===child)this.process=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Video-Dienst wurde beendet.'));}this.pending.clear();if(!ready)reject(error||Error('Video-Dienst wurde beim Start beendet.'));this.emit('exit');};
   // Spawn failures emit error/close without exit. Clear the dead handle there
   // as well, otherwise every retry incorrectly reuses a non-running process.
   child.on('error',()=>finish(Error('Video-Dienst konnte nicht gestartet werden.')));
   child.on('exit',()=>finish());
  });
 }
 request(command,fields={}){if(!this.process?.stdin.writable)return Promise.reject(Error('Video-Dienst ist ausgeschaltet.'));const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Video-Aktion hat zu lange gedauert.'));this.process?.kill();},15000);this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({...fields,id,command})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('Video-Dienst nicht erreichbar.'));}});});}
 async close(){const child=this.process;if(!child)return;try{await this.request('quit');}catch{}child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve();},7000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
module.exports={NativeClient};
