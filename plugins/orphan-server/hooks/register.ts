import type { EngineInterface, Register } from 'claude-code'
import {
  byAge, callsOf, changedText, configDirOf, cwdsOf, isInside, isSame, listenersOf, listText, logText, matchOf, patternsOf, procsOf,
  sectionKey, sidebarButtons, sidebarLines, SLACK, stillLine, stoppedLine, transcriptDir, type Listener, type Orphan, type Proc,
} from './orphans.ts'

const ENABLED_KEY = 'enabled'
const CONSUMER = 'orphan-server'
const SECTION = 'orphans'
const USAGE = 'expects nothing (the list), stop <pid>, on or off'

/** How long a server has to end after SIGTERM before it gets SIGKILL. */
const GRACE_MS = 5000

/** What one listener was found to be, so a later scan does not read the transcripts for it again. */
type Seen = { startedAt: number; orphan: Orphan | undefined }

/**
 * The on/off setting, the repository whose servers are read, the transcript directories of its
 * sessions, this session's id, what each listener was found to be, the servers of the last scan by pid,
 * the pids the sidebar shows, the pids the last transcript line named, and the work in flight, so two scans never interleave.
 */
type State = {
  enabled: boolean
  root: string
  dirs: string[]
  sid: string
  seen: Map<string, Seen>
  listed: Map<number, Orphan>
  shown: string
  logged: string
  chain: Promise<void>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A command's standard output. A non-zero exit is an answer too: lsof, ps and grep exit 1 on nothing found. */
async function output($: EngineInterface, argv: string[], cwd?: string): Promise<string> {
  return (await $.process.run(argv, cwd === undefined ? undefined : { cwd })).stdout
}

/** The repository the session started in, or its start directory where git does not answer. */
async function rootOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    if (r.exitCode === 0 && r.stdout.trim() !== '') return r.stdout.trim()
  } catch {
    // git is missing; the start directory is the scope.
  }
  return cwd
}

/** The processes that listen on TCP, whose parent is 1, and whose working directory is inside the repository. */
async function listenersIn($: EngineInterface, state: State): Promise<Listener[]> {
  const ports = listenersOf(await output($, ['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']))
  if (ports.size === 0) return []
  const procs = procsOf(await output($, ['ps', '-o', 'pid=,ppid=,etime=,args=', '-p', [...ports.keys()].join(',')]), await $.clock.now())
  const orphaned = procs.filter(p => p.ppid === 1)
  if (orphaned.length === 0) return []
  const cwds = cwdsOf(await output($, ['lsof', '-a', '-p', orphaned.map(p => p.pid).join(','), '-d', 'cwd', '-Fpn']))
  return orphaned.filter(p => isInside(cwds.get(p.pid), state.root)).map(p => ({ ...p, ports: ports.get(p.pid) ?? [] }))
}

const seenKey = (p: Proc): string => `${p.pid} ${p.args}`

function seenOf(state: State, p: Proc): Seen | undefined {
  const seen = state.seen.get(seenKey(p))
  return seen !== undefined && Math.abs(seen.startedAt - p.startedAt) <= SLACK ? seen : undefined
}

/**
 * The listeners a Bash call of this project started. The transcripts are read once per new listener,
 * and only their lines of the minutes that call can sit in, because a transcript runs to hundreds of MB.
 */
async function orphansOf($: EngineInterface, state: State, listeners: readonly Listener[]): Promise<Orphan[]> {
  const fresh = listeners.filter(l => seenOf(state, l) === undefined)
  // With no transcript directory, grep would read its standard input.
  if (fresh.length > 0 && state.dirs.length > 0) {
    const patterns = patternsOf(fresh).flatMap(p => ['-e', p])
    const calls = callsOf(await output($, ['grep', '-rhsF', '--include=*.jsonl', ...patterns, ...state.dirs]))
    for (const l of fresh) {
      const call = matchOf(l, calls)
      state.seen.set(seenKey(l), { startedAt: l.startedAt, orphan: call === undefined ? undefined : { ...l, sessionId: call.sessionId } })
    }
  }
  return listeners.flatMap(l => seenOf(state, l)?.orphan ?? [])
}

/** The standing section, or its removal; false while the sidebar is closed or missing. */
async function toSidebar($: EngineInterface, state: State, orphans: readonly Orphan[]): Promise<boolean> {
  try {
    if (orphans.length === 0) {
      await $.sidebar.clear({ consumer: CONSUMER, key: SECTION })
      return true
    }
    const now = await $.clock.now()
    return await $.sidebar.set({ consumer: CONSUMER, key: SECTION, title: 'orphan servers', lines: sidebarLines(orphans, now, state.sid), buttons: sidebarButtons(orphans), until: 'session', order: 16 })
  } catch {
    // The sidebar mod is not installed.
    return false
  }
}

/**
 * The section, redrawn when the set of servers changed and drawn at the next scan when the sidebar was
 * closed at this one; while it is closed, one transcript line per set of servers.
 */
