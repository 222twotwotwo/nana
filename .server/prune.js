'use strict';
/* ================================================================
   墨音 · 书源清理脚本（prune.js）
   依据 probe.json 的探活结论，从 shuyuan_novel.json / shuyuan_comic.json
   中剔除完全无法使用的源：
     - 站点死亡 / 超时（fetch failed / timeout）
     - 需要浏览器交互验证（searchUrl 为空、Cloudflare 盾）
     - 需要客户端签名（如番茄）
     - API 已退化（接口返回 HTML/404，解析为空）
   仅保留探活全链路可用（ok=true）的源。
   原始合集备份为 *.full.json，探活报告按新下标重排。
   用法：node prune.js [--dry]
================================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DRY = process.argv.includes('--dry');

function loadCollection(file) {
  try {
    const t = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/,\s*([\]}])/g, '$1');
    const d = JSON.parse(t);
    return Array.isArray(d) ? d : (d.data || []);
  } catch (e) { console.log('[prune] 加载失败', file, e.message); return []; }
}

/* 探活结论 → 处置 + 原因归类 */
function classify(p) {
  if (!p) return { keep: true, reason: '未探活（保留观察）' };
  if (p.ok === true) return { keep: true, reason: '全链路可用' };
  const err = String(p.err || '');
  if (err.includes('searchUrl 为空') || /cloudflare|人机|验证/i.test(err))
    return { keep: false, reason: '需要浏览器交互验证' };
  if (err.includes('fetch failed'))
    return { keep: false, reason: '站点死亡（连接失败）' };
  if (err.includes('timeout'))
    return { keep: false, reason: '站点死亡（超时）' };
  if (err.includes('签名') || err.includes('fqapi'))
    return { keep: false, reason: '需要客户端签名' };
  /* 搜索解析为空：API 退化 / 盾拦 / 站点假活，一律视为不可用 */
  return { keep: false, reason: 'API 退化或解析为空（不可用）' };
}

const probe = JSON.parse(fs.readFileSync(path.join(ROOT, 'probe.json'), 'utf8'));
const CATS = [
  { cat: 'novel', file: 'shuyuan_novel.json' },
  { cat: 'comic', file: 'shuyuan_comic.json' },
];

const newProbe = {};
const removed = [];   /* 黑名单：即使恢复 full 备份，server.js 也会据此过滤 */
let totalKeep = 0, totalCut = 0;

for (const { cat, file } of CATS) {
  const defs = loadCollection(file);
  const kept = [];
  const cut = [];
  defs.forEach((d, i) => {
    const key = cat + ':' + i;
    const v = classify(probe[key]);
    const name = d.bookSourceName || ('源' + (i + 1));
    if (v.keep) {
      const ni = kept.length;
      kept.push(d);
      /* 探活报告按剔除后的新下标重排，保证 server.js 索引一致 */
      const np = { ...probe[key] };
      delete np.stage; /* 保留 books/chapters/images 等实测数据 */
      newProbe[cat + ':' + ni] = np;
      newProbe[name] = np;
      console.log(`  保留 ✅ [${cat}:${ni}] ${name} — ${(probe[key] && probe[key].err === '') ? '实测可用' : (probe[key] ? probe[key].err : '未探活')}`);
    } else {
      cut.push({ name, url: d.bookSourceUrl, reason: v.reason, err: probe[key].err });
      removed.push({ cat, name, url: d.bookSourceUrl, reason: v.reason, err: probe[key] ? probe[key].err : '未探活' });
      console.log(`  剔除 ❌ [${key}] ${name}（${d.bookSourceUrl}）— ${v.reason}：${probe[key].err}`);
    }
  });

  /* 备份原始合集（仅首次），再写回剔除后的版本 */
  const fp = path.join(ROOT, file);
  const bak = fp.replace(/\.json$/, '.full.json');
  if (!DRY) {
    if (!fs.existsSync(bak)) { fs.copyFileSync(fp, bak); console.log('  备份原始合集 →', path.basename(bak)); }
    fs.writeFileSync(fp, JSON.stringify(kept, null, 1), 'utf8');
  }
  console.log(`[${file}] 共 ${defs.length} 个源：保留 ${kept.length}，剔除 ${cut.length}\n`);
  totalKeep += kept.length; totalCut += cut.length;
}

if (!DRY) {
  fs.writeFileSync(path.join(ROOT, 'probe.json'), JSON.stringify(newProbe, null, 1), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'removed.json'), JSON.stringify(removed, null, 1), 'utf8');
  console.log(`探活报告已按新下标重写（probe.json），黑名单已写入 removed.json`);
}
console.log(`\n汇总：保留 ${totalKeep} 个可用源，剔除 ${totalCut} 个不可用源${DRY ? '（dry-run，未写盘）' : ''}`);
