<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { cssTimeMs } from '../../composables/cssTime'
import type { PopItem } from '../../types'

const app = useAppStore()
const popRef = ref<HTMLElement | null>(null)
const pos = ref({ top: '0px', left: '0px' })

/**
 * 退场动画：v-if 直接卸载元素没有过渡可言，因此保留最后一次的菜单项，
 * 先淡出再清空（内容与定位在退场期间保持不变，不会跳位）。
 *
 * 注意：清空必须真的把元素移出 DOM。菜单是 position:absolute 挂在 body 下的，
 * 若只做 visibility:hidden 保留，它带着上一次的 left（例如桌面宽度下算出的
 * 1059px）继续参与文档溢出计算——窄视口下会把页面撑出横向滚动条。
 */
const items = ref<PopItem[]>([])
const open = ref(false)
let unmountTimer: ReturnType<typeof setTimeout> | null = null

/** 从 CSS 令牌取退场时长（注意 .22s → 220ms 的换算） */
const exitDuration = () => cssTimeMs('--dur-fast', 220)

function place(anchor: HTMLElement) {
  const el = popRef.value
  if (!el) return
  const r = anchor.getBoundingClientRect()
  const pw = el.offsetWidth
  const left = Math.max(10, Math.min(r.right - pw, window.innerWidth - pw - 10))
  pos.value = { top: (r.bottom + 8) + 'px', left: left + 'px' }
}

let anchorEl: HTMLElement | null = null

watch(() => app.pop, async (p) => {
  if (unmountTimer) { clearTimeout(unmountTimer); unmountTimer = null }
  if (!p) {
    open.value = false
    unmountTimer = setTimeout(() => { items.value = []; anchorEl = null }, exitDuration() + 40)
    return
  }
  anchorEl = p.anchor
  items.value = p.items
  open.value = true
  await nextTick()
  const el = popRef.value
  if (!el) return
  place(p.anchor)
  setTimeout(() => {
    const close = (e: MouseEvent) => { if (!el.contains(e.target as Node)) app.closePop() }
    document.addEventListener('click', close, { once: true })
  }, 0)
}, { immediate: true })

/** 视口变化时跟随锚点重新定位，避免菜单跑到屏幕外 */
function onResize() { if (open.value && anchorEl) place(anchorEl) }
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (unmountTimer) clearTimeout(unmountTimer)
})

function clickItem(it: PopItem) {
  app.closePop()
  it.fn?.()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="items.length" ref="popRef" class="pop" :class="{ 'anim-hidden': !open }" :style="pos">
      <template v-for="(it, i) in items" :key="i">
        <div v-if="it.sep" class="sep" />
        <button v-else :class="{ danger: it.danger }" @click="clickItem(it)">{{ it.label }}</button>
      </template>
    </div>
  </Teleport>
</template>
