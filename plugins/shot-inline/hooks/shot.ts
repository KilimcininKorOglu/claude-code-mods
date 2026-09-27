/** Which image a tool call saved or read, its pixel size, and the box of cells it is drawn in. */

const IMAGE = /\.(png|jpe?g)$/i

export const isImagePath = (path: string): boolean => IMAGE.test(path)

export const isPng = (path: string): boolean => /\.png$/i.test(path)

/** The file a Playwright screenshot result links to: `[Screenshot of viewport](.playwright-mcp/page.png)`. */
export function screenshotPath(result: string): string | undefined {
  return /\]\(([^)\s]+\.(?:png|jpe?g))\)/i.exec(result)?.[1]
}

/** The image paths a shell command names, the last first, because a command usually writes its output last. */
export function commandImagePaths(command: string): string[] {
  const quotedOrBare = /(["'])([^"']+?\.(?:png|jpe?g))\1|(?:^|[\s=])([^\s'"|;&<>()=]+\.(?:png|jpe?g))(?=$|[\s|;&<>)])/gi
  const paths = [...command.matchAll(quotedOrBare)].map(m => m[2] ?? m[3] ?? '')
  return [...new Set(paths.reverse())].filter(p => p !== '')
}

/** `path` as an absolute path; `~` is left as it is, so it fails the existence check instead of guessing a home. */
export function absolute(path: string, cwd: string): string {
  return path.startsWith('/') || path.startsWith('~') ? path : `${cwd.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The first bytes of a base64 string; a module has no Node Buffer. */
export function headBytes(base64: string, count: number): number[] {
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const ch of base64) {
    const n = B64.indexOf(ch)
    if (n < 0 || bytes.length >= count) break
    value = (value << 6) | n
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >> bits) & 0xff)
    }
  }
  return bytes
}

/** Every byte of a base64 string. */
export function allBytes(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let at = 0
  let bits = 0
  let value = 0
  for (const ch of text) {
    const n = B64.indexOf(ch)
    if (n < 0) continue
    value = ((value << 6) | n) >>> 0
    bits += 6
    if (bits < 8) continue
    bits -= 8
    out[at++] = (value >> bits) & 0xff
  }
  return out.subarray(0, at)
}

export type Size = { width: number; height: number }

const u32 = (b: number[], at: number): number => (((b[at] ?? 0) << 24) >>> 0) + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0)

/** The size in a PNG's IHDR chunk, or undefined for bytes that are not a PNG. */
export function pngSize(base64: string): Size | undefined {
  const b = headBytes(base64, 24)
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!signature.every((v, i) => b[i] === v) || String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') return undefined
  const size = { width: u32(b, 16), height: u32(b, 20) }
  return size.width > 0 && size.height > 0 ? size : undefined
}

/** The size in `sips -g pixelWidth -g pixelHeight` output. */
export function sipsSize(stdout: string): Size | undefined {
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/** The tallest picture, in rows, so a screenshot does not fill the screen. */
export const MAX_ROWS = 24

/** Pixels per cell across; a cell is about twice as tall as it is wide. */
const PX_PER_COLUMN = 8

/** The box of cells that keeps the picture's shape, at most `maxColumns` wide and MAX_ROWS tall. */
export function cells(size: Size, maxColumns: number): { columns: number; rows: number } {
  const fit = Math.max(1, Math.min(maxColumns, Math.round(size.width / PX_PER_COLUMN)))
  const rows = Math.max(1, Math.round((fit * size.height) / size.width / 2))
  if (rows <= MAX_ROWS) return { columns: fit, rows }
  return { columns: Math.max(1, Math.round((MAX_ROWS * 2 * size.width) / size.height)), rows: MAX_ROWS }
}

/** A name for the PNG copy of a JPG, from its path and modification time, FNV-1a 32. */
export function copyName(path: string, mtimeMs: number): string {
  return `${hash(`${path}\0${mtimeMs}`)}.png`
}

/** A name for the BMP of one picture at one size in pixels. */
export function bmpName(path: string, mtimeMs: number, width: number, height: number): string {
  return `${hash(`${path}\0${mtimeMs}\0${width}x${height}`)}.bmp`
}

function hash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** The terminal draws a picture only with the kitty graphics protocol (kitty, Ghostty). */
export function hasGraphics(term: string, termProgram: string, kittyWindow: string): boolean {
  if (kittyWindow !== '') return true
  const name = `${term} ${termProgram}`.toLowerCase()
  return name.includes('kitty') || name.includes('ghostty')
}

/** Upper half block: the cell's top pixel is its foreground, its bottom pixel its background. */
const UPPER_HALF = 0x2580

/** A BMP as `sips -s format bmp` writes one: 24 or 32 bits a pixel, uncompressed, BGR(A). */
export type Bitmap = { width: number; height: number; offset: number; topDown: boolean; step: number; stride: number; bytes: Uint8Array }

const u32le = (b: Uint8Array, at: number): number => (((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0)

/** The header of an uncompressed BMP, or undefined for bytes this reader does not take. */
export function readBmp(bytes: Uint8Array): Bitmap | undefined {
  const bpp = (bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d || (bpp !== 24 && bpp !== 32)) return undefined
  const signedHeight = u32le(bytes, 22) | 0
  const width = u32le(bytes, 18)
  const step = bpp / 8
  if (width < 1 || signedHeight === 0) return undefined
  return { width, height: Math.abs(signedHeight), offset: u32le(bytes, 10), topDown: signedHeight < 0, step, stride: Math.ceil((width * step) / 4) * 4, bytes }
}

/** One pixel as `0x00RRGGBB`; a point outside the picture reads its nearest edge. */
export function pixel(bmp: Bitmap, x: number, y: number): number {
  const col = Math.min(Math.max(x, 0), bmp.width - 1)
  const row = Math.min(Math.max(y, 0), bmp.height - 1)
  const at = bmp.offset + (bmp.topDown ? row : bmp.height - 1 - row) * bmp.stride + col * bmp.step
  return ((bmp.bytes[at + 2] ?? 0) << 16) | ((bmp.bytes[at + 1] ?? 0) << 8) | (bmp.bytes[at] ?? 0)
}

/** The picture as `columns * rows` half-block cells, packed as `RasterProps.cells` takes them. */
export function halfBlocks(bmp: Bitmap, columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const at = (y * columns + x) * 3
      words[at] = UPPER_HALF
      words[at + 1] = pixel(bmp, x, y * 2)
      words[at + 2] = pixel(bmp, x, y * 2 + 1)
    }
  }
  return base64(new Uint8Array(words.buffer))
}

/**
 * The block characters a cell is drawn with, by how finely they split it. The finer sextant (U+1FB00)
 * and octant (U+1CD00) families lie beyond the Basic Multilingual Plane, which `Raster` refuses
 * (measured on 2.1.283: "holds code point 118089, beyond the Basic Multilingual Plane").
 */
export type Glyphs = 'half' | 'quadrant'

/** Pixels one cell holds across and down for each family. */
export const GLYPHS: Readonly<Record<Glyphs, { across: number; down: number }>> = {
  half: { across: 1, down: 2 },
  quadrant: { across: 2, down: 2 },
}

export const isGlyphs = (value: unknown): value is Glyphs => typeof value === 'string' && Object.hasOwn(GLYPHS, value)

/** Quadrant characters by mask: bit 0 upper left, 1 upper right, 2 lower left, 3 lower right. */
const QUADRANTS = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588,
]

/** The quadrant character for a mask of lit pixels. */
export function quadrant(mask: number): number {
  return QUADRANTS[mask] ?? 0x20
}

const channel = (color: number, k: number): number => (color >> (16 - k * 8)) & 0xff

/** The channel (0 red, 1 green, 2 blue) whose values spread widest, with its lowest and highest value. */
function widest(pixels: readonly number[]): { k: number; low: number; high: number } {
  let best = { k: 0, low: 0, high: 0 }
  for (let k = 0; k < 3; k++) {
    const values = pixels.map(p => channel(p, k))
    const low = Math.min(...values)
    const high = Math.max(...values)
    if (high - low > best.high - best.low) best = { k, low, high }
  }
  return best
}

/** The mean colour of some pixels, `0x00RRGGBB`. */
function mean(pixels: readonly number[]): number {
  if (pixels.length === 0) return 0
  const sum = [0, 1, 2].map(k => pixels.reduce((s, p) => s + channel(p, k), 0) / pixels.length)
  return (Math.round(sum[0] ?? 0) << 16) | (Math.round(sum[1] ?? 0) << 8) | Math.round(sum[2] ?? 0)
}

/**
 * One cell's pixels as two colours: split at the middle of the channel that spreads widest, the higher
 * side lit in the glyph's colour, the lower the background. A cell of one colour lights nothing.
 */
export function splitCell(pixels: readonly number[]): { mask: number; fg: number; bg: number } {
  const { k, low, high } = widest(pixels)
  const middle = (low + high) / 2
  let mask = 0
  pixels.forEach((p, i) => {
    if (high > low && channel(p, k) > middle) mask |= 1 << i
  })
  const lit = pixels.filter((_, i) => (mask >> i) & 1)
  const dark = pixels.filter((_, i) => !((mask >> i) & 1))
  return { mask, fg: lit.length === 0 ? mean(dark) : mean(lit), bg: mean(dark) }
}

/** The pixels of one cell in reading order. */
function cellPixels(bmp: Bitmap, x: number, y: number, across: number, down: number): number[] {
  const out: number[] = []
  for (let dy = 0; dy < down; dy++) {
    for (let dx = 0; dx < across; dx++) out.push(pixel(bmp, x * across + dx, y * down + dy))
  }
  return out
}

/**
 * The picture as `columns * rows` cells of one glyph family, packed as `RasterProps.cells` takes them;
 * the BMP holds `across` by `down` pixels a cell. A half block keeps each pixel's own colour; a quadrant
 * cell's four pixels share two.
 */
export function blockCells(bmp: Bitmap, columns: number, rows: number, glyphs: Glyphs): string {
  if (glyphs === 'half') return halfBlocks(bmp, columns, rows)
  const { across, down } = GLYPHS[glyphs]
  const words = new Uint32Array(columns * rows * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const cell = splitCell(cellPixels(bmp, x, y, across, down))
      words.set([quadrant(cell.mask), cell.fg, cell.bg], (y * columns + x) * 3)
    }
  }
  return base64(new Uint8Array(words.buffer))
}

/** Standard padded base64 of the bytes; a module has no Node Buffer. */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    const digit = (shift: number): string => B64[(word >> shift) & 63] ?? ''
    out += digit(18) + digit(12) + (b === undefined ? '=' : digit(6)) + (c === undefined ? '=' : digit(0))
  }
  return out
}
