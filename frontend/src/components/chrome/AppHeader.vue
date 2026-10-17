<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../../stores/app'
import { useSearchStore } from '../../stores/search'
import { useLibStore } from '../../stores/lib'
import { settings } from '../../services/settings'
import { player } from '../../services/audio'
import { useSlidingPill } from '../../composables/useSlidingPill'

const app = useAppStore()
const search = useSearchStore()

// 原版 renderStore：发现模式时搜索项高亮
const navOn = (nav: string) => {
  const effective = app.page === 'home' && search.discover ? 'search' : app.page
  return nav === effective
}

const viewModeBtn = computed(() => settings.viewMode === 'grid' ? '☰' : '▦')

/* 分段控件滑动高亮：激活项由 app.page / search.discover 决定，故传入数据来源。
   解构成顶层变量，模板里的字符串 ref 才能绑定到它。 */
const segRef = ref<HTMLElement | null>(null)
const { pill: segPill, pillClass: segPillClass, pillActiveClass, sliding } = useSlidingPill(
  segRef, '.on', 'seg-pill', () => [app.page, search.discover] as const)

function onNav(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest('button[data-nav]') as HTMLElement | null
  if (!b) return
  const nav = b.dataset.nav as string
  if (nav === 'search') { search.openDiscovery(); return }
  if (nav === 'home') search.discover = false
  app.showPage(nav as any)
}

function toggleViewMode() {
  settings.viewMode = settings.viewMode === 'grid' ? 'list' : 'grid'
  // 走 saveSettings 持久化
  import('../../services/settings').then(({ saveSettings }) => saveSettings({ viewMode: settings.viewMode }))
  useLibStore().bump()
}

function onMore(e: MouseEvent) {
  e.stopPropagation()
  const items = [
    { label: '♪  音乐播放器', fn: () => { if (player.currentMusic) app.showPage('music'); else search.openCategory('music') } },
    { label: '🎼 情境配乐', fn: () => app.showPage('cine') },
    { label: '⚙ 设置', fn: () => app.showPage('settings') },
    { sep: true },
    { label: '＋ 导入 txt 小说', fn: () => window.dispatchEvent(new CustomEvent('moyin:import-txt')) },
    { label: settings.theme === 'dark' ? '☀ 浅色模式' : '☾ 深色模式', fn: () => app.toggleTheme() }
  ]
  app.showPop(moreBtn.value!, items)
}

const moreBtn = ref<HTMLElement | null>(null)
</script>

<template>
  <header id="chrome">
    <div class="seg" id="mainSeg" ref="segRef" :class="{ [pillActiveClass]: sliding }" @click="onNav">
      <span :class="segPillClass" ref="segPill" aria-hidden="true" />
      <button data-nav="home" :class="{ on: navOn('home') }">主页</button>
      <button data-nav="library" :class="{ on: navOn('library') }">库墙</button>
      <button data-nav="search" :class="{ on: navOn('search') }" aria-label="搜索" title="搜索">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
      </button>
    </div>
    <div class="chrome-right">
      <button id="btnViewMode" ref="viewBtn" title="切换视图" :class="{ hidden: app.page !== 'library' }" @click="toggleViewMode">{{ viewModeBtn }}</button>
      <button id="btnMore" ref="moreBtn" title="更多" @click="onMore">⋯</button>
    </div>
  </header>
</template>
