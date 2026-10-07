import { reactive } from 'vue'
import { useAppStore } from '../stores/app'
import { useSearchStore } from '../stores/search'
import { SOURCES, getStoreSource, sourceId, initServer } from './server'
import { getProgress } from './settings'
import type { BookRecord, Chapter } from '../types'

let hlsLoader: Promise<any> | null = null

export function loadHls(): Promise<any> {
  if (hlsLoader) return hlsLoader
  hlsLoader = import('hls.js').then(module => module.default).catch(error => { hlsLoader = null; throw error })
  return hlsLoader
}

export const animeState = reactive({
  book: null as BookRecord | null,
  episode: 0,
  resumeTime: 0
})

let animeRequest = 0
let stopHook: (() => void) | null = null

/** 页面组件挂载时注册视频清理逻辑（暂停、销毁 hls、保存进度） */
export function registerAnimeStop(fn: () => void) { stopHook = fn }
export function stopAnimeFrom() { stopHook?.() }
export function bumpAnimeRequest() { return ++animeRequest }
export function currentAnimeRequest() { return animeRequest }

export async function startAnime(book: BookRecord) {
  const progress = getProgress()[book.id]
  const previous = book.chapters[progress?.chIdx || 0]
  const chapters = animeChapters(book.chapters)
  animeState.book = { ...book, title: cleanAnimeTitle(book.title || ''), chapters }
  animeState.episode = Math.max(0, chapters.findIndex(ch => episodeKey(ch.title) === episodeKey(previous?.title || '')))
  animeState.resumeTime = progress?.time || 0
  useSearchStore().type = 'anime'
  useAppStore().showPage('anime')
}

/* ---------- 自动换源 ---------- */

export function cleanAnimeTitle(title: string) { return title.replace(/热度\s*[:：].*$/, '').trim() }

function normalizeTitle(t: unknown) {
  return cleanAnimeTitle(String(t || '')).toLowerCase().replace(/[\s《》「」【】:：·,.，。!！?？~～'"'’\-—_()（）]/g, '')
}

const CN_NUM: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' }
// toLowerCase 会把 Ⅲ 变成小写 ⅲ，因此大小写都要映射
const ROMAN_NUM: Record<string, string> = {
  'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5', 'Ⅵ': '6', 'Ⅶ': '7', 'Ⅷ': '8', 'Ⅸ': '9', 'Ⅹ': '10',
  'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6', 'ⅶ': '7', 'ⅷ': '8', 'ⅸ': '9', 'ⅹ': '10'
}

/** 季标记统一化：Ⅲ / 第三季 / season 3 → 「季3」；Part.2 / 第2部分 → 「p2」，便于跨源比对 */
function canonSeason(s: string) {
  return s
    .replace(/第\s*([0-9]+)\s*部分/g, (_, n: string) => 'p' + n)
    .replace(/第\s*([0-9一二三四五六七八九十]+)\s*季/g, (_, n: string) => '季' + (CN_NUM[n] || n))
    .replace(/第\s*([0-9一二三四五六七八九十]+)\s*部/g, (_, n: string) => '季' + (CN_NUM[n] || n))
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]/g, m => '季' + ROMAN_NUM[m])
    .replace(/part\.?\s*([0-9]+)/gi, (_, n: string) => 'p' + n)
    .replace(/season\s*([0-9]+)/gi, (_, n: string) => '季' + n)
}

/** 标题指纹：{ 主标题, 季标记序列 } */
function titleKey(t: string) {
  const canon = canonSeason(normalizeTitle(t))
  const tokens = canon.match(/季[0-9]+|p[0-9]+/g) || []
  const base = canon.replace(/季[0-9]+|p[0-9]+/g, '')
  return { tokens, base }
}

function sameSeason(a: string[], b: string[]) {
  const norm = (t: string[]) => (t.length === 1 && t[0] === '季1' ? [] : t)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

function titleCandidates(title: string): string[] {
  const full = cleanAnimeTitle(title)
  const noParen = full.replace(/[（(][^)）]*[)）]/g, '').trim()
  return [...new Set([full, noParen].filter(Boolean))]
}

function matchTitle(candidates: string[], name: string): boolean {
  const a = titleKey(name)
  if (!a.base) return false
  for (const c of candidates) {
    const b = titleKey(c)
    if (!b.base) continue
    if (a.base === b.base && sameSeason(a.tokens, b.tokens)) return true
    // 主标题互含且季标记一致（容忍副标题差异）
    if (a.tokens.join() === b.tokens.join() && a.base.length >= 4 && (a.base.includes(b.base) || b.base.includes(a.base))) return true
  }
  return false
}

