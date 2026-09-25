import { describe, expect, mock, test, tier, type Engine, type MockClock } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

const run = (args: string): CommandRunInput => ({
  command: 'desk-notify', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/**
 * The host beneath the mod: what `uname -s` and git answer, how a notification command exits (`throw` when
 * it is missing), every notification argv the mod ran, and the lines it logged.
 */
type World = {
  uname: string
  commonDir: string
  top: string
  notifyExit: number | 'throw'
  sent: string[][]
  logs: string[]
  clock: MockClock
}

function world(on: On, env: Record<string, string> = {}, store: Record<string, unknown> = {}): World {
  const w: World = { uname: 'Darwin', commonDir: '/Users/u/app/.git', top: '/Users/u/app', notifyExit: 0, sent: [], logs: [], clock: mock.clock(on) }
  mock.store(on, store)
  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/u/app/sub' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('process.run', (_, e) => {
    const [cmd, ...rest] = e.argv
    if (cmd === 'uname') return { value: { exitCode: 0, stdout: `${w.uname}\n`, stderr: '' } }
    if (cmd === 'git') return { value: { exitCode: 0, stdout: `${rest.includes('--git-common-dir') ? w.commonDir : w.top}\n`, stderr: '' } }
    if (w.notifyExit === 'throw') throw new Error(`${cmd}: not found`)
    w.sent.push([...e.argv])
    return { value: { exitCode: w.notifyExit, stdout: '', stderr: w.notifyExit === 0 ? '' : 'daemon down' } }
  })
  on('tool.call', { tool: /^(AskUserQuestion|ExitPlanMode)$/ }, () => ({ result: 'answered' }) as never)
  on('classic.Stop', () => ({}))
  on('classic.StopFailure', () => ({}))
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/Users/u/app/sub' })
}

const ask = ($: Engine) => $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
const plan = ($: Engine) => $.tool.call({ tool: 'ExitPlanMode', plan: 'p' } as never)

describe('desk-notify', () => {
  test('a question, a plan and a turn end each send one notification naming the project', async ($, on) => {
    const w = world(on)
    await started($)
    await ask($)
    await plan($)
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' })
    await w.clock.settle()
    expect(w.sent).toEqual([
      ['osascript', '-e', 'display notification "app" with title "Question awaiting your answer" subtitle "Claude Code"'],
      ['osascript', '-e', 'display notification "app" with title "Plan awaiting your approval" subtitle "Claude Code"'],
      ['osascript', '-e', 'display notification "app" with title "Turn finished" subtitle "Claude Code"'],
    ])
  })

  test('a failed turn names the first line of its error, and a worktree names its primary repository', async ($, on) => {
    const w = world(on)
    w.commonDir = '/Users/u/app/.git/worktrees/fix'
    w.top = '/Users/u/fix'
    await started($)
    await $.classic.StopFailure({ error: 'server_error', error_details: '## API Error: Connection lost mid-response\nretry 10', last_assistant_message: 'half' } as never)
    await w.clock.settle()
    expect(w.sent.at(-1)?.[2]).toBe('display notification "app: API Error: Connection lost mid-response" with title "Turn failed" subtitle "Claude Code"')
  })

  test('each event turns off on its own and the setting is kept in the store', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('ask off'))).text).toBe(
      'notifications on darwin\nask off: a question waits for your answer\nplan on: a plan waits for your approval\nstop on: a turn ended or failed',
    )
    expect((await $.command.run(run('ask maybe'))).text).toBe('expects nothing (the status), or ask, plan or stop followed by on or off')
    await ask($)
    await plan($)
    await w.clock.settle()
    expect(w.sent.map(a => a[2])).toEqual(['display notification "app" with title "Plan awaiting your approval" subtitle "Claude Code"'])
  })

  test('a stored off holds in the next session', async ($, on) => {
    const w = world(on, {}, { stop: false })
    await started($)
    await $.classic.Stop({ stop_hook_active: false })
    await w.clock.settle()
    expect(w.sent).toEqual([])
    expect((await $.command.run(run(''))).text).toContain('stop off')
  })

  test('Windows is read from its OS variable and gets a PowerShell toast', async ($, on) => {
    const w = world(on, { OS: 'Windows_NT' })
    await started($)
    await ask($)
    await w.clock.settle()
    expect(w.sent[0]?.[0]).toBe('powershell.exe')
    expect(w.sent[0]?.[4]).toContain("CreateTextNode('Claude Code - app')")
  })

  test('on Linux notify-send carries the subtitle in the body', async ($, on) => {
    const w = world(on)
    w.uname = 'Linux'
    await started($)
    await ask($)
    await w.clock.settle()
    expect(w.sent).toEqual([['notify-send', 'Question awaiting your answer', 'Claude Code\napp']])
  })

  test('a failing notification command is reported once, and a system without one sends nothing', async ($, on) => {
    const w = world(on)
    w.notifyExit = 1
    await started($)
    await ask($)
    await ask($)
    await w.clock.settle()
    expect(w.logs).toEqual(['osascript exited 1: daemon down'])
    w.uname = 'FreeBSD'
    await started($)
    await ask($)
    await w.clock.settle()
    expect(w.logs.at(-1)).toBe('no notification command on this system; nothing is sent')
    expect(w.sent).toHaveLength(2)
  })
})
