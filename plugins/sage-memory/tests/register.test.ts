import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world's hooks answer. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

const run = (args: string): CommandRunInput => ({
  command: 'sage-memory', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const NODE_OK = JSON.stringify({ version: 'v24.18.0', typescript: 'strip', sqlite: true })
const LAUNCH_OK = JSON.stringify({ ready: true, started: true, hello: { name: 'sage-memory', version: '0.1.0', protocol: 1, pid: 4242, startedAt: '' } })
const OFF = { embedding: { state: 'off' }, setup: { state: 'idle' } }

/**
 * What the host answers: the Node facts, the launcher's line, the token file and each daemon route's
 * value; what reached it: argvs, fetches, sidebar lines and log lines. `store` is the store every
 * window shares, which a test writes as another window.
 */
type World = {
  node: string
  routes: Map<string, unknown>
  argvs: string[][]
  fetches: { url: string; socketPath?: string; auth?: string; body: Record<string, unknown> }[]
  lines: string[]
  logs: string[]
  store: Map<string, unknown>
  clock: MockClock
}

function world(on: On): World {
  const w: World = { node: NODE_OK, routes: new Map<string, unknown>([['/status', { pid: 4242 }], ['/embed/status', OFF]]), argvs: [], fetches: [], lines: [], logs: [], store: new Map(), clock: mock.clock(on, { now: Date.parse('2026-09-28T12:00:00Z') }) }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/src/my app/sub' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string }[] }
    w.lines.push(s.lines.map(l => l.text).join(' / '))
    return { value: true }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/k' : undefined }))
  on('fs.read', () => ({ value: JSON.stringify({ token: 'secret-token' }) }))
  on('process.run', (_, e) => {
    w.argvs.push([...e.argv])
    if (e.argv[0] === 'git') {
      const common = e.argv.includes('--git-common-dir')
      return { value: { exitCode: 0, stdout: common ? '/src/my app/.git\n' : '/src/my app\n', stderr: '' } }
    }
    const stdout = e.argv[1] === '-p' ? w.node : LAUNCH_OK
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('http.fetch', (_, e) => {
    const init = (e.init ?? {}) as { socketPath?: string; headers?: Record<string, string>; body?: string }
    const path = new URL(e.url).pathname
    w.fetches.push({ url: path, socketPath: init.socketPath, auth: init.headers?.authorization, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> })
    const value = w.routes.get(path)
    const reply = value === undefined ? { ok: false, error: 'no such route' } : { ok: true, value }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })
  return w
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/src/my app/sub' } as const

describe('sage-memory', () => {
  withSidebar('starts the daemon, asks it with the token over the socket, and shows it ready', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.lines.at(-1)).toBe('daemon ready · my app · embeddings off · /sage-memory setup')
    expect(w.argvs.find(a => a.includes('--dir'))?.slice(-2)).toEqual(['--dir', '/Users/k/.claude/sage-memory'])
    const status = w.fetches[0]
    if (status === undefined) throw new Error('no fetch reached the daemon')
    expect(status.url).toBe('/status')
    expect(status.socketPath).toBe('/Users/k/.claude/sage-memory/daemon.sock')
    expect(status.auth).toBe('Bearer secret-token')
    const project = status.body.project as { key: string; name: string; root: string; commonDir: string }
    expect(project.key).toMatch(/^my-app-[0-9a-f]{8}$/)
    expect(project).toMatchObject({ name: 'my app', root: '/src/my app', commonDir: '/src/my app/.git' })
  })

  withSidebar('a Node without type stripping or node:sqlite fails before any launch', async ($, on) => {
    const w = world(on)
    w.node = JSON.stringify({ version: 'v20.11.0', typescript: false, sqlite: false })
    await $.session.start(START)
    expect(w.lines.at(-1)).toBe('daemon failed: needs Node.js 22.18 or later with built-in TypeScript and node:sqlite; found v20.11.0')
    expect(w.argvs.some(a => a.includes('--dir'))).toBe(false)
  })

  withSidebar('off stored: nothing runs, and /sage-memory on connects and stores it', async ($, on) => {
    const w = world(on)
    w.store.set('enabled', false)
    await $.session.start(START)
    expect(w.argvs).toEqual([])
    expect(w.lines.at(-1)).toBe('off · /sage-memory on turns it on')
    const r = await $.command.run(run('on'))
    expect(r.text).toBe('on · daemon ready · my app · embeddings off · /sage-memory setup')
    expect(w.store.get('enabled')).toBe(true)
  })

  withSidebar('follows an off another window stored at the next turn', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.store.set('enabled', false)
    await $.turn.start({ text: 'hi', turnId: 't1' } as never)
    expect(w.lines.at(-1)).toBe('off · /sage-memory on turns it on')
    expect((await $.command.run(run(''))).text).toBe('off · off · /sage-memory on turns it on')
  })

  withSidebar('setup starts the job and follows it every 2 s until it is done', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.routes.set('/embed/setup', { state: 'running', step: 'install', detail: 'npm install', startedAt: '' })
    expect((await $.command.run(run('setup'))).text).toBe('setup running: install npm install')
    w.routes.set('/embed/status', { embedding: { state: 'ready', modelId: 'paraphrase-multilingual', dims: 384 }, setup: { state: 'done', indexed: 3, startedAt: '', finishedAt: '' } })
    await w.clock.advance(2000)
    expect(w.logs).toContain('setup done: 3 memories embedded')
    expect(w.lines.at(-1)).toBe('daemon ready · my app · embeddings paraphrase-multilingual')
  })

  withSidebar('answers an unknown word with the usage', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(run('frobnicate'))).text).toBe('expects nothing (the state), on, off or setup')
  })
})
