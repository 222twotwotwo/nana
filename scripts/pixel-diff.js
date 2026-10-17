'use strict';
/**
 * 逐页像素比对：同一个 origin 下，先跑旧版（public/）再跑新版（dist/），
 * 两版写入**同一份确定性数据**（scripts/lib/fixture.js）后截图并统计像素差异。
 *
 *   node scripts/pixel-diff.js [--port=8763] [--out=docs/refactor-screens/pixel]
 *
 * 前置：先启动主服务（8761）与 A/B 服务（node scripts/ab-serve.js 8763 8761）。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ab = require('./lib/agent-browser');
const fixture = require('./lib/fixture');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const PORT = Number(arg('port', 8763));
const OUT = arg('out', 'docs/refactor-screens/pixel');
const BASE = `http://127.0.0.1:${PORT}/`;
const W = 1258, H = 622;

const outDir = path.resolve(OUT);
fs.mkdirSync(outDir, { recursive: true });
const P = p => String(p).replace(/\\/g, '/');
const sleep = ab.sleep;

/* ---------------- 极简 PNG 解码（8bit RGB/RGBA，无隔行） ---------------- */
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
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('仅支持 8bit PNG，实际 ' + bitDepth);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;
  if (ch < 0) throw new Error('不支持的颜色类型 ' + colorType);
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

/**
 * 像素比对。阈值 12（RGB 分量差之和）用于容忍字体栅格/抗锯齿的极小抖动。
 * 另外把差异像素聚成连通区域并输出包围盒，便于逐块归因到具体的已知改动。
 */
function compare(fileA, fileB) {
  const a = decodePng(fs.readFileSync(fileA));
  const b = decodePng(fs.readFileSync(fileB));
  if (a.w !== b.w || a.h !== b.h) return { error: `尺寸不同 ${a.w}x${a.h} vs ${b.w}x${b.h}` };
  const n = a.w * a.h;
  const W = a.w, H = a.h;
  let diff = 0, total = 0;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const pa = i * a.ch, pb = i * b.ch;
    const d = Math.abs(a.data[pa] - b.data[pb]) + Math.abs(a.data[pa + 1] - b.data[pb + 1]) + Math.abs(a.data[pa + 2] - b.data[pb + 2]);
    total += d;
    if (d > 12) { diff++; mask[i] = 1; }
  }
  // 8x8 块级统计
  const BLK = 8;
  const bw = Math.ceil(W / BLK), bh = Math.ceil(H / BLK);
  const blockDiff = new Int32Array(bw * bh);
  for (let i = 0; i < n; i++) if (mask[i]) {
    const x = i % W, y = (i / W) | 0;
    blockDiff[((y / BLK) | 0) * bw + ((x / BLK) | 0)]++;
  }
  let blocks = 0;
  for (let k = 0; k < blockDiff.length; k++) if (blockDiff[k] > (BLK * BLK) / 2) blocks++;

  // 连通区域（4 邻域），按面积排序输出包围盒
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const regions = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0; stack[sp++] = start; seen[start] = 1;
    let minX = W, maxX = -1, minY = H, maxY = -1, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W; }
      if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W; }
    }
    regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  regions.sort((p, q) => q.area - p.area);

  return {
    w: W, h: H, pixels: n, diff,
    pct: diff / n * 100,
    meanDelta: total / n / 3,
    blocks, blocksTotal: bw * bh, blocksPct: blocks / (bw * bh) * 100,
    regions: regions.slice(0, 8)
  };
}

/* ---------------- 逐页脚本（两版 DOM id 一致，同一段可通用） ----------------
 * 每页是一串步骤：[点击表达式, 点击后需等待为真的表达式]。
 * 统一用「表达式 + 轮询」而不是 setTimeout 串联，避免与 Vue 异步渲染打架。 */
const q = s => `document.querySelector('${s}')`;
const qa = s => `document.querySelectorAll('${s}')`;
const popItem = text => `[...${qa('.pop button')}].find(b=>b.textContent.includes('${text}'))`;

