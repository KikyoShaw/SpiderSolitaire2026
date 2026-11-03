import { SUITS } from './types'
import type { Card, Difficulty, GameState, Move } from './types'

const COLUMN_COUNT = 10
const CARD_COUNT = 104
const GROUP_SIZE = 13
const GROUP_COUNT = 8
const MAX_MOVES = 1_000_000_000

function generateSeed(): number {
  try {
    const crypto = globalThis.crypto
    if (crypto && typeof crypto.getRandomValues === 'function') {
      const values = new Uint32Array(1)
      crypto.getRandomValues(values)
      return values[0]!
    }
  } catch {
    // Restricted webviews may expose crypto but refuse random number generation.
  }

  return Date.now() >>> 0
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0

  // Mulberry32 uses stable 32-bit operations and also supports seed zero.
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(value ^ (value >>> 15), value | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000
  }
}

export function createGame(difficulty: Difficulty, seed?: number): GameState {
  const gameSeed = seed === undefined ? generateSeed() : seed >>> 0
  const random = seededRandom(gameSeed)
  const cards: Card[] = Array.from({ length: CARD_COUNT }, (_, id) => ({
    id,
    rank: (id % GROUP_SIZE) + 1,
    suit: SUITS[Math.floor(id / GROUP_SIZE) % difficulty]!,
    faceUp: false,
  }))

  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const card = cards[index]!
    cards[index] = cards[other]!
    cards[other] = card
  }

  const columns: Card[][] = []
  for (let index = 0; index < COLUMN_COUNT; index += 1) {
    const column = cards.splice(0, index < 4 ? 6 : 5)
    column[column.length - 1]!.faceUp = true
    columns.push(column)
  }

  return {
    difficulty,
    seed: gameSeed,
    columns,
    stock: cards,
    completed: [],
    moves: 0,
  }
}

export function cloneGame(state: GameState): GameState {
  const cloneCard = (card: Card): Card => ({
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    faceUp: card.faceUp,
  })

  return {
    difficulty: state.difficulty,
    seed: state.seed,
    columns: state.columns.map(column => column.map(cloneCard)),
    stock: state.stock.map(cloneCard),
    completed: state.completed.map(group => group.map(cloneCard)),
    moves: state.moves,
  }
}

export function isMovableSequence(column: Card[], index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= column.length) {
    return false
  }

  const first = column[index]!
  let expectedRank = first.rank

  for (let position = index; position < column.length; position += 1) {
    const card = column[position]!
    if (!card.faceUp || card.suit !== first.suit || card.rank !== expectedRank) {
      return false
    }
    expectedRank -= 1
  }

  return true
}

export function canMove(state: GameState, move: Move): boolean {
  if (
    !Number.isInteger(move.column) ||
    !Number.isInteger(move.target) ||
    move.column < 0 ||
    move.column >= state.columns.length ||
    move.target < 0 ||
    move.target >= state.columns.length ||
    move.column === move.target
  ) {
    return false
  }

  const source = state.columns[move.column]!
  if (!isMovableSequence(source, move.index)) {
    return false
  }

  const target = state.columns[move.target]!
  const top = target[target.length - 1]
  return !top || (top.faceUp && top.rank === source[move.index]!.rank + 1)
}

function settleColumns(state: GameState): void {
  for (const column of state.columns) {
    while (column.length > 0) {
      column[column.length - 1]!.faceUp = true
      const start = column.length - GROUP_SIZE
      if (
        start < 0 ||
        column[start]!.rank !== GROUP_SIZE ||
        !isMovableSequence(column, start)
      ) {
        break
      }

      state.completed.push(column.splice(start, GROUP_SIZE))
    }
  }
}

export function moveCards(state: GameState, move: Move): GameState | null {
  if (!canMove(state, move)) {
    return null
  }

  const next = cloneGame(state)
  const cards = next.columns[move.column]!.splice(move.index)
  next.columns[move.target]!.push(...cards)
  next.moves += 1
  settleColumns(next)
  return next
}

export function getDealBlockReason(state: GameState): string | null {
  if (state.completed.length >= GROUP_COUNT) {
    return '本局已通关，无法继续发牌'
  }
  if (state.stock.length < COLUMN_COUNT) {
    return '备用牌不足，无法继续发牌'
  }
  if (state.columns.some(column => column.length === 0)) {
    return '请先填满所有空列，再发牌'
  }
  return null
}

export function dealCards(state: GameState): GameState | null {
  if (getDealBlockReason(state) !== null) {
    return null
  }

  const next = cloneGame(state)
  const cards = next.stock.splice(0, COLUMN_COUNT)
  for (let index = 0; index < COLUMN_COUNT; index += 1) {
    const card = cards[index]!
    card.faceUp = true
    next.columns[index]!.push(card)
  }

  // All ten cards land before any completed group is removed.
  next.moves += 1
  settleColumns(next)
  return next
}

function visibleRunLength(column: Card[], end: number = column.length): number {
  const top = column[end - 1]
  if (!top || !top.faceUp) {
    return 0
  }

  let length = 1
  let expectedRank = top.rank + 1
  for (let index = end - 2; index >= 0; index -= 1) {
    const card = column[index]!
    if (!card.faceUp || card.suit !== top.suit || card.rank !== expectedRank) {
      break
    }
    length += 1
    expectedRank += 1
  }
  return length
}

