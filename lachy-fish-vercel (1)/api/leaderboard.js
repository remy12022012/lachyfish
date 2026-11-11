'use strict';
const { NAME_RE, send, handler, authUser, parseJSON, queryOf } = require('../lib/util');

const VIEWS = ['peak', 'inc', 'asc', 'book'];

function pub(p) {
  return {
    name: p.name, peak: p.peak, inc: p.inc, asc: p.asc, caught: p.caught, book: p.book,
    bestEver: p.bestEver, bestMut: p.bestMut, top: p.top, cps: p.cps, pearls: p.pearls, created: p.created, t: p.t,
  };
}

module.exports = handler(['GET'], async (req, res, store) => {
  const q = queryOf(req);

  // Profile: /api/leaderboard?u=name
  const u = q.get('u');
  if (u !== null) {
    if (!NAME_RE.test(u)) return send(res, 404, { error: 'Not found.' });
    const lname = u.toLowerCase();
    const [raw, rk] = await Promise.all([store.get('p:' + lname), store.zrevrank('lb:peak', lname)]);
    const p = parseJSON(raw);
    if (!p) return send(res, 404, { error: 'Not found.' });
    return send(res, 200, { profile: pub(p), rank: rk === null ? 0 : rk + 1 });
  }

  // List: /api/leaderboard?n=50&feed=1&view=peak
  const view = VIEWS.includes(q.get('view')) ? q.get('view') : 'peak';
  const n = Math.max(1, Math.min(100, parseInt(q.get('n'), 10) || 50));
  const key = 'lb:' + view;
  const me = await authUser(req, store); // optional: a stale token just means anonymous
  const [members, total, myRank, feedRaw] = await Promise.all([
    store.zrevrange(key, 0, n - 1),
    store.zcard(key),
    me ? store.zrevrank(key, me) : null,
    q.get('feed') === '1' ? store.lrange('feed', 0, 19) : null,
  ]);
  const raws = members.length ? await store.mget(members.map((m) => 'p:' + m)) : [];
  const rows = raws.map(parseJSON).filter(Boolean).map(pub);
  const out = { rows, total: total || 0, me: me ? { rank: myRank === null ? 0 : myRank + 1 } : null };
  if (feedRaw) out.feed = feedRaw.map(parseJSON).filter(Boolean);
  send(res, 200, out);
});
