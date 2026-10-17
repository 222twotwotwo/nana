<script setup lang="ts">
import AppIcon from '../common/AppIcon.vue'
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
const pageIndex = ref(0)
const pageCount = ref(1)
const pageWidth = ref(0)
const turning = ref(false)
const turnDirection = ref<1 | -1>(1)
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
// 原版只在正文渲染时写 fontSize，漫画会清掉（renderComicChapter 的 body.style.fontSize=''）
const bodyStyle = computed(() => isComic.value ? {} : { fontSize: settings.fontSize + 'px' })
const fabText = computed(() => {
  if (!book.value) return '目录 · 0%'
  return `目录 · ${Math.round((reader.chIdx + fabPct.value / 100) / book.value.chapters.length * 100)}%`
})

/* ---------- 分页布局 ---------- */
function setReaderLayout() {
  const sc = scRef.value, body = bodyRef.value
  if (!sc || !body || !sc.clientWidth || !sc.clientHeight) return
  const viewportW = sc.clientWidth
  const viewportH = sc.clientHeight
  // 触屏手机旋转后仍分页；桌面宽屏保留纵向阅读。
  const wantPaged = !isComic.value && (viewportW <= 760 ||
    (window.matchMedia('(pointer: coarse)').matches && Math.min(viewportW, window.innerHeight) <= 760))
  paged.value = wantPaged
  // 同步 class 后再测量，避免读到上一个模式的 padding / height。
  sc.classList.toggle('reader-paged', wantPaged)
  body.classList.toggle('reader-paged', wantPaged)
  if (!wantPaged) {
    body.style.removeProperty('--reader-column-width')
    body.style.removeProperty('--reader-column-gap')
    body.style.removeProperty('width')
    pageCount.value = 1
    pageIndex.value = 0
    return
  }
  const css = getComputedStyle(body)
  const side = (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0)
  const spread = viewportW >= 700 && viewportW > viewportH
  // 列间距等于左右留白之和，确保一页（横屏两列）的步进恰好是屏宽。
  const gap = side
  const columnW = (viewportW - side - (spread ? gap : 0)) / (spread ? 2 : 1)
  body.style.setProperty('--reader-column-width', columnW + 'px')
  body.style.setProperty('--reader-column-gap', gap + 'px')
  body.style.width = viewportW + 'px'
  pageWidth.value = viewportW
  pageCount.value = Math.max(1, Math.ceil((body.scrollWidth - 1) / viewportW))
}

/* ---------- 章节切换动画（原 renderChapter / renderComicChapter） ---------- */
let chapterRequest = 0
let restoring = false
let chapterEntry: 'start' | 'end' | null = null

/**
 * 正文换章时的淡入。
 *
 * 用 Web Animations API 而不是 CSS 动画或 :key 重建元素：
 * - #chapterBody 是 CSS 多列容器，重建 DOM 会让 setReaderLayout 写入的
 *   列宽变量与滚动位置恢复时机错位；
 * - 只做 opacity 不做位移：transform 会改变元素的滚动溢出区域，
 *   而紧随其后的 scrollTop/scrollLeft 恢复依赖 scrollWidth/scrollHeight，
 *   位移会让分页位置算错。
 */
function playChapterIn() {
  const el = bodyRef.value
  if (!el || typeof el.animate !== 'function') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  el.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' }
  )
}

async function loadChapter(idx: number) {
  const bk = reader.book
  if (!bk) return
  stopPageTurn()
  restoring = true
  const entry = chapterEntry
  chapterEntry = null
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
      restoring = false
      await nextTick()
      setReaderLayout()
      await nextTick()
      restorePosition(0)
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
  await nextTick()
  const an = await dbGet('analyses', anaKey(bk.id, idx))
  if (request !== chapterRequest) return
  reader.nodes = an ? an.nodes : []
  const p = getProgress()[bk.id]
  const pct = entry === 'end' ? 100 : entry === 'start' ? 0 : p && p.chIdx === idx ? p.pct || 0 : 0
  restorePosition(pct)
  restoring = false
  persistProgress()
  playChapterIn()
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
  playChapterIn()
  await nextTick()
  // 漫画不做分页排版：清掉可能残留的 reader-paged 列宽（原版 renderComicChapter 的 setReaderLayout）
  setReaderLayout()
  // 漫画没有情绪节点，清空上一本书残留的节点，避免滚动时误触发伴读配乐
  reader.nodes = []
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
  restoring = false
  updateEmotion(true)
}

