'use strict';
/**
 * 生成可视化差异图：把差异像素高亮成红色叠加在旧版截图上，
 * 并可选放大某个区域，便于直接看出「到底哪里不一样」。
 *
 *   node scripts/diff-image.js <页面> [--dir=...] [--crop=x,y,w,h] [--scale=4]
 *
 * 输出：<dir>/<页面>.diff.png（全图叠加）
 *       <dir>/<页面>.crop.png（放大后的两版并排 + 差异）
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};
const PAGE = process.argv[2] || 'reader';
const dir = path.resolve(arg('dir', 'docs/refactor-screens/pixel'));
const scale = Number(arg('scale', 4));

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

/** 写一个 8bit RGB 无压缩(zlib) PNG */
function encodePng(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const a = decodePng(fs.readFileSync(path.join(dir, `${PAGE}.legacy.png`)));
const b = decodePng(fs.readFileSync(path.join(dir, `${PAGE}.vue.png`)));
const { w, h } = a;

// 1) 全图叠加：差异像素标红
const overlay = Buffer.alloc(w * h * 3);
let count = 0;
for (let i = 0; i < w * h; i++) {
  const pa = i * a.ch, pb = i * b.ch;
  const d = Math.abs(a.data[pa] - b.data[pa]) + Math.abs(a.data[pa + 1] - b.data[pa + 1]) + Math.abs(a.data[pa + 2] - b.data[pa + 2]);
  const o = i * 3;
  if (d > 12) { overlay[o] = 255; overlay[o + 1] = 0; overlay[o + 2] = 0; count++; }
  else {
    // 灰度化背景，让红色更醒目
    const g = (a.data[pa] * 0.299 + a.data[pa + 1] * 0.587 + a.data[pa + 2] * 0.114) | 0;
    const v = 210 + (g * 45 / 255) | 0;
    overlay[o] = overlay[o + 1] = overlay[o + 2] = Math.min(255, v);
  }
}
fs.writeFileSync(path.join(dir, `${PAGE}.diff.png`), encodePng(w, h, overlay));
console.log(`全图差异叠加：${PAGE}.diff.png（${count} 个差异像素标红）`);

// 2) 可选：裁剪区域，三栏并排（旧版 | 新版 | 差异），并放大
const cropArg = arg('crop', '');
if (cropArg) {
  const [cx, cy, cw, chh] = cropArg.split(',').map(Number);
  const S = scale, gap = 8 * S;
  const outW = cw * S * 3 + gap * 2;
  const outH = chh * S;
  const buf = Buffer.alloc(outW * outH * 3, 255);
  const put = (src, col, dx) => {
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = cx + x, sy = cy + y;
        if (sx >= src.w || sy >= src.h) continue;
        const si = (sy * src.w + sx) * src.ch;
        for (let dy = 0; dy < S; dy++) {
          for (let dxx = 0; dxx < S; dxx++) {
            const ox = dx + x * S + dxx, oy = y * S + dy;
            const o = (oy * outW + ox) * 3;
            buf[o] = src.data[si]; buf[o + 1] = src.data[si + 1]; buf[o + 2] = src.data[si + 2];
          }
        }
      }
    }
  };
  put(a, 0, 0);
  put(b, 0, cw * S + gap);
  // 差异栏：以旧版为底，差异标红
  const diffSrc = { w, h, ch: 3, data: overlay };
  put(diffSrc, 0, (cw * S + gap) * 2);
  fs.writeFileSync(path.join(dir, `${PAGE}.crop.png`), encodePng(outW, outH, buf));
  console.log(`放大对比（旧版|新版|差异）：${PAGE}.crop.png  区域 x=${cx} y=${cy} ${cw}x${chh} ×${S}`);
}
