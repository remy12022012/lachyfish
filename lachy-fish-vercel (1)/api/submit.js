'use strict';
const { MAX_SAVE, send, readBody, handler, authUser, allow, parseJSON, validateStats } = require('../lib/util');

const MAX_ASC_JUMP = 25; // ascensions gained between two syncs
const FEED_MIN_RAR = 5; // only Mythic and above make the activity feed

module.exports = handler(['POST'], async (req, res, store) => {
  const lname = await authUser(req, store);
  if (!lname) return send(res, 401, { error: 'Please sign in again.' });
  if (!(await allow(store, 'submit:' + lname, 1, 5))) return send(res, 429, { error: 'Syncing too fast. Try again in a few seconds.' });

  const b = await readBody(req);
  const s = validateStats(b);
  if (!s) return send(res, 422, { error: 'Invalid stats.' });

  const [urec, prevRaw] = await Promise.all([store.get('u:' + lname), store.get('p:' + lname)]);
  const user = parseJSON(urec);
  if (!user) return send(res, 401, { error: 'Please sign in again.' });
  const prev = parseJSON(prevRaw);
  if (prev && s.asc > prev.asc + MAX_ASC_JUMP) return send(res, 422, { error: 'Invalid stats.' });

  const now = Date.now();
  const asc = prev ? Math.max(prev.asc, s.asc) : s.asc;
  const p = {
    name: user.name,
    peak: prev ? Math.max(prev.peak, s.coins) : s.coins,
    inc: prev ? Math.max(prev.inc, s.inc) : s.inc,
    asc,
    caught: prev ? Math.max(prev.caught, s.caught) : s.caught,
    book: s.book,
    bestEver: prev ? Math.max(prev.bestEver, s.bestRar) : s.bestRar,
    bestMut: prev ? Math.max(prev.bestMut, s.bestMut) : s.bestMut,
    top: s.top.length ? s.top : (prev ? prev.top : []),
    cps: s.cps,
    pearls: s.pearls,
    created: prev ? prev.created : user.created || now,
    t: now,
  };

  const peakUp = !prev || p.peak > prev.peak;
  const rankBefore = peakUp ? await store.zrevrank('lb:peak', lname) : null;

  const writes = [
    store.set('p:' + lname, JSON.stringify(p)),
    store.zadd('lb:peak', p.peak, lname),
    store.zadd('lb:inc', p.inc, lname),
    store.zadd('lb:asc', p.asc * 1000 + p.book, lname),
    store.zadd('lb:book', p.book * 10000 + p.asc, lname),
  ];
  let saveSkipped = false;
  if (s.save !== null) {
    const o = s.save.length <= MAX_SAVE ? parseJSON(s.save) : null;
    if (o && typeof o === 'object' && o.G && typeof o.G === 'object') writes.push(store.set('sv:' + lname, s.save));
    else saveSkipped = true;
  }
  await Promise.all(writes);

  const [rk, total] = await Promise.all([store.zrevrank('lb:peak', lname), store.zcard('lb:peak')]);

  // Activity feed (best effort: never fails the sync).
  try {
    const ev = [];
    if (prev && p.asc > prev.asc) ev.push({ k: 'asc', v: p.asc, n: p.name, t: now });
    if (prev && p.bestEver > prev.bestEver && p.bestEver >= FEED_MIN_RAR) {
      const m = p.top.length && p.top[0][0] === p.bestEver ? p.top[0][1] : 0;
      ev.push({ k: 'rar', v: p.bestEver, m, n: p.name, t: now });
    }
    if (peakUp && rk === 0 && rankBefore !== 0 && total > 1) ev.push({ k: 'top1', n: p.name, t: now });
    for (const e of ev) await store.lpush('feed', JSON.stringify(e));
    if (ev.length) await store.ltrim('feed', 0, 49);
  } catch (e) { console.error('feed', e); }

  send(res, 200, { ok: true, rank: rk === null ? 0 : rk + 1, total: total || 0, saveSkipped });
});
