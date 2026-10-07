import { dbAll, dbDel } from './idb'
import { getStoreSource, HAS_SERVER, initServer, SOURCES } from './server'
import { saveCatalogItem } from './catalog'
import { getProgress, saveProgressRaw, type ProgressEntry } from './settings'
import { useLibStore } from '../stores/lib'
import type { StoreItem, ContentType } from '../types'

/**
 * 首次使用时从在线来源拉取的默认书库。
 * 数组顺序即主页「最近收藏」的展示顺序（addedAt 降序）；
 * lead: true 的条目进度时间最新，会占据主页「继续播放/阅读」位置。
 */
interface SeedSpec {
  type: ContentType
  sources: string[]
  keyword: string
  match: string[]
  pct: number
  time?: number
  lead?: boolean
}

const SEEDS: SeedSpec[] = [
  { type: 'anime', sources: ['kazumi-dm84', 'kazumi-7sefun'], keyword: '傷物語', match: ['铁血', '鉄血', '伤物语', '傷物語'], pct: 1 },
  { type: 'music', sources: ['netease-music'], keyword: '未完成ランデヴー', match: ['未完成ランデヴー', 'ランデヴー', '未完成'], pct: 6, time: 10, lead: true },
  { type: 'anime', sources: ['kazumi-7sefun', 'kazumi-dm84'], keyword: '无职转生', match: ['无职转生：到了异世界', '无职转生 到了异世界', '到了异世界', '无职转生'], pct: 0 },
  { type: 'novel', sources: ['wenku8-opds'], keyword: '败北女角', match: ['败北女角', '败犬女主', '败犬女角', '负けヒロイン'], pct: 0 },
  { type: 'anime', sources: ['kazumi-7sefun', 'kazumi-dm84'], keyword: '缘之空', match: ['缘之空', 'ヨスガ'], pct: 1 },
  { type: 'anime', sources: ['kazumi-7sefun', 'kazumi-dm84', 'kazumi-mxdm'], keyword: '学生会也有洞', match: ['学生会也有洞', '学生会にも穴', '学生会'], pct: 0 },
  { type: 'comic', sources: ['dm5'], keyword: '战姬求生记', match: ['战姬求生', '战姬'], pct: 0 },
  { type: 'novel', sources: ['wenku8-opds'], keyword: '无职转生', match: ['无职转生'], pct: 0 }
]

/** 已完成一次默认书库拉取的标记；非 done 的值是上次尝试时间戳，24 小时内不重复尝试 */
const FLAG = 'nr-demo-seed'

const norm = (s: unknown) => String(s || '').toLowerCase()
  .replace(/[\s《》「」【】〈〉:：·,.，。!！?？~～'"'’"()（）\-—_]/g, '')

function pickMatch(rows: StoreItem[], candidates: string[]): StoreItem | null {
  let best: { item: StoreItem; score: number } | null = null
  for (const row of rows) {
    const n = norm(row.name)
    for (let i = 0; i < candidates.length; i++) {
      if (n.includes(norm(candidates[i])) && (!best || i < best.score)) {
        best = { item: row, score: i }
        break
      }
    }
  }
  return best ? best.item : null
}

/** 在候选来源中依次尝试：搜索 → 标题匹配 → 详情 → 入库；无封面的结果换源重试 */
async function seedOne(spec: SeedSpec, addedAt: number): Promise<any> {
  for (const sid of spec.sources) {
    const src = getStoreSource(sid)
    if (!src) continue
    try {
      const rows = await src.search(spec.keyword)
      const hit = pickMatch(rows, spec.match)
      if (!hit) continue
      const item: StoreItem = { ...hit, type: spec.type, srcId: sid, sourceName: src.name, addedAt }
      const det: any = spec.type === 'music'
        ? { ...item, intro: item.meta || '在线曲目，播放时获取音频。' }
        : await src.detail(hit.id)
      // 没有封面的番剧/漫画宁可换源，保住主页观感；音乐封面缺失不阻塞
      if (spec.type !== 'music' && !det.cover && !item.cover) continue
      return await saveCatalogItem({ id: sid, name: src.name, type: spec.type }, item, det)
    } catch { /* 该来源不可用或未命中，尝试下一个 */ }
  }
  return null
}

function applyProgress(spec: SeedSpec, id: string, now: number) {
  const p = getProgress()
  if (p[id]) return
  const entry: ProgressEntry = { chIdx: 0, pct: spec.pct, ts: now - (spec.lead ? 0 : 60000) }
  if (spec.time != null) entry.time = spec.time
  p[id] = entry
  saveProgressRaw(p)
}

/** 旧版「示例 · 雾海行舟」及其关联数据 */
async function removeLegacySample() {
  await dbDel('books', 'sample')
  const rows = (await dbAll('analyses')) as any[]
  for (const row of rows.filter(r => r.bookId === 'sample')) await dbDel('analyses', row.key)
  const p = getProgress()
  if (p['sample']) { delete p['sample']; saveProgressRaw(p) }
}

/**
 * 启动时调用：仅当书库为空（或只余旧示例书）时，
 * 先清掉旧示例，再在后台从在线来源拉取默认内容；每落库一条即刷新界面。
 * 网络不可用或来源失败时安静跳过，不打扰正常使用。
 */
export async function ensureSeedLibrary() {
  let legacy = false, empty = false
  try {
    const books = await dbAll('books') as any[]
    const music = await dbAll('music')
    legacy = books.length === 1 && books[0].id === 'sample' && !music.length
    empty = !books.length && !music.length
    if (!empty && !legacy) return
    if (legacy) await removeLegacySample()
  } catch (e) { console.warn('书库状态检查失败', e); return }

  const prev = localStorage.getItem(FLAG)
  if (prev === 'done') return
  if (prev && Date.now() - Number(prev) < 24 * 3600 * 1000) return

  // 后台执行：不阻塞主页首屏
  void runSeedBackground()
}

/** 逐条拉取默认内容并入库；测试可直接 await */
export async function runSeedBackground() {
  try {
    if (!HAS_SERVER.value || !SOURCES.value.length) await initServer()
    if (!HAS_SERVER.value) return
    const now = Date.now()
    let added = 0
    for (let i = 0; i < SEEDS.length; i++) {
      const spec = SEEDS[i]
      try {
        const rec: any = await seedOne(spec, now - i * 1000)
        if (rec?.id) { applyProgress(spec, rec.id, now); useLibStore().bump(); added++ }
      } catch (e: any) { console.warn('默认内容跳过', spec.keyword, e?.message || e) }
    }
    localStorage.setItem(FLAG, added ? 'done' : String(Date.now()))
  } catch (e) { console.warn('默认书库拉取失败', e) }
}
