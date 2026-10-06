'use strict';
/* ================================================================
   墨音 · 服务端 Legado 书源引擎
   支持：class./tag./id. 选择器（含负索引/区间/!排除）、JSONPath、
   ##正则清洗、{{key}}/{{page}}/{{$.f}}/{{@@rule}} 插值、<js> 块、
   @js: 规则（node:vm 沙箱 + SAB 同步 java.ajax）、目录/正文翻页
================================================================ */
const vm = require('vm');
const { JSDOM } = require('jsdom');
const iconv = require('iconv-lite');
const { Worker } = require('worker_threads');

/* ---------------- 同步 HTTP 桥（Atomics + Worker） ---------------- */
const WORKER_CODE = `
const { workerData } = require('worker_threads');
const i32 = new Int32Array(workerData.sab);
const u8  = new Uint8Array(workerData.sab);
const DEC = new TextDecoder();
(async () => {
  for (;;) {
    Atomics.wait(i32, 0, 0);
    let ok = 0, status = 0, n = 0;
    try {
      const task = JSON.parse(DEC.decode(u8.subarray(256, 256 + i32[1])));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), task.timeout || 25000);
      const res = await fetch(task.url, {
        method: task.method || 'GET',
        headers: task.headers || undefined,
        body: (task.body != null && (task.method || 'GET').toUpperCase() !== 'GET') ? task.body : undefined,
        redirect: 'follow',
        signal: ctl.signal
      });
      clearTimeout(timer);
      const buf = new Uint8Array(await res.arrayBuffer());
      n = Math.min(buf.length, u8.length - 512);
      u8.set(buf.subarray(0, n), 512);
      ok = res.ok ? 1 : 0; status = res.status;
    } catch (e) {
      const msg = new TextEncoder().encode(String(e && e.message || e).slice(0, 400));
      u8.set(msg, 512); n = msg.length; status = 0; ok = 0;
    }
    i32[2] = n; i32[3] = status; i32[4] = ok;
    Atomics.store(i32, 0, 0);
    Atomics.notify(i32, 0);
  }
})().catch(() => {});
`;

class SyncHttp {
  constructor() {
    this.sab = new SharedArrayBuffer(24 * 1024 * 1024);
    this.i32 = new Int32Array(this.sab);
    this.u8 = new Uint8Array(this.sab);
    this.worker = new Worker(WORKER_CODE, { eval: true, workerData: { sab: this.sab } });
  }
  raw(url, opt = {}) {
    const task = { url, method: opt.method, headers: opt.headers, body: opt.body, timeout: opt.timeout };
    const tb = Buffer.from(JSON.stringify(task), 'utf8');
    this.u8.set(tb, 256);
    this.i32[1] = tb.length;
    Atomics.store(this.i32, 0, 1);
    Atomics.notify(this.i32, 0);
    Atomics.wait(this.i32, 0, 1);
    const len = this.i32[2], status = this.i32[3], ok = this.i32[4] === 1;
    return { ok, status, bytes: this.u8.slice(512, 512 + len) };
  }
  text(url, opt = {}) {
    const r = this.raw(url, opt);
    const charset = opt.charset || 'utf-8';
    const body = iconv.decode(Buffer.from(r.bytes), /gb/i.test(charset) ? 'gbk' : 'utf8');
    if (r.status >= 400 || (!r.ok && !body.length)) throw new Error('HTTP ' + (r.status || '请求失败'));
    return body;
  }
  destroy() { try { this.worker.terminate(); } catch (e) {} }
}

/* ---------------- 小工具 ---------------- */
function resolveUrl(base, href) {
  href = String(href || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try { return new URL(href, base).href; } catch (e) { return href; }
}
function tryJson(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };
function decodeEntities(s) {
  return String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] || m);
}
function stripTags(h) { return decodeEntities(String(h || '').replace(/<[^>]+>/g, '')).trim(); }
function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|dd|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map(s => s.replace(/\u00a0/g, ' ').trim())
    .filter(s => s && !/^(69书吧|全本小说网|笔趣阁|www\.|请记住|最新章节|天才一秒|一秒记住|无弹窗|小提示|手机阅读|手机用户|推荐本站|加入书签|方便阅读)/i.test(s))
    .join('\n');
}
function parseHdrObj(h) {
  if (!h) return {};
  if (typeof h === 'object') return h;
  try { return JSON.parse(h); } catch (e) { return {}; }
}

