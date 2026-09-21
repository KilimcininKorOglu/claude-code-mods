import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { callKeys, isSource, keyLines, newKeys } from './keys.ts'
import { addFile, denyText, doneLines, doneLog, doneTitle, isCommit, isGuarded, isLocalePath, isNarrowable, LOCALE_DIRS, LOCALE_EXT, logText, modeOf, noteText, openNote, sectionKey, shownPath, sidebarLines, verdict, type Catalog, type Lines, type Mode } from './locale.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** Directory levels read under a locale directory, the directory itself being level 1. */
const MAX_DEPTH = 4

/** Locale files read in all, so a huge tree does not hold an edit. */
const MAX_FILES = 200

/** A bigger locale file is skipped. */
const MAX_BYTES = 2_000_000

/**
 * One reported file: where it is on disk, the keys reported of it, and the line each key was called on.
 * The keys are a claim, never an answer: every measure reads the file again and drops the keys it no
 * longer calls, so a key the code deleted cannot hold a finding open.
 */
type Open = { path: string; keys: string[]; lines: Lines }

/**
 * The catalog of the session directory's locale files, read at the first edit that uses a new key and
 * dropped at each turn and each edit of a locale file; `reported` makes a read error logged once.
 * `open` holds each reported file's claim, so an edit that adds the keys, and an edit that stops using
 * them, both close the finding. `root` is the directory the session started in. Locale files are looked
 * for under it and a path is shown against it, because a Bash `cd` moves `$.session.cwd()` away.
 */
type State = { enabled: boolean; mode: Mode; catalog?: Catalog; reported: boolean; open: Map<string, Open>; root?: string; owed: boolean }

/** A locale file and the locale directory it was found under. */
type Found = { root: string; path: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function walkLocales($: EngineInterface, root: string, dir: string, depth: number, out: Found[]): Promise<void> {
  for (const entry of await $.fs.list(dir)) {
    if (out.length >= MAX_FILES) return
    const path = `${dir}/${entry.name}`
    const isLocale = entry.kind === 'file' && LOCALE_EXT.test(entry.name) && entry.size <= MAX_BYTES
    if (isLocale) out.push({ root, path })
    else if (entry.kind === 'dir' && depth < MAX_DEPTH && entry.name !== 'node_modules') await walkLocales($, root, path, depth + 1, out)
  }
}

async function isDir($: EngineInterface, path: string): Promise<boolean> {
  return (await $.fs.exists(path)) && (await $.fs.stat(path)).kind === 'dir'
}

/** Reads every locale file it finds; a directory or file that fails is named in `errors` and skipped. */
async function loadCatalog($: EngineInterface, cwd: string): Promise<{ catalog: Catalog; errors: string[] }> {
  const found: Found[] = []
  const errors: string[] = []
  for (const dir of LOCALE_DIRS) {
    const root = `${cwd}/${dir}`
    try {
      if (await isDir($, root)) await walkLocales($, root, root, 1, found)
    } catch (err) {
      errors.push(`${dir}: ${errorText(err)}`)
    }
  }
  const catalog: Catalog = new Map()
  for (const f of found) {
    try {
      addFile(catalog, f.path.slice(f.root.length + 1), await $.fs.read(f.path))
    } catch (err) {
      errors.push(`${f.path.slice(cwd.length + 1)}: ${errorText(err)}`)
    }
  }
  return { catalog, errors }
}

/** The directory the session started in, or the current one until `session.start` has recorded it. */
async function rootOf($: EngineInterface, state: State): Promise<string> {
  return state.root ?? (await $.session.cwd())
}

async function catalogOf($: EngineInterface, state: State): Promise<Catalog> {
  if (state.catalog !== undefined) return state.catalog
  const { catalog, errors } = await loadCatalog($, await rootOf($, state))
  if (errors.length > 0 && !state.reported) $.ui.log(`some locale files were not read: ${errors.slice(0, 3).join(' · ')}`)
  state.reported ||= errors.length > 0
  state.catalog = catalog
  return catalog
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, key: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'i18n-watch', key: sectionKey(key), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a key the locales gained leaves no warning behind. */
async function dropEntry($: EngineInterface, key: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'i18n-watch', key: sectionKey(key) })
  } catch {
    // The sidebar mod is not installed.
  }
}

/**
 * The keys a source file calls now, and the line of each, read from disk. `undefined` says the file could
 * not be measured, and then no key is dropped; a file that is gone answers an empty measure, because the
 * code it held calls nothing any more.
 */
async function usedNow($: EngineInterface, path: string): Promise<{ used: Set<string>; lines: Lines } | undefined> {
  try {
    if (!(await $.fs.exists(path))) return { used: new Set(), lines: {} }
    const text = String(await $.fs.read(path))
    return { used: callKeys(text), lines: keyLines(text) }
  } catch {
    // The file is there and was not read: the finding is left as it stands.
    return undefined
  }
}

/**
 * Measures one file's claim against the file itself and against the locale files, then writes what still
 * stands. The finding closes when nothing it named is missing any more, whether the locales gained the
 * keys or the code stopped calling them, and the person reads one line that says which of the two it was.
 */
