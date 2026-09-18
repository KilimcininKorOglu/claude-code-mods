import type { SessionMessage, ToolUseSummary } from 'claude-code'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Tasks = Map<string, TaskStatus>

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

/**
 * Rebuilds the task list from the transcript. Returns null when the session
 * never used TodoWrite or the Task tools.
 *
 * TodoWrite replaces the whole list. TaskCreate adds one task and TaskUpdate
 * patches one task by id. A later TodoWrite replaces everything before it.
 */
export function taskState(messages: readonly SessionMessage[]): Tasks | null {
  let tasks: Tasks | null = null
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
      return withUpdate(tasks, use.input)
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
function withUpdate(tasks: Tasks | null, input: Record<string, unknown>): Tasks | null {
  const id = input.taskId ?? input.id ?? input.task_id
  if (input.status === undefined || id === undefined) return tasks
  const next = new Map(tasks ?? [])
  if (input.status === 'deleted') next.delete(String(id))
  else next.set(String(id), parseStatus(input.status))
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