/* ---------------- 规则解析核心 ---------------- */
function splitTop(str, sep) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '{' && str[i + 1] === '{') { depth++; cur += '{{'; i++; continue; }
    if (c === '}' && str[i + 1] === '}') { depth--; cur += '}}'; i++; continue; }
    if (depth === 0 && str.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function jsonPath(obj, path) {
  let p = String(path || '').trim().replace(/\.\[\*\]/g, '[*]');
  if (p.startsWith('$.')) p = p.slice(2);
  else if (p.startsWith('$')) p = p.slice(1);
  p = p.replace(/^\./, '');
  let cur = obj;
  if (p === '' || p === '$') return cur;
  if (p === '*') return Array.isArray(obj) ? obj : Object.values(obj || {});
  const re = /([^.\[\]]+)|\[([\*\d]+)\]/g;
  let m;
  while ((m = re.exec(p)) !== null) {
    if (cur == null) return '';
    if (m[1] !== undefined) {
      if (Array.isArray(cur)) {
        cur = cur.map(x => (x && typeof x === 'object') ? x[m[1]] : undefined).filter(v => v !== undefined && v !== null && v !== '');
        if (!cur.length) cur = '';
      } else cur = cur[m[1]];
    } else if (m[2] === '*') {
      cur = Array.isArray(cur) ? cur : Object.values(cur || {});
    } else {
      if (Array.isArray(cur)) cur = cur[+m[2]];
      else return '';
    }
    if (cur === undefined) return '';
  }
  return cur === null ? '' : cur;
}
function parseSeg(seg) {
  let type = 'tag', rest = seg;
  if (seg.startsWith('@css:')) return { type: 'css', name: seg.slice(5).trim(), idx: null, excl: null };
  const m = seg.match(/^(class|tag|id)\./);
  if (m) { type = m[1]; rest = seg.slice(m[0].length); }
  else if (seg.startsWith('-class.')) { type = 'class'; rest = seg.slice(7); }
  else if (seg.startsWith('-tag.')) { type = 'tag'; rest = seg.slice(5); }
  else if (seg.startsWith('-id.')) { type = 'id'; rest = seg.slice(4); }
  else if (seg.startsWith('.')) { type = 'class'; rest = seg.slice(1); }   // .name 简写
  else if (seg.startsWith('#')) { type = 'id'; rest = seg.slice(1); }      // #name 简写
  let excl = null;
  const em = rest.match(/!(\d+(?::\d+)?)$/);
  if (em) { excl = em[1]; rest = rest.slice(0, em.index); }
  // 含空格/>/[ → 整段按 CSS 选择器处理（含后代组合器）
  if (type === 'tag' && /[\s>\[]/.test(rest)) return { type: 'css', name: seg, idx: null, excl: null };
  if (type !== 'tag' && /[\s>\[]/.test(rest)) return { type: 'css', name: seg, idx: null, excl: null };
  const parts = rest.split('.');
  let idx = null;
  const lastp = parts[parts.length - 1];
  if (/^-?\d+(?::-?\d+)?$/.test(lastp)) { idx = lastp; parts.pop(); }
  return { type, name: parts.join('.'), idx, excl };
}
const cssEsc = s => String(s).replace(/(["\\])/g, '\\$1');
function queryAll(els, type, name) {
  const out = [];
  for (const el of els) {
    try {
      if (type === 'css') out.push(...el.querySelectorAll(name));
      else if (type === 'class') out.push(...el.querySelectorAll('[class~="' + cssEsc(name) + '"]'));
      else if (type === 'id') { const n = el.querySelector('#' + cssEsc(name)); if (n) out.push(n); }
      else out.push(...el.querySelectorAll(name.toLowerCase()));
    } catch (e) {}
  }
  return out;
}
function applyIndex(nodes, idx, excl) {
  let arr = nodes;
  if (excl != null) {
    if (excl.includes(':')) {
      const [a, b] = excl.split(':').map(Number);
      arr = arr.filter((_, i) => !(i >= a && (b === undefined || i < b)));
    } else arr = arr.filter((_, i) => i !== +excl);
    if (idx != null) arr = pickIdx(arr, idx);
  } else if (idx != null) arr = pickIdx(arr, idx);
  return arr;
}
function pickIdx(arr, idx) {
  if (idx.includes(':')) {
    const [a, b] = idx.split(':').map(Number);
    return b === undefined ? arr.slice(a) : arr.slice(a, b);
  }
  const i = +idx;
  const v = i < 0 ? arr[arr.length + i] : arr[i];
  return v ? [v] : [];
}
function extractKind(els, kind) {
  if (!els.length) return '';
  switch (kind) {
    case 'text': return els.map(e => (e.textContent || '').trim()).filter(Boolean).join('\n');
    case 'textNodes': case 'ownText':
      return els.map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => (n.textContent || '').trim()).filter(Boolean).join(' ')).filter(Boolean).join('\n');
    case 'html': return els.map(e => e.innerHTML || '').join('\n');
    case 'all': return els.map(e => e.outerHTML || '').join('\n');
    case 'children': return els.map(e => e.innerHTML || '').join('\n');
    default: return els.map(e => e.getAttribute ? (e.getAttribute(kind) || '') : '').filter(Boolean).join('\n');
  }
}

/* ---------------- 引擎主体 ---------------- */
function createEngine({ fetchImpl }) {
  const sync = new SyncHttp();
  const engine = this || {};

  async function fetchText(url, opt = {}) {
    const headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }, opt.headers || {});
    const res = await fetchImpl(url, {
      method: opt.method || 'GET',
      headers,
      body: opt.body != null && (opt.method || 'GET').toUpperCase() !== 'GET' ? opt.body : undefined,
      signal: AbortSignal.timeout(opt.timeout || 22000)
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const charset = opt.charset || 'utf-8';
    const text = iconv.decode(buf, /gb(k|2312|18030)?/i.test(charset) ? 'gbk' : 'utf8');
    if (!res.ok && !text.length) throw new Error('HTTP ' + res.status);
    return text;
  }

  /* ---- JS 沙箱 ---- */
  function makeSandbox(ctx, extra) {
    const java = {
      ajax: (url) => {
        const u = String(url).trim();
        const m = u.match(/,(\{[\s\S]*\})\s*$/);
        let opt = {};
        if (m) { try { opt = JSON.parse(m[1].replace(/'/g, '"')); } catch (e) { try { opt = eval('(' + m[1] + ')'); } catch (e2) {} } url = u.slice(0, m.index); }
        return sync.text(url, { method: opt.method, headers: Object.assign({}, ctx.headers, parseHdrObj(opt.headers)), body: opt.body, charset: opt.charset });
      },
      ajaxAll: (urls) => String(urls).split('&&').map(u => java.ajax(u.trim())),
      get: (url, headers) => ({ body: () => sync.text(url, { headers: Object.assign({}, ctx.headers, parseHdrObj(headers)) }) }),
      post: (url, body, headers) => ({ body: () => sync.text(url, { method: 'POST', body, headers: Object.assign({}, ctx.headers, parseHdrObj(headers)) }) }),
      put: (k, v) => { ctx.vars.set(String(k), v); return v; },
      get: (k) => { const v = ctx.vars.get(String(k)); return v === undefined ? '' : v; },
      getString: (rule) => {
        try {
          const v = evalFieldFull(String(rule), { ...ctx, result: ctx.rawText || '' });
          return v == null ? '' : String(v);
        } catch (e) { return ''; }
      },
      base64Decode: (s) => Buffer.from(String(s || ''), 'base64').toString('utf8'),
      base64Encode: (s) => Buffer.from(String(s || ''), 'utf8').toString('base64'),
      hexDecodeToString: (s) => Buffer.from(String(s || ''), 'hex').toString('utf8'),
      hexDecodeToBytes: (s) => Buffer.from(String(s || ''), 'hex'),
      utf8ToGbk: (s) => iconv.encode(String(s || ''), 'gbk').toString('latin1'),
      gbkEncode: (s) => iconv.encode(String(s || ''), 'gbk').toString('latin1'),
      log: (...a) => console.log('[js]', ...a),
      toast: () => {}, longToast: () => {},
      openUrl: () => {}, startBrowser: () => {},
      startBrowserAwait: () => { throw new Error('该源需要浏览器人机验证，服务器端不支持'); },
      androidId: () => '',
      getContent: () => ctx.contentText || '',
      setContent: (t) => { ctx.contentText = String(t); return t; },
      getElement: () => [],
      timeFormat: (t) => { try { return new Date(t).toLocaleString('zh-CN'); } catch (e) { return ''; } },
      random: () => Math.random(),
    };
    const sandbox = {
      java,
      result: ctx.result != null ? ctx.result : (ctx.rawText || ''),
      baseUrl: ctx.baseUrl || '',
      src: ctx.source.bookSourceUrl,
      book: ctx.book || {},
      chapter: ctx.chapter || {},
      key: ctx.key || '',
      page: ctx.page || 1,
      searchKey: ctx.key || '',
      title: ctx.title || '',
      source: {
        getKey: () => ctx.source.bookSourceUrl,
        bookSourceUrl: ctx.source.bookSourceUrl,
        bookSourceName: ctx.source.bookSourceName,
        loginUrl: ctx.source.loginUrl || '',
        getHeader: () => JSON.stringify(ctx.headers || {}),
      },
      cookie: { getKey: () => '', get: () => '', put: () => {}, removeCookie: () => {} },
      encodeURI, decodeURI, parseInt, parseFloat, isNaN, Buffer,
      console: { log: (...a) => console.log('[js]', ...a) },
    };
    Object.assign(sandbox, extra || {});
    return sandbox;
  }
  function runJs(code, ctx, extra) {
    try {
      const sandbox = makeSandbox(ctx, extra);
      const script = String(code);
      // Legado/Rhino 语义：脚本完成值 = 最后一条语句的值。
      // 顶层执行可直接拿到完成值；仅当脚本使用顶层 return 时才包 IIFE。
      if (/(^|[;\n{}\s])return\b/.test(script)) {
        return vm.runInContext('(function(){\n' + script + '\n})()', vm.createContext(sandbox), { timeout: 40000 });
      }
      return vm.runInContext(script, vm.createContext(sandbox), { timeout: 40000 });
    } catch (e) {
      console.warn('[js:err]', ctx.source && ctx.source.bookSourceName, String(e.message || e).slice(0, 160));
      return '';
    }
  }
  function runJsExpr(expr, ctx, extra) {
    try {
      return vm.runInContext('(function(){return (' + expr + ');})()', vm.createContext(makeSandbox(ctx, extra)), { timeout: 15000 });
    } catch (e) {
      return '';
    }
  }

  /* ---- {{...}} 插值 ---- */
  function interpolate(str, ctx) {
    return String(str).replace(/\{\{([\s\S]*?)\}\}/g, (whole, inner) => {
      inner = inner.trim();
      // {{key}} / {{page}} 留给 buildSearch 专用替换（处理 GBK 等）
      if (inner === 'key' || inner === 'page' || inner === 'searchKey') return whole;
      try {
        if (inner.startsWith('$.') || inner.startsWith('$[')) {
          const v = jsonPath(ctx.json != null ? ctx.json : tryJson(ctx.rawText), inner);
          return v == null ? '' : (Array.isArray(v) ? v.join('\n') : String(v));
        }
        if (inner.startsWith('@@')) {
          return String(evalDomField(inner.slice(1), ctx.els || [], ctx));
        }
        const v = runJsExpr(inner, ctx);
        return v == null ? '' : String(v);
      } catch (e) { return ''; }
    });
  }

  /* ---- DOM 字段求值 ---- */
  function evalDomField(rule, els, ctx) {
    const orParts = splitTop(rule, '||');
    for (const orp of orParts) {
      const andParts = splitTop(orp.trim(), '&&');
      if (!andParts.length) continue;
      const vals = [];
      let okAll = true;
      for (const ap of andParts) {
        const v = evalDomSingle(ap.trim(), els, ctx);
        if (v === '' || v == null) { okAll = false; break; }
        vals.push(v);
      }
      if (okAll && vals.length) return vals.join('\n');
    }
    return '';
  }
  function evalDomSingle(rule, els, ctx) {
    if (!rule) return '';
    // <js>...</js> 前缀
    let m = rule.match(/^<js>([\s\S]*?)<\/js>([\s\S]*)$/);
    if (m) {
      const jsOut = runJs(m[1], ctx);
      const rest = m[2].trim();
      if (!rest) return jsOut == null ? '' : String(jsOut);
      const jr = (jsOut == null ? '' : String(jsOut));
      const j = tryJson(jr);
      if (rest.startsWith('$')) return String(jsonPath(j != null ? j : jr, rest) ?? '');
      const doc = new JSDOM(jr).window.document;
      return evalDomField(rest, [doc.documentElement], { ...ctx, rawText: jr });
    }
    const segs = rule.split('@').map(s => s.trim()).filter(Boolean);
    let cur = els;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const isLast = i === segs.length - 1;
      const looksTag = /^[a-zA-Z][\w-]*(?:!\d+(?::\d+)?)?$/.test(seg);
      const isSelector = /^(class|tag|id)\./.test(seg) || seg.startsWith('#') || seg.startsWith('.')
        || seg === 'children' || !isLast || (isLast && ctx.keepElements && looksTag && !['text','textNodes','ownText','html','all','content'].includes(seg));
      if (isSelector) {
        const p = parseSeg(seg);
        let nodes = seg === 'children' ? cur.flatMap(e => [...e.children]) : queryAll(cur, p.type, p.name);
        nodes = applyIndex(nodes, p.idx, p.excl);
        if (isLast && ctx.keepElements) return nodes;
        cur = nodes;
        if (!cur.length && !isLast) return '';
      } else {
        return extractKind(cur, seg);
      }
    }
    return extractKind(cur, 'text');
  }

  /* ---- 字段总入口 ---- */
  function evalFieldFull(rule, ctx) {
    rule = String(rule == null ? '' : rule).trim();
    if (!rule) return '';
    if (rule.startsWith('@js:')) {
      const v = runJs(rule.slice(4), ctx);
      return v == null ? '' : (Array.isArray(v) ? v.join('\n') : String(v));
    }
    let jsTail = null;
    const jIdx = rule.lastIndexOf('@js:');
    let main = rule;
    if (jIdx > 0) { jsTail = rule.slice(jIdx + 4); main = rule.slice(0, jIdx); }
    let re = null, rep = null;
    const cIdx = main.indexOf('##');
    if (cIdx >= 0) {
      const rest = main.slice(cIdx + 2);
      main = main.slice(0, cIdx);
      const sep = rest.indexOf('##');
      if (sep >= 0) { re = rest.slice(0, sep); rep = rest.slice(sep + 2); }
      else { re = rest; rep = ''; }
    }
    main = main.trim();
    let val;
    // '@attr' 简写：当前元素属性
    const attrM = main.match(/^@([\w-]+)$/);
    if (attrM) {
      val = (ctx.els && ctx.els[0] && ctx.els[0].getAttribute) ? (ctx.els[0].getAttribute(attrM[1]) || '') : '';
    } else if (/\{\{/.test(main)) {
      val = interpolate(main, ctx);
      const hasSelector = /(class\.|tag\.|id\.|^#)/.test(main.replace(/\{\{[\s\S]*?\}\}/g, ''));
      if (!hasSelector && ctx.json == null) {
        // 纯模板字符串（如 bookUrl）直接返回
      } else if (hasSelector && ctx.els && ctx.els.length) {
        val = evalDomField(val, ctx.els, ctx);
      }
    } else if (ctx.json != null && !/(class\.|tag\.|id\.)/.test(main)) {
      val = jsonPath(ctx.json, main);
    } else if (ctx.els && ctx.els.length) {
      val = evalDomField(main, ctx.els, ctx);
    } else {
      val = main;
    }
    if (Array.isArray(val)) val = val.join('\n');
    val = val == null ? '' : String(val);
    if (re != null) {
      try {
        const rx = new RegExp(re, 'g');
        val = rep ? val.replace(rx, rep) : val.replace(rx, '');
      } catch (e) {}
    }
    if (jsTail != null) {
      const v2 = runJs(jsTail, ctx, { result: val });
      val = v2 == null ? '' : (Array.isArray(v2) ? v2.join('\n') : String(v2));
    }
    return val;
  }

  /* ---- 列表求值（bookList / chapterList） ---- */
  function evalListField(rule, ctx) {
    rule = String(rule || '').trim();
    if (!rule) return [];
    if (rule.startsWith('@js:')) {
      const out = runJs(rule.slice(4), ctx);
      return normalizeList(out, ctx);
    }
    const m = rule.match(/^<js>([\s\S]*?)<\/js>([\s\S]*)$/);
    if (m) {
      const jsOut = runJs(m[1], ctx);
      const rest = m[2].trim();
      if (!rest) return normalizeList(jsOut, ctx);
      const jr = String(jsOut == null ? '' : jsOut);
      const j = tryJson(jr);
      const sub = { ...ctx, json: j != null ? j : null, rawText: jr };
      if (rest.startsWith('$')) {
        if (j == null) return [];
        return normalizeList(jsonPath(j, rest), ctx);
      }
      const doc = new JSDOM(jr).window.document;
      return evalListField(rest, { ...sub, els: [doc.documentElement] });
    }
    if (ctx.json != null && !/(class\.|tag\.|id\.)/.test(rule)) {
      return normalizeList(jsonPath(ctx.json, rule), ctx);
    }
    if (ctx.els && ctx.els.length) {
      // 支持 || （取首个非空）与 && （拼接元素列表）
      for (const orp of splitTop(rule, '||')) {
        const andParts = splitTop(orp.trim(), '&&').filter(Boolean);
        if (!andParts.length) continue;
        let collected = [];
        let okAll = true;
        for (const ap of andParts) {
          const nodes = evalDomSingle(ap.trim(), ctx.els, { ...ctx, keepElements: true });
          if (!nodes || !nodes.length) { if (andParts.length > 1) { okAll = false; break; } continue; }
          collected = collected.concat(nodes);
        }
        if (okAll && collected.length) return collected;
      }
      return [];
    }
    return [];
  }
  function normalizeList(out, ctx) {
    if (out == null) return [];
    if (Array.isArray(out)) return out;
    const j = tryJson(out);
    if (j != null) {
      if (Array.isArray(j)) return j;
      if (typeof j === 'object') {
        // 尝试取第一个数组型字段
        for (const k of Object.keys(j)) if (Array.isArray(j[k])) return j[k];
        return [j];
      }
    }
    return [];
  }

  /* ---- 搜索 URL 构建 ---- */
  function encKw(kw, charset) {
    if (/gb/i.test(charset || '')) {
      return iconv.encode(kw, 'gbk').toString('hex').toUpperCase().replace(/../g, '%$&');
    }
    return encodeURIComponent(kw);
  }
  async function buildSearch(def, kw) {
    const ctx = {
      source: def, baseUrl: def.bookSourceUrl, key: kw, page: 1,
      vars: new Map(), headers: parseHdrObj(def.header), book: {}, chapter: {},
    };
    let su = String(def.searchUrl || '').trim();
    if (su.startsWith('@js:')) {
      let out = runJs(su.slice(4), ctx, { key: kw, page: 1 });
      su = String(out || ctx.vars.get('url') || '').trim();
    } else {
      const jm = su.match(/^<js>([\s\S]*?)<\/js>([\s\S]*)$/);
      if (jm) { runJs(jm[1], ctx, { key: kw, page: 1 }); su = jm[2].trim(); }
    }
    if (!su) throw new Error('searchUrl 为空（可能需要浏览器验证）');
    // ,{...} 选项后缀
    let url = su, opts = {};
    const qi = su.indexOf(',{');
    if (qi >= 0) {
      try { opts = JSON.parse(su.slice(qi + 1).replace(/'/g, '"')); } catch (e) { try { opts = eval('(' + su.slice(qi + 1) + ')'); } catch (e2) {} }
      url = su.slice(0, qi).trim();
    }
    const charset = opts.charset || '';
    // 模板替换（URL + body）
    const rep = (s) => interpolate(String(s), { ...ctx, json: null });
    url = rep(url).replace(/\{\{key\}\}/g, encKw(kw, charset)).replace(/\{\{page\}\}/g, '1');
    let body = opts.body ? rep(opts.body).replace(/\{\{key\}\}/g, encKw(kw, charset)).replace(/\{\{page\}\}/g, '1') : undefined;
    url = resolveUrl(def.bookSourceUrl, url);
    const headers = Object.assign({}, ctx.headers, parseHdrObj(opts.headers));
    return { url, opts, headers, body, charset, ctx };
  }

  /* ---- 动作：search ---- */
  engine.search = async function (def, kw) {
    const { url, headers, body, charset, opts } = await buildSearch(def, kw);
    const text = await fetchText(url, { method: opts.method, headers, body, charset });
    const ctx = { source: def, baseUrl: url, key: kw, page: 1, vars: new Map(), headers: parseHdrObj(def.header), rawText: text, book: {}, chapter: {} };
    ctx.json = tryJson(text);
    if (ctx.json == null) {
      const doc = new JSDOM(text).window.document;
      ctx.els = [doc.documentElement];
      ctx.doc = doc;
    }
    const rs = def.ruleSearch || {};
    if (!rs.bookList) throw new Error('书源缺少 ruleSearch.bookList');
    const items = evalListField(rs.bookList, ctx);
    const out = [];
    for (const it of items) {
      const sub = makeSubCtx(ctx, it);
      let name = '', bookUrl = '';
      try { name = String(evalFieldFull(rs.name || '', sub) || '').trim(); } catch (e) {}
      try { bookUrl = String(evalFieldFull(rs.bookUrl || '', sub) || '').trim(); } catch (e) {}
      if (!name || !bookUrl) continue;
      const gv = (r) => { try { const v = evalFieldFull(r, sub); return v == null ? '' : String(v); } catch (e) { return ''; } };
      out.push({
        name, bookUrl: resolveUrl(url, bookUrl),
        author: gv(rs.author), cover: /^https?:/.test(gv(rs.coverUrl)) ? resolveUrl(url, gv(rs.coverUrl)) : '',
        intro: gv(rs.intro).slice(0, 200), kind: gv(rs.kind), wordCount: gv(rs.wordCount),
        srcId: def.bookSourceUrl,
      });
      if (out.length >= 24) break;
    }
    if (!out.length) throw new Error('搜索结果解析为空');
    return out;
  };
  function makeSubCtx(ctx, it) {
    const isEl = it && it.getAttribute;
    return { ...ctx, json: isEl ? null : it, els: isEl ? [it] : null, result: isEl ? (it.textContent || '') : JSON.stringify(it) };
  }

  /* ---- 动作：detail ---- */
  engine.detail = async function (def, bookUrl) {
    const headers = parseHdrObj(def.header);
    const text = await fetchText(bookUrl, { headers });
    const ctx = { source: def, baseUrl: bookUrl, vars: new Map(), headers, rawText: text, book: {}, chapter: {} };
    ctx.json = tryJson(text);
    if (ctx.json == null) {
      const doc = new JSDOM(text).window.document;
      ctx.els = [doc.documentElement]; ctx.doc = doc;
    }
    const rb = def.ruleBookInfo || {};
    if (rb.init) {
      let iv;
      try {
        iv = rb.init.startsWith('@js:')
          ? runJs(rb.init.slice(4), ctx)
          : (ctx.json != null && !/(class\.|tag\.|id\.)/.test(rb.init) ? jsonPath(ctx.json, rb.init) : evalFieldFull(rb.init, ctx));
      } catch (e) {}
      if (iv && typeof iv === 'object') { ctx.json = iv; ctx.els = null; }
      else if (typeof iv === 'string' && iv.trim()) {
        const ij = tryJson(iv);
        if (ij != null && typeof ij === 'object') { ctx.json = ij; ctx.els = null; }
      }
    }
    const gv = (r) => { try { const v = evalFieldFull(r, ctx); return v == null ? '' : String(v); } catch (e) { return ''; } };
    const name = gv(rb.name) || '未知书名';
    let tocUrl = gv(rb.tocUrl) || bookUrl;
    return {
      name: name.trim(),
      author: gv(rb.author).trim(),
      intro: stripTags(gv(rb.intro)).slice(0, 300),
      cover: /^https?:/.test(gv(rb.coverUrl)) ? resolveUrl(bookUrl, gv(rb.coverUrl)) : '',
      kind: gv(rb.kind), lastChapter: gv(rb.lastChapter),
      tocUrl: resolveUrl(bookUrl, tocUrl),
    };
  };

  /* ---- 动作：toc ---- */
  engine.toc = async function (def, tocUrl) {
    const rt = def.ruleToc || {};
    if (!rt.chapterList) throw new Error('书源缺少 ruleToc.chapterList');
    const chapters = [];
    const seen = new Set();
    let url = tocUrl, guard = 0;
    while (url && guard++ < 50) {
      const headers = parseHdrObj(def.header);
      const text = await fetchText(url, { headers });
      const ctx = { source: def, baseUrl: url, vars: new Map(), headers, rawText: text, book: {}, chapter: {} };
      ctx.json = tryJson(text);
      if (ctx.json == null) {
        const doc = new JSDOM(text).window.document;
        ctx.els = [doc.documentElement]; ctx.doc = doc;
      }
      const items = evalListField(rt.chapterList, ctx);
      for (const it of items) {
        const sub = makeSubCtx(ctx, it);
        let t = '', u = '';
        try { t = String(evalFieldFull(rt.chapterName || 'text', sub) || '').trim(); } catch (e) {}
        try { u = String(evalFieldFull(rt.chapterUrl || 'href', sub) || '').trim(); } catch (e) {}
        if (!u) continue;
        u = resolveUrl(url, u);
        const key = t + '|' + u;
        if (seen.has(key)) continue;
        seen.add(key);
        const isV = rt.isVolume ? (() => { try { return evalFieldFull(rt.isVolume, sub) === 'true'; } catch (e) { return false; } })() : false;
        chapters.push({ title: t || '（无标题）', url: u, isVolume: isV });
      }
      if (!rt.nextTocUrl) break;
      let nxt = '';
      try { nxt = String(evalFieldFull(rt.nextTocUrl, ctx) || '').trim(); } catch (e) {}
      nxt = nxt && !nxt.startsWith('#') ? resolveUrl(url, nxt) : '';
      if (!nxt || nxt === url || seen.has('p:' + nxt)) break;
      seen.add('p:' + nxt);
      url = nxt;
    }
    if (!chapters.length) throw new Error('目录解析为空');
    return chapters;
  };

  /* ---- 动作：content ---- */
  engine.content = async function (def, chUrl) {
    const rc = def.ruleContent || {};
    if (!rc.content) throw new Error('书源缺少 ruleContent.content');
    const headers = parseHdrObj(def.header);
    let full = '', url = chUrl, guard = 0;
    const seen = new Set();
    while (url && guard++ < 30 && !seen.has(url)) {
      seen.add(url);
      const text = await fetchText(url, { headers });
      const ctx = { source: def, baseUrl: url, vars: new Map(), headers, rawText: text, book: {}, chapter: { url: chUrl } };
      ctx.json = tryJson(text);
      if (ctx.json == null) {
        const doc = new JSDOM(text).window.document;
        ctx.els = [doc.documentElement]; ctx.doc = doc;
      }
      let raw = evalFieldFull(rc.content, ctx);
      raw = raw == null ? '' : String(raw);
      if (!raw && ctx.els) {
        const main = ctx.doc && (ctx.doc.querySelector('#content') || ctx.doc.querySelector('.content'));
        if (main) raw = main.innerHTML;
      }
      full += (full ? '\n' : '') + raw;
      if (!rc.nextContentUrl) break;
      let nxt = '';
      try { nxt = String(evalFieldFull(rc.nextContentUrl, ctx) || '').trim(); } catch (e) {}
      if (!nxt || nxt.startsWith('#')) break;
      // [text()='下一页'] 型规则 → 返回链接元素
      let nu;
      if (/\[text\(\)/.test(rc.nextContentUrl)) {
        const doc2 = ctx.doc;
        const links = doc2 ? [...doc2.querySelectorAll('a')] : [];
        const hit = links.find(a => /下一[页章]/.test(a.textContent || '') && !/下一[页章]<\/a>\s*<a/.test(''));
        nu = hit ? resolveUrl(url, hit.getAttribute('href') || '') : '';
        if (/下一章/.test(hit ? hit.textContent : '')) { if (nu) full += '\n' + raw; break; }
      } else {
        nu = resolveUrl(url, nxt);
      }
      if (!/^https?:/.test(nu) || nu === url) break;
      url = nu;
    }
    return full;
  };

  /* ---- 漫画图片解析 ---- */
  engine.parseImages = function (raw) {
    const out = [];
    for (const line of String(raw || '').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const m = t.match(/<img[^>]*src=["']([^"']+)["']/i);
      let s = m ? m[1] : t;
      let headers;
      const ci = s.indexOf(',{');
      if (ci > 0) {
        try {
          let h = JSON.parse(s.slice(ci + 1));
          if (typeof h.headers === 'string') h = { headers: JSON.parse(h.headers) };
          headers = h.headers;
        } catch (e) {}
        s = s.slice(0, ci);
      }
      s = s.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
      if (/^https?:\/\//.test(s)) out.push(headers ? { url: s, headers } : { url: s });
    }
    return out;
  };

  engine.htmlToText = htmlToText;
  /* 调试钩子 */
  engine._dbg = { evalListField, evalFieldFull, buildSearch, fetchText, evalDomSingle, jsonPath };
  engine.destroy = () => sync.destroy();
  return engine;
}

module.exports = { createEngine, resolveUrl, tryJson, stripTags, htmlToText, parseHdrObj };
