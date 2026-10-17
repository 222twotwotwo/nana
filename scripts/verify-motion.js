'use strict';
/**
 * 动效验证脚本：逐页截图 + 采样动画/过渡属性 + 布局尺寸回归。
 *
 *   node scripts/verify-motion.js [outDir] [baseUrl]
 *
 * 输出：
 *   - <outDir>/*.png            每页静态截图（可与改动前基线比对）
 *   - <outDir>/layout.json      每页关键元素几何尺寸（用于发现布局回归）
 *   - <outDir>/motion.json      页面切换/按钮按压时的计算样式采样
 *
 * 默认写到 docs/motion-verify/geometry/：这些截图与 static/ 的场景重复，
 * 单独成目录，免得和逐像素基线混在一起。
 */
const path = require('node:path');
const fs = require('node:fs');
const ab = require('./lib/agent-browser');

const OUT = path.resolve(process.argv[2] || 'docs/motion-verify/geometry');
const BASE = process.argv[3] || 'http://127.0.0.1:8761/';
const W = 1258, H = 622;

fs.mkdirSync(OUT, { recursive: true });
const shot = name => ab.shot(path.join(OUT, name + '.png'));

/** 读取页面几何信息：页面舞台与各页根节点的盒子 */
const LAYOUT_JS = `JSON.stringify((() => {
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const pages = {};
  document.querySelectorAll('main > section').forEach(s => { pages[s.id] = box(s); });
  return {
    chrome: box(document.querySelector('#chrome')),
    main: box(document.querySelector('main')),
    body: { w: document.body.clientWidth, h: document.body.clientHeight,
            sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight },
    pages
  };
})())`;

/** 采样某个元素的过渡/动画计算样式 */
const motionOf = sel => `JSON.stringify((() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
           transitionTimingFunction: cs.transitionTimingFunction, animationName: cs.animationName,
           animationDuration: cs.animationDuration, transform: cs.transform, opacity: cs.opacity,
           display: cs.display, visibility: cs.visibility };
})())`;

async function visible(sel) {
  return ab.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; })()`);
}

async function goto(nav) {
  await ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=${nav}]').click(), 1)`);
  await ab.sleep(900);
}

async function main() {
  const layout = {}, motion = {};
  await ab.open(BASE, { width: W, height: H, settle: 3500 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });

  // ---------- 逐页截图 ----------
  const pages = [
    ['home', async () => goto('home')],
    ['library', async () => goto('library')],
    ['search', async () => {
      await ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=search]').click(), 1)`);
      await ab.sleep(1000);
    }],
    ['settings', async () => {
      await ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`); await ab.sleep(600);
      await ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置')).click(), 1)`);
      await ab.sleep(1200);
    }],
    ['cine', async () => {
      await ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`); await ab.sleep(600);
      await ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('情境配乐')).click(), 1)`);
      await ab.sleep(1200);
    }]
  ];
  for (const [name, fn] of pages) {
    await fn();
    await shot(name);
    layout[name] = ab.evalJson(LAYOUT_JS);
  }

  // ---------- 页面切换动画采样 ----------
  // 切到库墙并立刻连续采样，捕捉过渡中间态
  await goto('home');
  await ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=library]').click(), 1)`);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(ab.evalJson(`JSON.stringify((() => {
      const s = document.querySelector('#page-library'), h = document.querySelector('#page-home');
      const cs = getComputedStyle(s), ch = getComputedStyle(h);
      return { t: ${i}, lib: { o: cs.opacity, tf: cs.transform, d: cs.display },
               home: { o: ch.opacity, tf: ch.transform, d: ch.display } };
    })())`));
    await ab.sleep(45);
  }
  motion.pageSwitch = samples;

  // ---------- 按钮交互动效采样 ----------
  await goto('library');
  motion.button = ab.evalJson(motionOf('#bookGrid .catalog-open, .btn'));
  motion.segButton = ab.evalJson(motionOf('#mainSeg button'));
  motion.card = ab.evalJson(motionOf('#bookGrid .catalog-card'));
  motion.header = ab.evalJson(motionOf('#chrome'));

  // 悬停态：真实鼠标移到卡片封面，看 transform 是否变化
  const before = ab.evalJson(`JSON.stringify((() => { const c = document.querySelector('#bookGrid .cover');
    return c ? getComputedStyle(c).transform : null; })())`);
  const b = ab.evalJson(`JSON.stringify((() => { const el = document.querySelector('#bookGrid .catalog-card .cover');
    const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })())`);
  ab.batch(`mouse move ${b.x} ${b.y}`);
  await ab.sleep(400);
  const after = ab.evalJson(`JSON.stringify((() => { const c = document.querySelector('#bookGrid .cover');
    return c ? getComputedStyle(c).transform : null; })())`);
  motion.coverHover = { before, after };

  // ---------- 浮层动效采样 ----------
  await ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`);
  await ab.sleep(400);
  motion.pop = ab.evalJson(motionOf('.pop'));
  await shot('popmenu');
  await ab.evalJs(`(document.body.click(), 1)`);
  await ab.sleep(400);

  // 详情弹窗
  await goto('library');
  await ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0].click(), 1)`);
  await ab.sleep(1500);
  motion.modal = ab.evalJson(motionOf('#storeModal'));
  motion.modalBox = ab.evalJson(motionOf('#storeModal .sm-box'));
  await shot('modal');
  await ab.evalJs(`(document.querySelector('#storeModal .sm-close')?.click(), 1)`);
  await ab.sleep(600);

  // ---------- 移动端 ----------
  ab.batch('set viewport 420 800');
  await ab.sleep(900);
  await goto('home'); await shot('mobile-home');
  await goto('library'); await shot('mobile-library');
  layout.mobileLibrary = ab.evalJson(LAYOUT_JS);

  fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 2));
  fs.writeFileSync(path.join(OUT, 'motion.json'), JSON.stringify(motion, null, 2));
  console.log('截图与采样完成 ->', OUT);
  console.log('页面切换采样数:', samples.length, '首帧:', JSON.stringify(samples[0]));
}

main().then(() => process.exit(0)).catch(e => { console.error('失败:', e.message); process.exit(1); });
