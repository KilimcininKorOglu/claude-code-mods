import { describe, expect, mock, test, tier, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { hasUserAgent, hostOf, isFetch, logText, sidebarLines, statusIn, statusText, urlOf } from '../hooks/fetch.ts'

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
}

const run = (args: string): CommandRunInput => ({
  command: 'ua-fallback', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

/** The logged lines, and the Bash result the world answers with. */
type World = { logs: string[]; result: { stdout: string; stderr: string }; isError?: true }

function world(on: On): World {
  const w: World = { logs: [], result: { stdout: '', stderr: '' } }
  mock.store(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  // A non-zero exit is an error result: `result` holds the error text, never the tool's record, and
  // `text` is what the model reads, `Exit code N` and the output (the shape a transcript stores).
  on('tool.call', { tool: 'Bash' }, () => {
    if (w.isError !== true) return { result: w.result } as never
    const text = `Exit code 22\n${w.result.stdout}\n${w.result.stderr}`
    return { result: text, text, isError: true } as never
  })
  return w
}

const bash = (command: string) => ({ tool: 'Bash' as const, command })

const started = async ($: { session: { start: (i: { surface: null; isInteractive: boolean; cwd: string }) => Promise<unknown> } }): Promise<void> => {
  await $.session.start({ surface: null, isInteractive: true, cwd: '/work' })
}

describe('ua-fallback', () => {
  test('reads the command, its URL and the status its output names', () => {
    expect(isFetch('curl -sS https://example.com')).toBe(true)
    expect(isFetch('wget https://example.com')).toBe(true)
    expect(isFetch('git fetch origin')).toBe(false)
    expect(hasUserAgent("curl -A 'x' https://e.com")).toBe(true)
    expect(hasUserAgent('curl -H "User-Agent: x" https://e.com')).toBe(true)
    expect(hasUserAgent('curl https://e.com')).toBe(false)
    expect(urlOf('curl -sS https://example.com/a?b=1 | jq .')).toBe('https://example.com/a?b=1')
    expect(hostOf('https://example.com/a')).toBe('example.com')
    expect(statusIn('HTTP/2 403')).toBe('403')
    expect(statusIn('<title>429 Too Many Requests</title>')).toBe('429')
    expect(statusIn('HTTP/1.1 200 OK')).toBe(undefined)
    expect(statusText(false, [])).toBe('off · no filtered request yet')
  })

  test('the sidebar colours the status, yellow for a rate limit and red for a refusal, and the retry faint', () => {
    const [head, limit] = sidebarLines('https://example.com/a', '429')
    expect(head).toEqual({
      text: 'example.com answered 429; a browser User-Agent may pass',
      parts: [{ text: 'example.com answered ' }, { text: '429', kind: 'warn' }, { text: '; a browser User-Agent may pass', kind: 'dim' }],
    })
    expect(head?.text).toBe(logText('https://example.com/a', '429'))
    expect(limit?.kind).toBe('dim')
    expect(sidebarLines('https://example.com/a', '403')[0]?.parts?.[1]).toEqual({ text: '403', kind: 'error' })
  })

  test('a filtered request brings the retry and its limits to the model', async ($, on) => {
    const w = world(on)
    await started($)
    w.result = { stdout: '<h1>403 Forbidden</h1>', stderr: '' }
    const note = (await $.tool.call(bash('curl -sS https://example.com/page'))).context?.[0] ?? ''
    expect(note).toContain('example.com answered 403, which is an automated-client filter')
    expect(note).toContain("Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0")
    expect(note).toContain('OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User')
    expect(note).toContain('Do not do this while testing an application, an API, an auth flow or a client of your own')
    expect(note).toContain('is not proof the resource works for ordinary clients')
    expect(w.logs).toEqual(['example.com answered 403; a browser User-Agent may pass'])
    expect((await $.command.run(run(''))).text).toBe('on · filtered: example.com')
  })

  test('a 200, a command that already sets a User-Agent, and a second call of the same host say nothing', async ($, on) => {
    const w = world(on)
    await started($)
    w.result = { stdout: 'HTTP/1.1 200 OK', stderr: '' }
    expect((await $.tool.call(bash('curl -i https://example.com'))).context).toBe(undefined)
    w.result = { stdout: '403 Forbidden', stderr: '' }
    expect((await $.tool.call(bash("curl -A 'Mozilla/5.0' https://example.com"))).context).toBe(undefined)
    await $.tool.call(bash('curl https://example.com/one'))
    expect((await $.tool.call(bash('curl https://example.com/two'))).context).toBe(undefined)
    expect(w.logs).toHaveLength(1)
  })

  test('a failed call is read from its error text, and off reads nothing', async ($, on) => {
    const w = world(on)
    w.isError = true
    await started($)
    w.result = { stdout: '', stderr: 'curl: (22) The requested URL returned error: 403' }
    const failed = await $.tool.call(bash('curl --fail https://example.com'))
    expect(failed.isError).toBe(true)
    expect(failed.context?.[0]).toContain('example.com answered 403, which is an automated-client filter')
    expect(w.logs).toEqual(['example.com answered 403; a browser User-Agent may pass'])
    expect((await $.command.run(run('off'))).text).toBe('off: requests are not read')
    w.result = { stdout: '429 Too Many Requests', stderr: '' }
    expect((await $.tool.call(bash('curl https://other.com'))).context).toBe(undefined)
    expect(w.logs).toHaveLength(1)
    expect((await $.command.run(run('what'))).text).toBe('expects nothing (the status), on or off')
  })

  withSidebar('an open sidebar takes the finding and the transcript stays clean', async ($, on) => {
    const w = world(on)
    const bar: Bar = { open: true, sections: [] }
    seatSidebar(on, bar)
    await started($)
    w.result = { stdout: 'HTTP/2 429', stderr: '' }
    await $.tool.call(bash('curl -i https://api.example.com/v1'))
    expect(bar.sections).toEqual([{
      key: 'api.example.com',
      lines: ['api.example.com answered 429; a browser User-Agent may pass', 'not while testing your own app, auth flow or client'],
    }])
    expect(w.logs).toEqual([])
  })
})
