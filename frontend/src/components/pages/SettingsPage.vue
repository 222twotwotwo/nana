<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '../../stores/app'
import { settings, saveSettings } from '../../services/settings'
import { SOURCES, initServer, api } from '../../services/server'
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
  const sample = h.ok
    ? s.type === 'music'
      ? `音频已读取 ${h.audioBytes || 0} 字节${h.preview ? '（试听）' : ''}`
      : `${h.chapters} 章`
    : `${h.stage}：${h.error}`
  return time + sample
}

async function onCheck(id: string, btn: HTMLButtonElement) {
  btn.disabled = true
  btn.textContent = '检测中…'
  try {
    await api('/api/check', { source: id })
    await initServer()
    app.toast('样本链路检测通过')
  } catch (e: any) {
    app.toast(e.message)
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
  await deleteDatabase()
  localStorage.removeItem('nr-settings')
  localStorage.removeItem('nr-mapping')
  localStorage.removeItem('nr-progress')
  location.reload()
}
</script>

<template>
  <section id="page-settings" class="page">
    <div class="page-inner" id="settingsBox">
      <h1 class="big-title">设置</h1>
      <p class="muted" style="margin:-14px 0 18px">填写任意 OpenAI 兼容接口（DeepSeek / Kimi / 通义 / 本地 Ollama…），用于预分析小说情绪</p>
      <div class="card">
        <label class="fld">API 地址（Base URL，自动拼接 /chat/completions）</label>
        <input type="text" id="setBase" placeholder="例如 https://api.deepseek.com/v1 或 http://localhost:11434/v1"
          :value="settings.apiBase" @change="saveSettings({ apiBase: ($event.target as HTMLInputElement).value.trim() })">
        <label class="fld">API Key（可留空，本地服务无需）</label>
        <input type="password" id="setKey" placeholder="sk-..."
          :value="settings.apiKey" @change="saveSettings({ apiKey: ($event.target as HTMLInputElement).value.trim() })">
        <label class="fld">模型名</label>
        <input type="text" id="setModel" placeholder="例如 deepseek-chat / gpt-4o-mini / qwen2.5:7b"
          :value="settings.model" @change="saveSettings({ model: ($event.target as HTMLInputElement).value.trim() })">
        <div class="row" style="margin-top:14px">
          <button class="btn primary" id="btnTest" @click="onTest">测试连接</button>
          <span class="muted" id="testInfo">{{ testInfo }}</span>
        </div>
      </div>
      <SourceImport />
      <div class="card">
        <b style="letter-spacing:2px">内容来源 · 连接状态</b>
        <p class="muted" style="margin:8px 0">检测包含搜索、目录、样本正文和漫画首尾图片下载。结果只代表检测时的样本。</p>
        <div id="sourceHealth">
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
      <div class="card">
        <label class="fld">渐入渐出时长：<b id="fadeVal">{{ settings.fadeSec }}</b> 秒</label>
        <input type="range" id="setFade" min="1" max="10" step="0.5" style="width:100%"
          :value="settings.fadeSec" @input="saveSettings({ fadeSec: Number(($event.target as HTMLInputElement).value) }); $forceUpdate?.()">
        <label class="fld">默认音量：<b id="volVal">{{ Math.round(settings.volume * 100) }}%</b></label>
        <input type="range" id="setVol" min="0" max="100" style="width:100%"
          :value="Math.round(settings.volume * 100)" @input="saveSettings({ volume: Number(($event.target as HTMLInputElement).value) / 100 })">
      </div>
      <div class="card">
        <b>备份与迁移</b>
        <p class="muted" style="margin:8px 0">导出小说、漫画、音乐、番剧收藏，以及分析、进度与设置（不含 API Key）。可在另一浏览器或访问地址恢复。</p>
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
