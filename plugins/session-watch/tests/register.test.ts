import { describe, expect, mock, test, tier, type Engine, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, TurnCompleteInput, TurnUsage } from 'claude-code'

tier('user')

const T0 = Date.parse('2026-09-25T12:00:00Z')
const SID = 'sess-1'
const CLEAN = '# branch.oid fe4b552c3f34ec65700b7e65fa605c89f136e825\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n'
const DIRTY = '# branch.oid fe4b552c3f34ec65700b7e65fa605c89f136e825\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 a a a\n'

const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

const run: CommandRunInput = { command: 'session-watch', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500, model: 'claude-opus-5-5', ...over })

let turns = 0
const turn = (agentId?: string): TurnCompleteInput => ({ answer: 'done', durationMs: 10, isAborted: false, turnId: `t${++turns}`, reason: 'answer', usage: usage(), agentId })

/** The world: what git prints, what the usage says, the store, and what the person saw. */
type World = { git: { exitCode: number; stdout: string; stderr: string }; gitRuns: number; percent?: number; usageDown: boolean; store: Record<string, unknown>; statuses: (string | undefined)[]; logs: string[]; bar: { open: boolean; lines: { text: string; kind?: string }[][] }; clock: MockClock }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { git: { exitCode: 0, stdout: CLEAN, stderr: '' }, gitRuns: 0, percent: 12, usageDown: false, store: { ...store }, statuses: [], logs: [], bar: { open: false, lines: [] }, clock: mock.clock(on, { now: T0 }) }
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('session.id', () => ({ value: SID }))
  on('session.version', () => ({ value: { version: '2.1.282', base: '2.1.282' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => {
    if (w.usageDown) throw new Error('usage down')
    return { value: { startedAt: 0, context: { window: 1_000_000, tokens: w.percent === undefined ? undefined : w.percent * 10_000, percent: w.percent }, rateLimits: [], cost: { usd: 0.5 } } }
  })
  on('process.run', (_, e) => {
    if (e.argv.join(' ') !== 'git status --porcelain=v2 --branch') throw new Error(`unexpected ${e.argv.join(' ')}`)
    w.gitRuns += 1
    return { value: w.git }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  return w
}

/** Answers `$.sidebar.set`; only a test that loads the sidebar plugin may seat it. */
function seatSidebar(on: On, w: World): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string; kind?: string }[] }
    if (w.bar.open) w.bar.lines.push(s.lines)
    return { value: w.bar.open }
  })
}

const started = ($: Engine, isInteractive = false) => $.session.start({ surface: null, isInteractive, cwd: '/work' })

async function step($: Engine, effort?: 'low' | 'high', agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: `s${++turns}`, index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(effort === undefined ? {} : { effort }), ...(agentId === undefined ? {} : { agentId }) })
  for await (const chunk of stream) void chunk
}

describe('session-watch', () => {
  test('the status line carries the reading while no sidebar takes it', async ($, on) => {
    const w = world(on)
    await started($)
    expect(w.statuses.at(-1)).toBe('ctx 12% · $0.50 · main')
    w.git = { exitCode: 0, stdout: DIRTY, stderr: '' }
    w.percent = 60
    await $.turn.complete(turn())
    expect(w.statuses.at(-1)).toBe('ctx 60% · $0.50 · main*')
  })

  withSidebar('an open sidebar takes the section, and the status line is cleared', async ($, on) => {
    const w = world(on)
    seatSidebar(on, w)
    w.bar.open = true
    await started($)
    await step($, 'high')
    await $.turn.complete(turn())
    expect(w.bar.lines.at(-1)).toEqual([
      { text: 'context 12% · 120k / 1.0M', kind: 'ok' },
      { text: 'tokens T 10k · I 1k · O 500 · CR 8k · CW 500' },
      { text: 'cost $0.50' },
      { text: 'model opus-5-5 · thinking high' },
      { text: 'Claude Code 2.1.282' },
      { text: 'main · clean · ↑0 ↓0', kind: 'ok' },
    ])
    expect(w.statuses.at(-1)).toBe(undefined)
  })

  test('every loop\'s turns add to the totals, which the store keeps for a reloaded module', async ($, on) => {
    const w = world(on, { tokens: { [SID]: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 } } })
    await started($)
    await $.turn.complete(turn('agent-1'))
    await $.turn.complete(turn())
    expect(w.store.tokens).toEqual({ [SID]: { input: 2005, output: 1005, cacheRead: 16005, cacheWrite: 1005 } })
    expect((await $.command.run(run)).text?.split('\n')[1]).toBe('tokens T 20k · I 2k · O 1k · CR 16k · CW 1k')
  })

  test('the thinking setting is the main loop\'s last request, not a subagent\'s', async ($, on) => {
    world(on)
    await started($)
    expect((await $.command.run(run)).text?.split('\n')[3]).toBe('model opus-5-5 · thinking: not read yet')
    await step($, 'high')
    await step($, 'low', 'agent-1')
    expect((await $.command.run(run)).text?.split('\n')[3]).toBe('model opus-5-5 · thinking high')
    await step($)
    expect((await $.command.run(run)).text?.split('\n')[3]).toBe('model opus-5-5 · no thinking setting')
  })

  test('a git command, a subagent\'s turn end and the timer: git is read again only where it may have moved', async ($, on) => {
    const w = world(on)
    await started($, true)
    const afterStart = w.gitRuns
    await $.turn.complete(turn('agent-1'))
    expect(w.gitRuns).toBe(afterStart)
    await $.tool.call({ tool: 'Bash', command: 'ls -la' } as never)
    expect(w.gitRuns).toBe(afterStart)
    await $.tool.call({ tool: 'Bash', command: 'git checkout -b x' } as never)
    expect(w.gitRuns).toBe(afterStart + 1)
    await w.clock.advance(30_000)
    expect(w.gitRuns).toBe(afterStart + 2)
  })

  test('a directory outside git and a failed read are said once, not thrown', async ($, on) => {
    const w = world(on)
    w.git = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' }
    await started($)
    expect((await $.command.run(run)).text?.split('\n').at(-1)).toBe('git: not a repository')
    w.usageDown = true
    await $.turn.complete(turn())
    await $.turn.complete(turn())
    // The test engine reports a world hook that throws as a missing implementation.
    expect(w.logs).toEqual(['cannot read the session: no implementation for session.usage'])
  })
})
