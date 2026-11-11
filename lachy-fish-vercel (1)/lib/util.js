'use strict';
const crypto = require('crypto');
const { getStore } = require('./store');

const NR = 17; // rarities in the client (RAR.length, top tier is Limited Edition); valid index 0..NR-1
const NM = 5; // mutations (Normal, Shiny, Golden, Rainbow, Void)
const MAX_BODY = 1.5 * 1024 * 1024;
const MAX_SAVE = 400000; // characters; larger saves are skipped, stats still sync
const NAME_RE = /^[A-Za-z0-9_.-]{3,16}$/;
const SESSION_TTL = 60 * 60 * 24 * 90;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let b;
  try { b = req.body; } catch (e) { return null; } // Vercel throws on malformed JSON
  if (b !== undefined && b !== null) {
    if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
    try { return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b)); } catch (e) { return null; }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return null;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch (e) { return null; }
}

function handler(methods, fn) {
  return async function (req, res) {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        return send(res, 405, { error: 'Method not allowed.' });
      }
      const store = getStore();
      if (!store) return send(res, 503, { error: 'The server database is not connected yet.' });
      await fn(req, res, store);
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      if (!res.headersSent) send(res, 500, { error: 'Server error. Please try again.' });
    }
  };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((ok, bad) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? bad(e) : ok(k))));
const DUMMY_SALT = Buffer.alloc(16, 7);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt);
  return { salt: salt.toString('hex'), hash: h.toString('hex') };
}
async function checkPassword(pw, rec) {
  if (!rec) { await scrypt(pw, DUMMY_SALT); return false; } // same cost whether or not the user exists
  const h = await scrypt(pw, Buffer.from(rec.salt, 'hex'));
  const want = Buffer.from(rec.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

async function newSession(store, lname) {
  const token = crypto.randomBytes(32).toString('hex');
  // The value carries the login time so an admin "kick" can invalidate every session older than the kick.
  await store.set('s:' + sha(token), lname + '|' + Date.now(), { ex: SESSION_TTL });
  return token;
}
// Returns the lowercase username for a valid Bearer token, else null.
async function authUser(req, store) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer ([0-9a-f]{64})$/.exec(h);
  if (!m) return null;
  const v = await store.get('s:' + sha(m[1]));
  if (!v) return null;
  const parts = String(v).split('|');
  const lname = parts[0], made = +parts[1] || 0; // sessions from before this change count as time 0
  const [kick, ban] = await Promise.all([store.get('kick:' + lname), store.get('ban:' + lname)]);
  if (ban) return null;
  if (kick && +kick >= made) return null;
  return lname;
}

function clientIp(req) {
  const x = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (x || (req.socket && req.socket.remoteAddress) || 'unknown').slice(0, 64);
}
async function allow(store, key, max, windowSec) {
  const k = 'rl:' + key;
  const n = await store.incr(k);
  if (n === 1) await store.expire(k, windowSec);
  return n <= max;
}

function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function queryOf(req) { return new URL(req.url || '/', 'http://x').searchParams; }

// ---- validation of the stats the client submits ----
function num(v, min, max, int) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null;
  if (int && !Number.isInteger(v)) return null;
  return v;
}
function validateStats(b) {
  if (!b || typeof b !== 'object') return null;
  const s = {
    coins: num(b.coins, 0, 1e21, false),
    inc: num(b.inc, 0, 1e20, false),
    asc: num(b.asc, 0, 9999, true),
    caught: num(b.caught, 0, 1e9, true),
    book: num(b.book, 0, NR * 5, true),
    bestRar: num(b.bestRar, 0, NR - 1, true),
    bestMut: num(b.bestMut, 0, NM - 1, true),
    cps: num(b.cps, 0, 1e6, false),
    pearls: num(b.pearls, 0, 1e9, true),
  };
  for (const k in s) if (s[k] === null) return null;
  if (!Array.isArray(b.top) || b.top.length > 6) return null;
  s.top = [];
  for (const f of b.top) {
    if (!Array.isArray(f) || f.length < 3) return null;
    const r = num(f[0], 0, NR - 1, true), m = num(f[1], 0, NM - 1, true), l = num(f[2], 0, 1e4, true);
    if (r === null || m === null || l === null) return null;
    s.top.push([r, m, l]);
  }
  s.save = typeof b.save === 'string' ? b.save : null;
  return s;
}

module.exports = { NR, NM, MAX_SAVE, NAME_RE, send, readBody, handler, hashPassword, checkPassword, newSession, authUser, clientIp, allow, parseJSON, queryOf, validateStats };
