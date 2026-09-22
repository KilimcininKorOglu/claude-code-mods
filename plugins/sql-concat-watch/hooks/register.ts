import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { denyText, doneLines, doneLog, isCommit, isGuarded, isNarrowable, isSource, lineOf, logText, modeOf, noteText, openNote, openPlaces, sectionKey, shownPath, sidebarLines, sqlLines, type Mode } from './sql.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** One file's open finding: the file on disk, the lines that build SQL, and the places they were reported at. */
type Finding = { path: string; lines: string[]; places: string[] }

/**
 * The on/off setting read at session start, the mode, whether a read error was logged, the open findings
 * by shown path, whether the model is owed a note for them, and the root read once at the session's start
 * (`shownRootOf`). A path is shown against that root, not against `$.session.cwd()`, because a Bash `cd`
 * moves the session's directory and would then leave every path outside it written in full.
 */
type State = { enabled: boolean; mode: Mode; reported: boolean; open: Map<string, Finding>; owed: boolean; root?: string }

/**
 * The git repository the session started in, so a file in a sibling directory of a session opened in a
 * subdirectory still reads short; the session's own directory where git does not answer.
 */
async function shownRootOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    const root = top.stdout.trim()
    return top.exitCode === 0 && root !== '' ? root : cwd
  } catch {
    // No git here, or the command did not run: paths are shown against the session's directory.
    return cwd
  }
}

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
 * The files this commit holds, by absolute path, or undefined when git did not answer. Read before the
 * command runs, so it is the index as the commit will take it.
 */
async function stagedPaths($: EngineInterface, state: State): Promise<Set<string> | undefined> {
  try {
    const cwd = state.root ?? (await $.session.cwd())
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    const staged = await $.process.run(['git', 'diff', '--cached', '--name-only', '-z'], { cwd })
    if (top.exitCode !== 0 || staged.exitCode !== 0) return undefined
    const base = top.stdout.trim()
    return new Set(staged.stdout.split('\0').filter(Boolean).map(p => `${base}/${p}`))
  } catch {
    // No git here, or the command did not run: the findings are not narrowed.
    return undefined
  }
}

/**
 * The findings this command answers for. A `git commit` answers for its own files alone, so a finding of
 * a file the commit does not hold lets it run. A `push` or a `merge` holds no index to read, so every
 * finding stands there.
 */
async function scopeOf($: EngineInterface, state: State, command: string): Promise<Finding[]> {
  const all = [...state.open.values()]
  if (!isCommit(command) || !isNarrowable(command)) return all
  const staged = await stagedPaths($, state)
  return staged === undefined ? all : all.filter(f => staged.has(f.path))
}

/**
 * The gate of the `deny` mode: it reads each open file again, so a file the model fixed without a new
 * finding opens the gate too. A file this command holds that still builds SQL from strings stops it, and
 * there is no bypass.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (!state.enabled || state.mode !== 'deny' || state.open.size === 0 || !isGuarded(command)) return undefined
  await closeResolved($, state)
  if (state.open.size === 0) return undefined
  const scoped = await scopeOf($, state, command)
  if (scoped.length === 0) {
    $.ui.log(`${state.open.size} file(s) still build SQL from strings, and this command holds none of them`)
    return undefined
  }
  return denyText(scoped.flatMap(f => f.places))
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
  const state: State = { enabled: true, mode: 'note', reported: false, open: new Map(), owed: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sql-concat-watch', description: 'SQL an edit builds from strings: status, on, off, mode (sql-concat-watch)', argumentHint: '[on | off | mode note | deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    state.root = await shownRootOf($, await $.session.cwd())
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'sql-concat-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  /*
   * The turn's end reads every open file again and owes the model a note for what is left, because a
   * finding it did not close would otherwise stand in the pane and reach it never again.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !state.enabled) return r
    await closeResolved($, state)
    state.owed = state.open.size > 0
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    if (!state.owed || state.open.size === 0) return next(e)
    state.owed = false
    const note = openNote([...state.open.values()].flatMap(f => f.places))
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stop = await gate($, state, e.command)
    return stop === undefined ? next(e) : { deny: stop }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
