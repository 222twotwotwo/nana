import { defineStore } from 'pinia'
import type { PopItem, PageId } from '../types'
import { player } from '../services/audio'
import { settings, saveSettings } from '../services/settings'

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useAppStore = defineStore('app', {
  state: () => ({
    page: 'home' as PageId,
    toastMsg: '',
    toastShow: false,
    pop: null as { anchor: HTMLElement; items: PopItem[] } | null,
    cineBookId: ''
  }),
  actions: {
    toast(msg: string) {
      this.toastMsg = msg
      this.toastShow = true
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { this.toastShow = false }, 2600)
    },
    showPop(anchor: HTMLElement, items: PopItem[]) {
      this.pop = { anchor, items }
    },
    closePop() { this.pop = null },
    toggleTheme() {
      saveSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
    },
    showPage(page: PageId) {
      const search = useSearchStore()
      if (this.page === 'anime' && page !== 'anime') {
        import('../services/anime').then(({ stopAnimeFrom }) => stopAnimeFrom())
      }
      if (this.page !== page) {
        player.playRequest++
        search.closeStoreModal()
      }
      this.page = page
    }
  }
})

import { useSearchStore } from './search'
