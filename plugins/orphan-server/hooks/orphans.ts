/** The servers left listening, the Bash calls that started them, and the texts this mod writes. */

/** One process as `ps -o pid=,ppid=,etime=,args=` names it, with its start time worked out from its age. */
export type Proc = { pid: number; ppid: number; startedAt: number; args: string }

/** A process that listens, with its TCP ports. */
export type Listener = Proc & { ports: number[] }

/** One Bash call of a transcript: its tool_use id, when the model wrote it, its command and its session. */
export type Call = { id: string; at: number; command: string; sessionId: string }

/** The Bash calls of the transcript lines read, and when each call's result was written. */
export type Calls = { uses: Call[]; ends: Map<string, number> }

/** A listener a Bash call of this project started, and the session that call belongs to. */
export type Orphan = Listener & { sessionId: string }

const SECOND = 1000
const MINUTE = 60 * SECOND

/** How far a start time read from `etime` (whole seconds) and a transcript time may sit apart. */
export const SLACK = 2 * SECOND

/** The longest a Bash call runs (its timeout ceiling), so a call with no result still has an end. */
const LONGEST = 10 * MINUTE

/** A command tail shorter than this matches too much text to name a server. */
const MIN_TAIL = 3

/** The longest label shown. */
const MAX_LABEL = 80

/** The TCP ports each pid listens on, from `lsof -nP -iTCP -sTCP:LISTEN -Fpn` (`p<pid>`, `f<fd>`, `n*:8787`). */
export function listenersOf(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  let pid = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid > 0) addPort(ports, pid, /:(\d+)$/.exec(line)?.[1])
  }
  return ports
}

function addPort(ports: Map<number, number[]>, pid: number, port: string | undefined): void {
  if (port === undefined) return
  const list = ports.get(pid) ?? []
  if (!list.includes(Number(port))) list.push(Number(port))
  ports.set(pid, list)
}

/** The working directory of each pid, from `lsof -a -p <pids> -d cwd -Fpn`. */
export function cwdsOf(out: string): Map<number, string> {
  const cwds = new Map<number, string>()
  let pid = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid > 0) cwds.set(pid, line.slice(1))
  }
  return cwds
}

const ETIME = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/

/** A `ps` elapsed time, `[[dd-]hh:]mm:ss`, in milliseconds. */
export function etimeMs(text: string): number | undefined {
  const m = ETIME.exec(text.trim())
  if (m === null) return undefined
  const [days, hours, minutes, seconds] = [m[1], m[2], m[3], m[4]].map(v => Number(v ?? 0))
  return ((((days ?? 0) * 24 + (hours ?? 0)) * 60 + (minutes ?? 0)) * 60 + (seconds ?? 0)) * SECOND
}

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/

/** The rows of `ps -o pid=,ppid=,etime=,args=`, each start time counted back from `now`. */
export function procsOf(out: string, now: number): Proc[] {
  const procs: Proc[] = []
  for (const line of out.split('\n')) {
    const m = PS_ROW.exec(line)
    const age = m === null ? undefined : etimeMs(m[3] ?? '')
    if (m === null || age === undefined) continue
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), startedAt: now - age, args: (m[4] ?? '').trim() })
  }
  return procs
}

/** Whether a working directory is the repository root or under it. */
export function isInside(cwd: string | undefined, root: string): boolean {
  return cwd !== undefined && root !== '' && (cwd === root || cwd.startsWith(`${root}/`))
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * What the model typed of a process: its arguments without argv0, whose path the shell resolved
 * (`python3` runs as `.../Python.app/Contents/MacOS/Python`). A process with no arguments keeps its name.
 */
export function tailOf(args: string): string {
  const at = args.indexOf(' ')
  if (at < 0) return baseName(args)
  const rest = args.slice(at + 1).trim()
  return rest === '' ? baseName(args.slice(0, at)) : rest
}

/** The label the person reads: the program's name and its arguments, cut to `MAX_LABEL` characters. */
export function labelOf(args: string): string {
  const at = args.indexOf(' ')
  const text = at < 0 ? baseName(args) : `${baseName(args.slice(0, at))} ${args.slice(at + 1).trim()}`
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text
}

/**
 * The transcript time prefixes of the minutes a Bash call that started the process can sit in: from
 * the longest call before the start to one minute after it, in UTC as the transcript writes them.
 */
export function patternsOf(procs: readonly Proc[]): string[] {
  const patterns = new Set<string>()
  for (const p of procs) {
    for (let t = p.startedAt - LONGEST - MINUTE; t <= p.startedAt + MINUTE; t += MINUTE) {
      patterns.add(`"timestamp":"${new Date(t).toISOString().slice(0, 16)}`)
    }
  }
  return [...patterns]
}

type Row = { timestamp?: unknown; sessionId?: unknown; message?: { content?: unknown } }
type Block = { type?: unknown; id?: unknown; name?: unknown; input?: { command?: unknown }; tool_use_id?: unknown }

/** The content blocks of one transcript line; a line that is not a message record has none. */
function blocksOf(line: string): { row: Row; blocks: Block[] } | undefined {
  if (!line.startsWith('{')) return undefined
  let row: Row
  try {
    row = JSON.parse(line) as Row
  } catch (err) {
    // A line the engine is still writing is not a record yet.
    if (err instanceof SyntaxError) return undefined
    throw err
  }
  const content = row.message?.content
  return Array.isArray(content) ? { row, blocks: content as Block[] } : undefined
}

/** A Bash tool_use block as a call; any other block is none. */
function useOf(row: Row, b: Block, at: number): Call | undefined {
  const command = b.input?.command
  if (b.type !== 'tool_use' || b.name !== 'Bash' || typeof b.id !== 'string' || typeof command !== 'string') return undefined
  return { id: b.id, at, command, sessionId: typeof row.sessionId === 'string' ? row.sessionId : '' }
}

function addBlock(calls: Calls, row: Row, b: Block): void {
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
  if (Number.isNaN(at)) return
  if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
    calls.ends.set(b.tool_use_id, at)
    return
  }
  const use = useOf(row, b, at)
  if (use !== undefined) calls.uses.push(use)
}

