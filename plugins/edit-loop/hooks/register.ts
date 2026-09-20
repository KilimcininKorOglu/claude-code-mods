import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { countEdit, logText, noteText, sectionKey, shownPath, THRESHOLD, WARN_THRESHOLD, type Counts } from './loop.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/**
 * The edit counts of the running turn, the on/off setting, and the directory the session started in.
 * A path is shown against that directory, not against `$.session.cwd()`, because a Bash `cd` moves
 * the session's directory and would then leave every path outside it written in full.
 */
type State = { counts: Counts; enabled: boolean; root?: string }

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, key: string, title: string, line: string, kind: 'warn' | 'error'): Promise<void> {
  try {
    const taken = await $.sidebar.set({
      consumer: 'edit-loop',
      key: sectionKey(key),
      title,
      lines: [{ text: line, kind }],
      until: 'stream',
    })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/**
 * Counts a finished edit. The third edit of one file warns the person in yellow, the fifth turns the
 * finding red and is the one the model reads; every other edit passes without a word.
 */
async function afterEdit($: EngineInterface, state: State, agentId: string | undefined, path: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  if (!state.enabled) return r
  const count = countEdit(state.counts, agentId, path)
  if (count !== WARN_THRESHOLD && count !== THRESHOLD) return r
  const shown = shownPath(path, state.root ?? (await $.session.cwd()))
  if (count === WARN_THRESHOLD) {
    await toPerson($, shown, 'edits piling up', logText(shown, count), 'warn')
    return r
  }
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, shown, 'edit loop', logText(shown), 'error')
  return { ...r, context: [...(r.context ?? []), noteText(shown)] }
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
    state.root = await $.session.cwd()
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
