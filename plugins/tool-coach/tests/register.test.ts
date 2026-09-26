import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { callKey, errorOf } from '../hooks/coach.ts'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'tool-coach', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** `failing` names the tools whose next call fails beneath the plugin; `runs` counts the calls that reached them. */
type World = { failing: Set<string>; runs: number; logs: string[] }

const MISSING = '<tool_use_error>File does not exist. Note: your current working directory is /w.</tool_use_error>'

function world(on: On): World {
  const w: World = { failing: new Set(), runs: 0, logs: [] }
  mock.store(on, {})
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', (_, e) => {
    w.runs += 1
    return (w.failing.has(e.tool) ? { result: 'Error', text: MISSING, isError: true } : { result: 'ok' }) as never
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/w' })
}

const read = ($: Engine, extra: Record<string, unknown> = {}) => $.tool.call({ tool: 'Read', file_path: '/w/missing.txt', ...extra } as never)
const bash = ($: Engine, command = 'ls /nope') => $.tool.call({ tool: 'Bash', command, description: 'list' } as never)

const DENY = 'this exact Read call failed a moment ago, and no file or command has changed anything since, so it would fail the same way. Its error was:\nFile does not exist. Note: your current working directory is /w.\nRead the error, change the input, and call again.'

describe('coach', () => {
  test('one call is one key whatever its key order or label, and each loop keeps its own', () => {
    expect(callKey({ tool: 'Read', tool_use_id: 'a', file_path: '/x', limit: 5 })).toBe(callKey({ limit: 5, tool: 'Read', tool_use_id: 'b', file_path: '/x' }))
    expect(callKey({ tool: 'Agent', prompt: 'p', description: 'one' })).toBe(callKey({ tool: 'Agent', prompt: 'p', description: 'two' }))
    expect(callKey({ tool: 'Read', file_path: '/x' })).not.toBe(callKey({ tool: 'Read', file_path: '/x', agentId: 'a1' }))
    expect(callKey({ tool: 'Read', file_path: '/x' })).not.toBe(callKey({ tool: 'Read', file_path: '/y' }))
  })

  test('the error loses the engine tags and is cut to a length a deny can carry', () => {
    expect(errorOf(MISSING)).toBe('File does not exist. Note: your current working directory is /w.')
    expect(errorOf(undefined)).toBe('no error text')
    expect(errorOf('x'.repeat(400))).toHaveLength(301)
  })
})

describe('tool-coach', () => {
  test('a failed call repeated unchanged is refused with its error and never runs; a changed input runs', async ($, on) => {
    const w = world(on)
    await started($)
    w.failing.add('Read')
    expect((await read($)).isError).toBe(true)
    expect(await read($)).toEqual({ deny: DENY })
    expect(w.runs).toBe(1)
    expect(w.logs).toEqual(['Read call repeated after it failed, not run'])
    await read($, { limit: 10 })
    expect(w.runs).toBe(2)
  })

  test('a successful edit or command drops the records, so the call runs again', async ($, on) => {
    const w = world(on)
    await started($)
    w.failing.add('Read')
    await read($)
    await $.tool.call({ tool: 'Write', file_path: '/w/missing.txt', content: 'x' } as never)
    await read($)
    expect(w.runs).toBe(3)
    expect((await read($)).deny).toBe(DENY)
    await bash($, 'touch /w/missing.txt')
    await read($)
    expect(w.runs).toBe(5)
  })

  test('a call that succeeded runs again, a failed Bash command runs again, and a failed one drops no record', async ($, on) => {
    const w = world(on)
    await started($)
    await read($, { file_path: '/w/ok.txt' })
    await read($, { file_path: '/w/ok.txt' })
    expect(w.runs).toBe(2)
    w.failing.add('Bash')
    await bash($)
    await bash($)
    expect(w.runs).toBe(4)
    w.failing.add('Read')
    await read($)
    await bash($)
    expect((await read($)).deny).toBe(DENY)
  })

  test('a subagent keeps its own records, and a new turn starts clean', async ($, on) => {
    const w = world(on)
    await started($)
    w.failing.add('Read')
    await read($)
    await read($, { agentId: 'a1' })
    expect(w.runs).toBe(2)
    await $.turn.start({ text: 'again', turnId: 't2' } as never)
    await read($)
    expect(w.runs).toBe(3)
  })

  test('off runs every call, and the command answers its state', async ($, on) => {
    const w = world(on)
    await started($)
    w.failing.add('Read')
    await read($)
    expect((await $.command.run(run('off'))).text).toBe('off: every call runs')
    await read($)
    expect(w.runs).toBe(2)
    expect((await $.command.run(run(''))).text).toBe('off')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
    expect((await $.command.run(run('on'))).text).toBe('on: a failed call is not run again unchanged')
  })
})

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

withSidebar('an open sidebar takes the line with the tool in red, and the transcript stays clean', async ($, on) => {
  const w = world(on)
  const sections: unknown[] = []
  on('sidebar.set', (_, e) => { sections.push(e); return { value: true } })
  await started($)
  w.failing.add('Read')
  await read($)
  await read($)
  expect(sections).toEqual([{
    consumer: 'tool-coach', key: 'Read', title: 'repeat stopped', until: 'stream',
    lines: [{ text: 'Read call repeated after it failed, not run', parts: [{ text: 'Read', kind: 'error' }, { text: ' call repeated after it failed, not run', kind: 'dim' }] }],
  }])
  expect(w.logs).toEqual([])
})
