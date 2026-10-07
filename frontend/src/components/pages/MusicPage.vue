<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useSearchStore } from '../../stores/search'
import { useLibStore } from '../../stores/lib'
import { useReaderStore } from '../../stores/reader'
import { player } from '../../services/audio'
import { musicState, startMusic, neighborMusic } from '../../services/music'
import { dbAll, dbPut } from '../../services/idb'
import { getProgress, settings, saveMediaProgress } from '../../services/settings'
import { hashHue, fmtTime } from '../../utils'
import { EMOTIONS, emoColor } from '../../constants'
import type { MusicRecord } from '../../types'

const app = useAppStore()
const search = useSearchStore()
const lib = useLibStore()
const reader = useReaderStore()

const musics = ref<MusicRecord[]>([])
const seekEl = ref<HTMLInputElement | null>(null)
const muNameEl = ref<HTMLElement | null>(null)
const drawerEl = ref<HTMLElement | null>(null)
// 400ms 心跳驱动的时间显示
const tick = ref(0)

const m = computed(() => player.currentMusic || musicState.muSelected)
const playing = computed(() => { tick.value; return player.isPlaying() })
const emo = computed(() => reader.ambOn && reader.playingEmotion ? reader.playingEmotion : (m.value?.tags?.[0] || ''))

const hueBg = (music: any) => {
  const h = hashHue(music ? music.name : 'mooin')
  return `linear-gradient(168deg, hsl(${h},26%,44%) 0%, hsl(${h},30%,32%) 55%, hsl(${h},34%,16%) 100%)`
}
const bgStyle = computed(() => ({ background: hueBg(m.value) }))
const title = computed(() => reader.playingEmotion && reader.ambOn ? `情境 · ${reader.playingEmotion}` : '音 乐')
const coverText = computed(() => m.value ? `${m.value.name.slice(0, 4)}<small>MOOIN</small>` : '♪')
const emoText = computed(() => {
  if (!m.value) return '—'
  return m.value.preview ? '试听片段' : emo.value || m.value.sourceName || '本地配乐'
})
const emoBg = computed(() => emo.value ? emoColor(emo.value) : '#777')
const stateText = computed(() => {
  tick.value
  return player.lastError || (playing.value ? '正在播放' : (player.currentMusic ? '已暂停' : '已选择'))
})
const noteText = computed(() => reader.ambOn && reader.playingEmotion ? `情境配乐 · 「${reader.playingEmotion}」触发` : '自由聆听模式')
const lyricText = computed(() => m.value ? (m.value.author || '让音乐陪你读下去') : '为阅读选一首配乐')
const nameText = computed(() => m.value ? m.value.name : '未在播放')
const dur = computed(() => {
  tick.value
  const el = player.activeEl()
  return player.ctx && el && el.src && el.duration ? fmtTime(el.duration) : '0:00'
})
const cur = computed(() => {
  tick.value
  const el = player.activeEl()
  return player.ctx && el && el.src && el.duration ? fmtTime(el.currentTime) : '0:00'
})
const seekVal = computed(() => {
  tick.value
  const el = player.activeEl()
  return player.ctx && el && el.src && el.duration ? Math.round(el.currentTime / el.duration * 1000) : 0
})

async function loadList() {
  const rows = await dbAll<MusicRecord>('music')
  rows.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  musics.value = rows
}

watch(() => [app.page, lib.rev], async ([page]) => {
  if (page === 'music') await loadList()
}, { immediate: true })

async function onRowPlay(row: MusicRecord) {
  const isCur = player.currentMusic && player.currentMusic.id === row.id
  if (isCur) { player.togglePause(); return }
  musicState.muSelected = row
  try { await startMusic(row) } catch (e: any) { app.toast(e.message) }
}

async function toggleTag(row: any, t: string) {
  row.tags = (row.tags || []).includes(t) ? row.tags.filter((x: string) => x !== t) : [...(row.tags || []), t]
  await dbPut('music', row)
  lib.bump()
}

async function onRemove(row: MusicRecord) {
  const { removeCollection } = await import('../../services/catalog')
  const ok = await removeCollection(row, 'music')
  if (ok) {
    if (musicState.muSelected?.id === row.id) musicState.muSelected = null
    lib.bump()
  }
}

function onPlay() {
  if (!player.currentMusic) {
    const target = musicState.muSelected || musics.value[0]
    if (!target) { app.toast('音乐库为空，请先添加曲目'); return }
    startMusic(target).catch((e: any) => app.toast(e.message))
    return
  }
  player.togglePause()
}

function onReplay() {
  const target = player.currentMusic || musicState.muSelected
  if (!target) { app.toast('还没有选中曲目'); return }
  startMusic(target, false).catch((e: any) => app.toast(e.message))
}

async function onNext() {
  const next = await neighborMusic(1)
  if (next) startMusic(next).catch((e: any) => app.toast(e.message))
}
async function onPrev() {
  const prev = await neighborMusic(-1)
  if (prev) startMusic(prev).catch((e: any) => app.toast(e.message))
}
async function onShuffle() {
  if (!musics.value.length) { app.toast('音乐库为空'); return }
  const pick = musics.value[Math.floor(Math.random() * musics.value.length)]
  startMusic(pick).catch((e: any) => app.toast(e.message))
}

function onSeekInput(e: Event) {
  const el = player.activeEl()
  const v = Number((e.target as HTMLInputElement).value)
  if (el && el.duration) {
    // 原版：拖动时即时更新当前时间显示
  }
  void v
}
function onSeekChange(e: Event) {
  player.seek(Number((e.target as HTMLInputElement).value) / 1000)
}

