import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { changedFiles, commitDir, isCommit, isManifest, lockCandidates, logText, noteText, sectionKey, sidebarLines, touchesDependencies, type Stale } from './pairs.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The on/off setting read at session start, and the last error logged, so the same one is logged once. */
type State = { enabled: boolean; lastError?: string }

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
  return touchesDependencies(manifest, diff.out) ? { manifest, lock } : undefined
}

/**
 * The finding the person reads: an entry in the shared sidebar's stream while it is open, else the
 * transcript line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, stale: readonly Stale[]): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'lockfile-sync', key: sectionKey(stale), title: 'lockfiles the commit left out', lines: sidebarLines(stale), until: 'stream' })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(logText(stale))
}

/** The note for the commit that moved HEAD, or undefined when every changed manifest has its lockfile along. */
async function commitNote($: EngineInterface, before: Before): Promise<string | undefined> {
  const head = await git($, before.root, ['rev-parse', 'HEAD'])
  if (!head.ok || head.out.trim() === before.head) return undefined
  const names = await git($, before.root, ['show', '--format=', '--name-status', '--no-renames', 'HEAD'])
  if (!names.ok) throw new Error('git show --name-status HEAD failed')
  const files = changedFiles(names.out)
  const changed = new Set(files)
  const stale: Stale[] = []
  for (const manifest of files.filter(isManifest)) {
    const s = await staleLock($, before.root, manifest, changed)
    if (s !== undefined) stale.push(s)
  }
  if (stale.length === 0) return undefined
  // The note goes to the model, the finding to the person: neither reads the other's channel.
  await toPerson($, stale)
  return noteText(stale)
}

async function afterCommit($: EngineInterface, state: State, before: Before, r: ToolCallResult): Promise<ToolCallResult> {
  if (r.deny !== undefined || r.isError === true) return r
  try {
    const note = await commitNote($, before)
    state.lastError = undefined
    return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }
  } catch (err) {
    report($, state, err)
    return r
  }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    return word === 'on' ? 'on: each commit is checked for manifests whose lockfile it left out' : 'off: commits are not checked'
  }
  return word === '' ? (state.enabled ? 'on' : 'off') : USAGE
}

export const register: Register = on => {
  const state: State = { enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'lockfile-sync', description: 'Manifests a commit changes without their lockfile: status, on, off (lockfile-sync)', argumentHint: '[on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'lockfile-sync' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!state.enabled || !isCommit(e.command)) return next(e)
    const before = await beforeCommit($, state, e.command)
    const r = await next(e)
    return before === undefined ? r : afterCommit($, state, before, r)
  })
}
