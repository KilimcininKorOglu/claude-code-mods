import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { changedFiles, commitDir, denyText, doneLines, doneLog, doneTitle, isCommit, isGuarded, isManifest, isNarrowable, lockCandidates, logText, modeOf, noteText, openNote, sectionKey, sidebarLines, touchesDependencies, type Mode, type Stale } from './pairs.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** A finding still open: the sidebar key it was written under, and the pairs it named. */
type Open = { key: string; stale: Stale[] }

/**
 * The on/off setting read at session start, the mode, and the last error logged, so the same one is
 * logged once. `open` holds the last finding, so a later commit that brings its lockfiles along closes
 * it, and in `deny` mode it also holds the gate shut. `owed` says the model is owed a note for the
 * finding that stood at the turn's end.
 */
type State = { enabled: boolean; mode: Mode; lastError?: string; open?: Open; owed: boolean }

/** The repository and its HEAD before the commit; `head` is empty before the first commit. */
type Before = { root: string; head: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the commit's lockfiles were not checked: ${text}`)
  state.lastError = text
}

async function git($: EngineInterface, root: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await $.process.run(['git', ...args], { cwd: root, timeoutMs: 10_000 })
  return { ok: r.exitCode === 0, out: r.stdout }
}

/** The repository root and HEAD, or undefined outside a repository. */
async function beforeCommit($: EngineInterface, state: State, command: string): Promise<Before | undefined> {
  try {
    const top = await git($, commitDir(command, await $.session.cwd()), ['rev-parse', '--show-toplevel'])
    if (!top.ok) return undefined
    const root = top.out.trim()
    const head = await git($, root, ['rev-parse', 'HEAD'])
    return { root, head: head.ok ? head.out.trim() : '' }
  } catch (err) {
    report($, state, err)
    return undefined
  }
}

/** The manifest in the working tree; an empty answer leaves every changed line counted. */
async function manifestText($: EngineInterface, root: string, manifest: string): Promise<string> {
  try {
    return await $.fs.read(`${root}/${manifest}`)
  } catch {
    return ''
  }
}

/** The nearest lockfile on disk for a manifest, or undefined when the project keeps none. */
async function lockOnDisk($: EngineInterface, root: string, manifest: string): Promise<string | undefined> {
  for (const lock of lockCandidates(manifest)) if (await $.fs.exists(`${root}/${lock}`)) return lock
  return undefined
}

/** The manifest's pairing when the commit changed its dependencies but left its lockfile alone. */
async function staleLock($: EngineInterface, root: string, manifest: string, changed: Set<string>): Promise<Stale | undefined> {
  const lock = await lockOnDisk($, root, manifest)
  if (lock === undefined || changed.has(lock)) return undefined
  const diff = await git($, root, ['show', '--format=', '--unified=20', '--no-color', '--no-ext-diff', 'HEAD', '--', manifest])
  if (!diff.ok) throw new Error(`git show HEAD -- ${manifest} failed`)
  // The section of a changed line is read from the whole manifest, not from the diff's own context.
  const text = await git($, root, ['show', `HEAD:${manifest}`])
  return touchesDependencies(manifest, diff.out, text.ok ? text.out : '') ? { manifest, lock } : undefined
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, key: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'lockfile-sync', key, title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a lockfile that caught up leaves no warning behind. */
async function dropEntry($: EngineInterface, key: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'lockfile-sync', key })
  } catch {
    // The sidebar mod is not installed.
  }
}

/**
 * The manifests of the open finding that ask for no lockfile change any more: their dependencies read
 * as they did at the commit that last wrote the lockfile, so the change that opened the finding is gone.
 * A lockfile no commit ever wrote has nothing to compare against and is left alone.
 */
async function settled($: EngineInterface, root: string, stale: readonly Stale[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const s of stale) {
    const at = await git($, root, ['log', '-1', '--format=%H', '--', s.lock])
    const base = at.ok ? at.out.trim() : ''
    if (base === '') continue
    const diff = await git($, root, ['diff', '--unified=20', '--no-color', '--no-ext-diff', base, '--', s.manifest])
    // `git diff <base>` compares against the working tree, so that is the file the sections are read from.
    const text = await manifestText($, root, s.manifest)
    if (diff.ok && !touchesDependencies(s.manifest, diff.out, text)) out.add(s.lock)
  }
  return out
}

/**
 * Closes the open finding when nothing it named stands: the lockfile was written, or the manifest no
 * longer asks for one. Both are measured from git, never remembered, so a change that was reverted
 * closes the finding as well as a lockfile that caught up.
 */
async function closeResolved($: EngineInterface, state: State, changed: ReadonlySet<string>, back: ReadonlySet<string>): Promise<void> {
  const open = state.open
  if (open === undefined) return
  const left = open.stale.filter(s => !changed.has(s.lock) && !back.has(s.lock))
  state.open = left.length === 0 ? undefined : { key: open.key, stale: left }
  if (left.length > 0) return
  const updated = open.stale.filter(s => changed.has(s.lock))
  const settledPairs = open.stale.filter(s => !changed.has(s.lock))
  await dropEntry($, open.key)
  await toPerson($, open.key, doneTitle(updated, settledPairs), doneLines(updated, settledPairs), doneLog(updated, settledPairs))
}

