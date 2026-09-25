import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { addedBy, byDoc, commitDir, denyText, doneLines, doneLog, identity, isCommit, isGuarded, isNarrowable, logText, modeOf, noteText, openNote, parseDrift, sectionKey, sidebarLines, type Closing, type Line, type Mode, type Stale } from './drift.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const CONSUMER = 'doc-drift-watch'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/** One open finding: the repository it was measured in, and the stale anchors of one doc. */
type Open = { root: string; doc: string; stale: Stale[] }

/**
 * The on/off setting, the mode, the open findings by the doc's path on disk, whether the model is owed
 * a note for them, and the last error logged, so the same one is logged once.
 */
type State = { enabled: boolean; mode: Mode; open: Map<string, Open>; owed: boolean; lastError?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function repoRoot($: EngineInterface, cwd: string): Promise<string | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 10_000 })
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

/**
 * The repository's stale doc anchors now; `--with-history` tells a deleted name from one never defined.
 * `doc` narrows the run to the docs whose path holds it, so a re-measure reads one doc, not the repository.
 */
async function driftNow($: EngineInterface, root: string, doc?: string): Promise<Stale[]> {
  const flag = doc === undefined ? '--doc-drift' : `--doc-drift=${doc}`
  const r = await $.process.run(['ripwire', root, flag, '--with-history'], { cwd: root, timeoutMs: 30_000 })
  if (r.exitCode !== 0) throw new Error(`ripwire --doc-drift failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`)
  return parseDrift(r.stdout)
}

/**
 * Writes an error once until a different one comes: a yellow entry in the sidebar's stream while it is
 * open, else the transcript line.
 */
async function report($: EngineInterface, state: State, err: unknown): Promise<void> {
  const text = errorText(err)
  if (text === state.lastError) return
  state.lastError = text
  const line = `the docs were not checked: ${text}`
  await toPerson($, 'unchecked', 'not checked', [{ text: line, kind: 'warn' }], line)
}

function withNote(r: ToolCallResult, note: string): ToolCallResult {
  if (r.deny !== undefined || r.isError === true) return r
  return { ...r, context: [...(r.context ?? []), note] }
}

