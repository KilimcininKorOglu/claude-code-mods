import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, ModelForkResult, On, SessionStartInput, TurnCompleteInput, TurnUsage } from 'claude-code'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the hooks of `seatSidebar` answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

type Bar = { open: boolean; sections: { key: string; lines: string[] }[] }

function seatSidebar(on: On, bar: Bar): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: { text: string }[] }
    if (bar.open) bar.sections.push({ key: s.key, lines: s.lines.map(l => l.text) })
    return { value: bar.open }
  })
  on('sidebar.clear', () => ({ value: undefined }))
  on('sidebar.isOpen', () => ({ value: bar.open }))
}

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const START = 1_000_000_000

const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({
  input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 500, model: 'claude-fable-5-1', ...over,
})

// TurnCompleteInput is a union on `reason`; these tests drive the answered arm.
type AnsweredTurn = Exclude<TurnCompleteInput, { reason: 'refusal' }>
let turns = 0
const turn = (over: Partial<AnsweredTurn> = {}): TurnCompleteInput => ({
  answer: 'ok', durationMs: 1000, isAborted: false, turnId: `t${++turns}`, reason: 'answer', usage: usage(), ...over,
})

const run = (command: 'cache-warm' | 'cache-status', args = ''): CommandRunInput => ({
  command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** What a fork reports: the cache read and write of a reply, an engine result as it is, or an Error to throw. */
type ForkAnswer = Error | ModelForkResult | { read: number; write: number; out?: number }

const NOTHING_TO_FORK: ModelForkResult ={ isAnswered: false, reason: 'nothing-to-fork' }
const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type World = {
  clock: MockClock
  store: Map<string, unknown>
  forks: number
  statuses: (string | undefined)[]
  logs: string[]
  live: { tokens?: number }
}

// The engine beneath the mod: the store, the session, and a fork that answers
// from a script, so each test decides what the cache looked like.
function world(on: On, answers: ForkAnswer[], opts: { store?: [string, unknown][]; sid?: string } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: START }),
    store: new Map(opts.store ?? []),
    forks: 0,
    statuses: [],
    logs: [],
    live: {},
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: opts.sid ?? 'S1' }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 1_000_000, tokens: w.live.tokens }, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.compact', (_, e) => ({ messages: e.messages }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('model.fork', () => {
    w.forks++
    const a = answers.shift()
    if (a instanceof Error) throw a
    if (a === undefined) return { value: NOTHING_TO_FORK }
    if ('isAnswered' in a) return { value: a }
    const u = { input_tokens: 2, output_tokens: a.out ?? 1, cache_read_input_tokens: a.read, cache_creation_input_tokens: a.write }
    return { value: { isAnswered: true as const, text: 'warm', usage: u } }
  })
  return w
}

const warm: ForkAnswer = { read: 200_000, write: 0 }

