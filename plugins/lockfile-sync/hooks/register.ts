import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { checkFor, lockDir, type Verdict } from './checks.ts'
import { changedFiles, commitDir, denyText, doneLines, doneLog, doneTitle, isCommit, isGuarded, isManifest, isNarrowable, lockCandidates, logText, modeOf, noteText, openNote, sectionKey, sidebarLines, touchesDependencies, type Mode, type Settled, type Stale } from './pairs.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** A finding still open: the sidebar key it was written under, and the pairs it named. */
type Open = { key: string; stale: Stale[] }

/**
 * The on/off setting read at session start, the mode, and the last error logged, so the same one is
 * logged once. `open` holds every finding still standing, one per commit that left a lockfile out, so a
 * later commit that brings its lockfiles along closes it, and in `deny` mode it also holds the gate shut.
 * A later commit adds its own finding beside them and never writes over one. `owed` says the model is
 * owed a note for the findings that stood at the turn's end. `lastToolError` is the last package manager
 * failure logged, so the same one is logged once.
 */
type State = { enabled: boolean; mode: Mode; lastError?: string; lastToolError?: string; open: Open[]; owed: boolean }

/** Every pair the open findings name. */
const pairsOf = (state: State): Stale[] => state.open.flatMap(o => o.stale)

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

/** A manifest or lockfile in the working tree; an empty answer leaves every changed line counted. */
async function treeText($: EngineInterface, root: string, path: string): Promise<string> {
  try {
    return await $.fs.read(`${root}/${path}`)
  } catch {
    return ''
  }
}

/** Logs a package manager that did not run once until a different failure comes. */
function toolFailed($: EngineInterface, state: State, tool: string, err: unknown): void {
  const text = `${tool} did not run: ${errorText(err)}; the manifest's diff decides`
  if (text !== state.lastToolError) $.ui.log(text)
  state.lastToolError = text
}

/** The mod's own temporary directory, where a check that must fetch keeps what it fetched. */
async function tmpDir($: EngineInterface): Promise<string> {
  return `${((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')}/lockfile-sync`
}

/** What a pair's package manager says of its lockfile, and which one said it. */
type Checked = { verdict: Verdict; tool?: string }

/**
 * Asks the pair's package manager whether the lockfile fits the manifest. The tool reads the working tree
 * and a finding speaks of HEAD, so it runs only while both files read as they do at HEAD: a lockfile written
 * but left out of the commit would read as in step. No check, a changed file, or a tool that did not run
 * proves nothing, and the manifest's diff decides.
 */
async function lockVerdict($: EngineInterface, state: State, root: string, pair: Stale): Promise<Checked> {
  if (!(await git($, root, ['diff', '--quiet', 'HEAD', '--', pair.manifest, pair.lock])).ok) return { verdict: 'unknown' }
  const lockText = await treeText($, root, pair.lock)
  const check = checkFor(pair.lock, lockText)
  if (check === undefined) return { verdict: 'unknown' }
  const dir = lockDir(pair.lock)
  const init = { cwd: dir === '' ? root : `${root}/${dir}`, timeoutMs: 60_000, env: check.env === undefined ? undefined : check.env(await tmpDir($)) }
  try {
    const ran = await $.process.run(check.argv(`${root}/${pair.manifest}`), init)
    return { verdict: check.judge(ran, lockText), tool: check.tool }
  } catch (err) {
    toolFailed($, state, check.tool, err)
    return { verdict: 'unknown' }
  }
}

/** The nearest lockfile on disk for a manifest, or undefined when the project keeps none. */
async function lockOnDisk($: EngineInterface, root: string, manifest: string): Promise<string | undefined> {
  for (const lock of lockCandidates(manifest)) if (await $.fs.exists(`${root}/${lock}`)) return lock
  return undefined
}

/**
 * The manifest's pairing when the commit left its lockfile alone and the lockfile no longer fits: the package
 * manager says so, or, when it proves nothing, the manifest's diff changed a dependency.
 */
