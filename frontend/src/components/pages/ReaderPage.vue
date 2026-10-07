<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useReaderStore } from '../../stores/reader'
import { dbGet, anaKey } from '../../services/idb'
import { getProgress, saveProgress, settings, saveSettings } from '../../services/settings'
import { ensureChapterText } from '../../services/chapters'
import { getStoreSource, initServer, SOURCES } from '../../services/server'
import { player } from '../../services/audio'
import { clamp } from '../../utils'
import type { EmotionNode } from '../../types'

const app = useAppStore()
const reader = useReaderStore()

const scRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

const paged = ref(false)
const fabPct = ref(0)
const menuFontOpen = ref(false)

interface ChapterView {
  mode: 'idle' | 'loading' | 'error' | 'text' | 'comic'
  error: string
  title: string
  sub: string
  paras: string[]
  pageSrc: string[]
  failed: boolean[]
  idx: number
}
const cv = ref<ChapterView>({
  mode: 'idle', error: '', title: '', sub: '', paras: [], pageSrc: [], failed: [], idx: 0
})

const book = computed(() => reader.book)
const isComic = computed(() => book.value?.type === 'comic')
const fabText = computed(() => {
  if (!book.value) return '目录 · 0%'
  return `目录 · ${Math.round((reader.chIdx + fabPct.value / 100) / book.value.chapters.length * 100)}%`
})

/* ---------- 分页布局（原 setReaderLayout） ---------- */
function setReaderLayout() {
  const sc = scRef.value, body = bodyRef.value
  if (!sc || !body) return
  const viewportW = sc.clientWidth || window.innerWidth || 800
  const wantPaged = !body.classList.contains('comic') && viewportW <= 760
  paged.value = wantPaged
  if (!wantPaged) {
    body.style.removeProperty('--reader-column-width')
    body.style.removeProperty('--reader-column-gap')
    return
  }
  const viewportH = sc.clientHeight || window.innerHeight || 600
  const spread = viewportW > viewportH
  const gap = spread ? 42 : 30
  const css = getComputedStyle(body)
  const side = (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0)
  const available = Math.max(280, viewportW - side - (spread ? gap : 0))
  const columnW = spread ? Math.floor(available / 2) : available
  body.style.setProperty('--reader-column-width', columnW + 'px')
  body.style.setProperty('--reader-column-gap', gap + 'px')
}

/* ---------- 章节渲染（原 renderChapter / renderComicChapter） ---------- */
let chapterRequest = 0

async function loadChapter(idx: number) {
  const bk = reader.book
  if (!bk) return
  const request = ++chapterRequest
  reader.menuOpen = false
  if (bk.type === 'comic') return loadComicChapter(idx, request)
  const ch = bk.chapters[idx]
  if (!ch) return
  if (!ch.text && ch.url) {
    cv.value = { ...cv.value, mode: 'loading' }
    try { await ensureChapterText(bk, idx) }
    catch (e: any) {
      if (request !== chapterRequest) return
      cv.value = { ...cv.value, mode: 'error', error: e.message }
      return
    }
  }
  if (request !== chapterRequest || reader.book?.id !== bk.id) return
  const paras = (ch.text || '').split('\n').map(l => l.trim()).filter(Boolean)
  cv.value = {
    mode: 'text', error: '', title: ch.title,
    sub: `《${bk.title}》 · ${idx + 1}/${bk.chapters.length}`,
    paras, pageSrc: [], failed: [], idx
  }
  await nextTick()
  if (request !== chapterRequest) return
  setReaderLayout()
  const an = await dbGet('analyses', anaKey(bk.id, idx))
  if (request !== chapterRequest) return
  reader.nodes = an ? an.nodes : []
  const p = getProgress()[bk.id]
  const sc = scRef.value!
  const pct = p && p.chIdx === idx ? p.pct || 0 : 0
  if (paged.value) {
    sc.scrollTop = 0
    sc.scrollLeft = pct / 100 * Math.max(0, sc.scrollWidth - sc.clientWidth)
  } else {
    sc.scrollLeft = 0
    sc.scrollTop = pct / 100 * Math.max(0, sc.scrollHeight - sc.clientHeight)
  }
  saveProgress(bk.id, idx, p && p.chIdx === idx ? p.pct || 0 : 0)
  fabPct.value = scrollPct()
  updateEmotion(true)
}

async function loadComicChapter(idx: number, request: number) {
  const bk = reader.book!
  const ch = bk.chapters[idx]
  cv.value = {
    mode: 'comic', error: '', title: ch.title,
    sub: `《${bk.title}》 · ${idx + 1}/${bk.chapters.length}`,
    paras: [], pageSrc: [], failed: [], idx
  }
  await nextTick()
  try {
    if (!SOURCES.value.length) await initServer()
    const src = getStoreSource(bk.source || '')
    if (!src) throw new Error('原漫画来源未接入，请到主页重新搜索并收藏。')
    const pages = await src.pages(bk, ch)
    if (request !== chapterRequest || reader.book?.id !== bk.id) return
    cv.value.pageSrc = [...pages]
    cv.value.failed = pages.map(() => false)
    const p = getProgress()[bk.id]
    saveProgress(bk.id, idx, p && p.chIdx === idx ? p.pct || 0 : 0)
    // 首图加载后恢复阅读进度（后续图片懒加载）
    await nextTick()
    const first = bodyRef.value?.querySelector('img')
    const restore = () => {
      if (request !== chapterRequest) return
      const sc = scRef.value
      if (!sc) return
      const pct = p && p.chIdx === idx ? (p.pct || 0) / 100 : 0
      sc.scrollTop = pct * (sc.scrollHeight - sc.clientHeight)
    }
    if (first?.complete) restore()
    else first?.addEventListener('load', restore, { once: true })
  } catch (e: any) {
    if (request !== chapterRequest) return
    cv.value.mode = 'error'
    cv.value.error = e.message
  }
}

