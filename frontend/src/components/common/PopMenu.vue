<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import type { PopItem } from '../../types'

const app = useAppStore()
const popRef = ref<HTMLElement | null>(null)
const pos = ref({ top: '0px', left: '0px' })

watch(() => app.pop, async (p) => {
  if (!p) return
  await nextTick()
  const el = popRef.value
  if (!el) return
  const r = p.anchor.getBoundingClientRect()
  const pw = el.offsetWidth
  const left = Math.max(10, Math.min(r.right - pw, window.innerWidth - pw - 10))
  pos.value = { top: (r.bottom + 8) + 'px', left: left + 'px' }
  setTimeout(() => {
    const close = (e: MouseEvent) => { if (!el.contains(e.target as Node)) app.closePop() }
    document.addEventListener('click', close, { once: true })
  }, 0)
}, { immediate: true })

function clickItem(it: PopItem) {
  app.closePop()
  it.fn?.()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="app.pop" ref="popRef" class="pop" :style="pos">
      <template v-for="(it, i) in app.pop.items" :key="i">
        <div v-if="it.sep" class="sep" />
        <button v-else :class="{ danger: it.danger }" @click="clickItem(it)">{{ it.label }}</button>
      </template>
    </div>
  </Teleport>
</template>
