/** The mermaid blocks of a reply, their file names, and the box of cells a rendered picture is drawn in. */

/** The source of each closed ```mermaid block in `text`, in order; a block still streaming has no closing fence yet. */
export function mermaidBlocks(text: string): string[] {
  return [...text.matchAll(/^[ \t]*```mermaid[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)].map(m => (m[1] ?? '').trim()).filter(s => s !== '')
}

/** A file name for a block, FNV-1a 32 of its source, so the same block renders once. */
export function blockHash(source: string): string {
  let h = 0x811c9dc5
  for (const ch of source) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
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

/** The tallest diagram, in rows. */
export const MAX_ROWS = 30

/** Pixels per cell across; a cell is about twice as tall as it is wide. */
const PX_PER_COLUMN = 8

/** The box of cells that keeps the picture's shape, at most `maxColumns` wide and MAX_ROWS tall. */
export function cells(size: Size, maxColumns: number): { columns: number; rows: number } {
  const fit = Math.max(1, Math.min(maxColumns, Math.round(size.width / PX_PER_COLUMN)))
  const rows = Math.max(1, Math.round((fit * size.height) / size.width / 2))
  if (rows <= MAX_ROWS) return { columns: fit, rows }
  return { columns: Math.max(1, Math.round((MAX_ROWS * 2 * size.width) / size.height)), rows: MAX_ROWS }
}

/** The line of an mmdc failure worth showing: the first that names an error, else the first. */
export function failureLine(output: string): string {
  const lines = output.split('\n').map(l => l.trim()).filter(l => l !== '')
  return (lines.find(l => /error/i.test(l)) ?? lines[0] ?? 'no output').slice(0, 200)
}
