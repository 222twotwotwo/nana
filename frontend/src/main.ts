import { createApp, watch, watchEffect } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/style.css'
import './styles/motion.css'
import { settings } from './services/settings'
import { initServer } from './services/server'
import { startMediaProgressTicker } from './services/music'
import { loadSession, saveSession } from './services/session'
import { useAppStore } from './stores/app'
import { useReaderStore } from './stores/reader'

async function boot() {
  const app = createApp(App)
  app.use(createPinia())

  // 主题跟随设置（原 applyTheme）
  watchEffect(() => {
    document.body.classList.toggle('dark', settings.theme === 'dark')
  })

  app.mount('#app')

  const appStore = useAppStore()
  const readerStore = useReaderStore()
  const { useLibStore } = await import('./stores/lib')
  const { ensureSeedLibrary } = await import('./services/seed')

  // 会话持久化：页面 / 阅读书目 / 章节变化时记录，供刷新后恢复
  watch(
    () => [appStore.page, readerStore.book?.id, readerStore.chIdx] as const,
    ([page, bookId, chIdx]) => {
      if (page === 'reader' && bookId) saveSession({ page: 'reader', bookId, chIdx })
      else saveSession({ page })
    }
  )

  // 启动序列：书库为空时后台从在线来源拉取默认内容
  await ensureSeedLibrary()
  initServer()
  startMediaProgressTicker()

  // 刷新后回到上次的阅读页（同一本书、同一章节），而不是退回首页
  const session = loadSession()
  if (session?.page === 'reader' && session.bookId) {
    await readerStore.startReading(session.bookId, session.chIdx)
  }
  // 只有什么都没恢复（书已删除 / 非阅读页）时才回首页
  if (appStore.page === 'home') {
    appStore.showPage('home')
    saveSession({ page: 'home' })
  }

  useLibStore().bump()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
}

boot()
