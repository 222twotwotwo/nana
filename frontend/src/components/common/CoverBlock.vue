<script setup lang="ts">
import { ref } from 'vue'
import { hashGrad } from '../../utils'

const props = defineProps<{ title: string; cover?: string }>()
const failed = ref(false)
</script>

<template>
  <div v-if="!cover || failed" class="cover cv-placeholder">{{ title.slice(0, 24) }}</div>
  <div v-else class="cover" :style="{ background: hashGrad(title) }">
    <img class="cv-img" :src="cover" referrerpolicy="no-referrer" loading="lazy" @error="failed = true">
    <span class="cv-fallback">{{ title.slice(0, 24) }}</span>
  </div>
</template>
