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

/**
 * The task ids a notification reports as ended. The engine sends
 * `<task-notification><task-id>ID</task-id>…<status>completed</status>…` (measured on 2.1.278).
 */
export function endedIds(text: string): string[] {
  const ids: string[] = []
  for (const block of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block[1] ?? '')?.[1]
    const status = /<status>([^<]+)<\/status>/.exec(block[1] ?? '')?.[1]
    if (id !== undefined && status !== 'running') ids.push(id.trim())
  }
  return ids
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

/** The sidebar section's lines: the same rows the pane draws. */
export function sidebarLines(tasks: readonly Task[], now: number): { text: string }[] {
  return byAge(tasks).map(t => ({ text: rowText(t, now) }))
}

/** The sidebar section's buttons: one stop per task, run as `/bg-tasks stop <id>`. */
export function sidebarButtons(tasks: readonly Task[]): { label: string; command: string; args: string }[] {
  return byAge(tasks).map(t => ({ label: `stop ${t.label}`, command: 'bg-tasks', args: `stop ${t.id}` }))
}

/** The stream entry of a task that ended by itself: what it ran and how long it took. */
export function doneText(task: Task, now: number): string {
  return `${task.label} · finished after ${durationText(now - task.startedAt)}`
}

/** A sidebar section key: the task id cut to what the sidebar takes, so each task keeps its own entry. */
export function sectionKey(id: string): string {
  return `done-${id.replace(/[^A-Za-z0-9._:-]+/g, '-')}`.slice(0, 64)
}

export function listText(tasks: readonly Task[], now: number): string {
  if (tasks.length === 0) return 'no background shell task is running'
  return byAge(tasks).map(t => `${t.id}  ${rowText(t, now)}`).join('\n')
}
