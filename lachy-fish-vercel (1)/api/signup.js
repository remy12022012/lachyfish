'use strict';
const { NAME_RE, send, readBody, handler, hashPassword, newSession, clientIp, allow } = require('../lib/util');

module.exports = handler(['POST'], async (req, res, store) => {
  const b = await readBody(req);
  const name = b && typeof b.username === 'string' ? b.username.trim() : '';
  const pw = b && typeof b.password === 'string' ? b.password : '';
  if (!NAME_RE.test(name)) return send(res, 400, { error: 'Username must be 3-16 characters: letters, numbers, _ . -' });
  if (pw.length < 6 || pw.length > 72) return send(res, 400, { error: 'Password must be 6-72 characters.' });
  if (!(await allow(store, 'signup:' + clientIp(req), 10, 3600))) return send(res, 429, { error: 'Too many new accounts from here. Try again later.' });
  const lname = name.toLowerCase();
  const { salt, hash } = await hashPassword(pw);
  const ok = await store.set('u:' + lname, JSON.stringify({ name, salt, hash, created: Date.now() }), { nx: true });
  if (!ok) return send(res, 409, { error: 'That username is taken.' });
  const token = await newSession(store, lname);
  send(res, 200, { token, name });
});
