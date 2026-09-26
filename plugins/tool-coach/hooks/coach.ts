/** The failed tool calls a loop may not repeat as they were, and the texts the model and the person read. */

/**
 * Bash is not watched: a command that failed runs again for good reasons (a test after a fix, a server
 * that was not up yet), and the person chose to leave it free.
 */
export const UNWATCHED = new Set(['Bash'])

/**
 * A successful call of one of these changed a file or ran a command, so a call that failed before it may
 * not fail again: every record is dropped.
 */
export const CHANGING = new Set(['Edit', 'Write', 'NotebookEdit', 'Bash'])

/** The keys of the call envelope that are not the tool's input, and `description`, which only labels it. */
const NOT_INPUT = new Set(['tool', 'tool_use_id', 'agentId', 'consent', 'description'])

/** How much of the error the model is shown again. */
const MAX_ERROR_CHARS = 300

/** The failed calls, keyed by loop and input, each with the error it got. */
export type Failures = Map<string, string>

/** A value with its object keys sorted, so two inputs that differ only in key order are one call. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([k, v]) => [k, sorted(v)]))
}

/** The key of one call: its loop (the main loop or a subagent), its tool, and its input. */
export function callKey(call: Record<string, unknown>): string {
  const input = Object.fromEntries(Object.entries(call).filter(([k]) => !NOT_INPUT.has(k)))
  return JSON.stringify([call.agentId ?? 'main', call.tool, sorted(input)])
}

/** The error as the model read it, without the engine's tags, cut to a length a deny can carry. */
export function errorOf(text: string | undefined): string {
  const bare = (text ?? '').replace(/<\/?tool_use_error>/g, '').trim()
  const one = bare === '' ? 'no error text' : bare
  return one.length > MAX_ERROR_CHARS ? `${one.slice(0, MAX_ERROR_CHARS)}…` : one
}

/** What the model reads instead of the repeated call's result. The engine names the mod in front of it. */
export function denyText(tool: string, error: string): string {
  return `this exact ${tool} call failed a moment ago, and no file or command has changed anything since, so it would fail the same way. Its error was:\n${error}\nRead the error, change the input, and call again.`
}

/** How the sidebar colours a line or a part of one. */
type Tone = 'ok' | 'warn' | 'error' | 'dim'
export type Part = { text: string; kind?: Tone }
/** A sidebar line; `parts` colour pieces of it, and `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Tone; parts?: Part[] }

/** The person's line: the tool in red, the rest faint. The same text is the transcript line. */
export function stoppedLines(tool: string): Line[] {
  const parts: Part[] = [{ text: tool, kind: 'error' }, { text: ' call repeated after it failed, not run', kind: 'dim' }]
  return [{ text: parts.map(p => p.text).join(''), parts }]
}

/** A sidebar section key: the subject cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64) || 'note'
}
