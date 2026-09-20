import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { addedBy, commitDir, isCommit, logText, noteText, parseDrift, sectionKey, sidebarLines, type Stale } from './drift.ts'

const ENABLED_KEY = 'enabled'

const USAGE = 'expects nothing (the status), on or off'

/** The last error logged, so the same one is logged once. */
type State = { lastError?: string }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

async function repoRoot($: EngineInterface, cwd: string): Promise<string | undefined> {
  const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 10_000 })
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

/** The repository's stale doc anchors now; `--with-history` tells a deleted name from one never defined. */
async function driftNow($: EngineInterface, root: string): Promise<Stale[]> {
  const r = await $.process.run(['ripwire', root, '--doc-drift', '--with-history'], { cwd: root, timeoutMs: 30_000 })
  if (r.exitCode !== 0) throw new Error(`ripwire --doc-drift failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`)
  return parseDrift(r.stdout)
}

/** Logs an error once until a different one comes. */
function report($: EngineInterface, state: State, err: unknown): void {
  const text = errorText(err)
  if (text !== state.lastError) $.ui.log(`the docs were not checked: ${text}`)
  state.lastError = text
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
    report($, state, err)
    return undefined
  }
}

/**
 * The finding the person reads: a section of the shared sidebar while it is open, else the transcript
 * line, as before. The model's note is another channel and does not change here.
 */
async function toPerson($: EngineInterface, added: readonly Stale[]): Promise<void> {
  try {
    const taken = await $.sidebar.set({ consumer: 'doc-drift-watch', key: sectionKey(added), title: 'doc lines the commit made stale', lines: sidebarLines(added), until: 'turn', order: 50 })
    if (taken) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(logText(added))
}

async function afterCommit($: EngineInterface, state: State, before: { root: string; stale: Stale[] }, r: ToolCallResult): Promise<ToolCallResult> {
  try {
    const added = addedBy(before.stale, await driftNow($, before.root))
    state.lastError = undefined
    if (added.length === 0) return r
    // The note goes to the model, the finding to the person: neither reads the other's channel.
    await toPerson($, added)
    return withNote(r, noteText(added))
  } catch (err) {
    report($, state, err)
    return r
  }
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const word = args.trim()
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    return word === 'on' ? 'on: each commit is checked for doc lines it made stale' : 'off: commits are not checked'
  }
  return word === '' ? `${(await isEnabled($)) ? 'on' : 'off'}; it needs ripwire on PATH` : USAGE
}

export const register: Register = on => {
  const state: State = {}

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'doc-drift-watch', description: 'Doc lines a commit made stale: status, on, off (doc-drift-watch)', argumentHint: '[on | off]' })
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'doc-drift-watch' }, async ($, e) => ({ text: await runCommand($, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isCommit(e.command) || !(await isEnabled($))) return next(e)
    const before = await beforeCommit($, state, e.command)
    const r = await next(e)
    if (before === undefined || r.deny !== undefined || r.isError === true) return r
    return afterCommit($, state, before, r)
  })
}
