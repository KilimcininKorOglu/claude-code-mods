/** One composed frame of a GIF: RGBA pixels of the whole logical screen, and how long it shows. */
export type GifFrame = { rgba: Uint8Array; delayMs: number }
export type Gif = { width: number; height: number; frames: GifFrame[] }

/** The frame control a Graphic Control Extension sets for the next image. */
type Control = { delayMs: number; transparent: number | null; disposal: number }

/** A delay of 0 or 10 ms is played by browsers as 100 ms; so is it here. */
const MIN_DELAY_MS = 20
const DEFAULT_DELAY_MS = 100
/** Stop decoding past this many frames; the store could not hold more anyway. */
const MAX_FRAMES = 500

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The bytes of a base64 text, as `$.fs.read(path, { as: 'bytes' })` hands them. */
export function bytesOf(base64: string): Uint8Array {
  const text = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (const ch of text) {
    acc = ((acc << 6) | B64.indexOf(ch)) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

class Reader {
  pos = 0
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  byte(): number {
    const b = this.bytes[this.pos]
    if (b === undefined) throw new Error('the GIF ends early')
    this.pos += 1
    return b
  }
  u16(): number {
    return this.byte() | (this.byte() << 8)
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new Error('the GIF ends early')
    const out = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  /** The data sub-blocks up to their zero terminator, joined. */
  blocks(): Uint8Array {
    const parts: Uint8Array[] = []
    let total = 0
    for (let n = this.byte(); n !== 0; n = this.byte()) {
      parts.push(this.take(n))
      total += n
    }
    const out = new Uint8Array(total)
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}

function colorTable(r: Reader, packed: number): Uint8Array {
  return r.take(3 * (1 << ((packed & 7) + 1)))
}

/** Reads the variable-width, least-significant-bit-first codes of an LZW stream. */
class Codes {
  private pos = 0
  private acc = 0
  private bits = 0
  private readonly data: Uint8Array
  constructor(data: Uint8Array) {
    this.data = data
  }
  /** The next code of `size` bits, or -1 when the data ends. */
  next(size: number): number {
    while (this.bits < size) {
      const b = this.data[this.pos++]
      if (b === undefined) return -1
      this.acc |= b << this.bits
      this.bits += 8
    }
    const code = this.acc & ((1 << size) - 1)
    this.acc >>>= size
    this.bits -= size
    return code
  }
}

/** The LZW string table: each code past the roots is a prefix code plus one suffix index. */
class Table {
  readonly prefix = new Int16Array(4096).fill(-1)
  readonly suffix = new Uint8Array(4096)
  readonly first = new Uint8Array(4096)
  private readonly stack = new Uint8Array(4096)
  readonly clear: number
  next = 0
  size = 0
  readonly minCodeSize: number
  constructor(minCodeSize: number) {
    this.minCodeSize = minCodeSize
    this.clear = 1 << minCodeSize
    for (let i = 0; i < this.clear; i++) {
      this.suffix[i] = i
      this.first[i] = i
    }
    this.reset()
  }
  reset(): void {
    this.size = this.minCodeSize + 1
    this.next = this.clear + 2
  }
  /** Writes the string of `code` into `out` from `o`; the code being defined is the previous string plus its first index. */
  expand(code: number, prev: number, out: Uint8Array, o: number): number {
    if (code > this.next || (code === this.next && prev === -1)) throw new Error('the GIF image data is broken')
    let sp = 0
    let c = code
    if (code === this.next) {
      this.stack[sp++] = this.first[prev] as number
      c = prev
    }
    while (c >= this.clear) {
      this.stack[sp++] = this.suffix[c] as number
      c = this.prefix[c] as number
    }
    this.stack[sp++] = c
    while (sp > 0 && o < out.length) out[o++] = this.stack[--sp] as number
    return o
  }
  /** Adds the previous string plus the first index of the current one. */
  add(code: number, prev: number): void {
    if (prev === -1 || this.next >= 4096) return
    this.prefix[this.next] = prev
    this.suffix[this.next] = this.first[code === this.next ? prev : code] as number
    this.first[this.next] = this.first[prev] as number
    this.next += 1
    if (this.next === 1 << this.size && this.size < 12) this.size += 1
  }
}

/** The LZW-coded pixel indices of one image, `count` of them; a short stream leaves the rest 0. */
export function lzwDecode(data: Uint8Array, minCodeSize: number, count: number): Uint8Array {
  if (minCodeSize < 2 || minCodeSize > 8) throw new Error('the GIF image data is broken')
  const out = new Uint8Array(count)
  const table = new Table(minCodeSize)
  const codes = new Codes(data)
  let prev = -1
  let o = 0
  while (o < count) {
    const code = codes.next(table.size)
    if (code === -1 || code === table.clear + 1) break
    if (code === table.clear) {
      table.reset()
      prev = -1
      continue
    }
    o = table.expand(code, prev, out, o)
    table.add(code, prev)
    prev = code
  }
  return out
}

/** The row order of an interlaced image: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
function interlacedRows(h: number): number[] {
  const rows: number[] = []
  for (const [start, stepBy] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += stepBy) rows.push(y)
  return rows
}

function readControl(r: Reader): Control {
  const block = r.blocks()
  const packed = block[0] ?? 0
  const delay = ((block[1] ?? 0) | ((block[2] ?? 0) << 8)) * 10
  return { disposal: (packed >> 2) & 7, transparent: packed & 1 ? (block[3] ?? 0) : null, delayMs: delay < MIN_DELAY_MS ? DEFAULT_DELAY_MS : delay }
}

type Screen = { width: number; height: number; canvas: Uint8Array; global: Uint8Array | null }

/** Draws one image onto the canvas and answers the frame the screen then shows. */
function drawImage(r: Reader, s: Screen, ctl: Control): GifFrame {
  const x0 = r.u16()
  const y0 = r.u16()
  const w = r.u16()
  const h = r.u16()
  const packed = r.byte()
  const table = packed & 0x80 ? colorTable(r, packed) : s.global
  if (table === null) throw new Error('a GIF image has no color table')
  const minCodeSize = r.byte()
  const indices = lzwDecode(r.blocks(), minCodeSize, w * h)
  const saved = ctl.disposal === 3 ? s.canvas.slice() : null
  const rows = packed & 0x40 ? interlacedRows(h) : Array.from({ length: h }, (_, y) => y)
  rows.forEach((y, i) => paintRow(s, table, indices.subarray(i * w, i * w + w), x0, y0 + y, ctl.transparent))
  const frame = { rgba: s.canvas.slice(), delayMs: ctl.delayMs }
  if (ctl.disposal === 2) clearRect(s, x0, y0, w, h)
  if (saved !== null) s.canvas = saved
  return frame
}

function paintRow(s: Screen, table: Uint8Array, row: Uint8Array, x0: number, y: number, transparent: number | null): void {
  if (y < 0 || y >= s.height) return
  row.forEach((index, i) => {
    const x = x0 + i
    if (index === transparent || x < 0 || x >= s.width) return
    const p = (y * s.width + x) * 4
    s.canvas.set([table[index * 3] ?? 0, table[index * 3 + 1] ?? 0, table[index * 3 + 2] ?? 0, 255], p)
  })
}

function clearRect(s: Screen, x0: number, y0: number, w: number, h: number): void {
  for (let y = Math.max(0, y0); y < Math.min(s.height, y0 + h); y++) s.canvas.fill(0, (y * s.width + Math.max(0, x0)) * 4, (y * s.width + Math.min(s.width, x0 + w)) * 4)
}

/** The signature, the logical screen and the global color table. */
function readScreen(r: Reader): Screen {
  const sig = String.fromCharCode(...r.take(6))
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('the file is not a GIF')
  const width = r.u16()
  const height = r.u16()
  const packed = r.byte()
  r.take(2)
  if (width === 0 || height === 0) throw new Error('the GIF has no size')
  return { width, height, canvas: new Uint8Array(width * height * 4), global: packed & 0x80 ? colorTable(r, packed) : null }
}

/**
 * Decodes a GIF87a or GIF89a file frame by frame, handing each composed frame
 * to `visit` as it is made, so no more than one frame's pixels are held at once.
 * Answers the screen's size and the number of frames. Throws with a reason on a
 * file it cannot read.
 */
export function readGif(bytes: Uint8Array, visit: (frame: GifFrame, width: number, height: number) => void): { width: number; height: number; count: number } {
  const r = new Reader(bytes)
  const s = readScreen(r)
  let count = 0
  let ctl: Control = { delayMs: DEFAULT_DELAY_MS, transparent: null, disposal: 0 }
  while (count < MAX_FRAMES) {
    const kind = r.byte()
    if (kind === 0x3b) break
    if (kind === 0x2c) {
      visit(drawImage(r, s, ctl), s.width, s.height)
      count += 1
      ctl = { delayMs: DEFAULT_DELAY_MS, transparent: null, disposal: 0 }
    } else if (kind === 0x21) ctl = readExtension(r, ctl)
    else throw new Error(`the GIF holds an unknown block 0x${kind.toString(16)}`)
  }
  if (count === 0) throw new Error('the GIF has no image')
  return { width: s.width, height: s.height, count }
}

/** Decodes a GIF into all its composed frames at once; for a small GIF, as the tests use. */
export function decodeGif(bytes: Uint8Array): Gif {
  const frames: GifFrame[] = []
  const { width, height } = readGif(bytes, f => frames.push(f))
  return { width, height, frames }
}

function readExtension(r: Reader, ctl: Control): Control {
  const label = r.byte()
  if (label === 0xf9) return readControl(r)
  r.blocks()
  return ctl
}
