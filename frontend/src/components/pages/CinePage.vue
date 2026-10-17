<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useLibStore } from '../../stores/lib'
import { dbAll, dbGet, dbPut, dbDel, anaKey } from '../../services/idb'
import { getMapping, saveMapping } from '../../services/settings'
import { analyzeChapter } from '../../services/llm'
import { clamp, sleep } from '../../utils'
import { EMOTIONS, EMO_LABELS } from '../../constants'
import type { BookRecord, AnalysisRecord } from '../../types'
import AppIcon from '../common/AppIcon.vue'

const app = useAppStore()
const lib = useLibStore()

const books = ref<BookRecord[]>([])
const analyses = ref<AnalysisRecord[]>([])
const musics = ref<any[]>([])
const mapping = ref<Record<string, string>>({})
const cineBookId = ref('')
const batchInfo = ref('')
const batchBusy = ref(false)
const batchStop = ref(false)
const folds = reactive<Record<string, boolean>>({})
let batchToken = 0

async function load() {
  const all = await dbAll<BookRecord>('books')
  books.value = all.filter(b => !b.type).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  analyses.value = await dbAll<AnalysisRecord>('analyses')
  musics.value = await dbAll('music')
  mapping.value = getMapping()
  if (!books.value.length) return
  if (!cineBookId.value || !books.value.find(b => b.id === cineBookId.value))
    cineBookId.value = app.cineBookId && books.value.find(b => b.id === app.cineBookId) ? app.cineBookId : books.value[0].id
}

watch(() => [app.page, lib.rev], async ([page]) => {
  if (page === 'cine') await load()
}, { immediate: true })

const currentBook = () => books.value.find(b => b.id === cineBookId.value)

function analysisFor(i: number) {
  return analyses.value.find(x => x.key === anaKey(cineBookId.value, i))
}

async function onBookChange(e: Event) {
  cineBookId.value = (e.target as HTMLSelectElement).value
  app.cineBookId = cineBookId.value
  foldsClear()
}

function foldsClear() { Object.keys(folds).forEach(k => delete folds[k]) }

async function onAnalyze(i: number, btn: HTMLButtonElement) {
  btn.disabled = true
  btn.textContent = '分析中…'
  try {
    await analyzeChapter(cineBookId.value, i)
    app.toast(`《${currentBook()!.chapters[i].title}》分析完成`)
    await load()
  } catch (err: any) {
    app.toast('分析失败：' + err.message)
    btn.disabled = false
    btn.textContent = analysisFor(i) ? '重新分析' : 'AI 分析'
  }
}

async function onAutoMap() {
  const mp = getMapping()
  let n = 0
  for (const m of musics.value) {
    for (const t of m.tags || []) {
      if (!mp[t]) { mp[t] = m.id; n++; break }
    }
  }
  saveMapping(mp)
  mapping.value = getMapping()
  app.toast(n ? `已自动映射 ${n} 个情绪` : '没有可自动映射的情绪（先给曲目打标签）')
}

async function onMapChange(label: string, e: Event) {
  const mp = getMapping()
  const v = (e.target as HTMLSelectElement).value
  if (v) mp[label] = v; else delete mp[label]
  saveMapping(mp)
  mapping.value = getMapping()
  app.toast(v ? `「${label}」已绑定` : `「${label}」已解绑`)
}

/* ---------- 批量分析 ---------- */
async function onBatch() {
  const book = currentBook()
  if (!book) return
  const token = ++batchToken
  if (batchBusy.value) { batchStop.value = true; return }
  const todo: number[] = []
  for (let i = 0; i < book.chapters.length; i++)
    if (!(await dbGet('analyses', anaKey(book.id, i)))) todo.push(i)
  if (!todo.length) { app.toast('所有章节都已分析过了'); return }
  batchStop.value = false
  batchBusy.value = true
  let ok = 0, fail = 0
  for (let n = 0; n < todo.length; n++) {
    if (batchStop.value || token !== batchToken) break
    batchInfo.value = `分析中 ${n + 1}/${todo.length}：${book.chapters[todo[n]].title}`
    try { await analyzeChapter(book.id, todo[n]); ok++ }
    catch (e) { fail++; console.warn(e) }
    await sleep(300)
  }
  batchBusy.value = false
  batchInfo.value = ''
  await load()
  app.toast(`批量分析结束：成功 ${ok} 章${fail ? `，失败 ${fail} 章` : ''}`)
}

/* ---------- 节点编辑（每章卡片展开后） ---------- */
interface NodeRow { at: number; emotion: string; note: string }

async function loadNodes(i: number): Promise<NodeRow[]> {
  const an = await dbGet('analyses', anaKey(cineBookId.value, i))
  return an ? an.nodes.map((n: any) => ({ ...n })) : [{ at: 0, emotion: '平静', note: '' }]
}

