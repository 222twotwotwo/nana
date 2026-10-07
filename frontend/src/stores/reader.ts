import { defineStore } from 'pinia'
import { dbGet } from '../services/idb'
import { clamp } from '../utils'
import { getProgress } from '../services/settings'
import { useAppStore } from './app'
import type { BookRecord, EmotionNode } from '../types'
import { musicState } from '../services/music'

export const useReaderStore = defineStore('reader', {
  state: () => ({
    book: null as BookRecord | null,
    chIdx: 0,
    nodes: [] as EmotionNode[],
    playingEmotion: null as string | null,
    ambOn: false,
    drawerOpen: false,
    menuOpen: false
  }),
  actions: {
    async startReading(bookId: string, chIdx?: number) {
      const book = await dbGet<BookRecord>('books', bookId)
      if (!book) { useAppStore().toast('书籍不存在'); return }
      if (book.type === 'anime') {
        const { startAnime } = await import('../services/anime')
        return startAnime(book)
      }
      const app = useAppStore()
      this.book = book
      const p = getProgress()[bookId]
      this.chIdx = clamp(chIdx != null ? chIdx : (p ? p.chIdx : 0), 0, book.chapters.length - 1)
      this.playingEmotion = null
      this.ambOn = false
      this.drawerOpen = false
      this.menuOpen = false
      app.showPage('reader')
    },
    gotoChapter(idx: number) {
      this.chIdx = idx
      this.playingEmotion = null
    },
    async tryPlayForEmotion(emotion: string) {
      if (!this.ambOn) return
      const { getMapping } = await import('../services/settings')
      const mapping = getMapping()
      const mid = mapping[emotion]
      if (!mid) return
      const music = await dbGet('music', mid)
      if (!music) { useAppStore().toast(`「${emotion}」绑定的曲目已被删除`); return }
      musicState.muSelected = music
      const { player } = await import('../services/audio')
      await player.crossfadeTo(music)
    }
  }
})