function retryPage(i: number) {
  cv.value.pageSrc[i] = cv.value.pageSrc[i].split('&retry=')[0] + '&retry=' + Date.now()
  cv.value.failed[i] = false
}
function retryChapter() { loadChapter(reader.chIdx) }

/* ---------- 章节导航 ---------- */
function navChapter(delta: number) {
  const bk = reader.book
  if (!bk) return
  const next = reader.chIdx + delta
  if (next >= 0 && next < bk.chapters.length) reader.gotoChapter(next)
}
function pickChapter(i: number) { reader.gotoChapter(i) }
function onMenuCine() {
  reader.menuOpen = false
  app.cineBookId = reader.book!.id
  app.showPage('cine')
}

/* ---------- 滚动 / 进度 ---------- */
function scrollPct() {
  const sc = scRef.value
  if (!sc) return 0
  const horizontal = paged.value
  const max = horizontal ? sc.scrollWidth - sc.clientWidth : sc.scrollHeight - sc.clientHeight
  const position = horizontal ? sc.scrollLeft : sc.scrollTop
  return max > 0 ? clamp(position / max * 100, 0, 100) : 0
}

let lastSave = 0, lastEmit = 0
function onScroll() {
  const now = Date.now()
  if (now - lastSave > 600 && reader.book) {
    lastSave = now
    saveProgress(reader.book.id, reader.chIdx, scrollPct())
    fabPct.value = scrollPct()
  }
  if (now - lastEmit > 300) { lastEmit = now; updateEmotion() }
}

function onWheel(e: WheelEvent) {
  if (app.page !== 'reader' || isComic.value || !paged.value) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (!delta) return
  e.preventDefault()
  turnReaderPage(delta > 0 ? 1 : -1)
}

function turnReaderPage(direction: number) {
  const sc = scRef.value
  const bk = reader.book
  if (!sc || !bk || isComic.value) return
  const max = Math.max(0, sc.scrollWidth - sc.clientWidth)
  const atStart = sc.scrollLeft <= 2
  const atEnd = sc.scrollLeft >= max - 2
  if (direction < 0 && atStart && reader.chIdx > 0) { reader.gotoChapter(reader.chIdx - 1); return }
  if (direction > 0 && atEnd && reader.chIdx < bk.chapters.length - 1) { reader.gotoChapter(reader.chIdx + 1); return }
  sc.scrollBy({ left: direction * Math.max(1, sc.clientWidth), behavior: 'smooth' })
}