describe('keep warm', () => {
  test('a bare /cache-warm pings 50 minutes after the last request, then again', async ($, on) => {
    const w = world(on, [warm, warm])
    await $.session.start(session)
    const r = await $.command.run(run('cache-warm'))
    expect(r.text).toBe('on for 6h, a ping 50m after each idle stretch keeps the cache read, not re-written')
    expect(w.statuses.at(-1)).toBe('6h left · waiting for the first turn')
    await $.turn.complete(turn())
    expect(w.statuses.at(-1)).toBe('6h left · ping in 50m')
    await w.clock.advance(49 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(MIN)
    expect(w.forks).toBe(1)
    expect(w.statuses.at(-1)).toBe('5h 10m left · ping in 50m · last ping read 200k $0.05')
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(2)
  })

  withSidebar('an open sidebar takes the window state and the status line stays clear', async ($, on) => {
    const w = world(on, [])
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await $.session.start(session)
    await $.command.run(run('cache-warm'))
    expect(bar.sections.at(-1)).toEqual({ key: 'window', lines: ['6h left · waiting for the first turn'] })
    expect(w.statuses.at(-1)).toBe(undefined)
  })

  withSidebar('the section carries the last transcript line under the window state', async ($, on) => {
    const w = world(on, [warm])
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.advance(3 * HOUR)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_502 }) }))
    expect(bar.sections.at(-1)?.lines).toEqual(['6h left · ping in 50m', 'cold write 201k tokens paid ($4.01)'])
  })

  withSidebar('the stop reason gives way to the idle line at the next turn', async ($, on) => {
    const w = world(on, [{ read: 0, write: 180_000 }])
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    w.live.tokens = 315_000
    await $.session.start(session)
    await $.command.run(run('cache-warm'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(bar.sections.at(-1)?.lines).toEqual(['stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone'])
    await $.turn.complete(turn())
    expect(bar.sections.at(-1)?.lines).toEqual(['off · no cold write · context 315k tokens'])
    expect(w.logs).toEqual([])
  })

  test('a new turn moves the ping later', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(40 * MIN)
    await $.turn.complete(turn())
    await w.clock.advance(40 * MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(1)
  })

  test('a subagent turn does not move the ping', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(40 * MIN)
    await $.turn.complete(turn({ agentId: 'a1' }))
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(1)
  })

  test('stops when a ping finds the cache gone', async ($, on) => {
    const w = world(on, [{ read: 0, write: 180_000 }, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone')
    await w.clock.advance(2 * HOUR)
    expect(w.forks).toBe(1)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toMatch(/^stopped: /)
  })

  test('a ping\'s own small write passes, a partial re-write stops the loop', async ($, on) => {
    const w = world(on, [{ read: 200_000, write: 500 }, { read: 75_000, write: 70_000 }, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h every 1m'))
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.statuses.at(-1)).toMatch(/^5h 59m left · ping in 1m · last ping read 200k/)
    await w.clock.advance(MIN)
    expect(w.statuses.at(-1)).toMatch(/^stopped: the ping read 75k and wrote 70k tokens/)
    await w.clock.advance(5 * MIN)
    expect(w.forks).toBe(2)
  })

  test('stops when the engine has nothing to fork', async ($, on) => {
    const w = world(on, [NOTHING_TO_FORK])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('stopped: the engine did not send the ping; the conversation has no reply to fork yet')
  })

  test('stops with the status and kind of an API error, and scores no cold ping', async ($, on) => {
    const w = world(on, [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: NO_USAGE }])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('stopped: the ping failed, the API answered 529 (overloaded)')
    expect(w.logs.some(l => l.includes('cache was already gone'))).toBe(false)
  })

  test('stops when the ping was cut before its reply', async ($, on) => {
    const w = world(on, [{ isAnswered: false, reason: 'aborted', usage: NO_USAGE }])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('stopped: the ping was cut before a reply came')
  })

  test('a reply without text still read the cache, so it counts as a warm ping', async ($, on) => {
    const w = world(on, [{ isAnswered: false, reason: 'empty-reply', usage: { ...NO_USAGE, cache_read_input_tokens: 200_000 } }])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('10m left · ping in 50m · last ping read 200k $0.05')
  })

  test('stops with the error when the fork throws', async ($, on) => {
    const w = world(on, [new Error('rate limited')])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    // The engine skips a hook that throws and rejects the call with its own error.
    expect(w.statuses.at(-1)).toMatch(/^stopped: the ping failed, \S/)
    expect(w.forks).toBe(1)
  })

  test('the ping figure counts the output at the model\'s rate', async ($, on) => {
    const w = world(on, [{ read: 200_000, write: 0, out: 1000 }])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn({ usage: usage({ model: 'claude-sonnet-5' }) }))
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toBe('5h 10m left · ping in 50m · last ping read 200k $0.05')
  })

  test('the window ends on its own and forgets the every period', async ($, on) => {
    const w = world(on, [warm, warm, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '3m every 1m'))
    expect(w.store.get('every:S1')).toBe(MIN)
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(1)
    await w.clock.advance(5 * MIN)
    expect(w.forks).toBe(2)
    expect(w.statuses.at(-1)).toBe(undefined)
    expect(w.store.has('deadline:S1')).toBe(false)
    expect(w.store.has('every:S1')).toBe(false)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(10 * MIN)
    expect(w.forks).toBe(2)
  })

  test('the next message arms the window again, as long as the one that ran out', async ($, on) => {
    const w = world(on, [warm, warm, warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '3m every 1m'))
    await $.turn.complete(turn())
    await w.clock.advance(6 * MIN)
    expect(w.statuses.at(-1)).toBe(undefined)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toBe('off · 3m again at your next message · no cold write · context 201k tokens')
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    expect(w.logs.at(-1)).toBe('the 3m window ran out; this message arms another one. /cache-warm off stops it.')
    expect(w.store.get('every:S1')).toBe(MIN)
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(3)
  })

  test('a window the ping stopped is not armed again', async ($, on) => {
    const w = world(on, [{ read: 0, write: 180_000 }])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '3h'))
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toMatch(/^stopped: /)
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    expect((await $.command.run(run('cache-warm', 'status'))).text).toMatch(/^stopped: /)
    expect(w.store.has('deadline:S1')).toBe(false)
  })

  test('off cancels the ping and clears the status', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    const off = await $.command.run(run('cache-warm', 'off'))
    expect(off.text).toBe('off')
    expect(w.statuses.at(-1)).toBe(undefined)
    await w.clock.advance(2 * HOUR)
    expect(w.forks).toBe(0)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toBe('off · no cold write · context 201k tokens')
  })

  test('an argument it cannot read changes nothing', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    const r = await $.command.run(run('cache-warm', 'soon'))
    expect(r.text).toBe('expects a window such as 6h or 90m, or always, off, or status')
    expect(w.store.size).toBe(0)
  })
})