async function show($: EngineInterface, state: State, orphans: readonly Orphan[]): Promise<void> {
  const shown = byAge(orphans).map(o => o.pid).join(',')
  if (shown === state.shown) return
  if (await toSidebar($, state, orphans)) {
    state.shown = shown
    return
  }
  if (orphans.length > 0 && shown !== state.logged) $.ui.log(logText(orphans, await $.clock.now(), state.sid))
  state.logged = shown
}

async function scan($: EngineInterface, state: State): Promise<Orphan[]> {
  const orphans = await orphansOf($, state, await listenersIn($, state))
  state.listed = new Map(orphans.map(o => [o.pid, o]))
  await show($, state, orphans)
  return orphans
}

/** Runs work after the work in flight, so two scans never interleave. The caller reads its failure. */
function serial<T>(state: State, work: () => Promise<T>): Promise<T> {
  const run = state.chain.then(work)
  state.chain = run.then(() => undefined, () => undefined)
  return run
}

/** Runs one scan off the hook that asked, so no turn waits on lsof or grep. */
function later($: EngineInterface, state: State): void {
  $.clock.after(0, () => {
    serial(state, () => scan($, state)).catch(err => $.ui.log(`the servers were not read: ${errorText(err)}`))
  })
}

/** The process as it runs now, or undefined when it is gone. */
async function readProc($: EngineInterface, pid: number): Promise<Proc | undefined> {
  const procs = procsOf(await output($, ['ps', '-o', 'pid=,ppid=,etime=,args=', '-p', String(pid)]), await $.clock.now())
  return procs.find(p => p.pid === pid)
}

/** One stream entry: `stopped` green for a server that ended, `still runs after SIGKILL` red for one that did not. */
async function toStream($: EngineInterface, o: Orphan, isGone: boolean): Promise<void> {
  const line = isGone ? stoppedLine(o) : stillLine(o)
  try {
    if (await $.sidebar.set({ consumer: CONSUMER, key: sectionKey(`stop-${o.pid}`), title: 'orphan server', lines: [line], until: 'stream' })) return
  } catch {
    // The sidebar mod is not installed.
  }
  $.ui.log(line.text)
}

/** After the grace time: SIGKILL for a server still running, then what became of it, then a new scan. */
async function finish($: EngineInterface, state: State, o: Orphan): Promise<void> {
  if (isSame(o, await readProc($, o.pid))) await output($, ['kill', '-KILL', String(o.pid)])
  const isGone = !isSame(o, await readProc($, o.pid))
  await toStream($, o, isGone)
  await scan($, state)
}

/**
 * SIGTERM to a listed server, and SIGKILL after the grace time. The process is read again first, so a
 * pid the system gave to another process since the scan gets nothing.
 */
async function stop($: EngineInterface, state: State, pid: number): Promise<string> {
  const o = state.listed.get(pid)
  if (o === undefined) return `${pid} is not a listed server; /orphan-server lists them`
  if (!isSame(o, await readProc($, pid))) return changedText(pid)
  await output($, ['kill', '-TERM', String(pid)])
  $.clock.after(GRACE_MS, () => {
    serial(state, () => finish($, state, o)).catch(err => $.ui.log(`${pid} was not stopped: ${errorText(err)}`))
  })
  return `sent SIGTERM to ${pid}; SIGKILL follows in 5 s if it still runs`
}

async function setEnabled($: EngineInterface, state: State, on: boolean): Promise<string> {
  state.enabled = on
  await $.store.set(ENABLED_KEY, on)
  if (on) later($, state)
  return on ? 'on: the servers are read at session start and at the end of each turn' : 'off: the servers are read only when you run /orphan-server'
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const [word, pid, ...rest] = args.trim().split(/\s+/)
  if ((word === 'on' || word === 'off') && pid === undefined) return setEnabled($, state, word === 'on')
  if (word === 'stop' && /^\d+$/.test(pid ?? '') && rest.length === 0) return stop($, state, Number(pid))
  if (word !== '') return USAGE
  // The person asked, so the list is measured now rather than read from the last scan.
  return listText(await serial(state, () => scan($, state)), await $.clock.now(), state.sid)
}

export const register: Register = on => {
  const state: State = { enabled: true, root: '', dirs: [], sid: '', seen: new Map(), listed: new Map(), shown: '', logged: '', chain: Promise.resolve() }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    state.root = await rootOf($, e.cwd)
    state.sid = await $.session.id()
    const config = configDirOf(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
    state.dirs = config === '' ? [] : [...new Set([transcriptDir(config, state.root), transcriptDir(config, e.cwd)])]
    await $.command.register({ name: 'orphan-server', description: 'Servers the model started that still listen in this repository: list, stop <pid>, on, off (orphan-server)', argumentHint: '[stop <pid> | on | off]', immediate: true })
    if (state.enabled) later($, state)
    return r
  })

  // The engine prints the plugin name in front of command text and log lines, so the texts do not repeat it.
  on('command.run', { command: 'orphan-server' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A server this session started shows at the end of the turn that started it.
    if (state.enabled && e.agentId === undefined) later($, state)
    return r
  })
}
