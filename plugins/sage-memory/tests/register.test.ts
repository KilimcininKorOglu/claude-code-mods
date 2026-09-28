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
  tools: string[]
  asked: { system: string; prompt: string; model: string }[]
  modelText?: string
  curatorText?: string
  rateText?: string
  mergeText?: string
}

function world(on: On): World {
  const w: World = { node: NODE_OK, routes: new Map<string, unknown>([['/status', { pid: 4242 }], ['/embed/status', OFF]]), argvs: [], fetches: [], lines: [], logs: [], store: new Map(), spawned: [], tasks: [], toolFails: false, tools: [], asked: [], clock: mock.clock(on, { now: Date.parse('2026-09-28T12:00:00Z') }) }
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
  on('model.complete', (_, e) => {
    w.asked.push({ system: e.system ?? '', prompt: e.prompt, model: e.model })
    const system = e.system ?? ''
    const text = system.startsWith('Rate this') ? w.rateText : system.startsWith('Do these two') ? w.mergeText : system.startsWith('You are a fast, automated memory curator') ? w.curatorText : w.modelText
    return { value: text === undefined ? { isAnswered: false, reason: 'empty-reply', usage: {} } : { isAnswered: true, text, usage: {} } } as never
  })
  on('tool.register', (_, e) => { w.tools.push(e.name); return { value: undefined } as never })
  on('tool.describe', (_, e) => ({ description: e.description }))
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
    const route = w.routes.get(path)
    const value = typeof route === 'function' ? (route as (body: Record<string, unknown>) => unknown)(w.fetches.at(-1)?.body ?? {}) : route
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
    expect((await $.command.run(run('frobnicate'))).text).toBe('expects nothing (the state), on, off, setup, triage [apply], compact [apply], daily [on|off] or capture outcomes|errors [on|off]')
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
  w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
  for (const path of ['/remind/prompt', '/remind/tools']) w.routes.set(path, { candidates: [], rejected: [] })
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

const TOOL = (name: string) => `mcp__sage-memory__${name}`

describe('memory tools', () => {
  withSidebar('declares the 15 tools when on, and at the first turn after another window turned the mod on', async ($, on) => {
    const w = readyWorld(on)
    w.store.set('enabled', false)
    await $.session.start(START)
    expect(w.tools).toEqual([])
    w.store.set('enabled', true)
    await $.turn.start({ text: 'hi', turnId: 't1' } as never)
    expect(w.tools).toHaveLength(15)
    expect(w.tools.slice(0, 2)).toEqual(['remember', 'search'])
  })

  withSidebar('remember and search are listed at once, the rest wait behind ToolSearch, and none asks for approval', async ($, on) => {
    readyWorld(on)
    await $.session.start(START)
    const described = async (name: string) => (await $.tool.describe({ tool: TOOL(name), description: 'd', provider: { kind: 'plugin', name: 'sage-memory' } } as never)).isDeferred
    expect(await described('remember')).toBe(false)
    expect(await described('update')).toBe(undefined)
    expect((await $.tool.check({ tool: TOOL('delete'), input: {} } as never)).decision).toBe('allow')
  })

  withSidebar('remember writes through the daemon with this session as its source, a session memory owned by it', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: PNPM, outcome: 'added' })
    await $.session.start(START)
    const r = await $.tool.call({ tool: TOOL('remember'), text: PNPM.text, scope: 'session', tags: ['build'] } as never)
    expect(String(r.result)).toContain('"outcome": "added"')
    expect(bodiesOf(w, '/memory/remember')[0]).toMatchObject({
      sessionId: 'sess-1',
      input: { text: PNPM.text, scope: 'session', tags: ['build'], ownerSessionId: 'sess-1', sources: [{ type: 'session', sessionId: 'sess-1' }] },
    })
  })

  withSidebar('a delete without force and a two-letter forget are refused before the daemon is asked', async ($, on) => {
    const w = readyWorld(on)
    await $.session.start(START)
    const deleted = await $.tool.call({ tool: TOOL('delete'), id: 'm1' } as never)
    expect(deleted).toMatchObject({ isError: true })
    expect(String(deleted.result)).toMatch(/^force: true is required to delete a memory/)
    const forgot = await $.tool.call({ tool: TOOL('forget'), query: 'ab', force: true } as never)
    expect(String(forgot.result)).toMatch(/^query must be at least 3 characters/)
    expect(bodiesOf(w, '/memory/delete').length + bodiesOf(w, '/memory/forget').length).toBe(0)
  })

  withSidebar('a tool called after another window turned the mod off says so', async ($, on) => {
    const w = readyWorld(on)
    await $.session.start(START)
    w.store.set('enabled', false)
    const r = await $.tool.call({ tool: TOOL('search'), query: 'pnpm' } as never)
    expect(r).toMatchObject({ isError: true, result: 'sage-memory is off; the person turns it on with /sage-memory on.' })
  })
})

