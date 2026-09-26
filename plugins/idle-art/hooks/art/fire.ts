import { below, blankFrame, type Animation, type Frame, type Rng } from './grid.ts'

/** Glyphs and colours from the coolest visible heat to the hottest. */
const GLYPHS = [...'.,:;+*oO#@']
const COLORS = ['#4a0d00', '#7a1a00', '#a82800', '#d23c00', '#ef6a00', '#ff9200', '#ffb52e', '#ffd75e', '#ffec9e', '#fff8dc']

const MAX = 1

/** The heat a column's source gives: full in the middle, falling off toward both edges. */
function sourceHeat(x: number, w: number, rng: Rng): number {
  const edge = Math.min(x + 1, w - x) / Math.max(1, w / 6)
  return Math.min(1, edge) * (0.55 + rng() * 0.45)
}

/**
 * A fire: heat rises from a hidden source row, each cell taking the heat of a cell
 * below it (drifting one column at most) less a random cooling sized so flames
 * reach about the top of the region.
 */
export function fire(w: number, h: number, rng: Rng): Animation {
  // Row h is the hidden source; rows 0..h-1 are drawn.
  const heat = Array.from({ length: h + 1 }, () => new Array<number>(w).fill(0))
  const cooling = (2 * MAX) / h

  const step = (): void => {
    const source = heat[h] as number[]
    for (let x = 0; x < w; x++) source[x] = sourceHeat(x, w, rng)
    for (let y = 0; y < h; y++) {
      const row = heat[y] as number[]
      const under = heat[y + 1] as number[]
      for (let x = 0; x < w; x++) {
        const from = Math.min(w - 1, Math.max(0, x + below(rng, 3) - 1))
        row[x] = Math.max(0, (under[from] ?? 0) - rng() * cooling)
      }
    }
  }

  const frame = (): Frame => {
    const out = blankFrame(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = heat[y]?.[x] ?? 0
        if (v < 0.08) continue
        const i = Math.min(GLYPHS.length - 1, Math.floor(v * GLYPHS.length))
        ;(out[y] as Frame[number])[x] = { ch: GLYPHS[i] as string, color: COLORS[i] as string }
      }
    }
    return out
  }

  return { step, frame }
}
