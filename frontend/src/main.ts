import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { watchEffect } from 'vue'
import App from './App.vue'
import './styles/style.css'
import { settings } from './services/settings'
import { initServer } from './services/server'
import { startMediaProgressTicker } from './services/music'
import { useAppStore } from './stores/app'

async function boot() {
  const app = createApp(App)
  app.use(createPinia())

  // 主题跟随设置（原 applyTheme）
  watchEffect(() => {
    document.body.classList.toggle('dark', settings.theme === 'dark')
  })

  app.mount('#app')

  // 启动序列：主页先渲染；书库为空时后台从在线来源拉取默认内容
  const appStore = useAppStore()
  const { useLibStore } = await import('./stores/lib')
  const { ensureSeedLibrary } = await import('./services/seed')
  await ensureSeedLibrary()
  appStore.showPage('home')
  useLibStore().bump() // 驱动首页重新加载（此时页面可能已是 home）
  initServer()
  startMediaProgressTicker()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
}

boot()
