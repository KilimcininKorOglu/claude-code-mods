/**
 * Rebuilds the conversation from Gemini's decisions. A message the decisions
 * do not touch is returned as the same object, so it keeps the engine's handle.
 */
import type { SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'
import type { Action, Call } from './prune.ts'

/** The action for each tool_use_id; a call without one is kept. */
export function actionsByUse(calls: readonly Call[], decisions: ReadonlyMap<string, Action>): Map<string, Action> {
  const actions = new Map<string, Action>()
  for (const call of calls) {
    const action = decisions.get(call.id)
    if (!call.pinned && action !== undefined && action !== 'keep') actions.set(call.toolUseId, action)
  }
  return actions
}

/** The head of a result Gemini let go, and one line that says so. */
export function truncated(text: string, headChars: number): string {
  if (text.length <= headChars + 120) return text
  return `${text.slice(0, headChars)}\n[gemini-compact cut ${text.length - headChars} chars of this output after a compaction; run the tool again if you need it]`
}

/** `Bash(ls -la)`: the tool and the first string of its input, for the note that names a removed call. */
export function callLabel(use: ToolUseSummary): string {
  const first = Object.values(use.input).find((v): v is string => typeof v === 'string') ?? ''
  const arg = first.replace(/\s+/g, ' ').trim()
  return `${use.tool}(${arg.length > 60 ? `${arg.slice(0, 57)}...` : arg})`
}

/**
 * The line that replaces removed calls. Without it the model reads a reply
 * whose work is gone and takes the work as never done (measured on 2.1.277).
 */
export function removedNote(labels: readonly string[]): string {
  return `[gemini-compact removed ${labels.length} earlier tool call(s) and their output after a compaction; they ran: ${labels.join(', ')}]`
}

function withText(m: SessionMessage, text: string): SessionMessage {
  const built: SessionMessage = { role: m.role, text, toolUses: m.toolUses }
  if (m.toolResults !== undefined && m.toolResults.length > 0) built.toolResults = m.toolResults
  return built
}

function joinText(a: string, b: string): string {
  return a.trim() === '' ? b : `${a}\n\n${b}`
}

function editUses(m: SessionMessage, actions: ReadonlyMap<string, Action>, headChars: number): { uses: ToolUseSummary[]; removed: string[] } {
  const uses: ToolUseSummary[] = []
  const removed: string[] = []
  for (const use of m.toolUses) {
    const action = actions.get(use.tool_use_id)
    if (action === 'drop') removed.push(callLabel(use))
    else if (action === 'truncate' && use.text !== undefined) uses.push({ ...use, text: truncated(use.text, headChars) })
    else uses.push(use)
  }
  return { uses, removed }
}

function editResults(m: SessionMessage, actions: ReadonlyMap<string, Action>, headChars: number): ToolResultSummary[] {
  const results: ToolResultSummary[] = []
  for (const r of m.toolResults ?? []) {
    const action = actions.get(r.tool_use_id)
    if (action === 'truncate') results.push({ ...r, text: truncated(r.text, headChars) })
    else if (action !== 'drop') results.push(r)
  }
  return results
}

function touches(m: SessionMessage, actions: ReadonlyMap<string, Action>): boolean {
  return m.toolUses.some(u => actions.has(u.tool_use_id)) || (m.toolResults ?? []).some(r => actions.has(r.tool_use_id))
}

type Edited = { message: SessionMessage | undefined; removed: string[] }

/** One message after the decisions: undefined when nothing of it is left. */
function editMessage(m: SessionMessage, actions: ReadonlyMap<string, Action>, headChars: number): Edited {
  if (!touches(m, actions)) return { message: m, removed: [] }
  const { uses, removed } = editUses(m, actions, headChars)
  const results = editResults(m, actions, headChars)
  if (m.text.trim() === '' && uses.length === 0 && results.length === 0) return { message: undefined, removed }
  const built: SessionMessage = { role: m.role, text: m.text, toolUses: uses }
  if (results.length > 0) built.toolResults = results
  return { message: built, removed }
}

/** Puts the note on the last assistant message at or before `at`, or on the first after it. */
function placeNote(out: SessionMessage[], at: number, note: string): void {
  let target = -1
  for (let i = Math.min(at, out.length - 1); i >= 0 && target === -1; i--) if (out[i]?.role === 'assistant') target = i
  if (target === -1) target = out.findIndex(m => m.role === 'assistant')
  const m = out[target]
  if (m === undefined) return
  out[target] = withText(m, joinText(m.text, note))
}

/**
 * Applies the actions: `drop` removes a call with its result, `truncate` keeps
 * the call and the head of its result. A message left empty is removed, and the
 * calls removed from it are named in a note on the nearest assistant message.
 */
export function applyActions(messages: readonly SessionMessage[], actions: ReadonlyMap<string, Action>, headChars: number): SessionMessage[] {
  const out: SessionMessage[] = []
  const notes: { at: number; labels: string[] }[] = []
  for (const m of messages) {
    const { message, removed } = editMessage(m, actions, headChars)
    if (message !== undefined) out.push(message)
    if (removed.length > 0) notes.push({ at: out.length - 1, labels: removed })
  }
  for (const { at, labels } of notes) placeNote(out, at, removedNote(labels))
  return out
}

/** Characters of text, tool input and tool result the conversation holds. */
export function sizeOf(messages: readonly SessionMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += m.text.length
    for (const u of m.toolUses) total += (JSON.stringify(u.input) ?? '').length
    for (const r of m.toolResults ?? []) total += r.text.length
  }
  return total
}
