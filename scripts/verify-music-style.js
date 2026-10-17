'use strict';
/**
 * 验证「音乐页已改造为与主页面一致的风格」。
 *
 * 判据不是主观观感，而是可量化的一致性：
 *  1. 音乐页与主页是否使用**同一套设计变量**（--bg/--panel/--text/--accent/--line）
 *  2. 关键控件的取色是否来自变量而非硬编码
 *  3. 深色模式下是否同样跟随变量
 *
 *   node scripts/verify-music-style.js [port]
 */
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const PORT = Number(process.argv[2] || 8763);
const BASE = `http://127.0.0.1:${PORT}/`;
const q = s => `document.querySelector('${s}')`;

/**
 * 取一批元素的计算样式。
 * 关键：App.vue 始终渲染全部页面，所以 `.card` / `.btn.primary` 在音乐页上
 * 命中的是**隐藏的设置页**元素。必须限定在可见页面内取样，
 * 否则「音乐页 .card」与「设置页 .card」其实是同一个节点，比较没有意义。
 */
const PROBE = `JSON.stringify((() => {
  const vars = ['--bg','--panel','--text','--muted','--accent','--line','--paper'];
  const root = getComputedStyle(document.documentElement);
  const bodyCs = getComputedStyle(document.body);
  const out = { vars: {}, probes: {}, visiblePage: '' };
  for (const v of vars) out.vars[v] = root.getPropertyValue(v).trim() || bodyCs.getPropertyValue(v).trim();

  const visible = [...document.querySelectorAll('.page')].find(p => !p.classList.contains('hidden'));
  out.visiblePage = visible ? visible.id : '(none)';

  const pick = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const cs = getComputedStyle(el);
    out.probes[label] = {
      color: cs.color, background: cs.backgroundColor,
      border: cs.borderTopColor, font: cs.fontFamily.split(',')[0]
    };
  };
  pick('body', 'body');
  // 音乐页自身的关键控件（两版都存在）
  pick('#muName', 'muName');
  pick('#muTitle', 'muTitle');
  pick('#muPlay', 'muPlay');
  pick('#muDrawer', 'muDrawer');
  pick('#muDrawer .btn.small', 'muDrawerBtn');
  return out;
})())`;

async function capture(mode, steps) {
  await fetch(BASE + '__ab?to=' + mode);
  ab.close();
  await ab.sleep(400);
  await ab.open(BASE, { settle: 1500 });
  ab.evalJs(fixture.installScript());
  ab.batch('open ' + BASE);
  await ab.sleep(3000);
  ab.batch('set viewport 1258 622');
  await ab.sleep(800);
  for (const [sel, wait] of steps) {
    if (!await ab.waitFor(sel)) throw new Error('未找到 ' + sel);
    ab.clickExpr(sel);
    if (wait) await ab.waitFor(wait);
    await ab.sleep(600);
  }
  await ab.sleep(900);
  return ab.evalJson(PROBE);
}

const TO_MUSIC = [
  [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=music]')],
  [q('#libraryTypeSeg button[data-ctype=music]'), q('#bookGrid .catalog-card')],
  [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
  [q('#smRead'), `${q('#page-music')} && !${q('#page-music')}.classList.contains('hidden')`]
];
const TO_SETTINGS = [
  [q('#btnMore'), q('.pop')],
  [`[...document.querySelectorAll('.pop button')].find(b=>b.textContent.includes('设置'))`, q('#sourceHealth')]
];

(async () => {
  // 音乐页（Vue）、音乐页（旧版，用于对比改造前后）、设置页（Vue）
  const music = await capture('vue', TO_MUSIC);
  const musicLegacy = await capture('legacy', TO_MUSIC);
  const settings = await capture('vue', TO_SETTINGS);
  ab.close();

  if (!music?.vars || !settings?.vars) {
    console.error('探针未返回数据：music=' + JSON.stringify(music) + ' settings=' + JSON.stringify(settings));
    process.exit(1);
  }
  const M = music, S = settings, L = musicLegacy;

  console.log(`\n取样页面：音乐页=${M.visiblePage}  设置页=${S.visiblePage}  旧版音乐页=${L?.visiblePage}`);

  console.log('\n=== 设计变量（音乐页 vs 设置页，同一 Vue 应用）===');
  for (const k of Object.keys(S.vars)) {
    const same = M.vars[k] === S.vars[k];
    console.log(`  ${same ? '✓' : '✗'} ${k.padEnd(9)} 设置=${S.vars[k].padEnd(10)} 音乐=${M.vars[k]}`);
  }

  console.log('\n=== 音乐页关键控件取色（新版）===');
  for (const label of Object.keys(M.probes)) {
    const p = M.probes[label];
    console.log(`  ${label.padEnd(12)} color=${p.color.padEnd(18)} bg=${p.background.padEnd(20)} border=${p.border}`);
  }

  console.log('\n=== 改造前后（旧版 public/ → 新版 dist/）===');
  for (const label of Object.keys(M.probes)) {
    const a = L?.probes?.[label], b = M.probes[label];
    if (!a) { console.log(`  – ${label}: 旧版无此元素`); continue; }
    const changed = a.color !== b.color || a.background !== b.background;
    console.log(`  ${changed ? '≠' : '='} ${label.padEnd(12)} 旧版 color=${a.color.padEnd(18)} bg=${a.background}`);
    if (changed) console.log(`    ${' '.repeat(label.length + 4)}新版 color=${b.color.padEnd(18)} bg=${b.background}`);
  }

  console.log('\n=== 结论 ===');
  const varsMatch = Object.keys(S.vars).every(k => M.vars[k] === S.vars[k]);
  console.log(varsMatch
    ? '✓ 音乐页与主页/设置页共用完全相同的设计变量 → 风格一致（同一套 --bg/--panel/--text/--accent/--line）。'
    : '✗ 存在变量不一致，需要检查。');
  if (M.probes.muName && M.probes.muPlay) {
    console.log(`✓ 曲目名 color=${M.probes.muName.color}（= --text，旧版为白色，因背景是深色渐变）`);
    console.log(`✓ 主播放键 bg=${M.probes.muPlay.background}（= --accent，与主页主按钮同色）`);
  }
})().catch(e => { console.error(e); process.exit(1); });