describe('always', () => {
  test('/cache-warm always sets the switch and starts the endless loop, with no window in the store', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    const r = await $.command.run(run('cache-warm', 'always'))
    expect(r.text).toMatch(/^always on: a ping every 50m with no end/)
    // The switch is the only key: it is global, and the endless loop needs no per-session deadline.
    expect(w.store.get('always')).toBe(true)
    expect(w.store.has('deadline:S1')).toBe(false)
  })

  test('a session start takes the endless loop over a stale window, and off ends it for good', async ($, on) => {
    const w = world(on, [warm], { store: [['always', true], ['deadline:S1', START + 10 * MIN], ['every:S1', MIN]] })
    await $.session.start(session)
    expect(w.store.has('deadline:S1')).toBe(false)
    expect(w.store.has('every:S1')).toBe(false)
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(0)
    await w.clock.advance(49 * MIN)
    expect(w.forks).toBe(1)
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/keep warm   on, always, no end · ping in 50m · last ping read 200k \$0\.05 \(always\)/)
    const off = await $.command.run(run('cache-warm', 'off'))
    expect(off.text).toBe('off, and no longer starts itself in any session')
    expect(w.store.has('always')).toBe(false)
  })

  test('the endless loop keeps pinging past six hours', async ($, on) => {
    const w = world(on, Array.from({ length: 8 }, () => warm), { store: [['always', true]] })
    await $.session.start(session)
    await $.turn.complete(turn())
    // Eight ping periods is over six hours: a window with an end would have run out by now.
    for (let i = 0; i < 8; i += 1) await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(8)
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/keep warm   on, always, no end/)
  })

  test('a ping that found the cache gone re-writes it and the endless loop carries on', async ($, on) => {
    const cold: ForkAnswer = { read: 0, write: 200_000 }
    const w = world(on, [cold, warm], { store: [['always', true]] })
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.logs.at(-1)).toBe('the ping found the cache gone and re-wrote 200k tokens ($4.00); always keeps the loop running. /cache-warm off stops it.')
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(2)
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/keep warm   on, always, no end/)
    expect(status.text).toMatch(/session     1 cold write paid, \$4\.00/)
  })

  test('a ping that failed stops the loop for that turn alone; the next turn starts it again', async ($, on) => {
    const w = world(on, [NOTHING_TO_FORK, warm], { store: [['always', true]] })
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.statuses.at(-1)).toMatch(/^stopped: the engine did not send the ping/)
    await $.turn.complete(turn())
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/keep warm   on, always, no end/)
    // The endless loop is back, so no per-session window took its place.
    expect(w.store.has('deadline:S1')).toBe(false)
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(2)
  })

  test('a cold write under always keeps the endless loop instead of arming a six-hour window', async ($, on) => {
    const w = world(on, [NOTHING_TO_FORK], { store: [['always', true]] })
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_502 }) }))
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/keep warm   on, always, no end/)
    expect(w.store.has('deadline:S1')).toBe(false)
  })
})

