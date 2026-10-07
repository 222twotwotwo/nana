import { ref } from 'vue'
import type { BookRecord, Chapter, SourceMeta, StoreSource } from '../types'

export const SOURCES = ref<SourceMeta[]>([])
export const HAS_SERVER = ref(false)

const SOURCE_ALIASES: Record<string, string> = {
  'srv:novel:0': 'kuwo', 'srv:novel:1': 'yueyou',
  'srv:comic:0': 'manhuaren', 'srv:comic:1': 'dm5'
}
export const sourceId = (id = '') => SOURCE_ALIASES[id] || id

export async function api(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000)
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || `请求失败 ${r.status}`)
  return d
}

export async function initServer() {
  try {
    SOURCES.value = (await api('/api/sources')).sources
    HAS_SERVER.value = true
  } catch {
    HAS_SERVER.value = false
  }
}

export function mediaUrl(source: string, url: string, referer = '') {
  if (!url) return ''
  return '/api/image?' + new URLSearchParams({ source: sourceId(source), url, referer })
}

export function getStoreSource(id: string): StoreSource | null {
  const meta = SOURCES.value.find(s => s.id === sourceId(id))
  if (!meta) return null
  const action = async (action: string, value: string) =>
    (await api('/api/action', { source: meta.id, action, value })).data
  return {
    ...meta,
    async search(kw: string) {
      return (await action('search', kw)).map((x: any) => ({ ...x, srcId: meta.id, cover: mediaUrl(meta.id, x.cover) }))
    },
    async detail(url: string) {
      const d = await action('detail', url)
      return { ...d, srcId: url, cover: mediaUrl(meta.id, d.cover) }
    },
    async content(ch: Chapter) {
      return (await action('content', ch.url || ch.ref || '')).text
    },
    async pages(book: BookRecord, ch: Chapter) {
      const d = await action('content', ch.url || ch.ref || '')
      return d.images.map((url: string) => mediaUrl(meta.id, url, d.referer))
    }
  }
}