/** The note for the commit that moved HEAD, or undefined when every changed manifest has its lockfile along. */
async function commitNote($: EngineInterface, state: State, before: Before): Promise<string | undefined> {
  const head = await git($, before.root, ['rev-parse', 'HEAD'])
  if (!head.ok || head.out.trim() === before.head) return undefined
  const names = await git($, before.root, ['show', '--format=', '--name-status', '--no-renames', 'HEAD'])
  if (!names.ok) throw new Error('git show --name-status HEAD failed')
  const files = changedFiles(names.out)
  const changed = new Set(files)
  await closeResolved($, state, changed, await settled($, before.root, state.open?.stale ?? []))
  const stale: Stale[] = []
  for (const manifest of files.filter(isManifest)) {
    const s = await staleLock($, before.root, manifest, changed)
    if (s !== undefined) stale.push(s)
  }
  if (stale.length === 0) return undefined
  state.open = { key: sectionKey(stale), stale }
  // The note goes to the model, the finding to the person: neither reads the other's channel.
  await toPerson($, sectionKey(stale), 'lockfiles the commit left out', sidebarLines(stale), logText(stale))
  return noteText(stale)
}

async function afterCommit($: EngineInterface, state: State, before: Before, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  try {
    const note = await commitNote($, state, before)
    state.lastError = undefined
    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  } catch (err) {
    report($, state, err)
    return r
  }
}

/** The lockfiles of the open finding that the working tree has changed since the commit that left them out. */
async function caughtUp($: EngineInterface, root: string, stale: readonly Stale[]): Promise<Set<string>> {
  const changed = new Set<string>()
  for (const s of stale) {
    const status = await git($, root, ['status', '--porcelain', '--', s.lock])
    if (status.ok && status.out.trim() !== '') changed.add(s.lock)
  }
  return changed
}

/**
 * Measures the open finding outside a commit, from the working tree and from git, and answers whether it
 * still stands. A directory no repository holds, and a git error, leave the finding as it was.
 */
async function recheckNow($: EngineInterface, state: State): Promise<boolean> {
  const open = state.open
  if (open === undefined) return false
  try {
    const before = await beforeCommit($, state, '')
    if (before === undefined) return state.open !== undefined
    await closeResolved($, state, await caughtUp($, before.root, open.stale), await settled($, before.root, open.stale))
  } catch (err) {
    report($, state, err)
  }
  return state.open !== undefined
}

/**
 * The pairs this command answers for. A `git commit` answers for its own files alone, so a manifest the
 * commit does not hold lets it run. A `push` or a `merge` holds no index to read, so every pair stands
 * there. The index is read before the command runs, as the commit will take it.
 */
async function scopeOf($: EngineInterface, stale: readonly Stale[], root: string, command: string): Promise<Stale[]> {
  if (!isCommit(command) || !isNarrowable(command)) return [...stale]
  try {
    const staged = await git($, root, ['diff', '--cached', '--name-only', '-z'])
    if (!staged.ok) return [...stale]
    const held = new Set(staged.out.split('\0').filter(Boolean))
    return stale.filter(s => held.has(s.manifest))
  } catch {
    // git did not run: the pairs are not narrowed.
    return [...stale]
  }
}

/** The deny of the pairs this command answers for, or undefined when it holds none of their manifests. */
async function denyFor($: EngineInterface, stale: readonly Stale[], root: string, command: string): Promise<{ deny: string } | undefined> {
  const scoped = await scopeOf($, stale, root, command)
  if (scoped.length > 0) return { deny: denyText(scoped) }
  $.ui.log(`${stale.length} lockfile(s) are still behind their manifest, and this command holds none of those manifests`)
  return undefined
}

/**
 * The gate: in deny mode a commit, push or merge waits while a lockfile is still behind its manifest.
 * The working tree is read again first, so a lockfile the model updated opens the gate itself.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<{ deny: string } | undefined> {
  const open = state.open
  if (!state.enabled || state.mode !== 'deny' || open === undefined || !isGuarded(command)) return undefined
  try {
    const before = await beforeCommit($, state, command)
    if (before === undefined) return undefined
    await closeResolved($, state, await caughtUp($, before.root, open.stale), await settled($, before.root, open.stale))
    return state.open === undefined ? undefined : denyFor($, state.open.stale, before.root, command)
  } catch (err) {
    report($, state, err)
    return undefined
  }
}

async function setMode($: EngineInterface, state: State, arg: string): Promise<string> {
  const mode = modeOf(arg)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny'
    ? 'mode deny: git commit, push and merge stop while a lockfile is behind its manifest'
    : 'mode note: nothing is stopped, the finding reaches the model as a note'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const [first = '', second = ''] = args.trim().split(/\s+/)
  if (first === 'mode') return setMode($, state, second)
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each commit is checked for manifests whose lockfile it left out' : 'off: commits are not checked'
  }
  if (word !== '') return USAGE
  const open = state.open === undefined ? 'no lockfile is open' : `${state.open.stale.map(s => s.lock).join(' · ')} still behind`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', owed: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'lockfile-sync', description: 'Manifests a commit changes without their lockfile: status, on, off, mode note | deny (lockfile-sync)', argumentHint: '[on | off | mode note | mode deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = modeOf(String(await $.store.get(MODE_KEY))) ?? 'note'
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'lockfile-sync' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  /*
   * The turn's end measures the open finding again and owes the model a note while it stands, because a
   * finding it did not close would otherwise stand in the pane and reach it never again.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !state.enabled) return r
    state.owed = await recheckNow($, state)
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    const open = state.open
    if (!state.owed || open === undefined) return next(e)
    state.owed = false
    return next({ ...e, context: [...(e.context ?? []), openNote(open.stale)] })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stopped = await gate($, state, e.command)
    if (stopped !== undefined) return stopped
    if (!state.enabled || !isCommit(e.command)) return next(e)
    const before = await beforeCommit($, state, e.command)
    const r = await next(e)
    return before === undefined ? r : afterCommit($, state, before, r)
  })
}
