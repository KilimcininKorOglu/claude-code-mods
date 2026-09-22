import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { commitUrl, denyText, doneLines, doneLog, doneTitle, isCommit, isGuarded, isNarrowable, isWorkflow, logText, MAX_NAMED, modeOf, noteText, openNote, openRefs, refOf, sectionKey, shownPath, sidebarLines, unpinnedUses, type Mode, type Unpinned } from './pin.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** The GitHub API answers the plain SHA of a ref with this Accept header. */
const HEADERS = { Accept: 'application/vnd.github.sha', 'User-Agent': 'action-pin' }

/**
 * The on/off setting read at session start, the SHAs already resolved in this session, so one workflow
 * does not ask GitHub twice, the refs the model is owed a note for, and the last error, so the same one
 * is logged once, and the directory the session started in, which every workflow is shown against.
 */
type State = { enabled: boolean; mode: Mode; shas: Map<string, string>; open: Map<string, string[]>; owed: string[]; lastError?: string; root?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The commit a ref points at, or undefined when GitHub does not answer it. */
async function resolveSha($: EngineInterface, state: State, use: Unpinned): Promise<string | undefined> {
  const key = `${use.action}@${use.ref}`
  const known = state.shas.get(key)
  if (known !== undefined) return known
  const r = await $.http.fetch(commitUrl(use.action, use.ref), { headers: HEADERS })
  if (!r.ok) throw new Error(`api.github.com answered HTTP ${r.status} for ${key}`)
  const sha = r.text.trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`api.github.com answered no commit for ${key}`)
  state.shas.set(key, sha)
  return sha
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`a commit SHA was not resolved: ${text}`)
  state.lastError = text
}

/** Each action with its commit; one that GitHub does not answer keeps its ref alone. */
async function withShas($: EngineInterface, state: State, uses: readonly Unpinned[]): Promise<Unpinned[]> {
  const out: Unpinned[] = []
  for (const use of uses.slice(0, MAX_NAMED)) {
    try {
      out.push({ ...use, sha: await resolveSha($, state, use) })
      state.lastError = undefined
    } catch (err) {
      report($, state, err)
      out.push(use)
    }
  }
  return [...out, ...uses.slice(MAX_NAMED)]
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, path: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'action-pin', key: sectionKey(path), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a workflow that pins its actions leaves no warning behind. */
async function dropEntry($: EngineInterface, path: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'action-pin', key: sectionKey(path) })
  } catch {
    // The sidebar mod is not installed.
  }
}

/**
 * The refs of one open file that still move, or undefined when the file is there and cannot be read. A
 * workflow that is gone uses no action any more, so it answers an empty list and its finding closes.
 */
async function isThere($: EngineInterface, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    // The path was not measured: it counts as there, so no finding closes on it.
    return true
  }
}

/** One workflow whose finding still stands, and the refs of it that still move. */
type Left = { path: string; refs: string[] }

async function stillMoving($: EngineInterface, path: string, refs: readonly string[]): Promise<string[] | undefined> {
  try {
    if (!(await isThere($, path))) return []
    const held = new Set(unpinnedUses('', await $.fs.read(path)).map(refOf))
    return refs.filter(ref => held.has(ref))
  } catch {
    // The file is there and was not read: the finding stays as it was.
    return undefined
  }
}

/** Reads each open workflow again and closes the findings whose refs are pinned now. */
async function closeResolved($: EngineInterface, state: State, skip?: string): Promise<Left[]> {
  const left: Left[] = []
  for (const [path, refs] of [...state.open]) {
    const moving = path === skip ? refs : await stillMoving($, path, refs)
    if (moving === undefined || moving.length > 0) {
      left.push({ path, refs: [...(moving ?? refs)] })
      continue
    }
    state.open.delete(path)
    const shown = shownPath(path, state.root)
    await dropEntry($, shown)
    const gone = path !== skip && !(await isThere($, path))
    await toPerson($, shown, doneTitle(gone), doneLines(shown, refs), doneLog(shown, refs, gone))
  }
  return left
}