function retryPage(i: number) {
  cv.value.pageSrc[i] = cv.value.pageSrc[i].split('&retry=')[0] + '&retry=' + Date.now()
  cv.value.failed[i] = false
}
function retryChapter() { loadChapter(reader.chIdx) }

/* ---------- 点击正文区域自动折叠多余 UI ---------- */
function onReaderClick(e: MouseEvent) {
  if (Date.now() < suppressClickUntil || window.getSelection()?.type === 'Range') return
  if ((e.target as HTMLElement).closest('button, a, input')) return
  if (reader.drawerOpen || reader.menuOpen) {
    reader.drawerOpen = false
    reader.menuOpen = false
    menuFontOpen.value = false
    return
  }
  if (!paged.value || !e.detail) return
  const rect = scRef.value!.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  if (x < 0.28) turnReaderPage(-1)
  else if (x > 0.72) turnReaderPage(1)
  else reader.menuOpen = true
}

/* ---------- 章节导航 ---------- */
function navChapter(delta: number) {
  const bk = reader.book
  if (!bk) return
  const next = reader.chIdx + delta
  if (next >= 0 && next < bk.chapters.length) {
    persistProgress()
    chapterEntry = 'start'
    reader.gotoChapter(next)
  }
}
function pickChapter(i: number) {
  reader.drawerOpen = false
  if (i !== reader.chIdx) { persistProgress(); chapterEntry = 'start'; reader.gotoChapter(i) }
}
function toggleDrawer() {
  if (reader.drawerOpen) { reader.drawerOpen = false; return }
  // 打开章节抽屉时收起浮动菜单，避免两层悬浮 UI 同时遮挡正文
  reader.menuOpen = false
  menuFontOpen.value = false
  reader.drawerOpen = true
}
function onMenuCine() {
  reader.menuOpen = false
  app.cineBookId = reader.book!.id
  app.showPage('cine')
}

/* ---------- 滚动 / 进度 ---------- */
function scrollPct() {
  const sc = scRef.value
  if (!sc) return 0
  if (paged.value) return pageCount.value > 1 ? pageIndex.value / (pageCount.value - 1) * 100 : 0
  const max = sc.scrollHeight - sc.clientHeight
  const position = sc.scrollTop
  return max > 0 ? clamp(position / max * 100, 0, 100) : 0
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persistProgress() {
  clearTimeout(saveTimer)
  if (restoring || !reader.book || cv.value.idx !== reader.chIdx || !['text', 'comic'].includes(cv.value.mode)) return
  fabPct.value = scrollPct()
  saveProgress(reader.book.id, cv.value.idx, fabPct.value)
}

function onScroll() {
  if (restoring || turning.value || gesture) return
  if (paged.value) pageIndex.value = clamp(Math.round(scRef.value!.scrollLeft / pageWidth.value), 0, pageCount.value - 1)
  fabPct.value = scrollPct()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { persistProgress(); updateEmotion() }, 160)
}

let lastWheel = 0
function onWheel(e: WheelEvent) {
  if (app.page !== 'reader' || isComic.value || !paged.value) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (!delta) return
  e.preventDefault()
  const now = Date.now()
  const elapsed = now - lastWheel
  lastWheel = now
  if (elapsed < 180 || reader.menuOpen || reader.drawerOpen) return
  turnReaderPage(delta > 0 ? 1 : -1)
}

let turnFrame = 0
let suppressClickUntil = 0
let gesture: { id: number; x: number; y: number; left: number; time: number; dragging: boolean } | null = null

function stopPageTurn() {
  cancelAnimationFrame(turnFrame)
  turnFrame = 0
  turning.value = false
  if (gesture && scRef.value?.hasPointerCapture(gesture.id)) scRef.value.releasePointerCapture(gesture.id)
  gesture = null
}

function animateToPage(index: number, direction?: number) {
  const sc = scRef.value
  if (!sc) return
  stopPageTurn()
  const fromIndex = pageIndex.value
  pageIndex.value = clamp(index, 0, pageCount.value - 1)
  turnDirection.value = (direction ?? pageIndex.value - fromIndex) < 0 ? -1 : 1
  const from = sc.scrollLeft, to = pageIndex.value * pageWidth.value
  const finish = () => {
    sc.scrollLeft = to
    turning.value = false
    turnFrame = 0
    persistProgress()
    updateEmotion()
  }
  if (Math.abs(from - to) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
  turning.value = true
  const start = performance.now()
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / 300)
    sc.scrollLeft = from + (to - from) * (1 - Math.pow(1 - t, 3))
    if (t < 1) turnFrame = requestAnimationFrame(frame)
    else finish()
  }
  turnFrame = requestAnimationFrame(frame)
}

