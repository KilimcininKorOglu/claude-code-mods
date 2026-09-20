import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { isSource, lineOf, logText, noteText, sectionKey, shownPath, sidebarLines, sqlLines } from './sql.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/**
 * The on/off setting read at session start, whether a read error was logged, and the directory the
 * session started in. A path is shown against that directory, not against `$.session.cwd()`, because
 * a Bash `cd` moves the session's directory and would then leave every path outside it written in full.
 */
type State = { enabled: boolean; reported: boolean; root?: string }

/** The file's text after the edit, or undefined when it cannot be read; the first failure is logged. */
async function fileText($: EngineInterface, state: State, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch (err) {
    if (!state.reported) $.ui.log(`line numbers were left out, the edited file was not read: ${err instanceof Error ? err.message : String(err)}`)
    state.reported = true
    return undefined
  }
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, key: string, places: string[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'sql-concat-watch', key: sectionKey(key), title: 'SQL built from strings', lines: sidebarLines(places), until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Adds the note to an edit whose new lines build SQL from strings. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  const lines = state.enabled && isSource(path) ? sqlLines(before, after) : []
  if (lines.length === 0) return r
  const shown = shownPath(path, state.root ?? (await $.session.cwd()))
  const text = before === '' ? after : await fileText($, state, path)
  const places = lines.map(l => {
    const n = text === undefined ? undefined : lineOf(text, l)
    return n === undefined ? shown : `${shown}:${n}`
  })
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, shown, places, logText(places))
  return { ...r, context: [...(r.context ?? []), noteText(places)] }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each edit is checked for SQL built from strings' : 'off: edits are not checked'
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, reported: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sql-concat-watch', description: 'SQL an edit builds from strings: status, on, off (sql-concat-watch)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.root = await $.session.cwd()
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'sql-concat-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
