import { dbAll, dbDel, dbGet, dbPut } from './idb'
import { clearProgress, getProgress, saveMapping, getMapping } from './settings'
import { SOURCES, sourceId } from './server'
import { player } from './audio'
import { confirmDialog } from './confirm'
import { CONTENT_TYPES } from '../constants'
import { fmtTime, uid, clamp } from '../utils'
import type { BookRecord, MusicRecord, StoreItem, ContentType } from '../types'

export function storedItem(record: any, type: ContentType): StoreItem {
  return {
    id: type === 'music' ? record.sourceUrl || record.audio : record.srcId,
    srcId: record.source,
    localId: record.id,
    type,
    name: record.title || record.name,
    author: record.author,
    cover: record.cover,
    sourceName: record.sourceName || SOURCES.value.find(s => s.id === sourceId(record.source))?.name || '本地收藏',
    duration: record.duration,
    preview: record.preview,
    pageUrl: record.pageUrl,
    parts: record.chapters?.length,
    meta: record.intro || '',
    addedAt: record.addedAt || 0
  }
}

export async function savedContent(type: ContentType): Promise<StoreItem[]> {
  const rows = await dbAll(type === 'music' ? 'music' : 'books')
  return rows
    .filter((row: any) => type === 'music' || (row.type || 'novel') === type)
    .sort((a: any, b: any) => b.addedAt - a.addedAt)
    .map((row: any) => storedItem(row, type))
}

export function progressLabel(item: StoreItem) {
  const p = getProgress()[item.localId as string]
  const meta = CONTENT_TYPES[item.type]
  if (!p) return '未' + meta.verb
  if (item.type === 'music') return `已播放 ${fmtTime(p.time || 0)}`
  return `第 ${p.chIdx + 1} ${meta.part} · ${Math.round(p.pct || 0)}%`
}

const collectionWrites = new Map<string, Promise<any>>()

export async function saveCatalogItem(src: any, item: StoreItem, det: any) {
  const type = item.type || src.type
  const store = type === 'music' ? 'music' : 'books'
  const key = type + ':' + src.id + ':' + item.id
  if (collectionWrites.has(key)) return collectionWrites.get(key)
  const work = (async () => {
    const rows = await dbAll(store)
    const existing = rows.find((row: any) =>
      item.localId ? row.id === item.localId
        : sourceId(row.source) === src.id && (type === 'music' ? (row.sourceUrl || row.audio) : row.srcId) === item.id)
    if (existing) return existing
    const common = {
      id: uid(), source: src.id, sourceName: src.name,
      author: det.author || item.author, cover: det.cover || item.cover, addedAt: Date.now()
    }
    const record = type === 'music'
      ? { ...common, name: det.name || item.name, sourceUrl: item.id, pageUrl: item.pageUrl || '', tags: [], duration: Number(item.duration || 0), preview: !!item.preview }
      : { ...common, srcId: item.id, title: det.name, intro: det.intro || '', charCount: 0, chapters: det.chapters.map((ch: any) => ({ ...ch })), ...(type === 'novel' ? {} : { type }) }
    await dbPut(store, record)
    return record
  })()
  collectionWrites.set(key, work)
  try { return await work } finally { collectionWrites.delete(key) }
}

/** 移除收藏；返回是否已移除。UI 刷新由 lib revision 驱动。 */
export async function removeCollection(record: any, type: ContentType) {
  const ok = await confirmDialog({
    title: '移出收藏',
    message: `将「${record.title || record.name}」移出收藏？${type === 'novel' ? '已缓存正文和情境分析也将删除。' : ''}`,
    okText: '移出', danger: true
  })
  if (!ok) return false
  await dbDel(type === 'music' ? 'music' : 'books', record.id)
  if (type === 'music') {
    if (player.currentMusic?.id === record.id) player.fadeStop()
    const mapping = getMapping()
    Object.keys(mapping).forEach(key => { if (mapping[key] === record.id) delete mapping[key] })
    saveMapping(mapping)
  } else if (type === 'novel') {
    for (const row of await dbAll('analyses').then(rows => rows.filter((r: any) => r.bookId === record.id)))
      await dbDel('analyses', row.key)
  }
  clearProgress(record.id)
  return true
}

export async function openCatalogContent(record: any, type: ContentType) {
  if (!record) throw new Error('这项收藏已被移除')
  if (type === 'music') {
    const { startMusic } = await import('./music')
    return startMusic(record)
  }
  if (type === 'anime') {
    const { startAnime } = await import('./anime')
    return startAnime(record)
  }
  const { useReaderStore } = await import('../stores/reader')
  return useReaderStore().startReading(record.id)
}
