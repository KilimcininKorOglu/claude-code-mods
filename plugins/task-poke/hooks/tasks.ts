import type { SessionMessage, ToolUseSummary } from 'claude-code'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Tasks = Map<string, TaskStatus>

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

/**
 * Rebuilds the task list from the transcript. Returns null when the session
 * never used TodoWrite or the Task tools, and `seed` holds nothing either.
 *
 * TodoWrite replaces the whole list. TaskCreate adds one task and TaskUpdate
 * patches one task by id. A TaskList result is the whole list at that point,
 * so it replaces what the replay held. A later TodoWrite replaces everything
 * before it.
 *
 * `seed` is the list an earlier reading of this session built. A long transcript
 * answers its newest messages alone, so a task created before that window and
 * never updated inside it is only in the seed.
 */
export function taskState(messages: readonly SessionMessage[], seed: Tasks | null = null): Tasks | null {
  let tasks: Tasks | null = seed === null ? null : new Map(seed)
  for (const message of messages) {
    for (const use of message.toolUses) tasks = applyUse(tasks, use)
  }
  return tasks
}

/** Counts the tasks that are pending or in progress. */
export function unfinishedCount(tasks: Tasks | null): number {
  if (tasks === null) return 0
  let count = 0
  for (const status of tasks.values()) if (status !== 'completed') count += 1
  return count
}

export type Reading =
  | { ok: true; open: number; askedUser: boolean; tasks: Tasks | null }
  | { ok: false; error: string }

/**
 * Reads the unfinished task count and the AskUserQuestion state from the transcript.
 * A transcript the parser cannot read returns the parser's error instead of a count,
 * so the caller can report it rather than guess a count. The list it built comes back
 * with it, to seed the next reading.
 */
export function readTurn(messages: readonly SessionMessage[], seed: Tasks | null = null): Reading {
  try {
    const tasks = taskState(messages, seed)
    return { ok: true, open: unfinishedCount(tasks), askedUser: asksUser(messages), tasks }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The list as one string, so two readings can be compared: any status change makes another. */
export function signatureOf(tasks: Tasks | null): string {
  if (tasks === null) return ''
  return [...tasks].map(([id, status]) => `${id}:${status}`).sort().join(',')
}

/**
 * True when a tool ran in the turn that just ended: the messages after the newest prompt, the user
 * message that started it. A tool result is a user message too, so a user message that carries tool
 * results is not a prompt. A turn that only wrote words did no work, and a poke that buys another
 * such turn buys the same answer again.
 */
export function workedThisTurn(messages: readonly SessionMessage[]): boolean {
  const prompt = messages.findLastIndex(m => m.role === 'user' && (m.toolResults ?? []).length === 0)
  if (prompt === -1) return false
  return messages.slice(prompt + 1).some(m => m.toolUses.length > 0)
}

/** True when the last assistant message asked the user a question through AskUserQuestion. */
export function asksUser(messages: readonly SessionMessage[]): boolean {
  const last = messages.findLast(m => m.role === 'assistant')
  return last !== undefined && last.toolUses.some(u => u.tool === 'AskUserQuestion')
}

function applyUse(tasks: Tasks | null, use: ToolUseSummary): Tasks | null {
  if (use.isError) return tasks
  switch (use.tool) {
    case 'TodoWrite':
      return fromTodoWrite(use.input)
    case 'TaskCreate':
      return withCreate(tasks, use)
    case 'TaskUpdate':
      return withUpdate(tasks, use)
    case 'TaskList':
      return fromTaskList(tasks, use)
    default:
      return tasks
  }
}

function fromTodoWrite(input: Record<string, unknown>): Tasks {
  const todos = input.todos
  if (!Array.isArray(todos)) throw new Error('task-poke: TodoWrite input has no todos array')
  return new Map(todos.map((todo: unknown, i) => [String(i), parseStatus(field(todo, 'status'))]))
}

// The assigned id is not in the TaskCreate input. The tool result carries it as { task: { id } }.
function withCreate(tasks: Tasks | null, use: ToolUseSummary): Tasks | null {
  if (use.result === undefined) return tasks
  const id = field(field(use.result, 'task'), 'id')
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error('task-poke: TaskCreate result has no task.id')
  }
  const next = new Map(tasks ?? [])
  next.set(String(id), 'pending')
  return next
}

// Claude Code repairs id and task_id to taskId before it runs the tool, but the transcript keeps the raw input.
// A failed update (an unknown taskId) is not an error result: its record is { success: false, error }.
function withUpdate(tasks: Tasks | null, use: ToolUseSummary): Tasks | null {
  const input = use.input
  const id = input.taskId ?? input.id ?? input.task_id
  if (input.status === undefined || id === undefined) return tasks
  if (field(use.result, 'success') === false) return tasks
  const next = new Map(tasks ?? [])
  if (input.status === 'deleted') next.delete(String(id))
  else next.set(String(id), parseStatus(input.status))
  return next
}

// The TaskList result carries the whole list, so it is the list at that point of the transcript and
// replaces what the replay held. A result without a tasks array says nothing, and leaves the list alone.
function fromTaskList(tasks: Tasks | null, use: ToolUseSummary): Tasks | null {
  return tasksOfList(use.result) ?? tasks
}

/**
 * The list a TaskList result names, or null when it names none. The same shape comes from the
 * transcript and from the mod's own `$.tool.call({ tool: 'TaskList' })`, which reads the engine's
 * list itself: the only source that holds a task older than the transcript window.
 */
export function tasksOfList(result: unknown): Tasks | null {
  const rows = field(result, 'tasks')
  if (!Array.isArray(rows)) return null
  const next: Tasks = new Map()
  for (const row of rows) {
    const id = field(row, 'id')
    if (typeof id !== 'string' && typeof id !== 'number') throw new Error('task-poke: a TaskList row has no id')
    next.set(String(id), parseStatus(field(row, 'status')))
  }
  return next
}

function parseStatus(value: unknown): TaskStatus {
  if (typeof value === 'string' && STATUSES.includes(value)) return value as TaskStatus
  throw new Error(`task-poke: unknown task status ${JSON.stringify(value)}`)
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>)[key]
}
