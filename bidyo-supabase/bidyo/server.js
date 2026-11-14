'use strict';
// Tiny static server for Bidyo. All data (users, videos, files) lives in Supabase; this only serves the website
// and hands the PUBLIC Supabase URL + anon key (from .env) to the browser as /config.js.
const http = require('http');
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let val = line.slice(i + 1).trim();
    if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    if (process.env[line.slice(0, i).trim()] === undefined) process.env[line.slice(0, i).trim()] = val;
  }
})();

const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json' };
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob: https://*.supabase.co",
  "media-src 'self' blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }

  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end(`window.BIDYO_CONFIG = ${JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY, MAX_UPLOAD_MB })};`);
  }
  let file = path.normalize(path.join(PUBLIC, pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  let st; try { st = fs.statSync(file); } catch {}
  if (!st || !st.isFile()) {
    if (path.extname(pathname)) { res.writeHead(404); return res.end('Not found'); }
    file = path.join(PUBLIC, 'index.html'); st = fs.statSync(file);
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Bidyo running on http://localhost:${PORT}`);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) console.log('⚠  SUPABASE_URL / SUPABASE_ANON_KEY missing — copy .env.example to .env and fill them in.');
  });
}
module.exports = { server };
