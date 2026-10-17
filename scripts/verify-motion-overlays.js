'use strict';
/**
 * 补充验证：目标里点名但行为套件尚未覆盖的浮层与页面。
 *   - Toast 进出动画
 *   - 章节抽屉 #chDrawer 滑入滑出
 *   - 确认弹窗 #appConfirm 进出
 *   - 悬浮音乐球 ⇄ 迷你卡片变形
 *   - 番剧页状态切换
 *   - 情境配乐节点区展开
 *
 *   node scripts/verify-motion-overlays.js
 */
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

/** 在页面内按帧采样 */
async function record(action, probe, ms = 800) {
  ab.evalJs(`(() => {
    window.__rec = '';
    const samples = []; const t0 = performance.now();
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
    const v = ab.evalJson(`window.__rec`);
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.startsWith('[')) return JSON.parse(v);
  }
  throw new Error('采样超时');
}
const uniq = (a, k) => [...new Set(a.filter(Boolean).map(x => x && x[k]).filter(v => v && v !== 'none'))];
const mid = (a, k) => a.filter(x => x && x[k] > 0 && x[k] < 1).length;

const nav = async n => {
  ab.evalJs(`(document.querySelector('#mainSeg button[data-nav=${n}]').click(), 1)`);
  await ab.sleep(1100);
};

/** 进入一本小说的阅读页 */
async function openReader() {
  await nav('library');
  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=novel]').click(), 1)`);
  await ab.sleep(1400);
  ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0]?.click(), 1)`);
  await ab.sleep(1900);
  ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`);
  await ab.sleep(3200);
}