async function measureFile($: EngineInterface, state: State, file: string, open: Open): Promise<void> {
  const now = await usedNow($, open.path)
  const v = verdict(await catalogOf($, state), open.keys, now?.used)
  const lines = now?.lines ?? open.lines
  if (v.missing.length > 0) {
    state.open.set(file, { path: open.path, keys: v.missing.map(m => m.key), lines })
    return
  }
  state.open.delete(file)
  await dropEntry($, file)
  await toPerson($, file, doneTitle(v.added, v.gone), doneLines(file, v.added, v.gone), doneLog(file, v.added, v.gone))
}

/** Measures every finding still open, and reports the ones it closed. */
async function recheckOpen($: EngineInterface, state: State, skip?: string): Promise<void> {
  if (!state.enabled || state.open.size === 0) return
  for (const [file, open] of [...state.open]) {
    if (file !== skip) await measureFile($, state, file, open)
  }
}

/** Adds the note to an edit that calls translation keys a locale lacks. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  if (isLocalePath(path)) {
    state.catalog = undefined
    await recheckOpen($, state)
    return r
  }
  if (!state.enabled || !isSource(path)) return r
  const shown = shownPath(path, await rootOf($, state))
  // Every other file's finding is measured too, because this edit may have moved a key into one of them.
  await recheckOpen($, state, shown)
  const added = newKeys(before, after)
  const claim = [...new Set([...(state.open.get(shown)?.keys ?? []), ...added])]
  if (claim.length === 0) return r
  return noteFor($, state, shown, path, claim, added, r)
}

/** Writes this file's finding and answers the edit: the note to the model, the line to the person. */
async function noteFor($: EngineInterface, state: State, shown: string, path: string, claim: string[], added: string[], r: ToolCallResult): Promise<ToolCallResult> {
  // Measured again here, because a boolean helper does not narrow the result union for the spread below.
  if (r.deny !== undefined || r.isError === true) return r
  const held = state.open.get(shown)
  const now = await usedNow($, path)
  const v = verdict(await catalogOf($, state), claim, now?.used)
  const lines = now?.lines ?? {}
  if (v.missing.length === 0) {
    if (held !== undefined) await measureFile($, state, shown, { ...held, keys: claim, lines })
    return r
  }
  state.open.set(shown, { path, keys: v.missing.map(m => m.key), lines })
  // Only the keys this edit added are reported; a key reported before is held open without saying it again.
  const fresh = v.missing.filter(m => added.includes(m.key))
  if (fresh.length === 0) return r
  await toPerson($, shown, 'missing translation keys', sidebarLines(fresh, lines), logText(fresh, lines))
  return { ...r, context: [...(r.context ?? []), noteText(fresh, lines)] }
}

/**
 * The files this commit holds, by absolute path, or undefined when git did not answer. Read before the
 * command runs, so it is the index as the commit will take it.
 */
async function stagedPaths($: EngineInterface, state: State): Promise<Set<string> | undefined> {
  try {
    const cwd = await rootOf($, state)
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
async function scopeOf($: EngineInterface, state: State, command: string): Promise<{ file: string; keys: string[]; lines: Lines }[]> {
  const all = [...state.open].map(([file, open]) => ({ file, keys: open.keys, lines: open.lines, path: open.path }))
  if (!isCommit(command) || !isNarrowable(command)) return all
  const staged = await stagedPaths($, state)
  return staged === undefined ? all : all.filter(o => staged.has(o.path))
}

/**
 * The gate of the `deny` mode: it measures every open finding again, so a key the model added and a key
 * the code stopped calling both close it and the command runs. A file this command holds that still lacks
 * a key stops it, and there is no bypass.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (!state.enabled || state.open.size === 0 || !isGuarded(command)) return undefined
  // Measured in both modes, so a finding the code or the locales settled does not stand in the pane.
  state.catalog = undefined
  await recheckOpen($, state)
  if (state.mode !== 'deny' || state.open.size === 0) return undefined
  const scoped = await scopeOf($, state, command)
  if (scoped.length === 0) {
    $.ui.log(`${state.open.size} file(s) still lack translation keys, and this command holds none of them`)
    return undefined
  }
  return denyText(scoped)
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  const mode = modeOf(word)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny' ? 'mode deny: git commit, push and merge stop while a file lacks translation keys' : 'mode note: the keys are only reported'
}

function statusText(state: State): string {
  const open = state.open.size === 0 ? 'no file is open' : `${state.open.size} file(s) still lack keys`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each edit is checked for translation keys the locale files lack' : 'off: edits are not checked'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  return word === '' ? statusText(state) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', reported: false, open: new Map(), owed: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'i18n-watch', description: 'Translation keys an edit uses that locale files lack: status, on, off, mode (i18n-watch)', argumentHint: '[on | off | mode note | deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    state.root = await $.session.cwd()
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'i18n-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.start', async (_, e, next) => {
    state.catalog = undefined
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stop = await gate($, state, e.command)
    return stop === undefined ? next(e) : { deny: stop }
  })

  /*
   * The turn's end measures every finding again and owes the model a note for what is left, because a
   * finding it did not close would otherwise stand in the pane and reach it never again.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    state.catalog = undefined
    await recheckOpen($, state)
    state.owed = state.open.size > 0
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    if (!state.owed || state.open.size === 0) return next(e)
    state.owed = false
    const note = openNote([...state.open].map(([file, open]) => ({ file, keys: open.keys, lines: open.lines })))
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
