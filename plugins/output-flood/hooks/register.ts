import type { EngineInterface, Register } from 'claude-code'
import { DEFAULT_LIMIT_KB, limitOf, limitText, logText, noteText, sectionKey, shownCommand, sidebarLines, sizeOf, statusText } from './flood.ts'

const ENABLED_KEY = 'enabled'
const LIMIT_KEY = 'limit'

const USAGE = 'expects nothing (the status), on, off or limit <kb>'

/** The characters of one KB, as the limit counts them. */
const KB = 1024

/**
 * The on/off setting, the limit in KB, the commands already reported, so one repeat is quiet, and every
 * result over the limit, repeats included: how many and their size together, so the status counts the
 * same results it sizes.
 */
type State = { enabled: boolean; limitKb: number; noted: Set<string>; floods: number; total: number }

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line. The model's note is another channel and does not repeat this text.
 */
async function toPerson($: EngineInterface, command: string, chars: number, limit: number): Promise<void> {
  try {
    const taken = await $.sidebar.set({
      consumer: 'output-flood',
      key: sectionKey(shownCommand(command)),
      title: 'output over the limit',
      lines: sidebarLines(command, chars, limit),
      until: 'stream',
    })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(logText(command, chars, limit))
}

/** One call of a batch, as `classic.PostToolBatch` hands it. */
type BatchCall = { tool_name: string; tool_input: unknown; tool_response?: unknown }

/**
 * The size of a Bash result as the model reads it, or undefined for a backgrounded call. A result a
 * mod rewrote, and a failed one, arrive as the text the model reads; an untouched one as the tool's
 * record with its two streams.
 */
function sizeOfResponse(response: unknown): number | undefined {
  if (typeof response === 'string') return response.length
  if (typeof response !== 'object' || response === null) return undefined
  const out = response as { stdout?: unknown; stderr?: unknown; backgroundTaskId?: unknown }
  if (out.backgroundTaskId !== undefined) return undefined
  return sizeOf(typeof out.stdout === 'string' ? out.stdout : '', typeof out.stderr === 'string' ? out.stderr : '')
}

/** The command of a Bash call, or undefined for another tool's call. */
function bashCommand(call: BatchCall): string | undefined {
  if (call.tool_name !== 'Bash') return undefined
  const command = (call.tool_input as { command?: unknown } | undefined)?.command
  return typeof command === 'string' ? command : undefined
}

/** Measures one call of a batch and answers the model's note, if it flooded the context. */
async function measure($: EngineInterface, state: State, call: BatchCall): Promise<string | undefined> {
  const command = bashCommand(call)
  const chars = command === undefined ? undefined : sizeOfResponse(call.tool_response)
  if (command === undefined || chars === undefined || chars <= state.limitKb * KB) return undefined
  state.floods += 1
  state.total += chars
  const key = shownCommand(command)
  if (state.noted.has(key)) return undefined
  state.noted.add(key)
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, command, chars, state.limitKb)
  return noteText(command, chars, state.limitKb)
}

/** Writes the limit the person set; it holds across sessions, because it lives in $.store. */
async function setLimit($: EngineInterface, state: State, arg: string): Promise<string> {
  const limit = limitOf(arg)
  if (limit === undefined) return limitText(undefined)
  state.limitKb = limit
  await $.store.set(LIMIT_KEY, limit)
  return limitText(limit)
}

/** The stored limit, or the default when nothing is stored and when the stored value is not one. */
async function readLimit($: EngineInterface): Promise<number> {
  const stored = await $.store.get(LIMIT_KEY)
  return typeof stored === 'number' && limitOf(String(stored)) !== undefined ? stored : DEFAULT_LIMIT_KB
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const arg = args.trim()
  if (arg === 'on' || arg === 'off') {
    state.enabled = arg === 'on'
    await $.store.set(ENABLED_KEY, state.enabled)
    return state.enabled ? 'on: a Bash result over the limit is reported' : 'off: results are not measured'
  }
  if (arg.startsWith('limit')) return setLimit($, state, arg.slice(5).trim())
  if (arg !== '' && arg !== 'status') return USAGE
  return statusText(state.enabled, state.limitKb, state.floods, state.total)
}

export const register: Register = on => {
  const state: State = { enabled: true, limitKb: DEFAULT_LIMIT_KB, noted: new Set(), floods: 0, total: 0 }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.limitKb = await readLimit($)
    await $.command.register({
      name: 'output-flood',
      description: 'A Bash result over a size limit: status, on, off, limit <kb> (output-flood)',
      argumentHint: '[on | off | limit <kb>]',
      immediate: true,
    })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'output-flood' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // Measured after the whole batch, not in `tool.call`: there a mod loaded ahead of this one (bash-diet)
  // rewrites the result after it was measured, so the note named a size the model never read. Here every
  // result is what the model reads, whichever order the plugins load in. A failed run is measured too,
  // because a failing test run exits non-zero and is the largest output of all.
  on('classic.PostToolBatch', async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled) return r
    const notes: string[] = []
    for (const call of e.tool_calls) {
      const note = await measure($, state, call)
      if (note !== undefined) notes.push(note)
    }
    return notes.length === 0 ? r : { ...r, additionalContext: [...(r.additionalContext ?? []), ...notes] }
  })
}
