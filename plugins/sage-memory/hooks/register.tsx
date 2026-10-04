import type { EngineInterface, Register } from 'claude-code'
import {
  countsLine,
  jobText,
  workingLine,
  faint,
  launchOf,
  listed,
  NODE_PROBE,
  nodeProblem,
  partsLine,
  setupText,
  stateLine,
  stateLines,
  statusText,
  storedLine,
  tokenOf,
  valueOf,
  wordLine,
  type Line,
  type LinkView,
  type Part,
  type SessionCounts,
  type StoredCounts,
} from './link.ts'
import { hexOf, keySource, projectKey, projectNameFrom } from './project.ts'
import {
  actedOn,
  CHANGE_TOOLS,
  isReminding,
  MAIN_LOOP,
  globalReminder,
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
import {
  additionsOf,
  addedLine,
  CONSOLIDATE_MS,
  CONSOLIDATE_TOKENS,
  CONSOLIDATOR_SYSTEM,
  completedTasks,
  consolidatorPrompt,
  DEFAULT_MODEL,
  MAX_ASKED,
  emptyEvidence,
  evidenceText,
  followedOf,
  judgedNext,
  MIN_ANSWER,
  noted,
  relativeTo,
  safeCommand,
  topByImportance,
  type TurnEvidence,
} from './consolidate.ts'
import { CURATE_MS, CURATE_TOKENS, CURATED_FILES, CURATOR_SYSTEM, curatorPrompt, emptyTally, MAX_TARGETS, PER_FILE, stepsOf, tallyLine, type Step, type Tally } from './curate.ts'
import {
  auditText,
  bulletsOf,
  candidatesText,
  detailText,
  fileText,
  flagsOf,
  graphText,
  hygieneText,
  importFlagsOf,
  importInput,
  importReport,
  type ImportTally,
  listText,
  patchOf as flagPatchOf,
  rememberInputOf,
  statsText,
  verifyText,
  wordsOf,
} from './commands.ts'
import { captureOf, HOUR_MS, mayCapture, outputOf } from './capture.ts'
import { COMPACT_MAX, COMPACT_MS, COMPACT_TOKENS, compactPrompt, compactSystem, planOf, planText, type Change, type Plan } from './compact.ts'
import {
  actionOf,
  discardDeletion,
  MERGE_SYSTEM,
  mergesOf,
  mergeVerdictOf,
  pairPrompt,
  pairsOf,
  patchOf,
  preFilter,
  proposalInput,
  proposalOf,
  proposalsToFile,
  RATE_SYSTEM,
  ratePrompt,
  ratedDeletion,
  ratingOf,
  reportText,
  valueScore,
  type Deletion,
  type Merge,
  type Pair,
  type Proposal,
  type Report,
  type Score,
} from './triage.ts'
import { addedBy, callOf, editLine, OFF_TEXT, resultText, toolName, TOOLS, type Input } from './tools.ts'
import { emptyPane, listBody, PAGE_SIZE, PANE_ID, paneTree, patchFor, refilter, turnPage, type CandidateAction, type Handlers, type PaneAction, type PaneState } from './pane.tsx'
import type { AuditEntry, Candidate, FileMemories, GraphEdge, HygieneRun, Memory, MemoryPage, StoreStats, Ranking, RememberInput, RememberResult, RemapReport, SubagentRanking, VerifyReport } from './shared/model.ts'
import { layoutOf, MAX_SOCKET_BYTES, utf8Bytes, type Layout } from './shared/layout.ts'
import type { EmbedStatus, ProjectRef, SetupJob, Status } from './shared/protocol.ts'

const ENABLED_KEY = 'enabled'
const SECTION = { consumer: 'sage-memory', key: 'state' }
const USAGE = [
  'expects one of:',
  '  (nothing) the state · on · off · setup',
  '  show <id> · search <query> · file <path> · graph <id|query> · audit [n] · stats',
  '  remember [flags] <text> · update <id> [flags] [text] · delete <id> · forget <query> · recover <id>',
  '  audience remember --role <type> <text> | clear <id> | transfer <from> <to>',
  '  hygiene · verify [id] · candidates [list|accept|reject|resolve] · triage [apply] · compact [apply]',
  '  import <path> [--section <heading>] [--kind <kind>] [--scope project|user] [--policy <p>] [--tag <t>] [--importance <n>] [--confidence <n>]',
  '  pane (the memory manager)',
  '  model [name] · remind tools|prompt|subagent [on|off] · consolidate|curate [on|off] · daily [on|off] · capture outcomes|errors [on|off]',
  'flags: --kind --scope --status --persistence --policy --tag --anchor --directory --symbol path#Name --command --agent --role --mode --importance --confidence --freshness --supersedes --contradicts',
].join('\n')

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
/** How often an idle session draws the section again, so counts another window or project changed show. */
const REDRAW_MS = 60_000

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
  /** A relaunch after the daemon went away, shared by every request that found it gone. */
  relinking?: Promise<void>
  /** Whether the system prompt carries the plugin's note; fixed at a session's start and at /clear. */
  guidance: boolean
  /** Per loop: what its context already shows, and the memories it was reminded of and has not used yet. */
  loops: Map<string, Loop>
  /** The subjects of the tasks in progress, read once per main-loop turn, so parallel tool calls share one read. */
  tasks?: Promise<string[]>
  /** Whether this session declared the memory tools; a declared tool cannot be taken back. */
  declared: boolean
  /** What the main loop's turn touched, for the consolidator. */
  turn: TurnEvidence
  /** Whether the person typed a prompt or a main-loop tool ran since the last consolidation (memory-save's rule). */
  worth: boolean
  /** The prompts the person typed since the last consolidation, which the consolidator reads with the answer. */
  asked: string[]
  /** The memories relevance reminded the main loop of since the last consolidation, whose use the consolidator judges. */
  relevant: Memory[]
  /** The active memories of the project's store and the global one at the last draw; unset until the daemon answered. */
  stored?: StoredCounts
  /** The last compact proposal, which `/sage-memory compact apply` writes. */
  compactPlan?: Plan
  /** The commands outcome capture wrote in the last hour, by key. */
  captured: Map<string, number>
  /** The timer of the next daily cleanup. */
  daily?: { cancel: () => void }
  /** What the memory manager pane shows. */
  pane: PaneState
  /** This session's reminded, used and added memories, shown under the daemon line. */
  counts: SessionCounts
  /** Whether a timed redraw is under way, so a slow daemon answer does not stack a second one. */
  redrawing: boolean
  /** The job under way after the main-loop turn (consolidating, saving, curating), shown as the section's last line. */
  working?: string
}

/**
 * What one loop's context holds: the text it shows, the reminded memories it has not used yet, the
 * ids a tool reminder picked, marked at the pick so a parallel call does not pick them again, and
 * whether the user's global rules went to it.
 */
type Loop = { visible: string; reminded: Memory[]; claimed: Set<string>; global: boolean }

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
async function toPerson($: EngineInterface, lines: Line[]): Promise<void> {
  try {
    if (await $.sidebar.set({ ...SECTION, title: 'memory', lines, buttons: [{ label: 'manage', command: 'sage-memory', args: 'pane' }], until: 'session', order: 23 })) {
      $.ui.status(undefined)
      return
    }
  } catch {
    // The sidebar mod is not installed; the status line carries the state.
  }
  $.ui.status(lines[0]?.text)
}

/** The active memories of the project's store and the global one, read again at each draw; a failed read keeps the last counts. */
async function readStored($: EngineInterface, state: State): Promise<void> {
  try {
    const stats = await ask<{ project: StoreStats; user: StoreStats }>($, state, '/memory/stats', {})
    state.stored = { project: stats.project.byStatus.active, global: stats.user.byStatus.active }
  } catch (err) {
    await toStream($, 'error', { text: `the store count was not read: ${errorText(err)}`, kind: 'error' })
  }
}

/** The section: the daemon's state; once it answers, what the stores hold and what this session did. */
async function show($: EngineInterface, state: State): Promise<void> {
  const first = stateLines(state.link, state.project?.name ?? '')
  if (state.link.state !== 'ready') return toPerson($, first)
  await readStored($, state)
  const job = state.working === undefined ? [] : [workingLine(state.working)]
  await toPerson($, [...first, ...(state.stored === undefined ? [] : [storedLine(state.stored)]), countsLine(state.counts), ...job])
}

/** Names the job under way after the turn in the section, or takes its line down with `undefined`. */
async function working($: EngineInterface, state: State, what: string | undefined): Promise<void> {
  if (state.working === what) return
  state.working = what
  await show($, state)
}

/**
 * The embeddings state read again: the daemon loads the model at its first use, and another window's
 * query can load it, so the state read at linking goes stale. A failed read keeps the last state.
 */
async function readEmbedding($: EngineInterface, state: State): Promise<void> {
  try {
    const status = await ask<EmbedStatus>($, state, '/embed/status', {})
    if (state.link.state === 'ready') state.link = { ...state.link, embedding: status.embedding, setup: status.setup }
  } catch (err) {
    await toStream($, 'error', { text: `the embeddings state was not read: ${errorText(err)}`, kind: 'error' })
  }
}

