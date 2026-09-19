import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { countEdit, noteText, shownPath, type Counts } from './loop.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The edit counts of the running turn and the on/off setting read at session start. */
type State = { counts: Counts; enabled: boolean }

/** Counts a finished edit and adds the note to the edit that reaches the threshold. */
async function afterEdit($: EngineInterface, state: State, agentId: string | undefined, path: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  if (!state.enabled || !countEdit(state.counts, agentId, path)) return r
  const note = noteText(shownPath(path, await $.session.cwd()))
  return { ...r, context: [...(r.context ?? []), note] }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: the fifth edit of one file in a turn gets a note' : 'off: edits are not counted'
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { counts: new Map(), enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'edit-loop', description: 'A note at the fifth edit of one file in a turn: status, on, off (edit-loop)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    return r
  })

  // The engine prints the plugin name in front of command text, so the texts do not repeat it.
  on('command.run', { command: 'edit-loop' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.start', async (_, e, next) => {
    state.counts.clear()
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.agentId, e.file_path, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.agentId, e.file_path, await next(e)))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => afterEdit($, state, e.agentId, e.notebook_path, await next(e)))
}
