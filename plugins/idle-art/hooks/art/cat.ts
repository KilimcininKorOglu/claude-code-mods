import { blankFrame, put, unitsOf, type Animation, type Frame, type Rng } from './grid.ts'

const FUR = '#ffb86b'
const SPEECH = '#ffffff'
const HEART = '#ff6b9d'

/** Every sprite is 4 rows by 10 columns, drawn with its last row on the band's last row. */
const SPRITE_ROWS = 4
const SPRITE_COLS = 10

/** The cat walking right, its head ahead and its tail behind, two steps. */
const WALK = [
  ['    /\\_/\\ ', ' __( o.o )', '~(      ) ', '  /\\  /\\  '],
  ['    /\\_/\\ ', ' __( o.o )', '~(      ) ', '  ||  ||  '],
]

/** The cat sitting, its eyes given. */
function sitting(eyes: string): string[] {
  return [' /\\_/\\    ', `( ${eyes} )   `, ' > ^ <    ', ' (_|_)~   ']
}

/** The cat rolling on the ground: on one side, on its back with its paws up, on the other side, on its back. */
const ROLL = [
  ['          ', '  /\\_/\\   ', ' ( -.- )=~', '  `----\'  '],
  ['  /\\  /\\  ', ' (      )~', ' ( o.o )  ', '  \\/"\\/   '],
  ['          ', '   /\\_/\\  ', '~=( -.- ) ', '  `----\'  '],
  ['  /\\  /\\  ', ' (      )~', ' ( ^.^ )  ', '  \\/"\\/   '],
]

/** Cells a walking cat moves per tick. */
const WALK_SPEED = 0.5

/** One part of the show: how many ticks it lasts, and how its tick-th frame is drawn. */
type Phase = { ticks: number; draw: (t: number, out: Frame) => void }

type Stage = { w: number; h: number; center: number; base: number }

function sprite(out: Frame, rows: readonly string[], x: number, y: number): void {
  rows.forEach((row, i) => put(out, x, y + i, row, FUR))
}

/**
 * A speech bubble over the cat's head, its tail pointing down to the head:
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
  bubbleRows(text).forEach((row, i) => put(out, s.center + 6, s.base - 4 + i, row, SPEECH))
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
      put(out, s.center + 3, s.base - 1 - Math.floor(t / 8), '♥', HEART)
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
    walkPhase(s, -SPRITE_COLS, s.center),
    sitPhase(s),
    meowPhase(s, 'meow', 'o.o'),
    ...tricks(s, rng),
    meowPhase(s, 'MEOW!', '>.<'),
    walkPhase(s, s.center, s.w),
  ]
}

/**
 * A cat: it walks in slowly to the middle of the band, sits and blinks, says meow, rolls on the ground,
 * jumps, purrs with a heart, looks about, says MEOW and walks out, then comes round again.
 */
export function cat(w: number, h: number, rng: Rng): Animation {
  const s: Stage = { w, h, center: Math.max(0, Math.floor((w - SPRITE_COLS) / 2)), base: h - SPRITE_ROWS }
  let phases = show(s, rng)
  let index = 0
  let t = 0
  let wrapped = false

  // `t` counts steps of STEP_MS within the phase, with a fraction between them, so a walk moves on every frame.
  // A round that ends says so through `wrapped`, so `random` moves on only once the cat has walked out.
  const step = (dtMs?: number): void => {
    t += unitsOf(dtMs)
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
    phases[index]?.draw(t, out)
    return out
  }

  return { step, frame, wrapped: () => wrapped }
}