/** The timed redraw: the embeddings state and the store counts read again while the daemon is ready, one at a time. */
async function redraw($: EngineInterface, state: State): Promise<void> {
  if (state.redrawing || state.link.state !== 'ready') return
  state.redrawing = true
  try {
    await readEmbedding($, state)
    await show($, state)
  } finally {
    state.redrawing = false
  }
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

type Sent = { response: { status: number; text: string } } | { gone: string }

/**
 * One request to the daemon. A refused connection (the daemon closed after five idle minutes) and a
 * 401 (another session replaced it, so the token changed) read as a daemon that is gone; a request
 * that runs past its time is only late, and throws.
 */
async function send($: EngineInterface, state: State, path: string, body: Record<string, unknown>, ms: number): Promise<Sent> {
  if (state.layout === undefined || state.token === undefined) throw new Error('the daemon is not connected')
  const init = {
    method: 'POST',
    socketPath: state.layout.socket,
    headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project: state.project, sessionId: await $.session.id(), ...body }),
  }
  const fetching = $.http.fetch(`http://sage-memory${path}`, init).then(
    (response): Sent => {
      if (response.status === 401) return { gone: 'the daemon refused the token' }
      // The daemon answers 503 only while it is shutting down, so a request that lands in that
      // closing window takes the same path as a dead socket: relaunch and ask again.
      if (response.status === 503) return { gone: 'the daemon is closing' }
      return { response }
    },
    (err: unknown): Sent => ({ gone: errorText(err) }),
  )
  return within($, ms, path, fetching)
}

/** Starts or joins the daemon again and reads its token; every request that found it gone waits for this one relaunch. */
function relink($: EngineInterface, state: State): Promise<void> {
  state.relinking ??= relaunch($, state).finally(() => {
    state.relinking = undefined
  })
  return state.relinking
}

async function relaunch($: EngineInterface, state: State): Promise<void> {
  if (state.layout === undefined) throw new Error('the daemon is not connected')
  state.token = await launch($, state.layout)
}

/** One daemon route, for this project and this session: its value, or an error that names the route. A daemon that is gone is started again once. */
async function ask<T>($: EngineInterface, state: State, path: string, body: Record<string, unknown>, ms = CALL_MS): Promise<T> {
  let sent = await send($, state, path, body, ms)
  if ('gone' in sent) {
    await relink($, state)
    sent = await send($, state, path, body, ms)
  }
  if ('gone' in sent) throw new Error(`${path}: the daemon is gone and did not come back: ${sent.gone}`)
  return valueOf<T>(path, sent.response.status, sent.response.text)
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

/** Waits for this window's connection, starting it when none began: a command can come before session.start's. */
async function linked($: EngineInterface, state: State): Promise<void> {
  if (state.enabled) await (state.connecting ?? connect($, state))
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

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
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

/** A setting the person turns on or off, stored under `key`; without on or off, its state. */
async function toggle($: EngineInterface, key: string, what: string, word: string, isOnByDefault = false): Promise<string> {
  if (word !== 'on' && word !== 'off') return `${what} is ${((await $.store.get(key)) ?? isOnByDefault) === true ? 'on' : 'off'}`
  await $.store.set(key, word === 'on')
  return `${what} ${word}`
}

const CAPTURES: Record<string, { key: string; what: string }> = {
  outcomes: { key: 'captureOutcomes', what: 'capturing successful commands' },
  errors: { key: 'captureErrors', what: 'capturing failed commands' },
}

async function captureCommand($: EngineInterface, rest: string): Promise<string> {
  const [which = '', word = ''] = rest.toLowerCase().split(/\s+/)
  const capture = CAPTURES[which]
  return capture === undefined ? 'expects capture outcomes|errors [on|off]' : toggle($, capture.key, capture.what, word)
}

async function dailyCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const answer = await toggle($, 'daily', 'the daily cleanup', rest.trim().toLowerCase(), true)
  await scheduleDaily($, state)
  return answer
}

/** The answer while the daemon cannot take a request, or undefined once it can. */
async function notReady(state: State): Promise<string | undefined> {
  return (await isReady(state)) ? undefined : `the daemon is not ready: ${statusText(state.enabled, state.link, state.project?.name ?? '')}`
}

// ── Reading ────────────────────────────────────────────────────────────

async function showCommand($: EngineInterface, state: State, id: string): Promise<string> {
  if (id === '') return 'expects show <id>'
  const memory = await ask<Memory | null>($, state, '/memory/get', { id })
  return memory === null ? `no memory ${id}` : detailText(memory)
}

async function searchCommand($: EngineInterface, state: State, query: string): Promise<string> {
  if (query === '') return 'expects search <query>'
  return listText(await ask<Memory[]>($, state, '/memory/search', { query, limit: 30, includeStale: true, allSessions: true }), `nothing matches "${query}"`)
}

async function fileCommand($: EngineInterface, state: State, path: string): Promise<string> {
  if (path === '') return 'expects file <path>'
  return fileText(await ask<FileMemories>($, state, '/memory/for-file', { path, allSessions: true }))
}

async function graphCommand($: EngineInterface, state: State, query: string): Promise<string> {
  if (query === '') return 'expects graph <id or query>'
  return graphText(await ask<GraphEdge[]>($, state, '/memory/graph', { query, depth: 2, limit: 60, allSessions: true }))
}

async function auditCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const limit = /^\d+$/.test(rest) ? Math.min(Number(rest), 1000) : 30
  return auditText(await ask<AuditEntry[]>($, state, '/audit', { limit: Math.max(limit, 1) }))
}

async function statsCommand($: EngineInterface, state: State): Promise<string> {
  return statsText(await ask<{ project: StoreStats; user: StoreStats }>($, state, '/memory/stats', {}))
}

async function readCommand($: EngineInterface, state: State, word: string, rest: string): Promise<string> {
  if (word === 'show') return showCommand($, state, rest)
  if (word === 'search') return searchCommand($, state, rest)
  if (word === 'file') return fileCommand($, state, rest)
  if (word === 'graph') return graphCommand($, state, rest)
  return word === 'audit' ? auditCommand($, state, rest) : statsCommand($, state)
}

// ── Writing ────────────────────────────────────────────────────────────

async function rememberCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const flags = flagsOf(wordsOf(rest))
  if (flags.errors.length > 0 || flags.text === '') return [...flags.errors, flags.text === '' ? 'expects remember [flags] <text>' : ''].filter(line => line !== '').join('\n')
  const result = await ask<RememberResult>($, state, '/memory/remember', { input: rememberInputOf(flags, await $.session.id()) })
  return `${result.outcome === 'added' ? 'added' : 'merged into'} ${detailText(result.memory)}`
}

async function updateCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const [id = '', ...words] = wordsOf(rest)
  const flags = flagsOf(words)
  const patch = flagPatchOf(flags)
  if (id === '' || Object.keys(patch).length === 0) return 'expects update <id> and at least one flag or a new text'
  if (flags.errors.length > 0) return flags.errors.join('\n')
  const result = await ask<{ memory: Memory }>($, state, '/memory/update', { id, patch })
  return `updated ${detailText(result.memory)}`
}

/** The person's own delete is the authorization `force` asks for. */
async function deleteCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const [id = '', ...reason] = wordsOf(rest)
  if (id === '') return 'expects delete <id> [reason]'
  await ask($, state, '/memory/delete', { id, force: true, reason: reason.join(' ') || 'deleted by the person' })
  return `deleted ${id}; /sage-memory recover ${id} brings it back`
}

async function forgetCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const flags = flagsOf(wordsOf(rest))
  if (flags.text.length < 3) return 'expects forget <query of at least 3 characters> [--scope project|user|session]'
  const result = await ask<{ removed: string[]; skippedPermanent: string[] }>($, state, '/memory/forget', { query: flags.text, scope: flags.scope, force: true })
  return `forgot ${result.removed.length} memory(ies)${result.skippedPermanent.length > 0 ? `, kept ${result.skippedPermanent.length} permanent` : ''}`
}

async function recoverCommand($: EngineInterface, state: State, id: string): Promise<string> {
  if (id === '') return 'expects recover <id>'
  return `recovered ${detailText((await ask<{ memory: Memory }>($, state, '/memory/recover', { id, reason: 'recovered by the person' })).memory)}`
}

/** The memories written for one subagent type move to another, keeping their modes. */
async function transferAudience($: EngineInterface, state: State, from: string, to: string): Promise<string> {
  const scoped = (await allMemories($, state)).filter(m => m.audience?.roles?.some(role => role.toLowerCase() === from.toLowerCase()))
  const failed: string[] = []
  let moved = 0
  for (const m of scoped) {
    const roles = [...new Set((m.audience?.roles ?? []).map(role => (role.toLowerCase() === from.toLowerCase() ? to : role)))]
    if (await attempt(failed, m.id, () => ask($, state, '/memory/update', { id: m.id, patch: { audience: { ...m.audience, roles } } }))) moved += 1
  }
  return [`moved ${moved} of ${scoped.length} memory(ies) from ${from} to ${to}`, ...failed.map(line => `  failed: ${line}`)].join('\n')
}

