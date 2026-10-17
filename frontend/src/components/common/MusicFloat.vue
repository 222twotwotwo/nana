<script setup lang="ts">
import AppIcon from './AppIcon.vue'
/**
 * 悬浮音乐播放器（博客站点经典做法）
 *
 * 形态：右下角悬浮球 ⇄ 展开迷你卡片；仅当有曲目被选中/播放时出现。
 * 价值：离开音乐页后仍能控制播放——最典型的是在阅读页/番剧页切歌，
 *      切歌时不再跳回音乐页（startMusic 的 navigate=false）。
 *
 * 位置：右下角，但阅读页的 #rdFab（目录胶囊）也在右下角，
 *      因此阅读页时上移，避免两层悬浮 UI 叠在一起。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useLibStore } from '../../stores/lib'
import { useReaderStore } from '../../stores/reader'
import { player } from '../../services/audio'
import { musicState, startMusic, neighborMusic } from '../../services/music'
import { dbAll } from '../../services/idb'
import { hashHue, fmtTime } from '../../utils'
import { emoColor } from '../../constants'
import type { MusicRecord } from '../../types'

const app = useAppStore()
const lib = useLibStore()
const reader = useReaderStore()

const open = ref(false)
const listOpen = ref(false)
const list = ref<MusicRecord[]>([])
const busy = ref(false)
// 400ms 心跳：驱动进度条/时间显示，并让下面的 computed 感知 player 的非响应式字段
const tick = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

/**
 * player 是普通类实例，currentMusic 不是响应式的；
 * musicState 是 reactive 的，但 fadeStop() 等路径只改 player 不动 musicState。
 * 因此这里显式依赖 tick，并由「心跳 + player.emit() 订阅」共同驱动刷新，
 * 避免出现「音乐已停但悬浮球还在」或「已开始播放但悬浮球不出现」。
 */
const m = computed(() => { tick.value; return player.currentMusic || musicState.muSelected })
const playing = computed(() => { tick.value; return player.isPlaying() })
const hue = computed(() => hashHue(m.value ? m.value.name : 'nana'))
const emo = computed(() => reader.ambOn && reader.playingEmotion ? reader.playingEmotion : (m.value?.tags?.[0] || ''))
const emoBg = computed(() => emo.value ? emoColor(emo.value) : '#8a8a8a')

const coverText = computed(() => m.value ? m.value.name.slice(0, 4) : '♪')
const subText = computed(() => {
  if (!m.value) return ''
  if (player.lastError) return player.lastError
  return m.value.author || m.value.sourceName || '本地音乐'
})
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
const stateText = computed(() => {
  tick.value
  if (player.lastError) return '播放异常'
  if (!m.value) return ''
  return playing.value ? '正在播放' : '已暂停'
})

/** 有曲目才显示；音乐页本身已有完整播放器，不重复出现 */
const visible = computed(() => !!m.value && app.page !== 'music')
/** 阅读页右下角被目录胶囊占用，整体上移 */
const lifted = computed(() => app.page === 'reader')

function onPlayerEvent() { tick.value++ }

onMounted(() => {
  player.on(onPlayerEvent)
  timer = setInterval(() => { if (visible.value) tick.value++ }, 400)
})
onBeforeUnmount(() => {
  player.off(onPlayerEvent)
  if (timer) clearInterval(timer)
})

// 播放器状态变化由 player.emit() → onPlayerEvent（tick++）驱动，
// 不额外 watch player.currentId/lastError——它们是普通类字段，watch 不会触发。
// 收起时同时收起曲目列表，避免下次展开残留
watch(open, v => { if (!v) listOpen.value = false })
// 离开音乐页后重新拉取列表，保证悬浮列表是最新的
watch(() => lib.rev, () => { if (listOpen.value) void loadList() })

async function loadList() {
  const rows = await dbAll<MusicRecord>('music')
  rows.sort((a: MusicRecord, b: MusicRecord) => (b.addedAt || 0) - (a.addedAt || 0))
  list.value = rows
}

async function toggleList() {
  listOpen.value = !listOpen.value
  if (listOpen.value) await loadList()
}

function onPlayPause() {
  if (!player.currentMusic) {
    const target = musicState.muSelected || list.value[0]
    if (!target) { app.toast('音乐库为空，请先添加曲目'); return }
    void play(target)
    return
  }
  void player.togglePause()
}