// 400ms UI 心跳（原 setInterval）
setInterval(() => { if (app.page === 'music') tick.value++ }, 400)
</script>

<template>
  <section id="page-music" class="page">
    <div id="muBg" :style="bgStyle" />
    <div class="mu-inner">
      <div class="mu-top">
        <button id="muBack" title="返回收藏" @click="search.openCategory('music', 'library')">⌄</button>
        <div id="muTitle">{{ title }}</div>
        <button id="muReplay" title="从头播放" @click="onReplay">↻</button>
      </div>
      <div class="mu-stage">
        <div class="vinyl-box">
          <div id="disc" :class="{ spin: !!player.currentMusic, paused: !playing }">
            <div id="muCover">
              <template v-if="m">{{ m.name.slice(0, 4) }}<small>MOOIN</small></template>
              <template v-else>♪</template>
            </div>
          </div>
          <svg id="tonearm" :class="{ on: !!player.currentMusic }" viewBox="0 0 100 170">
            <circle cx="24" cy="26" r="15" fill="#e9e9e9" />
            <circle cx="24" cy="26" r="6.5" fill="#9a9a9a" />
            <rect x="21" y="38" width="6" height="86" rx="3" fill="#f2f2f2" />
            <rect x="14" y="120" width="20" height="30" rx="6" fill="#e0e0e0" transform="rotate(16 24 128)" />
          </svg>
        </div>
        <div class="mu-lyric" id="muLyric">{{ lyricText }}</div>
      </div>
      <div class="mu-panel">
        <h2 id="muName" ref="muNameEl">{{ nameText }}</h2>
        <div class="mu-meta">
          <span id="muEmo" class="badge" :style="{ background: emoBg }">{{ emoText }}</span>
          <span id="muState" style="opacity:.65">{{ stateText }}</span>
        </div>
        <div class="mu-prog">
          <span id="muCur">{{ cur }}</span>
          <input type="range" id="muSeek" ref="seekEl" aria-label="播放进度" min="0" max="1000" :value="seekVal"
            @input="onSeekInput" @change="onSeekChange">
          <span id="muDur">{{ dur }}</span>
        </div>
        <div class="mu-note" id="muNote">{{ noteText }}</div>
        <div class="mu-ctrl">
          <button id="muShuffle" title="随机播放" @click="onShuffle">🔀</button>
          <button id="muPrev" title="上一首" @click="onPrev">⏮</button>
          <button id="muPlay" title="播放/暂停" @click="onPlay">{{ playing ? '⏸' : '▶' }}</button>
          <button id="muNext" title="下一首" @click="onNext">⏭</button>
          <button id="muListBtn" title="查找音乐" @click="drawerEl?.scrollIntoView({ block: 'start' })">☰</button>
        </div>
      </div>
      <div class="mu-foot">
        <button id="mfTheme" title="明暗主题" @click="app.toggleTheme()">☾</button>
        <button id="mfInfo" title="说明" @click="app.toast('阅读时滚到情绪节点，音乐会渐入渐出切换 · 在「情境配乐」页预设')">ⓘ</button>
        <button id="mfMore" title="更多">⋯</button>
      </div>
    </div>
    <div id="muDrawer" ref="drawerEl">
      <div class="row">
        <h3 class="grow">播放列表 <span id="musicCount">{{ musics.length }}</span></h3>
        <button class="btn small" id="muDrawerClose" title="回到播放器" @click="muNameEl?.scrollIntoView({ block: 'center' })">↑</button>
      </div>
      <p class="muted">曲目标签可用于阅读时的情境配乐。</p>
      <div class="row music-player-links">
        <button class="btn small" id="musicDiscover" @click="search.openDiscovery('music')">发现音乐</button>
        <button class="btn small" id="musicCollection" @click="search.openCategory('music', 'library')">管理收藏</button>
      </div>
      <label class="fld" for="muVol">音量</label>
      <input type="range" id="muVol" min="0" max="100" style="width:100%; margin-bottom:14px"
        :value="Math.round(settings.volume * 100)" @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)">
      <div id="musicList">
        <p v-if="!musics.length" class="music-empty muted">还没有曲目。到「发现音乐」搜索并添加，或上传本地文件、合成氛围音。</p>
        <div v-for="row in musics" :key="row.id" class="music-row">
          <button class="m-play" :class="{ cur: player.currentMusic && player.currentMusic.id === row.id }"
            @click="onRowPlay(row)">{{ player.currentMusic && player.currentMusic.id === row.id && playing ? '⏸' : '▶' }}</button>
          <div class="grow" style="min-width:0">
            <div class="music-name" :class="{ now: player.currentMusic && player.currentMusic.id === row.id }">{{ row.name }}</div>
            <div class="muted">{{ row.sourceName || '本地音乐' }}{{ row.preview ? ' · 试听片段' : '' }}{{ row.duration ? ' · ' + fmtTime(row.duration) : '' }}{{ row.author ? ' · ' + row.author : '' }}</div>
          </div>
          <div class="chips">
            <span v-for="e in EMOTIONS" :key="e.label" class="chip"
              :class="{ on: (row.tags || []).includes(e.label) }"
              :style="(row.tags || []).includes(e.label) ? { background: e.color } : {}"
              @click="toggleTag(row, e.label)">{{ e.label }}</span>
          </div>
          <button class="btn small danger" @click="onRemove(row)">✕</button>
        </div>
      </div>
    </div>
  </section>
</template>
