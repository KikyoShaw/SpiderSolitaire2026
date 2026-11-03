<script setup lang="ts">
import { computed } from 'vue'
import { rankLabel, SUIT_SYMBOLS, type Card } from '../game/types'

const props = defineProps<{ card?: Card; back?: boolean }>()
const isBack = computed(() => props.back || !props.card?.faceUp)
const red = computed(() => props.card?.suit === 'hearts' || props.card?.suit === 'diamonds')
const symbol = computed(() => props.card ? SUIT_SYMBOLS[props.card.suit] : '♠')

const pipLayouts: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[50, 24], [50, 76]],
  3: [[50, 22], [50, 50], [50, 78]],
  4: [[29, 25], [71, 25], [29, 75], [71, 75]],
  5: [[29, 25], [71, 25], [50, 50], [29, 75], [71, 75]],
  6: [[29, 23], [71, 23], [29, 50], [71, 50], [29, 77], [71, 77]],
  7: [[29, 23], [71, 23], [50, 36], [29, 50], [71, 50], [29, 77], [71, 77]],
  8: [[29, 23], [71, 23], [50, 36], [29, 50], [71, 50], [50, 64], [29, 77], [71, 77]],
  9: [[29, 20], [71, 20], [29, 40], [71, 40], [50, 50], [29, 60], [71, 60], [29, 80], [71, 80]],
  10: [[29, 20], [71, 20], [50, 30], [29, 40], [71, 40], [29, 60], [71, 60], [50, 70], [29, 80], [71, 80]],
}
const pips = computed(() => pipLayouts[props.card?.rank ?? 0] ?? [])
</script>

<template>
  <div class="playing-card" :class="{ 'card-back': isBack, 'card-red': red && !isBack }" aria-hidden="true">
    <template v-if="isBack">
      <div class="back-frame"><span class="back-emblem">♠</span></div>
    </template>
    <template v-else-if="card">
      <div class="card-corner corner-top"><b>{{ rankLabel(card.rank) }}</b><span>{{ symbol }}</span></div>
      <div v-if="card.rank > 10" class="card-court">
        <span class="court-suit">{{ symbol }}</span><b>{{ rankLabel(card.rank) }}</b><span class="court-suit">{{ symbol }}</span>
      </div>
      <span v-for="([x, y], index) in pips" :key="index" class="card-pip"
        :class="{ 'pip-inverted': y > 50, 'pip-ace': card.rank === 1 }"
        :style="{ left: `${x}%`, top: `${y}%` }">{{ symbol }}</span>
      <div class="card-corner corner-bottom"><b>{{ rankLabel(card.rank) }}</b><span>{{ symbol }}</span></div>
    </template>
  </div>
</template>