<script setup lang="ts">
import { computed, onMounted } from 'vue'
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
import { importTxtFile } from './services/txt'

const app = useAppStore()
// 音乐/番剧/阅读为沉浸式页面：不显示顶部导航，由左上角悬浮返回键承担导航
const CHROME_PAGES = ['home', 'library', 'cine', 'settings']
const chromeVisible = computed(() => CHROME_PAGES.includes(app.page))

onMounted(() => {
  // 拖拽导入 txt（原版全局 drop，主页/书库生效）
  ;['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, (e) => e.preventDefault()))
  document.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault()
    if (app.page !== 'library' && app.page !== 'home') return
    const files = [...(e.dataTransfer?.files || [])].filter(f => /\.txt$/i.test(f.name))
    files.forEach(importTxtFile)
  })
})
</script>

<template>
  <AppHeader :class="{ hidden: !chromeVisible }" />
  <main>
    <HomePage :class="{ hidden: app.page !== 'home' }" />
    <AnimePage :class="{ hidden: app.page !== 'anime' }" />
    <LibraryPage :class="{ hidden: app.page !== 'library' }" />
    <ReaderPage :class="{ hidden: app.page !== 'reader' }" />
    <MusicPage :class="{ hidden: app.page !== 'music' }" />
    <CinePage :class="{ hidden: app.page !== 'cine' }" />
    <SettingsPage :class="{ hidden: app.page !== 'settings' }" />
  </main>
  <StoreModal />
  <AppToast />
  <PopMenu />
  <AppConfirm />
</template>