async function play(music: MusicRecord) {
  if (busy.value) return
  busy.value = true
  try {
    // navigate=false：切歌不离开当前页面
    await startMusic(music, true, false)
  } catch (e: any) {
    app.toast(e.message)
  } finally {
    busy.value = false
  }
}

async function onRowPlay(row: MusicRecord) {
  if (player.currentMusic?.id === row.id) { void player.togglePause(); return }
  musicState.muSelected = row
  await play(row)
}

async function onNext() {
  const next = await neighborMusic(1)
  if (next) await play(next)
}
async function onPrev() {
  const prev = await neighborMusic(-1)
  if (prev) await play(prev)
}
function onSeek(e: Event) {
  player.seek(Number((e.target as HTMLInputElement).value) / 1000)
}
function openFull() {
  open.value = false
  app.showPage('music')
}
</script>

<template>
  <div id="muFloat" :class="{ open, lifted, hidden: !visible, 'anim-hidden': !visible, 'reader-menu-open': lifted && reader.menuOpen }"
    :inert="lifted && reader.menuOpen">
    <!-- 展开态：迷你卡片 ⇄ 折叠态：悬浮球。
         Transition 的 leave-active 会把离场元素临时绝对定位到右下角，
         因此变形期间两者重叠、不会把容器撑高（否则会抖动）。 -->
    <Transition name="mf">
      <div v-if="open" key="card" class="mf-card" role="region" aria-label="悬浮音乐播放器">
        <div class="mf-head">
          <div class="mf-cover" :style="{ background: `linear-gradient(150deg, hsl(${hue},52%,58%), hsl(${(hue + 40) % 360},48%,36%))` }">
            <span>{{ coverText }}</span>
          </div>
          <div class="mf-copy">
            <div class="mf-name" :title="m?.name">{{ m?.name || '未在播放' }}</div>
            <div class="mf-sub">{{ subText }}</div>
          </div>
          <span v-if="emo" class="mf-emo" :style="{ '--emotion-color': emoBg }">{{ emo }}</span>
          <button class="mf-icon" title="收起" aria-label="收起播放器" @click="open = false"><AppIcon name="close" /></button>
        </div>

        <div class="mf-prog">
          <span>{{ cur }}</span>
          <input type="range" min="0" max="1000" :value="seekVal" aria-label="播放进度" @input="onSeek">
          <span>{{ dur }}</span>
        </div>

        <div class="mf-ctrl">
          <button class="mf-icon" title="上一首" aria-label="上一首" @click="onPrev"><AppIcon name="previous" /></button>
          <button class="mf-play" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'" @click="onPlayPause">
            <AppIcon :name="playing ? 'pause' : 'play'" />
          </button>
          <button class="mf-icon" title="下一首" aria-label="下一首" @click="onNext"><AppIcon name="next" /></button>
          <button class="mf-icon" :class="{ on: listOpen }" :aria-expanded="listOpen" title="播放列表" aria-label="播放列表" @click="toggleList"><AppIcon name="list" /></button>
          <button class="mf-icon" title="打开完整播放器" aria-label="打开完整播放器" @click="openFull"><AppIcon name="expand" /></button>
        </div>

        <div v-if="listOpen" class="mf-list">
          <p v-if="!list.length" class="mf-empty">音乐库为空</p>
          <button v-for="row in list" :key="row.id" class="mf-row"
            :class="{ cur: player.currentMusic?.id === row.id }" @click="onRowPlay(row)">
            <AppIcon class="mf-row-ico" :name="player.currentMusic?.id === row.id && playing ? 'pause' : 'play'" />
            <span class="mf-row-name">{{ row.name }}</span>
            <span class="mf-row-meta">{{ row.duration ? fmtTime(row.duration) : '' }}</span>
          </button>
        </div>

        <div class="mf-foot">{{ stateText }}</div>
      </div>

      <button v-else key="ball" class="mf-ball" :class="{ spin: playing }" title="展开音乐播放器" aria-label="展开音乐播放器" @click="open = true">
        <span class="mf-ball-ring" />
        <AppIcon class="mf-ball-ico" :name="playing ? 'pause' : 'music'" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
/* 右下角固定；阅读页上移，让开目录胶囊 #rdFab */
#muFloat{position:fixed; right:22px; bottom:24px; z-index:38; display:flex; flex-direction:column; align-items:flex-end}
#muFloat.lifted{bottom:96px}
#muFloat.reader-menu-open{visibility:hidden; pointer-events:none; opacity:0}