async function audienceCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const [sub = '', ...words] = wordsOf(rest)
  if (sub === 'remember') return audienceRemember($, state, words, rest)
  if (sub === 'clear' && words[0] !== undefined) return updateAudience($, state, words[0])
  if (sub === 'transfer' && words.length === 2) return transferAudience($, state, words[0] ?? '', words[1] ?? '')
  return 'expects audience remember --role <type> <text> | clear <id> | transfer <from-type> <to-type>'
}

/** A memory for a subagent type or a permission mode; one of the two is required. */
async function audienceRemember($: EngineInterface, state: State, words: readonly string[], rest: string): Promise<string> {
  const flags = flagsOf(words)
  if (flags.roles === undefined && flags.modes === undefined) return 'expects audience remember --role <type> [--mode <mode>] <text>'
  return rememberCommand($, state, rest.replace(/^\s*remember\s*/, ''))
}

async function updateAudience($: EngineInterface, state: State, id: string): Promise<string> {
  await ask($, state, '/memory/update', { id, patch: { audience: {} } })
  return `${id} is general project memory now`
}

async function writeCommand($: EngineInterface, state: State, word: string, rest: string): Promise<string> {
  if (word === 'remember') return rememberCommand($, state, rest)
  if (word === 'update') return updateCommand($, state, rest)
  if (word === 'delete') return deleteCommand($, state, rest)
  if (word === 'forget') return forgetCommand($, state, rest)
  return word === 'recover' ? recoverCommand($, state, rest) : audienceCommand($, state, rest)
}

// ── Upkeep ─────────────────────────────────────────────────────────────

async function hygieneCommand($: EngineInterface, state: State): Promise<string> {
  const runs = await ask<{ project: HygieneRun; user: HygieneRun }>($, state, '/memory/hygiene', {})
  return [runs.project, runs.user].map(run => (run.state === 'done' ? hygieneText(run.report) : `hygiene ${run.state}`)).join('\n')
}

async function verifyCommand($: EngineInterface, state: State, id: string): Promise<string> {
  return verifyText(await ask<VerifyReport>($, state, '/memory/verify', id === '' ? {} : { id }))
}

async function candidatesCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const [action = 'list', id = '', ...more] = wordsOf(rest)
  if (action === 'list') return candidatesText(await ask<Candidate[]>($, state, '/candidates/list', {}))
  if (id === '') return 'expects candidates [list | accept <id> | reject <id> [reason] | resolve <id> delete|archive|keep]'
  return candidateAction($, state, action, id, more)
}

type Accepted = { candidate: Candidate; memory?: Memory; resolution?: { decision: string; applied: boolean }; alreadyResolved: boolean }

/** What an accept did: a new memory, a review's decision, or nothing for a candidate resolved before. */
function acceptedText(accepted: Accepted): string {
  if (accepted.alreadyResolved) return `${accepted.candidate.id} was ${accepted.candidate.status} already`
  if (accepted.resolution !== undefined) return `accepted the review: ${accepted.resolution.decision}${accepted.resolution.applied ? '' : ' (the target was left as it is)'}`
  return accepted.memory === undefined ? `accepted ${accepted.candidate.id}` : `accepted: ${detailText(accepted.memory)}`
}

async function candidateAction($: EngineInterface, state: State, action: string, id: string, more: readonly string[]): Promise<string> {
  if (action === 'accept') return acceptedText(await ask<Accepted>($, state, '/candidates/accept', { id }))
  if (action === 'reject') {
    await ask($, state, '/candidates/reject', { id, reason: more.join(' ') || 'rejected by the person' })
    return `rejected ${id}`
  }
  if (action !== 'resolve') return `unknown candidates action ${action}`
  const resolution = await ask<{ decision: string; applied: boolean }>($, state, '/candidates/resolve', { id, decision: more[0] ?? '', reason: more.slice(1).join(' ') || undefined })
  return `resolved ${id}: ${resolution.decision}${resolution.applied ? '' : ' (the target was left as it is)'}`
}

const IMPORT_USAGE = 'expects import <path> [--section <heading>] [--kind <kind>] [--scope project|user] [--policy auto|never] [--tag <tags>] [--importance <0-1>] [--confidence <0-1>]'

/** Writes one imported bullet and counts what the daemon did with it. */
async function importOne($: EngineInterface, state: State, input: RememberInput, tally: ImportTally): Promise<void> {
  try {
    const r = await ask<RememberResult>($, state, '/memory/remember', { input })
    if (r.outcome === 'added') tally.added += 1
    else if (r.nearDuplicate) tally.near.push(`"${input.text.slice(0, 60)}" into ${r.memory.id}`)
    else tally.exact += 1
  } catch (err) {
    tally.refused.push(`${input.text.slice(0, 60)}: ${errorText(err)}`)
  }
}

/** Writes each bullet of a markdown file, or of one section of it, as a memory. */
async function importCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  const flags = importFlagsOf(wordsOf(rest))
  if (flags.errors.length > 0) return [...flags.errors, IMPORT_USAGE].join('\n')
  const bullets = bulletsOf(await $.fs.read(flags.path), flags.section)
  if (bullets === undefined) return `${flags.path} has no heading "${flags.section ?? ''}"`
  const sessionId = await $.session.id()
  const tally: ImportTally = { added: 0, exact: 0, near: [], refused: [] }
  for (const bullet of bullets) await importOne($, state, importInput(bullet, flags, sessionId), tally)
  return importReport(flags.path, bullets.length, tally)
}

async function upkeepCommand($: EngineInterface, state: State, word: string, rest: string): Promise<string> {
  if (word === 'hygiene') return hygieneCommand($, state)
  if (word === 'verify') return verifyCommand($, state, rest)
  if (word === 'candidates') return candidatesCommand($, state, rest)
  if (word === 'triage') return triageCommand($, state, rest)
  if (word === 'compact') return compactCommand($, state, rest)
  return importCommand($, state, rest)
}

// ── Settings ───────────────────────────────────────────────────────────

async function modelCommand($: EngineInterface, name: string): Promise<string> {
  if (name === '') return `the LLM jobs use ${await jobModel($)}`
  await $.store.set('model', name)
  return `the LLM jobs use ${name} from now on`
}

const REMINDS: Record<string, { key: string; what: string }> = {
  tools: { key: 'remindTools', what: 'reminders after file tools' },
  prompt: { key: 'remindPrompt', what: 'reminders with a prompt' },
  subagent: { key: 'remindSubagent', what: 'reminders for a subagent' },
}

/** An on-by-default setting: stored false turns it off. */
async function onByDefault($: EngineInterface, key: string, what: string, word: string): Promise<string> {
  if (word !== 'on' && word !== 'off') return `${what} ${(await $.store.get(key)) === false ? 'off' : 'on'}`
  await $.store.set(key, word === 'on')
  return `${what} ${word}`
}

async function remindCommand($: EngineInterface, rest: string): Promise<string> {
  const [which = '', word = ''] = rest.toLowerCase().split(/\s+/)
  const remind = REMINDS[which]
  return remind === undefined ? 'expects remind tools|prompt|subagent [on|off]' : onByDefault($, remind.key, remind.what, word)
}

async function settingCommand($: EngineInterface, state: State, word: string, rest: string): Promise<string> {
  const value = rest.trim().toLowerCase()
  if (word === 'model') return modelCommand($, rest.trim())
  if (word === 'remind') return remindCommand($, rest)
  if (word === 'consolidate') return onByDefault($, 'consolidate', 'the consolidator', value)
  if (word === 'curate') return onByDefault($, 'curate', 'the curator', value)
  return word === 'daily' ? dailyCommand($, state, rest) : captureCommand($, rest)
}

const READ_WORDS = new Set(['show', 'search', 'file', 'graph', 'audit', 'stats'])
const WRITE_WORDS = new Set(['remember', 'update', 'delete', 'forget', 'recover', 'audience'])
const UPKEEP_WORDS = new Set(['hygiene', 'verify', 'candidates', 'triage', 'compact', 'import'])
const SETTING_WORDS = new Set(['model', 'remind', 'consolidate', 'curate', 'daily', 'capture'])

/** The subcommands past on, off and setup: a setting answers while the daemon is down, the rest need it. */
async function jobCommand($: EngineInterface, state: State, word: string, rest: string): Promise<string> {
  if (SETTING_WORDS.has(word)) return settingCommand($, state, word, rest)
  if (!READ_WORDS.has(word) && !WRITE_WORDS.has(word) && !UPKEEP_WORDS.has(word)) return USAGE
  const down = await notReady(state)
  if (down !== undefined) return down
  if (READ_WORDS.has(word)) return readCommand($, state, word, rest.trim())
  return WRITE_WORDS.has(word) ? writeCommand($, state, word, rest) : upkeepCommand($, state, word, rest.trim())
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  await follow($, state)
  await linked($, state)
  const [first = '', ...rest] = args.trim().split(/\s+/)
  const word = first.toLowerCase()
  if (word === '') return statusText(state.enabled, state.link, state.project?.name ?? '')
  if (word === 'on' || word === 'off') return setEnabled($, state, word === 'on')
  if (word === 'setup') return setup($, state)
  if (word === 'pane') return openPane($, state)
  return jobCommand($, state, word, rest.join(' '))
}

