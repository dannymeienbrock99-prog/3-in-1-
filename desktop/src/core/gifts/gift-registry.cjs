'use strict';
const fs = require('fs');
const path = require('path');

const MAX_ROWS = 10000;
const MAX_ALIASES = 30;
const CONNECTORS = new Set(['tikfinity', 'streamerbot', 'streamerbot-support']);
const PUBLIC_CATALOG_URL = 'https://www.eulerstream.com/tools/tiktok-gifts-calculator';

function giftId(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const id = String(value).trim();
  if (!/^\d{1,20}$/.test(id)) return '';
  const integer = BigInt(id);
  return integer > 0n && integer <= 18446744073709551615n ? String(integer) : '';
}
function cleanName(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256) : '';
}
function normalizeName(value) {
  return cleanName(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function cleanCoins(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
function normalizeRow(row, defaultSource = '') {
  if (!row || typeof row !== 'object') return null;
  const id = giftId(row.giftId), name = cleanName(row.name), source = cleanName(row.source || defaultSource);
  if (!id || !name || !normalizeName(name) || !source) return null;
  const names = [...new Set([name, ...(Array.isArray(row.names) ? row.names : [])].map(cleanName).filter(Boolean))].slice(0, MAX_ALIASES);
  return { giftId:id, name, names, coins:cleanCoins(row.coins), imageUrl:imageUrl(row.imageUrl), source,
    ...(row.observedAt && !Number.isNaN(Date.parse(row.observedAt)) ? { observedAt:new Date(row.observedAt).toISOString() } : {}) };
}
// Test markers can be attached to the connector wrapper or its raw data. They
// are inspected without ever copying viewer or message data into the catalogue.
function simulated(event) {
  const pending = [{ value:event, depth:0 }], seen = new Set();
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:is)?(?:test|mock|synthetic|simulated|dryrun|preview|automation)$/i.test(key) && (child === true || child === 1 || child === 'true')) return true;
      if (/^(?:source|sourceConnector|sourceType|origin|provider|mode|eventId|id)$/i.test(key) && typeof child === 'string' && /(?:^|[:\s/_-])(?:test|mock|synthetic|simulated|dryrun|preview|automation)(?:$|[:\s/_-])/i.test(child)) return true;
      if (depth < 5 && ['meta', 'rawData', 'raw', 'data', 'sourceMetadata', 'metadata'].includes(key)) pending.push({value:child, depth:depth + 1});
    }
  }
  return false;
}

