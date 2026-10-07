import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { watchEffect } from 'vue'
import App from './App.vue'
import './styles/style.css'
import { settings } from './services/settings'
import { ensureSampleBook } from './services/txt'
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

  // 原版启动序列：示例书 → 主页 → 连接来源 → SW
  const appStore = useAppStore()
  const { useLibStore } = await import('./stores/lib')
  await ensureSampleBook()
  appStore.showPage('home')
  useLibStore().bump() // 驱动首页重新加载（此时页面可能已是 home）
  initServer()
  startMediaProgressTicker()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
}

boot()
