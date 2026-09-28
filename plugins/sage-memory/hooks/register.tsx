import type { EngineInterface, Register } from 'claude-code'
import { launchOf, NODE_PROBE, nodeProblem, setupText, stateLine, statusText, tokenOf, valueOf, type Line, type LinkView } from './link.ts'
import { hexOf, keySource, projectKey, projectNameFrom } from './project.ts'
import {
  alwaysBlock,
  CHANGE_TOOLS,
  isReminding,
  isTracked,
  MAIN_LOOP,
  pathsOf,
  promptReminder,
  queryOf,
  reminderLine,
  responseText,
  seen,
  spawnPrompt,
  subagentReminder,
  SYSTEM_NOTE,
  tasksInProgress,
  toolBudget,
  toolReminder,
  usedBy,
  type ToolCall,
} from './remind.ts'
import type { Memory, Ranking, RemapReport, SubagentRanking, VerifyReport } from './shared/model.ts'
import { layoutOf, MAX_SOCKET_BYTES, utf8Bytes, type Layout } from './shared/layout.ts'
import type { EmbedStatus, ProjectRef, SetupJob, Status } from './shared/protocol.ts'

const ENABLED_KEY = 'enabled'
const SECTION = { consumer: 'sage-memory', key: 'state' }
const USAGE = 'expects nothing (the state), on, off or setup'

/** How long each kind of call may take before the mod names it late. */
const NODE_MS = 10_000
const LAUNCH_MS = 30_000
const CALL_MS = 30_000
/** A reminder waits this long for the daemon, then goes without (SAGE's limit). */
const REMIND_MS = 5000
/** How many ranked candidates a reminder asks for; the budget keeps fewer. */
const CANDIDATES = 24
/** How often a running setup job is asked where it is. */
const SETUP_POLL_MS = 2000

/**
 * The on/off setting as last read, the project, the daemon's directory and token, and what the
 * person sees of the link.
 */
type State = {
  enabled: boolean
  project?: ProjectRef
  layout?: Layout
  token?: string
  link: LinkView
  polling: boolean
  /** The connection under way, which a hook that needs the daemon waits for. */
  connecting?: Promise<void>
  /** Whether the system prompt carries the plugin's note; fixed at a session's start and at /clear. */
  guidance: boolean
  /** Per loop: what its context already shows, and the memories it was reminded of and has not used yet. */
  loops: Map<string, Loop>
  /** The subjects of the tasks in progress, read once per main-loop turn. */
  tasks?: string[]
}

type Loop = { visible: string; reminded: Memory[] }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads the on/off setting at the hook that acts on it, because every window shares the store. */
async function readEnabled($: EngineInterface, state: State): Promise<boolean> {
  state.enabled = (await $.store.get(ENABLED_KEY)) !== false
  return state.enabled
}

/** Races `work` with a timer, so a call that never answers is named instead of waited on. */
async function within<T>($: EngineInterface, ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: { cancel: () => void } | undefined
  const late = new Promise<never>((_, reject) => {
    timer = $.clock.after(ms, () => reject(new Error(`${what} gave no answer in ${ms / 1000} s`)))
  })
  try {
    return await Promise.race([work, late])
  } finally {
    timer?.cancel()
  }
}

/** The sidebar section, or the status line while the sidebar does not take it. */
async function toPerson($: EngineInterface, line: Line): Promise<void> {
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'memory', lines: [line], until: 'session', order: 23 })) {
      $.ui.status(undefined)
      return
    }
  } catch {
    // The sidebar mod is not installed; the status line carries the state.
  }
  $.ui.status(line.text)
}

async function show($: EngineInterface, state: State): Promise<void> {
  await toPerson($, stateLine(state.link, state.project?.name ?? ''))
}

async function git($: EngineInterface, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { timeoutMs: 5000, env: { LC_ALL: 'C' } })
  return r.exitCode === 0 ? r.stdout.trim() : ''
}

