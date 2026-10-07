export type ContentType = 'novel' | 'comic' | 'music' | 'anime'
export type PageId = 'home' | 'library' | 'anime' | 'music' | 'cine' | 'settings' | 'reader'

export interface Chapter { title: string; text?: string; url?: string; ref?: string; alternatives?: string[] }

export interface BookRecord {
  id: string
  title?: string
  name?: string
  type?: 'novel' | 'comic' | 'anime'
  source?: string
  sourceName?: string
  animeSourceMode?: 'auto' | 'manual'
  author?: string
  cover?: string
  intro?: string
  addedAt?: number
  charCount?: number
  chapters: Chapter[]
  srcId?: string
  pageUrl?: string
  [k: string]: unknown
}

export interface MusicRecord {
  id: string
  name: string
  author?: string
  source?: string
  sourceName?: string
  sourceUrl?: string
  audio?: string
  blob?: Blob
  tags?: string[]
  duration?: number
  preview?: boolean
  size?: number
  addedAt?: number
  pageUrl?: string
  cover?: string
  [k: string]: unknown
}

export interface EmotionNode { at: number; emotion: string; note: string }

export interface AnalysisRecord { key: string; bookId: string; chIdx: number; nodes: EmotionNode[]; ts: number }

export interface SourceMeta {
  id: string
  custom?: boolean
  base?: string
  type: string
  name: string
  status: string
  note?: string
  health?: { checkedAt?: string; ok?: boolean; sample?: string; stage?: string; error?: string; audioBytes?: number; preview?: boolean; chapters?: number } | null
}

export interface StoreItem {
  id: string
  srcId: string
  localId?: string
  type: ContentType
  name: string
  author?: string
  cover?: string
  sourceName?: string
  duration?: number
  preview?: boolean
  pageUrl?: string
  parts?: number
  meta?: string
  addedAt: number
  restricted?: boolean
}

export interface StoreSource {
  id: string
  name: string
  type: string
  search(kw: string): Promise<StoreItem[]>
  detail(url: string): Promise<any>
  content(ch: Chapter): Promise<string>
  pages(book: BookRecord, ch: Chapter): Promise<string[]>
}

export interface PopItem { label?: string; fn?: () => void; danger?: boolean; sep?: boolean }
