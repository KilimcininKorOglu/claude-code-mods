import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On, PromptOrigin, PromptSubmitInput } from 'claude-code'

tier('user')

const ROOT = '/Users/u/app'

const run = (args: string): CommandRunInput => ({
  command: 'prompt-offload', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const typed = (text: string, origin: PromptOrigin = { kind: 'composer' }): PromptSubmitInput => ({ text, wait: false, origin })

/** What reached the engine beneath the plugin, what was written, and what was logged. */
type World = { entered: string[]; files: Map<string, string>; argv: string[]; logs: string[]; failWrite: boolean }

function world(on: On): World {
  const w: World = { entered: [], files: new Map(), argv: [], logs: [], failWrite: false }
  mock.store(on, {})
  mock.clock(on, { now: Date.parse('2026-09-20T10:00:00Z') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.get', () => ({ value: '/tmp/t/' }))
  on('process.run', (_, e) => {
    w.argv.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.write', (_, e) => {
    if (w.failWrite) throw new Error('read-only file system')
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('prompt.submit', (_, e) => {
    w.entered.push(e.text)
    return { text: e.text, origin: e.origin }
  })
  return w
}

async function started($: Engine): Promise<void> {
  await $.session.start({ surface: null, isInteractive: true, cwd: ROOT })
}

describe('prompt-offload', () => {
  test('a long pasted prompt is written to a file and the model reads its first lines and the path', async ($, on) => {
    const w = world(on)
    await started($)
    const long = `başlık\n${'x'.repeat(3000)}`
    await $.prompt.submit(typed(long))
    const path = [...w.files.keys()][0] ?? ''
    expect(path).toMatch(/^\/tmp\/t\/prompt-offload\/[0-9a-f]{8}\.txt$/)
    expect(w.files.get(path)).toBe(long)
    expect(w.entered[0]).toContain(`written to ${path}`)
    expect(w.entered[0]?.startsWith('başlık\nxxx')).toBe(true)
    expect(w.entered[0]?.length).toBeLessThan(long.length)
    expect(w.logs).toEqual([`3007 characters written to ${path}; the model reads the first 200 here`])
    expect(w.argv).toEqual(['mkdir -p /tmp/t/prompt-offload'])
  })

  test('a short prompt, another origin and off all reach the model as they are', async ($, on) => {
    const w = world(on)
    await started($)
    const long = 'x'.repeat(3000)
    await $.prompt.submit(typed('kısa bir istek'))
    await $.prompt.submit(typed(long, { kind: 'task-notification' }))
    expect((await $.command.run(run('off'))).text).toBe('off: every prompt reaches the model as it is')
    await $.prompt.submit(typed(long))
    expect(w.entered).toEqual(['kısa bir istek', long, long])
    expect(w.files.size).toBe(0)
    expect((await $.command.run(run(''))).text).toBe('off · limit 2000 characters')
  })

  test('the limit is set by hand and kept, and a failed write leaves the prompt as it is', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('limit 400'))).text).toBe('limit expects a whole number of at least 500')
    expect((await $.command.run(run('limit 600'))).text).toBe('limit 600: a prompt longer than that goes to a file')
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on, off or limit <n> (at least 500)')
    w.failWrite = true
    const text = 'y'.repeat(700)
    await $.prompt.submit(typed(text))
    expect(w.entered).toEqual([text])
    // A world hook that throws is reported as a missing implementation, so only the mod's own part is fixed text.
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]).toContain('the prompt was left as it is: ')
  })
})