/** The session's project: its name, the key of its store, its root and the git common dir. */
async function resolveProject($: EngineInterface): Promise<ProjectRef> {
  const cwd = await $.session.cwd()
  const commonDir = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const topLevel = await git($, ['rev-parse', '--show-toplevel'])
  const name = projectNameFrom(commonDir, topLevel, cwd)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keySource(commonDir, cwd)))
  return { key: projectKey(name, hexOf(new Uint8Array(digest))), name, root: topLevel !== '' ? topLevel : cwd, commonDir: keySource(commonDir, cwd) }
}

/** `<config dir>/sage-memory`, where the daemon, its socket and the stores live. */
async function layoutFor($: EngineInterface): Promise<Layout> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
  const layout = layoutOf(`${config.replace(/\/+$/, '')}/sage-memory`)
  const bytes = utf8Bytes(layout.socket)
  if (bytes > MAX_SOCKET_BYTES) throw new Error(`the socket path ${layout.socket} is ${bytes} bytes, over ${MAX_SOCKET_BYTES}`)
  return layout
}

async function checkNode($: EngineInterface): Promise<void> {
  const r = await within($, NODE_MS, 'node', $.process.run(['node', '-p', NODE_PROBE], { timeoutMs: NODE_MS }))
  const problem = r.exitCode === 0 ? nodeProblem(r.stdout) : `node did not run: ${r.stderr.trim().slice(0, 200)}`
  if (problem !== null) throw new Error(problem)
}

/** Runs the launcher, which answers once a daemon of this plugin's protocol listens, and reads its token. */
async function launch($: EngineInterface, layout: Layout): Promise<string> {
  const argv = ['node', '--disable-warning=ExperimentalWarning', `${$.plugin.root}/daemon/launch.ts`, '--dir', layout.dir]
  const r = await within($, LAUNCH_MS, 'the launcher', $.process.run(argv, { timeoutMs: LAUNCH_MS }))
  const outcome = launchOf(r.stdout)
  if (!outcome.ready) throw new Error(outcome.log === undefined ? outcome.error : `${outcome.error}\n${outcome.log}`)
  return tokenOf(await $.fs.read(layout.serverFile))
}

/** One daemon route: its value, or an error that names the route. */
async function ask<T>($: EngineInterface, state: State, path: string, body: Record<string, unknown>, ms = CALL_MS): Promise<T> {
  if (state.layout === undefined || state.token === undefined) throw new Error('the daemon is not connected')
  const init = {
    method: 'POST',
    socketPath: state.layout.socket,
    headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project: state.project, ...body }),
  }
  const r = await within($, ms, path, $.http.fetch(`http://sage-memory${path}`, init))
  return valueOf<T>(path, r.status, r.text)
}

/** Checks Node, finds the project, starts or joins the daemon, and reads its embeddings. */
function connect($: EngineInterface, state: State): Promise<void> {
  const connecting = linkUp($, state)
  state.connecting = connecting
  return connecting
}

async function linkUp($: EngineInterface, state: State): Promise<void> {
  state.link = { state: 'starting' }
  await show($, state)
  try {
    await checkNode($)
    state.project = await resolveProject($)
    state.layout = await layoutFor($)
    state.token = await launch($, state.layout)
    const daemon = await ask<Status>($, state, '/status', {})
    const status = await ask<EmbedStatus>($, state, '/embed/status', {})
    state.link = { state: 'ready', pid: daemon.pid, embedding: status.embedding, setup: status.setup }
  } catch (err) {
    state.link = { state: 'failed', error: errorText(err) }
  }
  await show($, state)
}