/**
 * One stream entry: a reminder faint; a memory added, changed or deleted with only its verb coloured
 * green, yellow or red; a failure red. The log line while the pane is closed.
 */
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
  const loop: Loop = { visible: '', reminded: [], claimed: new Set(), global: false }
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
  loop.reminded.push(...block.sent)
  if (trigger === 'global') state.counts.rules += block.sent.length
  else state.counts.reminded += block.sent.length
  if (trigger !== 'global' && loopKey === MAIN_LOOP) state.relevant = judgedNext(state.relevant, block.sent)
  await ask($, state, '/memory/reminded', { sessionId: await $.session.id(), loop: loopKey, trigger, ids: block.sent.map(memory => memory.id) })
  await show($, state)
  await toStream($, 'reminder', reminderLine(trigger, block.sent))
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
function tasksOf($: EngineInterface, state: State): Promise<string[]> {
  state.tasks ??= readTasks($)
  return state.tasks
}

async function readTasks($: EngineInterface): Promise<string[]> {
  return tasksInProgress(await taskList($))
}

/** The TaskList result, or nothing while the session has no task tools (the call is refused). */
async function taskList($: EngineInterface): Promise<unknown> {
  const answer = await $.tool.call({ tool: 'TaskList' })
  return 'deny' in answer && answer.deny !== undefined ? undefined : answer.result
}

/** How much a reminder may carry: the main loop's by how full its context is, a subagent's the whole budget. */
async function budgetOf($: EngineInterface, loopKey: string): Promise<ReturnType<typeof toolBudget>> {
  return toolBudget(loopKey === MAIN_LOOP ? (await $.session.usage()).context.percent : 0)
}

/**
 * The reminder bound to one file tool's result, or nothing. The result joins what the loop shows first,
 * so a memory the file already states is not sent.
 */
async function afterCall($: EngineInterface, state: State, call: ToolCall, loopKey: string): Promise<string | undefined> {
  const loop = loopOf(state, loopKey)
  loop.visible = seen(loop.visible, responseText(call.tool_response))
  if (!(await isReady(state)) || (await $.store.get('remindTools')) === false) return undefined
  const budget = await budgetOf($, loopKey)
  if (budget.count === 0) return undefined
  const paths = pathsOf(call)
  const tasks = loopKey === MAIN_LOOP ? await tasksOf($, state) : []
  const body = { sessionId: await $.session.id(), loop: loopKey, paths, query: queryOf([call], paths, tasks, state.project?.root ?? ''), mutation: CHANGE_TOOLS.has(call.tool_name), limit: CANDIDATES }
  const ranking = await ask<Ranking>($, state, '/remind/tools', body, REMIND_MS)
  // The pick and its claim run in one synchronous step: a parallel call's pick comes after it and skips these ids.
  const fresh = ranking.candidates.filter(item => !loop.claimed.has(item.memory.id))
  const block = toolReminder(fresh, loop.visible, budget, loopKey !== MAIN_LOOP, tasks.length > 0)
  for (const memory of block.sent) loop.claimed.add(memory.id)
  return deliver($, state, loopKey, 'tools', block)
}

/** Two reminder texts as one context text, or nothing when neither went. */
function joined(first: string | undefined, second: string | undefined): string | undefined {
  const texts = [first, second].filter((text): text is string => text !== undefined)
  return texts.length === 0 ? undefined : texts.join('\n\n')
}

/**
 * The user's global rules, once per main-loop context: with its first prompt, or with the first
 * file tool after a compaction started it over in the middle of a turn. A subagent's loop gets them
 * in its spawn prompt instead. A failed read leaves the context without them, so the next prompt or
 * tool tries again.
 */
async function globalRules($: EngineInterface, state: State, loopKey: string = MAIN_LOOP): Promise<string | undefined> {
  if (loopKey !== MAIN_LOOP) return undefined
  const loop = loopOf(state, MAIN_LOOP)
  if (loop.global || !(await isReady(state))) return undefined
  const rules = await ask<Memory[]>($, state, '/remind/global', {}, REMIND_MS)
  loop.global = true
  return deliver($, state, MAIN_LOOP, 'global', globalReminder(rules, false))
}

/** A tool call as the reminder reads it: its name, its input, and its result as the model reads it. */
function callOfTool(e: { tool: string }, r: { text?: string; result?: unknown }): ToolCall {
  return { tool_name: e.tool, tool_input: e, tool_response: r.text ?? r.result }
}

/** The file tools a reminder rides on, and every MCP tool but this mod's own; `isReminding` narrows an MCP tool to one that names a file. */
const REMINDING_TOOLS = /^(Read|Grep|Glob|LSP|Edit|Write|NotebookEdit|MultiEdit|mcp__(?!sage-memory__).+)$/

/**
 * What goes with a prompt the person typed: the user's global rules when the context has not had
 * them, then the reminder of the prompt, or nothing. The global rules are recorded first, so the
 * prompt's ranking leaves them out.
 */
async function beforePrompt($: EngineInterface, state: State, text: string): Promise<string | undefined> {
  await follow($, state)
  const rules = await guarded($, 'the global rules', () => globalRules($, state))
  const related = await guarded($, 'the reminder with the prompt', () => promptRelated($, state, text))
  return joined(rules, related)
}

/** The reminder of the memories a prompt's text finds, or nothing. */
async function promptRelated($: EngineInterface, state: State, text: string): Promise<string | undefined> {
  if (!(await isReady(state)) || (await $.store.get('remindPrompt')) === false) return undefined
  const body = { sessionId: await $.session.id(), loop: MAIN_LOOP, query: text.slice(0, 4000), limit: CANDIDATES }
  const ranking = await ask<Ranking>($, state, '/remind/prompt', body, REMIND_MS)
  return deliver($, state, MAIN_LOOP, 'prompt', promptReminder(ranking.candidates, loopOf(state, MAIN_LOOP).visible))
}

type Spawn = { prompt: string; subagentType: string; permissionMode?: string }

type SpawnBlock = Block & { rules: Memory[] }

/** What a subagent starts with: the user's global rules, then its own memories unless the person turned them off; or nothing. */
async function forSubagent($: EngineInterface, state: State, e: Spawn): Promise<SpawnBlock | undefined> {
  await follow($, state)
  if (!(await isReady(state))) return undefined
  const rules = await ask<Memory[]>($, state, '/remind/global', {}, REMIND_MS)
  const ranking = await subagentRanking($, state, e)
  const block = subagentReminder(rules, ranking.audience, ranking.task)
  return block.sent.length > 0 ? block : undefined
}

/**
 * Records a subagent's reminder in two parts: its global rules under the `global` trigger, which
 * the daemon counts toward no memory's reminders, and its own memories under `subagent`.
 */
async function recordSpawn($: EngineInterface, state: State, agentId: string, block: SpawnBlock): Promise<void> {
  const own = block.sent.filter(memory => !block.rules.includes(memory))
  const parts = [{ trigger: 'global', sent: block.rules }, { trigger: 'subagent', sent: own }].filter(part => part.sent.length > 0)
  for (const [i, part] of parts.entries()) await record($, state, agentId, part.trigger, { text: i === 0 ? block.text : '', sent: part.sent })
}

/** The memories written for a subagent and the ones about its task; none while the person turned them off. */
async function subagentRanking($: EngineInterface, state: State, e: Spawn): Promise<SubagentRanking> {
  if ((await $.store.get('remindSubagent')) === false) return { audience: [], task: [] }
  const body = { sessionId: await $.session.id(), role: e.subagentType, mode: e.permissionMode, task: e.prompt.slice(0, 4000) }
  return ask<SubagentRanking>($, state, '/remind/subagent', body, REMIND_MS)
}

/**
 * Counts the reminded memories a loop used, each reminder once: `pick` names them among the loop's
 * reminded ones, the loop drops them, and the daemon records the source. An answer uses a memory by
 * quoting it (`usedBy`), a successful tool call by acting on its anchor (`actedOn`).
 */
async function countUse($: EngineInterface, state: State, loopKey: string, source: string, pick: (reminded: readonly Memory[]) => Memory[]): Promise<void> {
  const loop = state.loops.get(loopKey)
  if (loop === undefined || loop.reminded.length === 0 || !(await isReady(state))) return
  const used = pick(loop.reminded)
  if (used.length === 0) return
  loop.reminded = loop.reminded.filter(memory => !used.includes(memory))
  state.counts.used += used.length
  await show($, state)
  await ask($, state, '/memory/used', { sessionId: await $.session.id(), source, ids: used.map(memory => memory.id) })
}

/** Starts a loop's context over after a compaction: the daemon opens a new epoch, and the loop forgets what it showed. */
async function newContext($: EngineInterface, state: State, loopKey: string): Promise<void> {
  state.loops.delete(loopKey)
  if (await isReady(state)) await ask($, state, '/context/new', { sessionId: await $.session.id(), loop: loopKey })
}