describe('cold writes', () => {
  test('a paid cold write is scored and keeps the cache warm for six hours', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.turn.complete(turn())
    await w.clock.advance(3 * HOUR)
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_502 }) }))
    expect(w.logs.at(-1)).toBe('cold write of 201k tokens paid ($4.01). Keeping the cache warm for 6h; /cache-warm off stops it.')
    expect(w.statuses.at(-1)).toBe('6h left · ping in 50m')
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(1)
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/session     1 cold write paid, \$4\.01/)
    expect(status.text).toMatch(/keep warm   on, 5h 10m left/)
  })

  test('a longer window already armed is kept', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '8h'))
    await $.turn.complete(turn())
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_502 }) }))
    expect(w.store.get('deadline:S1')).toBe(START + 8 * HOUR)
    expect(w.logs).toEqual([])
  })

  test('the context comes from the live window, not the turn\'s summed usage', async ($, on) => {
    const w = world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    w.live.tokens = 100_000
    await $.turn.complete(turn({ usage: usage({ cache_read_input_tokens: 500_000, cache_creation_input_tokens: 2_000 }) }))
    const status = await $.command.run(run('cache-status'))
    expect(status.text).toMatch(/context     100,000 tokens/)
    expect(status.text).toMatch(/0 cold writes paid/)
  })

  test('the card states the break-even and the cold price', async ($, on) => {
    world(on, [])
    await $.session.start(session)
    await $.turn.complete(turn())
    const status = (await $.command.run(run('cache-status'))).text
    expect(status).toMatch(/^claude-fable-5-1\nstate       warm, 1h left/)
    expect(status).toMatch(/cold cost   \$4\.01 to re-write it \(warm turn \$0\.05\)/)
    expect(status).toMatch(/break-even  up to 80 pings at the read rate cost one cold write, about 2d 18h of idle at one ping per 50m/)
  })
})

describe('compaction', () => {
  test('holds the ping until the first turn after a compaction', async ($, on) => {
    const w = world(on, [warm])
    await $.session.start(session)
    await $.command.run(run('cache-warm', '6h'))
    await $.turn.complete(turn())
    await w.clock.advance(10 * MIN)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
    expect(w.statuses.at(-1)).toBe('5h 50m left · waiting for the first turn')
    expect((await $.command.run(run('cache-status'))).text).toMatch(/state       reset by compaction/)
    await w.clock.advance(HOUR)
    expect(w.forks).toBe(0)
  })
})

describe('store per session', () => {
  test('another session\'s window does not arm this one and is left alone', async ($, on) => {
    const w = world(on, [warm], { sid: 'mine', store: [['deadline:other', START + HOUR], ['every:other', MIN]] })
    await $.session.start(session)
    expect((await $.command.run(run('cache-warm', 'status'))).text).toBe('off · no cold write')
    await $.turn.complete(turn())
    await w.clock.advance(50 * MIN)
    expect(w.forks).toBe(0)
    expect(w.store.get('deadline:other')).toBe(START + HOUR)
  })

  test('this session\'s own window is restored on start', async ($, on) => {
    const w = world(on, [warm], { sid: 'mine', store: [['deadline:mine', START + 2 * HOUR], ['every:mine', MIN]] })
    await $.session.start(session)
    expect(w.statuses.at(-1)).toBe('2h left · waiting for the first turn')
    await $.turn.complete(turn())
    await w.clock.advance(MIN)
    expect(w.forks).toBe(1)
  })

  test('off deletes only this session\'s keys and the always switch', async ($, on) => {
    const w = world(on, [], { sid: 'mine', store: [['deadline:other', START + HOUR], ['every:other', MIN], ['always', true]] })
    await $.session.start(session)
    await $.command.run(run('cache-warm', '1h every 1m'))
    expect(w.store.get('every:mine')).toBe(MIN)
    await $.command.run(run('cache-warm', 'off'))
    expect([...w.store.keys()]).toEqual(['deadline:other', 'every:other'])
  })

  test('a start clears its own ended window and other windows ended over a week ago', async ($, on) => {
    const w = world(on, [], {
      sid: 'mine',
      store: [
        ['deadline:mine', START - MIN], ['every:mine', MIN],
        ['deadline:recent', START - DAY], ['every:recent', MIN],
        ['deadline:old', START - 8 * DAY], ['every:old', MIN],
        ['deadline:live', START + HOUR],
        ['deadline:broken', 'x'],
      ],
    })
    await $.session.start(session)
    expect([...w.store.keys()]).toEqual(['deadline:recent', 'every:recent', 'deadline:live'])
  })
})
