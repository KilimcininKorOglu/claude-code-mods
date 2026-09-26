/** The conversation as a council member reads it, cut to a character limit. */
import type { SessionMessage, ToolUseSummary } from 'claude-code'

type Output = { text: string; isError: boolean }

/** The output of each tool call, by tool_use_id: its result block, else the call's own text. */
function outputs(messages: readonly SessionMessage[]): Map<string, Output> {
  const out = new Map<string, Output>()
  for (const m of messages) {
    for (const use of m.toolUses) out.set(use.tool_use_id, { text: use.text ?? '', isError: use.isError === true })
  }
  for (const m of messages) {
    for (const r of m.toolResults ?? []) out.set(r.tool_use_id, { text: r.text, isError: r.isError })
  }
  return out
}

/** Cuts a text to about `max` characters: its head and its tail around one note. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.max(0, Math.floor(max / 2))
  return `${text.slice(0, half)}\n[… ${text.length - 2 * half} chars omitted …]\n${text.slice(text.length - half)}`
}

function callLines(use: ToolUseSummary, output: Output | undefined, cap: number): string[] {
  const status = output?.isError === true ? 'error' : 'output'
  return [`  [call] ${use.tool} ${JSON.stringify(use.input) ?? '{}'}`, `  ${status}: ${clip(output?.text ?? '', cap)}`]
}

/** One message's lines, numbered by its place in the whole conversation. */
function messageText(m: SessionMessage, n: number, byUse: ReadonlyMap<string, Output>, cap: number): string {
  return [`#${n} ${m.role}: ${m.text}`, ...m.toolUses.flatMap(use => callLines(use, byUse.get(use.tool_use_id), cap))].join('\n')
}

function render(messages: readonly SessionMessage[], first: number, byUse: ReadonlyMap<string, Output>, cap: number): string {
  return messages.map((m, i) => messageText(m, first + i + 1, byUse, cap)).join('\n')
}

/** The output lengths of one message's calls. */
function outputLengths(m: SessionMessage, byUse: ReadonlyMap<string, Output>): number[] {
  return m.toolUses.map(u => byUse.get(u.tool_use_id)?.text.length ?? 0)
}

/** The size of a message with every output cut to `cap`, as `clip` cuts it (the note is about 40 characters). */
function sizeAt(fixed: number, lengths: readonly number[], cap: number): number {
  return fixed + lengths.reduce((sum, n) => sum + Math.min(n, cap + 40), 0)
}

/** The longest output length that makes the messages fit, found by bisection; undefined when none does. */
function outputCap(fixed: number, lengths: readonly number[], max: number): number | undefined {
  if (sizeAt(fixed, lengths, 0) > max) return undefined
  let low = 0
  let high = Math.max(0, ...lengths)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (sizeAt(fixed, lengths, mid) <= max) low = mid
    else high = mid - 1
  }
  return low
}

type Sized = { fixed: number; lengths: number[] }

/** Each message's length without its outputs, and its outputs' lengths. */
function sizes(messages: readonly SessionMessage[], byUse: ReadonlyMap<string, Output>): Sized[] {
  return messages.map((m, i) => {
    const lengths = outputLengths(m, byUse)
    const full = messageText(m, i + 1, byUse, Infinity).length + 1
    return { fixed: full - lengths.reduce((a, b) => a + b, 0), lengths }
  })
}

/** How many of the oldest messages to leave out, so the rest fits with every output cut to its shortest. */
function dropped(sized: readonly Sized[], max: number): number {
  let total = sized.reduce((sum, s) => sum + sizeAt(s.fixed, s.lengths, 0), 0)
  let first = 0
  while (first < sized.length - 1 && total > max) {
    total -= sizeAt(sized[first]?.fixed ?? 0, sized[first]?.lengths ?? [], 0)
    first++
  }
  return first
}

/**
 * Every message in order, each tool call with its input and output. Over `maxChars`, the longest outputs
 * are cut to one common length; when the conversation is over it even without output, the oldest
 * messages are left out and a first line says how many, and a last message alone over it is cut.
 */
export function renderTranscript(messages: readonly SessionMessage[], maxChars: number): string {
  const byUse = outputs(messages)
  const full = render(messages, 0, byUse, Infinity)
  if (full.length <= maxChars) return full
  const sized = sizes(messages, byUse)
  const first = dropped(sized, maxChars - 60)
  const note = first === 0 ? '' : `[the first ${first} messages are left out]\n`
  const kept = sized.slice(first)
  const fixed = kept.reduce((sum, s) => sum + s.fixed, 0)
  const cap = outputCap(fixed, kept.flatMap(s => s.lengths), maxChars - note.length)
  return clip(`${note}${render(messages.slice(first), first, byUse, cap ?? 0)}`, maxChars)
}