/** The line of a check that changed memories: the ones gone stale yellow, the ones back green. */
function verifiedLine(what: string, report: { staled: string[]; reactivated: string[] }): Line | undefined {
  const staled: Part[] = report.staled.length > 0 ? [{ text: `${report.staled.length} memory(ies) went stale`, kind: 'warn' }] : []
  const back: Part[] = report.reactivated.length > 0 ? [{ text: `${report.reactivated.length} came back`, kind: 'ok' }] : []
  const counts = listed([...staled, ...back])
  return counts.length === 0 ? undefined : partsLine([faint(`${what}: `), ...counts], staled.length > 0 ? 'warn' : 'ok')
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
  if (moved > 0) await toStream($, 'verify', wordLine(`anchors of ${moved} memory(ies) `, 'moved', 'warn', ` with ${report.moves.length} file(s)`))
  const line = verifiedLine('after the move', report)
  if (line !== undefined) await toStream($, 'verify', line)
}

function succeeded(result: object): boolean {
  return !('deny' in result && result.deny !== undefined) && !('isError' in result && result.isError === true)
}

/**
 * Declares the memory tools once the mod is on, at a session's start or at the first turn after
 * another window turned it on. A declared tool stays for the session; while the mod is off it answers
 * that it is off.
 */
async function declareTools($: EngineInterface, state: State): Promise<void> {
  if (state.declared || !state.enabled) return
  state.declared = true
  for (const tool of TOOLS) await $.tool.register({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
}

/** One memory tool call, answered with the daemon's value or the reason it failed. */
async function serveTool($: EngineInterface, state: State, name: string, input: Input): Promise<{ result: string; isError?: true }> {
  await follow($, state)
  if (!state.enabled) return { result: OFF_TEXT, isError: true }
  await state.connecting
  if (state.link.state !== 'ready') return { result: `the sage-memory daemon is not ready: ${statusText(state.enabled, state.link, state.project?.name ?? '')}`, isError: true }
  try {
    const call = callOf(name, input, await $.session.id())
    const value = await ask<unknown>($, state, call.path, { ...call.body, sessionId: await $.session.id() })
    await noteEdit($, state, name, input, value)
    return { result: resultText(value) }
  } catch (err) {
    return { result: errorText(err), isError: true }
  }
}

/** Counts a memory the model added, and writes the stream line of any change it made to the store. */
async function noteEdit($: EngineInterface, state: State, name: string, input: Input, value: unknown): Promise<void> {
  if (addedBy(name, value)) {
    state.counts.added += 1
    await show($, state)
  }
  const line = editLine(name, input, value)
  if (line !== undefined) await toStream($, 'model', line)
}

const LISTED = new Set(TOOLS.filter(tool => tool.listed).map(tool => `mcp__sage-memory__${tool.name}`))

/** The model the LLM jobs use: the one the person named, else haiku. */
async function jobModel($: EngineInterface): Promise<string> {
  const stored = await $.store.get('model')
  return typeof stored === 'string' && stored !== '' ? stored : DEFAULT_MODEL
}

/** The subjects of the tasks completed, or none while the session has no task tools. */
async function completedOf($: EngineInterface): Promise<string[]> {
  return completedTasks(await taskList($))
}

/** The active memories of one store, most important first. */
async function topOf($: EngineInterface, state: State, scope: 'project' | 'user', limit: number): Promise<Memory[]> {
  const page = await ask<MemoryPage>($, state, '/memory/list', { scope, statuses: ['active'], limit: 200 })
  return topByImportance(page.memories.filter(memory => memory.kind !== 'session_digest'), limit)
}

/** Writes one memory; a refusal (a progress note, a secret, a missing anchor) is a red line, and the rest still go. */
async function writeOne($: EngineInterface, state: State, input: RememberInput): Promise<boolean> {
  try {
    const result = await ask<RememberResult>($, state, '/memory/remember', { input })
    if (result.outcome === 'added') {
      state.counts.added += 1
      await show($, state)
      await toStream($, 'consolidator', addedLine(result.memory))
    }
    return true
  } catch (err) {
    await toStream($, 'error', { text: `the consolidator's memory was not written: ${errorText(err)}`, kind: 'error' })
    return false
  }
}

/** What a consolidation reads besides the answer: the person's prompts, the turn's evidence, and the memories relevance reminded. */
type Since = { asked: readonly string[]; turn: TurnEvidence; relevant: readonly Memory[] }

/**
 * Calls the job model; one failed call is retried once. An empty reply means the thinking job model
 * spent the budget on its reasoning, so the retry doubles maxTokens (measured 2026-10-04: max_tokens
 * 128 with a reasoning prompt returned a thinking block alone). An api-error is the HTTP layer
 * failing under load, so the retry repeats the same request. An aborted call is one cut at its
 * timeoutMs (measured: a call cut at exactly its limit settles as aborted), so the retry raises the
 * limit by 120 s.
 */
async function completeWithRetry(
  $: EngineInterface,
  request: Parameters<EngineInterface['model']['complete']>[0],
): Promise<Awaited<ReturnType<EngineInterface['model']['complete']>>> {
  let r = await $.model.complete(request)
  if (!r.isAnswered && r.reason === 'empty-reply') r = await $.model.complete({ ...request, maxTokens: (request.maxTokens ?? 0) * 2 })
  if (!r.isAnswered && r.reason === 'api-error') r = await $.model.complete(request)
  if (!r.isAnswered && r.reason === 'aborted') r = await $.model.complete({ ...request, timeoutMs: (request.timeoutMs ?? 0) + 120_000 })
  return r
}

/** The status and error text an api-error result carries, when the engine includes them. */
function apiErrorDetail(r: Awaited<ReturnType<EngineInterface['model']['complete']>>): string {
  if (r.isAnswered || r.reason !== 'api-error') return ''
  const extra = r as unknown as { status?: number; error?: string }
  const status = extra.status !== undefined ? ` ${extra.status}` : ''
  const error = extra.error !== undefined && extra.error !== '' ? ` ${extra.error}` : ''
  return status + error
}

/**
 * Asks the model what the turn taught and writes each memory it kept. It also judges which of the
 * memories relevance reminded the turn followed; the verdict goes to the audit log alone, until it is
 * measured against real turns. One empty reply is retried once with the same request.
 */
async function consolidate($: EngineInterface, state: State, answer: string, since: Since): Promise<void> {
  if (!(await isReady(state)) || (await $.store.get('consolidate')) === false) return
  await working($, state, 'consolidating…')
  const root = state.project?.root ?? ''
  const existing = [...(await topOf($, state, 'project', 15)), ...(await topOf($, state, 'user', 10))]
  const prompt = consolidatorPrompt(since.asked, answer, evidenceText(root, since.turn, await completedOf($)), existing, since.relevant)
  const r = await completeWithRetry($, { model: await jobModel($), system: CONSOLIDATOR_SYSTEM, prompt, maxTokens: CONSOLIDATE_TOKENS, timeoutMs: CONSOLIDATE_MS })
  if (!r.isAnswered) {
    await toStream($, 'error', { text: `the consolidator got no answer (${r.reason}${apiErrorDetail(r)})`, kind: 'error' })
    // The turn's material was taken out of state before the timer ran. Hand the typed prompts back,
    // so the next consolidation still reads them instead of this turn being lost for good.
    state.asked = [...since.asked, ...state.asked].slice(-MAX_ASKED)
    return
  }
  const sessionId = await $.session.id()
  if (since.relevant.length > 0) await ask($, state, '/memory/judged', { sessionId, judged: since.relevant.map(memory => memory.id), followed: followedOf(r.text, since.relevant) })
  const additions = additionsOf(r.text, sessionId, root, existing)
  if (additions.length > 0) await working($, state, jobText('saving', additions.length))
  for (const input of additions) await writeOne($, state, input)
}

/** The memories the curator audits: those anchored to the turn's written files, then the targets of pending candidates. */
async function curatorTargets($: EngineInterface, state: State, written: readonly string[]): Promise<Memory[]> {
  const found = new Map<string, Memory>()
  for (const path of written.slice(0, CURATED_FILES)) {
    for (const memory of await ask<Memory[]>($, state, '/memory/for-path', { path, limit: PER_FILE })) if (found.size < MAX_TARGETS) found.set(memory.id, memory)
  }
  const pending = (await ask<Candidate[]>($, state, '/candidates/list', {})).filter(candidate => candidate.status === 'pending' && candidate.targetMemoryId !== undefined)
  for (const candidate of pending) {
    if (found.size >= MAX_TARGETS || found.has(candidate.targetMemoryId ?? '')) continue
    const memory = await ask<Memory | undefined>($, state, '/memory/get', { id: candidate.targetMemoryId })
    if (memory !== undefined && memory !== null) found.set(memory.id, memory)
  }
  return [...found.values()]
}

/** New memories that take the place of old ones: each written, then the old ones a new one did not merge into are deleted. */
async function replaceWith($: EngineInterface, state: State, step: Extract<Step, { kind: 'replace' }>): Promise<void> {
  const written: Memory[] = []
  for (const input of step.inputs) written.push((await ask<RememberResult>($, state, '/memory/remember', { input })).memory)
  const replaced = step.replaced.filter(id => !written.some(memory => memory.id === id))
  const reason = `curator: ${step.count} into ${written.map(memory => memory.id).join(', ')}`
  for (const id of replaced) await ask($, state, '/memory/delete', { id, force: true, reason })
}

async function applyStep($: EngineInterface, state: State, step: Step, tally: Tally): Promise<void> {
  try {
    if (step.kind === 'update') await ask($, state, '/memory/update', { id: step.id, patch: step.patch })
    else if (step.kind === 'delete') await ask($, state, '/memory/delete', { id: step.id, force: true, reason: step.reason })
    else await replaceWith($, state, step)
    tally[step.count] += 1
  } catch (err) {
    await toStream($, 'error', { text: `a curator step was not applied: ${errorText(err)}`, kind: 'error' })
  }
}

/** Audits the memories about the files a turn wrote, and applies what the model decided about the ids it was shown. */
async function curate($: EngineInterface, state: State, answer: string, written: readonly string[]): Promise<void> {
  if (written.length === 0 || !(await isReady(state)) || (await $.store.get('curate')) === false) return
  const targets = await curatorTargets($, state, written.map(path => relativeTo(state.project?.root ?? '', path)))
  if (targets.length === 0) return
  await working($, state, jobText('curating', targets.length))
  const prompt = curatorPrompt(written.map(path => relativeTo(state.project?.root ?? '', path)), answer, targets)
  const r = await completeWithRetry($, { model: await jobModel($), system: CURATOR_SYSTEM, prompt, maxTokens: CURATE_TOKENS, timeoutMs: CURATE_MS })
  if (!r.isAnswered) {
    await toStream($, 'error', { text: `the curator got no answer (${r.reason}${apiErrorDetail(r)})`, kind: 'error' })
    return
  }
  const tally = emptyTally()
  for (const step of stepsOf(r.text, targets, { sessionId: await $.session.id(), root: state.project?.root ?? '' })) await applyStep($, state, step, tally)
  const line = tallyLine(tally)
  if (line !== undefined) await toStream($, 'curator', line)
}

/** Starts a consolidation after a main-loop answer the person asked for or a tool worked on; the turn does not wait for it. */
function afterAnswer($: EngineInterface, state: State, answer: string): void {
  if (!state.worth || answer.trim().length < MIN_ANSWER) return
  state.worth = false
  const since: Since = { asked: state.asked, turn: state.turn, relevant: state.relevant }
  state.asked = []
  state.relevant = []
  // The jobs run on a timer, not in the turn's dispatch: since 2.1.288 a model call still in
  // flight when the turn's dispatch closes is aborted, and every consolidation was lost that way.
  // A timer outlives the dispatch, so the model answers reach the daemon.
  $.clock.after(0, () => {
    void guarded($, 'the consolidator', () => consolidate($, state, answer, since))
      .then(() => guarded($, 'the curator', () => curate($, state, answer, since.turn.written)))
      .then(() => working($, state, undefined))
  })
}

/** Notes what a main-loop tool batch touched, for the consolidator. */
function noteBatch(state: State, calls: readonly ToolCall[]): void {
  state.worth = true
  for (const call of calls) {
    for (const path of pathsOf({ ...call, tool_response: undefined })) {
      if (CHANGE_TOOLS.has(call.tool_name)) state.turn.written = noted(state.turn.written, path)
      else if (call.tool_name === 'Read') state.turn.read = noted(state.turn.read, path)
    }
  }
}

// ── Triage ─────────────────────────────────────────────────────────────

/** How many model calls a triage may make: ratings, then compared pairs (SAGE's defaults, and the daily run's). */
type Limits = { calls: number; pairs: number }
const TRIAGE_LIMITS: Limits = { calls: 1000, pairs: 50 }
const DAILY_LIMITS: Limits = { calls: 40, pairs: 15 }
const TRIAGE_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

/** Every active and stale memory of both stores, every session's included, page by page. */
async function allMemories($: EngineInterface, state: State): Promise<Memory[]> {
  const memories: Memory[] = []
  let cursor: string | null | undefined
  do {
    const page: MemoryPage = await ask($, state, '/memory/list', { statuses: ['active', 'stale'], limit: 500, cursor: cursor ?? undefined, allSessions: true })
    memories.push(...page.memories)
    cursor = page.nextCursor
  } while (cursor !== null && cursor !== undefined && memories.length < 10_000)
  return memories
}

/** One short model answer, or undefined when the model gave none: no answer is no verdict. */
async function answerOf($: EngineInterface, system: string, prompt: string): Promise<string | undefined> {
  const r = await $.model.complete({ model: await jobModel($), system, prompt, maxTokens: 512, timeoutMs: TRIAGE_MS })
  return r.isAnswered && r.text.trim() !== '' ? r.text : undefined
}

type Gray = { memory: Memory; score: Score }

/** Phases 1 and 2: the rule and score verdicts, with a deletion for each discard. */
function classify(memories: readonly Memory[], now: number): { kept: number; discards: Deletion[]; gray: Gray[] } {
  const result = { kept: 0, discards: [] as Deletion[], gray: [] as Gray[] }
  for (const memory of memories) {
    const verdict = preFilter(memory, now)
    if (verdict.verdict === 'discard') result.discards.push(discardDeletion(memory, verdict.reasons))
    if (verdict.verdict !== 'uncertain') {
      if (verdict.verdict === 'keep') result.kept += 1
      continue
    }
    const score = valueScore(memory, now)
    if (score.band === 'keep') result.kept += 1
    else if (score.band === 'discard') result.discards.push(discardDeletion(memory, [`value score ${score.total}/100`]))
    else result.gray.push({ memory, score })
  }
  return result
}

/** Phase 3: the model rates each gray memory, and each rating becomes a patch and perhaps a proposal. */
async function rateGray($: EngineInterface, gray: readonly Gray[], limit: number, now: number, report: Report): Promise<void> {
  for (const { memory, score } of gray.slice(0, limit)) {
    const raw = await answerOf($, RATE_SYSTEM, ratePrompt(memory, score, now))
    const rating = raw === undefined ? undefined : ratingOf(raw)
    if (rating === undefined) {
      report.unrated += 1
      continue
    }
    report.rated += 1
    const action = actionOf(memory, score, rating)
    if (action === 'delete') report.deletions.push(ratedDeletion(memory, rating))
    const patch = patchOf(memory, action, rating)
    if (Object.keys(patch).length > 0) report.patches.push({ memory, patch })
    const proposal = proposalOf(memory, action, rating)
    if (proposal !== undefined) report.proposals.push(proposal)
  }
  report.unrated += Math.max(0, gray.length - limit)
}

/** Phase 4: the model compares each clustered pair. */
async function comparePairs($: EngineInterface, memories: readonly Memory[], limit: number, report: Report): Promise<void> {
  const pairs = pairsOf(memories, limit)
  const yes: Pair[] = []
  for (const pair of pairs) {
    const raw = await answerOf($, MERGE_SYSTEM, pairPrompt(pair))
    const verdict = raw === undefined ? undefined : mergeVerdictOf(raw)
    if (verdict === undefined) report.unjudged += 1
    if (verdict === 'YES') yes.push(pair)
    if (verdict === 'OVERLAP') report.overlaps.push(pair)
  }
  report.pairs = pairs.length
  report.merges = mergesOf(yes)
}

/** Runs phases 1 to 5 and writes nothing. */
async function triageReport($: EngineInterface, state: State, limits: Limits): Promise<Report> {
  const memories = await allMemories($, state)
  const now = await $.clock.now()
  const classified = classify(memories, now)
  const report: Report = { total: memories.length, kept: classified.kept, discarded: classified.discards.length, gray: classified.gray.length, rated: 0, unrated: 0, patches: [], deletions: [...classified.discards], proposals: [], merges: [], overlaps: [], pairs: 0, unjudged: 0 }
  await rateGray($, classified.gray, limits.calls, now, report)
  await comparePairs($, memories, limits.pairs, report)
  return report
}

/** Files each proposal a pending or recent review does not already cover. */
async function fileProposals($: EngineInterface, state: State, proposals: readonly Proposal[]): Promise<{ filed: number; failed: string[] }> {
  const candidates = await ask<Candidate[]>($, state, '/candidates/list', { includeResolved: true })
  const result = { filed: 0, failed: [] as string[] }
  for (const proposal of proposalsToFile(proposals, candidates, await $.clock.now())) {
    try {
      await ask($, state, '/candidates/propose', { input: proposalInput(proposal) })
      result.filed += 1
    } catch (err) {
      result.failed.push(`${proposal.memory.id}: ${errorText(err)}`)
    }
  }
  return result
}

/** One write that may fail on its own: its error joins the list, the rest still go. */
async function attempt(failed: string[], what: string, work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work()
    return true
  } catch (err) {
    failed.push(`${what}: ${errorText(err)}`)
    return false
  }
}

/** A merge: the keeper, read again and still live, supersedes the loser, which takes the keeper as its successor. */
async function applyMerge($: EngineInterface, state: State, merge: Merge): Promise<void> {
  const keeper = await ask<Memory | null>($, state, '/memory/get', { id: merge.keeper.id })
  if (keeper === null || (keeper.status !== 'active' && keeper.status !== 'stale')) throw new Error(`keeper ${merge.keeper.id} is no longer live`)
  await ask($, state, '/memory/update', { id: keeper.id, patch: { supersedes: [...new Set([...(keeper.supersedes ?? []), merge.loser.id])] } })
}

/** Applies the deletions, patches and merges and files the proposals; returns the lines that say what was written. */
async function applyTriage($: EngineInterface, state: State, report: Report): Promise<string> {
  const failed: string[] = []
  let deleted = 0
  let patched = 0
  let merged = 0
  for (const { memory, reason } of report.deletions) if (await attempt(failed, `delete ${memory.id}`, () => ask($, state, '/memory/delete', { id: memory.id, force: true, reason }))) deleted += 1
  for (const { memory, patch } of report.patches) if (await attempt(failed, `patch ${memory.id}`, () => ask($, state, '/memory/update', { id: memory.id, patch }))) patched += 1
  for (const merge of report.merges) if (await attempt(failed, `merge ${merge.loser.id}`, () => applyMerge($, state, merge))) merged += 1
  const proposals = await fileProposals($, state, report.proposals)
  const lines = [`applied: ${deleted} deletion(s), ${patched} patch(es), ${merged} merge(s), ${proposals.filed} review proposal(s) filed`, ...[...failed, ...proposals.failed].map(line => `  failed: ${line}`)]
  return lines.join('\n')
}

async function triageCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  if (!(await isReady(state))) return `the daemon is not ready: ${statusText(state.enabled, state.link, state.project?.name ?? '')}`
  const report = await triageReport($, state, TRIAGE_LIMITS)
  const applied = rest.trim().toLowerCase() === 'apply' ? await applyTriage($, state, report) : undefined
  return reportText(report, applied)
}

