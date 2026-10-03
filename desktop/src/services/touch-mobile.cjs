'use strict';
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const SESSION_MS=8*60*60*1000,ATTEMPT_MS=10*60*1000,MAX_CLIENTS=8;
const privateIp=value=>{const ip=String(value||'').replace(/^::ffff:/,'');return /^(?:127|10)\.(?:\d{1,3}\.){2}\d{1,3}$/.test(ip)||/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)||/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(ip);};
const equals=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const fail=(status,message)=>Object.assign(Error(message),{status});
class TouchMobile{
 constructor({deck,webRoot=path.join(__dirname,'../touch-mobile'),host='0.0.0.0',port=process.env.BATTO_TEST_INSTANCE==='1'?17670:17660,now=Date.now,onChange=()=>{}}){
  Object.assign(this,{deck,webRoot,host,requestedPort:port,now,onChange});this.server=null;this.pin='';this.port=0;this.sessions=new Map();this.attempts=new Map();this.assets=new Map();this.addresses=[];this.pending=null;this.stopping=null;this.qrCodes=[];this.qrEpoch=0;
 }
 prune(){const now=this.now();for(const [token,session]of this.sessions)if(session.expires<=now){this.sessions.delete(token);this.deck.onRemoteDisconnect?.(session.id);}for(const [ip,attempt]of this.attempts)if(attempt.until<=now)this.attempts.delete(ip);}
 status(){this.prune();return {running:!!this.server?.listening,port:this.port||this.requestedPort,urls:this.server?.listening?this.addresses.filter(ip=>ip!=='127.0.0.1'||this.addresses.length===1).map(ip=>`http://${ip}:${this.port}`):[],pin:this.server?.listening?this.pin:'',clients:this.sessions.size,qrCodes:this.server?.listening?this.qrCodes:[]};}
 async updateQr(){
  const epoch=++this.qrEpoch;this.qrCodes=[];if(!this.server?.listening)return;
  const {urls,pin}=this.status(),qr=require('qrcode');
  const codes=await Promise.all(urls.map(async url=>({url,image:await qr.toDataURL(url+'/#pin='+pin,{errorCorrectionLevel:'M',margin:4,width:280,color:{dark:'#000000',light:'#ffffff'}})})));
  if(epoch===this.qrEpoch&&this.server?.listening&&this.pin===pin)this.qrCodes=codes;
 }
 async start(){
  if(this.stopping)await this.stopping;if(this.server?.listening)return this.status();if(this.pending)return this.pending;
  this.pending=(async()=>{
   const addresses=[...new Set(['127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&privateIp(x.address)).map(x=>x.address)])];
   this.addresses=this.host==='0.0.0.0'?addresses:addresses.filter(x=>x===this.host);
   if(!this.addresses.length)throw Error('Bitte eine lokale Netzwerkadresse für das Touch Deck verwenden.');
   const server=http.createServer((req,res)=>{void this.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:'Touch-Deck-Anfrage konnte nicht verarbeitet werden.'}));});});
   server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=3000;server.maxConnections=20;this.server=server;
   try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(this.requestedPort,this.host,()=>{server.removeListener('error',reject);resolve();});});}catch(error){this.server=null;server.close();throw Error(error.code==='EADDRINUSE'?'Der Touch-Deck-Port ist bereits belegt.':error.message);}
   this.port=server.address().port;this.pin=String(crypto.randomInt(0,1000000)).padStart(6,'0');await this.updateQr();this.onChange();return this.status();
  })();try{return await this.pending;}finally{this.pending=null;}
 }
 async stop(){
  if(this.stopping)return this.stopping;
  this.stopping=(async()=>{if(this.pending)try{await this.pending;}catch{}const server=this.server;this.server=null;for(const session of this.sessions.values())this.deck.onRemoteDisconnect?.(session.id);this.sessions.clear();this.attempts.clear();this.assets.clear();this.pin='';this.qrCodes=[];this.qrEpoch++;if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});this.onChange();return this.status();})();
  try{return await this.stopping;}finally{this.stopping=null;}
 }
 async rotatePin(){if(!this.server?.listening)throw Error('Bitte zuerst die Handy-Verbindung einschalten.');this.pin=String(crypto.randomInt(0,1000000)).padStart(6,'0');for(const session of this.sessions.values())this.deck.onRemoteDisconnect?.(session.id);this.sessions.clear();this.attempts.clear();this.qrCodes=[];this.onChange();await this.updateQr();this.onChange();return this.status();}
 guard(req){
  if(!privateIp(req.socket.remoteAddress))throw fail(403,'Diese Verbindung ist nur im lokalen Netzwerk verfügbar.');
  let host;try{host=new URL('http://'+req.headers.host);}catch{throw fail(403,'Ungültige Netzwerkadresse.');}
  if(host.username||host.password||host.pathname!=='/'||host.search||host.hash||!this.addresses.includes(host.hostname)||Number(host.port||80)!==this.port)throw fail(403,'Ungültige Netzwerkadresse.');
  const origin=req.headers.origin;if(origin&&origin!==host.origin)throw fail(403,'Diese Webseite ist nicht berechtigt.');
  if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Diese Webseite ist nicht berechtigt.');
 }
 authorized(req){this.prune();const header=String(req.headers.authorization||'');if(!/^Bearer [a-f0-9]{64}$/.test(header))throw fail(401,'Bitte das Touch Deck erneut koppeln.');const token=header.slice(7),session=this.sessions.get(token);if(!session)throw fail(401,'Bitte das Touch Deck erneut koppeln.');return session;}
 activity(req){const session=this.authorized(req);this.deck.onRemoteActivity?.(session.id,String(req.headers['x-batto-profile']||this.deck.config.activeProfile));return session;}
 async body(req){
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw fail(415,'Die Anfrage muss JSON enthalten.');
  if(Number(req.headers['content-length'])>4096){req.resume();throw fail(413,'Die Anfrage ist zu groß.');}
  let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)throw fail(413,'Die Anfrage ist zu groß.');chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Ungültige Anfrage.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'Ungültige Anfrage.');return value;
 }
 async handle(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'");
  const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
   this.guard(req);const url=new URL(req.url,'http://127.0.0.1');if(url.search)throw fail(404,'Nicht gefunden.');
   const routes={'/':['index.html','text/html; charset=utf-8'],'/client.js':['client.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],'/icon.png':['icon.png','image/png'],'/branding.jpg':['branding.jpg','image/jpeg']};
   if(req.method==='GET'&&Object.hasOwn(routes,url.pathname)){
    const [file,type]=routes[url.pathname];if(!this.assets.has(file)){const filename=path.join(this.webRoot,file);if(!fs.existsSync(filename)||fs.statSync(filename).size>1024*1024)throw fail(503,'Die Handy-Oberfläche fehlt. Bitte die Installation reparieren.');this.assets.set(file,fs.readFileSync(filename));}
    res.writeHead(200,{'Content-Type':type});res.end(this.assets.get(file));return;
   }
   if(req.method==='POST'&&url.pathname==='/api/pair'){
    this.prune();const ip=req.socket.remoteAddress,attempt=this.attempts.get(ip);if(attempt?.count>=5)throw fail(429,'Zu viele PIN-Versuche. Bitte zehn Minuten warten oder am PC eine neue PIN erzeugen.');
    const data=await this.body(req);if(!equals(this.pin,data.pin)){
     if(!attempt&&this.attempts.size>=256)throw fail(429,'Bitte später erneut koppeln.');
     this.attempts.set(ip,{count:(attempt?.count||0)+1,until:attempt?.until||this.now()+ATTEMPT_MS});throw fail(401,'Die PIN stimmt nicht.');
    }
    if(this.sessions.size>=MAX_CLIENTS)throw fail(409,'Es sind bereits acht Geräte gekoppelt. Eine neue PIN trennt die bisherigen Geräte.');
    const token=crypto.randomBytes(32).toString('hex');this.sessions.set(token,{id:crypto.randomUUID(),expires:this.now()+SESSION_MS,presses:[]});this.attempts.delete(ip);this.onChange();reply(200,{token,state:this.deck.remoteState()});return;
   }
   if(req.method==='GET'&&url.pathname==='/api/state'){this.activity(req);reply(200,this.deck.remoteState());return;}
   if(req.method==='GET'&&url.pathname==='/api/readings'){
    this.activity(req);
    // A deleted profile or folder must refresh the layout before audio is read.
    // Otherwise every poll fails on the old path and the phone never recovers.
    if(req.headers['x-batto-revision']!==undefined&&String(this.deck.revision)!==req.headers['x-batto-revision']){reply(200,this.deck.remoteReadings());return;}
    const visualRevision=this.deck.getVisualRevision();let folderPath=[];try{folderPath=JSON.parse(req.headers['x-batto-path']||'[]');}catch{throw fail(400,'Ungültiger Ordner.');}const audio=await this.deck.audioState({profileId:String(req.headers['x-batto-profile']||this.deck.config.activeProfile),path:folderPath});reply(200,{...this.deck.remoteReadings(),volumes:audio.values,visualRevision,...(String(visualRevision)!==req.headers['x-batto-visual-revision']?{visuals:this.deck.getPresentation()}:{})});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/disconnect'){this.authorized(req);const session=this.sessions.get(String(req.headers.authorization).slice(7));this.deck.onRemoteDisconnect?.(session?.id);this.sessions.delete(String(req.headers.authorization).slice(7));this.onChange();reply(200,{ok:true});return;}
   if(req.method==='POST'&&url.pathname==='/api/volume'){
    const session=this.authorized(req),data=await this.body(req),now=this.now();session.volumeChanges=(session.volumeChanges||[]).filter(time=>time>now-1000);if(session.volumeChanges.length>=20)throw fail(429,'Bitte den Regler kurz loslassen.');session.volumeChanges.push(now);
    this.deck.onRemoteActivity?.(session.id,data.profileId);reply(200,await this.deck.volume(data));return;
   }
   if(req.method==='POST'&&url.pathname==='/api/press'){
    const session=this.authorized(req),data=await this.body(req),now=this.now();this.deck.onRemoteActivity?.(session.id,data.profileId);session.presses=session.presses.filter(time=>time>now-1000);if(session.presses.length>=8)throw fail(429,'Bitte die Taste kurz loslassen.');session.presses.push(now);
    if(Object.keys(data).some(key=>!['profileId','path','index','buttonId','baseRevision'].includes(key)))throw fail(400,'Nur vorhandene Tasten können ausgeführt werden.');
    if(typeof data.buttonId!=='string'||!Number.isInteger(data.baseRevision))throw fail(409,'Bitte das Touch Deck neu laden, bevor du eine Taste drückst.');
    reply(200,await this.deck.press(data));return;
   }
   throw fail(404,'Nicht gefunden.');
  }catch(error){reply(error.status||400,{ok:false,message:String(error.message||'Die Taste konnte nicht ausgeführt werden.').slice(0,300)});}
 }
}
module.exports={TouchMobile,privateIp,SESSION_MS};
