'use strict';
/**
 * 归因实验：证明 search 页的差异**完全**来自「分类标签行」这一项已知改动。
 *
 * 做法：在 Vue 版搜索页上临时把 #storeTypeSeg 从 DOM 移除（等价于还原旧版布局），
 * 再与旧版搜索页比对。若剩余差异只剩「标题文案」「占位文案」「取消按钮」，
 * 则说明没有其他隐藏的布局差异。
 *
 *   node scripts/experiment-search.js [port]
 */
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');
const { decodePng, compareBuffers } = require('./lib/png');

const PORT = Number(process.argv[2] || 8763);
const BASE = `http://127.0.0.1:${PORT}/`;
const q = s => `document.querySelector('${s}')`;
const outDir = path.resolve('docs/refactor-screens/pixel');

async function boot(mode) {
  await fetch(BASE + '__ab?to=' + mode);
  ab.close();
  await ab.sleep(400);
  await ab.open(BASE, { settle: 1500 });
  ab.evalJs(fixture.installScript());
  ab.batch('open ' + BASE);
  await ab.sleep(3000);
  ab.batch('set viewport 1258 622');
  await ab.sleep(800);
}

(async () => {
  // 旧版搜索页
  await boot('legacy');
  ab.clickExpr(q('#mainSeg button[data-nav=search]'));
  await ab.waitFor(q('#storeKw'));
  await ab.sleep(1200);
  const fLegacy = path.join(outDir, '_srch_legacy.png');
  ab.shot(fLegacy);

  // Vue 搜索页：先原样，再移除分类标签行
  await boot('vue');
  ab.clickExpr(q('#mainSeg button[data-nav=search]'));
  await ab.waitFor(q('#storeKw'));
  await ab.sleep(1200);
  const fVue = path.join(outDir, '_srch_vue.png');
  ab.shot(fVue);

  ab.evalJs(`(${q('#storeTypeSeg')}.remove(), 1)`);
  await ab.sleep(900);
  const fVueNoTabs = path.join(outDir, '_srch_vue_notabs.png');
  ab.shot(fVueNoTabs);

  const geom = ab.evalJs(`JSON.stringify({
    heading: ${q('.home-heading')}.getBoundingClientRect().height.toFixed(2),
    title: ${q('.big-title')}.getBoundingClientRect().y.toFixed(2),
    bar: ${q('#storeBar')}.getBoundingClientRect().y.toFixed(2),
    grid: ${q('#storeGrid')}.getBoundingClientRect().y.toFixed(2)
  })`);
  ab.close();

  const L = decodePng(fs.readFileSync(fLegacy));
  const V = decodePng(fs.readFileSync(fVue));
  const N = decodePng(fs.readFileSync(fVueNoTabs));

  const show = (label, r) => console.log(
    `${label}: ${String(r.diff).padStart(7)} px (${r.pct.toFixed(3)}%)  亮度 ${r.luma}  仅色度 ${r.chroma}`
  );

  console.log('\n=== search 归因实验 ===');
  show('旧版 vs Vue（原样）        ', compareBuffers(L, V));
  show('旧版 vs Vue（移除标签行后）', compareBuffers(L, N));
  console.log(`\n移除标签行后 Vue 几何: ${geom}`);

  // 逐区域归因：把图按 y 分带统计，找出剩余差异落在哪一带
  const bands = [
    ['标题区      y 95-175', { x: 0, y: 95, w: 1258, h: 80 }],
    ['搜索框区    y 175-250', { x: 0, y: 175, w: 1258, h: 75 }],
    ['来源状态区  y 250-278', { x: 0, y: 250, w: 1258, h: 28 }],
    ['空态文字区  y 278-400', { x: 0, y: 278, w: 1258, h: 122 }],
    ['其余        y 400-622', { x: 0, y: 400, w: 1258, h: 222 }]
  ];
  console.log('\n按区域统计（旧版 vs Vue 移除标签行后）：');
  let sum = 0;
  for (const [name, r] of bands) {
    const c = compareBuffers(L, N, r);
    sum += c.diff;
    console.log(`  ${name}: ${String(c.diff).padStart(6)} px  (亮度 ${c.luma} / 色度 ${c.chroma})`);
  }
  const whole = compareBuffers(L, N);
  console.log(`\n全图 ${whole.diff} px，各带合计 ${sum} px`);
  console.log('\n注：标题区差异=「主页→搜索」文案；搜索框区=占位文案变化 + 取消按钮移除导致的输入框加宽。');
  console.log('    其余各带应接近 0，代表布局完全一致。');
})().catch(e => { console.error(e); process.exit(1); });