/** The daily cleanup is on unless the person turned it off. */
async function isDailyOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('daily')) !== false
}

/**
 * The daily cleanup: hygiene, then a triage bounded to 40 ratings and 15 pairs, applied as
 * `/sage-memory triage apply` applies it. The time of the last run is kept in the store, so one window runs it.
 */
async function dailyRun($: EngineInterface, state: State): Promise<void> {
  state.daily = undefined
  if (!(await isDailyOn($)) || !(await isReady(state))) return
  const last = await $.store.get('dailyAt')
  const now = await $.clock.now()
  if (typeof last === 'number' && now - last < DAY_MS) return scheduleDaily($, state)
  await $.store.set('dailyAt', now)
  await ask($, state, '/memory/hygiene', { automatic: true })
  const report = await triageReport($, state, DAILY_LIMITS)
  const applied = await applyTriage($, state, report)
  await toStream($, 'triage', { text: `daily cleanup of ${report.total} memories: ${applied}`, kind: applied.includes('failed:') ? 'error' : 'ok' })
  await scheduleDaily($, state)
}

/** Schedules the next daily run: an hour after the start when the last run is a day old, else a day after it. */
async function scheduleDaily($: EngineInterface, state: State): Promise<void> {
  state.daily?.cancel()
  state.daily = undefined
  if (!(await isDailyOn($))) return
  const last = await $.store.get('dailyAt')
  const now = await $.clock.now()
  const wait = typeof last === 'number' && now - last < DAY_MS ? last + DAY_MS - now : HOUR_MS
  state.daily = $.clock.after(Math.max(wait, HOUR_MS), () => void guarded($, 'the daily triage', () => dailyRun($, state)))
}

