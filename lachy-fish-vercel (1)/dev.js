'use strict';
// Local development server that mimics Vercel: serves public/ and routes /api/<name> to api/<name>.js.
// Uses the in-memory store unless UPSTASH_REDIS_REST_URL / _TOKEN (or KV_REST_API_*) are set. Not used on Vercel.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = /^\/api\/([a-z]+)$/.exec(url.pathname);
  if (m) {
    const file = path.join(__dirname, 'api', m[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"Not found."}'); }
    // Vercel pre-parses JSON bodies; mimic that.
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      Object.defineProperty(req, 'body', { configurable: true, get() { if (!raw) return undefined; return JSON.parse(raw); } });
    }
    return require(file)(req, res);
  }
  let p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});

if (require.main === module) server.listen(PORT, () => console.log('Dev server on http://localhost:' + PORT));
module.exports = server;
