import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'
import type { Memory } from '../hooks/shared/model.ts'

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
  percent?: number
  spawned: string[]
  tasks: { id: string; status: string; subject: string }[]
  toolFails: boolean
}

function world(on: On): World {
  const w: World = { node: NODE_OK, routes: new Map<string, unknown>([['/status', { pid: 4242 }], ['/embed/status', OFF]]), argvs: [], fetches: [], lines: [], logs: [], store: new Map(), spawned: [], tasks: [], toolFails: false, clock: mock.clock(on, { now: Date.parse('2026-09-28T12:00:00Z') }) }
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
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { percent: w.percent }, rateLimits: [] } as never }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('prompt.section', (_, e) => ({ text: e.text }))
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('classic.SessionStart', () => ({}))
  on('classic.PostToolBatch', () => ({}))
  on('session.compact', () => ({ messages: [] }) as never)
  on('agent.spawn', (_, e) => {
    w.spawned.push(e.prompt)
    return { model: 'sonnet', agentId: 'agent-7' }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskList') return { result: { tasks: w.tasks } } as never
    return { result: 'ok', isError: w.toolFails } as never
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

function memory(id: string, text: string, extra: Partial<Memory> = {}): Memory {
  return {
    id, revision: 1, scope: 'project', kind: 'convention', status: 'active', contextPolicy: 'auto', persistence: 'long_lived', text,
    importance: 0.8, confidence: 0.9, freshness: 1, tags: [], anchors: [], sources: [], createdAt: '', updatedAt: '', ...extra,
  }
}

const ranked = (m: Memory, reasons = ['query:lexical']) => ({ memory: m, relationStrength: 0.9, score: 0.8, reasons })

const PNPM = memory('m1', 'Install packages with pnpm, never with npm, in this repository.')
const DAEMON = memory('m2', 'The daemon closes itself five minutes after its last request.', { anchors: [{ type: 'file', path: 'daemon/server.ts' }] })

function bodiesOf(w: World, path: string): Record<string, unknown>[] {
  return w.fetches.filter(f => f.url === path).map(f => f.body)
}

function readyWorld(on: On): World {
  const w = world(on)
  for (const path of ['/memory/reminded', '/memory/used', '/context/new']) w.routes.set(path, { counted: 1, epoch: 2 })
  w.routes.set('/remind/always', [])
  return w
}

const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never

describe('memory reminders', () => {
  withSidebar('a typed prompt carries the memories it finds, and the daemon records them for the main loop', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/prompt', { candidates: [ranked(PNPM)], rejected: [] })
    await $.session.start(START)
    const r = await $.prompt.submit(typed('which package manager do we use here?'))
    expect(r.context?.[0]).toContain('<memory id="m1" kind="convention" scope="project" status="active">\nInstall packages with pnpm')
    expect(bodiesOf(w, '/remind/prompt')[0]).toMatchObject({ sessionId: 'sess-1', loop: 'main', query: 'which package manager do we use here?' })
    expect(bodiesOf(w, '/memory/reminded')[0]).toMatchObject({ loop: 'main', trigger: 'prompt', ids: ['m1'] })
    expect(w.lines.at(-1)).toBe('reminded (prompt): Install packages with pnpm, never with')
  })

  withSidebar('a slash command and a turned-off mod ask the daemon nothing', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/prompt', { candidates: [ranked(PNPM)], rejected: [] })
    await $.session.start(START)
    await $.prompt.submit(typed('/compact'))
    await $.command.run(run('off'))
    await $.prompt.submit(typed('which package manager?'))
    expect(bodiesOf(w, '/remind/prompt')).toEqual([])
  })

  withSidebar('a file read reminds of the memories on its path and the tasks in progress, leaving out what the result already shows', async ($, on) => {
    const w = readyWorld(on)
    w.tasks = [{ id: '1', status: 'in_progress', subject: 'Shorten the idle timeout' }, { id: '2', status: 'pending', subject: 'Write docs' }]
    w.routes.set('/remind/tools', { candidates: [ranked(DAEMON, ['anchor:file']), ranked(PNPM)], rejected: [] })
    await $.session.start(START)
    const calls = [{ tool_name: 'Read', tool_input: { file_path: '/src/my app/daemon/server.ts' }, tool_use_id: 't1', tool_response: 'Install packages with pnpm, never with npm, in this repository.' }]
    const r = await $.classic.PostToolBatch({ tool_calls: calls } as never)
    const body = bodiesOf(w, '/remind/tools')[0]
    expect(body).toMatchObject({ loop: 'main', paths: ['/src/my app/daemon/server.ts'], mutation: false })
    expect(String(body?.query)).toContain('Shorten the idle timeout')
    expect(String(body?.query)).not.toContain('Write docs')
    expect(r.additionalContext?.[0]).toContain('<memory id="m2"')
    expect(r.additionalContext?.[0]).not.toContain('<memory id="m1"')
  })

  withSidebar('a nearly full context sends no reminder after tools', async ($, on) => {
    const w = readyWorld(on)
    w.percent = 96
    await $.session.start(START)
    const r = await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: { file_path: '/a.ts' }, tool_use_id: 't1', tool_response: '' }] } as never)
    expect(r.additionalContext).toBe(undefined)
    expect(bodiesOf(w, '/remind/tools')).toEqual([])
  })

  withSidebar('a subagent starts with its memories framed ahead of its task, recorded for its own loop', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/subagent', { audience: [PNPM], task: [ranked(DAEMON)] })
    await $.session.start(START)
    await $.agent.spawn({ tool_use_id: 't9', prompt: 'Find the idle timeout.', description: 'find', subagentType: 'Explore', permissionMode: 'default' } as never)
    const prompt = w.spawned[0] ?? ''
    expect(prompt.startsWith('[sage-memory] project memory for this agent and its task\nThis is saved project memory')).toBe(true)
    expect(prompt.endsWith('\n\nFind the idle timeout.')).toBe(true)
    expect(bodiesOf(w, '/remind/subagent')[0]).toMatchObject({ role: 'Explore', mode: 'default', task: 'Find the idle timeout.' })
    expect(bodiesOf(w, '/memory/reminded')[0]).toMatchObject({ loop: 'agent-7', trigger: 'subagent', ids: ['m1', 'm2'] })
  })

  withSidebar('an answer that names a reminded memory counts one use, once', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/prompt', { candidates: [ranked(PNPM)], rejected: [] })
    await $.session.start(START)
    await $.prompt.submit(typed('how do I install a package?'))
    const done = { answer: 'Run pnpm add, as memory m1 says.', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' } as never
    await $.turn.complete(done)
    await $.turn.complete(done)
    expect(bodiesOf(w, '/memory/used')).toEqual([{ project: expect.anything(), sessionId: 'sess-1', source: 'assistant_reference', ids: ['m1'] }])
  })

  withSidebar('the system prompt notes the plugin, the always memories come with each start, and a compaction starts the context over', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/always', [PNPM])
    await $.session.start(START)
    expect((await $.prompt.section({ name: 'env_info_simple', text: 'env' })).text).toContain('The user installed the sage-memory plugin.')
    const r = await $.classic.SessionStart({ source: 'compact', session_id: 'sess-1' } as never)
    expect(r.additionalContext?.[0]).toContain('[sage-memory] project memory kept in view at all times')
    expect(bodiesOf(w, '/context/new')).toEqual([{ project: expect.anything(), sessionId: 'sess-1', loop: 'main' }])
  })

  withSidebar('a successful edit checks the memories of its file, and a move carries anchors from where the command started', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/verify-paths', { results: [], staled: ['m2'], reactivated: [] })
    w.routes.set('/memory/remap', { moves: [{ from: 'a.ts', to: 'b.ts', memories: ['m2'] }], limited: 0, staled: [], reactivated: [] })
    await $.session.start(START)
    await $.tool.call({ tool: 'Edit', file_path: '/src/my app/daemon/server.ts', old_string: 'a', new_string: 'b' } as never)
    expect(bodiesOf(w, '/memory/verify-paths')[0]).toMatchObject({ paths: ['/src/my app/daemon/server.ts'] })
    expect(w.lines).toContain('after the edit: 1 memory(ies) went stale')
    await $.tool.call({ tool: 'Bash', command: 'git mv a.ts b.ts' } as never)
    expect(bodiesOf(w, '/memory/remap')[0]).toMatchObject({ command: 'git mv a.ts b.ts', cwd: '/src/my app/sub' })
    w.toolFails = true
    await $.tool.call({ tool: 'Edit', file_path: '/src/my app/x.ts', old_string: 'a', new_string: 'b' } as never)
    expect(bodiesOf(w, '/memory/verify-paths')).toHaveLength(1)
  })
})
