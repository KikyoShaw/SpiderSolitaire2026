<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import GameDialog from './components/GameDialog.vue'
import PlayingCard from './components/PlayingCard.vue'
import UiIcon from './components/UiIcon.vue'
import { useSpiderGame } from './composables/useSpiderGame'
import { canMove, isMovableSequence } from './game/engine'
import { cardLabel, DIFFICULTIES, SUIT_SYMBOLS, type Card, type Difficulty } from './game/types'

const {
  game, selection, hint, message, storageWarning, paused, won, suspended,
  score, canUndo, dealBlockReason, formattedTime,
  chooseCard, chooseColumn, canDrop, move, deal, undo, showHint,
  clearSelection, startNewGame, togglePause, setDialogOpen,
} = useSpiderGame()

const dialog = ref<'new' | 'restart' | 'rules' | 'win' | null>(null)
const pendingDifficulty = ref<Difficulty>(game.value.difficulty)
const activeDialog = computed(() => dialog.value ?? (paused.value ? 'pause' : null))
const difficulty = computed(() => DIFFICULTIES.find(item => item.value === game.value.difficulty)!)
const remainingDeals = computed(() => game.value.stock.length / 10)
const dialogTitle = computed(() => ({
  new: '开始一段新的思考', restart: '再来一次，这局牌', rules: '慢慢来，每一步都有可能',
  win: '好牌，也要好手。', pause: '休息一下，再继续。',
})[activeDialog.value ?? 'new'])
const dialogEyebrow = computed(() => ({
  new: 'NEW GAME / 新的牌局', restart: 'TRY AGAIN / 重开本局', rules: 'HOW TO PLAY / 游戏规则',
  win: 'WELL PLAYED / 本局完成', pause: 'TAKE A BREAK / 游戏暂停',
})[activeDialog.value ?? 'new'])

const board = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const boardWidth = ref(1160)
const viewportHeight = ref(420)
const columnGap = computed(() => boardWidth.value < 1050 ? 10 : 14)
const cardWidth = computed(() => Math.max(50, (boardWidth.value - columnGap.value * 9) / 10))
const cardHeight = computed(() => cardWidth.value * 1.4)
const faceUpStep = computed(() => Math.max(28, Math.min(35, cardWidth.value * 0.31)))
const faceDownStep = computed(() => Math.max(12, Math.min(18, cardWidth.value * 0.16)))
const layouts = computed(() => game.value.columns.map(column => {
  let top = 0
  const offsets = column.map((card, index) => {
    const offset = top
    if (index < column.length - 1) top += card.faceUp ? faceUpStep.value : faceDownStep.value
    return offset
  })
  return { offsets, height: Math.max(top + cardHeight.value, viewportHeight.value - 36) }
}))

interface Gesture {
  pointerId: number
  column: number
  index: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  width: number
  element: HTMLElement
}
interface DraggedCards {
  column: number
  index: number
  x: number
  y: number
  width: number
  step: number
  cards: Card[]
}
const gesture = shallowRef<Gesture | null>(null)
const dragging = shallowRef<DraggedCards | null>(null)
const hoveredColumn = ref<number | null>(null)
let suppressClickUntil = 0
let scrollFrame = 0
let resizeObserver: ResizeObserver | undefined

function cancelDrag() {
  const previous = gesture.value
  if (dragging.value) suppressClickUntil = performance.now() + 250
  gesture.value = null
  dragging.value = null
  hoveredColumn.value = null
  cancelAnimationFrame(scrollFrame)
  if (previous?.element.hasPointerCapture(previous.pointerId)) {
    previous.element.releasePointerCapture(previous.pointerId)
  }
}

function columnAtPoint(x: number, y: number): number | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-column]')
  return element ? Number(element.dataset.column) : null
}

function scrollWhileDragging() {
  const current = dragging.value
  const start = gesture.value
  if (!current || !start || !scroller.value) return
  const y = current.y + start.offsetY
  const x = current.x + start.offsetX
  const rect = scroller.value.getBoundingClientRect()
  if (x >= rect.left && x <= rect.right && y >= rect.top - 20 && y <= rect.bottom + 20) {
    if (y < rect.top + 50) scroller.value.scrollTop -= Math.ceil((rect.top + 50 - y) / 5)
    if (y > rect.bottom - 50) scroller.value.scrollTop += Math.ceil((y - rect.bottom + 50) / 5)
  }
  hoveredColumn.value = columnAtPoint(x, y)
  scrollFrame = requestAnimationFrame(scrollWhileDragging)
}

