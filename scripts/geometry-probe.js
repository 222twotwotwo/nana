'use strict';
/**
 * 几何探针：比对两版关键元素的 getBoundingClientRect 与计算样式。
 * 用途：像素差异里那些零散的小块（疑似文字位移）需要量化确认，
 * 而不是靠肉眼判断。
 *
 *   node scripts/geometry-probe.js [port] [page]
 */
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const PORT = Number(process.argv[2] || 8763);
const PAGE = process.argv[3] || 'reader';
const BASE = `http://127.0.0.1:${PORT}/`;
const q = s => `document.querySelector('${s}')`;
const qa = s => `document.querySelectorAll('${s}')`;

// 注意：dump 是要在**浏览器**里执行的源码，因此不能直接用 Node 的模板插值
// （${q(sel)} 会在 Node 侧求值并因 sel 未定义而报错）。这里用普通字符串拼接，
// 浏览器侧只依赖 document.querySelector。
const READER_DUMP = [
  '(() => {',
  '  const pick = (sel, label) => {',
  '    const el = document.querySelector(sel);',
  '    if (!el) return label + ": 缺失";',
  '    const r = el.getBoundingClientRect();',
  '    const cs = getComputedStyle(el);',
  '    return label + ": x=" + r.x.toFixed(2) + " y=" + r.y.toFixed(2) +',
  '      " w=" + r.width.toFixed(2) + " h=" + r.height.toFixed(2) +',
  '      " font=" + cs.fontSize + "/" + cs.lineHeight +',
  '      " pad=" + cs.padding + " fam=" + cs.fontFamily.split(",")[0];',
  '  };',
  '  const out = [];',
  '  out.push(pick("#readerScroll", "#readerScroll"));',
  '  out.push(pick("#chapterBody", "#chapterBody"));',
  '  out.push(pick("#chapterBody h1", "h1"));',
  '  out.push(pick("#chapterBody .ch-sub", ".ch-sub"));',
  '  out.push(pick("#chapterBody p", "p1"));',
  '  out.push(pick("#chapterBody p:nth-of-type(2)", "p2"));',
  '  out.push(pick("#fabBar", "#fabBar"));',
  '  const sc = document.querySelector("#readerScroll");',
  '  if (sc) out.push("scroll: clientW=" + sc.clientWidth + " clientH=" + sc.clientHeight +',
  '    " scrollW=" + sc.scrollWidth + " scrollH=" + sc.scrollHeight + " top=" + sc.scrollTop +',
  '    " offsetW=" + sc.offsetWidth + " (滚动条 " + (sc.offsetWidth - sc.clientWidth) + "px)");',
  '  return out.join("\\n");',
  '})()'
].join('\n');

const LIBRARY_DUMP = [
  '(() => {',
  '  const pick = (sel, label) => {',
  '    const el = document.querySelector(sel);',
  '    if (!el) return label + ": 缺失";',
  '    const r = el.getBoundingClientRect();',
  '    const cs = getComputedStyle(el);',
  '    return label + ": x=" + r.x.toFixed(2) + " y=" + r.y.toFixed(2) +',
  '      " w=" + r.width.toFixed(2) + " h=" + r.height.toFixed(2) +',
  '      " bg=" + cs.backgroundColor + " font=" + cs.fontSize;',
  '  };',
  '  const out = [];',
  '  out.push(pick(".home-heading", ".home-heading"));',
  '  out.push(pick(".big-title", ".big-title"));',
  '  out.push(pick("#libraryTypeSeg", "#libraryTypeSeg"));',
  '  out.push(pick("#libraryTypeSeg button.on", "tab.on"));',
  '  out.push(pick("#bookGrid", "#bookGrid"));',
  '  out.push(pick("#bookGrid .catalog-card", "card1"));',
  '  out.push(pick("#bookGrid .cover", "cover1"));',
  '  return out.join("\\n");',
  '})()'
].join('\n');

const SEARCH_DUMP = [
  '(() => {',
  '  const pick = (sel, label) => {',
  '    const el = document.querySelector(sel);',
  '    if (!el) return label + ": 缺失";',
  '    const r = el.getBoundingClientRect();',
  '    const cs = getComputedStyle(el);',
  '    return label + ": x=" + r.x.toFixed(2) + " y=" + r.y.toFixed(2) +',
  '      " w=" + r.width.toFixed(2) + " h=" + r.height.toFixed(2) +',
  '      " align=" + cs.textAlign + " font=" + cs.fontSize + " col=" + cs.gridColumn;',
  '  };',
  '  const out = [];',
  '  out.push(pick(".home-heading", ".home-heading"));',
  '  out.push(pick(".big-title", ".big-title"));',
  '  out.push(pick("#homeSearch", "#homeSearch"));',
  '  out.push(pick("#storeBar", "#storeBar"));',
  '  out.push(pick("#storeKw", "#storeKw"));',
  '  out.push(pick("#btnStoreSearch", "#btnStoreSearch"));',
  '  out.push(pick("#storeStatus", "#storeStatus"));',
  '  out.push(pick("#storeGrid", "#storeGrid"));',
  '  out.push(pick("#storeGrid .store-empty", ".store-empty"));',
  '  const g = document.querySelector("#storeGrid");',
  '  if (g) {',
  '    const cs = getComputedStyle(g);',
  '    out.push("grid: cols=" + cs.gridTemplateColumns + " gap=" + cs.gap + " marginTop=" + cs.marginTop);',
  '  }',
  '  return out.join("\\n");',
  '})()'
].join('\n');

const PROBES = {
  reader: {
    steps: [
      [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
      [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
      [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
      [q('#smRead'), `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`]
    ],
    dump: READER_DUMP
  },
  library: {
    steps: [[q('#mainSeg button[data-nav=library]'), q('#bookGrid .catalog-card')]],
    dump: LIBRARY_DUMP
  },
  search: {
    steps: [[q('#mainSeg button[data-nav=search]'), q('#storeKw')]],
    dump: SEARCH_DUMP
  }
};

async function runPage(steps) {
  for (const [clickSel, waitExpr] of steps) {
    if (!await ab.waitFor(clickSel)) throw new Error(`未找到 ${clickSel}`);
    ab.clickExpr(clickSel);
    if (waitExpr && !await ab.waitFor(waitExpr)) throw new Error(`点击后未满足 ${waitExpr}`);
    await ab.sleep(600);
  }
  await ab.sleep(1000);
}

async function capture(mode) {
  await fetch(BASE + '__ab?to=' + mode);
  ab.close();
  await ab.sleep(400);
  await ab.open(BASE, { settle: 1500 });
  ab.evalJs(fixture.installScript());
  ab.batch('open ' + BASE);
  await ab.sleep(3000);
  ab.batch('set viewport 1258 622');
  await ab.sleep(800);
  await runPage(PROBES[PAGE].steps);
  const raw = ab.evalJs(PROBES[PAGE].dump);
  try { return JSON.parse(raw); } catch { return raw; }
}

(async () => {
  const a = await capture('legacy');
  const b = await capture('vue');
  ab.close();
  const la = String(a).split('\n'), lb = String(b).split('\n');
  console.log(`\n=== ${PAGE} 几何/样式对比 ===`);
  console.log('旧版:'.padEnd(6) + '新版:');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    const x = la[i] || '', y = lb[i] || '';
    console.log((x === y ? '  ✓ ' : '  ✗ ') + x);
    if (x !== y) console.log('      ' + y);
  }
})().catch(e => { console.error(e); process.exit(1); });
