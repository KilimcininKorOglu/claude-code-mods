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

/** Where the session's transcripts lie for HOME `/Users/u` and the start directory `/work`. */
const DIR = '/Users/u/.claude/projects/-work'
const MAIN = `${DIR}/${SID}.jsonl`
const SUB = `${DIR}/${SID}/subagents/agent-a1.jsonl`

type Line = { text: string; kind?: string; parts?: { text: string; kind?: string }[] }

/** The world: what git prints, what the usage says, the files, the store, and what the person saw. */
type World = { git: { exitCode: number; stdout: string; stderr: string }; gitRuns: number; percent?: number; usageDown: boolean; files: Map<string, string>; store: Record<string, unknown>; statuses: (string | undefined)[]; logs: string[]; bar: { open: boolean; lines: Line[][] }; clock: MockClock }

/** One transcript row of a model response, as the engine writes one per content block. */
const response = (id: string | undefined, input: number, output: number): string =>
  JSON.stringify({ type: 'assistant', message: { ...(id === undefined ? {} : { id }), role: 'assistant', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } } })

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { git: { exitCode: 0, stdout: CLEAN, stderr: '' }, gitRuns: 0, percent: 12, usageDown: false, files: new Map(), store: { ...store }, statuses: [], logs: [], bar: { open: false, lines: [] }, clock: mock.clock(on, { now: T0 }) }
  mock.env(on, { HOME: '/Users/u' })
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('store.delete', (_, e) => { delete w.store[e.key]; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) || [...w.files.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.list', (_, e) => ({ value: [...w.files.keys()].filter(k => k.startsWith(`${e.path}/`)).map(k => ({ name: k.slice(e.path.length + 1), kind: 'file' as const, size: 0, isLink: false })) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: w.files.get(e.path)?.length ?? 0, mtimeMs: 1, isLink: false } }))
  // `head -c <n> <path>`: the file's first n characters, the transcript as it was when the reading began.
  on('process.spawn', async function* (_, e) {
    const text = w.files.get(e.argv[3] ?? '')
    if (e.argv[0] !== 'head' || text === undefined) {
      yield { stream: 'stderr' as const, text: `head: ${e.argv[3] ?? ''}: No such file or directory\n` }
      return { value: { code: 1, signal: null } }
    }
    yield { stream: 'stdout' as const, text: text.slice(0, Number(e.argv[2])) }
    return { value: { code: 0, signal: null } }
  })
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
    const s = e as unknown as { lines: Line[] }
    if (w.bar.open) w.bar.lines.push(s.lines)
    return { value: w.bar.open }
  })
}

/** Starts the session and lets the transcript reading, which runs from a timer, finish. */
async function started($: Engine, w: World, isInteractive = false): Promise<void> {
  await $.session.start({ surface: null, isInteractive, cwd: '/work' })
  await w.clock.advance(0)
}

async function step($: Engine, effort?: 'low' | 'high', agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: `s${++turns}`, index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(effort === undefined ? {} : { effort }), ...(agentId === undefined ? {} : { agentId }) })
  for await (const chunk of stream) void chunk
}

describe('session-watch', () => {
  test('the status line carries the reading while no sidebar takes it', async ($, on) => {
    const w = world(on)
    await started($, w)
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
    await started($, w)
    await step($, 'high')
    await $.turn.complete(turn())
    expect(w.bar.lines.at(-1)).toEqual([
      { text: 'context 12% · 120k / 1.0M', kind: 'ok' },
      { text: 'tokens T 10k · I 1k · O 500 · CR 8k · CW 500' },
      { text: 'cost $0.50' },
      {
        text: 'model opus-5-5 · thinking high',
        parts: [{ text: 'model ' }, { text: 'opus-5-5', kind: 'error' }, { text: ' · ' }, { text: 'thinking ' }, { text: 'high', kind: 'warn' }],
      },
      { text: 'Claude Code 2.1.282' },
      { text: 'main · clean · ↑0 ↓0', kind: 'ok' },
    ])
    expect(w.statuses.at(-1)).toBe(undefined)
  })

  test('every loop\'s turns add to the totals, which the store keeps for a reloaded module', async ($, on) => {
    const w = world(on, { totals: { [SID]: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 } } })
    await started($, w)
    await $.turn.complete(turn('agent-1'))
    await $.turn.complete(turn())
    expect(w.store.totals).toEqual({ [SID]: { input: 2005, output: 1005, cacheRead: 16005, cacheWrite: 1005 } })
    expect((await $.command.run(run)).text?.split('\n')[1]).toBe('tokens T 20k · I 2k · O 1k · CR 16k · CW 1k')
  })

  test('a session with no kept totals reads them from its transcripts, each response once, and counts later turns on top', async ($, on) => {
    // 0.1.0 counted from the module's load under `tokens`; that value is dropped and read again.
    const w = world(on, { tokens: { [SID]: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } } })
    // One response written as two content-block rows, a second response, a row of another kind, and a subagent's response.
    w.files.set(MAIN, [response('msg_1', 3, 40), response('msg_1', 3, 40), response('msg_2', 2, 60), JSON.stringify({ type: 'user', message: { content: 'hi' } })].join('\n') + '\n')
    w.files.set(SUB, `${response(undefined, 7, 7)}\n`)
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    expect((await $.command.run(run)).text?.split('\n')[1]).toBe('tokens: reading the transcripts')
    // A turn that ends while the transcripts are read counts on top of them, and so does what it wrote after the reading began.
    w.files.set(MAIN, `${w.files.get(MAIN) ?? ''}${response('msg_3', 1000, 1000)}\n`)
    await $.turn.complete(turn())
    expect(w.store.totals).toBeUndefined()
    await w.clock.advance(0)
    expect(w.store.tokens).toBeUndefined()
    expect(w.store.totals).toEqual({ [SID]: { input: 1012, output: 607, cacheRead: 8300, cacheWrite: 530 } })
    expect(w.logs).toEqual([])
  })

  test('a transcript that cannot be read leaves the totals counted from the load, and says why once', async ($, on) => {
    const w = world(on)
    w.files.set(MAIN, `${response('msg_1', 3, 40)}\n`)
    await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
    w.files.delete(MAIN)
    await w.clock.advance(0)
    expect(w.logs).toEqual([`the token totals count from the module's load, because the transcripts were not read: ${MAIN}: head: ${MAIN}: No such file or directory`])
    expect(w.store.totals).toEqual({ [SID]: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
  })

  test('the thinking setting is the main loop\'s last request, not a subagent\'s', async ($, on) => {
    const w = world(on)
    await started($, w)
    expect((await $.command.run(run)).text?.split('\n')[3]).toBe('model opus-5-5 · thinking: not read yet')
    await step($, 'high')
    await step($, 'low', 'agent-1')
    expect((await $.command.run(run)).text?.split('\n')[3]).toBe('model opus-5-5 · thinking high')
    await step($)
    expect((await $.command.run(run)).text?.split('\n')[3]).toBe('model opus-5-5 · no thinking setting')
  })

  test('a git command, a subagent\'s turn end and the timer: git is read again only where it may have moved', async ($, on) => {
    const w = world(on)
    await started($, w, true)
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
    await started($, w)
    expect((await $.command.run(run)).text?.split('\n').at(-1)).toBe('git: not a repository')
    w.usageDown = true
    await $.turn.complete(turn())
    await $.turn.complete(turn())
    // The test engine reports a world hook that throws as a missing implementation.
    expect(w.logs).toEqual(['cannot read the session: no implementation for session.usage'])
  })
})