/* ---------- 折叠态：悬浮球 ---------- */
.mf-ball{
  position:relative; width:56px; height:56px; border-radius:50%; flex:none;
  background:var(--panel); border:1px solid var(--line);
  box-shadow:var(--shadow); color:var(--accent);
  display:flex; align-items:center; justify-content:center; font-size:20px;
  transition:transform .18s ease, box-shadow .18s ease;
}
.mf-ball:hover{transform:translateY(-2px); box-shadow:var(--shadow-lg)}
.mf-ball:active{transform:translateY(0)}
/* 播放中缓慢旋转的外圈 */
.mf-ball-ring{
  position:absolute; inset:6px; border-radius:50%;
  border:1px solid var(--line); border-top-color:var(--accent);
}
.mf-ball.spin .mf-ball-ring{animation:mfspin 9s linear infinite}
@keyframes mfspin{to{transform:rotate(360deg)}}
.mf-ball-ico{position:relative; z-index:1}

/* ---------- 展开态：迷你卡片 ---------- */
.mf-card{
  width:300px; padding:16px; border-radius:var(--radius-card); margin-bottom:10px;
  background:var(--panel); border:1px solid var(--line); box-shadow:var(--shadow-lg);
  color:var(--text); animation:popin .16s ease;
}
.mf-head{display:flex; align-items:center; gap:10px; margin-bottom:12px}
.mf-cover{
  width:42px; height:42px; border-radius:10px; flex:none; overflow:hidden;
  display:flex; align-items:center; justify-content:center;
  color:#fff; font-size:13px; font-weight:700; letter-spacing:.5px; text-align:center;
  padding:0 2px; line-height:1.1;
}
.mf-copy{flex:1; min-width:0}
.mf-name{font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.mf-sub{font-size:11.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.mf-emo{
  display:inline-flex; align-items:center; gap:4px; flex:none; padding:2px 7px; border-radius:999px; color:var(--text); background:var(--tab-on); font-size:12px;
}
.mf-emo::before{content:""; width:5px; height:5px; border-radius:50%; background:var(--emotion-color); flex:none}
.mf-prog{display:flex; align-items:center; gap:8px; font-size:11px; color:var(--muted); margin-bottom:10px}
.mf-prog input{flex:1; min-width:0; accent-color:var(--accent); height:3px}
.mf-ctrl{display:flex; align-items:center; justify-content:space-between; gap:6px}
.mf-icon{
  width:44px; height:44px; border-radius:50%; font-size:15px; color:var(--text);
  display:flex; align-items:center; justify-content:center; flex:none;
}
.mf-icon:hover{opacity:1; background:var(--bg)}
.mf-icon.on{opacity:1; color:var(--accent); background:var(--bg)}
.mf-play{
  width:44px; height:44px; border-radius:50%; flex:none; font-size:16px;
  background:var(--accent-solid); color:var(--on-accent); display:flex; align-items:center; justify-content:center;
}
.mf-play:hover{opacity:.9}

/* ---------- 曲目列表 ---------- */
.mf-list{
  margin-top:10px; padding-top:8px; border-top:1px solid var(--line);
  max-height:180px; overflow:auto;
}
.mf-empty{font-size:12px; color:var(--muted); text-align:center; padding:12px 0}
.mf-row{
  display:flex; align-items:center; gap:8px; width:100%; text-align:left;
  min-height:44px; padding:7px 8px; border-radius:8px; font-size:12.5px;
}
.mf-row:hover{background:var(--bg)}
.mf-row.cur{color:var(--accent-solid)}
.mf-row-ico{flex:none; width:16px; height:16px}
.mf-row-name{flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.mf-row-meta{flex:none; font-size:11px; color:var(--muted)}
.mf-foot{margin-top:10px; font-size:11px; color:var(--muted); text-align:center; letter-spacing:.5px}

@media (max-width:760px){
  #muFloat{right:14px; bottom:16px}
  #muFloat.lifted{bottom:88px}
  .mf-card{width:min(300px, calc(100vw - 28px))}
}
@media (prefers-reduced-motion:reduce){
  .mf-ball.spin .mf-ball-ring{animation:none}
  .mf-ball{transition:none}
}
</style>
