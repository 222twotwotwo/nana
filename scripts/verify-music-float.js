'use strict';
/**
 * 悬浮音乐播放器功能验证。
 *
 * 覆盖：
 *   1. 无曲目时不显示；有曲目时出现
 *   2. 音乐页本身不显示（页面内已有完整播放器）
 *   3. 折叠态悬浮球 ⇄ 展开态卡片
 *   4. 在阅读页能切歌且**不跳回音乐页**（核心价值）
 *   5. 阅读页位置上移，不与目录胶囊 #rdFab 重叠
 *   6. 暂停/播放、下一首、曲目列表、跳转完整播放器
 *
 *   node scripts/verify-music-float.js [port]
 */
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const PORT = Number(process.argv[2] || 8761);
const BASE = `http://127.0.0.1:${PORT}/`;
const q = s => `document.querySelector('${s}')`;
const qa = s => `document.querySelectorAll('${s}')`;

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

/** 悬浮播放器状态快照 */
const STATE = `JSON.stringify((() => {
  const root = document.querySelector('#muFloat');
  if (!root) return { exists: false };
  const cs = getComputedStyle(root);
  const r = root.getBoundingClientRect();
  const fab = document.querySelector('#rdFab');
  const fr = fab ? fab.getBoundingClientRect() : null;
  const overlap = fr
    ? !(r.right < fr.left || r.left > fr.right || r.bottom < fr.top || r.top > fr.bottom)
    : false;
  return {
    exists: true,
    hidden: root.classList.contains('hidden'),
    open: root.classList.contains('open'),
    lifted: root.classList.contains('lifted'),
    ball: !!root.querySelector('.mf-ball'),
    card: !!root.querySelector('.mf-card'),
    name: root.querySelector('.mf-name')?.textContent || '',
    foot: root.querySelector('.mf-foot')?.textContent || '',
    rows: root.querySelectorAll('.mf-row').length,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    zIndex: cs.zIndex,
    overlapsFab: overlap,
    page: [...document.querySelectorAll('.page')].filter(p => !p.classList.contains('hidden')).map(p => p.id)[0] || '',
    // 播放态：展开看 .mf-play 的图标，折叠看 .mf-ball-ico。
    // 不能只看 .mf-ball——展开成卡片时它并不存在，会恒为 false。
    playing: (() => {
      const play = root.querySelector('.mf-play');
      if (play) return /⏸/.test(play.textContent);
      const ico = root.querySelector('.mf-ball-ico');
      return ico ? /⏸/.test(ico.textContent) : false;
    })()
  };
})())`;

const snap = () => ab.evalJson(STATE);

/**
 * 真实点击（CDP 输入事件），全程使用。
 * 参数是 **CSS 选择器**（与 ab.batch('click …') 一致）。
 *
 * 不能用 `element.click()`：合成点击不授予 user activation，
 * Chrome 的自动播放策略会以 NotAllowedError 拒绝 play()，
 * 播放器会停在「已选曲但未播放 + lastError」的半状态，
 * 于是测出来的是「被浏览器拦截」而不是播放器本身的行为。
 */
/**
 * 点击（真实鼠标事件：移动→按下→抬起）。
 *
 * 为什么不用 `ab.batch('click <sel>')`：实测该命令在分类按钮上会把事件投给
 * 外层容器 DIV，应用收不到点击；而合成 `element.click()` 不授予 user activation，
 * 会被 Chrome 自动播放策略以 NotAllowedError 拒绝 play()。
 * 走坐标真实鼠标操作可同时满足「事件落点正确」与「获得播放许可」。
 */
async function clickReal(sel, settle = 900) {
  await ab.clickMouse(sel);
  await ab.sleep(settle);
}
const clickFloat = clickReal;

