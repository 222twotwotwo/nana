<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useSearchStore } from '../../stores/search'
import { useLibStore } from '../../stores/lib'
import { savedContent, progressLabel } from '../../services/catalog'
import { dbGet } from '../../services/idb'
import { getProgress } from '../../services/settings'
import { player } from '../../services/audio'
import { SOURCES, HAS_SERVER } from '../../services/server'
import { CONTENT_TYPES } from '../../constants'
import { openCatalogContent } from '../../services/catalog'
import ContentCard from '../common/ContentCard.vue'
import CoverBlock from '../common/CoverBlock.vue'
import type { StoreItem, ContentType } from '../../types'

const app = useAppStore()
const search = useSearchStore()
const lib = useLibStore()

const kwInput = ref<HTMLInputElement | null>(null)
const items = ref<StoreItem[]>([])

const meta = computed(() => CONTENT_TYPES[search.type])
const progress = computed(() => getProgress())

// 原版 renderStore：未搜索时提示来源数量
const statusText = computed(() => {
  if (search.searched || search.loading) return search.status || ''
  const srcs = SOURCES.value.filter(s => s.type === search.type)
  return HAS_SERVER.value
    ? `同时搜索 ${srcs.length} 个${meta.value.label}来源`
    : '在线来源未连接，搜索时将重试连接。已收藏内容可在收藏页打开。'
})

const recent = computed(() => {
  const p = progress.value
  const withProgress = items.value.filter(item => item.localId && p[item.localId])
    .sort((a, b) => (p[b.localId as string].ts || 0) - (p[a.localId as string].ts || 0))
  return withProgress[0] || items.value[0] || null
})
const recentMeta = computed(() => recent.value ? CONTENT_TYPES[recent.value.type] : meta.value)
const recentProgress = computed(() => recent.value && recent.value.localId ? !!progress.value[recent.value.localId] : false)
const recentLabel = computed(() => recent.value ? progressLabel(recent.value) : '')

async function load() {
  const all = (await Promise.all((Object.keys(CONTENT_TYPES) as ContentType[]).map(type => savedContent(type)))).flat()
    .sort((a, b) => b.addedAt - a.addedAt)
  items.value = all
}

watch(() => [app.page, lib.rev], async ([page]) => {
  if (page !== 'home') return
  load()
  if (search.discover) kwInput.value?.focus()
}, { immediate: true })

watch(() => search.discover, async (d) => {
  if (d && app.page === 'home') await load()
})

async function onResume() {
  try {
    if (!recent.value?.localId) return
    if (recent.value.type === 'music') player.ensureCtx()
    const record = await dbGet(recent.value.type === 'music' ? 'music' : 'books', recent.value.localId)
    await openCatalogContent(record, recent.value.type)
  } catch (e: any) { app.toast(e.message) }
}
function onCine() {
  if (!recent.value?.localId) return
  app.cineBookId = recent.value.localId
  app.showPage('cine')
}
</script>

<template>
  <section id="page-home" class="page">
    <div class="page-inner" id="homeBox">
      <div class="home-heading">
        <h1 class="big-title">{{ search.discover ? '搜索' : '主页' }}</h1>
        <div v-if="search.discover" class="category-tabs compact" id="storeTypeSeg" role="tablist" aria-label="搜索分类">
          <button v-for="(m, t) in CONTENT_TYPES" :key="t" type="button" :class="{ on: search.type === t }"
            :aria-pressed="search.type === t ? 'true' : 'false'" @click="search.switchType(t as ContentType)">{{ m.label }}</button>
        </div>
      </div>

      <div id="homeSearch" :class="{ hidden: !search.discover }">
        <form id="storeBar" @submit.prevent="search.doStoreSearch()">
          <input ref="kwInput" type="text" id="storeKw" v-model="search.kw" maxlength="100" aria-label="搜索内容"
            :placeholder="meta.placeholder">
          <button class="btn primary" id="btnStoreSearch" type="submit" :disabled="search.loading">搜索</button>
        </form>
        <div id="storeStatus" class="muted" role="status" aria-live="polite">{{ statusText }}</div>
        <div id="storeErrors" class="muted" role="status">{{ search.error }}</div>
        <div id="storeGrid" class="book-grid">
          <p v-if="!search.items.length" class="muted store-empty">
            {{ search.loading ? '正在搜索…' : search.error || (search.searched ? '没有找到相关内容，换个关键词试试。' : `搜索喜欢的${meta.label}，打开详情后可${meta.verb}或加入收藏。`) }}
          </p>
          <ContentCard v-else v-for="item in search.items" :key="item.srcId + ':' + item.id" :item="item"
            @open="search.openStoreModal(item)" />
        </div>
      </div>

      <div id="homeOverview" :class="{ hidden: search.discover }">
        <div id="homeContinue">
          <template v-if="recent">
            <h2 class="sec-title">{{ recentProgress ? '继续' : '开始' }}{{ recentMeta.verb }}</h2>
            <div class="home-resume" :data-type="recent.type">
              <CoverBlock :title="recent.name || '未命名'" :cover="recent.cover" />
              <div class="resume-copy">
                <h3>{{ recent.name }}</h3>
                <p class="muted">{{ recent.author || recent.sourceName }}</p>
                <p class="resume-progress">{{ recentLabel }}</p>
                <div class="resume-actions">
                  <button class="btn" id="homeResume" @click="onResume">{{ recentProgress ? '继续' : '开始' }}{{ recentMeta.verb }}</button>
                  <button v-if="recent.type === 'novel'" class="btn" id="homeCine" @click="onCine">情境配乐 ♪</button>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="home-empty">
              <h2>收藏喜欢的{{ meta.label }}</h2>
              <p class="muted">找到喜欢的内容，随时回来继续{{ meta.verb }}。</p>
              <div class="resume-actions"><button class="btn" id="homeEmptySearch" @click="search.openDiscovery()">搜索{{ meta.label }}</button></div>
            </div>
          </template>
        </div>
        <div id="homeRecent">
          <template v-if="items.length">
            <div class="section-heading"><h2 class="sec-title">最近收藏</h2></div>
            <div class="home-wall">
              <ContentCard v-for="item in items.slice(0, 16)" :key="item.localId || item.id" :item="item"
                @open="search.openStoreModal(item)" />
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