function turnReaderPage(direction: number) {
  const bk = reader.book
  if (!bk || !paged.value || turning.value || restoring || cv.value.mode !== 'text') return
  const next = pageIndex.value + direction
  if (next < 0 || next >= pageCount.value) {
    const chapter = reader.chIdx + direction
    if (chapter >= 0 && chapter < bk.chapters.length) {
      persistProgress()
      chapterEntry = direction < 0 ? 'end' : 'start'
      reader.gotoChapter(chapter)
    } else animateToPage(pageIndex.value)
    return
  }
  animateToPage(next, direction)
}

function onPointerDown(e: PointerEvent) {
  if (!e.isPrimary) { if (gesture) animateToPage(pageIndex.value); return }
  if (!paged.value || restoring || turning.value || reader.menuOpen || reader.drawerOpen || e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, a, input') || window.getSelection()?.type === 'Range') return
  gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, left: pageIndex.value * pageWidth.value, time: performance.now(), dragging: false }
}

function onPointerMove(e: PointerEvent) {
  if (!gesture || gesture.id !== e.pointerId) return
  const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y
  if (!gesture.dragging) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
    if (Math.abs(dy) > Math.abs(dx) || window.getSelection()?.type === 'Range' || performance.now() - gesture.time > 500) { gesture = null; return }
    gesture.dragging = true
    scRef.value!.setPointerCapture(e.pointerId)
  }
  e.preventDefault()
  scRef.value!.scrollLeft = clamp(gesture.left - dx, 0, (pageCount.value - 1) * pageWidth.value)
}

function onPointerUp(e: PointerEvent) {
  if (!gesture || gesture.id !== e.pointerId) return
  const { x, time, dragging } = gesture
  stopPageTurn()
  if (!dragging) return
  suppressClickUntil = Date.now() + 400
  const dx = e.clientX - x
  const elapsed = performance.now() - time
  if (e.type !== 'pointercancel' && (Math.abs(dx) >= pageWidth.value * 0.18 || (Math.abs(dx) > 24 && elapsed < 250))) {
    turnReaderPage(dx < 0 ? 1 : -1)
  } else animateToPage(pageIndex.value, dx < 0 ? 1 : -1)
}

function onKeyDown(e: KeyboardEvent) {
  if (app.page !== 'reader' || !paged.value || reader.menuOpen || reader.drawerOpen || e.altKey || e.ctrlKey || e.metaKey) return
  if ((e.target as HTMLElement).closest('input, textarea, select, button, [contenteditable="true"]')) return
  const direction = ['ArrowRight', 'PageDown', ' '].includes(e.key) ? 1 : ['ArrowLeft', 'PageUp'].includes(e.key) ? -1 : 0
  if (direction) { e.preventDefault(); if (!e.repeat) turnReaderPage(direction) }
}

function restorePosition(pct: number) {
  const sc = scRef.value
  if (!sc) return
  if (paged.value) {
    pageIndex.value = clamp(Math.round(pct / 100 * (pageCount.value - 1)), 0, pageCount.value - 1)
    sc.scrollTop = 0
    sc.scrollLeft = pageIndex.value * pageWidth.value
  } else {
    sc.scrollLeft = 0
    sc.scrollTop = pct / 100 * Math.max(0, sc.scrollHeight - sc.clientHeight)
  }
  fabPct.value = scrollPct()
}

let resizeFrame = 0
function onResize() {
  if (app.page !== 'reader' || isComic.value || restoring) return
  const pct = paged.value ? scrollPct() : fabPct.value
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(async () => {
    stopPageTurn()
    setReaderLayout()
    await nextTick()
    restorePosition(pct)
  })
}

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  window.addEventListener('resize', onResize)
  window.visualViewport?.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pagehide', persistProgress)
  resizeObserver = new ResizeObserver(onResize)
  if (scRef.value) resizeObserver.observe(scRef.value)
  document.fonts.ready.then(onResize)
})
onBeforeUnmount(() => {
  persistProgress()
  stopPageTurn()
  cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', onResize)
  window.visualViewport?.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pagehide', persistProgress)
})
watch(() => settings.fontSize, onResize, { flush: 'post' })

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
watch(() => [app.page, reader.book?.id, reader.chIdx], async ([page]) => {
  if (page !== 'reader' || !reader.book) return
  await loadChapter(reader.chIdx)
  fabPct.value = scrollPct()
}, { immediate: true })

