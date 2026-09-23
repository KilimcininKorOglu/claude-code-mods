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

type Section = { key: string; title: string; lines: { text: string; kind?: string }[]; buttons?: { label: string; command: string; args?: string }[]; until: string }

/** A process on the host: `stubborn` ignores SIGTERM. */
type Host = { pid: number; ppid: number; startedAt: number; args: string; ports: number[]; cwd: string; alive: boolean; stubborn?: boolean }

type World = {
  procs: Host[]
  transcript: string[]
  greps: string[][]
  signals: string[]
  logs: string[]
  bar: { open: boolean; sections: Section[]; cleared: string[] }
}

const PYTHON = '/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python'
const STARTED = Date.parse('2026-09-22T10:16:36Z')
const NOW = STARTED + 3 * 3_600_000
const SID = '450600b2-a839-4d4e-a452-cbea4c4731d0'

/** The Bash call and result that left the server running, as this project's transcript holds them. */
const TRANSCRIPT = [
  JSON.stringify({ type: 'assistant', timestamp: '2026-09-22T10:16:36.587Z', sessionId: SID, message: { content: [{ type: 'tool_use', id: 'toolu_01A7', name: 'Bash', input: { command: 'cd /work/site && (python3 -m http.server 8787 >/dev/null 2>&1 &) && sleep 1 && curl -s http://127.0.0.1:8787/' } }] } }),
  JSON.stringify({ type: 'user', timestamp: '2026-09-22T10:16:37.762Z', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_01A7', content: '200' }] } }),
]

/** `ps` elapsed time: `[dd-]hh:mm:ss`. */
function etime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = Math.floor(s / 86_400)
  return `${day > 0 ? `${day}-` : ''}${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}

const pidsIn = (argv: readonly string[]): number[] => (argv[argv.indexOf('-p') + 1] ?? '').split(',').map(Number)

/** The host commands the mod runs, answered from the world's processes. */
function answer(w: World, argv: readonly string[], now: number): string {
  const live = w.procs.filter(p => p.alive)
  if (argv[0] === 'git') return '/work\n'
  if (argv[0] === 'lsof' && argv.includes('-sTCP:LISTEN')) return live.map(p => `p${p.pid}\nf4\n${p.ports.map(n => `n*:${n}`).join('\n')}\n`).join('')
  if (argv[0] === 'lsof') return live.filter(p => pidsIn(argv).includes(p.pid)).map(p => `p${p.pid}\nfcwd\nn${p.cwd}\n`).join('')
  if (argv[0] === 'ps') return live.filter(p => pidsIn(argv).includes(p.pid)).map(p => `${p.pid} ${p.ppid} ${etime(now - p.startedAt)} ${p.args}\n`).join('')
  if (argv[0] === 'grep') {
    w.greps.push([...argv])
    return w.transcript.join('\n') + '\n'
  }
  if (argv[0] === 'kill') signal(w, argv)
  return ''
}

function signal(w: World, argv: readonly string[]): void {
  w.signals.push(argv.join(' '))
  const p = w.procs.find(x => x.pid === Number(argv[2]))
  if (p !== undefined && (argv[1] === '-KILL' || p.stubborn !== true)) p.alive = false
}

function world(on: On): { w: World; clock: ReturnType<typeof mock.clock> } {
  const w: World = { procs: [], transcript: TRANSCRIPT, greps: [], signals: [], logs: [], bar: { open: false, sections: [], cleared: [] } }
  mock.store(on, {})
  const clock = mock.clock(on, { now: NOW })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/u' : undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'current-session' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: answer(w, e.argv, clock.now()), stderr: '' } }))
  return { w, clock }
}

function seatSidebar(on: On, w: World): void {
  on('sidebar.set', (_, e) => {
    if (w.bar.open) w.bar.sections.push(e as unknown as Section)
    return { value: w.bar.open }
  })
  on('sidebar.clear', (_, e) => { w.bar.cleared.push((e as unknown as { key: string }).key); return { value: undefined } })
}

const server = (over: Partial<Host> = {}): Host => ({ pid: 3214, ppid: 1, startedAt: STARTED, args: `${PYTHON} -m http.server 8787`, ports: [8787], cwd: '/work/site', alive: true, ...over })

const run = (args: string): CommandRunInput => ({ command: 'orphan-server', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

let turns = 0
const turn = (): TurnCompleteInput => ({ answer: 'done', durationMs: 1, isAborted: false, turnId: `t${++turns}`, reason: 'answer' })

const started = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

describe('orphan-server', () => {
  withSidebar('a server a Bash call left running gets a standing row with a stop button, and SIGTERM ends it', async ($, on) => {
    const { w, clock } = world(on)
    seatSidebar(on, w)
    w.bar.open = true
    w.procs = [server()]
    await started($)
    await clock.settle()
    expect(w.bar.sections).toEqual([{ consumer: 'orphan-server', key: 'orphans', title: 'orphan servers', lines: [{ text: ':8787 Python -m http.server 8787 · 3h · session 450600b2', kind: 'warn' }], buttons: [{ label: 'stop :8787', command: 'orphan-server', args: 'stop 3214' }], until: 'session', order: 16 } as unknown as Section])
    // The transcripts of the repository root are read, only for the minutes around the start.
    expect(w.greps[0]).toContain('/Users/u/.claude/projects/-work')
    expect(w.greps[0]).toContain('"timestamp":"2026-09-22T10:16')
    // A turn's end with the same server reads no transcript again and draws nothing new.
    await $.turn.complete(turn())
    await clock.settle()
    expect(w.greps).toHaveLength(1)
    expect(w.bar.sections).toHaveLength(1)
    expect((await $.command.run(run('stop 3214'))).text).toBe('sent SIGTERM to 3214; SIGKILL follows in 5 s if it still runs')
    await clock.advance(5000)
    expect(w.signals).toEqual(['kill -TERM 3214'])
    expect(w.bar.sections.at(-1)?.lines).toEqual([{ text: 'stopped :8787 Python -m http.server 8787', kind: 'ok' }])
    expect(w.bar.cleared).toEqual(['orphans'])
  })

  withSidebar('a sidebar closed at the first scan gets the section at the next one, and the transcript line comes once', async ($, on) => {
    const { w, clock } = world(on)
    seatSidebar(on, w)
    w.procs = [server()]
    await started($)
    await clock.settle()
    expect(w.logs).toHaveLength(1)
    expect(w.bar.sections).toEqual([])
    await $.turn.complete(turn())
    await clock.settle()
    expect(w.logs).toHaveLength(1)
    w.bar.open = true
    await $.turn.complete(turn())
    await clock.settle()
    expect(w.bar.sections.map(s => s.key)).toEqual(['orphans'])
    expect(w.greps).toHaveLength(1)
  })

  test('a server that ignores SIGTERM gets SIGKILL after 5 s, and a closed sidebar reads one line', async ($, on) => {
    const { w, clock } = world(on)
    w.procs = [server({ stubborn: true })]
    await started($)
    await clock.settle()
    expect(w.logs).toEqual(['1 server(s) the model started still listen: 3214 :8787 Python -m http.server 8787 · 3h · session 450600b2; /orphan-server stop <pid> stops one'])
    await $.command.run(run('stop 3214'))
    await clock.advance(4999)
    expect(w.signals).toEqual(['kill -TERM 3214'])
    await clock.advance(1)
    expect(w.signals).toEqual(['kill -TERM 3214', 'kill -KILL 3214'])
    expect(w.logs.at(-1)).toBe('stopped :8787 Python -m http.server 8787')
  })

  test('a pid the system gave to another process since the scan gets no signal', async ($, on) => {
    const { w, clock } = world(on)
    w.procs = [server()]
    await started($)
    await clock.settle()
    w.procs = [server({ args: '/bin/sleep 1000', startedAt: NOW - 1000 })]
    expect((await $.command.run(run('stop 3214'))).text).toBe('3214 is no longer the server that was listed, so nothing was sent to it')
    expect((await $.command.run(run('stop 99'))).text).toBe('99 is not a listed server; /orphan-server lists them')
    expect(w.signals).toEqual([])
  })

  test('a server outside the repository, one with a living parent, and one no Bash call started are not listed', async ($, on) => {
    const { w, clock } = world(on)
    w.procs = [
      server({ pid: 10, cwd: '/elsewhere' }),
      server({ pid: 11, ppid: 700 }),
      server({ pid: 12, args: '/usr/bin/nc -l 9000', ports: [9000] }),
    ]
    await started($)
    await clock.settle()
    expect(w.logs).toEqual([])
    expect((await $.command.run(run(''))).text).toBe('no server the model started listens in this repository')
    expect((await $.command.run(run('off'))).text).toBe('off: the servers are read only when you run /orphan-server')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the list), stop <pid>, on or off')
  })
})
