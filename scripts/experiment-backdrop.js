'use strict';
/**
 * 受控实验（修正版）：确认 reader 页「文字位置相同但像素不同」的成因。
 *
 * 关键坑：App.vue 始终渲染全部页面（用 .hidden 切换），因此
 * `.float-back` 在 DOM 里有 3 个（番剧/阅读/音乐），document.querySelector('.float-back')
 * 取到的是**番剧页**那个，改了也看不出变化。必须用 `#page-reader .float-back` 限定。
 *
 * 步骤（全部在 Vue 版、同数据同视口下自比）：
 *   A 正常
 *   B 隐藏 #page-reader .float-back      → 差异应≈悬浮键面积
 *   C 再去掉 #fabBar 的 backdrop-filter  → 若文字像素随之改变，则证实合成层效应
 *   D C 与「旧版截图」对比               → 若正文差异大幅下降，则成因确认
 *
 *   node scripts/experiment-backdrop.js [port]
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

const STEPS = [
  [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
  [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
  [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
  [q('#smRead'), `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`]
];

/** 去掉引号：agent-browser 的 eval 返回 JSON 字符串字面量 */
const unq = s => String(s).replace(/^"|"$/g, '');

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
  for (const [sel, wait] of STEPS) {
    if (!await ab.waitFor(sel)) throw new Error('未找到 ' + sel);
    ab.clickExpr(sel);
    if (wait) await ab.waitFor(wait);
    await ab.sleep(600);
  }
  await ab.sleep(1000);
}

(async () => {
  // ── 旧版基准
  await boot('legacy');
  const fLegacy = path.join(outDir, '_expLegacy.png');
  ab.shot(fLegacy);

  // ── Vue：A/B/C
  await boot('vue');
  const fA = path.join(outDir, '_expA.png');
  ab.shot(fA);
  const visA = unq(ab.evalJs(`(getComputedStyle(${q('#page-reader .float-back')}).display)`));

  ab.evalJs(`(${q('#page-reader .float-back')}.style.setProperty('display','none','important'), 1)`);
  await ab.sleep(900);
  const visB = unq(ab.evalJs(`(getComputedStyle(${q('#page-reader .float-back')}).display)`));
  const fB = path.join(outDir, '_expB.png');
  ab.shot(fB);

  ab.evalJs(`(${q('#fabBar')}.style.setProperty('backdrop-filter','none','important'), ${q('#fabBar')}.style.setProperty('-webkit-backdrop-filter','none','important'), 1)`);
  await ab.sleep(900);
  const bfC = unq(ab.evalJs(`(getComputedStyle(${q('#fabBar')}).backdropFilter)`));
  const fC = path.join(outDir, '_expC.png');
  ab.shot(fC);
  ab.close();

  console.log('\n=== 前置检查（确认改动真的生效）===');
  console.log(`  #page-reader .float-back  display: A=${visA}  B=${visB}   ${visB === 'none' ? '✓ 已隐藏' : '✗ 未生效'}`);
  console.log(`  #fabBar backdrop-filter  : C=${bfC}   ${bfC === 'none' ? '✓ 已移除' : '✗ 未生效'}`);

  const L = decodePng(fs.readFileSync(fLegacy));
  const A = decodePng(fs.readFileSync(fA));
  const B = decodePng(fs.readFileSync(fB));
  const C = decodePng(fs.readFileSync(fC));
  const show = (label, r) => console.log(`${label}: ${String(r.diff).padStart(6)} px (${r.pct.toFixed(3)}%)  亮度 ${String(r.luma).padStart(6)}  仅色度 ${String(r.chroma).padStart(6)}`);

  const BTN = { x: 10, y: 8, w: 62, h: 62 };          // .float-back 所在区域
  const BODY = { x: 200, y: 44, w: 860, h: 570 };     // 正文区域（不含任何按钮）

  console.log('\n=== A/B/C 自比（Vue 版内部）===');
  show('A 正常            vs B 隐藏悬浮键 ', compareBuffers(A, B));
  console.log(`  其中悬浮键区域: ${compareBuffers(A, B, BTN).diff} px（应≈按钮面积）`);
  show('B 隐藏悬浮键      vs C 再去玻璃  ', compareBuffers(B, C));
  console.log(`  其中正文区域  : ${compareBuffers(B, C, BODY).diff} px ← 文字像素是否随 backdrop-filter 变化`);

  console.log('\n=== 与旧版对比（正文区域 200,44 860x570）===');
  show('旧版 vs A（Vue 原样）      ', compareBuffers(L, A, BODY));
  show('旧版 vs C（去玻璃+去悬浮键）', compareBuffers(L, C, BODY));

  const ra = compareBuffers(L, A, BODY), rc = compareBuffers(L, C, BODY);
  console.log('\n=== 结论 ===');
  if (compareBuffers(B, C, BODY).diff > 1000) {
    console.log('✓ 正文文字像素会随 #fabBar 的 backdrop-filter 改变 → 证实「合成层导致字形抗锯齿变化」。');
  } else {
    console.log('✗ 正文文字像素不随 backdrop-filter 改变 → 原假设不成立，需另找原因。');
  }
  console.log(`  正文差异：原样 ${ra.diff} px → 去玻璃后 ${rc.diff} px（下降 ${(100 * (1 - rc.diff / Math.max(1, ra.diff))).toFixed(1)}%）`);
})().catch(e => { console.error(e); process.exit(1); });
