import { blankFrame, unitsOf, type Animation, type Frame, type Rng } from './grid.ts'

/** A star in view space: x and y in [-1, 1] at depth 1, z from 1 (far) toward 0 (near). */
type Star = { x: number; y: number; z: number }

/** Glyph and colour by nearness, far to near. */
const LOOKS: readonly { ch: string; color: string }[] = [
  { ch: '·', color: '#4b5263' },
  { ch: '·', color: '#8a93a6' },
  { ch: '∗', color: '#b8c2d6' },
  { ch: '*', color: '#dfe7ff' },
  { ch: '✦', color: '#ffffff' },
]

/** Depth a star travels per tick. */
const SPEED = 0.02

function newStar(rng: Rng, far: boolean): Star {
  return { x: rng() * 2 - 1, y: rng() * 2 - 1, z: far ? 1 : 0.1 + rng() * 0.9 }
}

/**
 * A star field flown through: each star moves toward the viewer and spreads
 * from the centre as it nears, brighter and larger, and starts again far away
 * once it passes or leaves the region.
 */
export function stars(w: number, h: number, rng: Rng): Animation {
  const field = Array.from({ length: Math.max(8, Math.floor((w * h) / 12)) }, () => newStar(rng, false))
  const cx = w / 2
  const cy = h / 2

  // A terminal cell is about twice as tall as wide, so the vertical spread is halved.
  const place = (s: Star): { col: number; row: number } => ({
    col: Math.floor(cx + (s.x / s.z) * cx),
    row: Math.floor(cy + ((s.y / s.z) * cy) / 2),
  })

  const step = (dtMs?: number): void => {
    const u = unitsOf(dtMs)
    field.forEach((s, i) => {
      s.z -= SPEED * u
      const { col, row } = place(s)
      if (s.z <= 0.05 || col < 0 || col >= w || row < 0 || row >= h) field[i] = newStar(rng, true)
    })
  }

  const frame = (): Frame => {
    const out = blankFrame(w, h)
    for (const s of field) {
      const { col, row } = place(s)
      const look = LOOKS[Math.min(LOOKS.length - 1, Math.floor((1 - s.z) * LOOKS.length))]
      const line = out[row]
      if (line !== undefined && look !== undefined && col >= 0 && col < w) line[col] = look
    }
    return out
  }

  return { step, frame }
}