/** The Bash calls and the result times of the transcript lines `grep` printed. */
export function callsOf(out: string): Calls {
  const calls: Calls = { uses: [], ends: new Map() }
  for (const line of out.split('\n')) {
    const parsed = blocksOf(line.trim())
    for (const b of parsed?.blocks ?? []) addBlock(calls, parsed?.row ?? {}, b)
  }
  return calls
}

/** Whether a process started while the call ran: after the model wrote it, before its result was written. */
function ranDuring(call: Call, end: number | undefined, startedAt: number): boolean {
  return call.at - SLACK <= startedAt && startedAt <= (end ?? call.at + LONGEST) + SLACK
}

/**
 * The Bash call that started a process: it ran when the process started, and its command holds what
 * the model typed of the process. Of several, the one written closest to the start.
 */
export function matchOf(proc: Proc, calls: Calls): Call | undefined {
  const tail = tailOf(proc.args)
  if (tail.length < MIN_TAIL) return undefined
  const fits = calls.uses.filter(c => c.command.includes(tail) && ranDuring(c, calls.ends.get(c.id), proc.startedAt))
  return fits.sort((a, b) => Math.abs(proc.startedAt - a.at) - Math.abs(proc.startedAt - b.at))[0]
}

/** Whether a process read again is still the one listed: same parent, same arguments, same start. */
export function isSame(listed: Proc, now: Proc | undefined): boolean {
  return now !== undefined && now.ppid === 1 && now.args === listed.args && Math.abs(now.startedAt - listed.startedAt) <= SLACK
}

/** Durations as limit-watch and bg-tasks write them: `<1m`, `45m`, `2h 36m`, `3h`, `5d 11h`. */
export function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function portsText(ports: readonly number[]): string {
  return ports.map(p => `:${p}`).join(', ')
}

function sessionText(sessionId: string, current: string): string {
  return sessionId === current ? 'this session' : `session ${sessionId.slice(0, 8)}`
}

/** One row: the ports, what runs, its age and the session whose Bash call started it. */
export function rowText(o: Orphan, now: number, current: string): string {
  return `${portsText(o.ports)} ${labelOf(o.args)} · ${durationText(now - o.startedAt)} · ${sessionText(o.sessionId, current)}`
}

/** Oldest first. */
export function byAge(orphans: Iterable<Orphan>): Orphan[] {
  return [...orphans].sort((a, b) => a.startedAt - b.startedAt)
}

export function sidebarLines(orphans: readonly Orphan[], now: number, current: string): { text: string; kind: 'warn' }[] {
  return byAge(orphans).map(o => ({ text: rowText(o, now, current), kind: 'warn' }))
}

/** One stop button per server, run as `/orphan-server stop <pid>`. */
export function sidebarButtons(orphans: readonly Orphan[]): { label: string; command: string; args: string }[] {
  return byAge(orphans).map(o => ({ label: `stop ${portsText(o.ports)}`, command: 'orphan-server', args: `stop ${o.pid}` }))
}

/** The one transcript line while the sidebar is closed. The engine adds the mod name. */
export function logText(orphans: readonly Orphan[], now: number, current: string): string {
  const rows = byAge(orphans).map(o => `${o.pid} ${rowText(o, now, current)}`)
  return `${orphans.length} server(s) the model started still listen: ${rows.join('; ')}; /orphan-server stop <pid> stops one`
}

/** The `/orphan-server` answer. */
export function listText(orphans: readonly Orphan[], now: number, current: string): string {
  if (orphans.length === 0) return 'no server the model started listens in this repository'
  return byAge(orphans).map(o => `${o.pid}  ${rowText(o, now, current)}`).join('\n')
}

export function stoppedText(o: Orphan): string {
  return `stopped ${portsText(o.ports)} ${labelOf(o.args)}`
}

export function stillText(o: Orphan): string {
  return `${portsText(o.ports)} ${labelOf(o.args)} still runs after SIGKILL`
}

export function changedText(pid: number): string {
  return `${pid} is no longer the server that was listed, so nothing was sent to it`
}

/** A sidebar section key: the text cut to what the sidebar takes. */
export function sectionKey(text: string): string {
  return text.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 64)
}

/** The directory the host keeps its data under: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
export function configDirOf(configDir: string | undefined, home: string | undefined): string {
  if (configDir !== undefined && configDir !== '') return configDir
  return home !== undefined && home !== '' ? `${home}/.claude` : ''
}

/**
 * The transcript directory of a start directory: under `projects/`, the directory with every character
 * but a letter or a digit turned into `-` (measured on 2.1.280).
 */
export function transcriptDir(configDir: string, cwd: string): string {
  return `${configDir}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
}
