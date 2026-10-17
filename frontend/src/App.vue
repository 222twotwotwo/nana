<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from 'vue'
import { useAppStore } from './stores/app'
import AppHeader from './components/chrome/AppHeader.vue'
import HomePage from './components/pages/HomePage.vue'
import LibraryPage from './components/pages/LibraryPage.vue'
import ReaderPage from './components/pages/ReaderPage.vue'
import MusicPage from './components/pages/MusicPage.vue'
import CinePage from './components/pages/CinePage.vue'
import SettingsPage from './components/pages/SettingsPage.vue'
import AnimePage from './components/pages/AnimePage.vue'
import StoreModal from './components/store/StoreModal.vue'
import AppToast from './components/common/AppToast.vue'
import PopMenu from './components/common/PopMenu.vue'
import AppConfirm from './components/common/AppConfirm.vue'
import MusicFloat from './components/common/MusicFloat.vue'
import { importTxtFile } from './services/txt'
import { usePageTransition } from './composables/usePageTransition'
import { cssTimeMs } from './composables/cssTime'
import type { PageId } from './types'

const app = useAppStore()
// 音乐/番剧/阅读为沉浸式页面：不显示顶部导航，由左上角悬浮返回键承担导航
const CHROME_PAGES = ['home', 'library', 'cine', 'settings']
const chromeVisible = computed(() => CHROME_PAGES.includes(app.page))

/* ---------- 页面切换动画 ---------- */
const pg = usePageTransition(() => app.page)
pg.watchPage()

/** 每个页面根节点的 class：静止态当前页不带类，其余 hidden（与原版一致） */
function pageCls(id: PageId) {
  return pg.pageClass(id)
}

/* ---------- 顶栏高度（折叠动画的 max-height 上限） ----------
   测量前必须临时解除 max-height 夹取：
   被夹住的元素 scrollHeight 会返回「夹取高度与内容高度之间」的中间值
   （实测桌面 56 → 移动端得到 57，而真实自然高度是 58），
   把中间值写回变量就会越测越小并锁死。
   整个测量在同一帧内同步完成（先解除、读值、立刻还原），不会产生闪烁。 */
function measureChrome() {
  const el = document.getElementById('chrome')
  // 折叠态下 padding 被清零，此时测到的是内容高度而非盒高，跳过
  if (!el || !chromeVisible.value) return
  const prev = el.style.maxHeight
  el.style.maxHeight = 'none'
  const h = el.scrollHeight
  el.style.maxHeight = prev
  if (h > 0) document.documentElement.style.setProperty('--chrome-h', h + 'px')
}

onMounted(() => {
  // 拖拽导入 txt（原版全局 drop，主页/书库生效）
  ;['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, (e) => e.preventDefault()))
  document.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault()
    if (app.page !== 'library' && app.page !== 'home') return
    const files = [...(e.dataTransfer?.files || [])].filter(f => /\.txt$/i.test(f.name))
    files.forEach(importTxtFile)
  })

  // 折叠动画要有确定高度：进入沉浸页前先量一次（此时顶栏仍可见）
  watch(chromeVisible, async (visible) => {
    if (!visible) return
    await nextTick()
    measureChrome()
  }, { immediate: true })
  window.addEventListener('resize', measureChrome)
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(measureChrome).catch(() => {})
  }
})

/** 主题切换期间挂上一次性颜色过渡，结束后移除（避免常驻 transition 影响拖拽等交互） */
let themeTimer: ReturnType<typeof setTimeout> | null = null
watch(() => app.themeTick, () => {
  document.body.classList.add('theme-anim')
  if (themeTimer) clearTimeout(themeTimer)
  // 比 --dur-slow 略长，确保过渡跑完再摘掉类名
  themeTimer = setTimeout(() => document.body.classList.remove('theme-anim'), cssTimeMs('--dur-slow', 460) + 60)
})
</script>

<template>
  <AppHeader :class="{ 'chrome-hidden': !chromeVisible }" />
  <main :class="{ 'pg-running': pg.state.running }">
    <HomePage :class="pageCls('home')" />
    <AnimePage :class="pageCls('anime')" />
    <LibraryPage :class="pageCls('library')" />
    <ReaderPage :class="pageCls('reader')" />
    <MusicPage :class="pageCls('music')" />
    <CinePage :class="pageCls('cine')" />
    <SettingsPage :class="pageCls('settings')" />
  </main>
  <StoreModal />
  <AppToast />
  <PopMenu />
  <AppConfirm />
  <MusicFloat />
</template>