/** Follows a setup job every 2 s until it ends, and shows each step. */
async function pollSetup($: EngineInterface, state: State): Promise<void> {
  if (state.polling) return
  state.polling = true
  const tick = $.clock.every(SETUP_POLL_MS, () => {
    void ask<EmbedStatus>($, state, '/embed/status', {}).then(
      status => {
        if (state.link.state === 'ready') state.link = { ...state.link, embedding: status.embedding, setup: status.setup }
        if (status.setup.state !== 'running') {
          tick.cancel()
          state.polling = false
          $.ui.log(setupText(status.setup))
        }
        return show($, state)
      },
      (err: unknown) => {
        tick.cancel()
        state.polling = false
        $.ui.log(`the setup job could not be followed: ${errorText(err)}`)
      },
    )
  })
}

async function setup($: EngineInterface, state: State): Promise<string> {
  if (state.link.state !== 'ready') return `the daemon is not ready: ${statusText(state.enabled, state.link, state.project?.name ?? '')}`
  const job = await ask<SetupJob>($, state, '/embed/setup', {})
  if (job.state === 'running') await pollSetup($, state)
  return setupText(job)
}

async function turn($: EngineInterface, state: State, on: boolean): Promise<string> {
  await $.store.set(ENABLED_KEY, on)
  state.enabled = on
  if (!on) {
    state.link = { state: 'off' }
    await show($, state)
    return 'off: nothing is recalled or saved; the memories stay'
  }
  await connect($, state)
  return `on · ${stateLine(state.link, state.project?.name ?? '').text}`
}

/** Follows another window's on or off, as this window's own command would. */
async function follow($: EngineInterface, state: State): Promise<void> {
  const was = state.enabled
  if ((await readEnabled($, state)) === was) return
  if (state.enabled) await connect($, state)
  else {
    state.link = { state: 'off' }
    await show($, state)
  }
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await follow($, state)
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'off') return turn($, state, word === 'on')
  if (word === 'setup') return setup($, state)
  return word === '' ? statusText(state.enabled, state.link, state.project?.name ?? '') : USAGE
}

