/**
 * The Bash calls of earlier sessions, read from their transcripts: which commands cost the most output
 * and have no filter (`discover`), and which failed commands the model corrected (`learn`).
 */

import { read } from './command.ts'
import { planFor } from './pipeline.ts'
import { classify } from './rules.ts'
import { parse } from './shell.ts'
import { fmtTokens, tokensOf } from './text.ts'

/** One Bash call of a transcript: the command, the text the model read, and how it ended. */
export type BashCall = { session: string; command: string; output: string; exitCode?: number }

/** A transcript read piece by piece: the calls found so far, the calls waiting for their result. */
export type Scanner = { session: string; rest: string; pending: Map<string, string>; calls: BashCall[]; bad: number }

export const scannerOf = (session: string): Scanner => ({ session, rest: '', pending: new Map(), calls: [], bad: 0 })

type Item = { type?: string; id?: string; name?: string; input?: { command?: unknown }; tool_use_id?: string; content?: unknown }

/** The text of a tool result: a string, or the text parts of a list. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(c => ((c as { type?: string }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : '')).join('\n')
}

/** A Bash call's id and command, from a `tool_use` item. */
function bashUse(item: Item): { id: string; command: string } | undefined {
  const command = item.input?.command
  if (item.type !== 'tool_use' || item.name !== 'Bash' || typeof command !== 'string' || item.id === undefined) return undefined
  return { id: item.id, command }
}

function takeItem(s: Scanner, item: Item): void {
  const use = bashUse(item)
  if (use !== undefined) {
    s.pending.set(use.id, use.command)
    return
  }
  const id = item.type === 'tool_result' ? item.tool_use_id : undefined
  const command = id === undefined ? undefined : s.pending.get(id)
  if (id === undefined || command === undefined) return
  s.pending.delete(id)
  const output = textOf(item.content)
  const exit = /^Exit code (\d+)\n/.exec(output)
  s.calls.push({ session: s.session, command, output, exitCode: exit === null ? undefined : Number(exit[1]) })
}

/**
 * Whether a line may hold a Bash call or the result of one: parsing every row of a long transcript
 * costs more than the hook's own time allows, and most rows are other tools' results.
 */
function mayHold(s: Scanner, line: string): boolean {
  if (line.includes('"tool_use"') && line.includes('"name":"Bash"')) return true
  if (!line.includes('"tool_result"') || s.pending.size === 0) return false
  return [...line.matchAll(/"tool_use_id":"([^"]+)"/g)].some(m => s.pending.has(m[1] ?? ''))
}

function takeLine(s: Scanner, line: string): void {
  if (!mayHold(s, line)) return
  let row: { message?: { content?: unknown } }
  try {
    row = JSON.parse(line) as typeof row
  } catch {
    s.bad += 1
    return
  }
  const content = row.message?.content
  if (Array.isArray(content)) for (const item of content) takeItem(s, item as Item)
}

/** Reads the next piece of a transcript; a line cut between pieces waits for the rest. */
export function scan(s: Scanner, text: string): void {
  const lines = (s.rest + text).split('\n')
  s.rest = lines.pop() ?? ''
  for (const line of lines) takeLine(s, line)
}

/** Reads what is left after the last piece. */
export function finish(s: Scanner): BashCall[] {
  if (s.rest.trim() !== '') takeLine(s, s.rest)
  s.rest = ''
  return s.calls
}

// ------------------------------------------------------------------------------------------- discover

type Tally = { calls: number; chars: number }

/** Where a call falls: its filter's family, or why no filter reads it. */
function kindOf(command: string): { group: 'filtered' | 'unfiltered' | 'chain' | 'raw' | 'opaque'; key: string } {
  const reading = read(command)
  if (reading.kind === 'raw' || reading.kind === 'opaque') return { group: reading.kind, key: reading.kind }
  const plan = planFor(command)
  if (reading.kind === 'mixed' || plan === undefined) return { group: 'chain', key: 'chain' }
  if (plan.family !== 'other') return { group: 'filtered', key: plan.family }
  const c = classify(reading.target.words)
  return { group: 'unfiltered', key: c === undefined || c.sub === '' ? (c?.tool ?? 'other') : `${c.tool} ${c.sub}` }
}

function add(map: Map<string, Tally>, key: string, chars: number): void {
  const t = map.get(key) ?? { calls: 0, chars: 0 }
  map.set(key, { calls: t.calls + 1, chars: t.chars + chars })
}

/** The top rows of a group, the most output first. */
function rows(map: Map<string, Tally>, limit = 10): string[] {
  const sorted = [...map].sort((a, b) => b[1].chars - a[1].chars).slice(0, limit)
  const width = Math.max(0, ...sorted.map(([k]) => k.length))
  return sorted.map(([k, t]) => `  ${k.padEnd(width)}  ${t.calls} call${t.calls === 1 ? '' : 's'}  ~${fmtTokens(tokensOf(t.chars))} tokens`)
}

