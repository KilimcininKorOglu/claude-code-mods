import { blankFrame, put, unitsOf, type Animation, type Frame, type Rng } from './grid.ts'

const FUR = '#ffb86b'
const KITTEN_FUR = ['#e9ecef', '#adb5bd']
const SPEECH = '#ffffff'
const HEART = '#ff6b9d'
const GRASS = '#51cf66'
const YARN = '#ff6b6b'
const BUTTERFLY = '#f783ac'

/** The big cat's sprites are 5 rows tall, drawn with their last row just over the ground row. */
const SPRITE_ROWS = 5
/** The sitting cat's width, which places it in the middle. */
const SIT_COLS = 13

/** The big cat walking right, its head ahead and its tail behind, two steps. */
const WALK = [
  ['           /\\_/\\', '    ______( o.o )', '  ~(            )', '    (__________)', '     /\\ /\\  /\\ /\\'],
  ['           /\\_/\\', '    ______( o.o )', '  ~(            )', '    (__________)', '     || ||  || ||'],
]
const WALK_COLS = 19

/** The big cat sitting; `eyes` is three characters, its first and last the two eyes. */
function sitting(eyes: string): string[] {
  const [l = 'o', , r = 'o'] = [...eyes]
  return ['  /\\_____/\\', ` (  ${l}   ${r}  )`, ' (  = ^ =  )', '  )       (', ' (__(_|_)__)~']
}

/** The big cat rolling on the ground: on one side, on its back with its paws up, on the other side, on its back. */
const ROLL = [
  ['', '        /\\_/\\', '  _____( -.- )', ' (____________)=~', "   `----------'"],
  ['  |\\/|    |\\/|', ' (            )~', ' (   ( o.o )  )', '  \\__________/', ''],
  ['', '   /\\_/\\', '  ( -.- )_____', '~=(____________)', "   `----------'"],
  ['  |\\/|    |\\/|', ' (            )~', ' (   ( ^.^ )  )', '  \\__________/', ''],
]

/** A kitten walking right, two steps, 4 rows tall. */
const KITTEN = [
  ['    /\\_/\\ ', ' __( o.o )', '~(      ) ', '  /\\  /\\  '],
  ['    /\\_/\\ ', ' __( o.o )', '~(      ) ', '  ||  ||  '],
]
const KITTEN_COLS = 10

/** Cells a walking cat moves per tick. */
const WALK_SPEED = 0.5

const MIRROR: Record<string, string> = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '{': '}', '}': '{' }

/** A sprite row seen from the other side. */
export function mirrored(row: string, width: number): string {
  return [...row.padEnd(width)].reverse().map(c => MIRROR[c] ?? c).join('')
}

/** One part of the show: how many ticks it lasts, and how its tick-th frame is drawn. */
type Phase = { ticks: number; draw: (t: number, out: Frame) => void }

/** The band, the sitting cat's column, the big cat's top row, and the ground row. */
type Stage = { w: number; h: number; center: number; base: number; ground: number }

function sprite(out: Frame, rows: readonly string[], x: number, y: number, color = FUR): void {
  rows.forEach((row, i) => {
    // Only the blanks around a row let what is behind it show, so a kitten is not cut by the cat's box,
    // and does not show through the cat's body either.
    const lead = row.length - row.trimStart().length
    put(out, x + lead, y + i, row.trim(), color)
  })
}

/**
 * A speech bubble beside the cat's head, its tail pointing down to the head:
 *
 *      .------.
 *     ( meow )
 *      '------'
 *     /
 */
export function bubbleRows(text: string): string[] {
  const rule = '-'.repeat(text.length + 2)
  return [` .${rule}.`, `( ${text} )`, ` '${rule}'`, '/']
}

function bubble(out: Frame, s: Stage, text: string): void {
  bubbleRows(text).forEach((row, i) => put(out, s.center + SIT_COLS + 1, s.base - 2 + i, row, SPEECH))
}

function walkPhase(s: Stage, from: number, to: number): Phase {
  const ticks = Math.max(1, Math.ceil(Math.abs(to - from) / WALK_SPEED))
  return { ticks, draw: (t, out) => sprite(out, WALK[Math.floor(t / 2) % 2] as string[], Math.round(from + t * WALK_SPEED), s.base) }
}

function sitPhase(s: Stage): Phase {
  // Two blinks.
  const blinking = (t: number): boolean => (t >= 8 && t < 10) || (t >= 18 && t < 20)
  return { ticks: 25, draw: (t, out) => sprite(out, sitting(blinking(t) ? '-.-' : 'o.o'), s.center, s.base) }
}

function meowPhase(s: Stage, text: string, eyes: string): Phase {
  return {
    ticks: 20,
    draw: (_, out) => {
      sprite(out, sitting(eyes), s.center, s.base)
      bubble(out, s, text)
    },
  }
}

/** Rolls three cells right and back, one pose every two ticks. */
function rollPhase(s: Stage): Phase {
  const drift = [0, 1, 2, 3, 3, 2, 1, 0]
  return { ticks: 48, draw: (t, out) => sprite(out, ROLL[Math.floor(t / 2) % ROLL.length] as string[], s.center + (drift[Math.floor(t / 6) % drift.length] ?? 0), s.base) }
}

/** Three jumps. */
function jumpPhase(s: Stage): Phase {
  const lift = [0, 1, 2, 2, 1, 0, 0, 0]
  return {
    ticks: 24,
    draw: (t, out) => {
      const up = lift[Math.floor(t) % lift.length] ?? 0
      sprite(out, sitting(up === 0 ? 'o.o' : '^o^'), s.center, s.base - up)
    },
  }
}

