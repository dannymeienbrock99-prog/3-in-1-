'use strict';
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const MAX_LINE = 512 * 1024;

async function launchFan({helperPath, pipeName, token, ownerPid, exec = execute, env = process.env}) {
  const powershell = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const launcher = path.join(path.dirname(helperPath), 'fan-control-launch.ps1');
  try {
    const reply = await exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher,
      '-Helper', helperPath, '-OwnerPid', String(ownerPid), '-Pipe', pipeName, '-Token', token],
      {windowsHide:true, timeout:120_000, maxBuffer:32_768, encoding:'utf8'});
    const result = JSON.parse(reply.stdout.replace(/^\uFEFF/, '').trim());
    if (result.launched !== true || !/^\d{16,19}$/.test(result.ownerStartUtcTicks || '')) throw Error('invalid launch');
    return result;
  } catch {
    throw Error('Der PC-Lüfterhelfer konnte nicht mit Administratorrechten gestartet werden. Bitte die Windows-Abfrage bestätigen und die Steuerung erneut einschalten.');
  }
}

// Only the small, authenticated native helper is elevated. Batto and iCUE keep
// their normal identities. Closing this socket triggers the native release.
class ElevatedFanHost {
  constructor({helperPath, timeoutMs=10_000, closeTimeoutMs=4000, onState=()=>{}, onExit=()=>{},
    launch=launchFan, connect=options=>net.createConnection(options), randomBytes=crypto.randomBytes, ownerPid=process.pid,
    now=Date.now, delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    Object.assign(this,{helperPath,timeoutMs,closeTimeoutMs,onState,onExit,launch,connect,randomBytes,ownerPid,now,delay});
    this.socket=null;this.pending=new Map();this.nextId=0;this.buffer='';this.ended=false;this.ready=false;this.closePromise=null;this.starting=true;
  }
  async start() {
    if(this.socket||this.ended) throw Error('Der Lüfterdienst kann nicht erneut verwendet werden.');
    const pipeName='batto-fan-'+this.randomBytes(16).toString('hex'),token=this.randomBytes(32).toString('hex');
    await this.launch({helperPath:this.helperPath,pipeName,token,ownerPid:this.ownerPid});
    const deadline=this.now()+10_000;
    let socket;
    while(!socket) {
      try {
        socket=await new Promise((resolve,reject)=>{
          const candidate=this.connect({path:'\\\\.\\pipe\\'+pipeName});
          const timer=setTimeout(()=>fail(Error('Pipe-Verbindung hat nicht geantwortet.')),500);
          const fail=error=>{clearTimeout(timer);candidate.removeListener('connect',connected);candidate.removeListener('error',fail);candidate.on('error',()=>{});candidate.destroy();reject(error);};
          const connected=()=>{clearTimeout(timer);candidate.removeListener('error',fail);resolve(candidate);};
          candidate.once('error',fail);candidate.once('connect',connected);
        });
      } catch {
        if(this.now()>=deadline) throw Error('Der erhöhte PC-Lüfterhelfer ist nicht erreichbar. Bitte die Windows-Abfrage bestätigen und erneut versuchen.');
        await this.delay(100);
      }
    }
    this.socket=socket;socket.setEncoding('utf8');
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.rejectReady=null;reject(Error('Der PC-Lüfterhelfer hat die Anmeldung nicht bestätigt.'));},10_000);
      this.resolveReady=()=>{clearTimeout(timer);this.rejectReady=null;this.ready=true;this.starting=false;resolve();};
      this.rejectReady=error=>{clearTimeout(timer);this.rejectReady=null;reject(error);};
    });
    socket.on('data',chunk=>this.read(chunk));
    socket.on('error',()=>this.fail(Error('Die Verbindung zum PC-Lüfterdienst wurde unterbrochen.')));
    socket.on('end',()=>this.exit());socket.on('close',()=>this.exit());
    try {socket.write(JSON.stringify({command:'hello',token})+'\n');await ready;}
    catch(error){socket.end();this.fail(error);throw error;}
  }
  read(chunk) {
    this.buffer+=chunk;
    if(this.buffer.length>MAX_LINE){this.fail(Error('Die Antwort des Lüfterdienstes ist zu groß.'));this.socket?.end();return;}
    let end;
    while((end=this.buffer.indexOf('\n'))>=0) {
      const line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);if(!line)continue;
      let value;try{value=JSON.parse(line);}catch{this.fail(Error('Der Lüfterdienst antwortet in einem ungültigen Format.'));this.socket?.end();return;}
      if(this.starting&&value?.event==='ready'){this.resolveReady?.();continue;}
      if(!this.ready){this.fail(Error('Der Lüfterdienst hat die Anmeldung nicht bestätigt.'));this.socket?.end();return;}
      if(value?.type==='state'){try{this.onState(value.state);}catch{this.fail(Error('Der Lüfterdienst meldet einen ungültigen Gerätezustand.'));this.socket?.end();}continue;}
      if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isInteger(value.requestId)||value.requestId<1||value.requestId>2_147_483_647){this.fail(Error('Der Lüfterdienst antwortet in einem ungültigen Format.'));this.socket?.end();return;}
      const job=this.pending.get(value.requestId);if(!job)continue;
      this.pending.delete(value.requestId);clearTimeout(job.timer);
      if(value.ok!==true)job.reject(Error(typeof value.message==='string'?value.message.replace(/[\x00-\x1f\x7f]/g,'').slice(0,500):'Der Lüfterdienst hat die Aktion nicht bestätigt.'));
      else job.resolve(value);
    }
  }
  request(command,value={}) {
    if(!this.socket||!this.ready||this.ended||this.socket.destroyed)return Promise.reject(Error('Der PC-Lüfterdienst ist nicht erreichbar.'));
    const requestId=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('Der PC-Lüfterdienst hat die Aktion nicht rechtzeitig bestätigt.'));},this.timeoutMs);
      this.pending.set(requestId,{resolve,reject,timer});
      try{this.socket.write(JSON.stringify({...value,requestId,command})+'\n');}
      catch{clearTimeout(timer);this.pending.delete(requestId);reject(Error('Die Verbindung zum PC-Lüfterdienst wurde unterbrochen.'));}
    });
  }
  fail(error){this.rejectReady?.(error);for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);}this.pending.clear();}
  exit(){if(this.ended)return;this.ended=true;this.fail(Error('Der PC-Lüfterdienst wurde beendet.'));this.onExit();}
  close(){
    if(!this.socket||this.ended||this.socket.destroyed)return Promise.resolve();
    if(this.closePromise)return this.closePromise;
    this.closePromise=new Promise((resolve,reject)=>{
      const socket=this.socket,finish=()=>{clearTimeout(timer);socket.removeListener('close',finish);resolve();};
      const timer=setTimeout(()=>{socket.removeListener('close',finish);this.closePromise=null;reject(Error('Der eigene PC-Lüfterdienst hat das Beenden nicht bestätigt.'));},this.closeTimeoutMs);
      socket.once('close',finish);socket.end();
    }).catch(error=>{this.closePromise=null;throw error;});
    return this.closePromise;
  }
}
module.exports={ElevatedFanHost,launchFan};
