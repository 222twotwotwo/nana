<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useSearchStore } from '../../stores/search'
import { CONTENT_TYPES } from '../../constants'
import { fmtTime } from '../../utils'
import CoverBlock from '../common/CoverBlock.vue'

const search = useSearchStore()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') search.closeStoreModal()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div id="storeModal" :class="{ hidden: search.modal.view === 'closed' }" role="dialog" aria-modal="true"
    aria-label="作品详情" @click.self="search.closeStoreModal()">
    <div class="sm-box" v-if="search.modal.view !== 'closed'">
      <button class="sm-close" id="smClose" aria-label="关闭" @click="search.closeStoreModal()">✕</button>

      <template v-if="search.modal.view === 'loading'">
        <p class="store-empty">正在读取作品详情…</p>
      </template>

      <template v-else-if="search.modal.view === 'error'">
        <p class="store-empty">{{ search.modal.error }}</p>
        <button class="btn" id="smRetry" @click="search.retryModal()">重试</button>
      </template>

      <template v-else-if="search.modal.view === 'detail' && search.modal.det">
        <div class="sm-head">
          <CoverBlock :title="search.modal.det.name || ''" :cover="search.modal.det.cover || search.modal.item?.cover"
            class="sm-cover" />
          <div class="grow">
            <div class="sm-title">{{ search.modal.det.name }}</div>
            <div class="sm-meta">{{ CONTENT_TYPES[search.modal.type].label }} · {{ search.modal.source.name }}</div>
            <div class="sm-meta">
              {{ search.modal.det.author || search.modal.item?.author || '' }}<template
                v-if="search.modal.type === 'music'">{{ search.modal.det.duration ? ' · ' + fmtTime(search.modal.det.duration) : '' }}</template><template
                v-else> · {{ search.modal.det.chapters.length }} {{ CONTENT_TYPES[search.modal.type].part }}</template>
            </div>
          </div>
        </div>
        <p class="sm-intro">{{ search.modal.det.intro || search.modal.item?.meta || '暂无简介' }}</p>
        <div class="row">
          <button class="btn primary" id="smRead" :disabled="search.modal.busy" @click="search.readButton()">{{ search.modal.saved ? '继续' : '开始' }}{{ CONTENT_TYPES[search.modal.type].verb }}</button>
          <button class="btn" id="smSave" :disabled="search.modal.busy || !!search.modal.saved" @click="search.saveButton()">{{ search.modal.saved ? '已收藏' : '加入收藏' }}</button>
          <a v-if="search.modal.original" class="btn" :href="search.modal.original" target="_blank" rel="noopener noreferrer">原站</a>
          <button v-if="search.modal.saved" class="btn danger" id="smRemove" @click="search.removeButton()">移出收藏</button>
        </div>
        <p class="muted detail-note">开始{{ CONTENT_TYPES[search.modal.type].verb }}后自动加入收藏，方便下次继续。<template v-if="search.modal.type === 'novel'">正文按需缓存。</template><template v-else-if="search.modal.type === 'music' && search.modal.det.preview">当前为试听片段。</template></p>
        <button v-if="search.modal.type === 'novel' && search.modal.source.id" class="btn small" id="smCache" :disabled="search.modal.busy" @click="search.cacheButton()">缓存前 50 章</button>
        <div v-if="search.modal.cache.running || search.modal.cache.done">
          <div class="prog"><i :style="{ width: (search.modal.cache.done / Math.max(1, search.modal.cache.count) * 100) + '%' }" /></div>
          <div class="row"><span class="muted grow">已处理 {{ search.modal.cache.done }}/{{ search.modal.cache.count }} 章 · {{ search.modal.cache.failed }} 章失败，目录已保留</span></div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 弹窗头部封面宽度与原版 .sm-head .cover 一致 */
.sm-head :deep(.cover) {
  width: 110px;
  flex: none;
  font-size: 12px;
  padding: 8px;
}
</style>
