import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf, UiPane } from 'claude-code'

import { durationText, endedIds, labelOf, statusText } from '../hooks/tasks.ts'

tier('user')

const ROOT = '/Users/u/app'
const MINUTE = 60_000

const run = (args: string): CommandRunInput => ({
  command: 'bg-tasks', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
})

const PANE = { title: 'Background tasks', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['Pane']

const notification = (id: string, status: string): string =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>`

/** `stopped` are the ids TaskStop was called with; `stopFails` makes TaskStop fail. */
type World = { clock: MockClock; statuses: (string | undefined)[]; panes: UiPane[]; stopped: string[]; consents: string[]; stopFails: boolean; next: number }

function world(on: On): World {
  const w: World = { clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }), statuses: [], panes: [], stopped: [], consents: [], stopFails: false, next: 0 }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_, e) => { w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: true, isPlaced: true }); return { value: undefined } })
  on('ui.close', (_, e) => { w.panes = w.panes.filter(p => p.id !== e.id); return { value: undefined } })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    const bg = (e as { run_in_background?: boolean }).run_in_background === true
    const result = { stdout: '', stderr: '', interrupted: false, ...(bg ? { backgroundTaskId: `b${++w.next}` } : {}) }
    return { result, text: 'ok' } as never
  })
  on('tool.call', { tool: 'TaskStop' }, (_, e) => {
    if (w.stopFails) return { result: 'Error', text: 'No task found', isError: true } as never
    w.stopped.push(e.task_id ?? '')
    w.consents.push(String((e as { consent?: string }).consent ?? ''))
    return { result: { message: 'Successfully stopped task', task_id: e.task_id ?? '', task_type: 'local_bash' }, text: 'ok' } as never
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

const background = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command, run_in_background: true } as never)

const pane = ($: Engine) => $.ui.mount({ plugin: 'bg-tasks', surface: 'terminal', component: 'Pane', requestId: 'bg-tasks', props: PANE })

describe('tasks', () => {
  test('labels, durations, notifications and the status line', () => {
    expect(labelOf('  npm run dev\n  --port 3000')).toBe('npm run dev')
    expect(labelOf('x'.repeat(100))).toHaveLength(80)
    expect([durationText(30_000), durationText(12 * MINUTE), durationText(65 * MINUTE), durationText(49 * 60 * MINUTE)]).toEqual(['<1m', '12m', '1h 5m', '2d 1h'])
    expect(endedIds(`${notification('a1', 'completed')}\n${notification('a2', 'running')}\n${notification('a3', 'killed')}`)).toEqual(['a1', 'a3'])
    expect(statusText([], 0)).toBe(undefined)
    expect(statusText([{ id: 'b', label: 'sleep 9', startedAt: 5 * MINUTE, byUser: false }, { id: 'a', label: 'npm run dev', startedAt: 0, byUser: true }], 12 * MINUTE)).toBe('2 running · oldest 12m (npm run dev)')
  })
})

describe('bg-tasks', () => {
  test('a background command shows on the status line, and its notification removes it', async ($, on) => {
    const w = world(on)
    await started($)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await background($, 'npm run dev')
    await w.clock.advance(12 * MINUTE)
    await background($, 'sleep 600')
    expect(w.statuses.at(-1)).toBe('2 running · oldest 12m (npm run dev)')
    await w.clock.advance(30_000)
    expect(w.statuses.at(-1)).toBe('2 running · oldest 12m (npm run dev)')
    await $.prompt.submit({ text: notification('b1', 'completed'), origin: { kind: 'task-notification' } } as never)
    expect(w.statuses.at(-1)).toBe('1 running · oldest <1m (sleep 600)')
    await $.tool.call({ tool: 'TaskStop', task_id: 'b2' } as never)
    expect(w.statuses.at(-1)).toBe(undefined)
  })

  test('the pane stops a task on a press, with the person as the consent', async ($, on) => {
    const w = world(on)
    await started($)
    await background($, 'npm run dev')
    expect((await $.command.run(run(''))).text).toBe('pane open: Enter on a row stops it, Esc closes')
    const ui = await pane($)
    expect((await ui.find({ type: 'Button', key: 'stop:b1' }))?.props.label).toBe('[ stop ]    <1m  model  npm run dev')
    await ui.press({ key: 'stop:b1' })
    await w.clock.settle()
    expect(w.stopped).toEqual(['b1'])
    expect(w.consents).toEqual(['The user pressed "stop" for "npm run dev" in the bg-tasks pane'])
    expect(await ui.find({ type: 'Button', key: 'stop:b1' })).toBe(undefined)
    expect(w.statuses.at(-1)).toBe(undefined)
    expect((await $.command.run(run(''))).text).toBe('pane closed')
  })

  test('a failed stop keeps the task and says why', async ($, on) => {
    const w = world(on)
    await started($)
    await background($, 'sleep 600')
    w.stopFails = true
    await $.command.run(run(''))
    const ui = await pane($)
    await ui.press({ key: 'stop:b1' })
    await w.clock.settle()
    expect((await $.command.run(run('list'))).text).toBe('on\nb1     <1m  model  sleep 600')
    expect((await ui.find({ type: 'Button', key: 'stop:b1' }))?.props.label).toContain('sleep 600')
  })

  test('off lists nothing and clears the line', async ($, on) => {
    const w = world(on)
    await started($)
    await background($, 'sleep 600')
    expect((await $.command.run(run('off'))).text).toBe('off: background tasks are not listed')
    expect(w.statuses.at(-1)).toBe(undefined)
    await background($, 'sleep 700')
    expect((await $.command.run(run('list'))).text).toBe('off\nno background shell task is running')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the pane), list, on or off')
  })
})
