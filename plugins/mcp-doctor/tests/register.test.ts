import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, TurnCompleteInput } from 'claude-code'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Section = { key: string; lines: { text: string; kind?: string }[]; buttons?: { label: string; command: string; args?: string }[]; until: string }

/**
 * What ToolSearch answers (`failed`, `pending`, or `missing` for a build where it does not answer), what
 * `/mcp reconnect` does to it, and what the person read.
 */
type World = {
  failed: { name: string; errorCode?: string; error?: string }[]
  pending: string[]
  missing: boolean
  /** The engine's answer to `/mcp reconnect` when it refuses, as a headless session does. */
  refuse?: string
  reconnects: string[]
  logs: string[]
  bar: { open: boolean; sections: Section[]; cleared: string[] }
}

function world(on: On): { w: World; clock: ReturnType<typeof mock.clock> } {
  const w: World = { failed: [], pending: [], missing: false, reconnects: [], logs: [], bar: { open: false, sections: [], cleared: [] } }
  mock.store(on, {})
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  // As measured on 2.1.280: the server lists ride only on an answer with no match.
  on('tool.call', (_, e) => {
    if (w.missing) return { deny: 'ToolSearch is not enabled' }
    const query = String((e as unknown as { query?: unknown }).query)
    if (!query.startsWith('select:')) return { result: { matches: ['mcp__coolify__diagnose_server'], query, total_deferred_tools: 175 }, text: '' }
    return { result: { matches: [], query, total_deferred_tools: 175, failed_mcp_servers: w.failed, pending_mcp_servers: w.pending }, text: '' }
  })
  // `/mcp reconnect <name>` brings the server back, as it did in a live interactive session.
  on('command.run', (_, e) => {
    const name = String(e.args ?? '').replace(/^reconnect /, '')
    w.reconnects.push(name)
    if (w.refuse !== undefined) return { text: w.refuse }
    w.failed = w.failed.filter(f => f.name !== name)
    return { text: `Successfully reconnected to ${name}` }
  })
  return { w, clock }
}

function seatSidebar(on: On, w: World): void {
  on('sidebar.set', (_, e) => {
    if (w.bar.open) w.bar.sections.push(e as unknown as Section)
    return { value: w.bar.open }
  })
  on('sidebar.clear', (_, e) => { w.bar.cleared.push((e as unknown as { key: string }).key); return { value: undefined } })
}

const run = (args: string): CommandRunInput => ({ command: 'mcp-doctor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

let turns = 0
const turn = (): TurnCompleteInput => ({ answer: 'done', durationMs: 1, isAborted: false, turnId: `t${++turns}`, reason: 'answer' })

const started = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

/** Lets the timers run and the measures they start finish. */
async function settle(clock: ReturnType<typeof mock.clock>): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await clock.advance(200)
    for (let j = 0; j < 50; j += 1) await Promise.resolve()
  }
}

const FAILED_DELTA = 'The following MCP servers are configured but failed to connect — their tools (typically named mcp__<server>__*) are unavailable for this session:\nplugin:playwright:playwright: "Connection closed"\n\nTreat this as a connection failure.'

describe('mcp-doctor', () => {
  withSidebar('a server that failed gets a standing section with a reconnect button, and a green line once it is back', async ($, on) => {
    const { w, clock } = world(on)
    seatSidebar(on, w)
    w.bar.open = true
    w.failed = [{ name: 'flaky', errorCode: 'CONNECTION_CLOSED', error: 'Connection closed' }, { name: 'claude.ai Gmail' }]
    await started($)
    await settle(clock)
    expect(w.bar.sections).toEqual([{ consumer: 'mcp-doctor', key: 'failed-flaky', title: 'MCP server', lines: [{ text: 'flaky: not connected (CONNECTION_CLOSED: Connection closed)', kind: 'error' }], buttons: [{ label: 'reconnect flaky', command: 'mcp-doctor', args: 'reconnect flaky' }], until: 'session', order: 15 } as unknown as Section])
    // The same failure at the next turn's end is not written again.
    await $.turn.complete(turn())
    await settle(clock)
    expect(w.bar.sections).toHaveLength(1)
    // The button's command reconnects it from a timer, and the measure after it closes the finding.
    expect((await $.command.run(run('reconnect flaky'))).text).toBe('reconnecting flaky')
    await settle(clock)
    expect(w.reconnects).toEqual(['flaky'])
    expect(w.bar.cleared).toEqual(['failed-flaky'])
    expect(w.bar.sections.at(-1)?.lines).toEqual([{ text: 'flaky: connected again', kind: 'ok' }])
    expect(w.logs).toEqual([])
  })

  test('a closed sidebar gets one transcript line naming the reconnect command, and a pending server is not taken as back', async ($, on) => {
    const { w, clock } = world(on)
    w.failed = [{ name: 'flaky' }]
    await started($)
    await settle(clock)
    expect(w.logs).toEqual(['flaky: not connected (disconnected); /mcp-doctor reconnect flaky'])
    w.failed = []
    w.pending = ['flaky']
    await $.turn.complete(turn())
    await settle(clock)
    expect(w.logs).toHaveLength(1)
    w.pending = []
    await $.turn.complete(turn())
    await settle(clock)
    expect(w.logs.at(-1)).toBe('flaky: connected again')
    expect((await $.command.run(run(''))).text).toBe('on · every watched MCP server is connected')
  })

  test('without ToolSearch the engine\'s notes alone are read', async ($, on) => {
    const { w, clock } = world(on)
    w.missing = true
    await started($)
    await settle(clock)
    expect(w.logs).toEqual(['ToolSearch does not answer here, so only the engine\'s notes are read: ToolSearch is not enabled'])
    await $.prompt.attachment({ type: 'deferred_tools_delta', text: FAILED_DELTA, origin: { kind: 'engine' } })
    expect(w.logs.at(-1)).toBe('plugin:playwright:playwright: not connected (Connection closed); /mcp-doctor reconnect plugin:playwright:playwright')
    await $.prompt.attachment({ type: 'deferred_tools_delta', text: '25 deferred tools are available again (MCP server reconnected — names announced earlier in this conversation): mcp__plugin_playwright_playwright__* (25). Load via ToolSearch as before.', origin: { kind: 'engine' } })
    expect(w.logs.at(-1)).toBe('plugin:playwright:playwright: connected again')
  })

  test('a reconnect the engine refuses says so, and off reads nothing', async ($, on) => {
    const { w, clock } = world(on)
    w.failed = [{ name: 'stuck' }]
    await started($)
    await settle(clock)
    w.refuse = 'Reconnect, enable, and disable aren\'t available in this session.'
    await $.command.run(run('reconnect stuck'))
    await settle(clock)
    expect(w.logs.at(-1)).toBe('stuck is still not connected after /mcp reconnect: Reconnect, enable, and disable aren\'t available in this session.')
    expect((await $.command.run(run('off'))).text).toBe('off: the MCP servers are not read')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), reconnect <server>, on or off')
  })
})
