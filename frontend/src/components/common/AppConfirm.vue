<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { confirmPending, settleConfirm } from '../../services/confirm'

const p = computed(() => confirmPending())

function onKey(e: KeyboardEvent) {
  if (!confirmPending()) return
  if (e.key === 'Escape') settleConfirm(false)
  else if (e.key === 'Enter') settleConfirm(true)
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="p" id="appConfirm" role="alertdialog" aria-modal="true"
    :aria-label="p.opts.title || '确认'" @click.self="settleConfirm(false)">
    <div class="ac-box">
      <div class="ac-title">{{ p.opts.title || '确认' }}</div>
      <p class="ac-msg">{{ p.opts.message }}</p>
      <div class="row ac-actions">
        <button class="btn" @click="settleConfirm(false)">{{ p.opts.cancelText || '取消' }}</button>
        <button class="btn" :class="p.opts.danger ? 'danger solid' : 'primary'"
          @click="settleConfirm(true)">{{ p.opts.okText || '确定' }}</button>
      </div>
    </div>
  </div>
</template>
