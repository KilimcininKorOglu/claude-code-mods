import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { byAge, doneLine, doneTitle, endedTasks, labelOf, listText, rowText, sectionKey, sidebarButtons, sidebarLines, statusText, type Task } from './tasks.ts'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

const ENABLED_KEY = 'enabled'

const PANE_ID = 'bg-tasks'

const USAGE = 'expects nothing (the pane), list, stop <id>, on or off'

/** How often the status line's ages are redrawn. */
const TICK_MS = 30_000

/** The running tasks by id, the on/off setting, and the last stop's result for the pane. */
type State = { tasks: Map<string, Task>; enabled: boolean; message?: string }

/** The background task a Bash call started, by the model's `run_in_background` or the person's Ctrl+B. */
function startedTask(r: ToolCallResult<'Bash'>): { id: string; byUser: boolean } | undefined {
  if (r.deny !== undefined || r.isError === true) return undefined
  const id = r.result.backgroundTaskId
  return id === undefined ? undefined : { id, byUser: r.result.backgroundedByUser === true }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Writes the task list into the shared sidebar; false when the sidebar mod is absent or closed. */
async function toSidebar($: EngineInterface, tasks: Task[], now: number): Promise<boolean> {
  try {
    return await $.sidebar.set({
      consumer: 'bg-tasks',
      key: 'tasks',
      title: `${tasks.length} running`,
      lines: sidebarLines(tasks, now),
      buttons: sidebarButtons(tasks),
      until: 'session',
      // Below every order-20 section (cache-warm, memory-save), which sorts by consumer name.
      order: 21,
    })
  } catch {
    return false
  }
}

/**
 * A task that ended by itself, as an entry in the sidebar's stream named and coloured by its status.
 * The engine's own task notification already tells the person, so a closed sidebar gets no second
 * line here.
 */
async function toFinished($: EngineInterface, task: Task, status: string, now: number): Promise<void> {
  try {
    await $.sidebar.set({
      consumer: 'bg-tasks',
      key: sectionKey(task.id),
      title: doneTitle(status),
      lines: [doneLine(task, status, now)],
      until: 'stream',
    })
  } catch {
    // The sidebar mod is not installed.
  }
}

async function offSidebar($: EngineInterface): Promise<void> {
  try {
    await $.sidebar.clear({ consumer: 'bg-tasks', key: 'tasks' })
  } catch {
    // The sidebar mod is not installed; there is nothing to clear.
  }
}

/** The sidebar takes the list while it is open; otherwise the status line shows it, as before. */
async function showStatus($: EngineInterface, state: State): Promise<void> {
  const tasks = byAge(state.tasks.values())
  const now = await $.clock.now()
  if (state.enabled && tasks.length > 0 && (await toSidebar($, tasks, now))) {
    $.ui.status(undefined)
    return
  }
  await offSidebar($)
  $.ui.status(state.enabled ? statusText(tasks, now) : undefined)
}

/** Redraws the status line, the sidebar and the pane after the task list changed. */
async function changed($: EngineInterface, state: State): Promise<void> {
  await showStatus($, state)
  $.ui.invalidate('ui.render')
}

/** Stops one task through the engine's TaskStop tool, on the person's press. */
async function stopTask($: EngineInterface, state: State, task: Task): Promise<void> {
  try {
    const r = await $.tool.call({ tool: 'TaskStop', task_id: task.id, consent: `The user pressed "stop" for "${task.label}"` })
    if (r.deny !== undefined || r.isError === true) throw new Error(r.deny ?? r.text ?? 'TaskStop failed')
    state.tasks.delete(task.id)
    state.message = `stopped: ${task.label}`
  } catch (err) {
    state.message = `not stopped: ${task.label}: ${errorText(err)}`
  }
  await changed($, state)
}

async function togglePane($: EngineInterface, state: State): Promise<string> {
  if ((await $.ui.panes()).some(p => p.id === PANE_ID)) {
    await $.ui.close({ id: PANE_ID })
    return 'pane closed'
  }
  state.message = undefined
  const rows = Math.min(state.tasks.size + 4, 20)
  await $.ui.open({ id: PANE_ID, title: 'Background tasks', focus: true, closeOnEscape: true, holdToasts: true, rows })
  return 'pane open: Enter on a row stops it, Esc closes'
}

/** Stops the task a sidebar button names, so a press reaches this mod as `/bg-tasks stop <id>`. */
async function stopById($: EngineInterface, state: State, id: string): Promise<string> {
  const task = state.tasks.get(id)
  if (task === undefined) return `no running task with id ${id}`
  await stopTask($, state, task)
  return state.message ?? `stopped ${task.label}`
}

async function runCommand($: EngineInterface, state: State, args: string): Promise<string> {
  const word = args.trim()
  if (word.startsWith('stop ')) return stopById($, state, word.slice(5).trim())
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED_KEY, word === 'on')
    state.enabled = word === 'on'
    if (!state.enabled) state.tasks.clear()
    await changed($, state)
    return word === 'on' ? 'on: background shell tasks started from now on are listed' : 'off: background tasks are not listed'
  }
  if (word === 'list') return `${state.enabled ? 'on' : 'off'}\n${listText([...state.tasks.values()], await $.clock.now())}`
  return word === '' ? togglePane($, state) : USAGE
}

function paneTree(els: Elements, state: State, now: number, onStop: (task: Task) => void) {
  const { Box, Button, Text } = els
  const tasks = byAge(state.tasks.values())
  return (
    <Box flexDirection="column">
      {tasks.length === 0 ? <Text>No background shell task is running.</Text> : <Text dimColor>{'   age  who    command'}</Text>}
      {tasks.map((t, i) => (
        <Button key={`stop:${t.id}`} plain {...(i === 0 ? { autoFocus: true as const } : {})} label={`[ stop ] ${rowText(t, now)}`} onPress={() => onStop(t)} />
      ))}
      {state.message === undefined ? null : <Text dimColor>{state.message}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  const state: State = { tasks: new Map(), enabled: true }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'bg-tasks', description: 'Background shell tasks: the pane with stop buttons, list, stop <id>, on, off (bg-tasks)', argumentHint: '[list | stop <id> | on | off]' })
    state.enabled = (await $.store.get(ENABLED_KEY)) !== false
    $.clock.every(TICK_MS, () => void showStatus($, state))
    return r
  })

  // The engine prints the plugin name in front of command text and the status line, so the texts do not repeat it.
  on('command.run', { command: 'bg-tasks' }, async ($, e) => ({ text: await runCommand($, state, String(e.args ?? '')) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const started = startedTask(r)
    if (!state.enabled || started === undefined) return r
    state.tasks.set(started.id, { ...started, label: labelOf(e.command), startedAt: await $.clock.now() })
    await changed($, state)
    return r
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const r = await next(e)
    const id = e.task_id ?? e.shell_id
    if (r.deny === undefined && r.isError !== true && id !== undefined && state.tasks.delete(id)) await changed($, state)
    return r
  })

  on('prompt.submit', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    const ended = endedTasks(e.text).flatMap(({ id, status }) => {
      const task = state.tasks.get(id)
      return task === undefined ? [] : [{ task, status }]
    })
    if (ended.length === 0) return next(e)
    const now = await $.clock.now()
    for (const { task, status } of ended) {
      state.tasks.delete(task.id)
      await toFinished($, task, status, now)
    }
    await changed($, state)
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    const now = await $.clock.now()
    return paneTree($.ui.resolve(e), state, now, task => void stopTask($, state, task))
  })
}