// ── Compact ────────────────────────────────────────────────────────────

/** Asks the model for a compact proposal over the active and stale project memories, and keeps it. */
async function proposeCompact($: EngineInterface, state: State): Promise<string> {
  const memories = (await allMemories($, state)).filter(memory => memory.scope !== 'user').slice(0, COMPACT_MAX)
  if (memories.length === 0) return 'no active or stale project memory to compact'
  const r = await $.model.complete({ model: await jobModel($), system: compactSystem(memories), prompt: compactPrompt(memories.length), maxTokens: COMPACT_TOKENS, timeoutMs: COMPACT_MS })
  if (!r.isAnswered) return `the model gave no answer (${r.reason}); nothing was proposed`
  state.compactPlan = planOf(r.text, memories)
  return planText(state.compactPlan)
}

/** Writes one change of the plan, unless the memory changed since the model saw it. */
async function applyChange($: EngineInterface, state: State, change: Change): Promise<void> {
  const current = await ask<Memory | null>($, state, '/memory/get', { id: change.id })
  if (current === null || current.revision !== change.revision) throw new Error(`${change.id} changed since the proposal`)
  if (change.kind === 'delete') await ask($, state, '/memory/delete', { id: change.id, reason: `compact: ${change.reason}`, force: true })
  else if (change.kind === 'rewrite') await ask($, state, '/memory/update', { id: change.id, patch: { text: change.text } })
  else await ask($, state, '/memory/update', { id: change.id, patch: { text: change.text, ...(change.others.length > 0 ? { supersedes: change.others } : {}) } })
}

async function applyCompact($: EngineInterface, state: State): Promise<string> {
  const plan = state.compactPlan
  if (plan === undefined) return 'no compact proposal in this window; /sage-memory compact makes one'
  state.compactPlan = undefined
  const failed: string[] = []
  let applied = 0
  for (const change of plan.changes) if (await attempt(failed, `${change.kind} ${change.id}`, () => applyChange($, state, change))) applied += 1
  return [`compact applied: ${applied} of ${plan.changes.length} change(s)`, ...failed.map(line => `  failed: ${line}`)].join('\n')
}

async function compactCommand($: EngineInterface, state: State, rest: string): Promise<string> {
  if (!(await isReady(state))) return `the daemon is not ready: ${statusText(state.enabled, state.link, state.project?.name ?? '')}`
  return rest.trim().toLowerCase() === 'apply' ? applyCompact($, state) : proposeCompact($, state)
}

// ── Outcome capture ────────────────────────────────────────────────────

/** Writes what a finished Bash command teaches, while the person turned that capture on. */
async function captureOutcome($: EngineInterface, state: State, command: string, result: unknown, failed: boolean): Promise<void> {
  if ((await $.store.get(failed ? 'captureErrors' : 'captureOutcomes')) !== true || !(await isReady(state))) return
  const input = captureOf(command, outputOf(result), failed, await $.session.id())
  const key = `${failed ? 'error' : 'outcome'}:${command.trim()}`
  if (input === undefined || !mayCapture(state.captured, key, await $.clock.now())) return
  state.captured.set(key, await $.clock.now())
  await ask($, state, '/memory/remember', { input })
}

// ── Pane ───────────────────────────────────────────────────────────────

/** Runs one pane request in the background: the pane shows it working, then its outcome or its failure. */
function paneWork($: EngineInterface, state: State, work: () => Promise<string | undefined>): void {
  state.pane.busy = true
  $.ui.invalidate('ui.render')
  work()
    .then(
      message => {
        state.pane.message = message
      },
      (err: unknown) => {
        state.pane.message = `failed: ${errorText(err)}`
      },
    )
    .finally(() => {
      state.pane.busy = false
      $.ui.invalidate('ui.render')
    })
}

async function loadPage($: EngineInterface, state: State): Promise<undefined> {
  const page = await ask<MemoryPage>($, state, '/memory/list', listBody(state.pane))
  state.pane.memories = page.memories
  state.pane.next = page.nextCursor ?? undefined
  state.pane.total = page.total
  return undefined
}

async function loadCandidates($: EngineInterface, state: State): Promise<undefined> {
  state.pane.candidates = await ask<Candidate[]>($, state, '/candidates/list', {})
  return undefined
}

/** One button's change to a memory; the person's press is the authorization delete's `force` asks for. */
async function writeAction($: EngineInterface, state: State, m: Memory, action: PaneAction): Promise<string> {
  const patch = patchFor(m, action)
  if (patch !== undefined) {
    await ask($, state, '/memory/update', { id: m.id, patch })
    return `${m.id}: ${action}`
  }
  if (action === 'recover') {
    await ask($, state, '/memory/recover', { id: m.id, reason: 'recovered by the person in the pane' })
    return `recovered ${m.id}`
  }
  await ask($, state, '/memory/delete', { id: m.id, force: true, reason: 'deleted by the person in the pane' })
  return `deleted ${m.id}; the recover button brings it back`
}

/** A button under the chosen memory: delete asks for a second press, every change reads the page again. */
async function paneAct($: EngineInterface, state: State, action: PaneAction): Promise<string | undefined> {
  const pane = state.pane
  const m = pane.memories.find(memory => memory.id === pane.selected)
  if (m === undefined) return undefined
  if (action === 'delete' && pane.armed !== m.id) {
    pane.armed = m.id
    return 'press delete again to delete it'
  }
  pane.armed = undefined
  const text = await writeAction($, state, m, action)
  await loadPage($, state)
  return text
}

async function paneCandidate($: EngineInterface, state: State, id: string, action: CandidateAction): Promise<string> {
  const text = action === 'accept' || action === 'reject' ? await candidateAction($, state, action, id, []) : await candidateAction($, state, 'resolve', id, [action])
  state.pane.selected = undefined
  await loadCandidates($, state)
  return text
}

