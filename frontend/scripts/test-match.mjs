// 临时验证脚本：与 frontend/src/services/anime.ts 中的匹配逻辑保持一致
const CN = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' }
const RM = { 'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5', 'Ⅵ': '6', 'Ⅶ': '7', 'Ⅷ': '8', 'Ⅸ': '9', 'Ⅹ': '10', 'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6', 'ⅶ': '7', 'ⅷ': '8', 'ⅸ': '9', 'ⅹ': '10' }

function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[\s《》「」【】:：·,.，。!！?？~～'"'’\-—_()（）]/g, '')
}
function canonSeason(s) {
  return s
    .replace(/第\s*([0-9一二三四五六七八九十]+)\s*季/g, (_, n) => '季' + (CN[n] || n))
    .replace(/第\s*([0-9一二三四五六七八九十]+)\s*部/g, (_, n) => '季' + (CN[n] || n))
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]/g, m => '季' + RM[m])
    .replace(/第\s*([0-9]+)\s*部分/g, (_, n) => 'p' + n)
    .replace(/part\.?\s*([0-9]+)/gi, (_, n) => 'p' + n)
    .replace(/season\s*([0-9]+)/gi, (_, n) => '季' + n)
}
function titleKey(t) {
  const canon = canonSeason(normalizeTitle(t))
  const tokens = canon.match(/季[0-9]+(?:p[0-9]+)?/g) || []
  const base = canon.replace(/季[0-9]+(?:p[0-9]+)?/g, '')
  return { tokens, base }
}
function sameSeason(a, b) {
  const n = t => (t.length === 1 && t[0] === '季1') ? [] : t
  return JSON.stringify(n(a)) === JSON.stringify(n(b))
}
function matchTitle(candidates, name) {
  const a = titleKey(name)
  if (!a.base) return false
  for (const c of candidates) {
    const b = titleKey(c)
    if (!b.base) continue
    if (a.base === b.base && sameSeason(a.tokens, b.tokens)) return true
    if (a.tokens.join() === b.tokens.join() && a.base.length >= 4 && (a.base.includes(b.base) || b.base.includes(a.base))) return true
  }
  return false
}

const USER = '无职转生Ⅲ 到了异世界就拿出真本事'
const cases = [
  ['无职转生 第三季 ～到了异世界就拿出真本事～', true],
  ['无职转生 第二季 ～到了异世界就拿出真本事～', false],
  ['无职转生 第二季 ～到了异世界就拿出真本事～ 第2部分', false],
  ['无职转生 ～到了异世界就拿出真本事～', false],
  ['【无职转生同人动画】血契之约', false],
  ['无职转生：到了异世界就拿出真本事 OVA', false],
  ['无职转生 第三季 ～到了异世界就拿出真本事～ 第2部分', false]
]
let fail = 0
for (const [name, expect] of cases) {
  const got = matchTitle([USER], name)
  console.log(got === expect ? 'PASS' : 'FAIL', name, '->', got)
  if (got !== expect) fail++
}
const reverse = matchTitle(['无职转生 第二季 ～到了异世界就拿出真本事～ 第2部分'], '无职转生 第二季 ～到了异世界就拿出真本事～')
console.log(reverse === false ? 'PASS' : 'FAIL', '第二季收藏 不匹配 第二季Part.2 ->', reverse)
if (reverse !== false) fail++
console.log(fail ? 'FAILED: ' + fail : 'ALL_PASS')
process.exit(fail ? 1 : 0)
