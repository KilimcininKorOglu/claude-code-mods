import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { blockingLine, changedSignatures, denyText, doneLines, doneLog, isBlocking, isGuarded, isReported, logText, modeOf, noteText, openNote, parseCheck, sectionKey, sidebarLines, type Check, type Mode } from './signature.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** One symbol whose callers do not match it: where it lives, so the gate can measure it again. */
type Open = { root: string; rel: string; sym: string }

/**
 * The last error logged, so the same one is logged once, the mode, the symbols the gate holds, and the
 * lines the model is owed a note for, measured at the turn's end.
 */
type State = { lastError?: string; mode: Mode; open: Map<string, Open>; owed: string[] }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** The repository root and the file's path inside it, or undefined outside git. */
async function locate($: EngineInterface, file: string): Promise<{ root: string; rel: string } | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--show-prefix'], { cwd: dirOf(file), timeoutMs: 10_000 })
  if (r.exitCode !== 0) return undefined
  const [root = '', prefix = ''] = r.stdout.split('\n')
  return root === '' ? undefined : { root, rel: `${prefix}${file.slice(file.lastIndexOf('/') + 1)}` }
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, key: string, title: string, lines: { text: string; kind: 'error' | 'ok' | 'dim' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'contract-watch', key: sectionKey(key), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a signature whose callers caught up leaves no warning behind. */
async function dropEntry($: EngineInterface, key: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'contract-watch', key: sectionKey(key) })
  } catch {
    // The sidebar mod is not installed.
  }
}

/** Asks ripwire about one symbol; undefined when its output has no edit-check element. */
async function askRipwire($: EngineInterface, root: string, rel: string, sym: string): Promise<Check | undefined> {
  const r = await $.process.run(['ripwire', root, `--edit-check=${rel}:${sym}`], { cwd: root, timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(`ripwire --edit-check failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`)
  return parseCheck(r.stdout)
}

/** Asks ripwire about one changed function and answers the note, if its callers need a look. */
async function checkOne($: EngineInterface, state: State, place: { root: string; rel: string }, name: string): Promise<string | undefined> {
  const check = await askRipwire($, place.root, place.rel, name)
  if (check === undefined) return undefined
  // The finding the person reads is the one the mod holds, so every reported symbol is closed later too.
  if (isReported(check)) state.open.set(`${place.rel}:${check.sym}`, { root: place.root, rel: place.rel, sym: check.sym })
  // The note goes to the model, the line to the person: neither reads the other's channel.
  const line = logText(check)
  if (line !== undefined) await toPerson($, check.sym, 'changed signatures', sidebarLines(check), line)
  return noteText(check)
}

async function notesFor($: EngineInterface, state: State, file: string, names: readonly string[]): Promise<string[]> {
  const place = await locate($, file)
  if (place === undefined) return []
  const notes: string[] = []
  for (const name of names) {
    const note = await checkOne($, state, place, name)
    if (note !== undefined) notes.push(note)
  }
  return notes
}

/**
 * Asks ripwire about each open symbol again, closes the ones no caller misses any more, and answers the
 * lines of the ones that still do. A symbol ripwire marks as incompatible stays open; one it no longer
 * marks closes, and the closing line says which of the two measures closed it.
 */
async function recheckOpen($: EngineInterface, state: State): Promise<string[]> {
  const lines: string[] = []
  for (const [key, held] of [...state.open]) {
    const check = await askRipwire($, held.root, held.rel, held.sym)
    if (check !== undefined && isBlocking(check)) {
      lines.push(blockingLine(check))
      continue
    }
    const matched = check === undefined || !isReported(check)
    state.open.delete(key)
    await dropEntry($, held.sym)
    await toPerson($, held.sym, 'callers caught up', doneLines(held.sym, matched), doneLog(held.sym, matched))
  }
  return lines
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the callers were not checked: ${text}`)
  state.lastError = text
}

function withNotes(r: ToolCallResult, notes: readonly string[]): ToolCallResult {
  if (notes.length === 0 || r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), ...notes] }
}

/**
 * What a `git commit`, `push` or `merge` attempt does, in both modes: ripwire measures each open symbol
 * again, so a finding the model fixed closes itself with a green line, as in the other finding mods. The
 * measurement runs before the command, because `--edit-check` compares the working tree against HEAD and
 * a commit leaves it nothing to compare. In `deny` mode a symbol a caller still misses stops the command.
 */
async function atGitCommand($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (state.open.size === 0 || !isGuarded(command) || !(await isEnabled($))) return undefined
  const lines = await recheckOpen($, state)
  return state.mode === 'deny' && lines.length > 0 ? denyText(lines) : undefined
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  const mode = modeOf(word)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny' ? 'mode deny: git commit, push and merge stop while a caller does not match a changed signature' : 'mode note: the callers are only reported'
}

async function statusText($: EngineInterface, state: State): Promise<string> {
  const open = state.open.size === 0 ? 'no signature is open' : `${state.open.size} signature(s) have callers to check`
  return `${(await isEnabled($)) ? 'on' : 'off'} · mode ${state.mode} · ${open}; it needs ripwire on PATH`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    return word === 'on' ? 'on: a changed signature brings its callers to the model' : 'off: signatures are not checked'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  return word === '' ? statusText($, state) : USAGE
}

export const register: Register = on => {
  const state: State = { mode: 'note', open: new Map(), owed: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'contract-watch', description: 'Callers of a changed signature: status, on, off, mode (contract-watch)', argumentHint: '[on | off | mode note | deny]' })
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'contract-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  /*
   * The turn's end asks ripwire about each open symbol again and owes the model a note for the ones a
   * caller still misses, because a finding it did not close would otherwise stand in the pane and reach
   * it never again. ripwire runs on this machine alone, once per open symbol.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || state.open.size === 0 || !(await isEnabled($))) return r
    try {
      state.owed = await recheckOpen($, state)
    } catch (err) {
      report($, state, err)
    }
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    if (state.owed.length === 0) return next(e)
    const note = openNote(state.owed)
    state.owed = []
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    try {
      const stop = await atGitCommand($, state, e.command)
      if (stop !== undefined) return { deny: stop }
    } catch (err) {
      report($, state, err)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true || !(await isEnabled($))) return r
    const names = changedSignatures(e.old_string, e.new_string)
    if (names.length === 0) return r
    try {
      const notes = await notesFor($, state, e.file_path, names)
      state.lastError = undefined
      return withNotes(r, notes)
    } catch (err) {
      report($, state, err)
      return r
    }
  })
}
