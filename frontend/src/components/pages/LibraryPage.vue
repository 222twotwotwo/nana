<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useSearchStore } from '../../stores/search'
import { useLibStore } from '../../stores/lib'
import { savedContent } from '../../services/catalog'
import { settings } from '../../services/settings'
import { importTxtFile } from '../../services/txt'
import { addMusicFile } from '../../services/music'
import { CONTENT_TYPES } from '../../constants'
import ContentCard from '../common/ContentCard.vue'
import type { StoreItem, ContentType } from '../../types'

const app = useAppStore()
const search = useSearchStore()
const lib = useLibStore()

const items = ref<StoreItem[]>([])
const fileImport = ref<HTMLInputElement | null>(null)
const fileMusic = ref<HTMLInputElement | null>(null)
const addBtn = ref<HTMLElement | null>(null)

const meta = () => CONTENT_TYPES[search.type]

async function load() {
  items.value = await savedContent(search.type)
}

watch(() => [app.page, search.type, lib.rev], async ([page]) => {
  if (page !== 'library') return
  await load()
}, { immediate: true })

watch(() => app.page, p => {
  if (p === 'home') load().catch(() => {})
})

function onCategoryClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('[data-ctype]') as HTMLElement | null
  if (btn) search.openCategory(btn.dataset.ctype as ContentType, 'library')
}

function onAdd(e: MouseEvent) {
  const type = search.type
  if (type === 'novel' || type === 'music') {
    const m = meta()
    app.showPop(addBtn.value!, [
      { label: type === 'novel' ? '导入 TXT 文件' : '导入音频文件', fn: () => (type === 'novel' ? fileImport : fileMusic).value?.click() },
      { label: `搜索${m.label}`, fn: () => search.openDiscovery(type) }
    ])
  } else {
    search.openDiscovery(type)
  }
}

async function onTxt(e: Event) {
  const input = e.target as HTMLInputElement
  for (const f of input.files!) await importTxtFile(f)
  input.value = ''
}

async function onMusic(e: Event) {
  const input = e.target as HTMLInputElement
  for (const f of input.files!) await addMusicFile(f)
  input.value = ''
  app.toast('已加入收藏')
}

window.addEventListener('moyin:import-txt', () => fileImport.value?.click())
</script>

<template>
  <section id="page-library" class="page">
    <div class="page-inner">
      <div class="home-heading">
        <h1 class="big-title">库墙</h1>
        <div class="category-tabs compact" id="libraryTypeSeg" aria-label="收藏分类" @click="onCategoryClick">
          <button v-for="(m, t) in CONTENT_TYPES" :key="t" :data-ctype="t" :class="{ on: search.type === t }"
            :aria-pressed="search.type === t ? 'true' : 'false'">{{ m.label }}</button>
        </div>
      </div>
      <input type="file" id="fileImport" ref="fileImport" accept=".txt" multiple class="hidden" @change="onTxt">
      <input type="file" id="fileMusic" ref="fileMusic" accept="audio/*" multiple class="hidden" @change="onMusic">
      <div class="book-grid" id="bookGrid" :class="{ listview: settings.viewMode === 'list' }">
        <button ref="addBtn" class="library-add" :aria-label="`添加${meta().label}`" :title="`添加${meta().label}`" @click="onAdd">
          <span class="cover"><span aria-hidden="true">＋</span></span>
        </button>
        <ContentCard v-for="item in items" :key="item.localId || item.id" :item="item" @open="search.openStoreModal(item)" />
        <p v-if="!items.length" class="muted store-empty">点击＋添加喜欢的{{ meta().label }}。</p>
      </div>
    </div>
  </section>
</template>