function onResize() {
  if (app.page !== 'reader' || isComic.value) return
  const pct = scrollPct()
  const sc = scRef.value
  setReaderLayout()
  if (!sc) return
  if (paged.value) sc.scrollLeft = pct / 100 * Math.max(0, sc.scrollWidth - sc.clientWidth)
  else sc.scrollTop = pct / 100 * Math.max(0, sc.scrollHeight - sc.clientHeight)
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

/* ---------- 伴读情绪 ---------- */
function currentEmotionNode(pct: number): EmotionNode | null {
  if (!reader.nodes.length) return null
  let node = reader.nodes[0]
  for (const n of reader.nodes) { if (n.at <= pct + 0.5) node = n; else break }
  return node
}
function updateEmotion(force = false) {
  const node = currentEmotionNode(scrollPct())
  if (!node) { reader.playingEmotion = null; return }
  if (node.emotion !== reader.playingEmotion || force) {
    reader.playingEmotion = node.emotion
    reader.tryPlayForEmotion(node.emotion)
  }
}

function toggleAmb() {
  reader.ambOn = !reader.ambOn
  if (reader.ambOn) {
    player.ensureCtx()
    reader.playingEmotion = null
    updateEmotion(true)
    app.toast('伴读已开启 — 滚动到情绪节点自动切换')
  } else {
    player.fadeStop()
  }
}

function bumpFont(d: number) {
  const v = clamp(settings.fontSize + d, 14, 28)
  saveSettings({ fontSize: v })
}

/* ---------- 生命周期 ---------- */
// 进入阅读页 / 切书：渲染当前章
watch(() => [app.page, reader.book?.id], async ([page]) => {
  if (page !== 'reader' || !reader.book) return
  await loadChapter(reader.chIdx)
  fabPct.value = scrollPct()
}, { immediate: true })

// 章节切换
watch(() => reader.chIdx, () => {
  if (app.page === 'reader' && reader.book) loadChapter(reader.chIdx)
})

// 原版：离开阅读页时关闭菜单
watch(() => app.page, p => { if (p !== 'reader') reader.menuOpen = false })
</script>

<template>
  <section id="page-reader" class="page">
    <button class="float-back" title="返回库墙" aria-label="返回库墙" @click="app.showPage('library')">
      <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <div id="rdHead"><span id="rdHeadTitle"><b>{{ book?.title }}</b> {{ cv.title }}</span></div>
    <div id="readerScroll" ref="scRef" :class="{ 'reader-paged': paged }" @scroll="onScroll" @wheel="onWheel">
      <article id="chapterBody" ref="bodyRef" :class="{ comic: isComic, 'reader-paged': paged }"
        :style="{ fontSize: settings.fontSize + 'px' }">
        <template v-if="cv.mode === 'loading'">
          <p class="muted">正在加载本章…</p>
        </template>
        <template v-else-if="cv.mode === 'error'">
          <p>{{ cv.error }}</p>
          <button class="btn" @click="retryChapter">重试{{ isComic ? '本话' : '本章' }}</button>
        </template>
        <template v-else-if="cv.mode === 'text'">
          <h1>{{ cv.title }}</h1>
          <div class="ch-sub">{{ cv.sub }}</div>
          <p v-for="(p, i) in cv.paras" :key="i">{{ p }}</p>
          <div class="rd-foot">— {{ cv.idx + 1 }} / {{ book?.chapters.length }} —</div>
          <div class="rd-nav">
            <button v-if="cv.idx > 0" class="btn small" @click="navChapter(-1)">上一章</button>
            <button v-if="book && cv.idx < book.chapters.length - 1" class="btn small" @click="navChapter(1)">下一章</button>
          </div>
        </template>
        <template v-else-if="cv.mode === 'comic'">
          <h1>{{ cv.title }}</h1>
          <div class="ch-sub">{{ cv.sub }}</div>
          <div class="comic-wrap" id="comicWrap">
            <template v-if="cv.pageSrc.length">
              <div v-for="(url, i) in cv.pageSrc" :key="i" class="comic-figure">
                <img v-if="!cv.failed[i]" :alt="`${cv.title} · 第 ${i + 1} 页`" :loading="i < 2 ? 'eager' : 'lazy'"
                  :src="url" @error="cv.failed[i] = true">
                <button v-else class="btn" @click="retryPage(i)">第 {{ i + 1 }} 页加载失败，点击重试</button>
              </div>
            </template>
            <p v-else class="muted">正在加载图片…</p>
          </div>
          <div class="rd-nav">
            <button v-if="cv.idx > 0" class="btn small" @click="navChapter(-1)">上一话</button>
            <button v-if="book && cv.idx < book.chapters.length - 1" class="btn small" @click="navChapter(1)">下一话</button>
          </div>
        </template>
      </article>
    </div>
    <aside id="chDrawer" :class="{ open: reader.drawerOpen }">
      <div v-for="(c, i) in book?.chapters || []" :key="i" class="ch-item" :class="{ cur: i === reader.chIdx }"
        @click="pickChapter(i)">{{ c.title }}</div>
    </aside>
    <div id="rdFab">
      <div id="rdMenu" :class="{ hidden: !reader.menuOpen }">
        <div class="rm-row" @click="reader.drawerOpen = !reader.drawerOpen">
          ☰ 章节目录<span class="rm-r">{{ reader.chIdx + 1 }}/{{ book?.chapters.length }}</span>
        </div>
        <div class="rm-sep" />
        <template v-if="!book?.type || book?.type === 'novel'">
          <div class="rm-row" @click="onMenuCine">
            🎼 情境配乐<span class="rm-r">{{ reader.nodes.length ? reader.nodes.length + ' 个节点' : '未分析' }}</span>
          </div>
          <div class="rm-sep" />
        </template>
        <div class="rm-row" @click="menuFontOpen = !menuFontOpen">主题与设置<span class="rm-r">大小</span></div>
        <div class="rm-panel" :class="{ hidden: !menuFontOpen }">
          <div class="row">
            <button class="btn small" @click="bumpFont(-1)">A−</button>
            <button class="btn small" @click="bumpFont(1)">A+</button>
            <div class="grow" />
            <button class="btn small" @click="app.toggleTheme()">{{ settings.theme === 'dark' ? '☀ 浅色' : '☾ 深色' }}</button>
          </div>
        </div>
        <div class="rm-sep" />
        <div class="rm-btns">
          <button id="rmBack" title="返回收藏" @click="reader.menuOpen = false; app.showPage('library')">⤴</button>
          <button id="rmAmb" :class="{ on: reader.ambOn }" title="伴读开关" @click="toggleAmb">♪</button>
          <button id="rmToc2" title="章节列表" @click="reader.drawerOpen = !reader.drawerOpen">☰</button>
        </div>
      </div>
      <div id="fabBar" @click.stop="reader.menuOpen = !reader.menuOpen">
        <span id="fabText">{{ fabText }}</span><span class="fb-ico">☰</span>
      </div>
    </div>
  </section>
</template>