export interface AltSource {
  source: string
  sourceName: string
  srcId: string
  chapters: Chapter[]
  index: number
}

export interface AnimeAttempt { source: string; name: string; stage: string; message: string }

export function episodeKey(title: string) {
  const text = normalizeTitle(title)
  const number = text.match(/^(?:第)?(\d+)(?:集|话|話)?$/)
  return number ? String(Number(number[1])) : text
}

export function animeChapters(chapters: Chapter[]): Chapter[] {
  const grouped = new Map<string, Chapter>()
  for (const chapter of chapters) {
    const key = episodeKey(chapter.title) || chapter.url || ''
    const existing = grouped.get(key)
    if (!existing) grouped.set(key, { ...chapter, alternatives: [...(chapter.alternatives || [])] })
    else existing.alternatives = [...new Set([...(existing.alternatives || []), chapter.url, ...(chapter.alternatives || [])].filter((url): url is string => !!url && url !== existing.url))]
  }
  return [...grouped.values()]
}

/**
 * 在其他番剧源中搜索同名作品并返回其目录。
 * triedSources 中的源会被跳过；全部失败返回 null。
 */
export async function findAlternativeAnime(book: BookRecord, triedSources: Set<string>, episode: Chapter,
  report: (attempt: AnimeAttempt) => void = () => {}, isCurrent: () => boolean = () => true,
  selectedSource?: string): Promise<AltSource | null> {
  // 页面可能在服务重启窗口加载导致源列表为空，换源前重新拉取
  if (!SOURCES.value.length) await initServer()
  // 健康源优先，减少在已知失效源上浪费时间
  const RANK: Record<string, number> = { healthy: 0, unchecked: 1, stale: 2, failed: 3 }
  const sources = SOURCES.value
    .filter(s => s.type === 'anime' && !triedSources.has(s.id) && (!selectedSource || s.id === sourceId(selectedSource)))
    .sort((a, b) => (RANK[a.status] ?? 1) - (RANK[b.status] ?? 1))
  const candidates = titleCandidates(book.title || '')
  const short = candidates[0]?.split(/第[0-9一二三四五六七八九十]+季|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|season\s*\d+|[:：~～]/i)[0].trim()
  const keywords = [...new Set([...candidates, ...(short && short.length >= 4 ? [short] : [])])]
  let finished = false
  const latest = new Map<string, AnimeAttempt>()
  // Match against the full title, never the shortened search keyword: seasons must agree.
  const attempts = sources.map(async meta => {
    const src = getStoreSource(meta.id)
    const active = () => !finished && isCurrent()
    let failure: AnimeAttempt | undefined
    const note = (stage: string, message: string) => {
      if (active()) {
        const attempt = { source: meta.id, name: meta.name, stage, message }
        if (!message.startsWith('正在')) failure = attempt
        latest.set(meta.id, attempt)
        report(attempt)
      }
    }
    if (!src || !active()) throw new Error('已取消')
    const details = new Set<string>()
    for (const kw of keywords) {
      if (!active()) throw new Error('已取消')
      note('搜索', `正在搜索「${kw}」`)
      try {
        const rows = await src.search(kw)
        if (!active()) throw new Error('已取消')
        const hits = rows.filter(row => matchTitle(candidates, row.name))
        if (!hits.length) note('搜索', '未找到同名同季作品')
        for (const hit of hits) {
          if (details.has(hit.id)) continue
          details.add(hit.id)
          note('目录', '正在读取选集')
          try {
            const det = await src.detail(hit.id)
            if (!active()) throw new Error('已取消')
            const chapters = animeChapters(det?.chapters || [])
            const index = chapters.findIndex(ch => episodeKey(ch.title) === episodeKey(episode.title))
            if (index < 0) { note('目录', '没有对应集数'); continue }
            note('播放', '找到对应集数，正在验证播放')
            for (const pending of latest.values()) {
              if (pending.source !== meta.id && pending.message.startsWith('正在')) report({ ...pending, message: '已有候选源，本轮后续探测已停止' })
            }
            finished = true
            return { source: meta.id, sourceName: meta.name, srcId: hit.id, chapters, index }
          } catch (e: any) { note('目录', e.message) }
        }
      } catch (e: any) { note('搜索', e.message); break }
    }
    if (active()) {
      if (failure) note(failure.stage, failure.message)
      triedSources.add(sourceId(meta.id))
    }
    throw new Error('未找到可用选集')
  })
  try { return await Promise.any(attempts) } catch { return null }
}