(async () => {
  await ab.open(BASE, { width: 1258, height: 622, settle: 3500 });

  console.log('\n=== 1. 无曲目时 ===');
  let s = await snap();
  check('#muFloat 已挂载', s.exists);
  if (s.exists) {
    check('无曲目时不显示（hidden）', s.hidden === true, `hidden=${s.hidden}`);
    check('音乐库为空时是折叠球而非卡片', s.ball === true || s.hidden === true);
  }

  console.log('\n=== 2. 播放一首后出现 ===');
  // 用夹具确保有音乐
  ab.evalJs(fixture.installScript());
  ab.batch('open ' + BASE);
  await ab.sleep(3200);
  ab.batch('set viewport 1258 622');
  await ab.sleep(800);

  // 经库墙→音乐→播放（真实点击，确保获得 user activation）
  // 每步：[要点击的 CSS 选择器, 点击后需为真的 JS 表达式]
  for (const [sel, wait] of [
    ['#mainSeg button[data-nav=library]', q('#libraryTypeSeg button[data-ctype=music]')],
    ['#libraryTypeSeg button[data-ctype=music]', q('#bookGrid .catalog-card')],
    ['#bookGrid .catalog-card .catalog-open', `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    ['#smRead', `${q('#page-music')} && !${q('#page-music')}.classList.contains('hidden')`]
  ]) {
    await clickReal(sel, 600);
    if (wait) await ab.waitFor(wait);
  }
  await ab.sleep(1500);

  s = await snap();
  check('音乐页本身不显示悬浮播放器', s.hidden === true, `hidden=${s.hidden}`);

  console.log('\n=== 3. 离开音乐页后出现 ===');
  // 音乐页是沉浸式页面，顶部导航被隐藏（CHROME_PAGES 不含 music），
  // 只能用左上角悬浮返回键离开。
  // 注意 .float-back 在番剧/阅读/音乐三页都存在，必须限定在 #page-music 内。
  await clickReal('#page-music .float-back', 1400);
  await clickReal('#mainSeg button[data-nav=home]', 1200);
  s = await snap();
  check('回到主页后显示', s.hidden === false, `hidden=${s.hidden}`);
  check('默认是折叠态悬浮球', s.ball === true && s.card === false);
  check('z-index 在合理层级（不遮弹窗）', Number(s.zIndex) < 80, `z-index=${s.zIndex}`);

  console.log('\n=== 4. 展开为迷你卡片 ===');
  await clickFloat('#muFloat .mf-ball');
  s = await snap();
  check('展开后是卡片', s.card === true && s.ball === false);
  check('显示曲目名', !!s.name, `name="${s.name}"`);
  check('正在播放（真实点击已获得播放许可）', /正在播放/.test(s.foot), `foot="${s.foot}"`);

  console.log('\n=== 5. 在阅读页切歌且不跳回音乐页（核心） ===');
  await clickFloat('#muFloat .mf-icon[title="收起"]');
  // 打开一本小说
  for (const [sel, wait] of [
    ['#mainSeg button[data-nav=library]', q('#libraryTypeSeg button[data-ctype=novel]')],
    ['#libraryTypeSeg button[data-ctype=novel]', q('#bookGrid .catalog-card')],
    ['#bookGrid .catalog-card .catalog-open', `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    ['#smRead', `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`]
  ]) {
    await clickReal(sel, 600);
    if (wait) await ab.waitFor(wait);
  }
  await ab.sleep(1200);

  s = await snap();
  check('阅读页显示悬浮播放器', s.hidden === false && s.exists);
  check('阅读页上移（lifted），不与目录胶囊重叠', s.lifted === true && s.overlapsFab === false,
    `lifted=${s.lifted} overlapsFab=${s.overlapsFab} rect=${JSON.stringify(s.rect)}`);

  await clickFloat('#muFloat .mf-ball');
  const before = await snap();
  await clickReal('#muFloat .mf-icon[title="下一首"]');
  await ab.sleep(2500);
  const after = await snap();
  check('点下一首后仍在阅读页（未跳转音乐页）', after.page === 'page-reader', `page=${after.page}`);
  check('曲目已切换', after.name !== before.name, `before="${before.name}" after="${after.name}"`);

  console.log('\n=== 6. 播放列表 ===');
  await clickFloat('#muFloat .mf-icon[title="播放列表"]');
  s = await snap();
  check('展开曲目列表', s.rows > 0, `${s.rows} 首`);

  console.log('\n=== 7. 暂停/播放 ===');
  const playBefore = (await snap()).playing;
  await clickReal('#muFloat .mf-play');
  await ab.sleep(1400);
  const playAfter = (await snap()).playing;
  check('播放/暂停可切换', playBefore !== playAfter, `${playBefore} → ${playAfter}`);

  console.log('\n=== 8. 跳转完整播放器 ===');
  await clickFloat('#muFloat .mf-icon[title="打开完整播放器"]');
  await ab.sleep(1200);
  s = await snap();
  check('跳转到音乐页', s.page === 'page-music', `page=${s.page}`);
  check('音乐页隐藏悬浮播放器', s.hidden === true);

  ab.shot('docs/refactor-screens/verify/music-float-reader.png');
  ab.close();

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验证异常:', e.message); process.exit(1); });