/** `/bash-diet discover`: the output the model read, by command, and the commands no filter reads. */
export function discoverText(calls: BashCall[], sessions: number, days: number): string {
  if (calls.length === 0) return `no Bash call in ${sessions} session(s) of the last ${days} days`
  const groups = new Map<string, Map<string, Tally>>()
  for (const c of calls) {
    const k = kindOf(c.command)
    const map = groups.get(k.group) ?? new Map<string, Tally>()
    add(map, k.key, c.output.length)
    groups.set(k.group, map)
  }
  const total = calls.reduce((n, c) => n + c.output.length, 0)
  const section = (group: string, title: string): string[] => (groups.has(group) ? [title, ...rows(groups.get(group) ?? new Map())] : [])
  return [
    `${calls.length} Bash calls in ${sessions} session(s) of the last ${days} days; the model read ~${fmtTokens(tokensOf(total))} tokens of their output`,
    ...section('unfiltered', 'no filter reads these (a rule in .bash-diet/filters.json can):'),
    ...section('filtered', 'a filter reads these:'),
    ...section('chain', 'chains of several commands (the generic cleanup reads them):'),
    ...section('opaque', 'left alone (substitution, heredoc or a redirect to a file):'),
    ...section('raw', `left raw on purpose (BASH_DIET_RAW=1):`),
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------- learn

/** A failed command and the form that worked after it. */
export type Correction = { wrong: string; right: string; kind: string; count: number }

/**
 * The mistake kinds a correction is kept for, by the error text of the failed call. A wrong path is not
 * one of them: its fix depends on the working directory of that moment, not on how the tool is used.
 */
const MISTAKES: [kind: string, pattern: RegExp][] = [
  ['unknown flag', /unknown (option|flag|argument)|unrecognized (option|arguments?)|invalid (option|argument)|unexpected argument|no such option/i],
  ['command not found', /command not found|: not found$/im],
  ['missing argument', /missing (required )?(argument|operand)|requires (a|an) (argument|value)|arguments are required|^usage: /im],
  ['wrong syntax', /syntax error|parse error|unexpected token/i],
]

/** A command that may carry a credential is never written down. */
const SECRET = /token|secret|password|passwd|api[_-]?key|authorization|bearer /i

/** How many calls after a failure the correction may come. */
const LOOKAHEAD = 3

const wordsOf = (command: string): string[] => command.trim().split(/\s+/)

/** The share of words two commands have in common. */
function likeness(a: string, b: string): number {
  const wa = new Set(wordsOf(a))
  const wb = new Set(wordsOf(b))
  const shared = [...wa].filter(w => wb.has(w)).length
  return shared / Math.max(wa.size, wb.size)
}

/** Whether a command is one command alone: an error of a chain or a pipeline cannot be tied to one part. */
function alone(command: string): boolean {
  const { segments, opaque } = parse(command)
  return !opaque && segments.length === 1 && segments[0]?.stages.length === 1
}

const usable = (c: BashCall): boolean => !c.command.includes('\n') && c.command.length <= 200 && !SECRET.test(c.command) && alone(c.command)

/** The call after a failure that fixed it: the same tool, most words shared, and it succeeded. */
function fixOf(calls: BashCall[], at: number): BashCall | undefined {
  const failed = calls[at] as BashCall
  return calls.slice(at + 1, at + 1 + LOOKAHEAD).find(c =>
    c.session === failed.session && c.exitCode === undefined && usable(c) && c.command !== failed.command &&
    wordsOf(c.command)[0] === wordsOf(failed.command)[0] && likeness(c.command, failed.command) >= 0.5)
}

/** The corrections in the calls, the most frequent first. */
export function correctionsOf(calls: BashCall[]): Correction[] {
  const found = new Map<string, Correction>()
  calls.forEach((c, i) => {
    if (c.exitCode === undefined || !usable(c)) return
    const kind = MISTAKES.find(([, p]) => p.test(c.output))?.[0]
    const fix = kind === undefined ? undefined : fixOf(calls, i)
    if (kind === undefined || fix === undefined) return
    const key = `${c.command}\0${fix.command}`
    const seen = found.get(key)
    found.set(key, { wrong: c.command, right: fix.command, kind, count: (seen?.count ?? 0) + 1 })
  })
  return [...found.values()].sort((a, b) => b.count - a.count)
}

const line = (c: Correction): string => `- \`${c.wrong}\` failed (${c.kind}); \`${c.right}\` worked${c.count > 1 ? ` (${c.count} times)` : ''}.`

/** `/bash-diet learn`: the corrections found, or that there are none. */
export function learnText(corrections: Correction[], sessions: number, days: number): string {
  if (corrections.length === 0) return `no corrected command in ${sessions} session(s) of the last ${days} days`
  return [`${corrections.length} corrected command(s) in ${sessions} session(s) of the last ${days} days:`, ...corrections.slice(0, 20).map(line)].join('\n')
}

/** The rules file `/bash-diet learn write` writes for the model to read in later sessions. */
export function learnFile(corrections: Correction[]): string {
  return [
    '# CLI corrections',
    '',
    'Commands that failed in earlier sessions of this project, and the form that worked after them. Use the form that worked.',
    '',
    ...corrections.slice(0, 50).map(line),
    '',
  ].join('\n')
}