function beginDrag(event: PointerEvent, column: number, index: number) {
  if (event.button !== 0 || suspended.value || gesture.value || !isMovableSequence(game.value.columns[column], index)) return
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  gesture.value = {
    pointerId: event.pointerId, column, index,
    startX: event.clientX, startY: event.clientY,
    offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
    width: rect.width, element,
  }
  element.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  const start = gesture.value
  if (!start || start.pointerId !== event.pointerId) return
  if (!dragging.value && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 6) return
  event.preventDefault()
  if (!dragging.value) {
    clearSelection()
    dragging.value = {
      column: start.column, index: start.index,
      x: event.clientX - start.offsetX, y: event.clientY - start.offsetY,
      width: start.width, step: faceUpStep.value,
      cards: game.value.columns[start.column].slice(start.index),
    }
    scrollFrame = requestAnimationFrame(scrollWhileDragging)
  } else {
    dragging.value = { ...dragging.value, x: event.clientX - start.offsetX, y: event.clientY - start.offsetY }
  }
  hoveredColumn.value = columnAtPoint(event.clientX, event.clientY)
}

function pointerUp(event: PointerEvent) {
  const start = gesture.value
  if (!start || start.pointerId !== event.pointerId) return
  const didDrag = dragging.value !== null
  const target = didDrag ? columnAtPoint(event.clientX, event.clientY) : null
  cancelDrag()
  if (didDrag && target !== null && target !== start.column) move({ column: start.column, index: start.index, target })
}

function pointerCancelled(event: PointerEvent) {
  if (gesture.value?.pointerId === event.pointerId) cancelDrag()
}

function clickCard(column: number, index: number) {
  if (performance.now() < suppressClickUntil) return
  chooseCard(column, index)
}

function clickColumn(column: number) {
  if (performance.now() < suppressClickUntil) return
  chooseColumn(column)
}

function isTarget(column: number) {
  if (dragging.value) {
    return hoveredColumn.value === column
      && canMove(game.value, { column: dragging.value.column, index: dragging.value.index, target: column })
  }
  return canDrop(column)
}

function isHighlighted(column: number, index: number) {
  const selected = selection.value ?? hint.value
  return selected?.column === column && index >= selected.index
}

function perform(action: () => void) {
  cancelDrag()
  action()
}

function openNewGame() {
  pendingDifficulty.value = game.value.difficulty
  dialog.value = 'new'
}

function confirmNewGame() {
  startNewGame(pendingDifficulty.value)
  dialog.value = null
}

function confirmRestart() {
  startNewGame(game.value.difficulty, game.value.seed)
  dialog.value = null
}

function closeDialog() {
  if (activeDialog.value === 'pause') togglePause()
  else dialog.value = won.value ? 'win' : null
}

async function undoWin() {
  dialog.value = null
  await nextTick()
  undo()
}

function keyboard(event: KeyboardEvent) {
  const element = event.target as HTMLElement | null
  if (element?.closest('input, textarea, select, [contenteditable="true"]') || event.repeat) return
  if (activeDialog.value) return
  const key = event.key.toLowerCase()
  if (key === 'escape') {
    cancelDrag()
    clearSelection()
    return
  }
  if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    perform(undo)
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const shortcuts: Record<string, () => void> = { h: showHint, d: deal, p: togglePause }
  if (shortcuts[key]) {
    event.preventDefault()
    perform(shortcuts[key])
  }
}

watch(activeDialog, value => {
  cancelDrag()
  setDialogOpen(value !== null && value !== 'pause')
}, { flush: 'sync' })
watch(won, value => {
  if (value) dialog.value = 'win'
}, { immediate: true })
watch(game, cancelDrag, { flush: 'sync' })

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (board.value) boardWidth.value = board.value.clientWidth
    if (scroller.value) viewportHeight.value = scroller.value.clientHeight
  })
  if (board.value) resizeObserver.observe(board.value)
  if (scroller.value) resizeObserver.observe(scroller.value)
  window.addEventListener('pointermove', pointerMove, { passive: false })
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', pointerCancelled)
  window.addEventListener('lostpointercapture', pointerCancelled)
  window.addEventListener('blur', cancelDrag)
  window.addEventListener('keydown', keyboard)
})
onBeforeUnmount(() => {
  cancelDrag()
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', pointerMove)
  window.removeEventListener('pointerup', pointerUp)
  window.removeEventListener('pointercancel', pointerCancelled)
  window.removeEventListener('lostpointercapture', pointerCancelled)
  window.removeEventListener('blur', cancelDrag)
  window.removeEventListener('keydown', keyboard)
})
</script>

