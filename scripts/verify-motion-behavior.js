'use strict';
/**
 * 动效行为验证：确认动画真的在跑，而不只是「有 transition 声明」。
 *
 * 方法要点：agent-browser 每次 eval 都要起一个进程（约几十毫秒），
 * 靠外部轮询采样根本抓不到 300~460ms 的过渡中间态。
 * 因此统一改为**在页面内用 requestAnimationFrame 采样**，
 * 一次 eval 拿到整条时间线，再回传分析。
 *
 *   node scripts/verify-motion-behavior.js
 */
const ab = require('./lib/agent-browser');

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

const nav = async n => {
  ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=${n}]').click(), 1)`);
  await ab.sleep(1000);
};

/**
 * 在页面内采样：立即触发 action，然后每帧记录 probe() 的结果，
 * 直到 ms 毫秒后返回整个时间线。
 *
 * 注意：agent-browser 的 eval 对 Promise 与对象的序列化都不可靠
 * （实测会回传 "[object Object]"），因此让页面把结果写进
 * window.__rec 这个**字符串**槽位，再轮询读取。
 */
async function record(action, probe, ms = 700) {
  ab.evalJs(`(() => {
    window.__rec = '';
    const samples = [];
    const t0 = performance.now();
    (${action})();
    const tick = () => {
      try { samples.push(${probe}); } catch (e) { samples.push(null); }
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
      else window.__rec = JSON.stringify(samples);
    };
    requestAnimationFrame(tick);
  })(); 1`);
  for (let i = 0; i < 100; i++) {
    await ab.sleep(100);
    // evalJson 会把嵌套的 JSON 字符串解开：可能拿到数组，也可能是原始字符串
    const v = ab.evalJson(`window.__rec`);
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.startsWith('[')) return JSON.parse(v);
  }
  throw new Error('采样超时');
}

const mid = (arr, key) => arr.filter(x => x && x[key] > 0 && x[key] < 1).length;
const uniq = (arr, key) => [...new Set(arr.filter(Boolean).map(x => x && x[key]).filter(v => v && v !== 'none'))];

