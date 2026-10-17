<script setup lang="ts">
const paths = {
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  previous: 'M5 5v14m14-14L8 12l11 7Z',
  next: 'M19 5v14M5 5l11 7-11 7Z',
  shuffle: 'M3 7h3c4 0 8 10 12 10h3m-4-4 4 4-4 4M3 17h3c1 0 2-1 3-2m6-6 3-2h3m-4-4 4 4-4 4',
  replay: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  music: 'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3h3m12 1a3 3 0 1 1-3-3h3',
  close: 'm6 6 12 12M6 18 18 6',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  moon: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  info: 'M12 8h.01M12 11v6m0-14a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  up: 'm5 12 7-7 7 7M12 5v14',
  plus: 'M12 5v14M5 12h14',
  sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
} as const

defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[name]" />
  </svg>
</template>
