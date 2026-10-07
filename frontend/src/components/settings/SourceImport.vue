<script setup lang="ts">
import { computed, ref } from 'vue'
import { api, SOURCES } from '../../services/server'
import { confirmDialog } from '../../services/confirm'
import type { SourceMeta } from '../../types'

const sourceFile = ref<HTMLInputElement | null>(null)
const sourceJson = ref('')
const busy = ref(false)
const message = ref('')
const error = ref(false)
const customSources = computed(() => SOURCES.value.filter(source => source.custom))

async function importRules(input: File | string) {
  if (busy.value) return
  busy.value = true
  message.value = '正在导入…'
  error.value = false
  try {
    const size = typeof input === 'string' ? new Blob([input]).size : input.size
    if (size > 1024 * 1024) throw new Error('规则文件不能超过 1 MB')
    const rules = typeof input === 'string' ? input : await input.text()
    if (!rules.trim()) throw new Error('请选择 JSON 文件或粘贴规则内容')
    const result = await api('/api/sources/import', { rules })
    SOURCES.value = result.sources
    sourceJson.value = ''
    message.value = `导入完成：新增 ${result.added} 个，更新 ${result.updated} 个。可在番剧搜索和播放来源中使用。`
  } catch (e: any) {
    error.value = true
    message.value = '导入失败：' + e.message
  } finally { busy.value = false }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await importRules(file)
  input.value = ''
}

async function removeSource(source: SourceMeta) {
  if (busy.value) return
  const ok = await confirmDialog({ title: '移除来源', message: `移除「${source.name}」？收藏和进度会保留；重新导入同名、同站点的规则可恢复使用。`, okText: '移除', danger: true })
  if (!ok) return
  busy.value = true
  error.value = false
  try {
    const result = await api('/api/sources/remove', { source: source.id })
    SOURCES.value = result.sources
    message.value = `已移除「${source.name}」`
  } catch (e: any) {
    error.value = true
    message.value = '移除失败：' + e.message
  } finally { busy.value = false }
}
</script>

<template>
  <div class="card" id="customSources">
    <b>导入番剧源</b>
    <p class="muted">支持 Kazumi JSON 文件，可包含一个源或源数组，每次最多 100 个、1 MB。导入后立即生效，重启后保留。</p>
    <button class="btn primary" :disabled="busy" @click="sourceFile?.click()">选择 JSON 文件</button>
    <input ref="sourceFile" id="sourceFile" type="file" accept=".json,application/json" class="hidden" :disabled="busy" @change="onFile">
    <details class="source-paste">
      <summary>粘贴 JSON 导入</summary>
      <label class="fld" for="sourceJson">Kazumi 规则内容</label>
      <textarea id="sourceJson" v-model="sourceJson" rows="6" placeholder="粘贴单个规则对象 { … } 或规则数组 [ … ]" :disabled="busy" spellcheck="false" />
      <button class="btn" :disabled="busy || !sourceJson.trim()" @click="importRules(sourceJson)">导入规则</button>
    </details>
    <p v-if="message" class="import-result" :class="{ 'import-error': error }" role="status">{{ message }}</p>
    <p class="muted">同名、同站点的自定义源再次导入会更新；内置源不受影响。支持 XPath 和 API 规则，播放需源站提供公开视频地址。</p>
    <div v-for="source in customSources" :key="source.id" class="source-row">
      <div>
        <b>{{ source.name }}</b>
        <p class="muted source-address">{{ source.base }}</p>
      </div>
      <button class="btn small" :disabled="busy" :aria-label="`移除 ${source.name}`" @click="removeSource(source)">移除</button>
    </div>
    <p v-if="!customSources.length" class="muted">尚未导入自定义源。</p>
  </div>
</template>

<style scoped>
.source-paste { margin-top: 16px; }
.source-paste summary { cursor: pointer; }
textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; padding: 12px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--text); font: inherit; }
.source-address, .import-result { overflow-wrap: anywhere; }
.import-error { color: #b13a2b; }
</style>
