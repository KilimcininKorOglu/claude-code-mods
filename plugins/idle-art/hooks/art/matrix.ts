import { below, everyStep, pick, unitsOf, type Animation, type Frame, type Rng } from './grid.ts'

/** Half-width katakana and digits: one cell wide each. */
const GLYPHS = [...'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789']

const HEAD = '#e6ffe6'
/** The glyphs that stand between the streams: the whole region filled, faint, as a fire fills its own. */
const BACKDROP = '#0a3a18'
/** The trail from just behind the head to its faded end. */
const TRAIL = ['#5dff7a', '#1fd14a', '#12a03a', '#0b6e28', '#06451a']

/** One falling stream: its head row (fractional), rows per tick and trail length. */
type Drop = { y: number; speed: number; len: number }

function newDrop(rng: Rng, h: number, fresh: boolean): Drop {
  const len = Math.max(3, Math.floor(h / 2)) + below(rng, Math.max(2, h))
  // A fresh start spreads the streams over the region; a respawn starts just above it.
  const y = fresh ? below(rng, h + len) - len : -below(rng, h) - 1
  return { y, speed: 0.4 + rng() * 0.8, len }
}

function trailColor(dist: number, len: number): string {
  const i = Math.min(TRAIL.length - 1, Math.floor((dist / len) * TRAIL.length))
  return TRAIL[i] as string
}

/** Matrix rain: one stream in every column over a faint field of glyphs, all of them flickering. */
export function matrix(w: number, h: number, rng: Rng): Animation {
  const glyphs = Array.from({ length: h }, () => Array.from({ length: w }, () => pick(rng, GLYPHS)))
  const drops: Drop[] = Array.from({ length: w }, () => newDrop(rng, h, true))

  // A few glyphs change each step, so a still trail shimmers at the same pace at any frame rate.
  const shimmer = everyStep(() => {
    for (let i = 0; i < Math.ceil((w * h) / 8); i++) {
      const row = glyphs[below(rng, h)]
      if (row !== undefined) row[below(rng, w)] = pick(rng, GLYPHS)
    }
  })

  const step = (dtMs?: number): void => {
    const u = unitsOf(dtMs)
    drops.forEach((d, x) => {
      d.y += d.speed * u
      if (d.y - d.len > h) drops[x] = newDrop(rng, h, false)
    })
    shimmer(dtMs)
  }

  const frame = (): Frame => {
    const out: Frame = glyphs.map(row => row.map(ch => ({ ch, color: BACKDROP })))
    drops.forEach((d, x) => {
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
