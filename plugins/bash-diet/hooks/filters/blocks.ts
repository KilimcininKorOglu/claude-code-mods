/**
 * Diagnostic blocks shared by the compilers and linters: a block starts at an `error` or `warning` line
 * and runs to the next blank line or the next start; errors show first, each kind up to its cap.
 */

export type Blocks = { errors: string[][]; warnings: string[][]; other: string[] }

/** Whether a line opens a block, and of which kind. */
export type StartOf = (line: string) => 'error' | 'warning' | undefined

/** Splits lines into error blocks, warning blocks, and the lines outside every block. */
export function blocksOf(lines: string[], startOf: StartOf): Blocks {
  const b: Blocks = { errors: [], warnings: [], other: [] }
  let open: string[] | undefined
  for (const line of lines) {
    const kind = startOf(line)
    if (kind !== undefined) {
      open = [line]
      ;(kind === 'error' ? b.errors : b.warnings).push(open)
    } else if (open !== undefined && line.trim() !== '') open.push(line)
    else {
      open = undefined
      if (line.trim() !== '') b.other.push(line)
    }
  }
  return b
}

/** The first `cap` blocks joined by a blank line, and a count of the rest. */
export function shownBlocks(blocks: string[][], cap: number, noun: string): { lines: string[]; elided: boolean } {
  const shown = blocks.slice(0, cap).flatMap((block, i) => (i === 0 ? block : ['', ...block]))
  if (blocks.length <= cap) return { lines: shown, elided: false }
  return { lines: [...shown, '', `… +${blocks.length - cap} more ${noun}`], elided: true }
}

export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