/** The drift before the commit, or undefined when the commit is not checked. */
async function beforeCommit($: EngineInterface, state: State, command: string): Promise<{ root: string; stale: Stale[] } | undefined> {
  try {
    const root = await repoRoot($, commitDir(command, await $.session.cwd()))
    return root === undefined ? undefined : { root, stale: await driftNow($, root) }
  } catch (err) {
    await report($, state, err)
    return undefined
  }
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, doc: string, title: string, lines: readonly Line[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(doc), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/**
 * Holds this commit's stale lines open, one finding per doc, and writes each to the person. A doc that
 * already has a finding keeps the lines of it that `now`, the drift after the commit, still reports, and
 * this commit's lines join them; a line no longer reported leaves the record.
 */
async function openFindings($: EngineInterface, state: State, root: string, added: readonly Stale[], now: readonly Stale[]): Promise<void> {
  const reported = new Set(now.map(identity))
  for (const [doc, stale] of byDoc(added)) {
    const key = `${root}/${doc}`
    const kept = (state.open.get(key)?.stale ?? []).filter(s => reported.has(identity(s)))
    const fresh = new Set(stale.map(identity))
    state.open.set(key, { root, doc, stale: [...kept.filter(s => !fresh.has(identity(s))), ...stale] })
    await toPerson($, doc, 'doc lines the commit made stale', sidebarLines(stale), logText(stale))
  }
}

async function afterCommit($: EngineInterface, state: State, before: { root: string; stale: Stale[] }, r: ToolCallResult): Promise<ToolCallResult> {
  try {
    const now = await driftNow($, before.root)
    const added = addedBy(before.stale, now)
    state.lastError = undefined
    if (added.length === 0) return r
    // The note goes to the model, the finding to the person: neither reads the other's channel.
    await openFindings($, state, before.root, added, now)
    return withNote(r, noteText(added))
  } catch (err) {
    await report($, state, err)
    return r
  }
}

/** Says the doc holds again, once, and drops the standing finding. */
async function closeOne($: EngineInterface, state: State, key: string, open: Open, side: Closing): Promise<void> {
  state.open.delete(key)
  try {
    await $.sidebar.clear({ consumer: CONSUMER, key: sectionKey(open.doc) })
  } catch {
    // The sidebar mod is not installed.
  }
  const count = open.stale.length
  await toPerson($, open.doc, 'doc lines hold again', doneLines(open.doc, count, side), doneLog(open.doc, count, side))
}

/** Whether the doc itself is gone, which closes a finding from the other side. */
async function isGone($: EngineInterface, key: string): Promise<boolean> {
  try {
    await $.fs.read(key)
    return false
  } catch {
    return true
  }
}

/**
 * Measures one open finding again over its own doc alone. A finding whose measure cannot be read stays
 * open, because a claim this mod cannot check is not a claim it may drop.
 */
async function recheckOne($: EngineInterface, state: State, key: string, open: Open): Promise<void> {
  let now: Stale[]
  try {
    now = await driftNow($, open.root, open.doc)
    state.lastError = undefined
  } catch (err) {
    await report($, state, err)
    return
  }
  const stale = new Set(now.filter(s => s.doc === open.doc).map(identity))
  const left = open.stale.filter(s => stale.has(identity(s)))
  if (left.length === open.stale.length) return
  if (left.length > 0) return void state.open.set(key, { ...open, stale: left })
  await closeOne($, state, key, open, (await isGone($, key)) ? 'gone' : 'holds')
}

/** Measures every open finding again, so neither the pane nor the gate holds a finding the docs dropped. */
async function recheckOpen($: EngineInterface, state: State): Promise<void> {
  for (const [key, open] of [...state.open]) await recheckOne($, state, key, open)
}

/** How many stale lines each open doc still holds, by the path shown to the person. */
function openCounts(state: State): Map<string, number> {
  return new Map([...state.open.values()].map(o => [o.doc, o.stale.length]))
}

/**
 * The files this commit holds, by absolute path, or undefined when git did not answer. Read before the
 * command runs, so it is the index as the commit will take it.
 */
async function stagedPaths($: EngineInterface, command: string): Promise<Set<string> | undefined> {
  try {
    const cwd = commitDir(command, await $.session.cwd())
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
 * The findings this command answers for. A `git commit` answers for its own files alone, so a stale doc
 * the commit does not hold lets it run. A `push` or a `merge` holds no index to read, so every finding
 * stands there.
 */
async function scopeOf($: EngineInterface, state: State, command: string): Promise<Map<string, number>> {
  if (!isCommit(command) || !isNarrowable(command)) return openCounts(state)
  const staged = await stagedPaths($, command)
  if (staged === undefined) return openCounts(state)
  return new Map([...state.open].filter(([key]) => staged.has(key)).map(([, o]) => [o.doc, o.stale.length]))
}

/**
 * The gate: in deny mode a commit, push or merge waits until every open doc holds again. Each finding is
 * measured over its own doc first, so one the model fixed opens the gate itself.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<ToolCallResult | undefined> {
  if (state.mode !== 'deny' || state.open.size === 0 || !isGuarded(command)) return undefined
  await recheckOpen($, state)
  if (state.open.size === 0) return undefined
  const scoped = await scopeOf($, state, command)
  if (scoped.size === 0) {
    $.ui.log(`${state.open.size} doc(s) still hold stale lines, and this command holds none of them`)
    return undefined
  }
  return { deny: denyText(scoped) }
}

async function setMode($: EngineInterface, state: State, arg: string): Promise<string> {
  const mode = modeOf(arg)
  if (mode === undefined) return 'mode expects note or deny'
  await $.store.set(MODE_KEY, mode)
  state.mode = mode
  return mode === 'deny'
    ? 'mode deny: git commit, push and merge stop while a doc line stays stale'
    : 'mode note: nothing is stopped, the finding reaches the model as a note'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const [first = '', second = ''] = args.trim().split(/\s+/)
  if (first === 'mode') return setMode($, state, second)
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each commit is checked for doc lines it made stale' : 'off: commits are not checked'
  }
  if (word !== '') return USAGE
  const open = state.open.size === 0 ? 'no doc is open' : `${[...openCounts(state)].map(([doc, n]) => `${doc} (${n})`).join(' · ')} still stale`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}; it needs ripwire on PATH`
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', open: new Map(), owed: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'doc-drift-watch', description: 'Doc lines a commit made stale: status, on, off, mode note | deny (doc-drift-watch)', argumentHint: '[on | off | mode note | mode deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = modeOf(String(await $.store.get(MODE_KEY))) ?? 'note'
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'doc-drift-watch' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!state.enabled) return next(e)
    const stopped = await gate($, state, e.command)
    if (stopped !== undefined) return stopped
    if (!isCommit(e.command)) return next(e)
    const before = await beforeCommit($, state, e.command)
    const r = await next(e)
    if (before === undefined || r.deny !== undefined || r.isError === true) return r
    return afterCommit($, state, before, r)
  })

  /*
   * The turn's end measures every open finding again and owes the model a note for what is left, because
   * a finding it did not close would otherwise stand in the pane and reach it never again.
   */
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !state.enabled || state.open.size === 0) return r
    await recheckOpen($, state)
    state.owed = state.open.size > 0
    return r
  })

  // The note goes to the model alone; the person reads the pane, which carries the same finding.
  on('prompt.submit', async (_, e, next) => {
    if (!state.owed || state.open.size === 0) return next(e)
    state.owed = false
    return next({ ...e, context: [...(e.context ?? []), openNote(openCounts(state))] })
  })
}
