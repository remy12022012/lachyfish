'use strict';
const { NAME_RE, send, readBody, handler, checkPassword, newSession, clientIp, allow, parseJSON } = require('../lib/util');

module.exports = handler(['POST'], async (req, res, store) => {
  const b = await readBody(req);
  const name = b && typeof b.username === 'string' ? b.username.trim() : '';
  const pw = b && typeof b.password === 'string' ? b.password : '';
  if (!NAME_RE.test(name) || !pw || pw.length > 72) return send(res, 401, { error: 'Wrong username or password.' });
  const lname = name.toLowerCase();
  const ip = clientIp(req);
  if (!(await allow(store, 'login-ip:' + ip, 60, 600)) || !(await allow(store, 'login:' + lname + ':' + ip, 10, 600))) {
    return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
  }
  const rec = parseJSON(await store.get('u:' + lname));
  const ok = await checkPassword(pw, rec);
  if (!ok) return send(res, 401, { error: 'Wrong username or password.' });
  if (await store.get('ban:' + lname)) return send(res, 403, { error: 'This account has been banned.' });
  const token = await newSession(store, lname);
  send(res, 200, { token, name: rec.name });
});
