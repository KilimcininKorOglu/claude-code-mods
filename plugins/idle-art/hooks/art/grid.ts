/** One character cell of a frame; an empty `color` draws in the terminal's default colour. */
export type Cell = { ch: string; color: string }

/** A frame: `h` rows of `w` cells. */
export type Frame = Cell[][]

/** Consecutive cells of one colour, drawn as one Text. */
export type Run = { text: string; color: string }

/** A random source in [0, 1). */
export type Rng = () => number

/**
 * One running animation: `step` advances it by `dtMs` milliseconds (STEP_MS when not given), `frame` draws
 * where it stands. An animation with an end, a clip, says through `wrapped` whether the last step went from
 * its last frame back to its first.
 */
export type Animation = { step: (dtMs?: number) => void; frame: () => Frame; wrapped?: () => boolean }

/** The step every scene's speeds are written for: a speed of 1 is one cell per STEP_MS. */
export const STEP_MS = 100

/** A step of `dtMs` in units of STEP_MS, the factor a per-step speed is multiplied by. */
export function unitsOf(dtMs: number | undefined): number {
  return (dtMs ?? STEP_MS) / STEP_MS
}

/**
 * Runs `fn` once for every whole STEP_MS the steps have added up to, for a scene that changes in whole steps
 * (a fire's heat, a board's generation) and keeps its pace at any frame rate.
 */
export function everyStep(fn: () => void): (dtMs?: number) => void {
  let owed = 0
  return dtMs => {
    owed += dtMs ?? STEP_MS
    for (; owed >= STEP_MS; owed -= STEP_MS) fn()
  }
}

/** Starts an animation for a region of `w` columns and `h` rows. */
export type Maker = (w: number, h: number, rng: Rng) => Animation

export const BLANK: Cell = { ch: ' ', color: '' }

/** How long a scene runs before `random` moves to another in the same turn. */
export const SCENE_MS = 20_000

/**
 * Whether a scene that has run `ms` has run its time: a built-in scene after SCENE_MS, a clip at the first
 * end of a loop from then on, so a long clip plays through once and a short one repeats until then.
 */
export function sceneDone(anim: Animation, ms: number): boolean {
  return ms >= SCENE_MS && (anim.wrapped === undefined || anim.wrapped())
}

/** A seeded generator (mulberry32), so a test replays the same frames. */
export function rngOf(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A whole number in [0, n). */
export function below(rng: Rng, n: number): number {
  return Math.floor(rng() * n)
}

/** One item of a list, picked at random. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[below(rng, items.length)] as T
}

export function blankFrame(w: number, h: number): Frame {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => BLANK))
}

/** Writes `text` into a row from column `x`, cutting what falls outside the frame. */
export function put(frame: Frame, x: number, y: number, text: string, color: string): void {
  const row = frame[y]
  if (row === undefined) return
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const col = x + i
    if (col >= 0 && col < row.length) row[col] = { ch: chars[i] as string, color }
  }
}

/** A row as runs of one colour, so a frame draws as few Text elements. */
export function runsOf(row: readonly Cell[]): Run[] {
  const runs: Run[] = []
  for (const cell of row) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === cell.color) last.text += cell.ch
    else runs.push({ text: cell.ch, color: cell.color })
  }
  return runs
}

/** A frame as plain text, one line per row. */
export function textOf(frame: Frame): string {
  return frame.map(row => row.map(c => c.ch).join('')).join('\n')
}
