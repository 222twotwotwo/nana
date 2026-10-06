'use strict';
/* 全量探活：两合集所有源跑 search→detail→toc→content 链路，写 probe.json */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('./engine');

async function fetchImpl(url, opt = {}) { return fetch(url, opt); }
const engine = createEngine({ fetchImpl });

function load(file) {
  const t = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/,\s*([\]}])/g, '$1');
  const d = JSON.parse(t);
  return Array.isArray(d) ? d : (d.data || []);
}
const NOVEL = load('shuyuan_novel.json');
const COMIC = load('shuyuan_comic.json');

async function withTimeout(p, ms) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('超时 ' + ms + 'ms')), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

async function probeOne(cat, def) {
  const name = def.bookSourceName;
  const out = { name, url: def.bookSourceUrl, ok: false, err: '', stage: '' };
  const t0 = Date.now();
  try {
    const kw = (def.checkKeyWord && String(def.checkKeyWord).slice(0, 12)) || '剑';
    out.stage = 'search';
    const items = await withTimeout(engine.search(def, kw), 30000);
    out.books = items.length;
    if (!items.length) throw new Error('搜索 0 结果');
    out.first = items[0].name;
    out.stage = 'detail';
    const det = await withTimeout(engine.detail(def, items[0].bookUrl), 30000);
    out.detailName = det.name;
    const tocUrl = det.tocUrl || items[0].bookUrl;
    out.stage = 'toc';
    const chs = await withTimeout(engine.toc(def, tocUrl), 60000);
    out.chapters = chs.length;
    if (!chs.length) throw new Error('目录 0 章');
    out.stage = 'content';
    const raw = await withTimeout(engine.content(def, chs[0].url), 30000);
    if (cat === 'comic') {
      const imgs = engine.parseImages(raw);
      out.images = imgs.length;
      if (!imgs.length) throw new Error('正文 0 图');
    } else {
      const text = require('./engine').htmlToText(raw);
      out.textLen = text.length;
      if (text.length < 80) throw new Error('正文过短 ' + text.length);
    }
    out.ok = true;
  } catch (e) {
    out.err = String(e.message || e).slice(0, 120);
  }
  out.ms = Date.now() - t0;
  return out;
}

(async () => {
  const result = {};
  const tasks = [];
  const pushAll = (arr, cat) => arr.forEach((def, i) => tasks.push({ cat, i, def }));
  pushAll(NOVEL, 'novel');
  pushAll(COMIC, 'comic');
  const CONC = 4;
  let done = 0;
  const queue = tasks.slice();
  const worker = async () => {
    while (queue.length) {
      const { cat, i, def } = queue.shift();
      const r = await probeOne(cat, def);
      result[cat + ':' + i] = r;
      done++;
      console.log(`[${done}/${tasks.length}] ${cat}:${i} ${r.name} → ${r.ok ? 'OK' : 'FAIL(' + r.stage + ': ' + r.err + ')'}`);
      fs.writeFileSync(path.join(__dirname, 'probe.json'), JSON.stringify(result, null, 1));
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  const okN = Object.values(result).filter(r => r.ok).length;
  console.log(`=== 完成：${okN}/${tasks.length} 可用 ===`);
  engine.destroy();
  process.exit(0);
})();
