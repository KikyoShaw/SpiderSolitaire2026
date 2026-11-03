export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds'
export type Difficulty = 1 | 2 | 4

export interface Card {
  id: number
  rank: number
  suit: Suit
  faceUp: boolean
}

export interface GameState {
  difficulty: Difficulty
  seed: number
  columns: Card[][]
  stock: Card[]
  completed: Card[][]
  moves: number
}

export interface CardSelection {
  column: number
  index: number
}

export interface Move extends CardSelection {
  target: number
}

export const SUITS: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds']
export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
}
export const SUIT_NAMES: Record<Suit, string> = {
  spades: '黑桃',
  hearts: '红桃',
  clubs: '梅花',
  diamonds: '方块',
}

export const DIFFICULTIES: {
  value: Difficulty
  name: string
  label: string
  description: string
  suits: Suit[]
}[] = [
  { value: 1, name: '闲庭信步', label: '简单', description: '单花色 · 从容入门', suits: ['spades'] },
  { value: 2, name: '渐入佳境', label: '普通', description: '双花色 · 多一点思考', suits: ['spades', 'hearts'] },
  { value: 4, name: '步步为营', label: '困难', description: '四花色 · 挑战你的布局', suits: SUITS },
]

export function rankLabel(rank: number): string {
  return ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' } as Record<number, string>)[rank] ?? String(rank)
}

export function cardLabel(card: Card): string {
  return `${SUIT_NAMES[card.suit]}${rankLabel(card.rank)}`
}