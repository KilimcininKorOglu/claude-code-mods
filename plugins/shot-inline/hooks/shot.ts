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
  let h = 0x811c9dc5
  for (const ch of `${path}\0${mtimeMs}`) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return `${h.toString(16).padStart(8, '0')}.png`
}
