'use strict';

// First-chat greetings are explicit; presence cannot be inferred from a chat connection.
class WelcomeService {
  constructor({ getConfig, send, onError = () => {}, now = Date.now }) {
    Object.assign(this, { getConfig, send, onError, now });
    this.seen = new Set(); this.lastSent = -Infinity; this.busy = false;
  }
  reset() { this.seen.clear(); this.lastSent = -Infinity; }
  async handle(event) {
    if (event.type === 'stream_start') { this.reset(); return; }
    const cfg = this.getConfig().welcome;
    if (!cfg?.enabled || !cfg.platforms?.includes(event.platform)) return;
    const trigger = cfg.trigger || 'first-chat';
    if (!(trigger === 'first-chat' && event.type === 'chat' || trigger === 'follow' && event.type === 'follow')) return;
    if (/automation|broadcast|mock|fake|test|local|rule-engine|welcome/i.test(event.meta?.sourceConnector || '')) return;
    const user = event.user || {};
    const username = String(user.username || '').trim().toLowerCase();
    if (!username || username === 'unknown' || cfg.ignoreUsers?.map(v=>String(v).trim().replace(/^@/,'').toLowerCase()).includes(username)) return;
    const key = event.platform + ':' + String(user.id || username);
    if (this.seen.has(key)) return;
    // Mark before the asynchronous send to prevent duplicate triggers and self loops.
    // A cooldown drops excess greetings instead of building a backlog during raids.
    if (this.seen.size >= 20000) return;
    this.seen.add(key);
    if (this.busy || this.now()-this.lastSent < Math.max(5, Number(cfg.cooldownSeconds)||15)*1000) return;
    const text = String(cfg.message || '').replace(/\{username\}/g, user.displayName || username).replace(/\{platform\}/g,event.platform).trim();
    if (!text || text.length > 500) return;
    this.busy = true; this.lastSent = this.now();
    try { await this.send(event.platform, text, {source:'broadcast:welcome'}); }
    catch(error) { this.onError(event.platform,error.message); }
    finally { this.busy = false; }
  }
}
module.exports = { WelcomeService };