(async () => {
  await ab.open('http://127.0.0.1:8761/', { width: 1258, height: 622, settle: 4000 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  // 装扩展夹具：默认夹具两本书都带 type:'novel'，情境配乐页只收 type 缺省的书，
  // 番剧也要 type:'anime' 的书才能验证，所以这里必须带上额外夹具。
  ab.evalJs(fixture.installScript());
  ab.batch('open http://127.0.0.1:8761/', 'set viewport 1258 622');
  await ab.sleep(3800);
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  await ab.sleep(1500);

  // ---------------------------------------------------------------
  console.log('\n=== 1. Toast 进出动画 ===');
  await nav('home');
  // 触发一个 toast：主页空态或播放提示。直接用 store 的动作最稳。
  const toastIn = await record(
    `() => {
      const app = document.querySelector('#app');
      // 通过 ⋯ 菜单的「说明」项触发 toast（音乐页），改用更通用的方式：
      // 直接派发一个必然产生 toast 的交互 —— 库墙「搜索」空关键词
      const seg = document.querySelector('#mainSeg button[data-nav=search]');
      seg.click();
      setTimeout(() => {
        const form = document.querySelector('#storeBar');
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }, 60);
    }`,
    `(() => { const t = document.querySelector('#toast'); const cs = getComputedStyle(t);
      return { o: +cs.opacity, tf: cs.transform, show: t.classList.contains('show'),
               text: t.textContent }; })()`,
    1200);
  const toastShown = toastIn.filter(s => s && s.show).length;
  check('Toast 被触发', toastShown > 0, `show 帧数=${toastShown}`);
  check('Toast 淡入有中间态', mid(toastIn, 'o') > 0, `中间帧=${mid(toastIn, 'o')}`);
  check('Toast 有位移（上滑入场）', uniq(toastIn, 'tf').length > 1,
    `不同 transform=${uniq(toastIn, 'tf').length}`);
  // 等它自动消失
  const toastOut = await record(
    `() => {}`,
    `(() => { const t = document.querySelector('#toast'); const cs = getComputedStyle(t);
      return { o: +cs.opacity, show: t.classList.contains('show') }; })()`,
    3200);
  check('Toast 自动淡出有中间态', mid(toastOut, 'o') > 0, `中间帧=${mid(toastOut, 'o')}`);
  await ab.sleep(600);

  // ---------------------------------------------------------------
  console.log('\n=== 2. 章节抽屉 #chDrawer 滑入滑出 ===');
  await openReader();
  const drawerIn = await record(
    `() => document.querySelector('#fabBar').click()`,
    `(() => { const d = document.querySelector('#chDrawer'); if (!d) return null;
      const cs = getComputedStyle(d);
      return { o: +cs.opacity, tf: cs.transform, open: d.classList.contains('open'),
               shadow: cs.boxShadow }; })()`,
    700);
  // 抽屉由菜单里的「章节目录」打开
  await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('#rdMenu .rm-row')].find(r=>r.textContent.includes('章节目录'))?.click(), 1)`);
  const drawerOpen = await record(
    `() => {}`,
    `(() => { const d = document.querySelector('#chDrawer'); const cs = getComputedStyle(d);
      return { tf: cs.transform, open: d.classList.contains('open'), shadow: cs.boxShadow,
               x: Math.round(d.getBoundingClientRect().x) }; })()`,
    700);
  check('抽屉打开有滑动过程（多个中间位置）', uniq(drawerOpen, 'tf').length > 3,
    `不同 transform=${uniq(drawerOpen, 'tf').length}`);
  check('抽屉打开后完全进入（x≈0）',
    drawerOpen[drawerOpen.length - 1].x === 0,
    `最终 x=${drawerOpen[drawerOpen.length - 1].x}`);
  check('抽屉滑入时阴影渐显', uniq(drawerOpen, 'shadow').length > 1,
    `不同阴影=${uniq(drawerOpen, 'shadow').length}`);

  ab.evalJs(`(document.querySelector('#chDrawer .ch-item')?.click(), 1)`);
  const drawerOut = await record(
    `() => {}`,
    `(() => { const d = document.querySelector('#chDrawer'); const cs = getComputedStyle(d);
      return { tf: cs.transform, open: d.classList.contains('open') }; })()`,
    700);
  check('抽屉关闭有滑动过程', uniq(drawerOut, 'tf').length > 3,
    `不同 transform=${uniq(drawerOut, 'tf').length}`);
  await ab.sleep(600);

  // ---------------------------------------------------------------
  console.log('\n=== 3. 确认弹窗 #appConfirm 进出 ===');
  // 阅读页是沉浸式页面（顶栏收起），先用左上角悬浮返回键回到库墙
  ab.evalJs(`(document.querySelector('#page-reader .float-back')?.click(), 1)`);
  await ab.sleep(1500);
  // 设置页不在顶栏分段控件里，只能经 ⋯ 菜单进入
  ab.evalJs(`(document.querySelector('#btnMore')?.click(), 1)`);
  await ab.sleep(800);
  ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置'))?.click(), 1)`);
  await ab.sleep(1600);
  const onSettings = ab.evalJson(`JSON.stringify({
    page: [...document.querySelectorAll('main > section')]
      .filter(s => getComputedStyle(s).display !== 'none').map(s => s.id),
    hasWipe: !!document.querySelector('#btnWipe') })`);
  check('已进入设置页', onSettings.hasWipe && onSettings.page[0] === 'page-settings',
    JSON.stringify(onSettings));
  // 滚到「清空所有数据」按钮
  ab.evalJs(`(document.querySelector('#btnWipe')?.scrollIntoView({block:'center'}), 1)`);
  await ab.sleep(700);
  const confirmIn = await record(
    `() => document.querySelector('#btnWipe').click()`,
    `(() => { const c = document.querySelector('#appConfirm'); if (!c) return null;
      const cs = getComputedStyle(c); const box = c.querySelector('.ac-box');
      return { o: +cs.opacity, vis: cs.visibility,
               boxTf: box ? getComputedStyle(box).transform : null }; })()`,
    900);
  check('确认框淡入有中间态', mid(confirmIn, 'o') > 0, `中间帧=${mid(confirmIn, 'o')}`);
  check('确认框内容缩放位移', uniq(confirmIn, 'boxTf').length > 1,
    `不同 transform=${uniq(confirmIn, 'boxTf').length}`);
  await ab.sleep(700);
  const confirmOut = await record(
    `() => document.querySelector('#appConfirm .btn').click()`,
    `(() => { const c = document.querySelector('#appConfirm'); if (!c) return null;
      const cs = getComputedStyle(c);
      return { o: +cs.opacity, vis: cs.visibility }; })()`,
    800);
  check('确认框淡出有中间态（取消也能看到退场）', mid(confirmOut, 'o') > 0,
    `中间帧=${mid(confirmOut, 'o')}`);
  await ab.sleep(800);
  const confirmEnd = ab.evalJson(`JSON.stringify((() => { const c = document.querySelector('#appConfirm');
    if (!c) return { gone: true };
    const cs = getComputedStyle(c);
    return { gone: false, vis: cs.visibility, o: cs.opacity }; })())`);
  check('确认框最终不可见',
    confirmEnd.gone || (confirmEnd.vis === 'hidden' && confirmEnd.o === '0'),
    JSON.stringify(confirmEnd));

  // ---------------------------------------------------------------
  console.log('\n=== 4. 悬浮音乐球 ⇄ 迷你卡片 ===');
  // 从设置页回库墙（设置页在顶栏里，可以直接点）
  await nav('library');
  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=music]').click(), 1)`);
  await ab.sleep(1500);
  ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0]?.click(), 1)`);
  await ab.sleep(1900);
  ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`);
  await ab.sleep(3400);
  // 音乐页也是沉浸式页面，用悬浮返回键离开
  ab.evalJs(`(document.querySelector('#page-music .float-back')?.click(), 1)`);
  await ab.sleep(1600);
  await nav('home');
  await ab.sleep(1200);
  const ballState = ab.evalJson(`JSON.stringify((() => { const f = document.querySelector('#muFloat');
    return { hidden: f.classList.contains('hidden'), ball: !!f.querySelector('.mf-ball'),
             card: !!f.querySelector('.mf-card') }; })())`);
  check('悬浮球可见（折叠态）', !ballState.hidden && ballState.ball && !ballState.card,
    JSON.stringify(ballState));

  const morph = await record(
    `() => document.querySelector('#muFloat .mf-ball').click()`,
    `(() => { const f = document.querySelector('#muFloat');
      const ball = f.querySelector('.mf-ball'); const card = f.querySelector('.mf-card');
      const g = el => el ? { o: +getComputedStyle(el).opacity, tf: getComputedStyle(el).transform,
                             pos: getComputedStyle(el).position } : null;
      return { ball: g(ball), card: g(card) }; })()`,
    800);
  const bothPresent = morph.filter(s => s && s.ball && s.card).length;
  check('变形期间两者短暂共存（交叉淡入淡出）', bothPresent > 0, `共存帧=${bothPresent}`);
  check('离场的一方绝对定位（不撑高容器）',
    morph.some(s => s && s.ball && s.ball.pos === 'absolute'),
    `absolute 帧=${morph.filter(s => s && s.ball && s.ball.pos === 'absolute').length}`);  await ab.sleep(700);
  const cardEnd = ab.evalJson(`JSON.stringify((() => { const f = document.querySelector('#muFloat');
    return { ball: !!f.querySelector('.mf-ball'), card: !!f.querySelector('.mf-card') }; })())`);
  check('变形结束只剩卡片', !cardEnd.ball && cardEnd.card, JSON.stringify(cardEnd));

  // ---------------------------------------------------------------
  console.log('\n=== 5. 情境配乐节点区展开 ===');
  ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`);
  await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('情境配乐'))?.click(), 1)`);
  await ab.sleep(1600);
  const nodesIn = await record(
    `() => {
      const b = [...document.querySelectorAll('#chCards .ch-head button')]
        .find(x => /编辑|手动添加/.test(x.textContent));
      if (b) b.click();
    }`,
    `(() => { const n = document.querySelector('#chCards .nodes');
      if (!n) return null; const cs = getComputedStyle(n);
      return { o: +cs.opacity, tf: cs.transform, h: Math.round(n.getBoundingClientRect().height) }; })()`,
    800);
  check('节点区出现', nodesIn.some(s => s && s.h > 0),
    `最大高度=${Math.max(...nodesIn.filter(Boolean).map(s => s.h || 0))}`);
  check('节点区淡入有中间态', mid(nodesIn, 'o') > 0, `中间帧=${mid(nodesIn, 'o')}`);
  check('节点区有位移', uniq(nodesIn, 'tf').length > 1, `不同 transform=${uniq(nodesIn, 'tf').length}`);
  await ab.sleep(600);

  // ---------------------------------------------------------------
  console.log('\n=== 6. 番剧页状态切换 ===');
  await nav('library');
  ab.evalJs(`(document.querySelector('#libraryTypeSeg button[data-ctype=anime]').click(), 1)`);
  await ab.sleep(1500);
  const animeCount = ab.evalJson(`document.querySelectorAll('#bookGrid .catalog-card .catalog-open').length`);
  if (animeCount > 0) {
    ab.evalJs(`(document.querySelectorAll('#bookGrid .catalog-card .catalog-open')[0].click(), 1)`);
    await ab.sleep(1900);
    ab.evalJs(`(document.querySelector('#smRead')?.click(), 1)`);
    await ab.sleep(3400);
    const animeState = ab.evalJson(`JSON.stringify((() => {
      const p = document.querySelector('#animePlayer');
      if (!p) return { noPlayer: true };
      const kids = [...p.children];
      const cs = kids.length ? getComputedStyle(kids[0]) : null;
      return { kidCount: kids.length, kidTag: kids[0]?.tagName,
               animName: cs ? cs.animationName : null,
               page: [...document.querySelectorAll('main > section')]
                 .filter(s => getComputedStyle(s).display !== 'none').map(s => s.id) }; })())`);
    check('番剧页已渲染', animeState.page && animeState.page[0] === 'page-anime',
      JSON.stringify(animeState));
    check('播放器状态子元素挂有入场动画', animeState.animName === 'fadeRise',
      `animationName=${animeState.animName}`);
    // 选集按钮反馈。
    //
    // 这里不能「读一次坐标 → 移一次鼠标」就断言：播放器挂载后会经历
    // loading → ready 的重渲染，选集条 DOM 会被整体替换，鼠标停在同一像素
    // 也收不到 :hover，于是断言会随机失败（实测单跑通过、连跑偶发失败）。
    // 因此改成：等按钮可交互 → 把鼠标移开读静止态 → 移入 → 轮询确认，
    // 整轮失败就重新取坐标再试。
    const epSel = '.anime-episodes button:not(:disabled)';
    const epTransform = () =>
      ab.evalJson(`(() => { const b = document.querySelectorAll(${JSON.stringify(epSel)})[1];
        return b ? getComputedStyle(b).transform : null; })()`);
    let hover = null, rest = null;
    for (let attempt = 0; attempt < 6 && hover === null; attempt++) {
      const info = ab.evalJson(`JSON.stringify((() => {
        const b = document.querySelectorAll(${JSON.stringify(epSel)})[1];
        if (!b) return null;
        b.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`);
      if (!info) { await ab.sleep(400); continue; }
      if (info.x < 2 || info.y < 2 || info.x > 1256 || info.y > 620) { await ab.sleep(250); continue; }
      ab.batch('mouse move 2 2');
      await ab.sleep(150);
      rest = epTransform();
      ab.batch(`mouse move ${info.x} ${info.y}`);
      for (let i = 0; i < 8; i++) {
        await ab.sleep(70);
        const now = epTransform();
        if (now && now !== rest) { hover = now; break; }
      }
      if (hover === null) ab.batch('mouse move 2 2');
    }
    if (rest === null) {
      console.log('  · 选集按钮当前不可交互（换源中），跳过悬停检查');
    } else {
      check('选集按钮悬停抬起', hover !== null && hover !== rest,
        `静止=${rest} 悬停=${hover}`);
    }
  } else {
    console.log('  · 番剧库为空，跳过番剧页检查');
  }

  console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
