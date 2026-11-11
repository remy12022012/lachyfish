'use strict';
// Storage layer. Production uses Upstash Redis (the Vercel Marketplace "Upstash for Redis" / KV integration).
// Everything is stored as plain strings; callers JSON.stringify/parse themselves.
// An in-memory store is used ONLY for local development (never on Vercel, where it would silently lose data).

class MemoryStore {
  constructor() { this.kv = new Map(); this.exp = new Map(); this.z = new Map(); this.l = new Map(); }
  _alive(k) {
    const e = this.exp.get(k);
    if (e && e <= Date.now()) { this.kv.delete(k); this.exp.delete(k); return false; }
    return this.kv.has(k);
  }
  async get(k) { return this._alive(k) ? this.kv.get(k) : null; }
  async set(k, v, o) {
    o = o || {};
    if (o.nx && this._alive(k)) return null;
    this.kv.set(k, String(v));
    if (o.ex) this.exp.set(k, Date.now() + o.ex * 1000); else this.exp.delete(k);
    return 'OK';
  }
  async del(k) { this.kv.delete(k); this.exp.delete(k); }
  async incr(k) { const v = (this._alive(k) ? +this.kv.get(k) : 0) + 1; this.kv.set(k, String(v)); return v; }
  async expire(k, s) { this.exp.set(k, Date.now() + s * 1000); }
  async mget(keys) { return Promise.all(keys.map((k) => this.get(k))); }
  _zs(k) { if (!this.z.has(k)) this.z.set(k, new Map()); return this.z.get(k); }
  async zadd(k, score, member) { this._zs(k).set(member, score); }
  _sorted(k) {
    return [...this._zs(k).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map((e) => e[0]);
  }
  async zrevrank(k, m) { const i = this._sorted(k).indexOf(m); return i < 0 ? null : i; }
  async zrem(k, m) { this._zs(k).delete(m); }
  async zcard(k) { return this._zs(k).size; }
  async zrevrange(k, a, b) { return this._sorted(k).slice(a, b + 1); }
  async lpush(k, v) { const l = this.l.get(k) || []; l.unshift(String(v)); this.l.set(k, l); }
  async ltrim(k, a, b) { const l = this.l.get(k) || []; this.l.set(k, l.slice(a, b + 1)); }
  async lrange(k, a, b) { return (this.l.get(k) || []).slice(a, b + 1); }
}

class UpstashStore {
  constructor(url, token) {
    const { Redis } = require('@upstash/redis');
    // automaticDeserialization:false keeps JSON strings (like the save blob) as strings.
    this.r = new Redis({ url, token, automaticDeserialization: false });
  }
  get(k) { return this.r.get(k); }
  set(k, v, o) {
    o = o || {};
    const a = {};
    if (o.nx) a.nx = true;
    if (o.ex) a.ex = o.ex;
    return this.r.set(k, String(v), a);
  }
  del(k) { return this.r.del(k); }
  incr(k) { return this.r.incr(k); }
  expire(k, s) { return this.r.expire(k, s); }
  mget(keys) { return keys.length ? this.r.mget(...keys) : Promise.resolve([]); }
  zadd(k, score, member) { return this.r.zadd(k, { score, member }); }
  zrevrank(k, m) { return this.r.zrevrank(k, m); }
  zrem(k, m) { return this.r.zrem(k, m); }
  zcard(k) { return this.r.zcard(k); }
  zrevrange(k, a, b) { return this.r.zrange(k, a, b, { rev: true }); }
  lpush(k, v) { return this.r.lpush(k, String(v)); }
  ltrim(k, a, b) { return this.r.ltrim(k, a, b); }
  lrange(k, a, b) { return this.r.lrange(k, a, b); }
}

let cached = null;
function getStore() {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) cached = new UpstashStore(url, token);
  else if (!process.env.VERCEL || process.env.ALLOW_MEMORY_STORE === '1') cached = new MemoryStore();
  return cached; // null on Vercel without a database: the API answers 503 with a clear message
}

module.exports = { getStore, MemoryStore, UpstashStore };
