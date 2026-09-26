import { below, blankFrame, pick, put, type Animation, type Frame, type Rng } from './grid.ts'

/** Each fish as it looks swimming right, and the same fish swimming left. */
const SHAPES: readonly { right: string; left: string }[] = [
  { right: '><>', left: '<><' },
  { right: '><(((°>', left: '<°)))><' },
  { right: '>=>', left: '<=<' },
  { right: '><((°>', left: '<°))><' },
]
const FISH_COLORS = ['#ffa94d', '#ffd43b', '#66d9e8', '#f783ac', '#b197fc']
const BUBBLE = '#a5d8ff'
const WEED = ['#2f9e44', '#51cf66']
const SAND = '#c9a66b'

type Fish = { x: number; y: number; dir: 1 | -1; speed: number; shape: number; color: string }
type Bubble = { x: number; y: number }
type Weed = { x: number; height: number; phase: number }

/** Ticks between two sways of the seaweed. */
const SWAY_TICKS = 6

function newFish(rng: Rng, w: number, h: number, anywhere: boolean): Fish {
  const dir = rng() < 0.5 ? 1 : -1
  const shape = below(rng, SHAPES.length)
  const len = (SHAPES[shape]?.right.length ?? 3)
  const edge = dir === 1 ? -len : w
  return { x: anywhere ? below(rng, w) : edge, y: below(rng, Math.max(1, h - 1)), dir, speed: 0.15 + rng() * 0.35, shape, color: pick(rng, FISH_COLORS) }
}

function fishText(f: Fish): string {
  const s = SHAPES[f.shape] ?? { right: '><>', left: '<><' }
  return f.dir === 1 ? s.right : s.left
}

function isGone(f: Fish, w: number): boolean {
  return f.dir === 1 ? f.x > w : f.x + fishText(f).length < 0
}

/** The glyph of a bubble: it grows as it rises. */
function bubbleGlyph(y: number, h: number): string {
  if (y > h * 0.66) return '.'
  return y > h * 0.33 ? 'o' : 'O'
}

/** An aquarium: fish crossing both ways, bubbles rising from them, seaweed swaying on the sand. */
export function aquarium(w: number, h: number, rng: Rng): Animation {
  const fish = Array.from({ length: Math.max(2, Math.floor(w / 14)) }, () => newFish(rng, w, h, true))
  const bubbles: Bubble[] = []
  const weeds: Weed[] = Array.from({ length: Math.max(2, Math.floor(w / 10)) }, () => ({ x: below(rng, w), height: 1 + below(rng, Math.max(1, Math.floor(h / 2))), phase: below(rng, 2) }))
  const sand = Array.from({ length: w }, () => pick(rng, ['.', ',', '_', '.', ' ']))
  let tick = 0

  const step = (): void => {
    tick += 1
    fish.forEach((f, i) => {
      f.x += f.dir * f.speed
      if (isGone(f, w)) fish[i] = newFish(rng, w, h, false)
      else if (rng() < 0.02) bubbles.push({ x: Math.round(f.dir === 1 ? f.x + fishText(f).length : f.x - 1), y: f.y })
    })
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i] as Bubble
      b.y -= 0.3
      if (b.y < 0) bubbles.splice(i, 1)
    }
  }

  const frame = (): Frame => {
    const out = blankFrame(w, h)
    put(out, 0, h - 1, sand.join(''), SAND)
    const sway = Math.floor(tick / SWAY_TICKS)
    for (const wd of weeds) {
      for (let k = 0; k < wd.height; k++) put(out, wd.x, h - 2 - k, (k + wd.phase + sway) % 2 === 0 ? '(' : ')', WEED[k % 2] as string)
    }
    for (const b of bubbles) put(out, b.x, Math.floor(b.y), bubbleGlyph(b.y, h), BUBBLE)
    for (const f of fish) put(out, Math.round(f.x), f.y, fishText(f), f.color)
    return out
  }

  return { step, frame }
}
