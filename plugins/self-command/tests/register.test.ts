import { describe, expect, mock, test, tier, type MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { requestOf } from '../hooks/commands.ts'

tier('user')

const KNOWN = ['reload-plugins', 'sage-memory', 'clear']

/** `ran` holds each command the engine ran with its arguments; `failing` names a command the engine refuses. */
type World = { clock: MockClock; ran: string[]; tools: string[]; submitted: string[]; failing?: string; sendFails?: true }

function world(on: On): World {
  const w: World = { clock: mock.clock(on), ran: [], tools: [], submitted: [] }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => {
    w.tools.push(e.name)
    return { value: { tool: `mcp__self-command__${e.name}` } }
  })
  on('command.list', () => ({ value: KNOWN.map(name => ({ name, description: name, source: 'builtin' as const })) }))
  on('command.run', (_, e) => {
    if (e.command === 'self-command:send' && w.sendFails === true) throw new Error('unknown command')
    if (e.command === w.failing) throw new Error('the command failed')
    w.ran.push(`${e.command} ${e.args}`.trim())
    return e.command === 'reload-plugins' ? { text: 'Reloaded: 12 plugins' } : {}
  })
  on('prompt.submit', (_, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.log', () => ({ value: undefined }))
  return w
}

const start = { surface: null, isInteractive: true, cwd: '/repo' } as const

describe('requests', () => {
  test('a name loses its slash, and one written with its arguments is split when args is left out', () => {
    expect(requestOf({ command: '/reload-plugins' }, KNOWN)).toEqual({ command: 'reload-plugins', args: '' })
    expect(requestOf({ command: 'sage-memory triage apply' }, KNOWN)).toEqual({ command: 'sage-memory', args: 'triage apply' })
    expect(requestOf({ command: 'sage-memory', args: ' triage ' }, KNOWN)).toEqual({ command: 'sage-memory', args: 'triage' })
  })

  test('a command that clears, ends or swaps the session, an unknown one and none at all are refused', () => {
    expect(requestOf({ command: 'clear' }, KNOWN)).toBe('/clear clears, ends or swaps the session, so it is not run for the model')
    expect(requestOf({ command: 'reset' }, KNOWN)).toBe('/reset is not a command of this session')
    expect(requestOf({}, KNOWN)).toBe('command is required: the command name without its slash')
  })
})

describe('self-command', () => {
  test('the command runs once the turn lets it, and its output reaches the model as the next prompt', async ($, on) => {
    const w = world(on)
    await $.session.start(start)
    expect(w.tools).toEqual(['run'])
    const r = await $.tool.call({ tool: 'mcp__self-command__run', command: 'reload-plugins' })
    expect(r.result).toBe('queued: /reload-plugins runs once this turn ends, and its output comes back as the next prompt. It has not run yet, so do not report its outcome before that output arrives.')
    expect(w.ran).toEqual([])
    await w.clock.settle()
    expect(w.ran).toEqual(['reload-plugins', 'self-command:send The command /reload-plugins, which you ran with the self-command tool, ran. Its output:\nReloaded: 12 plugins'])
  })

  test('a refused name runs nothing, and a command that fails is reported as not run', async ($, on) => {
    const w = world(on)
    await $.session.start(start)
    const refused = await $.tool.call({ tool: 'mcp__self-command__run', command: 'clear' })
    expect(refused.result).toBeUndefined()
    await w.clock.settle()
    expect(w.ran).toEqual([])
    w.failing = 'sage-memory'
    await $.tool.call({ tool: 'mcp__self-command__run', command: 'sage-memory', args: 'triage' })
    await w.clock.settle()
    // The test engine reports a world hook that throws as a command no hook implements.
    expect(w.ran).toEqual(['self-command:send The command /sage-memory triage, which you ran with the self-command tool, did not run: no implementation for command.run'])
  })

  test('a send command the engine refuses goes out as a plugin prompt', async ($, on) => {
    const w = world(on)
    w.sendFails = true
    await $.session.start(start)
    await $.tool.call({ tool: 'mcp__self-command__run', command: 'sage-memory', args: 'stats' })
    await w.clock.settle()
    expect(w.ran).toEqual(['sage-memory stats'])
    expect(w.submitted).toEqual(['The command /sage-memory stats, which you ran with the self-command tool, ran. Its output:\n(no text)'])
  })
})
