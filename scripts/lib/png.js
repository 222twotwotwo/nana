'use strict';
/** PNG 解码 + 像素比较（供各脚本复用） */
const zlib = require('node:zlib');

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
 * 比较两张已解码的图。可选 rect 限定区域。
 * 同时区分「亮度差异」（真实形状/位置变化）与「仅色度差异」（次像素抗锯齿彩边）。
 */
function compareBuffers(a, b, rect) {
  const x0 = rect ? Math.max(0, rect.x) : 0;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const x1 = rect ? Math.min(a.w, rect.x + rect.w) : a.w;
  const y1 = rect ? Math.min(a.h, rect.y + rect.h) : a.h;
  let diff = 0, luma = 0, chroma = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * a.w + x;
      const pa = i * a.ch, pb = i * b.ch;
      const r1 = a.data[pa], g1 = a.data[pa + 1], b1 = a.data[pa + 2];
      const r2 = b.data[pb], g2 = b.data[pb + 1], b2 = b.data[pb + 2];
      const d = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
      total++;
      if (d <= 12) continue;
      diff++;
      const dy = Math.abs(0.299 * (r1 - r2) + 0.587 * (g1 - g2) + 0.114 * (b1 - b2));
      if (dy > 12) luma++; else chroma++;
    }
  }
  return { pixels: total, diff, luma, chroma, pct: diff / Math.max(1, total) * 100 };
}

module.exports = { decodePng, compareBuffers };
