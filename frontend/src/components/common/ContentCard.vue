<script setup lang="ts">
import { computed } from 'vue'
import CoverBlock from './CoverBlock.vue'
import { CONTENT_TYPES } from '../../constants'
import { clamp } from '../../utils'
import { progressLabel } from '../../services/catalog'
import { getProgress } from '../../services/settings'
import type { StoreItem } from '../../types'

const props = defineProps<{ item: StoreItem }>()
const emit = defineEmits<{ open: [] }>()

const progress = computed(() => getProgress()[props.item.localId as string])
const percent = computed(() => progress.value ? clamp(progress.value.pct || 0, 0, 100) : 0)
const ariaLabel = computed(() =>
  `${props.item.name} · ${props.item.sourceName || ''}${props.item.localId ? ' · ' + progressLabel(props.item) : ''}`)
const footLabel = computed(() =>
  progress.value ? Math.round(percent.value) + '%' : '未' + CONTENT_TYPES[props.item.type].verb)
</script>

<template>
  <div class="bk sr catalog-card" :class="{ saved: !!item.localId }" :data-type="item.type">
    <button class="catalog-open" :aria-label="ariaLabel" @click="emit('open')">
      <CoverBlock :title="item.name || '未命名'" :cover="item.cover" />
      <div class="catalog-copy">
        <div class="sr-name">{{ item.name }}</div>
        <div class="sr-meta">{{ item.author || item.meta || CONTENT_TYPES[item.type].label }}</div>
        <div class="sr-source">{{ item.sourceName || '' }}</div>
      </div>
    </button>
    <div v-if="item.localId" class="bc-foot">
      <span :title="progressLabel(item)">{{ footLabel }}</span>
      <button class="bc-more" :aria-label="`${item.name}的详情与操作`" @click="emit('open')">⋯</button>
    </div>
  </div>
</template>
