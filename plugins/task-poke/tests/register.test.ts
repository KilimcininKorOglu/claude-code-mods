import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type {
  CommandRunInput,
  On,
  PromptSubmitInput,
  SessionMessage,
  SessionStartInput,
  ToolUseSummary,
  TurnCompleteInput,
  TurnCompleteReason,
} from 'claude-code'

import { DEFAULT_MAX_POKES, MAX_STALLS, limitOf } from '../hooks/register.ts'

tier('user')

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
// Every reason but 'refusal', which needs a refusal payload. No test drives a refused turn.
type TurnOver = { reason?: Exclude<TurnCompleteReason, 'refusal'>; isAborted?: boolean; agentId?: string }
const turn = (over: TurnOver = {}): TurnCompleteInput => ({
  answer: 'done',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  ...over,
})
const typed = (): PromptSubmitInput => ({ text: 'go on', wait: false, origin: { kind: 'composer' } })
const run = (args: string): CommandRunInput => ({
  command: 'task-poke',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

const use = (tool: string, input: Record<string, unknown>, result?: unknown): ToolUseSummary => ({
  tool_use_id: `${tool}-${JSON.stringify(input)}`,
  tool,
  input,
  result,
})
const assistant = (...toolUses: ToolUseSummary[]): SessionMessage => ({ role: 'assistant', text: '', toolUses })
const prompted = (text = 'go on'): SessionMessage => ({ role: 'user', text, toolUses: [] })

/** A turn that did work: a prompt, then a tool. Without one the mod counts the poke as moving nothing. */
const working = (...before: SessionMessage[]): SessionMessage[] => [...before, prompted(), assistant(use('Read', { file_path: '/x' }))]

const todoWrite = (...statuses: string[]): SessionMessage =>
  assistant(use('TodoWrite', { todos: statuses.map((status, i) => ({ content: `t${i}`, status, activeForm: `t${i}` })) }))
const created = (id: string): ToolUseSummary => use('TaskCreate', { subject: id, description: id }, { task: { id, subject: id } })
const updated = (taskId: string, status: string): ToolUseSummary => use('TaskUpdate', { taskId, status })
const listed = (...rows: { id: string; status: string }[]): ToolUseSummary =>
  use('TaskList', {}, { tasks: rows.map(r => ({ ...r, subject: r.id, blockedBy: [] })) })

type Row = { id: string; status: string }
type World = {
  /** Every prompt that reached the engine: a poke through the mod's `send` command, or a submitted prompt. */
  submitted: string[]
  /** The pokes that went through the `send` command; `sendFails` makes the engine refuse that command. */
  sends: number
  sendFails?: true
  /** The mod sends its poke from a timer, so a test settles this clock before it reads what was sent. */
  clock: MockClock
  logs: string[]
  envSets: string[]
  listCalls: number
  /** The engine's own task list, which the mod reads with $.tool.call at the session's start. */
  taskRows: Row[]
  /** When set, that call fails instead of answering. */
  listError?: Error
  setMessages: (m: SessionMessage[]) => void
}

function world(on: On, env: Record<string, string> = {}, store: Record<string, unknown> = {}): World {
  const w: World = { submitted: [], sends: 0, clock: mock.clock(on), logs: [], envSets: [], listCalls: 0, taskRows: [], setMessages: () => undefined }
  let messages: SessionMessage[] = []
  w.setMessages = m => {
    messages = m
  }
  mock.store(on, store)
  mock.env(on, env)
  on('env.set', (_, e) => {
    w.envSets.push(`${e.name}=${e.value}`)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: messages }))
  on('tool.call', (_, e) => {
    if (e.tool !== 'TaskList') throw new Error(`the world answers TaskList only, not ${e.tool}`)
    w.listCalls += 1
    if (w.listError) throw w.listError
    return { result: { tasks: w.taskRows.map(r => ({ ...r, subject: r.id, blockedBy: [] })) }, text: '' }
  })
  on('ui.log', (_, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('command.run', { command: 'task-poke:send' }, (_, e) => {
    if (w.sendFails === true) throw new Error('unknown command')
    w.submitted.push(e.args)
    w.sends += 1
    return {}
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return w
}

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Section = { key: string; title: string; lines: { text: string; kind?: string }[]; until: string }
type Bar = { open: boolean; sections: Section[]; cleared: string[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; title: string; lines: { text: string; kind?: string }[]; until: string }
    if (bar.open) bar.sections.push({ key: s.key, title: s.title, lines: s.lines.map(l => ({ text: l.text, kind: l.kind })), until: s.until })
    return { value: bar.open }
  })
  on('sidebar.clear', (_, e) => {
    bar.cleared.push((e as unknown as { key: string }).key)
    return { value: undefined }
  })
  on('sidebar.isOpen', () => ({ value: bar.open }))
}

describe('task-poke', () => {
  test('pokes while a TodoWrite list has unfinished tasks', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('completed', 'in_progress', 'pending')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(1)
    expect(w.sends).toBe(1)
    expect(w.submitted[0]).toContain('Continue with the next pending or in-progress task.')
    expect(w.logs.at(-1)).toContain('2 unfinished tasks, poke 1/99')
  })

  test('a send command the engine refuses sends the poke as a plugin prompt and says so', async ($, on) => {
    const w = world(on)
    w.sendFails = true
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.sends).toBe(0)
    expect(w.submitted).toHaveLength(1)
    expect(w.logs.at(-1)).toContain('the send command did not run, the poke goes out as a plugin prompt')
  })

  test('stays idle when every TodoWrite task is completed', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending'), todoWrite('completed', 'completed')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(0)
  })

  test('tracks Task tools by the id in the TaskCreate result', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1'), created('2')), assistant(updated('1', 'completed'))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 1/99')

    w.setMessages([assistant(created('1'), created('2')), assistant(updated('1', 'completed'), updated('2', 'deleted'))])
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(1)
  })

  test('counts a task the transcript window no longer holds', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1'))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 1/99')

    // The window moved past the TaskCreate: only the list of the last reading holds that task.
    w.setMessages([])
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 2/99')
    expect(w.submitted).toHaveLength(2)
  })

  test("the session's start takes the engine's own list, which the transcript no longer holds", async ($, on) => {
    const w = world(on)
    // A resumed session: the engine still knows the tasks, and the transcript window reaches none of them.
    w.taskRows = [{ id: '1', status: 'in_progress' }, { id: '2', status: 'pending' }, { id: '3', status: 'completed' }]
    w.setMessages([])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.listCalls).toBe(1)
    expect(w.logs.at(-1)).toContain('2 unfinished tasks, poke 1/99')
    expect(w.submitted).toHaveLength(1)
  })

  test('a failed reading of the engine list says so and leaves the transcript to answer', async ($, on) => {
    const w = world(on)
    w.listError = new Error('the task tools are off')
    w.setMessages([assistant(created('1'))])
    await $.session.start(session)
    expect(w.logs[0]).toContain("cannot read the engine's task list")
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 1/99')
  })

  test('a TaskList result replaces the list the replay built', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1'), created('2'))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(1)

    w.setMessages([assistant(listed({ id: '1', status: 'completed' }, { id: '2', status: 'completed' }))])
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(1)
  })

  test('reads the raw id key that Claude Code repairs to taskId', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('7')), assistant(use('TaskUpdate', { id: '7', status: 'completed' }))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(0)
  })

  test('ignores a TaskUpdate that failed on an unknown taskId', async ($, on) => {
    const w = world(on)
    const failed = use(
      'TaskUpdate',
      { taskId: '99', status: 'in_progress' },
      { success: false, taskId: '99', updatedFields: [], error: 'Task not found' },
    )
    w.setMessages([assistant(created('1')), assistant(updated('1', 'completed'), failed)])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(0)
  })

  test('a later TodoWrite replaces the Task tools state', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1')), todoWrite('completed')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(0)
  })

  test('stops after the last poke and a user prompt resets the count', async ($, on) => {
    const w = world(on)
    w.setMessages(working(todoWrite('pending')))
    await $.session.start(session)
    for (let i = 0; i < DEFAULT_MAX_POKES + 2; i += 1) {
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    expect(w.submitted).toHaveLength(DEFAULT_MAX_POKES)
    expect(w.logs.filter(l => l.includes('stopped after 99 pokes'))).toHaveLength(1)

    await $.prompt.submit(typed())
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted.filter(t => t !== 'go on')).toHaveLength(DEFAULT_MAX_POKES + 1)
  })

  test('the limit the person sets holds, and an argument it cannot read changes nothing', async ($, on) => {
    const w = world(on)
    w.setMessages(working(todoWrite('pending')))
    await $.session.start(session)
    for (const bad of ['0', '1000', 'many', '']) expect(limitOf(bad), bad).toBe(undefined)
    expect(limitOf('2')).toBe(2)
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number from 1 to 999')
    expect((await $.command.run(run('limit 2'))).text).toBe('limit 2: at most 2 poke(s) go out for one stretch of unfinished tasks')
    for (let i = 0; i < 4; i += 1) {
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    expect(w.submitted).toHaveLength(2)
    expect(w.logs.filter(l => l.includes('stopped after 2 pokes'))).toHaveLength(1)
    expect((await $.command.run(run(''))).text).toContain('2/2 pokes')
  })

  test('does not poke after an interrupted turn, a subagent turn or a question to the user', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    await $.turn.complete(turn({ reason: 'aborted', isAborted: true }))
    await $.turn.complete(turn({ agentId: 'a1' }))
    w.setMessages([todoWrite('pending'), assistant(use('AskUserQuestion', { questions: [] }))])
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(0)
  })

  test('turns the task tools on when the user did not set the variable', async ($, on) => {
    const w = world(on)
    await $.session.start(session)
    expect(w.envSets).toEqual(['CLAUDE_CODE_ENABLE_TODO_TOOLS=1'])
  })

  test('keeps the value the user set for the task tools', async ($, on) => {
    const w = world(on, { CLAUDE_CODE_ENABLE_TODO_TOOLS: '0' })
    await $.session.start(session)
    expect(w.envSets).toEqual([])
  })

  test('does not turn the task tools on while task-poke is off', async ($, on) => {
    const w = world(on, {}, { enabled: false })
    await $.session.start(session)
    expect(w.envSets).toEqual([])
  })

  test('/task-poke off stops the pokes', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    const { text } = await $.command.run(run('off'))
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(text).toBe('off · 0/99 pokes since your last prompt')
    expect(w.submitted).toHaveLength(0)
  })

  withSidebar('an open sidebar takes the count and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.setMessages([todoWrite('completed', 'in_progress', 'pending')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(bar.sections).toEqual([{ key: 'pokes', title: 'task list', lines: [{ text: '2 unfinished tasks, poke 1/99', kind: 'ok' }], until: 'session' }])
    expect(w.logs).toEqual([])
  })

  withSidebar('the last poke is yellow, the limit red, and one entry says the pokes stopped', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.setMessages(working(todoWrite('pending')))
    await $.session.start(session)
    for (let i = 0; i < DEFAULT_MAX_POKES + 2; i += 1) {
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    // One entry per turn, plus the limit entry: green up to the last poke, then yellow, then red.
    const kinds = bar.sections.map(s => s.lines[0]?.kind)
    expect(kinds.slice(0, DEFAULT_MAX_POKES - 2)).toEqual(Array.from({ length: DEFAULT_MAX_POKES - 2 }, () => 'ok'))
    expect(kinds.slice(DEFAULT_MAX_POKES - 2)).toEqual(['warn', 'error', 'error', 'error', 'error'])
    const stopped = bar.sections.filter(s => s.key === 'limit')
    expect(stopped).toHaveLength(1)
    expect(stopped[0]?.until).toBe('stream')
    expect(stopped[0]?.lines[0]).toEqual({ text: 'stopped after 99 pokes with unfinished tasks. Send a prompt to reset the count.', kind: 'error' })
    expect(w.logs).toEqual([])
  })

  withSidebar('a finished list takes the count down', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    w.setMessages([todoWrite('completed')])
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(bar.cleared).toEqual(['pokes'])
  })

  test('stops after three pokes that moved nothing, and a prompt starts it again', async ($, on) => {
    const w = world(on)
    // The same list, and no tool after the prompt: every poke buys the same answer again.
    w.setMessages([todoWrite('pending'), prompted()])
    await $.session.start(session)
    for (let i = 0; i < 6; i += 1) {
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    expect(w.submitted).toHaveLength(MAX_STALLS)
    const stopped = w.logs.filter(l => l.includes('moved nothing'))
    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toContain('no task changed status and no tool ran')

    await $.prompt.submit(typed())
    w.setMessages(working(todoWrite('pending')))
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted.filter(t => t !== 'go on')).toHaveLength(MAX_STALLS + 1)
  })

  test('sends no poke and counts no stall while background work runs, and pokes once it ended', async ($, on) => {
    const w = world(on)
    on('classic.Stop', () => ({}))
    // The same list and no tool after the prompt: without the wait, the stall count would stop the pokes.
    w.setMessages([todoWrite('pending'), prompted()])
    await $.session.start(session)
    const running = [{ id: 'a1', type: 'subagent', status: 'running', description: 'Explore the runtime' }]
    for (let i = 0; i < MAX_STALLS + 2; i += 1) {
      await $.classic.Stop({ stop_hook_active: false, background_tasks: running })
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    expect(w.submitted).toEqual([])
    expect(w.logs.some(l => l.includes('moved nothing'))).toBe(false)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(1)
  })

  test('a turn whose tool results follow its tool calls counts as work', async ($, on) => {
    const w = world(on)
    // The shape $.session.messages() answers (measured): each tool result is a user row of its own,
    // and the turn ends with an assistant row of text alone.
    const result: SessionMessage = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'Read-1', text: 'x', isError: false, result: undefined }] }
    const answered: SessionMessage = { role: 'assistant', text: 'done', toolUses: [] }
    w.setMessages([todoWrite('pending'), prompted(), assistant(use('Read', { file_path: '/x' })), result, answered])
    await $.session.start(session)
    for (let i = 0; i < 6; i += 1) {
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    expect(w.logs.filter(l => l.includes('moved nothing'))).toHaveLength(0)
    expect(w.submitted).toHaveLength(6)
  })

  test('a task that changed status counts as progress, with no tool in the turn', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending', 'pending'), prompted()])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.settle()
    for (let i = 0; i < 4; i += 1) {
      // One task finishes at each turn's end, so no poke moved nothing.
      w.setMessages([todoWrite(i % 2 === 0 ? 'completed' : 'pending', 'pending'), prompted()])
      await $.turn.complete(turn())
      await w.clock.settle()
    }
    expect(w.logs.filter(l => l.includes('moved nothing'))).toHaveLength(0)
    expect(w.submitted).toHaveLength(5)
  })

  test('an unknown status fails loudly instead of counting as done', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('weird')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.turn.complete(turn())
    await w.clock.settle()
    expect(w.submitted).toHaveLength(0)
    const errors = w.logs.filter(l => l.includes('cannot read the task list'))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('unknown task status "weird"')
  })
})