class GiftRegistry {
  constructor({ dataDir, bundledFile, onChange = () => {}, fetchImpl = globalThis.fetch } = {}) {
    if (!dataDir) throw new Error('Geschenkkatalog: Datenordner fehlt.');
    this.file = path.join(dataDir, 'gift-registry.json');
    this.catalogFile = path.join(dataDir, 'gift-catalog-cache.json');
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.bundled = new Map();
    this.catalog = new Map();
    this.observed = new Map();
    this.error = '';
    this.dirty = false;
    this.closed = false;
    this.load(bundledFile, this.bundled, false);
    this.load(this.file, this.observed, true);
    this.load(this.catalogFile, this.catalog, false);
    for (const [id,row] of this.catalog) if (row.source !== PUBLIC_CATALOG_URL) this.catalog.delete(id);
  }
  load(file, target, observedOnly) {
    if (!file || !fs.existsSync(file)) return;
    try {
      if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('Geschenkkatalog ist zu groß.');
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = Array.isArray(content) ? content : content.items || content.gifts;
      if (!Array.isArray(rows)) throw new Error('Geschenkkatalog hat ein ungültiges Format.');
      for (const input of rows.slice(0, MAX_ROWS)) {
        const row = normalizeRow(input);
        if (row && (!observedOnly || CONNECTORS.has(row.source))) this.merge(target, row);
      }
    } catch (error) { this.error = error.message; }
  }
  merge(target, row) {
    const before = target.get(row.giftId);
    if (before) row = { ...before, ...row, names:[...new Set([...before.names, ...row.names])].slice(0, MAX_ALIASES), coins:row.coins ?? before.coins, imageUrl:row.imageUrl || before.imageUrl };
    if (!before && target.size >= MAX_ROWS) return false;
    target.set(row.giftId, row);
    return true;
  }
  rows() {
    const rows = new Map(this.bundled);
    for (const row of this.catalog.values()) this.merge(rows, row);
    for (const row of this.observed.values()) this.merge(rows, row);
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'de') || a.giftId.localeCompare(b.giftId));
  }
  observe(event) {
    if (this.closed || event?.schemaVersion !== 1 || event.platform !== 'tiktok' || event.type !== 'gift' || !event.eventId || !CONNECTORS.has(event.meta?.sourceConnector) || simulated(event)) return false;
    const row = normalizeRow({ giftId:event.gift?.id, name:event.gift?.name, coins:event.gift?.coins, imageUrl:event.gift?.imageUrl,
      source:event.meta.sourceConnector, observedAt:new Date().toISOString() });
    if (!row || !this.merge(this.observed, row)) return false;
    this.dirty = true;
    // Coalesce gift streaks but bound the first write to 250 ms.
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250); this.timer.unref?.(); }
    try { this.onChange(this.status()); } catch {}
    return true;
  }
  status() { return { bundled:this.bundled.size, catalog:this.catalog.size, observed:this.observed.size, source:PUBLIC_CATALOG_URL, updating:Boolean(this.refreshing), error:this.error }; }
  list({ query = '', limit = 500, offset = 0 } = {}) {
    const filter = normalizeName(query);
    const rows = this.rows().filter(row => !filter || row.giftId.includes(String(query).trim()) || row.names.some(name => normalizeName(name).includes(filter)));
    const start = Math.max(0, Math.min(MAX_ROWS, Math.trunc(Number(offset) || 0)));
    const count = Math.max(0, Math.min(3000, Math.trunc(Number(limit) || 0)));
    return { ok:true, items:rows.slice(start, start + count).map(row => ({...row,names:[...row.names]})), total:rows.length, status:this.status() };
  }
  match(name) {
    const normalized = normalizeName(name);
    const candidates = normalized ? this.rows().filter(row => row.names.some(alias => normalizeName(alias) === normalized)) : [];
    return { status:candidates.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : 'unmatched', match:candidates.length === 1 ? candidates[0] : null, candidates };
  }
  matchLibrary(items) {
    const rows = this.rows(), byId = new Map(rows.map(row => [row.giftId, row]));
    const byName = new Map();
    for (const row of rows) for (const name of new Set(row.names.map(normalizeName))) { const list=byName.get(name)||[];list.push(row);byName.set(name,list); }
    return (Array.isArray(items) ? items : []).map(item => {
      const explicit = item.giftId !== null && item.giftId !== undefined && item.giftId !== '';
      const candidates = explicit ? [] : byName.get(normalizeName(item.name)) || [];
      const row = explicit ? byId.get(giftId(item.giftId)) : candidates.length === 1 ? candidates[0] : null;
      const status = row ? 'matched' : candidates.length ? 'ambiguous' : 'unmatched';
      const {giftCandidates, ...cleanItem} = item;
      return { ...cleanItem, giftId:row?.giftId || (explicit ? giftId(item.giftId) || String(item.giftId) : null), coins:row?.coins ?? null, giftIdVerified:Boolean(row), verificationSource:row?.source || '', verificationStatus:status,
        ...(status === 'ambiguous' ? { giftCandidates:candidates.map(candidate => ({giftId:candidate.giftId,name:candidate.name,coins:candidate.coins,source:candidate.source})) } : {}) };
    });
  }
  async refreshCatalog() {
    if (this.closed) return {...this.list(),ok:false,error:'Geschenkkatalog ist geschlossen.'};
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.fetchCatalog();
    try { return await this.refreshing; } finally { this.refreshing=null; }
  }
  async fetchCatalog() {
    const controller = new AbortController();
    this.refreshController=controller;
    const timer = setTimeout(() => controller.abort(), 10000); timer.unref?.();
    try {
      if (typeof this.fetchImpl !== 'function') throw new Error('Katalogabruf ist nicht verfügbar.');
      const response = await this.fetchImpl(PUBLIC_CATALOG_URL, {signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:'text/html'}});
      if (!response.ok) throw new Error('Katalogserver antwortet mit HTTP ' + response.status + '.');
      if (Number(response.headers?.get?.('content-length')) > 5 * 1024 * 1024) throw new Error('Katalogantwort ist zu groß.');
      if (!response.body?.getReader) throw new Error('Katalogantwort konnte nicht sicher gelesen werden.');
      const reader = response.body.getReader(), chunks=[];let size=0;
      try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5*1024*1024)throw new Error('Katalogantwort ist zu groß.');chunks.push(Buffer.from(value)); } }
      finally { try { await reader.cancel(); } catch {} }
      if (this.closed) throw new Error('Katalogabruf wurde beendet.');
      const { parsePublicCatalog } = require('./public-catalog-parser.cjs');
      const inputs = parsePublicCatalog(Buffer.concat(chunks).toString('utf8'));
      const rows = new Map();
      for (const input of inputs) { const row=normalizeRow({...input,source:PUBLIC_CATALOG_URL});if(!row)throw new Error('Katalog enthält einen ungültigen Geschenkdatensatz.');this.merge(rows,row); }
      if (rows.size < 100 || rows.size > MAX_ROWS || rows.size < this.catalog.size * 0.75) throw new Error('Katalogantwort ist unvollständig; der bisherige Katalog bleibt erhalten.');
      fs.mkdirSync(path.dirname(this.catalogFile), {recursive:true});
      const temp=this.catalogFile+'.tmp-'+process.pid;
      try { fs.writeFileSync(temp,JSON.stringify({version:1,fetchedAt:new Date().toISOString(),items:[...rows.values()]}),'utf8');fs.renameSync(temp,this.catalogFile); }
      catch(error) { try {fs.unlinkSync(temp);}catch{} throw error; }
      this.catalog=rows;this.error='';
      try {this.onChange(this.status());}catch{}
      return {...this.list({limit:3000}),ok:true,updated:true};
    } catch(error) {
      this.error='Geschenkkatalog konnte nicht aktualisiert werden: '+(error.name==='AbortError'?'Zeitüberschreitung.':error.message);
      try {this.onChange(this.status());}catch{}
      return {...this.list({limit:3000}),ok:false,error:this.error,updated:false};
    } finally { clearTimeout(timer);this.refreshController=null; }
  }
  flush() {
    if (!this.dirty) return !this.error;
    const temp = this.file + '.tmp-' + process.pid;
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive:true});
      fs.writeFileSync(temp, JSON.stringify({version:1,items:[...this.observed.values()]}, null, 2), 'utf8');
      fs.renameSync(temp, this.file);
      this.dirty = false;
      this.error = '';
      return true;
    } catch (error) {
      this.error = 'Geschenkkatalog konnte nicht gespeichert werden: ' + error.message;
      try { fs.unlinkSync(temp); } catch {}
      try { this.onChange(this.status()); } catch {}
      return false;
    }
  }
  close() { clearTimeout(this.timer); this.timer = null; this.closed = true;this.refreshController?.abort(); return this.flush(); }
}

module.exports = { GiftRegistry, giftId, normalizeName, simulated, PUBLIC_CATALOG_URL };