async function persistNodes(i: number, ns: NodeRow[]) {
  const rows = ns.map(n => ({
    at: clamp(parseInt(String(n.at)) as unknown as number || 0, 0, 100),
    emotion: n.emotion,
    note: (n.note || '').trim()
  })).filter(n => n.emotion)
  rows.sort((a, b) => a.at - b.at)
  if (rows.length) await dbPut('analyses', { key: anaKey(cineBookId.value, i), bookId: cineBookId.value, chIdx: i, nodes: rows, ts: Date.now() })
  else await dbDel('analyses', anaKey(cineBookId.value, i))
  const idx = analyses.value.findIndex(x => x.key === anaKey(cineBookId.value, i))
  if (rows.length) {
    const rec: AnalysisRecord = { key: anaKey(cineBookId.value, i), bookId: cineBookId.value, chIdx: i, nodes: rows, ts: Date.now() }
    if (idx >= 0) analyses.value[idx] = rec; else analyses.value.push(rec)
  } else if (idx >= 0) analyses.value.splice(idx, 1)
}

const cardNodes = reactive<Record<number, NodeRow[]>>({})

async function toggleFold(i: number) {
  const key = cineBookId.value + ':' + i
  folds[key] = !folds[key]
  if (folds[key] && !cardNodes[i]) cardNodes[i] = await loadNodes(i)
}

function addNode(i: number) {
  const rows = cardNodes[i]
  if (rows) rows.push({ at: 50, emotion: '平静', note: '' })
  persistNodes(i, rows || [])
}
function delNode(i: number, k: number) {
  const rows = cardNodes[i]
  if (!rows) return
  if (rows.length <= 1) { app.toast('至少保留一个节点'); return }
  rows.splice(k, 1)
  persistNodes(i, rows)
}
function onNodeChange(i: number) {
  persistNodes(i, cardNodes[i] || [])
}
</script>

<template>
  <section id="page-cine" class="page">
    <div class="page-inner" id="cineBox">
      <div class="page-heading">
        <h1 class="big-title">情境配乐</h1>
        <p class="muted">预设章节情绪与曲目，让配乐随阅读自然切换。</p>
      </div>
      <template v-if="!books.length">
        <div class="card"><p class="muted">库墙为空，请先导入小说（漫画暂不支持情绪分析）</p></div>
      </template>
      <template v-else>
        <div class="row cine-toolbar">
          <select class="sel" id="cineBookSel" aria-label="选择小说" :value="cineBookId" @change="onBookChange">
            <option v-for="b in books" :key="b.id" :value="b.id">《{{ b.title }}》</option>
          </select>
          <button class="btn primary" id="btnBatch" @click="onBatch"><AppIcon name="sparkles" />批量分析未分析章节</button>
          <span class="muted" id="batchInfo" role="status">{{ batchInfo }}</span>
        </div>
        <div id="chCards">
          <div v-for="(ch, i) in currentBook()?.chapters || []" :key="i" class="card ch-card">
            <div class="ch-head">
              <span class="muted" style="min-width:2.2em">{{ i + 1 }}.</span>
              <b class="grow">{{ ch.title }}</b>
              <span class="st" :class="{ done: !!analysisFor(i) }">{{ analysisFor(i) ? analysisFor(i)!.nodes.length + ' 个情绪节点' : '未分析' }}</span>
              <button class="btn small" @click="onAnalyze(i, $event.target as HTMLButtonElement)">{{ analysisFor(i) ? '重新分析' : 'AI 分析' }}</button>
              <button class="btn small" :aria-expanded="!!folds[cineBookId + ':' + i]" @click="toggleFold(i)">{{ analysisFor(i) ? '编辑' : '手动添加' }}</button>
            </div>
            <div v-if="folds[cineBookId + ':' + i] && cardNodes[i]" class="nodes">
              <div v-for="(n, k) in cardNodes[i]" :key="k" class="node-row">
                <span class="muted">进度 %</span>
                <input type="number" class="n-at" aria-label="情绪出现位置（百分比）" min="0" max="100" v-model.number="n.at" @change="onNodeChange(i)">
                <select class="n-em" aria-label="情绪" v-model="n.emotion" @change="onNodeChange(i)">
                  <option v-for="e in EMOTIONS" :key="e.label" :value="e.label">{{ e.label }}</option>
                  <option v-if="!EMO_LABELS.includes(n.emotion)" :value="n.emotion">{{ n.emotion }}</option>
                </select>
                <input type="text" class="n-note" aria-label="情绪说明" v-model="n.note" placeholder="情绪说明（可空）" @change="onNodeChange(i)">
                <button class="btn small danger icon-button" aria-label="删除节点" @click="delNode(i, k)"><AppIcon name="close" /></button>
              </div>
              <div class="row">
                <button class="btn small" @click="addNode(i)"><AppIcon name="plus" />添加节点</button>
                <span class="muted">进度为情绪出现位置（章节进度 0–100%），修改即时保存</span>
              </div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="row" style="margin-bottom:6px">
            <h2 class="card-title">情绪与曲目</h2>
            <span class="muted">阅读时按此表选曲</span>
            <div class="grow" />
            <button class="btn small" id="btnAutoMap" @click="onAutoMap">按曲目标签自动映射</button>
          </div>
          <div id="mapRows">
            <div v-for="e in EMOTIONS" :key="e.label" class="map-row">
              <span class="dot" :style="{ background: e.color }" />
              <b style="min-width:3em">{{ e.label }}</b>
              <select :aria-label="`${e.label}对应曲目`" :value="mapping[e.label] || ''" @change="onMapChange(e.label, $event)">
                <option value="">（未绑定）</option>
                <option v-for="mm in musics" :key="mm.id" :value="mm.id">{{ mm.name }}</option>
              </select>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
