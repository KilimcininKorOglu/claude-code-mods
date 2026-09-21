import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { denyText, doneLines, doneLog, envError, isCommit, isGuarded, isMissingTool, isNarrowable, jsonError, kindOf, logText, modeOf, noteText, openNote, pythonCode, pythonError, sectionKey, shownPath, sidebarLines, type Kind, type Mode } from './parse.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const CONSUMER = 'config-parse'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/**
 * The on/off setting, the mode, the files whose finding still stands (by the path shown, each with the
 * path on disk and its kind), whether the model is owed a note for them, the kinds this machine cannot
 * parse, and the directory the session started in. A path is shown against that directory, not against
 * `$.session.cwd()`, because a Bash `cd` moves the session's directory.
 */
type State = { enabled: boolean; mode: Mode; open: Map<string, { path: string; kind: Kind }>; owed: boolean; skipped: Set<Kind>; reported: boolean; root?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The file's text after the edit, or undefined when it cannot be read; the first failure is logged. */
async function fileText($: EngineInterface, state: State, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch (err) {
    if (!state.reported) $.ui.log(`the edited file was not read: ${errorText(err)}`)
    state.reported = true
    return undefined
  }
}

/** The parse error python found, or undefined when the file parses or this machine cannot parse the kind. */
async function pythonCheck($: EngineInterface, state: State, kind: 'yaml' | 'toml', path: string): Promise<string | undefined> {
  if (state.skipped.has(kind)) return undefined
  const r = await $.process.run(['python3', '-c', pythonCode(kind), path], { timeoutMs: 10_000 })
  if (r.exitCode === 0) return undefined
  if (!isMissingTool(r.stderr)) return pythonError(r.stderr)
  state.skipped.add(kind)
  $.ui.log(`${kind.toUpperCase()} files are not checked on this machine: ${pythonError(r.stderr)}`)
  return undefined
}

/** The parse error of one file, or undefined when it parses. */
async function checkFile($: EngineInterface, state: State, kind: Kind, path: string): Promise<string | undefined> {
  if (kind === 'yaml' || kind === 'toml') return pythonCheck($, state, kind, path)
  const text = await fileText($, state, path)
  if (text === undefined) return undefined
  return kind === 'json' ? jsonError(text) : envError(text)
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, shown: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(shown), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Says the file parses again, once, and drops the standing finding. */
async function closeOne($: EngineInterface, state: State, kind: Kind, shown: string): Promise<void> {
  state.open.delete(shown)
  try {
    await $.sidebar.clear({ consumer: CONSUMER, key: sectionKey(shown) })
  } catch {
    // The sidebar mod is not installed.
  }
  await toPerson($, shown, 'config parses again', doneLines(shown), doneLog(kind, shown))
}

/** Checks the file an edit touched, and adds the note when it no longer parses. */
async function afterEdit($: EngineInterface, state: State, path: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  const kind = state.enabled ? kindOf(path) : undefined
  if (kind === undefined) return r
  const shown = shownPath(path, state.root ?? (await $.session.cwd()))
  const error = await checkFile($, state, kind, path)
  if (error === undefined) {
    if (state.open.has(shown)) await closeOne($, state, kind, shown)
    return r
  }
  state.open.set(shown, { path, kind })
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, shown, 'config does not parse', sidebarLines(error), logText(kind, shown, error))
  return { ...r, context: [...(r.context ?? []), noteText(kind, shown, error)] }
}

/** Parses every open file again and closes the ones an edit fixed, so the gate never holds a stale finding. */
async function recheckOpen($: EngineInterface, state: State): Promise<void> {
  for (const [shown, { path, kind }] of [...state.open]) {
    const error = await checkFile($, state, kind, path)
    if (error === undefined) await closeOne($, state, kind, shown)
  }
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
async function scopeOf($: EngineInterface, state: State, command: string): Promise<string[]> {
  const all = [...state.open]
  if (!isCommit(command) || !isNarrowable(command)) return all.map(([shown]) => shown)
  const staged = await stagedPaths($, state)
  if (staged === undefined) return all.map(([shown]) => shown)
  return all.filter(([, open]) => staged.has(open.path)).map(([shown]) => shown)
}

async function setMode($: EngineInterface, state: State, arg: string): Promise<string> {
  const mode = modeOf(arg)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny'
    ? 'mode deny: git commit, push and merge stop while a file does not parse'
    : 'mode note: nothing is stopped, the finding reaches the model as a note'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const [first = '', second = ''] = args.trim().split(/\s+/)
  if (first === 'mode') return setMode($, state, second)
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each edited JSON, YAML, TOML and .env file is parsed' : 'off: edited files are not parsed'
  }
  if (word !== '') return USAGE
  const open = state.open.size === 0 ? 'no file is open' : `${[...state.open.keys()].join(' · ')} does not parse`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', open: new Map(), owed: false, skipped: new Set(), reported: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'config-parse', description: 'JSON, YAML, TOML and .env files an edit broke: status, on, off, mode note | deny (config-parse)', argumentHint: '[on | off | mode note | mode deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = modeOf(String(await $.store.get(MODE_KEY))) ?? 'note'
    state.root = await $.session.cwd()
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'config-parse' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, await next(e)))

  /*
   * The turn's end parses every open file again and owes the model a note for what is left, because a
   * finding it did not close would otherwise stand in the pane and reach it never again.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !state.enabled) return r
    await recheckOpen($, state)
    state.owed = state.open.size > 0
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    if (!state.owed || state.open.size === 0) return next(e)
    state.owed = false
    return next({ ...e, context: [...(e.context ?? []), openNote([...state.open.keys()])] })
  })

  /*
   * The gate: in deny mode a commit, push or merge waits until every open file parses again. A commit
   * answers for its own files alone, so an unrelated file's finding does not stop it.
   */
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!state.enabled || state.mode !== 'deny' || state.open.size === 0 || !isGuarded(e.command)) return next(e)
    await recheckOpen($, state)
    if (state.open.size === 0) return next(e)
    const scoped = await scopeOf($, state, e.command)
    if (scoped.length === 0) {
      $.ui.log(`${state.open.size} file(s) still do not parse, and this command holds none of them`)
      return next(e)
    }
    return { deny: denyText(scoped) }
  })
}
