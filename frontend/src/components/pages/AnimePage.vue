<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useSearchStore } from '../../stores/search'
import { animeState, loadHls, registerAnimeStop, bumpAnimeRequest, currentAnimeRequest, findAlternativeAnime, episodeKey } from '../../services/anime'
import type { AnimeAttempt } from '../../services/anime'
import { api, sourceId, SOURCES } from '../../services/server'
import { getProgress, saveMediaProgress } from '../../services/settings'
import { dbPut } from '../../services/idb'
import { musicPageUrl } from '../../services/music'

const app = useAppStore()
const search = useSearchStore()

const playerBox = ref<HTMLElement | null>(null)
const view = ref({
  mode: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  title: '',
  errMsg: '',
  stream: '',
  original: '',
  chapterTitle: '',
  idx: 0,
  switching: false
})

let hls: any = null
let videoEl: HTMLVideoElement | null = null
// 每集已尝试过的源（key: bookId:idx），自动换源时逐个排除
const failedSources = new Map<string, Set<string>>()
const failedUrls = new Map<string, Set<string>>()
const attempts = ref<AnimeAttempt[]>([])
const manualSource = ref('')
const sourceLookup = ref('')
const sourceOptions = computed(() => SOURCES.value.filter(source => source.type === 'anime'))
let detachPlayer = () => {}
let resumePosition = 0

function note(attempt: AnimeAttempt) {
  const index = attempts.value.findIndex(row => row.source === attempt.source)
  if (index < 0) attempts.value.push(attempt)
  else attempts.value[index] = attempt
}

function setVideo(el: any) {
  videoEl = el as HTMLVideoElement
}

function cleanup() {
  detachPlayer()
  detachPlayer = () => {}
  if (videoEl) {
    videoEl.pause()
    videoEl.removeAttribute('src')
    videoEl.load()
  }
  if (hls) { hls.destroy(); hls = null }
  videoEl = null
}

// 原版 stopAnime：切页离开时由 App 调用
registerAnimeStop(() => {
  bumpAnimeRequest()
  cleanup()
})

function setEpisodeButtons(idx: number) {
  view.value.idx = idx
}