const PAGES = [
  ['home', [[q('#mainSeg button[data-nav=home]'), null]]],
  ['library', [[q('#mainSeg button[data-nav=library]'), q('#bookGrid .catalog-card')]]],
  ['search', [[q('#mainSeg button[data-nav=search]'), q('#storeKw')]]],
  ['popmenu', [[q('#btnMore'), q('.pop')]]],
  ['settings', [[q('#btnMore'), q('.pop')], [popItem('设置'), q('#sourceHealth')]]],
  ['cine', [[q('#btnMore'), q('.pop')], [popItem('情境配乐'), q('#cineBox')]]],
  ['music', [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=music]')],
    [q('#libraryTypeSeg button[data-ctype=music]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    [q('#smRead'), `${q('#page-music')} && !${q('#page-music')}.classList.contains('hidden')`]
  ]],
  // 库墙分类是跨页面保持的，必须先显式切回「小说」，否则会打开音乐/漫画的详情
  ['reader', [
    [q('#mainSeg button[data-nav=library]'), q('#libraryTypeSeg button[data-ctype=novel]')],
    [q('#libraryTypeSeg button[data-ctype=novel]'), q('#bookGrid .catalog-card')],
    [q('#bookGrid .catalog-card .catalog-open'), `${q('#storeModal')} && !${q('#storeModal')}.classList.contains('hidden')`],
    [q('#smRead'), `${q('#page-reader')} && !${q('#page-reader')}.classList.contains('hidden')`]
  ]]
];

/** 执行一页的步骤：先等元素出现 → 点击 → 等目标状态为真 */
async function runPage(steps) {
  for (const [clickSel, waitExpr] of steps) {
    if (!await ab.waitFor(clickSel)) throw new Error(`未找到 ${clickSel}`);
    ab.clickExpr(clickSel);
    if (waitExpr && !await ab.waitFor(waitExpr)) throw new Error(`点击后未满足 ${waitExpr}`);
    await sleep(600);
  }
  await sleep(800);
}

async function capture(mode) {
  await fetch(BASE + '__ab?to=' + mode);
  ab.close();
  await sleep(400);
  // 装数据 → 刷新，确保应用带着固定数据启动（新版种子注入会被 nr-demo-seed=done 拦住）
  await ab.open(BASE, { width: W, height: H, settle: 1500 });
  const r = ab.evalJs(fixture.installScript());
  if (!/ok/.test(r)) console.log(`  !! ${mode} 装数据返回: ${r.slice(0, 120)}`);
  ab.batch('open ' + BASE);
  await sleep(3000);
  ab.batch(`set viewport ${W} ${H}`);   // 刷新后固定视口，避免尺寸漂移
  await sleep(800);

  const count = ab.evalJs(`${qa('#bookGrid .catalog-card')}.length`);
  const recent = ab.evalJs(`${qa('#homeRecent .catalog-card')}.length`);
  console.log(`  ${mode}: 库墙 ${count} 张 / 最近收藏 ${recent} 张`);

  for (const [name, steps] of PAGES) {
    try {
      // 每次从主页出发，保证状态干净
      if (!await ab.waitFor(q('#mainSeg button[data-nav=home]'))) throw new Error('主页导航缺失');
      ab.clickExpr(q('#mainSeg button[data-nav=home]'));
      await sleep(600);
      await runPage(steps);
      ab.shot(path.join(outDir, `${name}.${mode}.png`));
    } catch (e) {
      console.log(`  !! ${mode}/${name}: ${e.message}`);
    }
  }
}

async function run() {
  console.log(`agent-browser: ${ab.AGENT_BROWSER}`);
  // 清掉旧截图：否则某一页采集失败时，会拿上一次的残留图做比对
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(outDir, f));
  }
  for (const mode of ['legacy', 'vue']) {
    console.log(`\n采集 ${mode} …`);
    await capture(mode);
  }
  ab.close();

  const report = {};
  console.log('\n=== 逐页像素比对（同源 · 同数据）===');
  console.log('页面'.padEnd(10) + '差异像素'.padEnd(15) + '像素占比'.padEnd(11) + '块差异'.padEnd(15) + '平均色差');
  for (const [name] of PAGES) {
    const a = path.join(outDir, `${name}.legacy.png`);
    const b = path.join(outDir, `${name}.vue.png`);
    if (!fs.existsSync(a) || !fs.existsSync(b)) { console.log(name.padEnd(10) + '缺少截图'); continue; }
    const r = compare(a, b);
    report[name] = r;
    if (r.error) { console.log(name.padEnd(10) + r.error); continue; }
    console.log(
      name.padEnd(10) +
      `${r.diff}/${r.pixels}`.padEnd(15) +
      (r.pct.toFixed(2) + '%').padEnd(11) +
      `${r.blocks}/${r.blocksTotal} (${r.blocksPct.toFixed(1)}%)`.padEnd(15) +
      r.meanDelta.toFixed(2)
    );
  }

  console.log('\n=== 差异区域（按面积排序，便于逐块归因）===');
  for (const [name] of PAGES) {
    const r = report[name];
    if (!r || r.error || !r.regions?.length) continue;
    console.log(`\n【${name}】`);
    for (const g of r.regions) {
      console.log(`  x=${String(g.x).padStart(4)} y=${String(g.y).padStart(4)}  ${String(g.w).padStart(4)}x${String(g.h).padStart(3)}  ${g.area} px`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n截图与报告：${P(outDir)}`);
}

run().catch(e => { console.error(e); process.exit(1); });
