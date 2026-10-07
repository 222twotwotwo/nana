import { defineStore } from 'pinia'
import { player } from '../services/audio'
import { useAppStore } from './app'
import { getStoreSource, initServer, SOURCES, HAS_SERVER, sourceId } from '../services/server'
import { dbAll } from '../services/idb'
import { saveCatalogItem, removeCollection, openCatalogContent } from '../services/catalog'
import { cacheChapters, type CacheProgress } from '../services/chapters'
import { CONTENT_TYPES } from '../constants'
import { musicPageUrl } from '../services/music'
import type { StoreItem, ContentType } from '../types'

type ModalView = 'closed' | 'loading' | 'detail' | 'error'

let searchRequest = 0

interface ModalState {
  view: ModalView
  request: number
  error: string
  item: StoreItem | null
  det: any
  source: any
  saved: any
  type: ContentType
  busy: boolean
  original: string
  cache: CacheProgress
}

function freshCache(): CacheProgress {
  return { running: false, done: 0, count: 0, failed: 0, stop: false }
}

export const useSearchStore = defineStore('search', {
  state: () => ({
    type: 'novel' as ContentType,
    kw: '',
    discover: false,
    loading: false,
    searched: false,
    items: [] as StoreItem[],
    error: '',
    status: '',
    modal: {
      view: 'closed',
      request: 0,
      error: '',
      item: null,
      det: null,
      source: null,
      saved: null,
      type: 'novel',
      busy: false,
      original: '',
      cache: freshCache()
    } as ModalState
  }),
  actions: {
    resetSearch() {
      searchRequest++
      this.closeStoreModal()
      this.loading = false
      this.items = []
      this.error = ''
      this.status = ''
      this.searched = false
    },
    openCategory(type: ContentType, page: 'home' | 'library' = 'home') {
      const app = useAppStore()
      if (!(type in CONTENT_TYPES)) return
      if (this.type !== type) {
        this.resetSearch()
        this.type = type
        this.kw = ''
        player.playRequest++
      }
      app.showPage(page)
    },
    openDiscovery(type?: ContentType) {
      this.discover = true
      this.openCategory((type || this.type) as ContentType)
    },
    closeSearch() {
      this.discover = false
      useLibStore().bump()
    },
    async doStoreSearch() {
      const app = useAppStore()
      const kw = this.kw.trim()
      const type = this.type
      const meta = CONTENT_TYPES[type]
      if (!kw) { app.toast('请输入关键词'); return }
      const request = ++searchRequest
      this.discover = true
      this.loading = true
      this.searched = true
      this.items = []
      this.error = ''
      this.status = '正在连接来源…'
      try {
        if (!HAS_SERVER.value || !SOURCES.value.length) await initServer()
        if (request !== searchRequest) return
        const srcs = SOURCES.value.filter(s => s.type === type)
        if (!HAS_SERVER.value || !srcs.length) throw new Error(`暂无可用${meta.label}来源，请稍后重试`)
        let complete = 0
        const failed: string[] = []
        const seen = new Set<string>()
        await Promise.all(srcs.map(async source => {
          try {
            const rows = await getStoreSource(source.id)!.search(kw)
            if (request !== searchRequest || this.type !== type) return
            for (const item of rows) {
              const key = source.id + ':' + item.id
              if (seen.has(key)) continue
              seen.add(key)
              this.items.push({ ...item, type, srcId: source.id, sourceName: source.name })
            }
          } catch (error: any) {
            failed.push(source.name + '：' + error.message)
          } finally {
            complete++
            if (request === searchRequest && this.type === type) {
              this.status = `找到 ${this.items.length} ${meta.unit} · 已完成 ${complete}/${srcs.length} 个来源${failed.length ? `，${failed.length} 个来源暂不可用` : ''}`
              this.error = failed.join('；')
            }
          }
        }))
        if (request !== searchRequest) return
        const norm = (s: string) => String(s || '').toLocaleLowerCase().replace(/[\s《》「」【】:：·,.，。!?！？]/g, '')
        const rank = (item: StoreItem) => {
          const n = norm(item.name), k = norm(kw)
          return n === k ? 0 : n.startsWith(k) ? 1 : n.includes(k) ? 2 : 3
        }
        this.items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'))
      } catch (e: any) {
        if (request === searchRequest) this.error = e.message
      } finally {
        if (request === searchRequest) this.loading = false
      }
    },
    closeStoreModal() {
      this.modal.request++
      this.modal.cache.stop = true
      this.modal.view = 'closed'
      this.modal.det = null
      this.modal.saved = null
      this.modal.item = null
    },
    async openStoreModal(item: StoreItem) {
      const modal = this.modal
      const request = ++modal.request
      const src = getStoreSource(item.srcId)
      const type = (item.type || src?.type || this.type) as ContentType
      modal.view = 'loading'
      try {
        const rows = await dbAll(type === 'music' ? 'music' : 'books')
        const saved: any = rows.find((row: any) =>
          item.localId ? row.id === item.localId
            : sourceId(row.source) === src?.id && (type === 'music' ? (row.sourceUrl || row.audio) : row.srcId) === item.id)
        if (request !== modal.request) return
        if (item.localId && !saved) throw new Error('这项收藏已被移除')
        if (!saved && !src) throw new Error('该来源未连接，请稍后重试')
        const source: any = src || { id: saved.source, name: saved.sourceName || '本地收藏', type }
        const det = saved
          ? { ...saved, name: saved.title || saved.name }
          : type === 'music'
            ? { ...item, intro: item.restricted ? '原站可能限制播放，可前往原站查看。' : item.preview ? '此曲目为试听片段。' : item.meta || '在线曲目，播放时获取音频。' }
            : await source.detail(item.id)
        if (request !== modal.request) return
        modal.view = 'detail'
        modal.item = item
        modal.det = det
        modal.source = source
        modal.saved = saved
        modal.type = type
        modal.busy = false
        modal.original = musicPageUrl(item.pageUrl || saved?.pageUrl || item.id)
        modal.cache = freshCache()
      } catch (e: any) {
        if (request !== modal.request) return
        modal.view = 'error'
        modal.error = e.message
      }
    },
    async saveFromModal(): Promise<any> {
      const modal = this.modal
      const saved = await saveCatalogItem(modal.source, { ...(modal.item as StoreItem), type: modal.type }, modal.det)
      modal.saved = saved
      return saved
    },
    async saveButton() {
      const app = useAppStore()
      const modal = this.modal
      modal.busy = true
      try {
        await this.saveFromModal()
        if (app.page === 'home') useLibStore().bump()
        app.toast('已加入收藏')
      } catch (e: any) {
        app.toast(e.message)
      } finally {
        modal.busy = false
      }
    },
    async readButton() {
      const app = useAppStore()
      const modal = this.modal
      const myRequest = modal.request
      modal.busy = true
      try {
        if (modal.type === 'music') player.ensureCtx()
        const record = await this.saveFromModal()
        if (modal.request !== myRequest) return
        this.closeStoreModal()
        await openCatalogContent(record, modal.type)
      } catch (e: any) {
        app.toast(e.message)
        modal.busy = false
      }
    },
    async removeButton() {
      const modal = this.modal
      const ok = await removeCollection(modal.saved, modal.type)
      if (ok) {
        this.closeStoreModal()
        useLibStore().bump()
      }
      return ok
    },
    async cacheButton() {
      const modal = this.modal
      const myRequest = modal.request
      modal.busy = true
      try {
        const record = await this.saveFromModal()
        if (modal.request !== myRequest) return
        await cacheChapters(record, modal.cache)
        useAppStore().toast(`${modal.cache.stop ? '已停止' : '缓存完成'}：${modal.cache.done - modal.cache.failed} 章可离线阅读${modal.cache.failed ? `，${modal.cache.failed} 章待重试` : ''}`)
      } catch (e: any) {
        useAppStore().toast(e.message)
      } finally {
        modal.busy = false
      }
    },
    retryModal() {
      if (this.modal.item) this.openStoreModal(this.modal.item)
    }
  }
})

import { useLibStore } from './lib'
