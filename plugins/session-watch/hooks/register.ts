import type { EngineInterface, Register } from 'claude-code'
import { addSplit, failedGit, NO_SPLIT, parseStatus, sidebarLines, statusText, storedSplits, withSplit, type Effort, type GitState, type Reading, type Split, type Usage } from './watch.ts'

const SPLITS_KEY = 'tokens'
const TICK_MS = 30_000
const GIT_MS = 10_000
/** A Bash command that may move the branch or the working tree. */
const GIT_COMMAND = /\bgit\b/

/**
 * What the hooks share: the repository the session started in, the session id, the token totals, the main
 * loop's last thinking setting, the engine's version, the last git state, and the last refresh error.
 */
type State = { root: string; sid: string; split: Split; effort: Effort; version: string; git?: GitState; lastError?: string }

/** The git state of the session's directory, from one `git status` run. */
async function readGit($: EngineInterface, state: State): Promise<GitState> {
  try {
    const r = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd: state.root, timeoutMs: GIT_MS })
    return r.exitCode === 0 ? parseStatus(r.stdout) : failedGit(r.stderr)
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

/** Everything the section shows, read now. */
async function readNow($: EngineInterface, state: State): Promise<Reading> {
  const [usage, model, git] = await Promise.all([$.session.usage(), $.session.model(), readGit($, state)])
  state.git = git
  return { context: usage.context, costUsd: usage.cost?.usd, split: state.split, model, effort: state.effort, version: state.version, git }
}

/** Writes the reading into the sidebar, and into the status line while the sidebar does not take it. */
async function show($: EngineInterface, reading: Reading): Promise<void> {
  let shown = false
  try {
    shown = await $.sidebar.set({ consumer: 'session-watch', key: 'session', title: 'session', lines: sidebarLines(reading), until: 'session', order: 5 })
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.status(shown ? undefined : statusText(reading))
}

/** Reads and shows; a failed read is logged once instead of thrown, because a timer has no hook to fail. */
async function refresh($: EngineInterface, state: State): Promise<void> {
  try {
    await show($, await readNow($, state))
    state.lastError = undefined
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    if (text !== state.lastError) $.ui.log(`cannot read the session: ${text}`)
    state.lastError = text
  }
}

/** Adds one turn's tokens and keeps the totals in the store, so a reloaded module goes on from them. */
async function countTurn($: EngineInterface, state: State, usage: Usage | undefined): Promise<void> {
  if (usage === undefined) return
  state.split = addSplit(state.split, usage)
  await $.store.set(SPLITS_KEY, withSplit(storedSplits(await $.store.get(SPLITS_KEY)), state.sid, state.split))
}

/** The `/session-watch` answer: the reading as the section's lines. */
async function commandText($: EngineInterface, state: State): Promise<string> {
  const reading = await readNow($, state)
  await show($, reading)
  return sidebarLines(reading).map(l => l.text).join('\n')
}

export const register: Register = on => {
  const state: State = { root: '', sid: '', split: NO_SPLIT, effort: undefined, version: '' }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.root = await $.session.root()
    state.sid = await $.session.id()
    state.version = (await $.session.version()).version
    state.split = storedSplits(await $.store.get(SPLITS_KEY))[state.sid] ?? NO_SPLIT
    await $.command.register({ name: 'session-watch', description: 'This session\'s context, tokens, cost, model, version and git state (session-watch)', immediate: true })
    // A -p run draws nothing, so only an interactive session refreshes on a timer.
    if (e.isInteractive) $.clock.every(TICK_MS, () => void refresh($, state))
    await refresh($, state)
    return r
  })

  // The main loop's request says how hard it asks the model to think; a subagent's has its own setting.
  on('turn.step', async function* (_$, e, next) {
    if (e.agentId === undefined) state.effort = e.effort ?? null
    return yield* next(e)
  })

  // Every loop's turn counts toward the totals, as /cost counts them; the main loop's end redraws.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await countTurn($, state, e.usage)
    if (e.agentId === undefined) await refresh($, state)
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (GIT_COMMAND.test(e.command)) await refresh($, state)
    return r
  })

  // The engine prints the plugin name in front of command text, so the text does not repeat it.
  on('command.run', { command: 'session-watch' }, async $ => ({ text: await commandText($, state) }))
}
