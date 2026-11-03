<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ title: string; eyebrow?: string; dismissible?: boolean }>(), {
  dismissible: true,
})
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

function keydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' && props.dismissible) {
    event.preventDefault()
    emit('close')
  }
  if (event.key !== 'Tab' || !panel.value) return
  const elements = [...panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
  )].filter(element => element.getClientRects().length > 0)
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (!first) {
    event.preventDefault()
    panel.value.focus()
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  await nextTick()
  panel.value?.focus()
})
onBeforeUnmount(() => previousFocus?.isConnected && previousFocus.focus())
</script>

<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="dismissible && emit('close')">
      <section ref="panel" class="game-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"
        tabindex="-1" @keydown="keydown">
        <button v-if="dismissible" type="button" class="dialog-close icon-button" aria-label="关闭弹窗" @click="emit('close')">
          <UiIcon name="close" />
        </button>
        <p v-if="eyebrow" class="dialog-eyebrow">{{ eyebrow }}</p>
        <h2 id="dialog-title">{{ title }}</h2>
        <slot />
      </section>
    </div>
  </Teleport>
</template>