<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { confirmPending, settleConfirm } from '../../services/confirm'
import type { ConfirmOptions } from '../../services/confirm'

const p = computed(() => confirmPending())

/**
 * 退场动画：v-if 直接卸载元素是没有过渡可言的。
 * 因此这里保留「最后一次」的配置与可见状态，让弹窗先淡出再真正清空内容。
 *
 * 进场同样要分两帧：容器是 v-if="opts" 挂载的，若在同一个 tick 里把 opts 与 open
 * 都置真，元素一出现就是可见态，backdrop 的透明度过渡不会播放（只有内部 .ac-box
 * 的 overlayIn 动画在动）。所以先以收起态挂载，等两帧后再打开。
 */
const opts = ref<ConfirmOptions | null>(null)
const open = ref(false)
let revealRaf = 0

watch(p, (v) => {
  if (revealRaf) { cancelAnimationFrame(revealRaf); revealRaf = 0 }
  if (v) {
    opts.value = v.opts
    open.value = false
    // 双 rAF：首帧让浏览器采纳「收起态」的计算样式，次帧再切到可见态，
    // 这样 backdrop 才会有完整的透明度过渡而非瞬间出现。
    revealRaf = requestAnimationFrame(() => requestAnimationFrame(() => {
      revealRaf = 0
      open.value = true
    }))
  } else {
    open.value = false
  }
}, { immediate: true })

function onKey(e: KeyboardEvent) {
  if (!confirmPending()) return
  if (e.key === 'Escape') settleConfirm(false)
  else if (e.key === 'Enter') settleConfirm(true)
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (revealRaf) cancelAnimationFrame(revealRaf)
})
</script>

<template>
  <div v-if="opts" id="appConfirm" role="alertdialog" :aria-modal="open ? 'true' : 'false'"
    :aria-hidden="open ? 'false' : 'true'"
    :class="{ 'anim-hidden': !open }"
    :aria-label="opts.title || '确认'" @click.self="settleConfirm(false)">
    <div class="ac-box">
      <div class="ac-title">{{ opts.title || '确认' }}</div>
      <p class="ac-msg">{{ opts.message }}</p>
      <div class="row ac-actions">
        <button class="btn" @click="settleConfirm(false)">{{ opts.cancelText || '取消' }}</button>
        <button class="btn" :class="opts.danger ? 'danger solid' : 'primary'"
          @click="settleConfirm(true)">{{ opts.okText || '确定' }}</button>
      </div>
    </div>
  </div>
</template>
