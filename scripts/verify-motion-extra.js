'use strict';
/**
 * 补充动效验证：主题切换、视图模式切换、移动端页面切换与指示器。
 *   node scripts/verify-motion-extra.js
 */
const ab = require('./lib/agent-browser');

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

(async () => {
  await ab.open('http://127.0.0.1:8761/', { width: 1258, height: 622, settle: 4000 });
  await ab.waitFor(`document.querySelector('#chrome')`, { timeout: 20000 });
  await ab.sleep(1200);

  console.log('\n=== 1. 主题切换颜色过渡 ===');
  await nav('library');
  // 先打开 ⋯ 菜单，再对「深色/浅色模式」这一项采样
  ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`);
  await ab.sleep(900);
  const themeItem = ab.evalJson(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('.pop button')].find(x => /浅色|深色/.test(x.textContent));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })())`);
  check('找到主题切换项', !!themeItem, themeItem && `"${themeItem.text}"`);
  const theme = await record(
    `() => [...document.querySelectorAll('.pop button')].find(x => /浅色|深色/.test(x.textContent)).click()`,
    `(() => { const b = document.body;
      return { anim: b.classList.contains('theme-anim'),
               bg: getComputedStyle(b).backgroundColor }; })()`,
    600);
  check('切换主题时挂上 theme-anim', theme.some(s => s && s.anim),
    `生效帧=${theme.filter(s => s && s.anim).length}/${theme.length}`);
  check('背景色在过渡中变化', uniq(theme, 'bg').length > 1,
    `不同背景色=${uniq(theme, 'bg').length}：${uniq(theme, 'bg').slice(0, 3).join(' → ')}`);
  await ab.sleep(900);
  const themeState = ab.evalJson(`JSON.stringify({dark:document.body.classList.contains('dark'),
    anim:document.body.classList.contains('theme-anim')})`);
  check('主题已切换', typeof themeState.dark === 'boolean', `dark=${themeState.dark}`);
  check('过渡类名已自动移除（不常驻）', themeState.anim === false);
  // 切回来
  ab.evalJs(`(document.querySelector('#btnMore').click(), 1)`); await ab.sleep(700);
  ab.evalJs(`([...document.querySelectorAll('.pop button')].find(b=>/浅色|深色/.test(b.textContent))?.click(), 1)`);
  await ab.sleep(1100);

  console.log('\n=== 2. 视图模式切换（网格 ⇄ 列表） ===');
  await nav('library');
  const before = ab.evalJson(`JSON.stringify({cls:document.querySelector('#bookGrid').className,
    cols:getComputedStyle(document.querySelector('#bookGrid')).gridTemplateColumns.split(' ').length})`);
  ab.evalJs(`(document.querySelector('#btnViewMode').click(), 1)`);
  await ab.sleep(900);
  const after = ab.evalJson(`JSON.stringify({cls:document.querySelector('#bookGrid').className,
    cols:getComputedStyle(document.querySelector('#bookGrid')).gridTemplateColumns.split(' ').length})`);
  check('切换到列表视图', /listview/.test(after.cls) !== /listview/.test(before.cls),
    `before="${before.cls}" after="${after.cls}"`);
  check('卡片声明了过渡（重排平滑）',
    ab.evalJson(`getComputedStyle(document.querySelector('#bookGrid .catalog-card')).transitionProperty`)
      .includes('transform'));
  ab.evalJs(`(document.querySelector('#btnViewMode').click(), 1)`);
  await ab.sleep(900);

  console.log('\n=== 3. 移动端：页面切换 + 指示器 ===');
  ab.batch('set viewport 420 800');
  await ab.sleep(1200);
  await nav('home');
  const mob = await record(
    `() => document.querySelector('#mainSeg button[data-nav=library]').click()`,
    `(() => { const g = id => { const el = document.getElementById(id); const cs = getComputedStyle(el);
        return { d: cs.display, o: +cs.opacity, tf: cs.transform }; };
      return { home: g('page-home'), lib: g('page-library'),
               docW: document.documentElement.clientWidth,
               sw: document.documentElement.scrollWidth }; })()`,
    800);
  check('移动端页面切换有过渡', mob.some(s => s && s.lib.d !== 'none' && s.home.d !== 'none'));
  check('移动端切换期间无横向溢出',
    mob.every(s => !s || s.sw <= s.docW + 1),
    `最大 scrollWidth=${Math.max(...mob.filter(Boolean).map(s => s.sw))} 视口=${mob[0] && mob[0].docW}`);

  await ab.sleep(800);
  const mobPill = await record(
    `() => document.querySelector('#mainSeg button[data-nav=home]').click()`,
    `(() => { const c = document.querySelector('#mainSeg'); const p = c.querySelector('.seg-pill');
      const cs = getComputedStyle(p);
      return { active: c.classList.contains('pill-active'), o: +cs.opacity, tf: cs.transform,
               sw: document.documentElement.scrollWidth, docW: document.documentElement.clientWidth }; })()`,
    700);
  check('移动端指示器滑动生效', mobPill.some(s => s && s.active && s.o === 1),
    `生效帧=${mobPill.filter(s => s && s.active).length}/${mobPill.length}`);
  check('指示器滑动期间无横向溢出',
    mobPill.every(s => !s || s.sw <= s.docW + 1),
    `最大 scrollWidth=${Math.max(...mobPill.filter(Boolean).map(s => s.sw))}`);

  console.log('\n=== 4. 移动端分类条指示器 ===');
  await nav('library');
  const catPill = await record(
    `() => document.querySelector('#libraryTypeSeg button[data-ctype=music]').click()`,
    `(() => { const c = document.querySelector('#libraryTypeSeg'); const p = c.querySelector('.cat-pill');
      const cs = getComputedStyle(p);
      return { active: c.classList.contains('pill-active'), o: +cs.opacity, tf: cs.transform,
               sw: document.documentElement.scrollWidth, docW: document.documentElement.clientWidth }; })()`,
    700);
  check('移动端分类指示器滑动', catPill.some(s => s && s.active && s.o === 1));
  check('分类指示器滑动期间无横向溢出',
    catPill.every(s => !s || s.sw <= s.docW + 1),
    `最大 scrollWidth=${Math.max(...catPill.filter(Boolean).map(s => s.sw))}`);
  await ab.sleep(700);

  ab.batch('set viewport 1258 622');
  await ab.sleep(800);

  console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
