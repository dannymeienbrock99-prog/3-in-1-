const { spawn } = require('child_process');
const fs = require('node:fs');

function expand(text, ctx = {}) {
  return String(text ?? '').replace(/\{([\w.]+)\}/g, (_m, key) => {
    const value = key.split('.').reduce((obj, part) => obj?.[part], ctx);
    return value ?? '';
  });
}

function abortError(message = 'Aktion abgebrochen.') {
  const error = new Error(message);
  error.code = 'ACTION_CANCELLED';
  return error;
}

function withTimeout(promise, timeoutMs, label = 'Aktion', signal) {
  const ms = Math.max(250, Number(timeoutMs || 5000));
  let timer;
  let abortHandler;
  const abortPromise = new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) return reject(abortError());
    abortHandler = () => reject(abortError());
    signal.addEventListener('abort', abortHandler, { once: true });
  });
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label}: Timeout nach ${ms} ms`);
        err.code = 'ACTION_TIMEOUT';
        reject(err);
      }, ms);
    }),
    abortPromise
  ]).finally(() => {
    clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
  });
}

function cancellableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

class ActionEngine {
  constructor({ getConfig, sendChat, onTts, onOverlay, onDiscord, onLog, onAudit, onHttp, isLive = () => false }) {
    this.getConfig = getConfig;
    this.isLive = isLive;
    this.sendChat = sendChat;
    this.onTts = onTts;
    this.onOverlay = onOverlay;
    this.onDiscord = onDiscord;
    this.onLog = onLog;
    this.onAudit = onAudit;
    this.onHttp = onHttp;
    this.commandCooldowns = new Map();
    this.commandSeen = new Map();
    this.eventCounters=new Map();
    this.ruleCooldowns = new Map();
    this.activeRuns = new Map();
    this.poolCursor = new Map();
    this.poolLast = new Map();
  }

  normalizedMessage(message) {
    if (message?.schemaVersion && message?.type === 'chat') {
      return {
        platform: message.platform,
        username: message.user?.username || 'Unknown',
        displayName: message.user?.displayName || message.user?.username || 'Unknown',
        userId: message.user?.id || message.user?.userId || '',
        message: message.message?.text || '',
        timestamp: message.timestamp,
        rawEvent: message
      };
    }
    return message || {};
  }

  async handleMessage(input) {
    const message=this.normalizedMessage(input),source=input.meta?.sourceConnector||input.raw?.meta?.sourceConnector||'';
    if(/automation|broadcast|welcome|rule-engine/.test(source)||input.meta?.rawData?.history||input.history)return;
    const user=input.user||{},channel=input.channelId||input.channel||input.meta?.rawData?.channel||'';
    if(user.isBot===true||input.isSelf===true||input.meta?.isBot===true)return;
    const stableMessageId=input.messageId||input.message?.id||input.eventId;
    if(stableMessageId){const id=[message.platform,channel,stableMessageId].join(':');const now=Date.now();if(this.commandSeen.has(id))return;this.commandSeen.set(id,now);if(this.commandSeen.size>20000)for(const [key,at] of this.commandSeen)if(now-at>300000||this.commandSeen.size>20000)this.commandSeen.delete(key);}
    const raw=String(message.message||'').trim(),cfg=this.getConfig();
    for(const cmd of cfg.commands||[]){
      if(cmd.enabled===false)continue;
      const platforms=cmd.platforms?.length?cmd.platforms:[cmd.platform||'all'];
      if(!platforms.includes('all')&&!platforms.includes(message.platform)&&!(platforms.includes('local')&&message.platform==='internal'))continue;
      const prefix=cmd.prefix===undefined?'':cmd.prefix;
      const triggers=[cmd.trigger,...(cmd.aliases||[])].filter(Boolean).map(t=>prefix&&!String(t).startsWith(prefix)?prefix+t:String(t));
      const trigger=triggers.find(t=>(cmd.caseSensitive?raw.startsWith(t):raw.toLowerCase().startsWith(t.toLowerCase()))&&(raw.length===t.length||/\s/.test(raw[t.length])));
      if(!trigger)continue;
      const roles=cmd.roles||['everyone'],u=input.user||{};
      if(!roles.includes('everyone')&&!roles.includes('all')&&!(roles.includes('moderator')&&(u.isModerator===true||u.isBroadcaster===true))&&!(roles.includes('broadcaster')&&u.isBroadcaster===true))continue;
      const key=String(cmd.id||trigger),userKey=[key,message.platform,channel,message.userId||input.userId||u.id||u.userId||message.username].join(':'),now=Date.now();
      if(now<(this.commandCooldowns.get(key)||0)||now<(this.commandCooldowns.get(userKey)||0))continue;
      const global=cmd.globalCooldownSeconds??(cmd.perUserCooldown===false?cmd.cooldownSeconds:0),personal=cmd.userCooldownSeconds??(cmd.perUserCooldown!==false?cmd.cooldownSeconds:0);
      this.commandCooldowns.set(key,now+Math.max(0,Number(global)||0)*1000);this.commandCooldowns.set(userKey,now+Math.max(0,Number(personal)||0)*1000);
      if(this.commandCooldowns.size>30000)for(const [k,v] of this.commandCooldowns)if(v<now)this.commandCooldowns.delete(k);
      await this.executeRule({...cmd,cooldownSeconds:0},{...message,user:message.displayName||message.username,platform:message.platform,channel,eventId:input.eventId,source,command:trigger,args:raw.slice(trigger.length).trim()},'command');
      break;
    }
  }

  eventType(evt) {const t=String(evt?.type || evt?.event || '').toLowerCase();return ['subscribe','subscription'].includes(t)?'sub':t;}
  eventData(evt) {
    if (evt?.schemaVersion) {
      return { ...(evt.data || {}), ...(evt.user || {}), user:evt.user?.displayName || evt.user?.username || 'Unknown', message: evt.message?.text || '', gift: evt.gift || null, giftName: evt.gift?.name, value: evt.gift?.value ?? evt.data?.value, count: evt.gift?.count ?? evt.data?.count, moderation: evt.moderation || null };
    }
    return evt?.data || {};
  }

  eventMatches(rule, evt) {
    if (rule.enabled === false) return false;
    const platform = String(rule.platform || 'all').toLowerCase();
    if (platform !== 'all' && platform !== String(evt.platform || '').toLowerCase()) return false;
    if (this.eventType({type:rule.event || rule.trigger?.event}) !== this.eventType(evt)) return false;
    const data = this.eventData(evt);
    const matchText = String(rule.matchText || rule.trigger?.matchText || '').trim().toLowerCase();
    if (matchText) {
      const haystack = [data.giftName, data.gift?.name, data.name, data.text, data.message, data.nickname, data.uniqueId, data.username, data.user?.username, data.user?.displayName].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(matchText)) return false;
    }
    const minValue = Number(rule.minValue || rule.trigger?.minValue || 0);
    if(rule.giftId&&!String(rule.giftId).split(',').map(x=>x.trim()).includes(String(data.gift?.id)))return false;
    if(Number(rule.maxValue)>0&&Number(data.value??data.gift?.value??data.count)>Number(rule.maxValue))return false;
    if(rule.unit&&rule.unit!==data.unit)return false;
    if(rule.currency&&rule.currency!==data.currency)return false;
    if (minValue > 0) {
      const value = Number(data.value ?? data.gift?.value ?? data.diamondCount ?? data.coins ?? data.amount ?? data.count ?? 0);
      if (value < minValue) return false;
    }
    return true;
  }

  async handleEvent(evt) {
    const cfg = this.getConfig();
    if(evt.type==='stream_start')this.eventCounters.clear();
    for (const rule of cfg.events || []) {
      const data = this.eventData(evt);
      if (!this.eventMatches(rule.counterMode==='sum'?{...rule,minValue:0,trigger:{...rule.trigger,minValue:0}}:rule, evt)) continue;
      if(rule.counterMode==='sum'){
        const key=[rule.id,evt.platform,data.unit,data.currency].join(':');const now=Date.now();let bucket=this.eventCounters.get(key);
        if(!bucket||bucket.until<=now)bucket={value:0,until:now+Math.max(1,Number(rule.resetSeconds)||300)*1000};
        bucket.value+=Number(data.value??data.count??1);this.eventCounters.set(key,bucket);
        if(bucket.value<Math.max(1,Number(rule.minValue)||1))continue;data.value=bucket.value;this.eventCounters.delete(key);
      }

      await this.executeRule(rule, { ...data, data, event: this.eventType(evt), platform: evt.platform || evt.source || 'internal', rawEvent: evt }, 'event');
    }
  }

  async executeRule(rule, ctx, kind) {
    const cfg = this.getConfig();
    if(rule.onlyWhenLive && !this.isLive())return{ok:false,skipped:'not-live'};
    const id = String(rule.id || `${kind}:${rule.trigger || rule.event || 'rule'}`);
    const now = Date.now();
    const cooldownMs = Math.max(0, Number(rule.cooldownSeconds || 0)) * 1000;
    const until = this.ruleCooldowns.get(id) || 0;
    if (now < until) return { ok: false, skipped: 'cooldown' };
    if(rule.chainId&&this.runChain){
      if(cooldownMs>0)this.ruleCooldowns.set(id,now+cooldownMs);else this.ruleCooldowns.delete(id);
      return this.runChain(rule.chainId,{...ctx,kind,ruleId:id});
    }
    if (this.activeRuns.has(id) && rule.allowParallel !== true) return { ok: false, skipped: 'already-running' };
    if (this.activeRuns.size >= Math.max(1, Number(cfg.rules?.maxConcurrentRuns || 25))) return { ok: false, skipped: 'global-concurrency-limit' };

    if(cooldownMs>0)this.ruleCooldowns.set(id, now + cooldownMs);else this.ruleCooldowns.delete(id);
    const controller = new AbortController();
    const runId = `${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const promise = this.execute(rule.actions || [], ctx, {
      failurePolicy: rule.failurePolicy || cfg.rules?.defaultFailurePolicy || 'stop-sequence',
      timeoutMs: rule.timeoutMs || cfg.rules?.defaultTimeoutMs || 5000,
      ruleId: id,
      runId,
      signal: controller.signal
    });
    this.activeRuns.set(id, { promise, controller, runId, startedAt: Date.now() });
    try { return await promise; }
    finally { if (this.activeRuns.get(id)?.runId === runId) this.activeRuns.delete(id); }
  }

  cancel(ruleId) {
    const id = String(ruleId || '');
    const run = this.activeRuns.get(id);
    if (!run) return { ok: false, error: 'Keine laufende Multi-Action für diese Regel.' };
    run.controller.abort();
    return { ok: true, ruleId: id, runId: run.runId };
  }

  cancelAll() {
    const ids = [...this.activeRuns.keys()];
    for (const run of this.activeRuns.values()) run.controller.abort();
    return { ok: true, cancelled: ids };
  }

  active() {
    return [...this.activeRuns.entries()].map(([ruleId, run]) => ({ ruleId, runId: run.runId, startedAt: run.startedAt }));
  }

  resolveMedia(mediaId) { const cfg = this.getConfig(); return (cfg.media || []).find((item) => item.id === mediaId) || null; }
  resolvePool(poolId) {
    const cfg = this.getConfig();
    const pool = (cfg.mediaPools || []).find((item) => item.id === poolId);
    if (!pool) throw new Error('Medien-Pool nicht gefunden.');
    const configured=(pool.mediaIds || []).map(id=>this.resolveMedia(id));
    const available=item=>Boolean(item && (!item.path || fs.existsSync(item.path)));
    if(pool.missingPolicy==='stop' && configured.some(item=>!available(item)))throw new Error('Eine Datei im Medien-Pool fehlt.');
    const media=configured.filter(available);
    if (!media.length) throw new Error(`Medien-Pool "${pool.name || pool.id}" ist leer.`);
    let selected;
    if (['sequence','rotation'].includes(pool.mode || 'random')) {
      const index = this.poolCursor.get(pool.id) || 0;
      selected = media[index % media.length];
      this.poolCursor.set(pool.id, (index + 1) % media.length);
    } else {
      const previous = this.poolLast.get(pool.id);
      const candidates = pool.avoidRepeat && media.length > 1 ? media.filter((item) => item.id !== previous) : media;
      selected = candidates[Math.floor(Math.random() * candidates.length)];
      this.poolLast.set(pool.id, selected.id);
    }
    return { pool, media: selected };
  }

  async execute(actions, ctx = {}, options = {}) {
    const startedAt = Date.now();
    const failurePolicy = options.failurePolicy || 'stop-sequence';
    const timeoutMs = Math.max(250, Number(options.timeoutMs || 5000));
    const signal = options.signal;
    const results = [];
    this.onAudit?.({ phase: 'start', runId: options.runId || null, ruleId: options.ruleId || null, startedAt: new Date(startedAt).toISOString(), context: {source:ctx.source,eventId:ctx.eventId||ctx.rawEvent?.eventId,ruleId:ctx.ruleId,chainId:ctx.chainId,platform:ctx.platform,user:ctx.user||ctx.username} });

    for (const action of actions) {
      if(action.enabled===false)continue;
      this.onAudit?.({phase:'step',runId:options.runId,ruleId:options.ruleId,type:action.type,status:'started'});
      if (signal?.aborted) {
        const error = abortError();
        this.onAudit?.({ phase: 'end', runId: options.runId || null, ruleId: options.ruleId || null, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, result: 'cancelled', error: error.message });
        return { ok: false, cancelled: true, error: error.message, results };
      }
      let attempt = 0;
      let succeeded = false;
      while (!succeeded && attempt < (failurePolicy === 'retry-once' ? 2 : 1)) {
        attempt += 1;
        try {
          const stepController=new AbortController();const cancelStep=()=>stepController.abort();
          signal?.addEventListener('abort',cancelStep,{once:true});let result;
          try{result=await withTimeout(this.executeOne(action,ctx,stepController.signal),action.timeoutMs||timeoutMs,action.type||'Aktion',signal);}
          finally{signal?.removeEventListener('abort',cancelStep);stepController.abort();}

          if(result?.ok===false)throw new Error(result.error || 'Aktion fehlgeschlagen.');
          results.push({ ok: true, type: action.type, result });
          this.onAudit?.({phase:'step',runId:options.runId,ruleId:options.ruleId,type:action.type,status:'completed'});
          succeeded = true;
        } catch (error) {
          if (error.code === 'ACTION_CANCELLED') {
            this.onAudit?.({ phase: 'end', runId: options.runId || null, ruleId: options.ruleId || null, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, result: 'cancelled', error: error.message });
            return { ok: false, cancelled: true, error: error.message, results };
          }
          results.push({ ok: false, type: action.type, error: error.message, code: error.code || 'ACTION_FAILED', attempt });
          this.onLog?.('error', 'Automation', 'ACTION_FAILED', { message: error.message, action, platform: ctx.platform, user: ctx.user || ctx.username, attempt });
          if (attempt < 2 && failurePolicy === 'retry-once') continue;
          if ((action.failurePolicy||failurePolicy) !== 'continue') {
            this.onAudit?.({ phase: 'end', runId: options.runId || null, ruleId: options.ruleId || null, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, result: 'failed', error: error.message });
            return { ok: false, error: error.message, results };
          }
          succeeded = true;
        }
      }
    }
    this.onAudit?.({ phase: 'end', runId: options.runId || null, ruleId: options.ruleId || null, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, result: results.every(x=>x.ok)?'success':'failed' });
    return { ok:results.every(x=>x.ok), results, error:results.some(x=>!x.ok)?'Mindestens eine Aktion ist fehlgeschlagen.':undefined };
  }

  async executeOne(action, ctx, signal) {
    if (signal?.aborted) throw abortError();
    const type = String(action.type || '').toLowerCase();
    if(type==='streamerbot'){if(!this.onStreamerBot)throw new Error('Streamer.bot fehlt.');const args={...ctx};for(const [key,value] of Object.entries(action.args||{}))args[key]=typeof value==='string'?expand(value,ctx):value;return this.onStreamerBot(action.actionId,args,signal,action.timeoutMs||30000,{waitForCompletion:action.waitForCompletion===true});}
    if(['chat-widget','widget','wishlist'].includes(type)){if(!this.onChatWidget)throw new Error('Chat-Widget-Ausgabe fehlt.');return this.onChatWidget({...action,kind:action.kind||(type==='wishlist'?'wishlist':'widget'),context:ctx},signal);}
    if(type==='obs'){if(!this.onObs)throw new Error('OBS fehlt.');return this.onObs(action.request,action.data||{});}
    if (type === 'delay') {
      const ms = Math.max(0, Number(action.ms || Number(action.seconds || 0) * 1000));
      await cancellableDelay(ms, signal);
      return { delayedMs: ms };
    }
    if (type === 'chat') { const platform = action.platform === 'same' || !action.platform ? ctx.platform : action.platform; return this.sendChat?.(platform, expand(action.text, ctx)); }
    if (type === 'tts') {const t=this.getConfig().tts || {};return this.onTts?.({text:expand(action.text || ctx.message || '',ctx),voice:action.voice || t.voice || '',rate:action.rate ?? t.rate ?? 1,pitch:action.pitch ?? t.pitch ?? 1,volume:action.volume ?? t.volume ?? 1,outputDeviceId:action.outputDeviceId || t.outputDeviceId || 'default'});}
    if (type === 'overlay') return this.onOverlay?.({ type: action.eventType || 'custom', data: { ...ctx, visible:action.visible!==false, text: expand(action.text || '', ctx) } },{signal,timeoutMs:action.timeoutMs||30000});
    if (type === 'media') { const media = this.resolveMedia(action.mediaId); if (!media || !fs.existsSync(media.path||'')) throw new Error('Mediendatei nicht gefunden.'); return this.onOverlay?.({ type: 'media', data: { ...ctx, mediaId: media.id, mediaName: media.name, mediaType: media.type, volume: action.volume ?? 1, durationSeconds: action.durationSeconds || 0 } },{signal,timeoutMs:action.timeoutMs||30000}); }
    if (type === 'mediapool' || type === 'media_pool') { const resolved = this.resolvePool(action.poolId); return this.onOverlay?.({ type: 'media', data: { ...ctx, poolId: resolved.pool.id, mediaId: resolved.media.id, mediaName: resolved.media.name, mediaType: resolved.media.type, volume: action.volume ?? resolved.pool.volume ?? 1, durationSeconds: action.durationSeconds || resolved.pool.durationSeconds || 0 } },{signal,timeoutMs:action.timeoutMs||30000}); }
    if(type==='key-action'){const profile=require('./key-action-profiles.cjs').resolveKeyAction(this.getConfig(),action.keyActionId);const result=await this.hotkey({...profile,type:'hotkey',timeoutMs:action.timeoutMs},signal);return {...result,keyActionId:profile.id,keyActionName:profile.name};}
    if (type === 'mouse') return require('./mouse-action.cjs').rightClick(action,signal);
    if (type === 'hotkey') {const mouse=require('./mouse-action.cjs');const combination=!action.keyFormat&&mouse.parseMouseHotkey(action.keys);return combination?mouse.rightClick({...action,...combination},signal):this.hotkey(action,signal);}
    if (type === 'discord') return this.onDiscord?.(expand(action.text || '', ctx));
    if (type === 'http') { if (!this.onHttp) throw new Error('HTTP-Aktionen sind nicht konfiguriert.'); return this.onHttp({ ...action, url: expand(action.url || '', ctx), body: expand(action.body || '', ctx) }, ctx); }
    throw new Error(`Unbekannte Action: ${action.type}`);
  }

  hotkey(action,signal) { return require('./keyboard-action.cjs').sendKeyboardAction(action,signal); }
}

module.exports = { ActionEngine, expand, withTimeout, abortError };
