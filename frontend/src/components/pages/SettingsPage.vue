<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '../../stores/app'
import { settings, saveSettings } from '../../services/settings'
import { SOURCES, HAS_SERVER, initServer, api } from '../../services/server'
import { player } from '../../services/audio'
import { deleteDatabase } from '../../services/idb'
import { MoyinBackup } from '../../services/backup'
import { confirmDialog } from '../../services/confirm'
import SourceImport from '../settings/SourceImport.vue'

const app = useAppStore()
const testInfo = ref('')
const backupFile = ref<HTMLInputElement | null>(null)
const sources = computed(() => SOURCES.value)

onMounted(async () => {
  if (!SOURCES.value.length) await initServer()
})

const LABELS: Record<string, string> = { healthy: '样本可读', failed: '检测失败', stale: '检测已过期', unchecked: '尚未检测' }

function healthText(s: any) {
  if (!s.health) return '点击检测确认当前网络可用性'
  const h = s.health
  const time = h.checkedAt ? new Date(h.checkedAt).toLocaleString('zh-CN') + ' · ' : ''
  // 原版：`${sample} / ${音乐 ? 音频字节 : 章数}`
  const detail = s.type === 'music'
    ? `音频已读取 ${h.audioBytes || 0} 字节${h.preview ? '（试听）' : ''}`
    : `${h.chapters} 章`
  const sample = h.ok ? `${h.sample ? h.sample + ' / ' : ''}${detail}` : `${h.stage}：${h.error}`
  return time + sample
}

