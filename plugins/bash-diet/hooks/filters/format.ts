import { plural } from './blocks.ts'
import { CAP_LIST, capped, linesOf, type FilterResult, type FilterTable } from './common.ts'
import { cleanup } from './generic.ts'

/**
 * Code formatters: gofmt, rustfmt, cargo fmt and black. A check prints a diff of every change, whose fix
 * is to run the formatter; what the model needs is which files would change and by how much.
 */

type Report = { files: Map<string, { added: number; removed: number }>; order: string[]; current: string; kept: string[]; diff: boolean }

/** A diff's file: rustfmt's `Diff in /p/main.rs:1:`, or a unified diff's `+++ a.go` with black's tab and date cut. */
function diffFile(line: string): string | undefined {
  const rust = /^Diff in (.+?):\d+:$/.exec(line)
  if (rust !== null) return rust[1]
  const unified = /^\+\+\+ (.+?)(?:\t.*)?$/.exec(line)
  return unified === null ? undefined : unified[1]
}

/** Lines that frame a diff or only cheer: the old side's header, gofmt's `diff` line, a hunk head, black's emoji. */
const FRAME = /^(--- |diff |@@ )|^(All done!|Oh no!) /

function openFile(r: Report, file: string): void {
  r.diff = true
  r.current = file
  if (!r.files.has(file)) { r.files.set(file, { added: 0, removed: 0 }); r.order.push(file) }
}

function reportLine(r: Report, line: string): void {
  const file = diffFile(line)
  if (file !== undefined) { openFile(r, file); return }
  if (FRAME.test(line) || line.trim() === '') return
  const counts = r.files.get(r.current)
  if (counts !== undefined && /^[+-]/.test(line)) { if (line.startsWith('+')) counts.added += 1; else counts.removed += 1; return }
  if (counts !== undefined && line.startsWith(' ')) return
  r.kept.push(line)
}

/**
 * A formatter's output: each file of a diff as `path  +added -removed`, then every other line (a file
 * list of `-l`, black's `would reformat` rows and summary, a parse error) with the list capped.
 */
function formatter(tool: string) {
  return (input: { text: string }): FilterResult => {
    const r: Report = { files: new Map(), order: [], current: '', kept: [], diff: false }
    for (const line of linesOf(input.text)) reportLine(r, line)
    const kept = capped(r.kept, CAP_LIST, 'more')
    if (!r.diff) return { text: kept.lines.join('\n'), elided: kept.elided }
    const rows = capped(r.order.map(f => `  ${f}  +${r.files.get(f)?.added ?? 0} -${r.files.get(f)?.removed ?? 0}`), CAP_LIST, 'files')
    return { text: [`${tool}: ${plural(r.order.length, 'file')} not formatted`, ...rows.lines, ...kept.lines].join('\n'), elided: true }
  }
}

/** `gofmt` with no flag prints the formatted source itself, which the model asked for as it is. */
function gofmt(input: { args: string[]; text: string }): FilterResult {
  return input.args.some(a => /^-[a-z]*[ld]/.test(a)) ? formatter('gofmt')(input) : cleanup(input.text)
}

export const FORMAT: FilterTable = {
  gofmt: { run: gofmt },
  'go fmt': { run: formatter('go fmt') },
  rustfmt: { run: formatter('rustfmt') },
  'cargo fmt': { run: formatter('cargo fmt') },
  black: { run: formatter('black') },
}
