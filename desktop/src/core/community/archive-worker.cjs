'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
let db;
function open() {
  fs.mkdirSync(path.dirname(workerData.file), { recursive: true });
  db = new DatabaseSync(workerData.file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, platform TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
      session_id TEXT NOT NULL, timestamp TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL,
      text TEXT NOT NULL, identity_verified INTEGER NOT NULL DEFAULT 0, UNIQUE(platform,channel_id,message_id));
    CREATE INDEX IF NOT EXISTS message_time ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS message_identity ON messages(platform,channel_id,user_id,timestamp);
    CREATE INDEX IF NOT EXISTS message_session ON messages(session_id,timestamp);
    CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(text,username,display_name,content='messages',content_rowid='id',tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS message_insert AFTER INSERT ON messages BEGIN INSERT INTO message_search(rowid,text,username,display_name) VALUES(new.id,new.text,new.username,new.display_name); END;
    CREATE TRIGGER IF NOT EXISTS message_delete AFTER DELETE ON messages BEGIN INSERT INTO message_search(message_search,rowid,text,username,display_name) VALUES('delete',old.id,old.text,old.username,old.display_name); END;
    CREATE TABLE IF NOT EXISTS moderation(id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, platform TEXT NOT NULL, channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL, result TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS moderation_identity ON moderation(platform,channel_id,user_id,timestamp);`);
}
function filters(input = {}, prefix = 'm.') {
  const where = [], args = [];
  for (const [key, column] of Object.entries({ platform:'platform', channelId:'channel_id', userId:'user_id', sessionId:'session_id' })) {
    if (input[key] && input[key] !== 'all') { where.push(`${prefix}${column}=?`); args.push(String(input[key]).slice(0,300)); }
  }
  for (const [key, op] of [['from','>='],['to','<=']]) if (input[key]) {
    const date = new Date(input[key]); if (!Number.isFinite(date.getTime())) throw new Error('Ungültiger Datumsfilter.');
    where.push(`${prefix}timestamp${op}?`); args.push(date.toISOString());
  }
  if (input.person) { where.push(`(${prefix}username LIKE ? ESCAPE '\\' OR ${prefix}display_name LIKE ? ESCAPE '\\' OR ${prefix}user_id=?)`); const person=String(input.person).slice(0,100),q='%'+person.replace(/[\\%_]/g,'\\$&')+'%'; args.push(q,q,person); }
  if (input.query) {
    const terms=String(input.query).slice(0,500).trim().split(/\s+/).filter(Boolean).slice(0,30);
    const words=terms.filter(t=>/[\p{L}\p{N}]/u.test(t)),symbols=terms.filter(t=>!/[\p{L}\p{N}]/u.test(t));
    if (words.length) { where.push(`${prefix}id IN (SELECT rowid FROM message_search WHERE message_search MATCH ?)`); args.push(words.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' AND ')); }
    for(const symbol of symbols){where.push(`${prefix}text LIKE ? ESCAPE '\\'`);args.push('%'+symbol.replace(/[\\%_]/g,'\\$&')+'%');}
  }
  return { where:where.length?' WHERE '+where.join(' AND '):'', args };
}
function row(r) { return { id:r.id,platform:r.platform,channelId:r.channel_id,messageId:r.message_id,sessionId:r.session_id,timestamp:r.timestamp,userId:r.user_id,username:r.username,displayName:r.display_name,text:r.text,identityVerified:!!r.identity_verified }; }
function search(input = {}) {
  const {where,args}=filters(input); const limit=Math.max(1,Math.min(500,Number(input.limit)||100)), offset=Math.max(0,Math.min(1000000,Number(input.offset)||0));
  const total=Number(db.prepare('SELECT count(*) AS n FROM messages m'+where).get(...args).n);
  const items=db.prepare('SELECT m.* FROM messages m'+where+' ORDER BY m.timestamp DESC,m.id DESC LIMIT ? OFFSET ?').all(...args,limit,offset).map(row);
  return {ok:true,items,total,limit,offset};
}
function csvCell(value) { let text=String(value??''); if (/^[=+\-@\t\r]/.test(text)) text="'"+text; return '"'+text.replace(/"/g,'""')+'"'; }
function exportRows(input) {
  const format=['json','csv','txt'].includes(input.format)?input.format:'json';
  const {where,args}=filters(input.filters); const handle=fs.openSync(input.file,'w'); let count=0;
  try {
    fs.writeSync(handle, format==='json'?'[\n':format==='csv'?'\uFEFF'+['Zeit','Plattform','Kanal','Nutzer-ID','Name','Nachrichten-ID','Text'].join(';')+'\r\n':'');
    for (const r of db.prepare('SELECT m.* FROM messages m'+where+' ORDER BY m.timestamp,m.id').iterate(...args)) {
      const item=row(r);
      const line=format==='json'?(count?',\n':'')+JSON.stringify(item):format==='csv'?[r.timestamp,r.platform,r.channel_id,r.user_id,r.display_name,r.message_id,r.text].map(csvCell).join(';')+'\r\n':`[${r.timestamp}] ${r.platform} / ${r.channel_id} / ${r.display_name} (${r.user_id}): ${r.text}\r\n`;
      fs.writeSync(handle,line); count++;
    }
    if(format==='json')fs.writeSync(handle,'\n]\n');
  } finally { fs.closeSync(handle); }
  return {ok:true,count,filePath:input.file};
}
function command(method, input = {}) {
  if (method==='append') {
    db.exec('BEGIN'); try {
      const session=db.prepare('INSERT OR IGNORE INTO sessions(id,started_at,label) VALUES(?,?,?)');
      const insert=db.prepare('INSERT OR IGNORE INTO messages(platform,channel_id,message_id,session_id,timestamp,user_id,username,display_name,text,identity_verified) VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const m of input.messages||[]) { session.run(m.sessionId,m.sessionStartedAt,m.sessionLabel); insert.run(m.platform,m.channelId,m.messageId,m.sessionId,m.timestamp,m.userId,m.username,m.displayName,m.text,m.identityVerified?1:0); }
      for (const a of input.moderation||[]) db.prepare('INSERT OR REPLACE INTO moderation(id,timestamp,platform,channel_id,user_id,result,data_json) VALUES(?,?,?,?,?,?,?)').run(a.id,a.timestamp,a.platform,a.channelId,a.userId,a.result,JSON.stringify(a));
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    return {ok:true};
  }
  if(method==='search')return search(input);
  if(method==='sessions')return {ok:true,items:db.prepare('SELECT s.*,count(m.id) AS messages FROM sessions s LEFT JOIN messages m ON m.session_id=s.id GROUP BY s.id ORDER BY s.started_at DESC LIMIT 500').all()};
  if(method==='context') {
    const minutes=Math.max(1,Math.min(60,Number(input.minutes)||5)), time=Date.parse(input.timestamp);
    if(!Number.isFinite(time))throw new Error('Zeitpunkt für den Chatkontext fehlt.');
    const result=search({...input,query:'',person:'',userId:'',from:new Date(time-minutes*60000).toISOString(),to:new Date(time+minutes*60000).toISOString(),limit:500,offset:0});
    result.items.reverse();return {...result,contextStatus:result.total?'recorded':'not_recorded'};
  }
  if(method==='history') {
    const p=[],a=[]; for(const [key,col] of [['platform','platform'],['channelId','channel_id'],['userId','user_id']])if(input[key]&&input[key]!=='all'){p.push(col+'=?');a.push(String(input[key]));}
    return {ok:true,items:db.prepare('SELECT data_json FROM moderation'+(p.length?' WHERE '+p.join(' AND '):'')+' ORDER BY timestamp DESC LIMIT 1000').all(...a).map(r=>JSON.parse(r.data_json))};
  }
  if(method==='retention') { const days=Number(input.days); if(Number.isInteger(days)&&days>0){db.prepare('DELETE FROM messages WHERE timestamp < ?').run(new Date(Date.now()-days*86400000).toISOString());} return {ok:true}; }
  if(method==='endSession'){db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(new Date().toISOString(),String(input.id));return {ok:true};}
  if(method==='export')return exportRows(input);
  if(method==='close'){db.close();return {ok:true};}
  throw new Error('Unbekannte Archivfunktion.');
}
try { open(); parentPort.postMessage({ready:true}); } catch(error) { parentPort.postMessage({ready:false,error:error.message}); }
parentPort.on('message', ({id,method,input})=>{ try { if(!db)throw new Error('Archivdatenbank ist nicht verfügbar.'); parentPort.postMessage({id,result:command(method,input)}); } catch(error){parentPort.postMessage({id,error:error.message});} });
