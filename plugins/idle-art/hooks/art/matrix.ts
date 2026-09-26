import { below, blankFrame, pick, type Animation, type Frame, type Rng } from './grid.ts'

/** Half-width katakana and digits: one cell wide each. */
const GLYPHS = [...'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789']

const HEAD = '#e6ffe6'
/** The trail from just behind the head to its faded end. */
const TRAIL = ['#5dff7a', '#1fd14a', '#12a03a', '#0b6e28', '#06451a']

/** One falling stream: its head row (fractional), rows per tick and trail length. */
type Drop = { y: number; speed: number; len: number }

function newDrop(rng: Rng, h: number, fresh: boolean): Drop {
  const len = 3 + below(rng, Math.max(2, h))
  // A fresh start spreads the streams over the region; a respawn starts above it.
  const y = fresh ? below(rng, h + len) - len : -below(rng, h * 2) - 1
  return { y, speed: 0.25 + rng() * 0.6, len }
}

function trailColor(dist: number, len: number): string {
  const i = Math.min(TRAIL.length - 1, Math.floor((dist / len) * TRAIL.length))
  return TRAIL[i] as string
}

/** Matrix rain: one stream in every other column, glyphs flickering under it. */
export function matrix(w: number, h: number, rng: Rng): Animation {
  const glyphs = Array.from({ length: h }, () => Array.from({ length: w }, () => pick(rng, GLYPHS)))
  const drops: (Drop | null)[] = Array.from({ length: w }, (_, x) => (x % 2 === 0 ? newDrop(rng, h, true) : null))

  const step = (): void => {
    drops.forEach((d, x) => {
      if (d === null) return
      d.y += d.speed
      if (d.y - d.len > h) drops[x] = newDrop(rng, h, false)
    })
    // A few glyphs change each tick, so a still trail shimmers.
    for (let i = 0; i < Math.ceil((w * h) / 30); i++) {
      const row = glyphs[below(rng, h)]
      if (row !== undefined) row[below(rng, w)] = pick(rng, GLYPHS)
    }
  }

  const frame = (): Frame => {
    const out = blankFrame(w, h)
    drops.forEach((d, x) => {
      if (d === null) return
      const head = Math.floor(d.y)
      for (let dist = 0; dist < d.len; dist++) {
        const y = head - dist
        const row = out[y]
        if (row === undefined) continue
        row[x] = { ch: glyphs[y]?.[x] ?? ' ', color: dist === 0 ? HEAD : trailColor(dist, d.len) }
      }
    })
    return out
  }

  return { step, frame }
}