/** Adds the note to an edit that pins an action to a moving ref, and closes what a later edit fixed. */
async function afterEdit($: EngineInterface, state: State, path: string, before: string, after: string, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true || !state.enabled) return r
  const found = isWorkflow(path) ? unpinnedUses(before, after) : []
  if (found.length === 0) {
    await closeResolved($, state)
    return r
  }
  const uses = await withShas($, state, found)
  state.open.set(path, openRefs(state.open.get(path), uses))
  // The note goes to the model, the finding to the person: neither reads the other's channel.
  const shown = shownPath(path, state.root)
  await toPerson($, shown, 'actions by a moving ref', sidebarLines(shown, uses), logText(shown, uses))
  await closeResolved($, state, path)
  return { ...r, context: [...(r.context ?? []), noteText(uses)] }
}

/**
 * The files this commit holds, by absolute path, or undefined when git did not answer. Read before the
 * command runs, so it is the index as the commit will take it.
 */
async function stagedPaths($: EngineInterface): Promise<Set<string> | undefined> {
  try {
    const cwd = await $.session.cwd()
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
 * a workflow the commit does not hold lets it run. A `push` or a `merge` holds no index to read, so every
 * finding stands there.
 */
async function scopeOf($: EngineInterface, left: readonly Left[], command: string): Promise<Left[]> {
  if (!isCommit(command) || !isNarrowable(command)) return [...left]
  const staged = await stagedPaths($)
  return staged === undefined ? [...left] : left.filter(l => staged.has(l.path))
}

/**
 * The gate of the `deny` mode: it reads each open workflow again, so a ref the model pinned without a
 * new finding opens the gate too. A ref of a workflow this command holds that still moves stops it, and
 * there is no bypass.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<string | undefined> {
  if (!state.enabled || state.mode !== 'deny' || state.open.size === 0 || !isGuarded(command)) return undefined
  const left = await closeResolved($, state)
  if (left.length === 0) return undefined
  const scoped = await scopeOf($, left, command)
  if (scoped.length === 0) {
    $.ui.log(`${left.length} workflow(s) still use a moving ref, and this command holds none of them`)
    return undefined
  }
  return denyText(scoped.flatMap(l => l.refs))
}

async function setMode($: EngineInterface, state: State, word: string): Promise<string> {
  const mode = modeOf(word)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny' ? 'mode deny: git commit, push and merge stop while an action is used by a moving ref' : 'mode note: the actions are only reported'
}

function statusText(state: State): string {
  const open = state.open.size === 0 ? 'no workflow is open' : `${state.open.size} workflow(s) still use a moving ref`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: a workflow edit that uses an action by a tag or a branch gets a note' : 'off: workflow edits are not checked'
  }
  if (word.startsWith('mode')) return setMode($, state, word.slice(4).trim())
  return word === '' ? statusText(state) : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', shas: new Map(), open: new Map(), owed: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'action-pin', description: 'GitHub Actions steps an edit pins to a moving tag: status, on, off, mode (action-pin)', argumentHint: '[on | off | mode note | deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = (await $.store.get(MODE_KEY)) === 'deny' ? 'deny' : 'note'
    // Read from the event, not from `$.session.cwd()`, which follows a Bash `cd`.
    state.root = e.cwd
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'action-pin' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  /*
   * The turn's end reads every open workflow again and owes the model a note for the refs that still
   * move, because a finding it did not close would otherwise stand in the pane and reach it never again.
   * The commit SHAs are already in `state.shas`, so this asks GitHub nothing.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !state.enabled) return r
    state.owed = (await closeResolved($, state)).flatMap(l => l.refs)
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
    const stop = await gate($, state, e.command)
    return stop === undefined ? next(e) : { deny: stop }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, state, e.file_path, e.old_string, e.new_string, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, state, e.file_path, '', e.content, await next(e)))
}
