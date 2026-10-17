'use strict';
/**
 * 逐页动效目视验证：走到每个页面并截图，用于人工确认动画观感与页面完整性。
 * 覆盖 verify-motion.js 未涉及的沉浸式页面（阅读/音乐/番剧）与情境配乐交互。
 *
 *   node scripts/verify-motion-pages.js [outDir]
 */
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const OUT = path.resolve(process.argv[2] || 'docs/motion-verify/pages');
fs.mkdirSync(OUT, { recursive: true });
const shot = n => { ab.shot(path.join(OUT, n + '.png')); console.log('  ->', n + '.png'); };

const nav = async n => {
  ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=${n}]').click(), 1)`);
  await ab.sleep(1100);
};
const type = async t => {
  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=${t}]').click(), 1)`);
  await ab.sleep(1400);
};
const openCard = async (i = 0) => {
  ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[${i}]?.click(), 1)`);
  await ab.sleep(1800);
};

(async () => {
  await ab.open('http://127.0.0.1:8761/', { width: 1258, height: 622, settle: 4000 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  // 固定夹具：否则截图内容取决于浏览器 profile 里残留的数据，而且
  // 情境配乐页只收「type 缺省」的书、番剧页要 type:'anime'，默认数据下会是空态。
  ab.evalJs(fixture.installScript());
  ab.batch('open http://127.0.0.1:8761/', 'set viewport 1258 622');
  await ab.sleep(3800);
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  await ab.sleep(1500);

  console.log('\n采集页面截图：');

  // 阅读页
  await nav('library'); await type('novel'); await openCard(0);
  ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`); await ab.sleep(3000);
  shot('reader');
  ab.evalJs(`(document.querySelector('#fabBar')?.click(), 1)`); await ab.sleep(900);
  shot('reader-menu');
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('章节目录'))?.click(), 1)`);
  await ab.sleep(1000);
  shot('reader-drawer');
  ab.evalJs(`(document.querySelector('#fabBar')?.click(), 1)`); await ab.sleep(700);

  // 阅读页深色
  ab.evalJs(`(document.querySelector('#fabBar')?.click(), 1)`); await ab.sleep(800);
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('主题'))?.click(), 1)`);
  await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-panel button')].find(b=>b.textContent.includes('深色'))?.click(), 1)`);
  await ab.sleep(1200);
  shot('reader-dark');
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-panel button')].find(b=>b.textContent.includes('浅色'))?.click(), 1)`);
  await ab.sleep(900);
  ab.evalJs(`(document.querySelector('#fabBar')?.click(), 1)`); await ab.sleep(600);

  // 音乐页
  await nav('library'); await type('music'); await openCard(0);
  ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`); await ab.sleep(3200);
  shot('music');
  ab.evalJs(`(document.querySelector('#mfTheme')?.click(), 1)`); await ab.sleep(1200);
  shot('music-dark');
  ab.evalJs(`(document.querySelector('#mfTheme')?.click(), 1)`); await ab.sleep(900);

  // 番剧页
  await nav('library'); await type('anime');
  const hasAnime = ab.evalJson(`document.querySelectorAll('#bookGrid .catalog-card .catalog-open').length`);
  if (hasAnime > 0) {
    await openCard(0);
    ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`); await ab.sleep(3500);
    shot('anime');
  } else {
    console.log('  （番剧库为空，跳过番剧页）');
  }

  // 情境配乐（含节点编辑展开）
  await ab.evalJs(`(document.querySelector('#btnMore')?.click(), 1)`); await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('情境配乐'))?.click(), 1)`);
  await ab.sleep(1600);
  shot('cine');
  const cineBtn = ab.evalJson(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('#chCards .ch-head button')].find(x => /编辑|手动添加/.test(x.textContent));
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`);
  if (cineBtn) {
    ab.batch(`mouse move ${cineBtn.x} ${cineBtn.y}`, 'mouse down', 'mouse up');
    await ab.sleep(1100);
    shot('cine-nodes');
  }

  // 设置页
  await ab.evalJs(`(document.querySelector('#btnMore')?.click(), 1)`); await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置'))?.click(), 1)`);
  await ab.sleep(1600);
  shot('settings');

  // 悬浮音乐播放器（离开音乐页后）
  await nav('home'); await ab.sleep(900);
  const ball = ab.evalJson(`JSON.stringify((() => { const b = document.querySelector('#muFloat .mf-ball');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`);
  if (ball) {
    shot('float-ball');
    ab.batch(`mouse move ${ball.x} ${ball.y}`, 'mouse down', 'mouse up');
    await ab.sleep(1100);
    shot('float-card');
  } else {
    console.log('  （无播放中的曲目，跳过悬浮播放器）');
  }

  // 确认弹窗（清空数据按钮 → 弹确认框 → 取消）
  // 设置页不在顶栏分段控件里（#mainSeg 没有 data-nav=settings），只能经 ⋯ 菜单进入。
  await ab.evalJs(`(document.querySelector('#btnMore')?.click(), 1)`); await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置'))?.click(), 1)`);
  await ab.sleep(1600);
  ab.evalJs(`(document.querySelector('#btnWipe')?.click(), 1)`); await ab.sleep(1000);
  shot('confirm');
  ab.evalJs(`(document.querySelector('#appConfirm .btn')?.click(), 1)`); await ab.sleep(900);

  console.log('\n完成 ->', OUT);
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
