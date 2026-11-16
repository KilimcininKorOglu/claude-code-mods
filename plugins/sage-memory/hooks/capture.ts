/**
 * Outcome capture: SAGE's opt-in memories of a failed Bash command (`error_pattern`) and of a
 * successful one (`tool_outcome`), at most 20 distinct commands an hour and each once an hour.
 * Pure code; `register.tsx` writes the memory.
 */
import { safeCommand } from './consolidate'
import { MAX_NOTE_CHARS, type RememberInput } from './shared/model'

export const HOUR_MS = 60 * 60 * 1000
const PER_HOUR = 20

/** The command's output as the model read it: stdout then stderr, or the result text. */
export function outputOf(result: unknown): string {
  if (typeof result === 'string') return result
  if (typeof result !== 'object' || result === null) return ''
  const { stdout, stderr } = result as { stdout?: unknown; stderr?: unknown }
  return [stdout, stderr].filter((part): part is string => typeof part === 'string' && part !== '').join('\n')
}

/** What a finished command teaches, or nothing for a command that carries a credential. */
export function captureOf(command: string, output: string, failed: boolean, sessionId: string): RememberInput | undefined {
  const shown = safeCommand(command)
  if (shown === undefined || shown.startsWith('[redacted')) return undefined
  const out = output.replace(/\s+/g, ' ').trim()
  const common = { scope: 'project' as const, persistence: 'long_lived' as const, anchors: [{ type: 'command' as const, command: shown }], sources: [{ type: 'command' as const, command: shown, sessionId }] }
  if (failed) return { ...common, text: within('Error pattern from Bash: ', out), kind: 'error_pattern', importance: 0.55, confidence: 0.6, tags: ['auto-capture', 'error_pattern', 'bash'] }
  return { ...common, text: within(`Successful Bash: \`${shown.slice(0, MAX_SHOWN)}\` → `, out), kind: 'tool_outcome', importance: 0.45, confidence: 0.7, tags: ['auto-capture', 'tool_outcome', 'bash'] }
}

/** The most characters of a command a captured text shows; the anchor keeps the whole command. */
const MAX_SHOWN = 120

/** The lead and as much of the output as fits in a memory. */
function within(lead: string, out: string): string {
  return lead + out.slice(0, MAX_NOTE_CHARS - lead.length)
}

/**
 * Whether a key may be written now: not written within the hour, and fewer than 20 keys written in
 * the hour. Drops the keys older than an hour from `written`.
 */
export function mayCapture(written: Map<string, number>, key: string, now: number): boolean {
  for (const [seen, at] of written) if (now - at >= HOUR_MS) written.delete(seen)
  return !written.has(key) && written.size < PER_HOUR
}