/** Lets a job the turn does not wait for run to its end. */
async function settled(w: World): Promise<void> {
  for (let i = 0; i < 20; i += 1) await w.clock.advance(1)
}

const answered = (answer: string) => ({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' }) as never

describe('consolidator', () => {
  withSidebar('after a worked turn the model reads the answer and evidence, and each add it proposes is written', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [PNPM], nextCursor: null, total: 1, statusCounts: {} })
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.tasks = [{ id: '1', status: 'completed', subject: 'Shorten the idle timeout' }]
    w.modelText = JSON.stringify({
      operations: [
        { action: 'add', text: 'The daemon closes itself five minutes after its last request.', kind: 'fact', priority: 'high', confidence: 0.9, tags: ['daemon'], anchors: [{ type: 'file', path: 'daemon/server.ts' }] },
        { action: 'add', text: 'The user prefers short answers.', scope: 'user', kind: 'preference', anchors: [{ type: 'file', path: 'a.ts' }] },
        { action: 'delete', text: 'anything' },
      ],
    })
    await $.session.start(START)
    await $.turn.start({ text: 'x', turnId: 't' } as never)
    await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: { file_path: '/src/my app/daemon/server.ts' }, tool_use_id: 't1', tool_response: '' }] } as never)
    await $.tool.call({ tool: 'Bash', command: 'API_KEY=abc npm test' } as never)
    await $.turn.complete(answered('The idle timeout is five minutes, set in the daemon server.'))
    await settled(w)
    const asked = w.asked[0]
    expect(asked?.model).toBe('haiku')
    expect(asked?.system).toContain('You are a memory consolidator.')
    expect(asked?.prompt).toContain('"daemon/server.ts"')
    expect(asked?.prompt).toContain('[redacted sensitive command]')
    expect(asked?.prompt).toContain('Shorten the idle timeout')
    expect(asked?.prompt).toContain('(project) Install packages with pnpm')
    const inputs = bodiesOf(w, '/memory/remember').map(body => body.input as Record<string, unknown>)
    expect(inputs.map(input => input.kind)).toEqual(['fact', 'preference', 'session_digest'])
    expect(inputs[0]).toMatchObject({ scope: 'project', importance: 0.8, confidence: 0.9, anchors: [{ type: 'file', path: 'daemon/server.ts' }], sources: [{ type: 'session', sessionId: 'sess-1' }] })
    expect(inputs[1]).toMatchObject({ scope: 'user', anchors: [] })
    expect(inputs[2]).toMatchObject({ scope: 'session', ownerSessionId: 'sess-1', text: 'Session digest (2 facts added): The idle timeout is five minutes, set in the daemon server.' })
    expect(w.lines).toContain('added (project): The daemon closes itself five minutes after its last request.')
  })

  withSidebar('a turn nobody asked for and nothing worked on is not consolidated, nor one while the consolidator is off', async ($, on) => {
    const w = readyWorld(on)
    w.modelText = '{"operations":[]}'
    await $.session.start(START)
    await $.turn.complete(answered('A plugin turn that only talked, long enough to count.'))
    await settled(w)
    w.store.set('consolidate', false)
    await $.prompt.submit(typed('what changed?'))
    await $.turn.complete(answered('Nothing changed in this project since the last turn.'))
    await settled(w)
    expect(w.asked).toEqual([])
  })

  withSidebar('a model that does not answer leaves a red line and writes nothing', async ($, on) => {
    const w = readyWorld(on)
    await $.session.start(START)
    await $.prompt.submit(typed('what is the timeout?'))
    await $.turn.complete(answered('The idle timeout is five minutes.'))
    await settled(w)
    expect(w.lines).toContain('the consolidator got no answer (empty-reply)')
    expect(bodiesOf(w, '/memory/remember')).toEqual([])
  })
})

