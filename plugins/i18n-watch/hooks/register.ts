import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { isSource, newKeys } from './keys.ts'
import { addFile, denyText, doneLines, doneLog, isGuarded, isLocalePath, openKeys, LOCALE_DIRS, LOCALE_EXT, logText, missingKeys, modeOf, noteText, sectionKey, shownPath, sidebarLines, type Catalog, type Mode } from './locale.ts'

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
 * The catalog of the session directory's locale files, read at the first edit that uses a new key and
 * dropped at each turn and each edit of a locale file; `reported` makes a read error logged once.
 * `open` holds the keys each reported file still lacks, so an edit that adds them closes the finding.
 * `root` is the directory the session started in. Locale files are looked for under it and a path is
 * shown against it, because a Bash `cd` moves `$.session.cwd()` away from the project.
 */
type State = { enabled: boolean; mode: Mode; catalog?: Catalog; reported: boolean; open: Map<string, string[]>; root?: string }

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

/** Measures every finding still open after an edit of a locale file, and reports the ones it closed. */
async function closeResolved($: EngineInterface, state: State): Promise<void> {
  if (!state.enabled || state.open.size === 0) return
  const catalog = await catalogOf($, state)
  for (const [file, keys] of [...state.open]) {
    if (missingKeys(catalog, keys).length > 0) continue
    state.open.delete(file)
    await dropEntry($, file)
    await toPerson($, file, 'translation keys added', doneLines(file, keys), doneLog(file, keys))
  }
}

/** Adds the note to an edit that calls translation keys a locale lacks. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  if (isLocalePath(path)) {
    state.catalog = undefined
    await closeResolved($, state)
    return r
  }
  const keys = state.enabled && isSource(path) ? newKeys(before, after) : []
  if (keys.length === 0) return r
  const missing = missingKeys(await catalogOf($, state), keys)
  if (missing.length === 0) return r
  const shown = shownPath(path, await rootOf($, state))
  state.open.set(shown, openKeys(state.open.get(shown), missing))
  // The note goes to the model, the line to the person: neither reads the other's channel.
  await toPerson($, shown, 'missing translation keys', sidebarLines(missing), logText(missing))
  return { ...r, context: [...(r.context ?? []), noteText(missing)] }
}

/**
 * The gate of the `deny` mode: it reads the locale files again, so keys the model added since the finding
 * close it and the command runs. A file that still lacks a key stops the command, and there is no bypass.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (!state.enabled || state.mode !== 'deny' || state.open.size === 0 || !isGuarded(command)) return undefined
  state.catalog = undefined
  await closeResolved($, state)
  if (state.open.size === 0) return undefined
  return denyText([...state.open].map(([file, keys]) => ({ file, keys })))
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
  const state: State = { enabled: true, mode: 'note', reported: false, open: new Map() }

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

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