async function staleLock($: EngineInterface, state: State, root: string, manifest: string, changed: Set<string>): Promise<Stale | undefined> {
  const lock = await lockOnDisk($, root, manifest)
  if (lock === undefined || changed.has(lock)) return undefined
  const { verdict } = await lockVerdict($, state, root, { manifest, lock })
  if (verdict !== 'unknown') return verdict === 'behind' ? { manifest, lock } : undefined
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
 * Whether the manifest's dependencies read as they did at the commit that last wrote the lockfile, so the
 * change that opened the finding is gone. A lockfile no commit ever wrote has nothing to compare against.
 */
async function reverted($: EngineInterface, root: string, s: Stale): Promise<boolean> {
  const at = await git($, root, ['log', '-1', '--format=%H', '--', s.lock])
  const base = at.ok ? at.out.trim() : ''
  if (base === '') return false
  const diff = await git($, root, ['diff', '--unified=20', '--no-color', '--no-ext-diff', base, '--', s.manifest])
  // `git diff <base>` compares against the working tree, so that is the file the sections are read from.
  const text = await treeText($, root, s.manifest)
  return diff.ok && !touchesDependencies(s.manifest, diff.out, text)
}

/**
 * The lockfiles of the open finding that no longer fall behind, each with the package manager that read
 * it as in step, or undefined when the manifest's dependency change was taken back. A lockfile its package
 * manager reads as behind stays open whatever the diff says.
 */
async function settled($: EngineInterface, state: State, root: string, stale: readonly Stale[]): Promise<Map<string, string | undefined>> {
  const out = new Map<string, string | undefined>()
  for (const s of stale) {
    const checked = await lockVerdict($, state, root, s)
    if (checked.verdict === 'in-sync') out.set(s.lock, checked.tool)
    else if (checked.verdict === 'unknown' && (await reverted($, root, s))) out.set(s.lock, undefined)
  }
  return out
}

/**
 * Closes each open finding when nothing it named stands: the lockfile was written, or the manifest no
 * longer asks for one. Both are measured from git, never remembered, so a change that was reverted
 * closes the finding as well as a lockfile that caught up. A finding that keeps some of its pairs stays
 * open with those alone.
 */
async function closeResolved($: EngineInterface, state: State, changed: ReadonlySet<string>, back: ReadonlyMap<string, string | undefined>): Promise<void> {
  const kept: Open[] = []
  for (const open of state.open) {
    const left = open.stale.filter(s => !changed.has(s.lock) && !back.has(s.lock))
    if (left.length > 0) {
      kept.push({ key: open.key, stale: left })
      continue
    }
    const updated = open.stale.filter(s => changed.has(s.lock))
    const settledPairs: Settled[] = open.stale.filter(s => !changed.has(s.lock)).map(s => ({ ...s, tool: back.get(s.lock) }))
    await dropEntry($, open.key)
    await toPerson($, open.key, doneTitle(updated, settledPairs), doneLines(updated, settledPairs), doneLog(updated, settledPairs))
  }
  state.open = kept
}

/** The note for the commit that moved HEAD, or undefined when every changed manifest has its lockfile along. */
async function commitNote($: EngineInterface, state: State, before: Before): Promise<string | undefined> {
  const head = await git($, before.root, ['rev-parse', 'HEAD'])
  if (!head.ok || head.out.trim() === before.head) return undefined
  const names = await git($, before.root, ['show', '--format=', '--name-status', '--no-renames', 'HEAD'])
  if (!names.ok) throw new Error('git show --name-status HEAD failed')
  const files = changedFiles(names.out)
  const changed = new Set(files)
  await closeResolved($, state, changed, await settled($, state, before.root, pairsOf(state)))
  const stale: Stale[] = []
  for (const manifest of files.filter(isManifest)) {
    const s = await staleLock($, state, before.root, manifest, changed)
    if (s !== undefined) stale.push(s)
  }
  if (stale.length === 0) return undefined
  // A pair an earlier finding still holds stays there, so the person reads it once; the model reads this commit whole.
  const pairKey = (s: Stale): string => `${s.manifest}\0${s.lock}`
  const held = new Set(pairsOf(state).map(pairKey))
  const fresh = stale.filter(s => !held.has(pairKey(s)))
  if (fresh.length > 0) {
    state.open.push({ key: sectionKey(fresh), stale: fresh })
    // The note goes to the model, the finding to the person: neither reads the other's channel.
    await toPerson($, sectionKey(fresh), 'lockfiles the commit left out', sidebarLines(fresh), logText(fresh))
  }
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
  const stale = pairsOf(state)
  if (stale.length === 0) return false
  try {
    const before = await beforeCommit($, state, '')
    if (before === undefined) return true
    await closeResolved($, state, await caughtUp($, before.root, stale), await settled($, state, before.root, stale))
  } catch (err) {
    report($, state, err)
  }
  return state.open.length > 0
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
  const stale = pairsOf(state)
  if (!state.enabled || state.mode !== 'deny' || stale.length === 0 || !isGuarded(command)) return undefined
  try {
    const before = await beforeCommit($, state, command)
    if (before === undefined) return undefined
    await closeResolved($, state, await caughtUp($, before.root, stale), await settled($, state, before.root, stale))
    return state.open.length === 0 ? undefined : denyFor($, pairsOf(state), before.root, command)
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
  const stale = pairsOf(state)
  const open = stale.length === 0 ? 'no lockfile is open' : `${stale.map(s => s.lock).join(' · ')} still behind`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', open: [], owed: false }

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
    const stale = pairsOf(state)
    if (!state.owed || stale.length === 0) return next(e)
    state.owed = false
    return next({ ...e, context: [...(e.context ?? []), openNote(stale)] })
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
