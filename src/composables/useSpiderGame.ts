import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  canMove,
  cloneGame,
  createGame,
  dealCards,
  getDealBlockReason,
  getHints,
  isMovableSequence,
  isValidGameState,
  moveCards,
} from '../game/engine'
import { cardLabel, type CardSelection, type Difficulty, type GameState, type Move } from '../game/types'

const SAVE_KEY = 'qinglv-spider:game:v1'
const HISTORY_LIMIT = 200

interface SavedSession {
  version: 1
  game: GameState
  history: GameState[]
  elapsedMs: number
  started: boolean
  paused: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function restoreSession(): { session?: SavedSession; notice?: string; warning?: string } {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return {}
    if (raw.length > 5_000_000) return { notice: '存档过大，已为你准备一局新游戏。' }
    const saved: unknown = JSON.parse(raw)
    if (!isRecord(saved) || saved.version !== 1 || !isValidGameState(saved.game)) {
      return { notice: '旧存档无法恢复，已为你准备一局新游戏。' }
    }
    const game = saved.game
    const elapsedMs = typeof saved.elapsedMs === 'number' && Number.isFinite(saved.elapsedMs)
      && saved.elapsedMs >= 0 ? Math.min(saved.elapsedMs, 31_536_000_000) : 0
    let history: GameState[] = []
    const validHistory = Array.isArray(saved.history) && saved.history.length <= HISTORY_LIMIT
      && saved.history.every((state: unknown, index: number) => isValidGameState(state)
        && state.difficulty === game.difficulty && state.seed === game.seed
        && state.moves === game.moves - (saved.history as unknown[]).length + index)
    if (validHistory) history = saved.history as GameState[]
    return {
      session: {
        version: 1, game, history, elapsedMs,
        started: saved.started === true || game.moves > 0,
        paused: saved.paused === true,
      },
      notice: validHistory ? '已恢复上次的牌局，慢慢来。' : '已恢复牌局，无法读取的撤销记录已清除。',
    }
  } catch (error) {
    if (error instanceof SyntaxError) return { notice: '存档内容损坏，已为你准备一局新游戏。' }
    return { warning: '本地存储不可用，本次进度可能无法保存。' }
  }
}

