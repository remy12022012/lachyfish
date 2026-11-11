'use strict';
const { send, handler, authUser, parseJSON } = require('../lib/util');

module.exports = handler(['GET'], async (req, res, store) => {
  const lname = await authUser(req, store);
  if (!lname) return send(res, 401, { error: 'Please sign in again.' });
  const [u, save, rk, total] = await Promise.all([
    store.get('u:' + lname), store.get('sv:' + lname), store.zrevrank('lb:peak', lname), store.zcard('lb:peak'),
  ]);
  const rec = parseJSON(u);
  if (!rec) return send(res, 401, { error: 'Please sign in again.' });
  send(res, 200, { name: rec.name, rank: rk === null ? 0 : rk + 1, total: total || 0, save: save || null });
});
