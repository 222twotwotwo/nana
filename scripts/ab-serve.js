'use strict';
/**
 * A/B 对比服务：同一个 origin（同端口、同 IndexedDB）下，在「旧版 public/」与
 * 「新版 dist/」之间切换，用于逐页像素比对。
 *
 *   node scripts/ab-serve.js [port] [apiPort]
 *   GET /__ab?to=legacy|vue   切换并返回当前模式
 *
 * 两版都以根路径提供（旧版 index.html 用的是 /style.css 这类绝对路径，
 * 新版 dist 用 ./assets/… 相对路径），因此同一个根就能同时服务两者。
 */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.argv[2] || 8763);
const API = Number(process.argv[3] || 8761);
const ROOT = path.join(__dirname, '..');
const MODES = { legacy: path.join(ROOT, 'public'), vue: path.join(ROOT, 'dist') };

let mode = 'legacy';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8'
};

function proxy(req, res) {
  const upstream = http.request(
    { host: '127.0.0.1', port: API, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${API}` } },
    up => { res.writeHead(up.statusCode, up.headers); up.pipe(res) }
  );
  upstream.on('error', e => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) });
  req.pipe(upstream);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/__ab') {
    const to = url.searchParams.get('to');
    if (to && MODES[to]) mode = to;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ mode }));
  }

  if (url.pathname.startsWith('/api/')) return proxy(req, res);

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const base = MODES[mode];
  const file = path.join(base, rel);
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end('forbidden') }
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      // 禁止缓存：切换模式后必须拿到另一版的资源
      'Cache-Control': 'no-store, must-revalidate'
    });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '文件不存在', mode, rel }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`A/B 对比服务：http://127.0.0.1:${PORT}/  当前=${mode}  API=127.0.0.1:${API}`));
