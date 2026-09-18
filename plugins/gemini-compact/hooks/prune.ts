/**
 * The pure part of gemini-compact: which tool calls Gemini decides on, the
 * transcript it reads, its answer, and the conversation rebuilt from it.
 */
import type { SessionMessage, ToolUseSummary } from 'claude-code'

export type Action = 'keep' | 'truncate' | 'drop'

export const ACTIONS: readonly Action[] = ['keep', 'truncate', 'drop']

/** One tool call with its result. Only a call that is not pinned gets a decision. */
export type Call = {
  /** The short id Gemini answers with (`c1`), or '' for a pinned call. */
  id: string
  toolUseId: string
  tool: string
  input: Record<string, unknown>
  output: string
  isError: boolean
  pinned: boolean
}

function outputOf(messages: readonly SessionMessage[], use: ToolUseSummary): string {
  for (const m of messages) {
    const result = m.toolResults?.find(r => r.tool_use_id === use.tool_use_id)
    if (result !== undefined) return result.text
  }
  return use.text ?? ''
}

/** The index of the message that holds each tool result, by tool_use_id. */
function resultIndex(messages: readonly SessionMessage[]): Map<string, number> {
  const at = new Map<string, number>()
  messages.forEach((m, i) => {
    for (const r of m.toolResults ?? []) at.set(r.tool_use_id, i)
  })
  return at
}

/**
 * Pairs every tool call with its result. A call in the first message or in the
 * newest `keepRecent` messages, or whose result is in one of them, is pinned.
 */
export function collectCalls(messages: readonly SessionMessage[], keepRecent: number): Call[] {
  const firstRecent = messages.length - Math.max(0, keepRecent)
  const isPinned = (i: number): boolean => i === 0 || i >= firstRecent
  const results = resultIndex(messages)
  const calls: Call[] = []
  let next = 1
  messages.forEach((m, i) => {
    for (const use of m.toolUses) {
      const pinned = isPinned(i) || isPinned(results.get(use.tool_use_id) ?? i)
      const id = pinned ? '' : `c${next++}`
      const output = outputOf(messages, use)
      calls.push({ id, toolUseId: use.tool_use_id, tool: use.tool, input: use.input, output, isError: use.isError === true, pinned })
    }
  })
  return calls
}

function inputText(input: Record<string, unknown>): string {
  return JSON.stringify(input) ?? '{}'
}

/** Cuts a text to about `max` characters: its head and its tail around one note. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.max(0, Math.floor(max / 2))
  return `${text.slice(0, half)}\n[… ${text.length - 2 * half} chars omitted …]\n${text.slice(text.length - half)}`
}

/** The longest output length that makes the transcript fit, found by bisection. */
function outputCap(fixed: number, outputs: readonly number[], max: number): number | undefined {
  const size = (cap: number): number => fixed + outputs.reduce((sum, n) => sum + Math.min(n, cap + 40), 0)
  if (size(0) > max) return undefined
  let low = 0
  let high = Math.max(0, ...outputs)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (size(mid) <= max) low = mid
    else high = mid - 1
  }
  return low
}

function callLines(call: Call, cap: number): string[] {
  const label = call.pinned ? '[fixed]' : `[${call.id}]`
  const status = call.isError ? 'error' : 'output'
  return [`  ${label} ${call.tool} ${inputText(call.input)}`, `  ${status}: ${clip(call.output, cap)}`]
}

function render(messages: readonly SessionMessage[], byUse: ReadonlyMap<string, Call>, cap: number): string {
  const lines: string[] = []
  messages.forEach((m, i) => {
    lines.push(`#${i + 1} ${m.role}: ${m.text}`)
    for (const use of m.toolUses) {
      const call = byUse.get(use.tool_use_id)
      if (call !== undefined) lines.push(...callLines(call, cap))
    }
  })
  return lines.join('\n')
}

/**
 * The conversation as Gemini reads it: every message in order, each call with
 * its id, input and output. When it is over `maxChars`, the longest outputs
 * are cut to one common length; a conversation over it without any output throws.
 */
export function renderTranscript(messages: readonly SessionMessage[], calls: readonly Call[], maxChars: number): string {
  const byUse = new Map(calls.map(c => [c.toolUseId, c]))
  const full = render(messages, byUse, Infinity)
  if (full.length <= maxChars) return full
  const outputs = calls.map(c => c.output.length)
  const fixed = full.length - outputs.reduce((a, b) => a + b, 0)
  const cap = outputCap(fixed, outputs, maxChars)
  if (cap === undefined) throw new Error(`the conversation is over ${maxChars} characters even without tool output`)
  return render(messages, byUse, cap)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decisionOf(value: unknown): [string, Action] | string {
  if (!isRecord(value) || typeof value.id !== 'string') return 'a decision has no id'
  const action = ACTIONS.find(a => a === value.action)
  return action === undefined ? `${value.id}: unknown action ${JSON.stringify(value.action)}` : [value.id, action]
}

/** Reads Gemini's answer: exactly one known action for every candidate id, nothing else. */
export function parseDecisions(text: string, ids: readonly string[]): Map<string, Action> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('the answer is not JSON')
  }
  if (!isRecord(value) || !Array.isArray(value.decisions)) throw new Error('the answer has no decisions list')
  const known = new Set(ids)
  const decisions = new Map<string, Action>()
  for (const raw of value.decisions) {
    const d = decisionOf(raw)
    if (typeof d === 'string') throw new Error(d)
    if (!known.has(d[0])) throw new Error(`unknown call id ${d[0]}`)
    if (decisions.has(d[0])) throw new Error(`call ${d[0]} decided twice`)
    decisions.set(d[0], d[1])
  }
  const missing = ids.filter(id => !decisions.has(id))
  if (missing.length > 0) throw new Error(`no decision for ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`)
  return decisions
}
