import { readGif, type Gif } from './gif.ts'
import { BLANK, blankFrame, runsOf, type Animation, type Cell, type Frame } from './art/grid.ts'

/** A run of one colour in a stored row: its text and its colour ('' for none). */
export type ClipRun = [string, string]

/** A GIF turned into character frames, as the store keeps it and the band plays it. */
export type Clip = { width: number; height: number; delays: number[]; frames: ClipRun[][][] }

/** Glyphs from the dimmest opaque cell to the brightest; a transparent cell is a space. */
const RAMP = [...'.:-=+*#%@']

/** The largest clip in JSON characters: a `Client`'s props are bounded at 100,000. */
export const MAX_CLIP_CHARS = 90_000

/** A cell less covered than this by opaque pixels is left blank. */
const MIN_COVER = 0.5

/** Rounds a channel to one of six levels, so neighbouring cells share a colour and a run. */
function level(v: number): number {
  return Math.round(v / 51) * 51
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => level(v).toString(16).padStart(2, '0')).join('')}`
}

type Box = { x0: number; x1: number; y0: number; y1: number }

/** The mean colour and the opaque share of a pixel box of one frame. */
function average(rgba: Uint8Array, width: number, box: Box): { r: number; g: number; b: number; cover: number } {
  let r = 0
  let g = 0
  let b = 0
  let opaque = 0
  let all = 0
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const p = (y * width + x) * 4
      all += 1
      if ((rgba[p + 3] ?? 0) < 128) continue
      opaque += 1
      r += rgba[p] ?? 0
      g += rgba[p + 1] ?? 0
      b += rgba[p + 2] ?? 0
    }
  }
  if (opaque === 0) return { r: 0, g: 0, b: 0, cover: 0 }
  return { r: r / opaque, g: g / opaque, b: b / opaque, cover: opaque / Math.max(1, all) }
}

type Mean = ReturnType<typeof average>

function lumOf(a: Mean): number {
  return (0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b) / 255
}

/** The darkest and brightest opaque cell of the whole clip, so the ramp spans the clip's own range. */
type Range = { lo: number; hi: number }

function rangeOf(means: Mean[][][]): Range {
  let lo = 1
  let hi = 0
  for (const cell of means.flat(2)) {
    if (cell.cover < MIN_COVER) continue
    lo = Math.min(lo, lumOf(cell))
    hi = Math.max(hi, lumOf(cell))
  }
  return hi > lo ? { lo, hi } : { lo: 0, hi: 1 }
}

function cellOf(a: Mean, range: Range): Cell {
  if (a.cover < MIN_COVER) return BLANK
  const t = (lumOf(a) - range.lo) / (range.hi - range.lo)
  return { ch: RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * RAMP.length)))] as string, color: hex(a.r, a.g, a.b) }
}

/**
 * The size in cells a picture takes in a band of `cols` by `rows`, its shape kept:
 * a cell is about twice as tall as wide, so one row covers two pixel rows' worth.
 */
export function fitSize(width: number, height: number, cols: number, rows: number): { cols: number; rows: number } {
  const scale = Math.min(cols / width, (rows * 2) / height)
  return { cols: Math.max(1, Math.min(cols, Math.round(width * scale))), rows: Math.max(1, Math.min(rows, Math.round((height * scale) / 2))) }
}

/** The pixel span of cell `i` of `n` over `size` pixels, at least one pixel. */
function span(i: number, n: number, size: number): [number, number] {
  const a = Math.floor((i * size) / n)
  return [a, Math.max(a + 1, Math.floor(((i + 1) * size) / n))]
}

/** The mean of every cell of one frame of `width` by `height` pixels, row by row. */
function frameMeans(rgba: Uint8Array, width: number, height: number, cols: number, rows: number): Mean[][] {
  return Array.from({ length: rows }, (_, cy) => {
    const [y0, y1] = span(cy, rows, height)
    return Array.from({ length: cols }, (_, cx) => {
      const [x0, x1] = span(cx, cols, width)
      return average(rgba, width, { x0, x1, y0, y1 })
    })
  })
}

function frameRows(means: Mean[][], range: Range): ClipRun[][] {
  return means.map(row => runsOf(row.map(m => cellOf(m, range))).map(run => [run.text, run.color] as ClipRun))
}

/** Keeps every other frame, each kept frame showing for the time of both. */
function thinned(clip: Clip): Clip {
  const frames: ClipRun[][][] = []
  const delays: number[] = []
  for (let i = 0; i < clip.frames.length; i += 2) {
    frames.push(clip.frames[i] as ClipRun[][])
    delays.push((clip.delays[i] ?? 0) + (clip.delays[i + 1] ?? 0))
  }
  return { ...clip, frames, delays }
}

/** The cell means and delays of every frame, as the frames are decoded. */
type Means = { cols: number; rows: number; means: Mean[][][]; delays: number[] }

/** A clip from the frames' cell means, with frames dropped until it fits the size limit. */
function clipOf(m: Means): { clip: Clip; dropped: number } {
  const range = rangeOf(m.means)
  let clip: Clip = { width: m.cols, height: m.rows, delays: m.delays, frames: m.means.map(f => frameRows(f, range)) }
  while (JSON.stringify(clip).length > MAX_CLIP_CHARS && clip.frames.length > 1) clip = thinned(clip)
  if (JSON.stringify(clip).length > MAX_CLIP_CHARS) throw new Error(`one frame is over ${MAX_CLIP_CHARS} characters`)
  return { clip, dropped: m.means.length - clip.frames.length }
}

/** A decoded GIF as a clip for a band of `cols` by `rows`. */
export function toClip(gif: Gif, cols: number, rows: number): { clip: Clip; dropped: number } {
  const size = fitSize(gif.width, gif.height, cols, rows)
  const means = gif.frames.map(f => frameMeans(f.rgba, gif.width, gif.height, size.cols, size.rows))
  return clipOf({ ...size, means, delays: gif.frames.map(f => f.delayMs) })
}

/**
 * A GIF file's bytes as a clip for a band of `cols` by `rows`: each frame is
 * reduced to its cell means as it is decoded, so a large GIF never holds more
 * than one frame of pixels.
 */
export function clipFromGif(bytes: Uint8Array, cols: number, rows: number): { clip: Clip; dropped: number; frames: number } {
  const m: Means = { cols: 0, rows: 0, means: [], delays: [] }
  const { count } = readGif(bytes, (frame, width, height) => {
    if (m.means.length === 0) Object.assign(m, fitSize(width, height, cols, rows))
    m.means.push(frameMeans(frame.rgba, width, height, m.cols, m.rows))
    m.delays.push(frame.delayMs)
  })
  return { ...clipOf(m), frames: count }
}

/** Whether a stored value has the shape of a clip, so a broken store entry is refused rather than drawn. */
export function isClip(v: unknown): v is Clip {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Partial<Clip>
  return typeof c.width === 'number' && typeof c.height === 'number' && Array.isArray(c.delays) && Array.isArray(c.frames) && c.frames.length > 0 && c.frames.length === c.delays.length
}

/** Draws a stored row into a frame from column `x`, cutting what falls outside. */
function putRow(out: Frame, y: number, x: number, runs: ClipRun[]): void {
  const row = out[y]
  if (row === undefined) return
  let col = x
  for (const [text, color] of runs) {
    for (const ch of text) {
      if (col >= 0 && col < row.length) row[col] = ch === ' ' ? BLANK : { ch, color }
      col += 1
    }
  }
}

/**
 * Plays a clip centred in a region of `w` by `h`, each frame for its own delay, in a loop; a step without a
 * length of its own is `tickMs` long.
 */
export function playClip(clip: Clip, w: number, h: number, tickMs: number): Animation {
  let index = 0
  let shown = 0
  let wrapped = false
  const x = Math.floor((w - clip.width) / 2)
  const y = Math.floor((h - clip.height) / 2)
  const step = (dtMs?: number): void => {
    shown += dtMs ?? tickMs
    wrapped = false
    // A stored delay under 20 ms is read as 20 ms, so a broken entry cannot spin this loop.
    for (let d = Math.max(20, clip.delays[index] ?? tickMs); shown >= d; d = Math.max(20, clip.delays[index] ?? tickMs)) {
      shown -= d
      index = (index + 1) % clip.frames.length
      if (index === 0) wrapped = true
    }
  }
  const frame = (): Frame => {
    const out = blankFrame(w, h)
    clip.frames[index]?.forEach((runs, row) => putRow(out, y + row, x, runs))
    return out
  }
  return { step, frame, wrapped: () => wrapped }
}
