import { dbGet, dbPut } from './idb'
import { getStoreSource, initServer, SOURCES } from './server'
import type { BookRecord } from '../types'

const writes = new Map<string, Promise<void>>()
const chapterLoads = new Map<string, Promise<string>>()

export async function saveChapter(book: BookRecord, idx: number, text: string) {
  const work = (writes.get(book.id) || Promise.resolve()).catch(() => {}).then(async () => {
    const current = await dbGet<BookRecord>('books', book.id)
    if (!current) throw new Error('书籍已从书库移除')
    current.chapters[idx].text = text
    current.charCount = current.chapters.reduce((n, c) => n + (c.text?.length || 0), 0)
    await dbPut('books', current)
    book.chapters[idx].text = text
    book.charCount = current.charCount
  })
  writes.set(book.id, work)
  try { await work } finally { if (writes.get(book.id) === work) writes.delete(book.id) }
}

export async function ensureChapterText(book: BookRecord, idx: number): Promise<string> {
  if (book.chapters[idx].text) return book.chapters[idx].text as string
  const key = book.id + ':' + idx
  if (chapterLoads.has(key)) return chapterLoads.get(key) as Promise<string>
  const work = (async () => {
    if (!SOURCES.value.length) await initServer()
    const src = getStoreSource(book.source || '')
    if (!src) throw new Error('来源暂不可用，请启动服务或到主页重新搜索并收藏。已缓存章节仍可阅读。')
    const text = await src.content(book.chapters[idx])
    if (!text || text.length < 80) throw new Error('本章正文为空，请稍后重试或更换来源')
    await saveChapter(book, idx, text)
    return text
  })()
  chapterLoads.set(key, work)
  try { return await work } finally { chapterLoads.delete(key) }
}

export interface CacheProgress { running: boolean; done: number; count: number; failed: number; stop: boolean }

export async function cacheChapters(book: BookRecord, progress: CacheProgress) {
  progress.stop = false
  progress.running = true
  progress.done = 0
  progress.failed = 0
  progress.count = Math.min(50, book.chapters.length)
  for (let i = 0; i < progress.count && !progress.stop; i++) {
    try { await ensureChapterText(book, i) } catch { progress.failed++ }
    progress.done++
    await new Promise(r => setTimeout(r, 300))
  }
  progress.running = false
}