export function useSpiderGame() {
  const restored = restoreSession()
  const game = shallowRef(restored.session?.game ?? createGame(1))
  const history = shallowRef<GameState[]>(restored.session?.history ?? [])
  const selection = ref<CardSelection | null>(null)
  const hint = ref<Move | null>(null)
  const message = ref(restored.notice ?? '选一张明牌，开始你的第一步。')
  const storageWarning = ref(restored.warning ?? '')
  const elapsedMs = ref(restored.session?.elapsedMs ?? 0)
  const started = ref(restored.session?.started ?? false)
  const paused = ref(restored.session?.paused ?? false)
  const dialogOpen = ref(false)
  const hidden = ref(document.hidden)
  const won = computed(() => game.value.completed.length === 8)
  const suspended = computed(() => paused.value || dialogOpen.value || hidden.value || won.value)
  const score = computed(() => 500 - game.value.moves + game.value.completed.length * 100)
  const canUndo = computed(() => history.value.length > 0)
  const dealBlockReason = computed(() => getDealBlockReason(game.value))
  const hints = computed(() => getHints(game.value))
  const formattedTime = computed(() => {
    const total = Math.floor(elapsedMs.value / 1000)
    const seconds = String(total % 60).padStart(2, '0')
    const minutes = Math.floor(total / 60)
    return minutes < 60 ? `${String(minutes).padStart(2, '0')}:${seconds}`
      : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`
  })

  let lastClock = performance.now()
  let hintCursor = 0
  let interval: ReturnType<typeof setInterval> | undefined
  let checkpoints = 0
  let persistentHistoryLimit = HISTORY_LIMIT

  function updateClock() {
    const now = performance.now()
    if (started.value && !suspended.value) elapsedMs.value += Math.max(0, now - lastClock)
    lastClock = now
  }

  watch([suspended, started], (_, previous) => {
    const now = performance.now()
    if (previous[1] && !previous[0]) elapsedMs.value += Math.max(0, now - lastClock)
    lastClock = now
  }, { flush: 'sync' })

  function save() {
    updateClock()
    const snapshot: SavedSession = {
      version: 1,
      game: game.value,
      history: [],
      elapsedMs: Math.round(elapsedMs.value),
      started: started.value,
      paused: paused.value,
    }
    // 存储配额不足时优先保住当前牌局，内存中的撤销记录不受影响。
    const limits = [...new Set([persistentHistoryLimit, Math.min(20, persistentHistoryLimit), 0])]
    for (const limit of limits) {
      try {
        snapshot.history = limit ? history.value.slice(-limit) : []
        localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot))
        persistentHistoryLimit = limit
        storageWarning.value = limit < HISTORY_LIMIT
          ? `当前牌局已保存；受存储空间限制，重启后最多可撤销 ${limit} 步。` : ''
        return
      } catch {
        // 继续尝试仅保存当前牌局。
      }
    }
    storageWarning.value = '进度暂时无法保存，请保持此窗口以继续本局。'
  }

  function clearSelection() {
    selection.value = null
    hint.value = null
  }

  function commit(next: GameState, text: string) {
    updateClock()
    const previousCompleted = game.value.completed.length
    history.value = [...history.value.slice(-(HISTORY_LIMIT - 1)), cloneGame(game.value)]
    game.value = next
    started.value = true
    hintCursor = 0
    clearSelection()
    const collected = next.completed.length - previousCompleted
    message.value = won.value ? '八组归位，恭喜你完成了这局牌！'
      : collected > 0 ? `漂亮！收齐了 ${collected} 组同花顺。` : text
    save()
  }

  function move(move: Move): boolean {
    if (suspended.value) return false
    const next = moveCards(game.value, move)
    if (!next) {
      message.value = '请接到点数大一的明牌下，或放入空列。'
      return false
    }
    commit(next, '继续整理牌面，把同花色连在一起。')
    return true
  }

  function chooseCard(column: number, index: number) {
    if (suspended.value) return
    const selected = selection.value
    if (selected && selected.column !== column) {
      move({ ...selected, target: column })
      return
    }
    if (!isMovableSequence(game.value.columns[column], index)) {
      message.value = '只能一起移动同花色、连续降序的明牌。'
      return
    }
    hint.value = null
    if (selected?.column === column && selected.index === index) {
      selection.value = null
      return
    }
    selection.value = { column, index }
    message.value = '已选中牌组，点击目标列，或按 Esc 取消。'
  }

  function chooseColumn(column: number) {
    if (selection.value) move({ ...selection.value, target: column })
  }

  function canDrop(column: number): boolean {
    return selection.value !== null && canMove(game.value, { ...selection.value, target: column })
  }

  function deal() {
    if (suspended.value) return
    const reason = dealBlockReason.value
    if (reason) {
      message.value = reason
      return
    }
    const next = dealCards(game.value)
    if (next) commit(next, '新牌已发出，看看有没有新的衔接机会。')
  }

  function undo() {
    if (paused.value || dialogOpen.value || hidden.value || !canUndo.value) return
    updateClock()
    const previous = history.value[history.value.length - 1]
    history.value = history.value.slice(0, -1)
    game.value = cloneGame(previous)
    clearSelection()
    hintCursor = 0
    message.value = '已撤销上一步，换个思路再试试。'
    save()
  }

  function showHint() {
    if (suspended.value) return
    selection.value = null
    if (hints.value.length === 0) {
      hint.value = null
      message.value = !dealBlockReason.value ? '暂无有帮助的移动，可以点击右下角牌堆发一行新牌。'
        : '暂无有帮助的移动，可以撤销几步，尝试另一条路线。'
      return
    }
    const next = hints.value[hintCursor % hints.value.length]
    hint.value = next
    hintCursor += 1
    const card = game.value.columns[next.column][next.index]
    message.value = `将第 ${next.column + 1} 列的${cardLabel(card)}移到第 ${next.target + 1} 列。提示 ${(hintCursor - 1) % hints.value.length + 1}/${hints.value.length}`
  }

  function startNewGame(difficulty: Difficulty, seed?: number) {
    updateClock()
    started.value = false
    game.value = createGame(difficulty, seed)
    history.value = []
    elapsedMs.value = 0
    paused.value = false
    hintCursor = 0
    clearSelection()
    message.value = seed === undefined ? '新的一局，祝你手气不错。' : '回到最初的牌面，试试新的路线。'
    lastClock = performance.now()
    save()
  }

  function togglePause() {
    if (won.value || dialogOpen.value) return
    updateClock()
    paused.value = !paused.value
    clearSelection()
    save()
  }

  function setDialogOpen(value: boolean) {
    updateClock()
    dialogOpen.value = value
    if (value) clearSelection()
  }

  function visibilityChanged() {
    updateClock()
    hidden.value = document.hidden
    clearSelection()
    save()
  }

  onMounted(() => {
    lastClock = performance.now()
    interval = setInterval(() => {
      updateClock()
      if (started.value && !suspended.value && ++checkpoints % 5 === 0) save()
    }, 1000)
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', save)
    window.addEventListener('beforeunload', save)
  })

  onBeforeUnmount(() => {
    save()
    if (interval) clearInterval(interval)
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('pagehide', save)
    window.removeEventListener('beforeunload', save)
  })

  return {
    game, selection, hint, message, storageWarning, paused, won, suspended,
    score, canUndo, dealBlockReason, formattedTime,
    chooseCard, chooseColumn, canDrop, move, deal, undo, showHint,
    clearSelection, startNewGame, togglePause, setDialogOpen,
  }
}