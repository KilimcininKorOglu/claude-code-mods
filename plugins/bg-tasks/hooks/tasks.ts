/** The background shell tasks the session started, and their texts on the status line and in the pane. */

/** One background shell: its task id, what it runs, when it started and whether the person backgrounded it. */
export type Task = { id: string; label: string; startedAt: number; byUser: boolean }

const MINUTE = 60_000

/** The longest label shown. */
const MAX_LABEL = 80

/** The first line of the command, cut to `MAX_LABEL` characters. */
export function labelOf(command: string): string {
  const line = command.trim().split('\n')[0] ?? ''
  return line.length > MAX_LABEL ? `${line.slice(0, MAX_LABEL - 1)}…` : line
}

/** Durations as limit-watch and cache-warm write them: `<1m`, `45m`, `2h 36m`, `3h`, `5d 11h`. */
export function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** A task a notification reports as ended, with the status it ended in. */
export type Ended = { id: string; status: string }

/**
 * The tasks a notification reports as ended. The engine sends
 * `<task-notification><task-id>ID</task-id>…<status>completed</status>…` (measured on 2.1.278).
 */
export function endedTasks(text: string): Ended[] {
  const ended: Ended[] = []
  for (const block of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block[1] ?? '')?.[1]
    const status = /<status>([^<]+)<\/status>/.exec(block[1] ?? '')?.[1]?.trim() ?? 'ended'
    if (id !== undefined && status !== 'running') ended.push({ id: id.trim(), status })
  }
  return ended
}

/** Tasks from the oldest to the newest. */
export function byAge(tasks: Iterable<Task>): Task[] {
  return [...tasks].sort((a, b) => a.startedAt - b.startedAt)
}

/** The status line text, or undefined for no line. */
export function statusText(tasks: readonly Task[], now: number): string | undefined {
  const oldest = byAge(tasks)[0]
  if (oldest === undefined) return undefined
  return `${tasks.length} running · oldest ${durationText(now - oldest.startedAt)} (${oldest.label})`
}

/** One pane or list row: age, who backgrounded it, the command. */
export function rowText(task: Task, now: number): string {
  return `${durationText(now - task.startedAt).padStart(6)}  ${task.byUser ? 'you  ' : 'model'}  ${task.label}`
}

/** A task that has run this long draws its age in yellow, so a runaway one stands out. */
const LONG_MS = 60 * MINUTE

/**
 * One sidebar row, the same text the pane draws: the age faint, or yellow past an hour, who
 * backgrounded it faint, and the command in the default colour.
 */
function rowLine(task: Task, now: number): Line {
  const age = now - task.startedAt
  const parts: Part[] = [
    { text: durationText(age).padStart(6), kind: age >= LONG_MS ? 'warn' : 'dim' },
    { text: '  ' },
    { text: task.byUser ? 'you  ' : 'model', kind: 'dim' },
    { text: `  ${task.label}` },
  ]
  return { text: parts.map(p => p.text).join(''), parts }
}

/** The sidebar section's lines: the same rows the pane draws. */
export function sidebarLines(tasks: readonly Task[], now: number): Line[] {
  return byAge(tasks).map(t => rowLine(t, now))
}

/** The sidebar section's buttons: one stop per task, run as `/bg-tasks stop <id>`. */
export function sidebarButtons(tasks: readonly Task[]): { label: string; command: string; args: string }[] {
  return byAge(tasks).map(t => ({ label: `stop ${t.label}`, command: 'bg-tasks', args: `stop ${t.id}` }))
}

type Kind = 'ok' | 'warn' | 'error' | 'dim'

/** A piece of a sidebar line in its own colour. */
type Part = { text: string; kind?: Kind }

/** A sidebar line made of parts; `text` holds the whole line for a sidebar that draws no parts. */
export type Line = { text: string; kind?: Kind; parts?: Part[] }

/**
 * How an ended task is named and coloured: `completed` finished in green, `killed` in yellow, and
 * `failed` or any status the engine adds later in red, under its own name.
 */
function endedWord(status: string): { word: string; kind: Kind } {
  if (status === 'completed') return { word: 'finished', kind: 'ok' }
  return status === 'killed' ? { word: 'killed', kind: 'warn' } : { word: status, kind: 'error' }
}

/** The stream entry's title for an ended task: `task finished`, `task failed`, `task killed`. */
export function doneTitle(status: string): string {
  return `task ${endedWord(status).word}`
}

/**
 * The stream entry of a task that ended by itself: what it ran, how it ended and how long it took.
 * Only the status word is coloured, so a failed task does not read as a finished one.
 */
export function doneLine(task: Task, status: string, now: number): Line {
  const { word, kind } = endedWord(status)
  const parts: Part[] = [{ text: `${task.label} · ` }, { text: word, kind }, { text: ` after ${durationText(now - task.startedAt)}` }]
  return { text: parts.map(p => p.text).join(''), parts }
}

/** A sidebar section key: the task id cut to what the sidebar takes, so each task keeps its own entry. */
export function sectionKey(id: string): string {
  return `done-${id.replace(/[^A-Za-z0-9._:-]+/g, '-')}`.slice(0, 64)
}

export function listText(tasks: readonly Task[], now: number): string {
  if (tasks.length === 0) return 'no background shell task is running'
  return byAge(tasks).map(t => `${t.id}  ${rowText(t, now)}`).join('\n')
}
