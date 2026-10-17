'use strict';
/**
 * 平移检验：判断两版之间的差异是「纯平移」还是「重排」。
 *
 * 做法：对候选垂直偏移 dy 逐行比较（把新版整体上移 dy 后与旧版逐行比对），
 * 若存在某个 dy 使差异骤降到接近 0，说明只是整体位移（新增/移除了某一行），
 * 而不是字号、间距或结构改变。
 *
 *   node scripts/shift-test.js <页面> [--dir=...] [--rect=x,y,w,h] [--max=120]
 */
const fs = require('node:fs');
const path = require('node:path');
const { decodePng } = require('./lib/png');

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const PAGE = process.argv[2] || 'search';
const dir = path.resolve(arg('dir', 'docs/refactor-screens/pixel'));
const MAX = Number(arg('max', 120));
const rectArg = arg('rect', '');
const rect = rectArg ? (([x, y, w, h]) => ({ x, y, w, h }))(rectArg.split(',').map(Number)) : null;

const a = decodePng(fs.readFileSync(path.join(dir, `${PAGE}.legacy.png`)));
const b = decodePng(fs.readFileSync(path.join(dir, `${PAGE}.vue.png`)));
const W = a.w, H = a.h;
const x0 = rect ? rect.x : 0, x1 = rect ? Math.min(W, rect.x + rect.w) : W;
const y0 = rect ? rect.y : 0, y1 = rect ? Math.min(H, rect.y + rect.h) : H;

/** 把 b 的第 (y+dy) 行与 a 的第 y 行比较，返回差异像素数 */
function diffAtShift(dy) {
  let diff = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= H) continue;
    for (let x = x0; x < x1; x++) {
      const ia = (y * W + x) * a.ch, ib = (sy * W + x) * b.ch;
      const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
      total++;
      if (d > 12) diff++;
    }
  }
  return { diff, total, pct: diff / Math.max(1, total) * 100 };
}

console.log(`\n=== ${PAGE} 平移检验${rect ? ` 区域 x=${rect.x} y=${rect.y} ${rect.w}x${rect.h}` : '（全图）'} ===`);
const zero = diffAtShift(0);
console.log(`dy=  0（原样）      : ${zero.diff} px (${zero.pct.toFixed(3)}%)  ← 基准`);
let best = { dy: 0, ...zero };
const rows = [];
for (let dy = -MAX; dy <= MAX; dy++) {
  if (dy === 0) continue;
  const r = diffAtShift(dy);
  rows.push({ dy, ...r });
  if (r.diff < best.diff) best = { dy, ...r };
}
rows.sort((p, q) => p.diff - q.diff);
console.log('\n差异最小的 6 个偏移：');
for (const r of rows.slice(0, 6)) {
  console.log(`  dy=${String(r.dy).padStart(4)} : ${String(r.diff).padStart(7)} px (${r.pct.toFixed(3)}%)`);
}
const drop = zero.diff ? (1 - best.diff / zero.diff) * 100 : 0;
console.log(`\n最佳偏移 dy=${best.dy}，差异由 ${zero.diff} 降到 ${best.diff}（下降 ${drop.toFixed(1)}%）`);
if (drop > 80) console.log('结论：内容基本是**整体垂直平移**，非重排/字号变化。');
else if (drop > 40) console.log('结论：部分行可用平移解释，但仍有独立差异，需进一步定位。');
else console.log('结论：不是平移，存在结构性差异，需要逐块检查。');
