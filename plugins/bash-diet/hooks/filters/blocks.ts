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

/** `1 file`, `2 files`; `many` for a noun whose plural is not `noun + s` (`directories`, `matches`). */
export const plural = (n: number, noun: string, many = `${noun}s`): string => `${n} ${n === 1 ? noun : many}`

/** One linter finding: the file, the rule, and the message. */
export type Issue = { file: string; code: string; text: string }

/** How many rule lines a grouped report shows. */
const MAX_RULE_LINES = 40

/**
 * Linter findings grouped by rule, the most frequent first, each rule's files listed. The grouping drops
 * every finding's line and column, and every message after a rule's first, so it always elides and the
 * full output is kept.
 */
export function byRule(issues: Issue[], tool: string): { text: string; elided: boolean } {
  const groups = new Map<string, Issue[]>()
  for (const i of issues) groups.set(i.code, [...(groups.get(i.code) ?? []), i])
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length)
  const lines = sorted.flatMap(([code, list]) => {
    const files = [...new Set(list.map(i => i.file))]
    return [`${code} (${list.length}): ${list[0]?.text ?? ''}`, `  ${files.slice(0, 5).join(', ')}${files.length > 5 ? `, +${files.length - 5} files` : ''}`]
  })
  const cut = lines.length > MAX_RULE_LINES
  const shown = cut ? [...lines.slice(0, MAX_RULE_LINES), `… +${lines.length - MAX_RULE_LINES} more lines`] : lines
  return { text: [...shown, `${tool}: ${plural(issues.length, 'issue')} in ${plural(groups.size, 'rule')}`].join('\n'), elided: true }
}
