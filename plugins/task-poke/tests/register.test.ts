import { describe, expect, mock, test, tier } from 'claude-code/testing'
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
    expect(w.logs.at(-1)).toContain('2 unfinished tasks, poke 1/5')
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
    expect(w.logs.at(-1)).toContain('1 unfinished tasks')

    w.setMessages([assistant(created('1'), created('2')), assistant(updated('1', 'completed'), updated('2', 'deleted'))])
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

  test('stops after five pokes and a user prompt resets the count', async ($, on) => {
    const w = world(on)
    w.setMessages([todoWrite('pending')])
    await $.session.start(session)
    for (let i = 0; i < 7; i += 1) {
      await $.turn.complete(turn())
      await flush()
    }
    expect(w.submitted).toHaveLength(5)
    expect(w.logs.filter(l => l.includes('stopped after 5 pokes'))).toHaveLength(1)

    await $.prompt.submit(typed())
    await $.turn.complete(turn())
    await flush()
    expect(w.submitted.filter(t => t !== 'go on')).toHaveLength(6)
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
