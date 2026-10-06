import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createConnection} from 'node:net';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BridgeError} from './openrgb.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const helper=path.resolve(directory,'../native-lianli/bin/PRISM-LianLi.exe');
const launcher=path.join(directory,'strimer-control-launch.ps1');
const failure=(message,code='WIRELESS_CONTROL_FAILED')=>new BridgeError(message,code,422);

function launchGuard(pipe,token) {
  const powershell=path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve,reject)=>execFile(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',launcher,'-Helper',helper,'-OwnerPid',String(process.pid),'-Pipe',pipe,'-Token',token],{windowsHide:true,timeout:120000,maxBuffer:4096},(error,stdout)=>{
    if(error) return reject(failure('Windows hat die Strimer-Übernahme nicht freigegeben. Bitte die Administratorabfrage bestätigen oder L-Connect selbst schließen.','WIRELESS_CONTROL_DENIED'));
    try {const value=JSON.parse(stdout.trim());if(value.launched!==true||!/^\d{16,19}$/.test(value.ownerStartUtcTicks))throw Error();resolve(value);}catch{reject(failure('Die Strimer-Übergabe konnte nicht gestartet werden.'));}
  }));
}

async function connectGuard(pipe) {
  const deadline=Date.now()+10000;let lastCode=null;
  while(Date.now()<deadline) {
    const socket=await new Promise(resolve=>{
      const value=createConnection(`\\\\.\\pipe\\${pipe}`);
      const fail=error=>{if(error?.code)lastCode=error.code;value.destroy();resolve(null);};value.once('error',fail);
      value.once('connect',()=>{value.off('error',fail);resolve(value);});
      value.setTimeout(500,fail);
    });
    if(socket){socket.setTimeout(0);return socket;}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(lastCode==='EACCES'||lastCode==='EPERM')throw failure('Windows verweigert die Verbindung zum Strimer-Helfer. L-Connect wurde nicht übernommen. Bitte das aktuelle Batto-Update installieren.','WIRELESS_PIPE_DENIED');
  throw failure('Der gestartete Strimer-Helfer antwortet nicht. L-Connect wurde nicht übernommen. Bitte die Windows-Freigabe und den installierten Helfer prüfen.','WIRELESS_PIPE_UNAVAILABLE');
}

/** Explicit, unsaved service lease. Only the elevated guard controls services. */
export class StrimerControl extends EventEmitter {
  constructor({platform=process.platform,available=platform==='win32'&&existsSync(helper)&&existsSync(launcher),launch=launchGuard,connect=connectGuard,readyTimeout=25000,stopTimeout=25000,heartbeatMs=2000}={}) {
    super();Object.assign(this,{available,launch,connect,readyTimeout,stopTimeout,heartbeatMs});
    this.phase='off';this.message='Strimer-Übernahme ist ausgeschaltet.';this.enabled=false;this.socket=null;this.timer=null;this.waiters=new Map();this.serial=Promise.resolve();this.buffer='';
  }
  get status(){return {available:this.available,enabled:this.enabled,phase:this.phase,message:this.message};}
  changed(){this.emit('change',this.status);}
  wait(event,timeout){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiters.delete(event);reject(failure('Die Strimer-Übergabe antwortet nicht rechtzeitig. L-Connect wird wiederhergestellt.','WIRELESS_CONTROL_TIMEOUT'));},timeout);this.waiters.set(event,{resolve,reject,timer});});}
  settle(event,value,error){const pending=this.waiters.get(event);if(!pending)return;this.waiters.delete(event);clearTimeout(pending.timer);error?pending.reject(error):pending.resolve(value);}
  send(op){if(!this.socket||this.socket.destroyed)throw failure('Die Strimer-Übergabe ist nicht verbunden.');this.socket.write(JSON.stringify({op,token:this.token})+'\n');}
  receive(value){
    if(value?.event==='ready'){this.enabled=true;this.phase='active';this.message='Batto steuert Strimer Wireless. Die L-Connect-Dienste sind vorübergehend pausiert.';this.changed();this.settle('ready',value);}
    else if(value?.event==='heartbeat'){this.lastHeartbeat=Date.now();}
    else if(value?.event==='restored'){
      this.enabled=value.ok===true?false:this.enabled;this.phase=value.ok===true?'off':'error';this.message=value.ok===true?'Die ursprünglichen L-Connect-Dienste laufen wieder.':'L-Connect konnte nicht vollständig wieder gestartet werden. Bitte Wiederherstellung erneut versuchen.';
      if(value.ok===true){this.expectedClose=this.socket;this.clearTimer();}this.changed();this.settle('restored',value);this.settle('ready',null,failure(this.message));
    } else if(value?.event==='error'){
      const error=failure(String(value.message||'Die Strimer-Übergabe ist fehlgeschlagen.'),String(value.code||'WIRELESS_CONTROL_FAILED'));
      this.phase='error';this.message=error.message;this.changed();this.settle('ready',null,error);
    } else if(value?.event!=='heartbeat')throw failure('Ungültige Antwort der Strimer-Übergabe.');
  }
  clearTimer(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  beginHeartbeat(socket){this.clearTimer();this.lastHeartbeat=Date.now();this.timer=setInterval(()=>{try{if(Date.now()-this.lastHeartbeat>10000)throw failure('Die Strimer-Übernahme antwortet nicht mehr.');this.send('heartbeat');}catch{socket.destroy();}},this.heartbeatMs);}
  lost(){
    this.clearTimer();this.enabled=false;this.phase='error';this.message='Die Strimer-Übernahme wurde unterbrochen. Der Helfer startet L-Connect wieder; bitte den Dienststatus prüfen.';
    const error=failure(this.message,'WIRELESS_CONTROL_LOST');for(const event of [...this.waiters.keys()])this.settle(event,null,error);this.changed();this.emit('lost',error);
  }
  enqueue(task){const result=this.serial.then(task);this.serial=result.catch(()=>{});return result;}
  start(){return this.enqueue(async()=>{
    if(this.enabled&&this.phase==='active')return this.status;
    if(!this.available)throw failure('Die Strimer-Übergabe benötigt Windows und den mitgelieferten Helfer.','WINDOWS_REQUIRED');
    if(this.socket&&!this.socket.destroyed)await this.finish();
    this.phase='starting';this.message='Windows-Freigabe abwarten. Danach übernimmt Batto die Strimer-Kabel.';this.changed();
    this.token=randomBytes(32).toString('hex');const pipe='batto-strimer-'+randomBytes(16).toString('hex');
    try {
      const launched=await this.launch(pipe,this.token);this.ownerStartUtcTicks=launched?.ownerStartUtcTicks;const socket=await this.connect(pipe);this.socket=socket;this.buffer='';
      socket.setEncoding('utf8');socket.on('error',()=>{});
      socket.on('data',chunk=>{try{this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>16384)throw failure('Ungültige Übergabeantwort.');let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);if(line)this.receive(JSON.parse(line));}}catch{socket.destroy();}});
      socket.once('close',()=>{if(this.socket===socket&&this.expectedClose!==socket&&this.phase!=='off')this.lost();});
      const ready=this.wait('ready',this.readyTimeout);try{this.send('hello');}catch(error){this.settle('ready',null,error);}
      await ready;this.beginHeartbeat(socket);
      return this.status;
    } catch(error){
      if(this.socket&&!this.socket.destroyed)try{await this.finish();}catch{this.socket.destroy();}
      if(!this.enabled)this.clearTimer();this.phase='error';this.message=error.message;this.changed();throw error;
    }
  });}
  async finish(){
    const socket=this.socket;if(!socket||socket.destroyed){this.enabled=false;if(this.phase!=='error'){this.phase='off';this.message='Strimer-Übernahme ist ausgeschaltet.';this.changed();}return this.status;}
    if(this.phase==='off'&&!this.enabled){this.expectedClose=socket;socket.end();return this.status;}
    this.beginHeartbeat(socket);this.phase='restoring';this.message='L-Connect wird wieder gestartet.';this.changed();
    const restored=this.wait('restored',this.stopTimeout);
    try{try{this.send('stop');}catch(error){this.settle('restored',null,error);}const result=await restored;if(result.ok!==true)throw failure(this.message,'WIRELESS_RESTORE_FAILED');return this.status;}
    finally{if(this.phase==='off'){this.clearTimer();this.expectedClose=socket;socket.end();}else if(!socket.destroyed){if(this.phase==='restoring'){this.phase='error';this.message='Die Wiederherstellung von L-Connect ist noch nicht bestätigt.';this.changed();}this.beginHeartbeat(socket);}}
  }
  stop(){return this.enqueue(()=>this.finish());}
}
