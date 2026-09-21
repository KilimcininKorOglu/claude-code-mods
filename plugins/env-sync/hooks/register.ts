import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { commitDir, denyText, diffReads, doneLines, doneLog, doneTitle, fileReads, isCommit, isGuarded, listedNames, logText, modeOf, noteText, openReads, REFERENCE_FILES, sectionKey, sidebarLines, type Mode, type Open } from './env.ts'

const ENABLED_KEY = 'enabled'
const MODE_KEY = 'mode'

const USAGE = 'expects nothing (the status), on, off or mode note | deny'

/**
 * The on/off setting read at session start, the mode, and the last error logged, so the same one is
 * logged once. `open` holds the variables the last finding named, so a commit that adds them all
 * closes it, and in `deny` mode it also holds the gate shut.
 */
type State = { enabled: boolean; mode: Mode; lastError?: string; open: Open[] }

/** The repository and its HEAD before the commit; `head` is empty before the first commit. */
type Before = { root: string; head: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the commit's env reads were not checked: ${text}`)
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

/** The first reference file at the root, or undefined when the repository has none. */
async function referenceFile($: EngineInterface, root: string): Promise<string | undefined> {
  for (const name of REFERENCE_FILES) if (await $.fs.exists(`${root}/${name}`)) return name
  return undefined
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, reference: string, title: string, lines: { text: string; kind: 'error' | 'ok' }[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'env-sync', key: sectionKey(reference), title, lines, until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line)
}

/** Drops the sidebar entries of one finding, so a variable that was added leaves no warning behind. */
async function dropEntry($: EngineInterface, reference: string): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'env-sync', key: sectionKey(reference) })
  } catch {
    // The sidebar mod is not installed.
  }
}

/**
 * Whether the file whose added lines read this variable still reads it. A file that is no longer there
 * reads nothing; one that is there and cannot be read counts as still reading, because it proves nothing.
 */
async function stillRead($: EngineInterface, root: string, open: Open): Promise<boolean> {
  const path = `${root}/${open.file}`
  try {
    if (!(await $.fs.exists(path))) return false
    return fileReads(String(await $.fs.read(path))).has(open.name)
  } catch {
    return true
  }
}

/**
 * Measures the open finding again and closes it when nothing it named stands: the reference file gained
 * the variable, or the code stopped reading it. Each measure reads the source again, so the finding is a
 * claim and never an answer.
 */
async function recheckOpen($: EngineInterface, state: State, root: string, reference: string, listed: ReadonlySet<string>): Promise<void> {
  if (state.open.length === 0) return
  const added: string[] = []
  const gone: string[] = []
  const left: Open[] = []
  for (const open of state.open) {
    if (listed.has(open.name)) added.push(open.name)
    else if (await stillRead($, root, open)) left.push(open)
    else gone.push(open.name)
  }
  state.open = left
  if (left.length > 0 || added.length + gone.length === 0) return
  await dropEntry($, reference)
  await toPerson($, reference, doneTitle(added, gone, reference), doneLines(added, gone), doneLog(added, gone, reference))
}

/** The note for the commit that moved HEAD, or undefined when it reads no variable the reference file lacks. */
async function commitNote($: EngineInterface, state: State, before: Before): Promise<string | undefined> {
  const head = await git($, before.root, ['rev-parse', 'HEAD'])
  const reference = await referenceFile($, before.root)
  if (!head.ok || head.out.trim() === before.head || reference === undefined) return undefined
  const diff = await git($, before.root, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', 'HEAD'])
  if (!diff.ok) throw new Error('git show HEAD failed')
  const listed = listedNames(await $.fs.read(`${before.root}/${reference}`))
  await recheckOpen($, state, before.root, reference, listed)
  const missing = diffReads(diff.out).filter(r => !listed.has(r.name))
  if (missing.length === 0) return undefined
  state.open = openReads(state.open, missing)
  // The note goes to the model, the finding to the person: neither reads the other's channel.
  await toPerson($, reference, `env variables ${reference} lacks`, sidebarLines(missing), logText(missing, reference))
  return noteText(missing, reference)
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

/**
 * The gate: in deny mode a commit, push or merge waits while the reference file still lacks a variable.
 * The reference file is read again first, so a commit that added the variables opens the gate itself.
 */
async function gate($: EngineInterface, state: State, command: string): Promise<{ deny: string } | undefined> {
  if (!state.enabled || state.mode !== 'deny' || state.open.length === 0 || !isGuarded(command)) return undefined
  try {
    const before = await beforeCommit($, state, command)
    const reference = before === undefined ? undefined : await referenceFile($, before.root)
    if (before === undefined || reference === undefined) return undefined
    await recheckOpen($, state, before.root, reference, listedNames(await $.fs.read(`${before.root}/${reference}`)))
    return state.open.length === 0 ? undefined : { deny: denyText(state.open.map(o => o.name), reference) }
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
    ? 'mode deny: git commit, push and merge stop while the reference file lacks a variable'
    : 'mode note: nothing is stopped, the finding reaches the model as a note'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const [first = '', second = ''] = args.trim().split(/\s+/)
  if (first === 'mode') return setMode($, state, second)
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each commit is checked for env reads .env.example lacks' : 'off: commits are not checked'
  }
  if (word !== '') return USAGE
  const open = state.open.length === 0 ? 'no variable is open' : `${state.open.map(o => o.name).join(' · ')} still missing`
  return `${state.enabled ? 'on' : 'off'} · mode ${state.mode} · ${open}`
}

export const register: Register = on => {
  const state: State = { enabled: true, mode: 'note', open: [] }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'env-sync', description: 'Env variables a commit reads that .env.example lacks: status, on, off, mode note | deny (env-sync)', argumentHint: '[on | off | mode note | mode deny]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.mode = modeOf(String(await $.store.get(MODE_KEY))) ?? 'note'
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'env-sync' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const stopped = await gate($, state, e.command)
    if (stopped !== undefined) return stopped
    if (!state.enabled || !isCommit(e.command)) return next(e)
    const before = await beforeCommit($, state, e.command)
    const r = await next(e)
    return before === undefined ? r : afterCommit($, state, before, r)
  })
}
