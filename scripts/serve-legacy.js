'use strict';
/**
 * 开发用静态服务：只服务 public/（旧版前端），并把 /api 反代到主服务。
 * 用途：在同一个后端数据面上并排截图对比「旧版 public/」与「新版 dist/」。
 * 用法：node scripts/serve-legacy.js [port] [apiPort]
 */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.argv[2] || 8762);
const API = Number(process.argv[3] || 8761);
const ROOT = path.join(__dirname, '..', 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg'
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
  if (req.url.startsWith('/api/')) return proxy(req, res);
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('forbidden') }
  try {
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(bytes);
  } catch { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '文件不存在' })) }
}).listen(PORT, '127.0.0.1', () => console.log(`旧版界面（public/）：http://127.0.0.1:${PORT}/  → API 127.0.0.1:${API}`));
