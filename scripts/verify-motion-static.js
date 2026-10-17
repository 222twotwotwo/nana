'use strict';
/**
 * 动效层的「同数据」像素回归测试。
 *
 * 直接对比改动前后的截图会被数据差异污染（播放记录、收藏内容、封面图加载
 * 都可能不同）。这里改为在**同一个浏览器会话、同一份数据**下做开关对比：
 *
 *   1. 打开页面，等界面稳定
 *   2. 注入 <style> 把动效层的声明整体禁用（只针对过渡/动画与指示器，
 *      不动任何布局属性），截一张「基线」图
 *   3. 移除注入的样式，再截一张「动效」图
 *   4. 逐像素比较：两者应当完全一致
 *
 * 已知例外：#rdMenu 是 backdrop-filter 毛玻璃面板，其「有动画/无动画」两种
 * 渲染在按钮圆角处会有极少量亮度差（实测原版代码同样如此，甚至更大：
 * 原版 0.1597% vs 本改动 0.1025%，见 docs/motion.md「已知例外」）。
 * 这是浏览器合成毛玻璃的固有行为，不是本项目的回归；该场景单独放宽阈值。
 *
 *   node scripts/verify-motion-static.js [outDir] [baseUrl]
 */
const fs = require('node:fs');
const path = require('node:path');
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');
const { decodePng, compareBuffers } = require('./lib/png');

const OUT = path.resolve(process.argv[2] || 'docs/motion-verify/static');
const BASE = process.argv[3] || 'http://127.0.0.1:8761/';
fs.mkdirSync(OUT, { recursive: true });

/**
 * 只禁用「动画与过渡」以及指示器图层，用来还原「没有动效层」的样子。
 * 关键：不碰 display / 尺寸 / 位置等布局属性。
 * 指示器在静止态本就不显示（瞬时元素），这里显式隐藏以防万一。
 */
const KILL = `(() => {
  const s = document.createElement('style');
  s.id = '__motion_off';
  s.textContent = \`
    *, *::before, *::after {
      transition: none !important;
      animation: none !important;
    }
    .seg-pill, .cat-pill { display: none !important; }
  \`;
  document.head.appendChild(s);
  return 1;
})()`;

const RESTORE = `(() => { document.getElementById('__motion_off')?.remove(); return 1; })()`;

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

const nav = async n => {
  ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=${n}]').click(), 1)`);
  await ab.sleep(1000);
};

/** 同一场景截两次（关动效 / 开动效）并比较 */
async function compareScene(name, tolerance = 0.02) {
  await ab.sleep(700);
  ab.evalJs(KILL);
  await ab.sleep(500);
  const off = path.join(OUT, name + '.off.png');
  ab.shot(off);
  ab.evalJs(RESTORE);
  await ab.sleep(500);
  const on = path.join(OUT, name + '.on.png');
  ab.shot(on);

  const a = decodePng(fs.readFileSync(off));
  const b = decodePng(fs.readFileSync(on));
  if (a.w !== b.w || a.h !== b.h) {
    check(`${name} 尺寸一致`, false, `${a.w}x${a.h} vs ${b.w}x${b.h}`);
    return;
  }
  const r = compareBuffers(a, b);
  check(`${name} 静止态逐像素一致`, r.pct <= tolerance,
    `差异 ${r.pct.toFixed(4)}%（亮度 ${r.luma} / 色度 ${r.chroma}）`);
}

(async () => {
  await ab.open(BASE, { width: 1258, height: 622, settle: 4000 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  // 装确定性夹具：避免「在线种子/播放记录」等数据差异干扰像素比对
  ab.evalJs(fixture.installScript());
  ab.batch(`open ${BASE}`, 'set viewport 1258 622');
  await ab.sleep(3800);
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  await ab.sleep(1200);

  console.log('\n=== 桌面 · 逐页静止态比对 ===');
  await nav('home');     await compareScene('home');
  await nav('library');  await compareScene('library');
  await ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=search]').click(), 1)`);
  await ab.sleep(1200);  await compareScene('search');
  await nav('library');
  await ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`); await ab.sleep(700);
  await compareScene('popmenu');
  await ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置')).click(), 1)`);
  await ab.sleep(1300);  await compareScene('settings');
  await ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`); await ab.sleep(700);
  await ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('情境配乐')).click(), 1)`);
  await ab.sleep(1300);  await compareScene('cine');

  // 详情弹窗
  await nav('library');
  await ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0].click(), 1)`);
  await ab.sleep(1800);  await compareScene('modal');
  await ab.evalJs(`(document.querySelector('#storeModal .sm-close')?.click(), 1)`);
  await ab.sleep(800);

  // 阅读页：正文 + 浮动菜单（含字号面板展开）——这里改动了 #rdMenu / #rmFontPanel
  console.log('\n=== 阅读页 ===');
  await nav('library');
  await ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=novel]').click(), 1)`);
  await ab.sleep(1500);
  await ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0].click(), 1)`);
  await ab.sleep(1800);
  await ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`);
  await ab.sleep(3200);
  await compareScene('reader');
  ab.evalJs(`(document.querySelector('#fabBar')?.click(), 1)`); await ab.sleep(1000);
  await compareScene('reader-menu');
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('主题'))?.click(), 1)`);
  await ab.sleep(1000);
  // 毛玻璃面板：动画开关本身会改变合成结果（原版亦然），放宽阈值
  await compareScene('reader-font-panel', 0.25);
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('章节目录'))?.click(), 1)`);
  await ab.sleep(1000);
  await compareScene('reader-drawer');
  ab.evalJs(`(document.querySelector('#fabBar')?.click(), 1)`); await ab.sleep(900);

  console.log('\n=== 移动端 ===');
  ab.batch('set viewport 420 800');
  await ab.sleep(1200);
  await nav('home');     await compareScene('mobile-home');
  await nav('library');  await compareScene('mobile-library');

  console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
  console.log(`对比图目录：${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
