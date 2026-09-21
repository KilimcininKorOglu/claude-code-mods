import { describe, expect, mock, test, tier, type Plugin, type TestBody } from 'claude-code/testing'
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

import { DEFAULT_MAX_POKES, limitOf } from '../hooks/register.ts'

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

const todoWrite = (...statuses: string[]): SessionMessage =>
  assistant(use('TodoWrite', { todos: statuses.map((status, i) => ({ content: `t${i}`, status, activeForm: `t${i}` })) }))
const created = (id: string): ToolUseSummary => use('TaskCreate', { subject: id, description: id }, { task: { id, subject: id } })
const updated = (taskId: string, status: string): ToolUseSummary => use('TaskUpdate', { taskId, status })
const listed = (...rows: { id: string; status: string }[]): ToolUseSummary =>
  use('TaskList', {}, { tasks: rows.map(r => ({ ...r, subject: r.id, blockedBy: [] })) })

type World = { submitted: string[]; logs: string[]; envSets: string[]; setMessages: (m: SessionMessage[]) => void }

function world(on: On, env: Record<string, string> = {}, store: Record<string, unknown> = {}): World {
  const w: World = { submitted: [], logs: [], envSets: [], setMessages: () => undefined }
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
  on('ui.log', (_, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('task-poke', () => {
  test('pokes while a TodoWrite list has unfinished tasks', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('completed', 'in_progress', 'pending')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(1)
    expect(w.logs.at(-1)).toContain('2 unfinished tasks, poke 1/99')
  })

  test('stays idle when every TodoWrite task is completed', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending'), todoWrite('completed', 'completed')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(0)
  })

  test('tracks Task tools by the id in the TaskCreate result', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1'), created('2')), assistant(updated('1', 'completed'))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 1/99')

    w.setMessages([assistant(created('1'), created('2')), assistant(updated('1', 'completed'), updated('2', 'deleted'))])
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(1)
  })

  test('counts a task the transcript window no longer holds', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1'))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 1/99')

    // The window moved past the TaskCreate: only the list of the last reading holds that task.
    w.setMessages([])
    await $.turn.complete(turn())
    await flush()
    expect(w.logs.at(-1)).toContain('1 unfinished task, poke 2/99')
    expect(w.submitted).toHaveLength(2)
  })

  test('a TaskList result replaces the list the replay built', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1'), created('2'))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(1)

    w.setMessages([assistant(listed({ id: '1', status: 'completed' }, { id: '2', status: 'completed' }))])
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(1)
  })

  test('reads the raw id key that Claude Code repairs to taskId', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('7')), assistant(use('TaskUpdate', { id: '7', status: 'completed' }))])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
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
    await flush()
    expect(w.submitted).toHaveLength(0)
  })

  test('a later TodoWrite replaces the Task tools state', async ($, on) => {
    const w = world(on)
    w.setMessages([assistant(created('1')), todoWrite('completed')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(0)
  })

  test('stops after the last poke and a user prompt resets the count', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    for (let i = 0; i < DEFAULT_MAX_POKES + 2; i += 1) {
      await $.turn.complete(turn())
      await flush()
    }
    expect(w.submitted).toHaveLength(DEFAULT_MAX_POKES)
    expect(w.logs.filter(l => l.includes('stopped after 99 pokes'))).toHaveLength(1)

    await $.prompt.submit(typed())
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted.filter(t => t !== 'go on')).toHaveLength(DEFAULT_MAX_POKES + 1)
  })

  test('the limit the person sets holds, and an argument it cannot read changes nothing', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    for (const bad of ['0', '1000', 'many', '']) expect(limitOf(bad), bad).toBe(undefined)
    expect(limitOf('2')).toBe(2)
    expect((await $.command.run(run('limit x'))).text).toBe('limit expects a whole number from 1 to 999')
    expect((await $.command.run(run('limit 2'))).text).toBe('limit 2: at most 2 poke(s) go out for one stretch of unfinished tasks')
    for (let i = 0; i < 4; i += 1) {
      await $.turn.complete(turn())
      await flush()
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
    await flush()
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
    await flush()
    expect(text).toContain('task-poke is off')
    expect(w.submitted).toHaveLength(0)
  })

  withSidebar('an open sidebar takes the count and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.setMessages([todoWrite('completed', 'in_progress', 'pending')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await flush()
    expect(bar.sections).toEqual([{ key: 'pokes', title: 'task list', lines: [{ text: '2 unfinished tasks, poke 1/99', kind: 'ok' }], until: 'session' }])
    expect(w.logs).toEqual([])
  })

  withSidebar('the last poke is yellow, the limit red, and one entry says the pokes stopped', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [], cleared: [] }
    seatSidebar(on, bar)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    for (let i = 0; i < DEFAULT_MAX_POKES + 2; i += 1) {
      await $.turn.complete(turn())
      await flush()
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
    await flush()
    w.setMessages([todoWrite('completed')])
    await $.turn.complete(turn())
    await flush()
    expect(bar.cleared).toEqual(['pokes'])
  })

  test('an unknown status fails loudly instead of counting as done', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('weird')])
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted).toHaveLength(0)
    const errors = w.logs.filter(l => l.includes('cannot read the task list'))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('unknown task status "weird"')
  })
})
