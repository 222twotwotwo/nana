<script setup lang="ts">
import { useAppStore } from '../../stores/app'
const app = useAppStore()
</script>

<template>
  <div id="toast" :class="{ show: app.toastShow }">{{ app.toastMsg }}</div>
</template>