<template>
  <div class="game-shell" :inert="activeDialog !== null ? true : undefined">
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">♠<span>✧</span></div>
        <div><p class="eyebrow">KIKYO GAMES</p><h1>青绿牌室<span>蜘蛛纸牌</span></h1></div>
      </div>
      <dl class="session-info" aria-label="本局信息">
        <div><dt>分数</dt><dd>{{ score }}</dd></div>
        <div><dt>用时</dt><dd>{{ formattedTime }}</dd></div>
        <div><dt>步数</dt><dd>{{ game.moves }}</dd></div>
      </dl>
      <div class="header-actions">
        <button class="icon-button" type="button" title="游戏规则" aria-label="游戏规则" @click="dialog = 'rules'"><UiIcon name="help" /></button>
        <button class="icon-button" type="button" title="暂停（P）" aria-label="暂停游戏" :disabled="won" @click="perform(togglePause)"><UiIcon name="pause" /></button>
        <button type="button" class="button button-new" @click="openNewGame"><UiIcon name="plus" />新游戏</button>
      </div>
    </header>

    <main class="table-surface" :class="{ 'is-paused': paused }">
      <div class="table-caption">
        <div class="table-heading"><span class="small-spade" aria-hidden="true">♠</span><span>一局纸牌，一刻闲暇。</span></div>
        <button type="button" class="difficulty-chip" title="选择游戏难度" @click="openNewGame">
          <span class="difficulty-suits" aria-hidden="true"><span v-for="suit in difficulty.suits" :key="suit"
            :class="{ 'red-suit': suit === 'hearts' || suit === 'diamonds' }">{{ SUIT_SYMBOLS[suit] }}</span></span>
          {{ difficulty.label }}<span class="chip-divider">·</span>{{ game.difficulty }} 花色
        </button>
      </div>

      <div ref="scroller" class="board-scroller">
        <div ref="board" class="tableau" :style="{ gap: `${columnGap}px`, '--card-width': `${cardWidth}px` }" aria-label="十列纸牌">
          <div v-for="(column, columnIndex) in game.columns" :key="columnIndex" class="tableau-column"
            :class="{ 'drop-target': isTarget(columnIndex), 'hint-target': hint?.target === columnIndex }"
            :data-column="columnIndex" :style="{ height: `${layouts[columnIndex].height}px` }" @click="clickColumn(columnIndex)">
            <span class="column-number" aria-hidden="true">{{ String(columnIndex + 1).padStart(2, '0') }}</span>
            <button type="button" class="empty-column" :style="{ height: `${cardHeight}px` }" :tabindex="column.length === 0 ? 0 : -1"
              :aria-label="`第 ${columnIndex + 1} 列${column.length === 0 ? '，空列' : ''}`" @click.stop="clickColumn(columnIndex)">
              <span aria-hidden="true">♠</span>
            </button>
            <button v-for="(card, index) in column" :key="card.id" type="button" class="tableau-card"
              :class="{
                'selected-card': isHighlighted(columnIndex, index),
                'hint-card': hint?.column === columnIndex && index >= hint.index,
                'drag-origin': dragging?.column === columnIndex && index >= dragging.index,
                'movable-card': isMovableSequence(column, index),
              }"
              :style="{ top: `${layouts[columnIndex].offsets[index]}px`, zIndex: index + 1 }"
              :disabled="!card.faceUp || suspended" :tabindex="card.faceUp && isMovableSequence(column, index) ? 0 : -1"
              :aria-label="card.faceUp ? `第 ${columnIndex + 1} 列，${cardLabel(card)}${column.length - index > 1 ? `及下方 ${column.length - index - 1} 张牌` : ''}` : '未翻开的牌'"
              :aria-pressed="card.faceUp ? isHighlighted(columnIndex, index) : undefined"
              @pointerdown="beginDrag($event, columnIndex, index)" @click.stop="clickCard(columnIndex, index)">
              <PlayingCard :card="card" />
            </button>
          </div>
        </div>
      </div>

      <div class="deck-area">
        <div class="completed-area">
          <div class="deck-label"><span>已归位</span><span><b>{{ game.completed.length }}</b> / 8 组</span></div>
          <div class="completed-piles" aria-label="已收集的完整牌组">
            <div v-for="index in 8" :key="index" class="completed-slot" :class="{ filled: game.completed[index - 1] }"
              :aria-label="game.completed[index - 1] ? `第 ${index} 组已完成` : `第 ${index} 组待完成`">
              <PlayingCard v-if="game.completed[index - 1]" :card="game.completed[index - 1][0]" />
              <span v-else aria-hidden="true">♠</span>
              <span v-if="game.completed[index - 1]" class="completed-check" aria-hidden="true"><UiIcon name="check" /></span>
            </div>
          </div>
        </div>
        <div class="stock-area">
          <button type="button" class="stock-button" :disabled="dealBlockReason !== null || suspended"
            :title="dealBlockReason ?? '向每列发一张新牌（D）'" :aria-label="`发一行新牌，剩余 ${remainingDeals} 次${dealBlockReason ? `，${dealBlockReason}` : ''}`" @click="perform(deal)">
            <span class="stock-art">
              <span v-for="index in remainingDeals" :key="index" class="stock-packet" :style="{ right: `${(index - 1) * 17}px`, zIndex: 6 - index }"><PlayingCard back /></span>
              <span v-if="remainingDeals > 0" class="stock-plus"><UiIcon name="plus" /></span>
              <span v-else class="stock-empty" aria-hidden="true">♠</span>
            </span>
            <span class="stock-text"><b>{{ remainingDeals > 0 ? '发一行新牌' : '牌已发完' }}</b><small>剩余 {{ remainingDeals }} 次<span v-if="remainingDeals > 0"> · D</span></small></span>
          </button>
          <p v-if="remainingDeals > 0 && dealBlockReason && !won" class="stock-reason">先填满所有空列</p>
        </div>
      </div>

      <div class="table-watermark" aria-hidden="true">SPIDER SOLITAIRE</div>
    </main>

    <section class="control-bar" aria-label="游戏操作">
      <div class="game-controls">
        <button type="button" class="tool-button" :disabled="!canUndo || suspended" title="撤销上一步（Ctrl+Z），最多 200 步" @click="perform(undo)"><UiIcon name="undo" /><span>撤销</span><kbd>Ctrl Z</kbd></button>
        <button type="button" class="tool-button" :disabled="suspended" title="显示下一个提示（H）" @click="perform(showHint)"><UiIcon name="hint" /><span>提示</span><kbd>H</kbd></button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="tool-button restart-button" title="从相同牌面重新开始" @click="dialog = 'restart'"><UiIcon name="restart" /><span>重新开始</span></button>
      </div>
      <p class="game-message" role="status" aria-live="polite"><span class="status-dot" aria-hidden="true"></span>{{ message }}</p>
    </section>
    <footer class="app-footer">
      <span v-if="storageWarning" class="storage-warning" role="status">{{ storageWarning }}</span>
      <span v-else><span class="save-dot" aria-hidden="true"></span>进度自动保存在此设备</span>
      <span>点击或拖动移牌<span class="footer-dot">·</span>同花色 K → A 收齐一组<span class="footer-dot">·</span><button type="button" @click="dialog = 'rules'">查看规则</button></span>
    </footer>
  </div>

  <Teleport to="body">
    <div v-if="dragging" class="dragged-stack" aria-hidden="true"
      :style="{ width: `${dragging.width}px`, transform: `translate3d(${dragging.x}px, ${dragging.y}px, 0)` }">
      <div v-for="(card, index) in dragging.cards" :key="card.id" class="dragged-card" :style="{ top: `${index * dragging.step}px` }"><PlayingCard :card="card" /></div>
    </div>
  </Teleport>

  <GameDialog v-if="activeDialog" :key="activeDialog" :title="dialogTitle" :eyebrow="dialogEyebrow"
    :dismissible="activeDialog !== 'pause' && activeDialog !== 'win'" @close="closeDialog">
    <template v-if="activeDialog === 'new'">
      <p class="dialog-description">选一个适合此刻的难度，让杂念随着纸牌慢慢归位。</p>
      <div class="difficulty-options" aria-label="选择游戏难度">
        <button v-for="option in DIFFICULTIES" :key="option.value" type="button" class="difficulty-option"
          :class="{ active: pendingDifficulty === option.value }" :aria-pressed="pendingDifficulty === option.value" @click="pendingDifficulty = option.value">
          <span class="option-suits" aria-hidden="true"><span v-for="suit in option.suits" :key="suit" :class="{ 'red-suit': suit === 'hearts' || suit === 'diamonds' }">{{ SUIT_SYMBOLS[suit] }}</span></span>
          <span class="option-copy"><b>{{ option.name }}<small>{{ option.label }}</small></b><span>{{ option.description }}</span></span>
          <span class="option-check" aria-hidden="true"><UiIcon v-if="pendingDifficulty === option.value" name="check" /></span>
        </button>
      </div>
      <p class="dialog-note">开始后将替换当前牌局。三种难度均使用 104 张牌。</p>
      <button type="button" class="button button-primary button-wide" @click="confirmNewGame">开始游戏<UiIcon name="arrow" /></button>
    </template>
    <template v-else-if="activeDialog === 'restart'">
      <div class="dialog-illustration" aria-hidden="true"><UiIcon name="restart" /></div>
      <p class="dialog-description">重新回到本局最初的牌面，试一条不同的路线。<br>当前进度、用时和撤销记录会被清除。</p>
      <div class="dialog-actions"><button type="button" class="button button-secondary" @click="closeDialog">继续当前牌局</button><button type="button" class="button button-primary" @click="confirmRestart">重开本局</button></div>
    </template>
    <template v-else-if="activeDialog === 'rules'">
      <p class="dialog-description">把所有牌整理为同花色的 K → A，收齐 8 组即获胜。</p>
      <ol class="rules-list">
        <li><b>从大到小衔接</b><span>把牌放到点数大一的明牌下面，可以不同花色。例如 7 可以接到任意花色的 8 下。</span></li>
        <li><b>同花色，才能一起移动</b><span>只有同花色、连续降序的明牌组可以整体移动。空列可以放入任意单牌或合法牌组。</span></li>
        <li><b>翻开暗牌，留出空间</b><span>移走牌组后，露出的暗牌会自动翻开；完整的同花色 K → A 会自动归位。</span></li>
        <li><b>需要时发一行新牌</b><span>点击右下角牌堆，每列各发一张。共有 5 次发牌机会，有空列时需要先把空列填满。</span></li>
      </ol>
      <div class="rules-scoring">初始 500 分 · 每次移牌或发牌 −1 分 · 每收齐一组 +100 分</div>
      <dl class="shortcut-list"><div><dt>撤销</dt><dd><kbd>Ctrl Z</kbd></dd></div><div><dt>提示</dt><dd><kbd>H</kbd></dd></div><div><dt>发牌</dt><dd><kbd>D</kbd></dd></div><div><dt>暂停</dt><dd><kbd>P</kbd></dd></div><div><dt>取消选择</dt><dd><kbd>Esc</kbd></dd></div></dl>
      <button type="button" class="button button-primary button-wide" @click="closeDialog">知道了，回到牌桌</button>
    </template>
    <template v-else-if="activeDialog === 'pause'">
      <div class="dialog-illustration" aria-hidden="true"><UiIcon name="pause" /></div>
      <p class="dialog-description">纸牌会在这里等你。<br>暂停期间不会累计游戏用时。</p>
      <button type="button" class="button button-primary button-wide" @click="closeDialog"><UiIcon name="play" />继续游戏</button>
    </template>
    <template v-else-if="activeDialog === 'win'">
      <div class="dialog-illustration trophy-illustration" aria-hidden="true"><UiIcon name="trophy" /></div>
      <p class="dialog-description">八组纸牌，全部归位。给这份耐心一点掌声。</p>
      <dl class="victory-details"><div><dt>最终分数</dt><dd>{{ score }}</dd></div><div><dt>完成用时</dt><dd>{{ formattedTime }}</dd></div><div><dt>总步数</dt><dd>{{ game.moves }}</dd></div></dl>
      <button type="button" class="button button-primary button-wide" @click="openNewGame">再来一局<UiIcon name="arrow" /></button>
      <button v-if="canUndo" type="button" class="text-button" @click="undoWin">撤销最后一步，回看牌局</button>
    </template>
  </GameDialog>
</template>