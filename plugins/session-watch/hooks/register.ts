import type { EngineInterface, Register } from 'claude-code'
import {
  addSplit, endFile, failedGit, usageOf, valueOf, NO_SPLIT, parseStatus, scanUsage, sidebarLines, statusText, storedSplits, sumSplits, transcriptDir, usageScannerOf, usageTotal, withSplit,
  type Effort, type GitState, type Reading, type Split, type Usage,
} from './watch.ts'

/** The totals of each session, counted from its transcripts on. */
const TOTALS_KEY = 'totals'
/** Where 0.1.0 kept totals counted from the module's first load; they are read again from the transcripts. */
const OLD_KEY = 'tokens'
const TICK_MS = 30_000
const GIT_MS = 10_000
/** A Bash command that may move the branch or the working tree. */
const GIT_COMMAND = /\bgit\b/

/**
 * What the hooks share: the repository the session started in, the session id, the token totals, the main
 * loop's last thinking setting, the engine's version, the last git state, and the last refresh error.
 */
type State = { root: string; sid: string; split: Split; seeding: boolean; effort: Effort; version: string; git?: GitState; lastError?: string }

/** A transcript and its size when the reading began. */
type Transcript = { path: string; size: number }

async function configDirOf($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
}

/** The session's transcripts and their sizes now: the main loop's and each subagent's. */
async function transcriptsOf($: EngineInterface, state: State): Promise<Transcript[]> {
  const dir = transcriptDir(await configDirOf($), state.root)
  const main = `${dir}/${state.sid}.jsonl`
  const subs = `${dir}/${state.sid}/subagents`
  const paths = (await $.fs.exists(main)) ? [main] : []
  if (await $.fs.exists(subs)) {
    for (const f of await $.fs.list(subs)) if (f.kind === 'file' && f.name.endsWith('.jsonl')) paths.push(`${subs}/${f.name}`)
  }
  return Promise.all(paths.map(async path => ({ path, size: (await $.fs.stat(path)).size })))
}

/**
 * The transcripts' totals, streamed up to the sizes they had when the reading began, because a
 * transcript can pass the file read limit, and what was written after it is counted turn by turn.
 */
async function readTotals($: EngineInterface, files: readonly Transcript[]): Promise<Split> {
  const s = usageScannerOf()
  for (const f of files) {
    let err = ''
    for await (const chunk of $.process.spawn({ argv: ['head', '-c', String(f.size), f.path] })) {
      if (chunk.stream === 'stdout') scanUsage(s, chunk.text)
      else err += chunk.text
    }
    if (err !== '') throw new Error(`${f.path}: ${err.trim()}`)
    endFile(s)
  }
  return usageTotal(s)
}

async function keepTotals($: EngineInterface, state: State): Promise<void> {
  await $.store.set(TOTALS_KEY, withSplit(storedSplits(await $.store.get(TOTALS_KEY)), state.sid, state.split))
}

/** Adds the transcripts' totals under the turns counted while they were read, then keeps and draws them. */
async function seedTotals($: EngineInterface, state: State, files: readonly Transcript[]): Promise<void> {
  try {
    state.split = sumSplits(await readTotals($, files), state.split)
  } catch (err) {
    $.ui.log(`the token totals count from the module's load, because the transcripts were not read: ${err instanceof Error ? err.message : String(err)}`)
  }
  state.seeding = false
  await keepTotals($, state)
  await refresh($, state)
}

/**
 * The totals this session kept, or a reading of its transcripts started for a session with none. The
 * sizes are read now, so a turn that ends after this point is counted once, by `turn.complete`.
 */
async function startTotals($: EngineInterface, state: State): Promise<void> {
  const kept = storedSplits(await $.store.get(TOTALS_KEY))[state.sid]
  await $.store.delete(OLD_KEY)
  state.split = kept ?? NO_SPLIT
  if (kept !== undefined) return
  try {
    const files = await transcriptsOf($, state)
    state.seeding = true
    // The reading outlives the session.start dispatch, so it runs from a timer.
    $.clock.after(0, () => void seedTotals($, state, files))
  } catch (err) {
    $.ui.log(`the token totals count from the module's load, because the transcripts were not found: ${err instanceof Error ? err.message : String(err)}`)
  }
}

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
  return { context: usage.context, costUsd: usage.cost?.usd, split: state.split, seeding: state.seeding, model, effort: state.effort, version: state.version, git }
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

/**
 * Adds one turn's tokens and keeps the totals in the store, so a reloaded module goes on from them.
 * While the transcripts are read the totals are partial, so they are kept once the reading ends.
 */
async function countTurn($: EngineInterface, state: State, usage: Usage | undefined): Promise<void> {
  if (usage === undefined) return
  state.split = addSplit(state.split, usage)
  if (!state.seeding) await keepTotals($, state)
}

/** The `/session-watch` answer: the reading as the section's lines. */
async function commandText($: EngineInterface, state: State): Promise<string> {
  const reading = await readNow($, state)
  await show($, reading)
  return sidebarLines(reading).map(l => l.text).join('\n')
}

export const register: Register = on => {
  const state: State = { root: '', sid: '', split: NO_SPLIT, seeding: false, effort: undefined, version: '' }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.root = await $.session.root()
    state.sid = await $.session.id()
    state.version = (await $.session.version()).version
    await startTotals($, state)
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

  // A plugin's own model calls and a compaction's summary are requests no transcript records, so they
  // count here, as /cost counts them. The engine's own side calls reach no hook and stay out.
  // A model call is an op event: its hooks resolve to `{ value }` or `{ deny }`, not the bare result.
  on('model.fork', async ($, e, next) => {
    const r = await next(e)
    await countTurn($, state, usageOf(valueOf(r)))
    return r
  })

  on('model.complete', async ($, e, next) => {
    const r = await next(e)
    await countTurn($, state, usageOf(valueOf(r)))
    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    await countTurn($, state, usageOf(r))
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