describe('curator', () => {
  withSidebar('after a turn that wrote a file, the memories about it are audited and the decisions applied to the ids shown', async ($, on) => {
    const w = readyWorld(on)
    const OLD = memory('m3', 'The daemon closes itself ten minutes after its last request.', { anchors: [{ type: 'file', path: 'daemon/server.ts' }] })
    const KEPT = memory('m4', 'The server file holds the idle timer and the socket.', { anchors: [{ type: 'file', path: 'daemon/server.ts' }], persistence: 'permanent' })
    w.routes.set('/memory/for-path', [OLD, KEPT])
    w.routes.set('/candidates/list', [])
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.routes.set('/memory/update', { memory: DAEMON, superseded: ['m3'] })
    w.modelText = '{"operations":[]}'
    w.curatorText = JSON.stringify({
      operations: [
        { action: 'merge', targetIds: ['m3', 'm4', 'unknown'], text: 'The daemon closes itself five minutes after its last request.', type: 'fact', priority: 'high', reason: 'timer changed' },
        { action: 'supersede', targetId: 'm4', reason: 'permanent' },
        { action: 'recalibrate', targetId: 'm4', importance: 1.5, status: 'archived', reason: 'x' },
        { action: 'contradict', targetId: 'm3', contradictsWith: 'a fact', reason: 'no id' },
      ],
    })
    await $.session.start(START)
    await $.turn.start({ text: 'x', turnId: 't' } as never)
    await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Edit', tool_input: { file_path: '/src/my app/daemon/server.ts' }, tool_use_id: 't1', tool_response: 'ok' }] } as never)
    await $.turn.complete(answered('The idle timeout is now five minutes in the daemon server.'))
    await settled(w)
    expect(w.asked.map(a => a.system.slice(0, 30))).toEqual(['You are a memory consolidator.', 'You are a fast, automated memo'])
    expect(w.asked[1]?.prompt).toContain('Modified files:\ndaemon/server.ts')
    expect(bodiesOf(w, '/memory/for-path')[0]).toMatchObject({ path: 'daemon/server.ts', limit: 4 })
    expect(bodiesOf(w, '/memory/update')).toEqual([
      { project: expect.anything(), sessionId: 'sess-1', id: 'm2', patch: { supersedes: ['m3'] } },
      { project: expect.anything(), sessionId: 'sess-1', id: 'm4', patch: { importance: 1 } },
    ])
    expect(w.lines).toContain('curated: 1 merged, 1 recalibrated')
  })
})

