'use strict';
/**
 * DOM 结构比对：像素比对只能发现「看得见」的差异，
 * 这里把两版每个页面的元素树（标签 + id + class + 文本）序列化后对比，
 * 用来发现不影响像素但确实存在的结构差异（缺元素、多元素、文案不同）。
 *
 *   node scripts/dom-diff.js [--port=8763] [--out=docs/refactor-screens/dom]
 */
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const PORT = Number(arg('port', 8763));
const OUT = arg('out', 'docs/refactor-screens/dom');
const BASE = `http://127.0.0.1:${PORT}/`;
const W = 1258, H = 622;
const outDir = path.resolve(OUT);
fs.mkdirSync(outDir, { recursive: true });

const q = s => `document.querySelector('${s}')`;
const qa = s => `document.querySelectorAll('${s}')`;
const popItem = t => `[...${qa('.pop button')}].find(b=>b.textContent.includes('${t}'))`;

/** 序列化某个容器：每行一个节点，形如 `tag#id.class 文本` */
const DUMP = sel => `(() => {
  const root = ${q(sel)};
  if (!root) return '';
  const out = [];
  const walk = (el, depth) => {
    if (depth > 12) return;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).filter(Boolean).join('.') : '';
    // 只取直接文本节点，避免把子元素文本重复计入。
    // 注意：多个文本节点要**直接拼接**（不加分隔符）——Vue 会把
    // 「…继续。<template v-if>正文按需缓存。</template>」渲染成两个相邻文本节点，
    // 若用空格连接会造出「继续。 正文」这种假差异。
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join('');
    const extra = tag === 'input' || tag === 'textarea' || tag === 'select'
      ? ' [' + (el.getAttribute('placeholder') || el.value || '') + ']' : '';
    out.push('  '.repeat(depth) + tag + id + cls + (own ? ' :: ' + own : '') + extra);
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out.join('\\n');
})()`;

const PAGES = [
  ['home', [[q('#mainSeg button[data-nav=home]'), null]], '#page-home'],
  ['library', [[q('#mainSeg button[data-nav=library]'), q('#bookGrid .catalog-card')]], '#page-library'],
  ['search', [[q('#mainSeg button[data-nav=search]'), q('#storeKw')]], '#page-home'],
  ['popmenu', [[q('#btnMore'), q('.pop')]], '.pop'],
  ['settings', [[q('#btnMore'), q('.pop')], [popItem('设置'), q('#sourceHealth')]], '#settingsBox'],
  ['cine', [[q('#btnMore'), q('.pop')], [popItem('情境配乐'), q('#cineBox')]], '#cineBox'],
  ['music', [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=music]')],
    [q('#libraryTypeSeg button[data-ctype=music]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    [q('#smRead'), `${q('#page-music')} && !${q('#page-music')}.classList.contains('hidden')`]
  ], '#page-music'],
  ['reader', [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
    [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    [q('#smRead'), `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`]
  ], '#page-reader'],
  // 阅读悬浮菜单：旧版是点开时才构建 #rdMenu 内容，必须先点 #fabBar 再比对
  ['reader-menu', [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
    [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    [q('#smRead'), `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`],
    [q('#fabBar'), `${q('#rdMenu')} && !${q('#rdMenu')}.classList.contains('hidden')`]
  ], '#rdMenu'],
  ['modal', [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
    [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`]
  ], '#storeModal']
];

async function runPage(steps) {
  for (const [clickSel, waitExpr] of steps) {
    if (!await ab.waitFor(clickSel)) throw new Error(`未找到 ${clickSel}`);
    ab.clickExpr(clickSel);
    if (waitExpr && !await ab.waitFor(waitExpr)) throw new Error(`点击后未满足 ${waitExpr}`);
    await ab.sleep(600);
  }
  await ab.sleep(800);
}

async function capture(mode) {
  await fetch(BASE + '__ab?to=' + mode);
  ab.close();
  await ab.sleep(400);
  await ab.open(BASE, { width: W, height: H, settle: 1500 });
  ab.evalJs(fixture.installScript());
  ab.batch('open ' + BASE);
  await ab.sleep(3000);
  ab.batch(`set viewport ${W} ${H}`);
  await ab.sleep(700);

  const result = {};
  for (const [name, steps, sel] of PAGES) {
    try {
      if (!await ab.waitFor(q('#mainSeg button[data-nav=home]'))) throw new Error('主页导航缺失');
      ab.clickExpr(q('#mainSeg button[data-nav=home]'));
      await ab.sleep(600);
      await runPage(steps);
      // eval 返回的是 JS 字符串字面量，去掉外层引号并还原转义
      const raw = ab.evalJs(DUMP(sel));
      let text = raw;
      try { text = JSON.parse(raw); } catch { /* 非 JSON 时原样使用 */ }
      result[name] = text;
      fs.writeFileSync(path.join(outDir, `${name}.${mode}.txt`), text);
    } catch (e) {
      console.log(`  !! ${mode}/${name}: ${e.message}`);
    }
  }
  return result;
}

/**
 * 逐行对比。只归一化**内部**空白（连续空格/换行压成一个空格），
 * 保留行首缩进——缩进代表嵌套层级，抹掉就会漏掉「元素被挂到错误父级」这类差异。
 */
function norm(s) {
  const m = /^(\s*)(.*)$/.exec(s);
  return m[1] + m[2].replace(/\s+/g, ' ').trim();
}
function diffLines(a, b) {
  const la = a.split('\n').map(norm).filter(l => l.trim());
  const lb = b.split('\n').map(norm).filter(l => l.trim());
  const setB = new Set(lb), setA = new Set(la);
  const onlyA = la.filter(l => !setB.has(l));
  const onlyB = lb.filter(l => !setA.has(l));
  return { onlyA, onlyB };
}

(async () => {
  const legacy = {}, vue = {};
  for (const [mode, sink] of [['legacy', legacy], ['vue', vue]]) {
    console.log(`\n采集 ${mode} …`);
    Object.assign(sink, await capture(mode));
  }
  ab.close();

  console.log('\n=== DOM 结构比对（同源 · 同数据）===');
  for (const [name] of PAGES) {
    const a = legacy[name], b = vue[name];
    if (a == null || b == null) { console.log(`\n【${name}】缺少数据`); continue; }
    if (a === b) { console.log(`\n【${name}】结构完全一致`); continue; }
    const { onlyA, onlyB } = diffLines(a, b);
    console.log(`\n【${name}】旧版独有 ${onlyA.length} 行 / 新版独有 ${onlyB.length} 行`);
    if (onlyA.length) { console.log('  ── 仅旧版有：'); onlyA.slice(0, 25).forEach(l => console.log('    ' + l.trim())); }
    if (onlyB.length) { console.log('  ── 仅新版有：'); onlyB.slice(0, 25).forEach(l => console.log('    ' + l.trim())); }
  }
})().catch(e => { console.error(e); process.exit(1); });
