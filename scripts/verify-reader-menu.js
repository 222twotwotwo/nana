'use strict';
/**
 * 验证恢复的 #rdMenu 子元素 id 仍可正常交互（第一轮补 id 后不能点坏）。
 *
 * 需要 A/B 对比服务（`node scripts/ab-serve.js`），它才有 `__ab?to=vue` 开关。
 * 起成 serve-legacy.js 时切模式会 404，脚本会静默跑在旧版 public/ 上：
 * 那时这 9 个 id 一个都不存在，断言也就全部落空。因此下面显式校验模式与 id 集合。
 *
 *   node scripts/verify-reader-menu.js [port]
 */
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const PORT = Number(process.argv[2] || 8763);
const BASE = `http://127.0.0.1:${PORT}/`;
const q = s => `document.querySelector('${s}')`;
const IDS = ['rmToc', 'rmCine', 'rmFont', 'rmFontPanel', 'rmfMinus', 'rmfPlus', 'rmfTheme', 'rmAmb', 'rmToc2'];

(async () => {
  // 切到新版 dist/，并确认真的切过去了（否则后面测的是旧版页面）
  let mode;
  try {
    mode = JSON.parse(await (await fetch(BASE + '__ab?to=vue')).text()).mode;
  } catch (e) {
    throw new Error(`无法切换构建模式（${BASE}__ab 不可用）：请先起 node scripts/ab-serve.js。${e.message}`);
  }
  if (mode !== 'vue') throw new Error(`构建模式应为 vue，实际为 ${mode}`);
  console.log('构建模式:', mode);
  ab.close();
  await ab.sleep(400);
  await ab.open(BASE, { settle: 1500 });
  ab.evalJs(fixture.installScript());
  ab.batch('open ' + BASE);
  await ab.sleep(3000);
  ab.batch('set viewport 1258 622');
  await ab.sleep(800);

  for (const [sel, wait] of [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
    [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    [q('#smRead'), `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`]
  ]) { await ab.waitFor(sel); ab.clickExpr(sel); if (wait) await ab.waitFor(wait); await ab.sleep(500); }

  // 注意用 evalJson：agent-browser 的 eval 返回的是结果的 JSON 表示，
  // 字符串结果外面还会再套一层引号，裸 evalJs + JSON.parse 只会得到字符串。
  const ids = ab.evalJson(`JSON.stringify(${JSON.stringify(IDS)}.filter(i=>document.getElementById(i)))`);
  const missing = IDS.filter(i => !ids.includes(i));
  console.log('存在的 id:', JSON.stringify(ids));

  const checks = [];
  const fails = [];
  const state = () => ab.evalJson(`JSON.stringify({
    menuHidden: ${q('#rdMenu')}.classList.contains('hidden'),
    panelHidden: ${q('#rmFontPanel')}.classList.contains('hidden'),
    drawerOpen: ${q('#chDrawer')}.classList.contains('open'),
    fontSize: ${q('#chapterBody')}.style.fontSize,
    ambOn: ${q('#rmAmb')}.classList.contains('on'),
    themeBtn: ${q('#rmfTheme')}.textContent
  })`);
  /** 记录一步，并对该步关心的字段逐条断言 */
  const step = async (label, expect) => {
    const s = await state();
    checks.push([label, s]);
    for (const [k, v] of Object.entries(expect)) {
      if (s[k] !== v) fails.push(`${label}：${k} 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(s[k])}`);
    }
    return s;
  };

  ab.clickExpr(q('#fabBar'));
  await ab.waitFor(`${q('#rdMenu')} && !${q('#rdMenu')}.classList.contains('hidden')`);
  await step('打开菜单', { menuHidden: false, panelHidden: true, drawerOpen: false });

  ab.clickExpr(q('#rmFont'));
  await ab.sleep(500);
  await step('点 #rmFont（展开面板）', { panelHidden: false, fontSize: '20px' });

  ab.clickExpr(q('#rmfPlus'));
  await ab.sleep(500);
  await step('点 #rmfPlus（A+）', { fontSize: '21px' });

  ab.clickExpr(q('#rmfTheme'));
  await ab.sleep(600);
  const dark = await step('点 #rmfTheme（切主题）', { themeBtn: '☀ 浅色' });
  ab.clickExpr(q('#rmfTheme'));
  await ab.sleep(600);
  const back = await state();
  if (back.themeBtn !== '☾ 深色') fails.push(`再点 #rmfTheme：主题未切回，实际 ${JSON.stringify(back.themeBtn)}`);

  ab.clickExpr(q('#rmAmb'));
  await ab.sleep(600);
  await step('点 #rmAmb（伴读开关）', { ambOn: true, themeBtn: '☾ 深色' });

  ab.clickExpr(q('#rmToc2'));
  await ab.sleep(600);
  await step('点 #rmToc2（章节抽屉）', { drawerOpen: true });

  ab.close();
  console.log('\n=== 交互验证 ===');
  for (const [label, s] of checks) console.log(`  ${label.padEnd(24)} → ${JSON.stringify(s)}`);

  if (missing.length) fails.push(`缺少 id：${missing.join(', ')}`);
  if (dark.menuHidden !== false) fails.push('切主题时菜单不应关闭');
  console.log('');
  if (fails.length) {
    for (const f of fails) console.error('  ✗ ' + f);
    console.error(`\n=== 结果：${6 - fails.length} 通过 / ${fails.length} 失败 ===`);
    process.exit(1);
  }
  console.log(`=== 结果：${IDS.length} 个 id 齐全，6 步交互全部符合预期 ===`);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