describe('triage, compact and capture', () => {
  const GRAY = memory('g1', 'The build writes its bundle into the dist folder before the tests run.')
  const WIP = memory('w1', 'wip: try the other parser', { importance: 0.3 })
  const KEEPER = memory('k1', 'The server file holds the idle timer and the socket path.', { anchors: [{ type: 'file', path: 'a.ts' }], persistence: 'permanent' })
  const TWIN = memory('t1', 'The server file holds the idle timer and the socket.', { anchors: [{ type: 'file', path: 'a.ts' }], kind: 'decision' })

  function triageWorld(on: On): World {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [GRAY, WIP, KEEPER, TWIN], nextCursor: null, total: 4, statusCounts: {} })
    w.routes.set('/candidates/list', [])
    w.routes.set('/memory/get', KEEPER)
    w.routes.set('/memory/update', { memory: KEEPER, superseded: [] })
    w.routes.set('/candidates/propose', { id: 'c1' })
    w.rateText = '2 | a build detail that changes often'
    w.mergeText = 'YES'
    return w
  }

  withSidebar('a triage dry run reports rule, score, rating and merge verdicts and writes nothing', async ($, on) => {
    const w = triageWorld(on)
    await $.session.start(START)
    const text = String((await $.command.run(run('triage'))).text)
    expect(text).toContain('triage of 4 memories: 2 kept by rule, 1 discarded by rule or score, 1 in the gray band (1 rated, 0 without a rating)')
    expect(text).toContain('1 patch(es), 2 review proposal(s), 1 merge(s) and 0 overlap(s) from 1 compared pair(s)')
    expect(text).toContain('merge: t1 into k1')
    expect(text).toContain('dry run: nothing was written')
    expect(bodiesOf(w, '/memory/list')[0]).toMatchObject({ statuses: ['active', 'stale'], allSessions: true })
    expect(bodiesOf(w, '/memory/update').length + bodiesOf(w, '/candidates/propose').length).toBe(0)
  })

  withSidebar('triage apply writes the patches, lets the permanent keeper supersede its twin, and files the proposals', async ($, on) => {
    const w = triageWorld(on)
    await $.session.start(START)
    const text = String((await $.command.run(run('triage apply'))).text)
    expect(bodiesOf(w, '/memory/update').map(b => ({ id: b.id, patch: b.patch }))).toEqual([
      { id: 'g1', patch: { confidence: 0.3 } },
      { id: 'k1', patch: { supersedes: ['t1'] } },
    ])
    expect(bodiesOf(w, '/candidates/propose').map(b => (b.input as { targetMemoryId: string; suggestedAction: string }))).toMatchObject([
      { targetMemoryId: 'w1', suggestedAction: 'archive' },
      { targetMemoryId: 'g1', suggestedAction: 'archive' },
    ])
    expect(text).toContain('applied: 1 patch(es), 1 merge(s), 2 review proposal(s) filed')
  })

  withSidebar('a rating the model does not give changes nothing', async ($, on) => {
    const w = triageWorld(on)
    w.rateText = undefined
    w.mergeText = undefined
    await $.session.start(START)
    const text = String((await $.command.run(run('triage apply'))).text)
    expect(text).toContain('(0 rated, 1 without a rating)')
    expect(text).toContain('1 pair(s) without a verdict')
    expect(bodiesOf(w, '/memory/update')).toEqual([])
  })

  withSidebar('compact proposes, touches only shown ids, keeps a permanent memory, and applies the proposal', async ($, on) => {
    const w = triageWorld(on)
    w.routes.set('/memory/get', (body: Record<string, unknown>) => (body.id === 'g1' ? GRAY : { ...WIP, revision: 2 }))
    w.routes.set('/memory/delete', { deleted: true })
    w.modelText = JSON.stringify({
      operations: [
        { action: 'rewrite', targets: ['g1'], newText: 'The build writes its bundle into dist.', reason: 'shorter' },
        { action: 'delete', targets: ['k1', 'w1', 'nope'], reason: 'noise' },
      ],
    })
    await $.session.start(START)
    const proposal = String((await $.command.run(run('compact'))).text)
    expect(proposal).toContain('compact proposal over 4 memories: 3 would stay (2 untouched), 1 would leave')
    expect(proposal).toContain('skipped: nope was not in the list')
    expect(proposal).toContain('skipped: k1 is permanent and is not deleted')
    expect(bodiesOf(w, '/memory/update')).toEqual([])
    const applied = String((await $.command.run(run('compact apply'))).text)
    expect(bodiesOf(w, '/memory/update').map(b => b.patch)).toEqual([{ text: 'The build writes its bundle into dist.' }])
    expect(applied).toContain('compact applied: 1 of 2 change(s)')
    expect(applied).toContain('failed: delete w1: w1 changed since the proposal')
  })

  withSidebar('the daily dry run runs an hour after a start once a day, files proposals, and patches nothing', async ($, on) => {
    const w = triageWorld(on)
    w.routes.set('/memory/hygiene', { project: { state: 'started' } })
    w.store.set('daily', true)
    w.store.set('dailyAt', Date.parse('2026-09-26T12:00:00Z'))
    await $.session.start(START)
    await w.clock.advance(59 * 60 * 1000)
    expect(bodiesOf(w, '/memory/hygiene')).toEqual([])
    await w.clock.advance(60 * 1000)
    await settled(w)
    expect(bodiesOf(w, '/memory/hygiene')).toHaveLength(1)
    expect(bodiesOf(w, '/candidates/propose')).toHaveLength(2)
    expect(bodiesOf(w, '/memory/update')).toEqual([])
    expect(w.store.get('dailyAt')).toBe(Date.parse('2026-09-28T13:00:00Z'))
    expect(w.lines.at(-1)).toBe('daily triage: 4 memories, 2 review proposal(s) filed, 1 merge(s) suggested')
  })

  withSidebar('outcome capture writes a failed command once an hour while the person turned it on', async ($, on) => {
    const w = triageWorld(on)
    w.routes.set('/memory/remember', { memory: GRAY, outcome: 'added' })
    await $.session.start(START)
    w.toolFails = true
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    expect(bodiesOf(w, '/memory/remember')).toEqual([])
    expect((await $.command.run(run('capture errors on'))).text).toBe('capturing failed commands on')
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    const inputs = bodiesOf(w, '/memory/remember').map(b => b.input as Record<string, unknown>)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ kind: 'error_pattern', anchors: [{ type: 'command', command: 'npm test' }] })
  })
})