/** One stream entry: a reminder faint, a change of a memory green, a failure red; the log line while the pane is closed. */
async function toStream($: EngineInterface, key: string, line: Line): Promise<void> {
  try {
    if (await $.sidebar.set({ consumer: 'sage-memory', key, title: key, lines: [line], until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed; the log line carries the entry.
  }
  $.ui.log(line.text)
}

/** Whether a reminder may go out now: the mod on, and the daemon ready once a connection under way settles. */
async function isReady(state: State): Promise<boolean> {
  await state.connecting
  return state.enabled && state.link.state === 'ready'
}

function loopOf(state: State, key: string): Loop {
  const found = state.loops.get(key)
  if (found !== undefined) return found
  const loop: Loop = { visible: '', reminded: [] }
  state.loops.set(key, loop)
  return loop
}

/** Runs one daemon call a hook can go without, and writes a red entry when it fails. */
async function guarded<T>($: EngineInterface, what: string, work: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await work()
  } catch (err) {
    await toStream($, 'error', { text: `${what} failed: ${errorText(err)}`, kind: 'error' })
    return undefined
  }
}

type Block = { text: string; sent: Memory[] }

/** Records a reminder the hooks sent: the daemon counts it for the loop's context, and the loop keeps it for the use count. */
async function record($: EngineInterface, state: State, loopKey: string, trigger: string, block: Block): Promise<void> {
  const loop = loopOf(state, loopKey)
  loop.visible = seen(loop.visible, block.text)
  loop.reminded.push(...block.sent.filter(isTracked))
  await ask($, state, '/memory/reminded', { sessionId: await $.session.id(), loop: loopKey, trigger, ids: block.sent.map(memory => memory.id) })
  await toStream($, 'reminder', { text: reminderLine(trigger, block.sent), kind: 'dim' })
}

/** The block's text once recorded, or nothing when the block carries no memory. */
async function deliver($: EngineInterface, state: State, loopKey: string, trigger: string, block: Block): Promise<string | undefined> {
  if (block.sent.length === 0) return undefined
  await record($, state, loopKey, trigger, block)
  return block.text
}

/**
 * The subjects of the tasks in progress, read once per main-loop turn. A session without the task
 * tools answers with a refusal, which leaves the query without tasks.
 */
async function tasksOf($: EngineInterface, state: State): Promise<string[]> {
  if (state.tasks !== undefined) return state.tasks
  const answer = await $.tool.call({ tool: 'TaskList' })
  state.tasks = 'deny' in answer && answer.deny !== undefined ? [] : tasksInProgress(answer.result)
  return state.tasks
}

/** How much a reminder may carry: the main loop's by how full its context is, a subagent's the whole budget. */
async function budgetOf($: EngineInterface, loopKey: string): Promise<ReturnType<typeof toolBudget>> {
  return toolBudget(loopKey === MAIN_LOOP ? (await $.session.usage()).context.percent : 0)
}

/** The reminder after a batch of tool calls, or nothing. Every result the batch read joins what the loop shows. */
async function afterBatch($: EngineInterface, state: State, calls: readonly ToolCall[], loopKey: string): Promise<string | undefined> {
  const loop = loopOf(state, loopKey)
  for (const call of calls) loop.visible = seen(loop.visible, responseText(call.tool_response))
  const reminding = calls.filter(isReminding)
  if (reminding.length === 0 || !(await isReady(state))) return undefined
  const budget = await budgetOf($, loopKey)
  if (budget.count === 0) return undefined
  const paths = [...new Set(reminding.flatMap(pathsOf))]
  const tasks = loopKey === MAIN_LOOP ? await tasksOf($, state) : []
  const mutation = reminding.some(call => CHANGE_TOOLS.has(call.tool_name))
  const body = { sessionId: await $.session.id(), loop: loopKey, paths, query: queryOf(reminding, paths, tasks), mutation, limit: CANDIDATES }
  const ranking = await ask<Ranking>($, state, '/remind/tools', body, REMIND_MS)
  return deliver($, state, loopKey, 'tools', toolReminder(ranking.candidates, loop.visible, budget, loopKey !== MAIN_LOOP, tasks.length > 0))
}

/** The reminder with a prompt the person typed, or nothing. */
async function beforePrompt($: EngineInterface, state: State, text: string): Promise<string | undefined> {
  await follow($, state)
  if (!(await isReady(state))) return undefined
  const body = { sessionId: await $.session.id(), loop: MAIN_LOOP, query: text.slice(0, 4000), limit: CANDIDATES }
  const ranking = await ask<Ranking>($, state, '/remind/prompt', body, REMIND_MS)
  return deliver($, state, MAIN_LOOP, 'prompt', promptReminder(ranking.candidates, loopOf(state, MAIN_LOOP).visible))
}

type Spawn = { prompt: string; subagentType: string; permissionMode?: string }

/** What a subagent starts with, or nothing. */
async function forSubagent($: EngineInterface, state: State, e: Spawn): Promise<Block | undefined> {
  await follow($, state)
  if (!(await isReady(state))) return undefined
  const body = { sessionId: await $.session.id(), role: e.subagentType, mode: e.permissionMode, task: e.prompt.slice(0, 4000) }
  const ranking = await ask<SubagentRanking>($, state, '/remind/subagent', body, REMIND_MS)
  const block = subagentReminder(ranking.audience, ranking.task)
  return block.sent.length > 0 ? block : undefined
}

/** Counts the reminded memories an answer used, each reminder once. */
async function countUse($: EngineInterface, state: State, loopKey: string, answer: string): Promise<void> {
  const loop = state.loops.get(loopKey)
  if (loop === undefined || loop.reminded.length === 0 || !(await isReady(state))) return
  const used = usedBy(answer, loop.reminded)
  if (used.length === 0) return
  loop.reminded = loop.reminded.filter(memory => !used.includes(memory))
  await ask($, state, '/memory/used', { sessionId: await $.session.id(), source: 'assistant_reference', ids: used.map(memory => memory.id) })
}

/** Starts a loop's context over after a compaction: the daemon opens a new epoch, and the loop forgets what it showed. */
async function newContext($: EngineInterface, state: State, loopKey: string): Promise<void> {
  state.loops.delete(loopKey)
  if (await isReady(state)) await ask($, state, '/context/new', { sessionId: await $.session.id(), loop: loopKey })
}

/** The block of `always` memories for a session's start, /clear, resume and each compaction. */
async function alwaysText($: EngineInterface, state: State): Promise<string | undefined> {
  if (!(await isReady(state))) return undefined
  const memories = await ask<Memory[]>($, state, '/remind/always', { sessionId: await $.session.id(), limit: 100 })
  const text = alwaysBlock(memories)
  if (text === undefined) return undefined
  await ask($, state, '/memory/reminded', { sessionId: await $.session.id(), trigger: 'always', ids: memories.map(memory => memory.id) })
  return text
}

function verifiedLine(what: string, report: { staled: string[]; reactivated: string[] }): Line | undefined {
  const parts = [report.staled.length > 0 ? `${report.staled.length} memory(ies) went stale` : '', report.reactivated.length > 0 ? `${report.reactivated.length} came back` : '']
  const text = parts.filter(part => part !== '').join(', ')
  return text === '' ? undefined : { text: `${what}: ${text}`, kind: report.staled.length > 0 ? 'warn' : 'ok' }
}

/** Checks the memories anchored to files a tool just changed. */
async function verifyChanged($: EngineInterface, state: State, paths: readonly string[]): Promise<void> {
  if (paths.length === 0 || !(await isReady(state))) return
  const report = await ask<VerifyReport>($, state, '/memory/verify-paths', { sessionId: await $.session.id(), paths })
  const line = verifiedLine('after the edit', report)
  if (line !== undefined) await toStream($, 'verify', line)
}

/** A command that may move files: `mv`, `git mv` or `Move-Item`. */
const MOVES = /(^|[\s;&|(])(mv|Move-Item)\s/

/** Carries the anchors of the files a command moved, read from the directory it started in. */
async function remapMoved($: EngineInterface, state: State, command: string, cwd: string): Promise<void> {
  if (!MOVES.test(command) || !(await isReady(state))) return
  const report = await ask<RemapReport>($, state, '/memory/remap', { sessionId: await $.session.id(), command, cwd })
  const moved = report.moves.reduce((sum, move) => sum + move.memories.length, 0)
  if (moved > 0) await toStream($, 'verify', { text: `anchors of ${moved} memory(ies) moved with ${report.moves.length} file(s)`, kind: 'ok' })
  const line = verifiedLine('after the move', report)
  if (line !== undefined) await toStream($, 'verify', line)
}

function succeeded(result: object): boolean {
  return !('deny' in result && result.deny !== undefined) && !('isError' in result && result.isError === true)
}

/** A hook result with one more context text, or unchanged when there is none. */
function withContext<R extends { additionalContext?: readonly string[] }>(r: R, text: string | undefined): R {
  return text === undefined ? r : { ...r, additionalContext: [...(r.additionalContext ?? []), text] }
}

/** /clear fixes the system prompt note again and forgets every loop; a compaction starts the main loop over; every start gets the `always` memories. */
async function atSessionStart($: EngineInterface, state: State, source: string): Promise<string | undefined> {
  if (source === 'clear') {
    state.guidance = await readEnabled($, state)
    state.loops.clear()
  }
  if (source === 'compact') await guarded($, 'starting the context over', () => newContext($, state, MAIN_LOOP))
  return guarded($, 'the always memories', () => alwaysText($, state))
}

/** A prompt the person typed, not a command: the prompts a reminder goes with. */
function isTyped(e: { text: string; origin: { kind: string } }): boolean {
  return (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !e.text.startsWith('/')
}

export const register: Register = on => {
  const state: State = { enabled: true, link: { state: 'off' }, polling: false, guidance: false, loops: new Map() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sage-memory', description: 'Project memory recalled when it is relevant: state, on, off, setup (sage-memory)', argumentHint: '[on | off | setup]' })
    state.guidance = await readEnabled($, state)
    if (state.enabled) await connect($, state)
    else await show($, state)
    return r
  })

  // The note is fixed at a session's start or /clear, so a change of the setting leaves the prompt the cache holds alone.
  on('prompt.section', { name: 'env_info_simple' }, async (_, e, next) => {
    const r = await next(e)
    return r.text === null || !state.guidance ? r : { text: `${r.text}\n\n${SYSTEM_NOTE}` }
  })

  // Every source (startup, resume, /clear, compaction) gets the `always` memories; /clear and a compaction start the context over.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    return e.agent_id === undefined ? withContext(r, await atSessionStart($, state, e.source)) : r
  })

  // A subagent's compaction; the main loop's arrives through classic.SessionStart above.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    const agentId = e.agentId
    if (agentId !== undefined) await guarded($, 'starting the context over', () => newContext($, state, agentId))
    return r
  })

  // CLAUDE.md and the other context blocks: a memory they already hold is not reminded.
  on('prompt.context', async (_, e, next) => {
    const r = await next(e)
    const loop = loopOf(state, MAIN_LOOP)
    for (const block of r.blocks) loop.visible = seen(loop.visible, block.text)
    return r
  })

  // What the engine and every hook add (memory-save's MEMORY.md, this mod's own blocks) joins what the loop shows.
  on('prompt.attachment', async (_, e, next) => {
    const r = await next(e)
    const loop = loopOf(state, e.agentId ?? MAIN_LOOP)
    loop.visible = seen(loop.visible, r.text ?? '')
    return r
  })

  on('classic.PostToolBatch', async ($, e, next) => {
    const r = await next(e)
    return withContext(r, await guarded($, 'the reminder after the tools', () => afterBatch($, state, e.tool_calls, e.agent_id ?? MAIN_LOOP)))
  })

  on('prompt.submit', async ($, e, next) => {
    const text = isTyped(e) ? await guarded($, 'the reminder with the prompt', () => beforePrompt($, state, e.text)) : undefined
    return next(text === undefined ? e : { ...e, context: [...(e.context ?? []), text] })
  })

  on('agent.spawn', async ($, e, next) => {
    const block = await guarded($, 'the reminder for the subagent', () => forSubagent($, state, e))
    if (block === undefined) return next(e)
    const r = await next({ ...e, prompt: spawnPrompt(block.text, e.prompt) })
    const agentId = r.agentId
    if (agentId !== undefined) await guarded($, 'recording the subagent reminder', () => record($, state, agentId, 'subagent', block))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const loopKey = e.agentId ?? MAIN_LOOP
    if (e.reason === 'answer') await guarded($, 'counting the used memories', () => countUse($, state, loopKey, e.answer))
    if (e.agentId !== undefined) state.loops.delete(e.agentId)
    return r
  })

  // A changed file checks the memories anchored to it again.
  on('tool.call', { tool: /^(Edit|Write|NotebookEdit|MultiEdit)$/ }, async ($, e, next) => {
    const r = await next(e)
    if (succeeded(r)) await guarded($, 'checking the changed file', () => verifyChanged($, state, pathsOf({ tool_name: e.tool, tool_input: e })))
    return r
  })

  // The directory is read before the command runs, because a `cd` in it moves the shell.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cwd = await $.session.cwd()
    const r = await next(e)
    if (succeeded(r)) await guarded($, 'moving anchors', () => remapMoved($, state, e.command, cwd))
    return r
  })

  on('command.run', { command: 'sage-memory' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  // Each turn follows an on or off another window stored, before it would recall anything.
  on('turn.start', async ($, e, next) => {
    state.tasks = undefined
    await follow($, state)
    return next(e)
  })
}
