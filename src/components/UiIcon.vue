<script setup lang="ts">
const paths = {
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  hint: 'M9 18h6m-5 3h4M8.1 14.2a7 7 0 1 1 7.8 0c-.8.6-1.4 1.1-1.4 2.3h-5c0-1.2-.6-1.7-1.4-2.3Z',
  pause: 'M8 5v14M16 5v14',
  play: 'm8 5 11 7-11 7Z',
  plus: 'M12 5v14M5 12h14',
  restart: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  check: 'm5 12 4 4L19 6',
  trophy: 'M8 3h8v8a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 15v6m-4 0h8',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
} as const

defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]" /></svg>
</template>