/** Purring, with a heart floating up from its head. */
function purrPhase(s: Stage): Phase {
  return {
    ticks: 32,
    draw: (t, out) => {
      sprite(out, sitting('^.^'), s.center, s.base)
      bubble(out, s, 'purr~')
      put(out, s.center + 6, s.base - 1 - Math.floor(t / 8), '♥', HEART)
    },
  }
}

/** Looking left and right, twice. */
function lookPhase(s: Stage): Phase {
  const eyes = ['o.o', 'O.o', 'O.o', 'o.o', 'o.O', 'o.O']
  return { ticks: 30, draw: (t, out) => sprite(out, sitting(eyes[Math.floor(t / 2.5) % eyes.length] as string), s.center, s.base) }
}

/** The tricks in the middle of the show, in a new order each time round. */
function tricks(s: Stage, rng: Rng): Phase[] {
  const all = [rollPhase(s), jumpPhase(s), purrPhase(s), lookPhase(s)]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[all[i], all[j]] = [all[j] as Phase, all[i] as Phase]
  }
  return all
}

/** One round: walk in to the middle, sit and blink, meow, the tricks, meow again, walk out. */
function show(s: Stage, rng: Rng): Phase[] {
  return [
    walkPhase(s, -WALK_COLS, s.center),
    sitPhase(s),
    meowPhase(s, 'meow', 'o.o'),
    ...tricks(s, rng),
    meowPhase(s, 'MEOW!', '>.<'),
    walkPhase(s, s.center, s.w),
  ]
}

/** Where a thing that walks back and forth over `span` cells stands at `clock`, and which way it faces. */
export function bounce(start: number, speed: number, span: number, clock: number): { x: number; dir: 1 | -1 } {
  const period = 2 * Math.max(1, span)
  const p = (((start + speed * clock) % period) + period) % period
  return p < span ? { x: Math.round(p), dir: 1 } : { x: Math.round(period - p), dir: -1 }
}

/** The ground: grass tufts over the band's last row. */
function groundRow(w: number, rng: Rng): string {
  return Array.from({ length: w }, () => ['_', '_', ',', '"', '_', '.'][Math.floor(rng() * 6)] as string).join('')
}

/**
 * Two kittens playing back and forth on the ground, each facing the way it walks: one left of the place the
 * big cat sits, one right of it, so they never walk into each other or over the sitting cat.
 */
function kittens(out: Frame, s: Stage, clock: number): void {
  const yards = [{ from: 0, to: s.center - KITTEN_COLS - 1, speed: 0.3 }, { from: s.center + SIT_COLS + 1, to: s.w - KITTEN_COLS, speed: 0.45 }]
  yards.forEach((yard, i) => {
    const span = yard.to - yard.from
    if (span < 2) return
    const { x, dir } = bounce(span * 0.4, yard.speed, span, clock)
    const rows = KITTEN[Math.floor(clock / 2) % 2] as string[]
    sprite(out, dir === 1 ? rows : rows.map(r => mirrored(r, KITTEN_COLS)), yard.from + x, s.ground - 4, KITTEN_FUR[i])
  })
}

/** A ball of yarn rolling back and forth on the ground, its loose thread behind it. */
function yarn(out: Frame, s: Stage, clock: number): void {
  const { x, dir } = bounce(s.w * 0.6, 0.35, Math.max(1, s.w - 1), clock)
  put(out, x - dir * 2, s.ground - 1, '~', YARN)
  put(out, x - dir, s.ground - 1, '~', YARN)
  put(out, x, s.ground - 1, '@', YARN)
}

/** A butterfly drifting across the top rows, its wings beating. */
function butterfly(out: Frame, s: Stage, clock: number): void {
  const x = Math.floor((clock * 0.4) % (s.w + 4)) - 2
  const y = Math.round(1 + Math.sin(clock / 5))
  put(out, x, y, Math.floor(clock / 3) % 2 === 0 ? '}{' : ')(', BUTTERFLY)
}

/**
 * A cat and its garden: the big cat walks in slowly to the middle of the band, sits and blinks, says meow,
 * rolls on the ground, jumps, purrs with a heart, looks about, says MEOW and walks out, then comes round
 * again, while two kittens play on the grass, a ball of yarn rolls and a butterfly drifts over them.
 */
export function cat(w: number, h: number, rng: Rng): Animation {
  const ground = h - 1
  const s: Stage = { w, h, center: Math.max(0, Math.floor((w - SIT_COLS) / 2)), base: ground - SPRITE_ROWS, ground }
  const grass = groundRow(w, rng)
  let phases = show(s, rng)
  let index = 0
  let t = 0
  let clock = 0
  let wrapped = false

  // `t` counts steps of STEP_MS within the phase, with a fraction between them, so a walk moves on every frame.
  // A round that ends says so through `wrapped`, so `random` moves on only once the cat has walked out.
  const step = (dtMs?: number): void => {
    const u = unitsOf(dtMs)
    t += u
    clock += u
    wrapped = false
    for (let ticks = phases[index]?.ticks ?? 0; t >= ticks; ticks = phases[index]?.ticks ?? 0) {
      t -= ticks
      index += 1
      if (index >= phases.length) {
        index = 0
        phases = show(s, rng)
        wrapped = true
      }
    }
  }

  const frame = (): Frame => {
    const out = blankFrame(w, h)
    put(out, 0, ground, grass, GRASS)
    kittens(out, s, clock)
    butterfly(out, s, clock)
    phases[index]?.draw(t, out)
    // The yarn rolls in front, at the cats' feet, so no cat hides it.
    yarn(out, s, clock)
    return out
  }

  return { step, frame, wrapped: () => wrapped }
}
