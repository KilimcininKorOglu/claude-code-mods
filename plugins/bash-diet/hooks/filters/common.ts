/**
 * What every filter shares: its input and result, and the small line tools the ecosystem files build on.
 * A filter is a pure function of the command's arguments and its output; it never runs anything.
 */

/** The output a filter reads: stdout and stderr as the model would have read them, and the exit code. */
export type FilterInput = {
  args: string[]
  /** stdout, then stderr after a newline when there is any: the text the model would have read. */
  text: string
  exitCode: number
}

/** The filtered text, and whether it left out something the full output file still holds. */
export type FilterResult = { text: string; elided: boolean }

/**
 * One entry of a filter table: the filter, and the flags it asks for (`--tb=short -q` for `pytest`), or
 * undefined when the arguments already choose a format the filter cannot read. A flag never switches a
 * tool to a larger format: a failed command's text reaches the hook cut at 10,000 characters.
 */
export type Filter = {
  run: (input: FilterInput) => FilterResult
  flags?: (args: string[]) => string[] | undefined
}

/** A table keyed by `tool sub` (`git status`) or by `tool` alone for every subcommand. */
export type FilterTable = Record<string, Filter>

/** How many list rows, errors and warnings a filter shows before it counts the rest. */
export const CAP_LIST = 20
export const CAP_INVENTORY = 50
export const CAP_ERRORS = 20
export const CAP_WARNINGS = 10

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

/** The index after an escape sequence that starts at `at`: CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL`), or two bytes. */
function sequenceEnd(text: string, at: number): number {
  const kind = text[at + 1]
  if (kind === '[') {
    let i = at + 2
    while (i < text.length && !/[@-~]/.test(text[i] ?? '')) i += 1
    return i + 1
  }
  if (kind === ']') {
    const bel = text.indexOf(BEL, at)
    const st = text.indexOf(`${ESC}\\`, at + 2)
    const ends = [bel < 0 ? Infinity : bel + 1, st < 0 ? Infinity : st + 2]
    return Math.min(text.length, ...ends)
  }
  return at + (kind === '(' || kind === ')' ? 3 : 2)
}

/** The text with every terminal escape sequence (colours, cursor moves, titles) removed. */
export function stripAnsi(text: string): string {
  if (!text.includes(ESC)) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    const esc = text.indexOf(ESC, i)
    if (esc < 0) { out += text.slice(i); break }
    out += text.slice(i, esc)
    i = sequenceEnd(text, esc)
  }
  return out
}

/**
 * A progress line redrawn with carriage returns keeps only what the terminal showed last: `10%\r50%\rdone`
 * is `done`.
 */
export function lastRedraw(line: string): string {
  const parts = line.split('\r').filter(p => p !== '')
  return parts[parts.length - 1] ?? ''
}

/** The text's lines, ANSI and carriage-return redraws gone, with no trailing empty line. */
export function linesOf(text: string): string[] {
  const lines = stripAnsi(text).split('\n').map(lastRedraw)
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()
  return lines
}

/** A line cut to `max` characters, with an ellipsis where it was cut. */
export function cutLine(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** The first `cap` items and a count of the rest, or all of them when they fit. */
export function capped(items: string[], cap: number, noun = 'more'): { lines: string[]; elided: boolean } {
  if (items.length <= cap) return { lines: items, elided: false }
  return { lines: [...items.slice(0, cap), `… +${items.length - cap} ${noun}`], elided: true }
}

/** Consecutive equal lines as one, with the count: `retrying (×12)`. Blank lines are left to `collapseBlanks`. */
export function collapseRepeats(lines: string[]): string[] {
  const out: string[] = []
  let count = 0
  for (let i = 0; i < lines.length; i += 1) {
    count += 1
    if (lines[i] === lines[i + 1] && (lines[i] ?? '').trim() !== '') continue
    out.push(count > 1 ? `${lines[i]} (×${count})` : (lines[i] ?? ''))
    count = 0
  }
  return out
}

/** Runs of blank lines as one blank line. */
export function collapseBlanks(lines: string[]): string[] {
  return lines.filter((l, i) => l.trim() !== '' || (i > 0 && (lines[i - 1] ?? '').trim() !== ''))
}

/** Whether any argument is one of `names` or starts with one of them followed by `=`. */
export function hasArg(args: string[], ...names: string[]): boolean {
  return args.some(a => names.some(n => a === n || a.startsWith(`${n}=`)))
}

/** A result that keeps every line, only joined. */
export function whole(lines: string[]): FilterResult {
  return { text: lines.join('\n'), elided: false }
}

/** The text for an output that is empty after filtering. */
export function orOk(lines: string[], ok: string): string {
  return lines.length === 0 ? ok : lines.join('\n')
}