async function playAnime(idx: number, resumeTime?: number) {
  const request = bumpAnimeRequest()
  cleanup()
  sourceLookup.value = ''
  const book = animeState.book
  if (!book) return
  const chapter = book.chapters[idx]
  animeState.episode = idx
  setEpisodeButtons(idx)
  const previous = getProgress()[book.id]
  const resume = resumeTime ?? (previous?.chIdx === idx ? previous.time || 0 : 0)
  resumePosition = resume
  view.value.mode = 'loading'
  const current = () => request === currentAnimeRequest() && app.page === 'anime'
  let handled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const fail = async (error: Error) => {
    if (!current() || handled) return
    handled = true
    clearTimeout(timer)
    const position = videoEl?.currentTime || resume
    resumePosition = position
    await handlePlayFailure(idx, error, request, position)
  }
  try {
    if (!chapter?.url) throw new Error('该源没有对应集数')
    const d = (await api('/api/action', { source: book.source, action: 'play', value: chapter.url })).data
    if (!current()) return
    const stream = d.playbackUrl?.startsWith('/api/video?') ? d.playbackUrl : musicPageUrl(d.stream)
    if (!stream) throw new Error('播放地址无效')
    const original = musicPageUrl(chapter.url || '')
    view.value = { mode: 'ready', title: book.title || '', errMsg: '', stream, original, chapterTitle: chapter.title || `第 ${idx + 1} 集`, idx, switching: false }
    await nextTick()
    if (!current() || !videoEl) return
    const video = videoEl
    let lastSave = 0
    let verified = false
    const save = () => { if (verified) saveMediaProgress(book.id, idx, video) }
    const metadata = () => { if (current() && resume > 0 && resume < video.duration) video.currentTime = resume }
    const loaded = () => {
      if (!current() || handled || verified) return
      verified = true
      clearTimeout(timer)
      note({ source: book.source || '', name: book.sourceName || '', stage: '播放', message: '视频已加载' })
      // Persist the new source only once media data has actually loaded.
      dbPut('books', JSON.parse(JSON.stringify(book))).catch(() => app.toast('视频已加载，但收藏更新失败'))
      save()
    }
    const tick = () => { if (current() && Date.now() - lastSave > 1000) { lastSave = Date.now(); save() } }
    const mediaError = () => { void fail(new Error('视频加载或解码失败')) }
    video.addEventListener('loadedmetadata', metadata)
    video.addEventListener('loadeddata', loaded)
    video.addEventListener('timeupdate', tick)
    video.addEventListener('pause', save)
    video.addEventListener('ended', save)
    video.addEventListener('error', mediaError)
    timer = setTimeout(() => { void fail(new Error('视频加载超时')) }, 45000)
    detachPlayer = () => {
      clearTimeout(timer)
      save()
      video.removeEventListener('loadedmetadata', metadata)
      video.removeEventListener('loadeddata', loaded)
      video.removeEventListener('timeupdate', tick)
      video.removeEventListener('pause', save)
      video.removeEventListener('ended', save)
      video.removeEventListener('error', mediaError)
    }
    const needHls = /\.m3u8(?:$|[?#])/i.test(d.stream)
    if (needHls) {
      const Hls = await loadHls()
      if (!current() || handled) return
      if (Hls.isSupported()) {
        hls = new Hls()
        hls.on(Hls.Events.ERROR, (_: unknown, data: any) => { if (data.fatal) void fail(new Error(`视频加载失败：${data.details}`)) })
        hls.loadSource(stream)
        hls.attachMedia(video)
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = stream
      else throw new Error('当前浏览器不支持 HLS 播放')
    } else {
      video.src = stream
      video.load()
    }
  } catch (e: any) {
    await fail(e)
  }
}

/** 播放失败先试同源线路；自动模式再尝试其他来源 */
async function handlePlayFailure(idx: number, e: any, request: number, resume: number) {
  const book = animeState.book
  const chapter = book?.chapters[idx]
  if (book && chapter) {
    const key = book.id + ':' + episodeKey(chapter.title)
    let tried = failedSources.get(key)
    if (!tried) { tried = new Set(); failedSources.set(key, tried) }
    let urls = failedUrls.get(key)
    if (!urls) { urls = new Set(); failedUrls.set(key, urls) }
    if (chapter.url) urls.add(chapter.url)
    cleanup()
    note({ source: book.source || '', name: book.sourceName || '', stage: '播放', message: e.message })
    view.value = { ...view.value, mode: 'loading', switching: true, errMsg: e.message }
    const nextUrl = chapter.alternatives?.find(url => !urls!.has(url))
    if (nextUrl) {
      animeState.book = { ...book, chapters: book.chapters.map((ch, i) => i === idx ? {
        ...ch, url: nextUrl, alternatives: [...new Set([ch.url, ...(ch.alternatives || [])].filter((url): url is string => !!url && url !== nextUrl))]
      } : ch) }
      await playAnime(idx, resume)
      return
    }
    tried.add(sourceId(book.source || ''))
    if (manualSource.value) {
      view.value = { ...view.value, mode: 'error', errMsg: e.message, original: musicPageUrl(chapter.url || ''), switching: false }
      return
    }
    const current = () => request === currentAnimeRequest() && app.page === 'anime'
    const alt = await findAlternativeAnime(book, tried, chapter, note, current)
    if (request !== currentAnimeRequest() || app.page !== 'anime') return
    if (alt) {
      animeState.book = { ...book, source: alt.source, sourceName: alt.sourceName, srcId: alt.srcId, chapters: alt.chapters }
      await playAnime(alt.index, resume)
      return
    }
  }
  view.value = { ...view.value, mode: 'error', errMsg: e.message, original: musicPageUrl(animeState.book?.chapters[idx]?.url || ''), switching: false }
}

async function selectSource(selected: string) {
  const book = animeState.book
  const idx = view.value.idx
  const chapter = book?.chapters[idx]
  if (!book || !chapter) return
  const resume = videoEl?.currentTime || resumePosition
  resumePosition = resume
  const request = bumpAnimeRequest()
  cleanup()
  manualSource.value = selected
  attempts.value = []
  failedSources.clear()
  failedUrls.clear()
  if (!selected || selected === sourceId(book.source || '')) {
    animeState.book = { ...book, animeSourceMode: selected ? 'manual' : 'auto' }
    await playAnime(idx, resume)
    return
  }
  const name = sourceOptions.value.find(source => source.id === selected)?.name || selected
  sourceLookup.value = name
  view.value = { ...view.value, mode: 'loading', switching: false, errMsg: '' }
  const current = () => request === currentAnimeRequest() && app.page === 'anime'
  const alt = await findAlternativeAnime(book, new Set(), chapter, note, current, selected)
  if (!current()) return
  sourceLookup.value = ''
  if (!alt) {
    const reason = attempts.value.at(-1)?.message || '未找到同名同季作品的对应集数'
    view.value = { ...view.value, mode: 'error', switching: false, errMsg: `未能切换到「${name}」：${reason}`, original: '' }
    return
  }
  animeState.book = { ...book, source: alt.source, sourceName: alt.sourceName, srcId: alt.srcId, chapters: alt.chapters, animeSourceMode: 'manual' }
  await playAnime(alt.index, resume)
}

async function start() {
  const book = animeState.book
  if (!book) return
  manualSource.value = book.animeSourceMode === 'manual' ? sourceId(book.source || '') : ''
  attempts.value = []
  failedSources.clear()
  failedUrls.clear()
  await playAnime(animeState.episode, animeState.resumeTime)
}

function retry() {
  if (manualSource.value && manualSource.value !== sourceId(animeState.book?.source || '')) {
    void selectSource(manualSource.value)
    return
  }
  failedSources.clear()
  failedUrls.clear()
  attempts.value = []
  void playAnime(view.value.idx, resumePosition)
}

watch(() => app.page, p => { if (p === 'anime') start() })
onBeforeUnmount(cleanup)

function back() { search.openCategory('anime', 'library') }
</script>

<template>
  <section id="page-anime" class="page">
    <div class="page-inner" id="animeBox" v-if="animeState.book">
      <div class="section-heading">
        <h1 class="big-title">{{ animeState.book.title }}</h1>
        <button class="btn small" id="animeBack" @click="back">返回收藏</button>
      </div>
      <p class="muted">{{ animeState.book.sourceName || '番剧' }} · {{ animeState.book.chapters.length }} 集</p>
      <div class="anime-source-picker">
        <label for="animeSource">播放来源</label>
        <select id="animeSource" class="sel" :value="manualSource" @change="selectSource(($event.target as HTMLSelectElement).value)">
          <option value="">自动换源</option>
          <option v-for="source in sourceOptions" :key="source.id" :value="source.id">{{ source.name }}{{ source.custom ? '（自定义）' : '' }}</option>
        </select>
      </div>
      <p class="muted">{{ manualSource ? '手动选源：失败时保留你的选择，可随时切回自动换源。' : '自动换源：当前来源不可用时，自动尝试其他来源。' }}</p>
      <div id="animePlayer" ref="playerBox">
        <template v-if="view.mode === 'loading'">
          <p class="store-empty">
            {{ sourceLookup ? `正在查找「${sourceLookup}」的对应集数…` : view.switching ? `「${animeState.book.sourceName}」无法播放（${view.errMsg}），正在尝试其他源或线路…` : '正在加载播放地址…' }}
          </p>
        </template>
        <template v-else-if="view.mode === 'ready'">
          <video id="animeVideo" :ref="setVideo" controls playsinline preload="metadata" />
          <div class="section-heading">
            <span>{{ view.chapterTitle }}</span>
            <a v-if="view.original" class="btn small" :href="view.original" target="_blank" rel="noopener noreferrer">原站</a>
          </div>
          <p id="animePlayError" class="muted" role="status">{{ view.errMsg }}</p>
        </template>
        <template v-else-if="view.mode === 'error'">
          <p class="store-empty">{{ view.errMsg }}</p>
          <p class="muted">{{ manualSource ? '所选来源暂不可用，可重试或在上方选择其他来源。' : '暂未找到能够播放的对应集数，具体原因见下方换源记录。' }}</p>
          <button class="btn" @click="retry">{{ manualSource ? '重试所选来源' : '重试（重新换源）' }}</button>
          <a v-if="view.original" class="btn" :href="view.original" target="_blank" rel="noopener noreferrer">原站</a>
        </template>
      </div>
      <details v-if="attempts.length" class="muted">
        <summary>换源记录（{{ attempts.length }} 个来源）</summary>
        <p v-for="attempt in attempts" :key="attempt.source">{{ attempt.name }} · {{ attempt.stage }}：{{ attempt.message }}</p>
      </details>
      <h2 class="sec-title">选集</h2>
      <div class="anime-episodes">
        <button v-for="(chapter, i) in animeState.book.chapters" :key="i" class="btn small"
          :class="{ primary: i === view.idx }" :aria-pressed="i === view.idx ? 'true' : 'false'"
          :disabled="!!sourceLookup || (!!manualSource && manualSource !== sourceId(animeState.book.source || ''))"
          @click="playAnime(i)">{{ chapter.title || `第 ${i + 1} 集` }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.anime-source-picker { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.anime-source-picker label { flex: none; }
.anime-source-picker select { flex: 1; min-width: 0; max-width: 320px; }
</style>