watch(() => app.page, p => {
  if (p === 'reader') return
  persistProgress()
  ++chapterRequest
  restoring = false
  stopPageTurn()
  cancelAnimationFrame(resizeFrame)
  reader.menuOpen = false
})
</script>

<template>
  <section id="page-reader" class="page">
    <button class="float-back" title="返回库墙" aria-label="返回库墙" @click="app.showPage('library')">
      <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <div id="rdHead"><span id="rdHeadTitle"><b>{{ book?.title }}</b> {{ cv.title }}</span></div>
    <div class="reader-stage">
    <div id="readerScroll" ref="scRef" :class="{ 'reader-paged': paged, 'reader-turning': turning }"
      tabindex="0" role="region" :aria-label="paged ? '小说正文，左右滑动或点击两侧翻页，点击中间打开菜单' : '阅读正文'"
      @scroll="onScroll" @wheel="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove"
      @pointerup="onPointerUp" @pointercancel="onPointerUp" @click="onReaderClick">
      <article id="chapterBody" ref="bodyRef" :class="{ comic: isComic, 'reader-paged': paged }"
        :style="bodyStyle">
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
      <div v-if="paged" class="reader-page-spacer" :style="{ width: pageCount * pageWidth + 'px' }" aria-hidden="true" />
    </div>
      <div v-if="paged" class="reader-turn-overlay" :class="{
        active: turning,
        next: turnDirection > 0,
        prev: turnDirection < 0
      }" aria-hidden="true" />
    </div>
    <div v-if="paged && cv.mode === 'text'" class="rd-page-status" aria-live="polite" aria-atomic="true">
      {{ pageIndex + 1 }} / {{ pageCount }} 页
    </div>
    <aside id="chDrawer" :class="{ open: reader.drawerOpen }" :inert="!reader.drawerOpen">
      <button v-for="(c, i) in book?.chapters || []" :key="i" class="ch-item" :class="{ cur: i === reader.chIdx }"
        :aria-current="i === reader.chIdx ? 'true' : undefined" @click="pickChapter(i)">{{ c.title }}</button>
    </aside>
    <div id="rdFab">
      <div id="rdMenu" :class="{ hidden: !reader.menuOpen, 'anim-hidden': !reader.menuOpen }">
        <button class="rm-row" id="rmToc" @click="toggleDrawer">
          <AppIcon name="list" />章节目录<span class="rm-r">{{ reader.chIdx + 1 }}/{{ book?.chapters.length }}</span>
        </button>
        <div class="rm-sep" />
        <template v-if="!book?.type || book?.type === 'novel'">
          <button class="rm-row" id="rmCine" @click="onMenuCine">
            <AppIcon name="music" />情境配乐<span class="rm-r">{{ reader.nodes.length ? reader.nodes.length + ' 个节点' : '未分析' }}</span>
          </button>
          <div class="rm-sep" />
        </template>
        <button class="rm-row" id="rmFont" :aria-expanded="menuFontOpen" aria-controls="rmFontPanel" @click="menuFontOpen = !menuFontOpen">主题与设置<span class="rm-r">大小</span></button>
        <div class="rm-panel" id="rmFontPanel" :class="{ hidden: !menuFontOpen, 'anim-hidden': !menuFontOpen }">
          <div class="row">
            <button class="btn small" id="rmfMinus" @click="bumpFont(-1)">A−</button>
            <button class="btn small" id="rmfPlus" @click="bumpFont(1)">A+</button>
            <div class="grow" />
            <button class="btn small" id="rmfTheme" @click="app.toggleTheme()">{{ settings.theme === 'dark' ? '☀ 浅色' : '☾ 深色' }}</button>
          </div>
        </div>
        <div class="rm-sep" />
        <div class="rm-btns">
          <button id="rmAmb" :class="{ on: reader.ambOn }" :aria-pressed="reader.ambOn" title="伴读开关" aria-label="伴读开关" @click="toggleAmb"><AppIcon name="music" /></button>
          <button id="rmToc2" title="章节列表" aria-label="章节列表" @click="toggleDrawer"><AppIcon name="list" /></button>
        </div>
      </div>
      <button id="fabBar" :aria-expanded="reader.menuOpen" aria-controls="rdMenu" @click.stop="reader.menuOpen = !reader.menuOpen">
        <span id="fabText">{{ fabText }}</span><AppIcon name="list" />
      </button>
    </div>
  </section>
</template>
