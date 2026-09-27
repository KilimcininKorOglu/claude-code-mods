import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'
import { callKey, CHANGING, denyText, errorOf, sectionKey, stoppedLines, UNWATCHED, type Failures, type Line } from './coach.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

type State = { failures: Failures; enabled: boolean }

/**
 * The line the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line. The model's deny is another channel.
 */
async function toPerson($: EngineInterface, key: string, lines: Line[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'tool-coach', key: sectionKey(key), title: 'repeat stopped', lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Whether a result is a success of a call that changes files or runs commands. */
const changedSomething = (tool: string, r: ToolCallResult): boolean => CHANGING.has(tool) && r.deny === undefined && r.isError !== true

/**
 * Runs one call. A watched call that failed before with the same input, while nothing has changed since,
 * is refused with the error it got; a watched call that fails is kept; a success that changes something
 * drops every record.
 */
async function coach($: EngineInterface, state: State, e: ToolCallInput, next: (e: ToolCallInput) => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const watched = !UNWATCHED.has(e.tool)
  const key = callKey(e as unknown as Record<string, unknown>)
  const failed = watched ? state.failures.get(key) : undefined
  // Only a call the mod would refuse or record reads the setting; every other call runs as it is.
  if (failed !== undefined && (await readSettings($, state))) {
    await toPerson($, e.tool, stoppedLines(e.tool), stoppedLines(e.tool)[0]?.text ?? '')
    return { deny: denyText(e.tool, failed) }
  }
  const r = await next(e)
  if (changedSomething(e.tool, r)) state.failures.clear()
  else if (watched && r.isError === true && (await readSettings($, state))) state.failures.set(key, errorOf(r.text))
  return r
}

/**
 * Reads the on/off setting from the store, which every window shares, so a change made in another
 * window applies here at the next hook that acts on it. Answers whether the mod is on.
 */
async function readSettings($: EngineInterface, state: State): Promise<boolean> {
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
  return state.enabled
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  await readSettings($, state)
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    state.failures.clear()
    return word === 'on' ? 'on: a failed call is not run again unchanged' : 'off: every call runs'
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { failures: new Map(), enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'tool-coach', description: 'Refuse a failed tool call repeated unchanged: status, on, off (tool-coach)', argumentHint: '[on | off]' })
    await readSettings($, state)
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'tool-coach' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // The person's own prompt may follow a change the mod cannot see (a file fixed by hand).
  on('turn.start', async (_, e, next) => {
    state.failures.clear()
    return next(e)
  })

  on('tool.call', async ($, e, next) => coach($, state, e, next))
}