async function onCheck(id: string, btn: HTMLButtonElement) {
  btn.disabled = true
  btn.textContent = '检测中…'
  try {
    // 检测失败时服务端仍返回 200，必须读 body 里的 ok 才能判断真实结果
    const r = (await api('/api/check', { source: id })).data
    await initServer()
    app.toast(r?.ok ? '样本链路检测通过' : `检测失败：${r?.error || '未知原因'}`)
  } catch (e: any) {
    app.toast(e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '重新检测'
  }
}

async function onTest() {
  testInfo.value = '连接中…'
  try {
    const { callLLM } = await import('../../services/llm')
    await callLLM([{ role: 'user', content: '只回复两个字：好的' }], 8)
    testInfo.value = '✓ 连接成功'
  } catch (e: any) {
    testInfo.value = '✗ ' + e.message
  }
}

async function onExport() {
  try {
    const n = await MoyinBackup.export()
    app.toast(`已导出 ${n} 本书和音乐、阅读进度`)
  } catch (e: any) { app.toast(e.message) }
}

async function onBackupFile(e: Event) {
  const input = e.target as HTMLInputElement
  try {
    const data = await MoyinBackup.read(input.files![0])
    if (!await confirmDialog({ title: '恢复备份', message: `恢复 ${data.stores.books.length} 本书、${data.stores.music.length} 首音乐？同编号记录将被替换，其余记录保留。`, okText: '恢复' })) return
    await MoyinBackup.restore(data)
    app.toast('恢复完成')
  } catch (err: any) {
    app.toast('恢复失败：' + err.message)
  }
  input.value = ''
}

async function onWipe() {
  if (!await confirmDialog({ title: '清空全部数据', message: '将删除所有书籍、音乐、情境分析与设置，且不可恢复。确定继续？', okText: '全部删除', danger: true })) return
  if (player.ctx) player.fadeStop()
  // 其它标签页仍开着时删除会被阻塞，此时不能刷新，否则用户会以为已清空
  if (await deleteDatabase() === 'blocked') { app.toast('请关闭其他 nana 标签页后重试'); return }
  localStorage.removeItem('nr-settings')
  localStorage.removeItem('nr-mapping')
  localStorage.removeItem('nr-progress')
  location.reload()
}
</script>

<template>
  <section id="page-settings" class="page">
    <div class="page-inner" id="settingsBox">
      <div class="page-heading">
        <h1 class="big-title">设置</h1>
        <p class="muted">管理情绪分析、内容来源与本地数据。</p>
      </div>
      <div class="card">
        <h2 class="card-title">AI 情绪分析</h2>
        <p class="muted card-description">填写任意 OpenAI 兼容接口（DeepSeek / Kimi / 通义 / 本地 Ollama…），用于预分析小说情绪。</p>
        <label class="fld" for="setBase">API 地址（Base URL，自动拼接 /chat/completions）</label>
        <input type="text" id="setBase" placeholder="例如 https://api.deepseek.com/v1 或 http://localhost:11434/v1"
          :value="settings.apiBase" @change="saveSettings({ apiBase: ($event.target as HTMLInputElement).value.trim() })">
        <label class="fld" for="setKey">API Key（可留空，本地服务无需）</label>
        <input type="password" id="setKey" placeholder="sk-..."
          :value="settings.apiKey" @change="saveSettings({ apiKey: ($event.target as HTMLInputElement).value.trim() })">
        <label class="fld" for="setModel">模型名</label>
        <input type="text" id="setModel" placeholder="例如 deepseek-chat / gpt-4o-mini / qwen2.5:7b"
          :value="settings.model" @change="saveSettings({ model: ($event.target as HTMLInputElement).value.trim() })">
        <div class="row card-actions">
          <button class="btn primary" id="btnTest" @click="onTest">测试连接</button>
          <span class="muted" id="testInfo" role="status">{{ testInfo }}</span>
        </div>
      </div>
      <div class="card">
        <h2 class="card-title">内容来源 · 连接状态</h2>
        <p class="muted card-description">检测包含搜索、目录、样本正文和漫画首尾图片下载。结果只代表检测时的样本。</p>
        <div id="sourceHealth">
          <p v-if="!sources.length" class="muted">{{ HAS_SERVER ? '暂无已接入来源。' : '服务未连接，请运行 npm start 后刷新页面。' }}</p>
          <div v-for="s in sources" :key="s.id" class="source-row">
            <div>
              <b>{{ s.name }}</b>{{ s.custom ? '（自定义）' : '' }} · {{ LABELS[s.status] || s.status }}
              <p class="muted">{{ s.note }}</p>
              <p class="muted">{{ healthText(s) }}</p>
            </div>
            <button class="btn small" @click="onCheck(s.id, $event.target as HTMLButtonElement)">重新检测</button>
          </div>
        </div>
        <p class="muted" style="margin-top:12px">第三方来源仅供个人使用；登录、付费或下架内容可能无法打开。四类收藏和阅读、播放进度保存在当前浏览器，请通过固定地址访问。</p>
      </div>
      <!-- 新增功能（旧版没有）：放在来源状态之后，使旧版已有的卡片保持原有顺序与位置 -->
      <SourceImport />
      <div class="card">
        <h2 class="card-title">播放偏好</h2>
        <label class="fld" for="setFade">渐入渐出时长：<b id="fadeVal">{{ settings.fadeSec }}</b> 秒</label>
        <input type="range" id="setFade" min="1" max="10" step="0.5"
          :value="settings.fadeSec" @input="saveSettings({ fadeSec: Number(($event.target as HTMLInputElement).value) }); $forceUpdate?.()">
        <label class="fld" for="setVol">默认音量：<b id="volVal">{{ Math.round(settings.volume * 100) }}%</b></label>
        <input type="range" id="setVol" min="0" max="100"
          :value="Math.round(settings.volume * 100)" @input="saveSettings({ volume: Number(($event.target as HTMLInputElement).value) / 100 })">
      </div>
      <div class="card">
        <h2 class="card-title">备份与迁移</h2>
        <p class="muted card-description">导出小说、漫画、音乐、番剧收藏，以及分析、进度与设置（不含 API Key）。可在另一浏览器或访问地址恢复。</p>
        <div class="row">
          <button class="btn" id="exportBackup" @click="onExport">导出备份</button>
          <button class="btn" id="importBackup" @click="backupFile?.click()">恢复备份</button>
          <input id="backupFile" ref="backupFile" type="file" accept=".json" class="hidden" @change="onBackupFile">
        </div>
      </div>
      <div class="card">
        <div class="row">
          <button class="btn danger" id="btnWipe" @click="onWipe">清空所有数据</button>
          <span class="muted">删除全部书籍、音乐、分析与设置，不可恢复</span>
        </div>
      </div>
    </div>
  </section>
</template>
