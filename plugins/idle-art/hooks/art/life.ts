import { blankFrame, type Animation, type Cell, type Frame, type Rng } from './grid.ts'

/** Ticks per generation. */
const TICKS_PER_GEN = 3
/** Share of cells alive in a fresh seed. */
const DENSITY = 0.3
/** Generations a board lives before it is seeded again, even when it still moves. */
const MAX_GENS = 300
/** Past boards remembered to see a board that repeats (a still life or a short oscillator). */
const MEMORY = 6

const NEWBORN = '#f3b4ff'
const OLD = '#9775fa'

/** Conway's rule: a live cell with 2 or 3 live neighbours stays, a dead one with 3 is born. */
export function nextAlive(alive: boolean, neighbours: number): boolean {
  return neighbours === 3 || (alive && neighbours === 2)
}

const HALVES = [' ', '▄', '▀', '█']

/** One drawn cell for two board cells, the top and the bottom one by their ages; null when both are dead. */
function halfBlock(top: number, bottom: number): Cell | null {
  const ch = HALVES[(top > 0 ? 2 : 0) + (bottom > 0 ? 1 : 0)] as string
  if (ch === ' ') return null
  return { ch, color: top === 1 || bottom === 1 ? NEWBORN : OLD }
}

/**
 * The Game of Life on a wrapping board two cells tall per row (drawn with half
 * blocks), seeded again when it dies out, repeats or grows old.
 */
export function life(w: number, h: number, rng: Rng): Animation {
  const bw = w
  const bh = h * 2
  let age = new Array<number>(bw * bh).fill(0)
  let gens = 0
  let tick = 0
  const seen: string[] = []

  const seed = (): void => {
    age = age.map(() => (rng() < DENSITY ? 1 : 0))
    gens = 0
    seen.length = 0
  }

  const at = (x: number, y: number): number => (age[((y + bh) % bh) * bw + ((x + bw) % bw)] ?? 0) > 0 ? 1 : 0

  const neighbours = (x: number, y: number): number =>
    at(x - 1, y - 1) + at(x, y - 1) + at(x + 1, y - 1) + at(x - 1, y) + at(x + 1, y) + at(x - 1, y + 1) + at(x, y + 1) + at(x + 1, y + 1)

  const generation = (): void => {
    age = age.map((a, i) => (nextAlive(a > 0, neighbours(i % bw, Math.floor(i / bw))) ? a + 1 : 0))
    gens += 1
    const key = age.map(a => (a > 0 ? '1' : '0')).join('')
    const live = age.filter(a => a > 0).length
    if (seen.includes(key) || live < bw * bh * 0.03 || gens > MAX_GENS) seed()
    else {
      seen.push(key)
      if (seen.length > MEMORY) seen.shift()
    }
  }

  const step = (): void => {
    tick += 1
    if (tick % TICKS_PER_GEN === 0) generation()
  }

  const frame = (): Frame => {
    const out = blankFrame(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = halfBlock(age[2 * y * bw + x] ?? 0, age[(2 * y + 1) * bw + x] ?? 0)
        if (cell !== null) (out[y] as Frame[number])[x] = cell
      }
    }
    return out
  }

  seed()
  return { step, frame }
}