function hintScore(state: GameState, move: Move): number {
  const source = state.columns[move.column]!
  const target = state.columns[move.target]!
  const card = source[move.index]!
  const top = target[target.length - 1]
  const joinsSuit = top !== undefined && top.faceUp && top.suit === card.suit
  const movedLength = source.length - move.index
  const joinedLength = joinsSuit ? visibleRunLength(target) : 0
  const finishesGroup =
    movedLength + joinedLength === GROUP_SIZE ||
    visibleRunLength(source, move.index) === GROUP_SIZE
  const revealsCard = move.index > 0 && !source[move.index - 1]!.faceUp
  const freesColumn = move.index === 0

  return (
    (finishesGroup ? 1000 : 0) +
    (revealsCard ? 100 : 0) +
    (joinsSuit ? 10 : 0) +
    (freesColumn ? 1 : 0)
  )
}

export function getHints(state: GameState): Move[] {
  const hints: { move: Move, score: number }[] = []

  for (let column = 0; column < state.columns.length; column += 1) {
    const source = state.columns[column]!
    for (let index = 0; index < source.length; index += 1) {
      if (!source[index]!.faceUp || !isMovableSequence(source, index)) {
        continue
      }

      for (let target = 0; target < state.columns.length; target += 1) {
        if (index === 0 && state.columns[target]!.length === 0) {
          continue
        }

        const move: Move = { column, index, target }
        if (canMove(state, move)) {
          hints.push({ move, score: hintScore(state, move) })
        }
      }
    }
  }

  hints.sort((left, right) =>
    right.score - left.score ||
    left.move.column - right.move.column ||
    left.move.index - right.move.index ||
    left.move.target - right.move.target,
  )
  return hints.map(hint => hint.move)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  )
}

function readValidCard(
  value: unknown,
  difficulty: Difficulty,
  seen: Set<number>,
): Card | null {
  if (!isRecord(value)) {
    return null
  }

  const { id, rank, suit, faceUp } = value
  if (!isBoundedInteger(id, CARD_COUNT - 1) || typeof faceUp !== 'boolean') {
    return null
  }

  const expectedRank = (id % GROUP_SIZE) + 1
  const expectedSuit = SUITS[Math.floor(id / GROUP_SIZE) % difficulty]!
  if (rank !== expectedRank || suit !== expectedSuit || seen.has(id)) {
    return null
  }

  seen.add(id)
  return { id, rank: expectedRank, suit: expectedSuit, faceUp }
}

export function isValidGameState(value: unknown): value is GameState {
  try {
    if (!isRecord(value)) {
      return false
    }

    const { difficulty, seed, columns, stock, completed, moves } = value
    if (
      (difficulty !== 1 && difficulty !== 2 && difficulty !== 4) ||
      !isBoundedInteger(seed, 0xffffffff) ||
      !isBoundedInteger(moves, MAX_MOVES) ||
      !Array.isArray(columns) ||
      columns.length !== COLUMN_COUNT ||
      !Array.isArray(stock) ||
      !Array.isArray(completed)
    ) {
      return false
    }

    const stockLength = stock.length
    const completedLength = completed.length
    if (
      !isBoundedInteger(stockLength, 50) ||
      stockLength % COLUMN_COUNT !== 0 ||
      !isBoundedInteger(completedLength, GROUP_COUNT)
    ) {
      return false
    }

    // Bound every container and the total before examining individual cards.
    const checkedColumns: { cards: unknown[], length: number }[] = []
    const checkedGroups: unknown[][] = []
    let total = stockLength

    for (let index = 0; index < COLUMN_COUNT; index += 1) {
      const column: unknown = columns[index]
      if (!Array.isArray(column)) {
        return false
      }
      const length = column.length
      if (!isBoundedInteger(length, CARD_COUNT)) {
        return false
      }
      total += length
      if (total > CARD_COUNT) {
        return false
      }
      checkedColumns.push({ cards: column, length })
    }

    for (let index = 0; index < completedLength; index += 1) {
      const group: unknown = completed[index]
      if (!Array.isArray(group) || group.length !== GROUP_SIZE) {
        return false
      }
      total += GROUP_SIZE
      if (total > CARD_COUNT) {
        return false
      }
      checkedGroups.push(group)
    }

    if (total !== CARD_COUNT) {
      return false
    }

    const seen = new Set<number>()
    for (const { cards, length } of checkedColumns) {
      let hasFaceUp = false
      for (let index = 0; index < length; index += 1) {
        const card = readValidCard(cards[index], difficulty, seen)
        if (!card) {
          return false
        }
        if (card.faceUp) {
          hasFaceUp = true
        } else if (hasFaceUp) {
          return false
        }
      }
      if (length > 0 && !hasFaceUp) {
        return false
      }
    }

    for (let index = 0; index < stockLength; index += 1) {
      const card = readValidCard(stock[index], difficulty, seen)
      if (!card || card.faceUp) {
        return false
      }
    }

    for (const group of checkedGroups) {
      let groupSuit: Card['suit'] | undefined
      for (let index = 0; index < GROUP_SIZE; index += 1) {
        const card = readValidCard(group[index], difficulty, seen)
        if (!card || !card.faceUp || card.rank !== GROUP_SIZE - index) {
          return false
        }
        if (index === 0) {
          groupSuit = card.suit
        } else if (card.suit !== groupSuit) {
          return false
        }
      }
    }

    return seen.size === CARD_COUNT
  } catch {
    // Treat throwing getters or proxies as invalid rather than breaking loading.
    return false
  }
}