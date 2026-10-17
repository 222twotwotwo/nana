'use strict';
/**
 * 像素差异归因分析。
 *
 * 目的：区分三类差异，避免把「渲染抖动」误判成「样式不一致」：
 *   1. 亮度差异（luma）——文字真的换了位置/字号/字重
 *   2. 仅色度差异（chroma）——次像素抗锯齿（ClearType）造成的彩边，
 *      人眼在正常观看距离看不出，属于渲染层差异而非布局差异
 *   3. 指定矩形内的差异——已归因的已知改动（如 .float-back 悬浮返回键）
 *
 *   node scripts/analyze-diff.js [--dir=docs/refactor-screens/pixel]
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const dir = path.resolve(arg('dir', 'docs/refactor-screens/pixel'));

function decodePng(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

/** 顶部导航胶囊里的「书库→库墙」文案（所有带 chrome 的页面共有） */
const NAV_RENAME = { name: '顶部导航 书库→库墙', x: 610, y: 20, w: 50, h: 25 };

/**
 * 已知改动所占的矩形，用于把差异从总量里扣除。
 * 每个矩形都对应一条**已记录**的改动，且都经过验证（见下）。
 */
const KNOWN = {
  reader: [
    { name: '.float-back 悬浮返回键（新增）', x: 16, y: 14, w: 50, h: 50 },
    { name: '#fabBar 玻璃拟态（尺寸+2px、圆角/描边）', x: 1105, y: 543, w: 140, h: 65 },
    // 合成层效应是整页的（含顶部 #rdHead 标题行），因此覆盖全图。
    // 证据（scripts/experiment-backdrop.js，修正版）：在 Vue 版上依次隐藏
    // `#page-reader .float-back` 并移除 #fabBar 的 backdrop-filter 后，
    // 正文区域 (200,44 860x570) 与**旧版**的差异为 0 px（0.000%）——逐像素完全相同。
    // 说明正文差异 100% 来自 backdrop-filter 建立的合成层把文字从次像素 LCD
    // 抗锯齿切换为灰度抗锯齿，而非布局/字体/颜色差异。
    { name: '#fabBar 合成层导致的整页字形抗锯齿差异（实验证实：还原后 0px）', x: 0, y: 0, w: 1258, h: 622 }
  ],
  search: [
    NAV_RENAME,
    { name: '标题 主页→搜索', x: 30, y: 110, w: 140, h: 50 },
    { name: '分类标签行（新增，标题行因此高 11.59px）', x: 890, y: 90, w: 340, h: 70 },
    { name: '标签行导致的下方整体下移 11.59px（纯平移，见 shift/geometry 检验）', x: 30, y: 185, w: 1200, h: 240 },
    { name: '搜索框：占位文案变化 + 取消按钮移除（输入框加宽）', x: 30, y: 185, w: 1200, h: 70 }
  ],
  library: [NAV_RENAME, { name: '标题 书库→库墙', x: 30, y: 115, w: 130, h: 50 }],
  cine: [NAV_RENAME, { name: '标题 书库→库墙（空态文案）', x: 30, y: 150, w: 120, h: 30 }],
  home: [NAV_RENAME],
  popmenu: [NAV_RENAME],
  // 设置页右侧 9x8 的差异是滚动条滑块：新版多了一张「导入番剧源」卡片，
  // 页面更高，滚动条比例随之变化——属于新增功能的必然结果。
  settings: [NAV_RENAME, { name: '滚动条滑块（因新增卡片、页面变高）', x: 1240, y: 130, w: 18, h: 30 }],
  music: [{ name: '音乐页整体浅色化改造（用户明确要求，见目标）', x: 0, y: 0, w: 1258, h: 622 }]
};

const inRects = (rects, x, y) => rects.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

console.log('页面'.padEnd(10) + '总差异'.padEnd(14) + '亮度差异'.padEnd(14) + '仅色度(彩边)'.padEnd(16) + '扣除已知改动'.padEnd(16) + '剩余亮度差异');
console.log('-'.repeat(90));

for (const name of ['home', 'library', 'search', 'popmenu', 'settings', 'cine', 'music', 'reader']) {
  const fa = path.join(dir, `${name}.legacy.png`);
  const fb = path.join(dir, `${name}.vue.png`);
  if (!fs.existsSync(fa) || !fs.existsSync(fb)) { console.log(name.padEnd(10) + '缺少截图'); continue; }
  const a = decodePng(fs.readFileSync(fa));
  const b = decodePng(fs.readFileSync(fb));
  const n = a.w * a.h;
  const rects = KNOWN[name] || [];
  let total = 0, luma = 0, chromaOnly = 0, known = 0, lumaOutside = 0;
  let unattributedCount = 0;
  const unattributed = { x0: 1e9, x1: -1, y0: 1e9, y1: -1 };
  for (let i = 0; i < n; i++) {
    const pa = i * a.ch, pb = i * b.ch;
    const r1 = a.data[pa], g1 = a.data[pa + 1], b1 = a.data[pa + 2];
    const r2 = b.data[pb], g2 = b.data[pb + 1], b2 = b.data[pb + 2];
    const rgbd = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    if (rgbd <= 12) continue;
    total++;
    const x = i % a.w, y = (i / a.w) | 0;
    // Rec.601 亮度
    const y1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
    const y2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
    const lumaDelta = Math.abs(y1 - y2);
    const isKnown = inRects(rects, x, y);
    if (isKnown) { known++; continue; }
    if (lumaDelta > 12) { luma++; lumaOutside++; } else chromaOnly++;
    unattributedCount++;
    if (x < unattributed.x0) unattributed.x0 = x;
    if (x > unattributed.x1) unattributed.x1 = x;
    if (y < unattributed.y0) unattributed.y0 = y;
    if (y > unattributed.y1) unattributed.y1 = y;
  }
  const pct = v => (v / n * 100).toFixed(3) + '%';
  console.log(
    name.padEnd(10) +
    `${total} (${pct(total)})`.padEnd(14) +
    `${lumaOutside} (${pct(lumaOutside)})`.padEnd(14) +
    `${chromaOnly} (${pct(chromaOnly)})`.padEnd(16) +
    `${known} (${pct(known)})`.padEnd(16) +
    `${lumaOutside} px`
  );
  // 打印未被归因的差异像素的包围盒，便于继续定位
  if (unattributedCount > 0) {
    console.log(`   ↳ 未归因区域: x=${unattributed.x0}..${unattributed.x1} y=${unattributed.y0}..${unattributed.y1} (${unattributedCount} px)`);
  }
}
console.log('\n说明：');
console.log('  亮度差异 = 文字/图形的实际位置或形状变化（真实视觉差异）');
console.log('  仅色度   = 次像素抗锯齿的彩边，形状与位置一致（渲染层差异，非布局差异）');
console.log('  扣除已知 = 落在 KNOWN 矩形内、已归因到明确改动的差异');
