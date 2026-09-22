import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
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

/**
 * The output of a Bash result as the model reads it, or undefined for a result that carries none. An
 * answered call carries its two streams in `result`; a call that exited non-zero is an error result,
 * whose output is its `text`, the error as the model reads it (`result` is never the tool's record there).
 */
function streamsOf(r: ToolCallResult<'Bash'>): { stdout: string; stderr: string } | undefined {
  if (r.isError === true) return { stdout: r.text ?? (typeof r.result === 'string' ? r.result : ''), stderr: '' }
  const out = r.result as { stdout?: unknown; stderr?: unknown; backgroundTaskId?: unknown } | undefined
  if (out === undefined || out.backgroundTaskId !== undefined) return undefined
  const stdout = typeof out.stdout === 'string' ? out.stdout : ''
  const stderr = typeof out.stderr === 'string' ? out.stderr : ''
  return { stdout, stderr }
}

/** Measures one Bash result and answers the model's note, if it flooded the context. */
async function measure($: EngineInterface, state: State, command: string, r: ToolCallResult<'Bash'>): Promise<string | undefined> {
  const streams = streamsOf(r)
  if (streams === undefined) return undefined
  const chars = sizeOf(streams.stdout, streams.stderr)
  if (chars <= state.limitKb * KB) return undefined
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

  // A denied call has no output and is left alone. A failed one is measured, because a failing test run
  // exits non-zero and is the largest output of all; the note rides after the model's own error text,
  // which stays as it is.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (!state.enabled || r.deny !== undefined) return r
    const note = await measure($, state, e.command, r)
    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  })
}
