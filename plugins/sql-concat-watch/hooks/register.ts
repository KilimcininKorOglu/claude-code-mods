import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { denyText, doneLines, doneLog, isGuarded, isSource, lineOf, logText, modeOf, noteText, openPlaces, sectionKey, shownPath, sidebarLines, sqlLines, type Mode } from './sql.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** One file's open finding: the file on disk, the lines that build SQL, and the places they were reported at. */
type Finding = { path: string; lines: string[]; places: string[] }

/**
 * The on/off setting read at session start, the mode, whether a read error was logged, the open findings
 * by shown path, and the directory the session started in. A path is shown against that directory, not
 * against `$.session.cwd()`, because a Bash `cd` moves the session's directory and would then leave every
 * path outside it written in full.
 */
type State = { enabled: boolean; mode: Mode; reported: boolean; open: Map<string, Finding>; root?: string }

/** Whether the file is no longer there, so a finding of it closes instead of standing for good. */
async function isGone($: EngineInterface, path: string): Promise<boolean> {
  try {
    return !(await $.fs.exists(path))
  } catch {
    // The path was not measured: the finding is left as it stands.
    return false
  }
}

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
async function toPerson($: EngineInterface, key: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'sql-concat-watch', key: sectionKey(key), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a file that no longer builds SQL leaves no warning behind. */
async function dropEntry($: EngineInterface, key: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'sql-concat-watch', key: sectionKey(key) })
  } catch {
    // The sidebar mod is not installed.
  }
}

/**
 * Reads each open file again and closes the findings whose lines are gone; an unreadable file stays open.
 * `skip` is the file this edit just measured, so the mod does not read it a second time.
 */
async function closeResolved($: EngineInterface, state: State, skip?: string): Promise<void> {
  for (const [shown, found] of [...state.open]) {
    if (shown === skip) continue
    // A file that is gone holds no line any more; one that is there and unreadable proves nothing.
    const text = (await isGone($, found.path)) ? '' : await fileText($, state, found.path)
    if (text === undefined || found.lines.some(l => text.includes(l))) continue
    state.open.delete(shown)
    await dropEntry($, shown)
    await toPerson($, shown, 'SQL parameters used', doneLines(shown, found.places), doneLog(shown, found.places))
  }
}

/** The note of one edit and the file it named, and the finding it opens; undefined when the edit builds no SQL. */
async function noteFor($: EngineInterface, state: State, path: string, before: string, after: string): Promise<{ note: string; shown: string } | undefined> {
  const lines = sqlLines(before, after)
  if (lines.length === 0) return undefined
  const shown = shownPath(path, state.root ?? (await $.session.cwd()))
  const text = before === '' ? after : await fileText($, state, path)
  const places = lines.map(l => {
    const n = text === undefined ? undefined : lineOf(text, l)
    return n === undefined ? shown : `${shown}:${n}`
  })
  const held = state.open.get(shown)
  state.open.set(shown, { path, lines: openPlaces(held?.lines, lines), places: openPlaces(held?.places, places) })
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, shown, 'SQL built from strings', sidebarLines(places), logText(places))
  return { note: noteText(places), shown }
}

/** Adds the note to an edit whose new lines build SQL from strings, and closes what a later edit fixed. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true || !state.enabled) return r
  const found = isSource(path) ? await noteFor($, state, path, before, after) : undefined
  await closeResolved($, state, found?.shown)
  return found === undefined ? r : { ...r, context: [...(r.context ?? []), found.note] }
}

/**
 * The gate of the `deny` mode: it reads each open file again, so a file the model fixed without a new
 * finding opens the gate too. A file that still builds SQL from strings stops the command, with no bypass.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (!state.enabled || state.mode !== 'deny' || state.open.size === 0 || !isGuarded(command)) return undefined
  await closeResolved($, state)
  if (state.open.size === 0) return undefined
  return denyText([...state.open.values()].flatMap(f => f.places))
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  const mode = modeOf(word)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny' ? 'mode deny: git commit, push and merge stop while a file builds SQL from strings' : 'mode note: the places are only reported'
}

function statusText(state: State): string {
  const open = state.open.size === 0 ? 'no file is open' : `${state.open.size} file(s) still build SQL from strings`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each edit is checked for SQL built from strings' : 'off: edits are not checked'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  return word === '' ? statusText(state) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', reported: false, open: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sql-concat-watch', description: 'SQL an edit builds from strings: status, on, off, mode (sql-concat-watch)', argumentHint: '[on | off | mode note | deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    state.root = await $.session.cwd()
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'sql-concat-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stop = await gate($, state, e.command)
    return stop === undefined ? next(e) : { deny: stop }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