function paneHandlers($: EngineInterface, state: State): Handlers {
  const reload = (): void => paneWork($, state, () => loadPage($, state))
  return {
    search: query => (refilter(state.pane, { query }), reload()),
    scope: scope => (refilter(state.pane, { scope }), reload()),
    status: status => (refilter(state.pane, { status }), reload()),
    page: step => (turnPage(state.pane, step), reload()),
    select: id => {
      state.pane.selected = state.pane.selected === id ? undefined : id
      state.pane.armed = undefined
      $.ui.invalidate('ui.render')
    },
    act: action => paneWork($, state, () => paneAct($, state, action)),
    view: view => {
      Object.assign(state.pane, { view, selected: undefined, armed: undefined, message: undefined })
      paneWork($, state, () => (view === 'candidates' ? loadCandidates($, state) : loadPage($, state)))
    },
    candidate: (id, action) => paneWork($, state, () => paneCandidate($, state, id, action)),
  }
}

/** Opens the memory manager, or closes it when it is open. */
async function openPane($: EngineInterface, state: State): Promise<string> {
  if ((await $.ui.panes()).some(p => p.id === PANE_ID)) {
    await $.ui.close({ id: PANE_ID })
    return 'pane closed'
  }
  const down = await notReady(state)
  if (down !== undefined) return down
  state.pane = emptyPane()
  paneWork($, state, () => loadPage($, state))
  await $.ui.open({ id: PANE_ID, title: 'Memories', focus: true, closeOnEscape: true, holdToasts: true, rows: PAGE_SIZE + 12 })
  return 'pane open: Enter on a row shows the memory and its buttons, delete asks twice, Esc closes'
}

/** A session's end is the whole chain's 1.5 s, so the request waits at most 1 s. */
const END_MS = 1000

/** Asks for the automatic hygiene run; the daemon starts it in the background, at most once an hour per store. */
async function endHygiene($: EngineInterface, state: State): Promise<void> {
  if (!state.enabled || state.link.state !== 'ready') return
  await ask($, state, '/memory/hygiene', { automatic: true }, END_MS)
}

/** A tool result with one more context text the model reads right after it, or unchanged when there is none. */
function withToolContext<R extends { context?: readonly string[] }>(r: R, text: string | undefined): R {
  return text === undefined ? r : { ...r, context: [...(r.context ?? []), text] }
}

/** /clear fixes the system prompt note again and forgets every loop; a compaction starts the main loop over. */
async function atSessionStart($: EngineInterface, state: State, source: string): Promise<void> {
  if (source === 'clear') {
    state.guidance = await readEnabled($, state)
    state.loops.clear()
  }
  if (source === 'compact') await guarded($, 'starting the context over', () => newContext($, state, MAIN_LOOP))
}

/** A prompt the person typed, not a command: the prompts a reminder goes with. */
function isTyped(e: { text: string; origin: { kind: string } }): boolean {
  return (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !e.text.startsWith('/')
}

export const register: Register = on => {
  const state: State = { enabled: true, link: { state: 'off' }, polling: false, guidance: false, loops: new Map(), declared: false, turn: emptyEvidence(), worth: false, asked: [], relevant: [], captured: new Map(), pane: emptyPane(), counts: { reminded: 0, rules: 0, used: 0, added: 0 }, redrawing: false }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'sage-memory', description: 'Project memory recalled when it is relevant: state, on, off, setup (sage-memory)', argumentHint: '[on | off | setup]' })
    state.guidance = await readEnabled($, state)
    await declareTools($, state)
    await scheduleDaily($, state)
    // A -p run draws nothing, so only an interactive session redraws on a timer.
    if (e.isInteractive) $.clock.every(REDRAW_MS, () => void redraw($, state))
    if (state.enabled) await linked($, state)
    else await show($, state)
    return r
  })

  // remember, search, for_file, update and delete are listed at once; the other tools wait behind ToolSearch.
  on('tool.describe', { tool: /^mcp__sage-memory__/ }, async (_, e, next) => {
    const r = await next(e)
    return LISTED.has(e.tool) ? { ...r, isDeferred: false } : r
  })

  // No memory tool asks for approval: the user chose that, and each writes only to the mod's own stores.
  on('tool.check', { tool: /^mcp__sage-memory__/ }, async () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: /^mcp__sage-memory__/ }, async ($, e) => serveTool($, state, toolName(e.tool) ?? '', e as unknown as Input))

  // The note is fixed at a session's start or /clear, so a change of the setting leaves the prompt the cache holds alone.
  on('prompt.section', { name: 'env_info_simple' }, async (_, e, next) => {
    const r = await next(e)
    return r.text === null || !state.guidance ? r : { text: `${r.text}\n\n${SYSTEM_NOTE}` }
  })

  // /clear and a compaction start the main loop's context over.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.agent_id === undefined) await atSessionStart($, state, e.source)
    return r
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

  // The batch adds no reminder: each file tool's result carries its own (below). What the other tools
  // returned joins what the loop shows, and the main loop's batch is evidence for the consolidator.
  on('classic.PostToolBatch', async (_, e, next) => {
    const r = await next(e)
    const loop = loopOf(state, e.agent_id ?? MAIN_LOOP)
    for (const call of e.tool_calls.filter(call => !isReminding(call))) loop.visible = seen(loop.visible, responseText(call.tool_response))
    if (e.agent_id === undefined) noteBatch(state, e.tool_calls)
    return r
  })

  // A file tool's result carries the memories of its own paths. Measured on 2.1.283 (10 runs each), the
  // model called a reminder there a suspicious instruction 1 time in 10, and one after the batch 4 times.
  on('tool.call', { tool: REMINDING_TOOLS }, async ($, e, next) => {
    const r = await next(e)
    const call = callOfTool(e, r)
    if (!succeeded(r) || !isReminding(call)) return r
    // Counted before this call's own reminder joins the loop, so a memory is not used by the call that brought it.
    await guarded($, 'counting the used memories', () => countUse($, state, e.agentId ?? MAIN_LOOP, 'tool_anchor', reminded => actedOn(call, reminded)))
    // A compaction in the middle of a turn started the main loop over: its first file tool brings the global rules back.
    const rules = await guarded($, 'the global rules', () => globalRules($, state, e.agentId ?? MAIN_LOOP))
    return withToolContext(r, joined(rules, await guarded($, 'the reminder after the tool', () => afterCall($, state, call, e.agentId ?? MAIN_LOOP))))
  })

  on('prompt.submit', async ($, e, next) => {
    if (isTyped(e)) {
      state.worth = true
      state.asked = noted(state.asked, e.text, MAX_ASKED)
    }
    const text = isTyped(e) ? await guarded($, 'the reminder with the prompt', () => beforePrompt($, state, e.text)) : undefined
    return next(text === undefined ? e : { ...e, context: [...(e.context ?? []), text] })
  })

  on('agent.spawn', async ($, e, next) => {
    const block = await guarded($, 'the reminder for the subagent', () => forSubagent($, state, e))
    if (block === undefined) return next(e)
    const r = await next({ ...e, prompt: spawnPrompt(block.text, e.prompt) })
    const agentId = r.agentId
    if (agentId !== undefined) await guarded($, 'recording the subagent reminder', () => recordSpawn($, state, agentId, block))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const loopKey = e.agentId ?? MAIN_LOOP
    if (e.reason === 'answer') await guarded($, 'counting the used memories', () => countUse($, state, loopKey, 'assistant_reference', reminded => usedBy(e.answer, reminded)))
    if (e.reason === 'answer' && e.agentId === undefined) afterAnswer($, state, e.answer)
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
    const command = safeCommand(e.command)
    if (e.agentId === undefined && command !== undefined) state.turn.commands = noted(state.turn.commands, command, 10)
    if (succeeded(r)) {
      const call = { tool_name: 'Bash', tool_input: e }
      await guarded($, 'counting the used memories', () => countUse($, state, e.agentId ?? MAIN_LOOP, 'tool_anchor', reminded => actedOn(call, reminded)))
      await guarded($, 'moving anchors', () => remapMoved($, state, e.command, cwd))
    }
    if (!('deny' in r && r.deny !== undefined)) await guarded($, 'capturing the outcome', () => captureOutcome($, state, e.command, r.result, !succeeded(r)))
    return r
  })

  on('session.end', async ($, e, next) => {
    const r = await next(e)
    await guarded($, 'the hygiene at the session end', () => endHygiene($, state))
    return r
  })

  on('command.run', { command: 'sage-memory' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    return paneTree($.ui.resolve(e), state.pane, paneHandlers($, state), e.props.bodyColumns)
  })

  on('ui.close', async (_, e, next) => {
    if (e.id === PANE_ID) state.pane.armed = undefined
    return next(e)
  })

  // Each turn follows an on or off another window stored, before it would recall anything.
  on('turn.start', async ($, e, next) => {
    state.tasks = undefined
    state.turn = emptyEvidence()
    await follow($, state)
    await declareTools($, state)
    return next(e)
  })
}
