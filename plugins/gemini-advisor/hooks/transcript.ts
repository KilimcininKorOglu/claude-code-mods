/** The conversation as Gemini reads it, cut to a character limit. */
import type { SessionMessage, ToolUseSummary } from 'claude-code'

/** The output of each tool call, by tool_use_id: its result block, else the call's own text. */
function outputs(messages: readonly SessionMessage[]): Map<string, { text: string; isError: boolean }> {
  const out = new Map<string, { text: string; isError: boolean }>()
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

function callLines(use: ToolUseSummary, output: { text: string; isError: boolean } | undefined, cap: number): string[] {
  const status = output?.isError === true ? 'error' : 'output'
  return [`  [call] ${use.tool} ${JSON.stringify(use.input) ?? '{}'}`, `  ${status}: ${clip(output?.text ?? '', cap)}`]
}

function render(messages: readonly SessionMessage[], byUse: ReadonlyMap<string, { text: string; isError: boolean }>, cap: number): string {
  const lines: string[] = []
  messages.forEach((m, i) => {
    lines.push(`#${i + 1} ${m.role}: ${m.text}`)
    for (const use of m.toolUses) lines.push(...callLines(use, byUse.get(use.tool_use_id), cap))
  })
  return lines.join('\n')
}

/** The longest output length that makes the transcript fit, found by bisection. */
function outputCap(fixed: number, lengths: readonly number[], max: number): number | undefined {
  const size = (cap: number): number => fixed + lengths.reduce((sum, n) => sum + Math.min(n, cap + 40), 0)
  if (size(0) > max) return undefined
  let low = 0
  let high = Math.max(0, ...lengths)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (size(mid) <= max) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * Every message in order, each tool call with its input and output. Over
 * `maxChars`, the longest outputs are cut to one common length; a
 * conversation over it without any output throws.
 */
export function renderTranscript(messages: readonly SessionMessage[], maxChars: number): string {
  const byUse = outputs(messages)
  const full = render(messages, byUse, Infinity)
  if (full.length <= maxChars) return full
  const lengths = messages.flatMap(m => m.toolUses.map(u => byUse.get(u.tool_use_id)?.text.length ?? 0))
  const fixed = full.length - lengths.reduce((a, b) => a + b, 0)
  const cap = outputCap(fixed, lengths, maxChars)
  if (cap === undefined) throw new Error(`the conversation is over ${maxChars} characters even without tool output`)
  return render(messages, byUse, cap)
}