(async () => {
  await ab.open('http://127.0.0.1:8761/', { width: 1258, height: 622, settle: 4000 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  await ab.sleep(1200);

  // ---------------------------------------------------------------
  console.log('\n=== 1. 页面切换：前进（主页 → 库墙） ===');
  await nav('home');
  const fwd = await record(
    `() => document.querySelector('#mainSeg button[data-nav=library]').click()`,
    `(() => { const g = id => { const el = document.getElementById(id); const cs = getComputedStyle(el);
        return { d: cs.display, o: +cs.opacity, tf: cs.transform, cls: el.className }; };
      return { home: g('page-home'), lib: g('page-library') }; })()`,
    800);
  check('切换中两页同时可见', fwd.some(s => s && s.home.d !== 'none' && s.lib.d !== 'none'),
    `同时可见帧数=${fwd.filter(s => s && s.home.d !== 'none' && s.lib.d !== 'none').length}/${fwd.length}`);
  check('入场页淡入有中间态', mid(fwd.map(s => s && s.lib), 'o') > 0,
    `opacity 中间帧=${mid(fwd.map(s => s && s.lib), 'o')}`);
  check('入场页位移有多个中间位置', uniq(fwd.map(s => s && s.lib), 'tf').length > 2,
    `不同 transform 数=${uniq(fwd.map(s => s && s.lib), 'tf').length}`);
  check('离场页淡出有中间态', mid(fwd.map(s => s && s.home), 'o') > 0,
    `opacity 中间帧=${mid(fwd.map(s => s && s.home), 'o')}`);
  const last = fwd[fwd.length - 1];
  check('结束后只剩当前页且无残留类',
    last.home.d === 'none' && !/pg-/.test(last.lib.cls), `lib class="${last.lib.cls}"`);

  console.log('\n=== 2. 页面切换：后退（库墙 → 主页） ===');
  await nav('library');
  const back = await record(
    `() => document.querySelector('#mainSeg button[data-nav=home]').click()`,
    `(() => { const g = id => { const el = document.getElementById(id); const cs = getComputedStyle(el);
        return { d: cs.display, o: +cs.opacity, tf: cs.transform }; };
      return { home: g('page-home'), lib: g('page-library') }; })()`,
    800);
  check('后退时两页同时可见', back.some(s => s && s.home.d !== 'none' && s.lib.d !== 'none'));
  check('后退时离场页（库墙）有位移', uniq(back.map(s => s && s.lib), 'tf').length > 2,
    `不同 transform 数=${uniq(back.map(s => s && s.lib), 'tf').length}`);
  const backEnd = back[back.length - 1];
  check('后退结束后只剩主页', backEnd.lib.d === 'none' && backEnd.home.d !== 'none');

  // ---------------------------------------------------------------
  console.log('\n=== 3. 顶栏折叠（进入沉浸式阅读页） ===');
  await nav('library');
  const chromeBefore = ab.evalJson(`JSON.stringify({h:document.querySelector('#chrome').offsetHeight})`);
  check('库墙顶栏可见', chromeBefore.h > 40, `h=${chromeBefore.h}`);

  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=novel]').click(), 1)`);
  await ab.sleep(1400);
  ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0]?.click(), 1)`);
  await ab.sleep(1800);
  const chromeAnim = await record(
    `() => document.querySelector('#smRead').click()`,
    `(() => { const c = document.querySelector('#chrome');
      return { h: c.offsetHeight, main: Math.round(document.querySelector('main').getBoundingClientRect().height) }; })()`,
    1000);
  const hs = chromeAnim.map(x => x && x.h);
  const midH = hs.filter(h => h > 0 && h < 56);
  check('顶栏高度连续收缩（有中间高度）', midH.length > 0,
    `中间高度帧=${midH.length} 序列=${hs.slice(0, 12).join(',')}`);
  check('主区高度同步连续变化', new Set(chromeAnim.map(x => x && x.main)).size > 2,
    `不同主区高度=${new Set(chromeAnim.map(x => x && x.main)).size}`);
  await ab.sleep(900);
  const chromeAfter = ab.evalJson(`JSON.stringify({h:document.querySelector('#chrome').offsetHeight,
    page:[...document.querySelectorAll('main > section')].find(s=>getComputedStyle(s).display!=='none')?.id})`);
  check('沉浸页顶栏完全收起', chromeAfter.h === 0, `h=${chromeAfter.h}`);
  check('确实在阅读页', chromeAfter.page === 'page-reader', `page=${chromeAfter.page}`);

  console.log('\n=== 4. 阅读页浮动菜单进出动画 ===');
  const menuIn = await record(
    `() => document.querySelector('#fabBar').click()`,
    `(() => { const m = document.querySelector('#rdMenu'); const cs = getComputedStyle(m);
      return { d: cs.display, o: +cs.opacity, tf: cs.transform, vis: cs.visibility }; })()`,
    700);
  check('菜单淡入有中间态', mid(menuIn, 'o') > 0, `中间帧=${mid(menuIn, 'o')}`);
  check('菜单有缩放位移', uniq(menuIn, 'tf').length > 1, `不同 transform=${uniq(menuIn, 'tf').length}`);
  await ab.sleep(600);
  const menuOut = await record(
    `() => document.querySelector('#fabBar').click()`,
    `(() => { const m = document.querySelector('#rdMenu'); const cs = getComputedStyle(m);
      return { d: cs.display, o: +cs.opacity, vis: cs.visibility }; })()`,
    700);
  check('菜单淡出有中间态', menuOut.some(s => s && s.d !== 'none' && s.o > 0 && s.o < 1),
    `中间帧=${menuOut.filter(s => s && s.d !== 'none' && s.o > 0 && s.o < 1).length}`);
  await ab.sleep(700);
  const menuGone = ab.evalJson(`JSON.stringify({d:getComputedStyle(document.querySelector('#rdMenu')).display,
    vis:getComputedStyle(document.querySelector('#rdMenu')).visibility,
    hidden:document.querySelector('#rdMenu').classList.contains('hidden')})`);
  // 收起态用 visibility:hidden（保留 hidden 类名以便过渡），因此判据是「不可见且不可点」
  check('收起后菜单不可见且不拦截点击',
    menuGone.hidden && menuGone.vis === 'hidden',
    `hidden=${menuGone.hidden} visibility=${menuGone.vis}`);

  // ---------------------------------------------------------------
  console.log('\n=== 5. 分段控件滑动指示器 ===');
  await nav('library');
  const pill0 = ab.evalJson(`JSON.stringify((() => {
    const c = document.querySelector('#libraryTypeSeg'); const p = c.querySelector('.cat-pill');
    const on = [...c.querySelectorAll('button')].find(b => b.classList.contains('on'));
    return { active: c.classList.contains('pill-active'), o: getComputedStyle(p).opacity,
             onBg: getComputedStyle(on).backgroundColor }; })())`);
  check('静止态：无 pill-active、指示器不可见', !pill0.active && pill0.o === '0',
    `active=${pill0.active} opacity=${pill0.o}`);
  check('静止态：激活按钮自带底色（与原版一致）', pill0.onBg !== 'rgba(0, 0, 0, 0)', `bg=${pill0.onBg}`);

  const pillAnim = await record(
    `() => document.querySelector('#libraryTypeSeg button[data-ctype=music]').click()`,
    `(() => { const c = document.querySelector('#libraryTypeSeg'); const p = c.querySelector('.cat-pill');
      const cs = getComputedStyle(p);
      return { active: c.classList.contains('pill-active'), o: +cs.opacity, tf: cs.transform, w: cs.width }; })()`,
    700);
  const activeFrames = pillAnim.filter(s => s && s.active).length;
  check('滑动中：pill-active 生效', activeFrames > 0, `生效帧=${activeFrames}/${pillAnim.length}`);
  check('滑动中：指示器可见', pillAnim.some(s => s && s.active && s.o === 1));
  check('指示器位置连续移动', uniq(pillAnim, 'tf').length > 3,
    `不同 transform 数=${uniq(pillAnim, 'tf').length}`);
  await ab.sleep(800);
  const pillEnd = ab.evalJson(`JSON.stringify((() => {
    const c = document.querySelector('#libraryTypeSeg'); const p = c.querySelector('.cat-pill');
    const on = [...c.querySelectorAll('button')].find(b => b.classList.contains('on'));
    return { active: c.classList.contains('pill-active'), o: getComputedStyle(p).opacity,
             onText: on.textContent, onBg: getComputedStyle(on).backgroundColor }; })())`);
  check('滑动结束：指示器收起，底色回到新按钮',
    !pillEnd.active && pillEnd.o === '0' && pillEnd.onBg !== 'rgba(0, 0, 0, 0)',
    `active=${pillEnd.active} opacity=${pillEnd.o} on="${pillEnd.onText}"`);

  // 宽度过渡：顶栏分段控件的按钮宽度不同（文字/图标），切到搜索项时指示器应连宽度一起过渡
  await nav('home');
  const navPill = await record(
    `() => document.querySelector('#mainSeg button[data-nav=search]').click()`,
    `(() => { const c = document.querySelector('#mainSeg'); const p = c.querySelector('.seg-pill');
      const cs = getComputedStyle(p);
      return { active: c.classList.contains('pill-active'), w: cs.width, tf: cs.transform }; })()`,
    700);
  check('指示器宽度随目标按钮变化（宽度有过渡，非瞬间跳变）',
    uniq(navPill, 'w').length > 2, `不同宽度数=${uniq(navPill, 'w').length}：${uniq(navPill, 'w').slice(0, 6).join(' → ')}`);
  await ab.sleep(700);

  // ---------------------------------------------------------------
  console.log('\n=== 6. 按钮按压反馈（真实鼠标） ===');
  // 上一步把顶栏切到了搜索态，分类条在隐藏的库墙页里，必须先切回库墙
  await nav('library');
  await ab.sleep(400);
  const box = ab.evalJson(`JSON.stringify((() => { const b = document.querySelector('#libraryTypeSeg button');
    const r = b.getBoundingClientRect();
    if (!r.width) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`);
  check('分段按钮可见可测', !!box);
  ab.batch(`mouse move ${box.x} ${box.y}`);
  await ab.sleep(250);
  ab.batch('mouse down');
  await ab.sleep(90);
  const pressed = ab.evalJson(`JSON.stringify((() => {
    const b = document.querySelector('#libraryTypeSeg button'); const cs = getComputedStyle(b);
    return { tf: cs.transform, o: +cs.opacity }; })())`);
  ab.batch('mouse up');
  await ab.sleep(300);
  const released = ab.evalJson(`JSON.stringify((() => {
    const b = document.querySelector('#libraryTypeSeg button');
    return { tf: getComputedStyle(b).transform }; })())`);
  check('按下时按钮有视觉反馈（透明度或形变）',
    (pressed.o < 1) || (pressed.tf !== 'none' && pressed.tf !== released.tf),
    `按下 opacity=${pressed.o} transform=${pressed.tf}；松开 transform=${released.tf}`);

  // .btn 的悬停抬起与按压缩放。
  // 必须挑**可见**的按钮：主页的「搜索」按钮在未进入搜索态时是 display:none，
  // 量它的 transform 恒为 none，会误判成没动效。
  await nav('home');
  const btnSel = `#page-home #homeResume`;
  const btnBox = ab.evalJson(`JSON.stringify((() => { const b = document.querySelector('${btnSel}');
    if (!b) return null; const r = b.getBoundingClientRect();
    if (!r.width) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`);
  check('.btn 可见可测', !!btnBox);
  if (btnBox) {
    const base = ab.evalJson(`JSON.stringify(getComputedStyle(document.querySelector('${btnSel}')).transform)`);
    ab.batch(`mouse move ${btnBox.x} ${btnBox.y}`); await ab.sleep(300);
    const hover = ab.evalJson(`JSON.stringify(getComputedStyle(document.querySelector('${btnSel}')).transform)`);
    check('.btn 悬停抬起', hover !== base && hover !== 'none', `静止=${base} 悬停=${hover}`);
    ab.batch('mouse down'); await ab.sleep(90);
    const down = ab.evalJson(`JSON.stringify(getComputedStyle(document.querySelector('${btnSel}')).transform)`);
    ab.batch('mouse up'); await ab.sleep(300);
    check('.btn 按下缩放', down !== hover, `悬停=${hover} 按下=${down}`);
  }

  // ---------------------------------------------------------------
  console.log('\n=== 7. 浮层动画：详情弹窗 / 弹出菜单 / 确认框 ===');
  await nav('library');
  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=novel]').click(), 1)`);
  await ab.sleep(1200);
  const modalIn = await record(
    `() => document.querySelector('#bookGrid .catalog-card .catalog-open').click()`,
    `(() => { const m = document.querySelector('#storeModal'); const cs = getComputedStyle(m);
      const box = m.querySelector('.sm-box');
      return { o: +cs.opacity, vis: cs.visibility, boxTf: box ? getComputedStyle(box).transform : null }; })()`,
    900);
  check('弹窗淡入有中间态', mid(modalIn, 'o') > 0, `中间帧=${mid(modalIn, 'o')}`);
  check('弹窗内容缩放位移', uniq(modalIn, 'boxTf').length > 1, `不同 transform=${uniq(modalIn, 'boxTf').length}`);
  await ab.sleep(700);
  const modalOut = await record(
    `() => document.querySelector('#storeModal .sm-close').click()`,
    `(() => { const m = document.querySelector('#storeModal'); const cs = getComputedStyle(m);
      return { o: +cs.opacity, d: cs.display, hidden: m.classList.contains('hidden') }; })()`,
    700);
  check('弹窗淡出有中间态（保留 hidden 类名仍可过渡）',
    modalOut.some(s => s && s.hidden && s.d !== 'none' && s.o > 0 && s.o < 1),
    `中间帧=${modalOut.filter(s => s && s.hidden && s.d !== 'none' && s.o > 0 && s.o < 1).length}`);
  await ab.sleep(800);
  const modalEnd = ab.evalJson(`JSON.stringify({d:getComputedStyle(document.querySelector('#storeModal')).display,
    vis:getComputedStyle(document.querySelector('#storeModal')).visibility,
    hidden:document.querySelector('#storeModal').classList.contains('hidden')})`);
  // 关闭态保留 hidden 类名 + visibility:hidden（这样才有退场动画），
  // 因此 display 仍是 flex 属于预期；判据是不可见、不可交互。
  check('弹窗完全关闭（不可见）', modalEnd.hidden && modalEnd.vis === 'hidden',
    `hidden=${modalEnd.hidden} visibility=${modalEnd.vis}`);

  const popIn = await record(
    `() => document.querySelector('#btnMore').click()`,
    `(() => { const p = document.querySelector('.pop'); if (!p) return null;
      const cs = getComputedStyle(p); return { o: +cs.opacity, tf: cs.transform }; })()`,
    700);
  check('弹出菜单淡入有中间态', mid(popIn, 'o') > 0, `中间帧=${mid(popIn, 'o')}`);
  check('弹出菜单有缩放位移', uniq(popIn, 'tf').length > 1, `不同 transform=${uniq(popIn, 'tf').length}`);
  await ab.sleep(600);
  ab.evalJs(`(document.body.click(), 1)`);
  await ab.sleep(900);
  const popEnd = ab.evalJson(`JSON.stringify(!!document.querySelector('.pop'))`);
  check('菜单退场后从 DOM 移除（避免残留定位撑出横向滚动）', popEnd === false);

  // ---------------------------------------------------------------
  console.log('\n=== 8. prefers-reduced-motion 降级 ===');
  ab.batch('set media light reduced-motion');
  await ab.sleep(700);
  const rm = ab.evalJson(`JSON.stringify({reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,
    slow:getComputedStyle(document.documentElement).getPropertyValue('--dur-slow').trim(),
    med:getComputedStyle(document.documentElement).getPropertyValue('--dur-med').trim()})`);
  check('已进入 reduced-motion 环境', rm.reduce === true, `matches=${rm.reduce}`);
  check('时长令牌被压到 1ms', rm.slow === '1ms' && rm.med === '1ms',
    `--dur-slow=${rm.slow} --dur-med=${rm.med}`);
  ab.batch('set media light no-preference');
  await ab.sleep(500);

  console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
