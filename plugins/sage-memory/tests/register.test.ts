import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, RenderPropsOf, UiPane } from 'claude-code'
import type { Memory } from '../hooks/shared/model'
import { TOOLS } from '../hooks/tools'
import { captureOf } from '../hooks/capture'
import { countsLine, stateLines, storedLine } from '../hooks/link'

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
  /** What a tool the world runs returns: a file's text for Read. */
  toolText: string
  /** How the daemon is lost until the launcher runs again: its socket refuses, it refuses the token, or it answers 503 while closing. */
  lost?: 'socket' | 'token' | 'closing'
  tools: string[]
  asked: { system: string; prompt: string; model: string; maxTokens?: number; timeoutMs?: number }[]
  modelText?: string
  /** How many model calls the world answers with an empty body before the texts flow again. */
  emptyReplies: number
  /** How many model calls the world answers with this unanswered reason, before the texts flow again. */
  noAnswer?: { reason: 'aborted' | 'api-error'; times: number; status?: number; error?: string }
  curatorText?: string
  rateText?: string
  mergeText?: string
  /** The containment answer for one prompt, which names the two texts in order. */
  contains?: (prompt: string) => string | undefined
  conflictText?: string
  /** The rewrite of a long memory, by the question's prompt. */
  shorten?: (prompt: string) => string | undefined
  files: Map<string, string>
  panes: UiPane[]
  buttons: unknown[]
  /** The lines the sidebar was given under each key, in order, as written. */
  byKey: Map<string, Drawn[]>
}

type Drawn = { text: string; kind?: string; parts?: { text: string; kind?: string }[] }

/** The world's answer while the daemon is lost in one of the three ways, or undefined to serve the route. */
function lostAnswer(lost: World['lost']): { value: unknown } | undefined {
  if (lost === 'socket') throw new Error('connect ENOENT daemon.sock')
  if (lost === 'closing') return { value: { status: 503, ok: false, headers: {}, text: JSON.stringify({ ok: false, error: 'the daemon is closing' }) } }
  if (lost === 'token') return { value: { status: 401, ok: false, headers: {}, text: JSON.stringify({ ok: false, error: 'unauthorized' }) } }
  return undefined
}

/** The world's answer to a job model call by the system prompt it names. */
function modelAnswer(w: World, system: string): string | undefined {
  if (system.startsWith('Rate one memory')) return w.rateText
  if (system.startsWith('Do these two')) return w.mergeText
  if (system.startsWith('Two project memories, A and B, follow. Do they give')) return w.conflictText
  return system.startsWith('You are a fast, automated memory curator') ? w.curatorText : w.modelText
}

/** The world's answer to a job model call: the questions that read their prompt first, then by the system prompt alone. */
function answerFor(w: World, system: string, prompt: string): string | undefined {
  if (system.startsWith('Two project memories, A and B, follow. Does B')) return w.contains?.(prompt)
  return system.startsWith('You rewrite one stored memory note') ? w.shorten?.(prompt) : modelAnswer(w, system)
}

function world(on: On): World {
  const w: World = { node: NODE_OK, routes: new Map<string, unknown>([['/status', { pid: 4242 }], ['/embed/status', OFF], ['/memory/close-pairs', []], ['/memory/long', []]]), argvs: [], fetches: [], lines: [], logs: [], store: new Map(), spawned: [], tasks: [], toolFails: false, toolText: 'ok', tools: [], asked: [], emptyReplies: 0, files: new Map(), panes: [], buttons: [], byKey: new Map(), clock: mock.clock(on, { now: Date.parse('2026-09-28T12:00:00Z') }) }
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
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.open', (_, e) => { w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: true, isPlaced: true }); return { value: { isPlaced: true as const } } })
  on('ui.close', (_, e) => { w.panes = w.panes.filter(p => p.id !== e.id); return { value: undefined } })
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { key: string; lines: Drawn[]; buttons?: unknown }
    if (s.buttons !== undefined) w.buttons.push(s.buttons)
    w.lines.push(s.lines.map(l => l.text).join(' / '))
    w.byKey.set(s.key, [...(w.byKey.get(s.key) ?? []), ...s.lines])
    return { value: true }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/k' : undefined }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('server.json') ? JSON.stringify({ token: 'secret-token' }) : (w.files.get(e.path) ?? '') }))
  on('process.run', (_, e) => {
    w.argvs.push([...e.argv])
    if (e.argv[0] === 'git') {
      const common = e.argv.includes('--git-common-dir')
      return { value: { exitCode: 0, stdout: common ? '/src/my app/.git\n' : '/src/my app\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout = e.argv[1] === '-p' ? w.node : LAUNCH_OK
    if (e.argv.includes('--dir')) w.lost = undefined
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('model.complete', (_, e) => {
    w.asked.push({ system: e.system ?? '', prompt: e.prompt, model: e.model, maxTokens: e.maxTokens, timeoutMs: e.timeoutMs })
    if (w.noAnswer !== undefined && w.noAnswer.times > 0) {
      w.noAnswer.times -= 1
      return { value: { isAnswered: false, reason: w.noAnswer.reason, status: w.noAnswer.status, error: w.noAnswer.error, usage: {} } } as never
    }
    if (w.emptyReplies > 0) {
      w.emptyReplies -= 1
      return { value: { isAnswered: false, reason: 'empty-reply', usage: {} } } as never
    }
    const text = answerFor(w, e.system ?? '', e.prompt)
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
  on('session.end', () => ({ sessionId: 'sess-1' }) as never)
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskList') return { result: { tasks: w.tasks } } as never
    return { result: w.toolText, isError: w.toolFails } as never
  })
  on('http.fetch', (_, e) => {
    const init = (e.init ?? {}) as { socketPath?: string; headers?: Record<string, string>; body?: string }
    const path = new URL(e.url).pathname
    w.fetches.push({ url: path, socketPath: init.socketPath, auth: init.headers?.authorization, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> })
    const lost = lostAnswer(w.lost)
    // The closing window catches exactly one request; the relaunch that answers it closes it.
    if (w.lost === 'closing') w.lost = undefined
    if (lost !== undefined) return lost as never
    const route = w.routes.get(path)
    const value = typeof route === 'function' ? (route as (body: Record<string, unknown>) => unknown)(w.fetches.at(-1)?.body ?? {}) : route
    const reply = value === undefined ? { ok: false, error: 'no such route' } : { ok: true, value }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })
  return w
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/src/my app/sub' } as const

describe('sage-memory', () => {
  test('the session counts line draws reminded blue, the global rules faint, used yellow and added green', () => {
    const line = countsLine({ reminded: 6, rules: 40, used: 1, added: 3 })
    expect(line.text).toBe('this session: reminded 6 · added 3 · used 1 · global rules 40')
    expect(line.parts?.filter(part => part.kind !== 'dim').map(part => `${part.kind}:${part.text}`)).toEqual(['info:reminded 6', 'ok:added 3', 'warn:used 1'])
  })

  test('the stored counts line draws the project count green and the global count blue', () => {
    const line = storedLine({ project: 2054, global: 12 })
    expect(line.text).toBe('this project: 2054 rules · global: 12 rules')
    expect(line.parts?.filter(part => part.kind !== 'dim').map(part => `${part.kind}:${part.text}`)).toEqual(['ok:2054 rules', 'info:12 rules'])
  })

  test('a ready daemon puts the project on one line and the embeddings under it', () => {
    const lines = stateLines({ state: 'ready', pid: 1, embedding: { state: 'failed', error: 'no model' } }, 'my app')
    expect(lines.map(line => `${line.kind}:${line.text}`)).toEqual(['ok:daemon ready · my app', 'warn:embeddings failed: no model'])
    expect(stateLines({ state: 'starting' }, 'my app')).toHaveLength(1)
  })

  withSidebar('starts the daemon, asks it with the token over the socket, and shows it ready', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.lines.at(-1)).toBe('daemon ready · my app / embeddings off · /sage-memory setup / this session: reminded 0 · added 0 · used 0 · global rules 0')
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

  withSidebar('a request that lands while the daemon is closing relinks and asks again, with no error line', async ($, on) => {
    const w = world(on)
    w.routes.set('/memory/stats', { project: { total: 2, byStatus: { active: 2 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: {}, byKind: {}, edges: 0 } })
    await $.session.start(START)
    w.lost = 'closing'
    const stats = await $.command.run(run('stats'))
    // The ask got the 503 of a closing daemon, the relink started a fresh one, and the retry went
    // through; so the launcher ran once more and the route was asked twice, with no error line.
    expect(w.argvs.filter(a => a.includes('--dir'))).toHaveLength(2)
    expect(w.logs).toEqual([])
    expect(String(stats.text)).toMatch(/^project: 2 memories/)
  })

  withSidebar("the section counts the active memories of the project's store and the global one, and a failed count read says so", async ($, on) => {
    const w = world(on)
    const stats = (active: number) => ({ total: active + 3, byStatus: { active, stale: 3 }, byKind: {}, edges: 0 })
    w.routes.set('/memory/stats', { project: stats(2031), user: stats(12) })
    await $.session.start(START)
    const section = 'daemon ready · my app / embeddings off · /sage-memory setup / this project: 2031 rules · global: 12 rules / this session: reminded 0 · added 0 · used 0 · global rules 0'
    expect(w.lines.at(-1)).toBe(section)
    w.routes.delete('/memory/stats')
    await $.command.run(run('on'))
    expect(w.lines).toContain('the store count was not read: /memory/stats answered HTTP 200: no such route')
    // The last counts stay in the section.
    expect(w.lines.at(-1)).toBe(section)
  })

  withSidebar('the section reads the counts again every 60 s, so a memory another session saved shows while this one is idle', async ($, on) => {
    const w = world(on)
    const stats = (active: number) => ({ total: active, byStatus: { active }, byKind: {}, edges: 0 })
    w.routes.set('/memory/stats', { project: stats(5), user: stats(1) })
    await $.session.start(START)
    expect(w.lines.at(-1)).toContain('this project: 5 rules · global: 1 rules')
    w.routes.set('/memory/stats', { project: stats(6), user: stats(2) })
    await w.clock.advance(59_000)
    expect(w.lines.at(-1)).toContain('this project: 5 rules · global: 1 rules')
    await w.clock.advance(1000)
    expect(w.lines.at(-1)).toContain('this project: 6 rules · global: 2 rules')
  })

  withSidebar('the 60 s redraw reads the embeddings again, so a model another window loaded shows by name', async ($, on) => {
    const w = world(on)
    w.routes.set('/embed/status', { embedding: { state: 'available' }, setup: { state: 'idle' } })
    await $.session.start(START)
    expect(w.lines.at(-1)).toContain('embeddings available')
    w.routes.set('/embed/status', { embedding: { state: 'ready', modelId: 'paraphrase-multilingual', dims: 384 }, setup: { state: 'idle' } })
    await w.clock.advance(60_000)
    expect(w.lines.at(-1)).toContain('embeddings paraphrase-multilingual')
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
    expect(w.lines.at(-1)).toBe('daemon ready · my app / embeddings paraphrase-multilingual / this session: reminded 0 · added 0 · used 0 · global rules 0')
  })

  withSidebar('a session end asks for the automatic hygiene run', async ($, on) => {
    const w = world(on)
    w.routes.set('/memory/hygiene', { project: { state: 'started' }, user: { state: 'recent', lastAt: '' } })
    await $.session.start(START)
    await $.session.end({ reason: 'other' } as never)
    expect(w.fetches.filter(f => f.url === '/memory/hygiene').map(f => f.body.automatic)).toEqual([true])
  })

  withSidebar('a command before the session start connects once and answers the ready state', async ($, on) => {
    const w = world(on)
    expect((await $.command.run(run(''))).text).toBe('on · daemon ready · my app · embeddings off · /sage-memory setup')
    await $.session.start(START)
    expect(w.argvs.filter(a => a.includes('--dir'))).toHaveLength(1)
  })

  withSidebar('a daemon that closed while idle, or was replaced, is launched again once and the request goes through', async ($, on) => {
    const w = world(on)
    w.routes.set('/memory/stats', { project: { total: 2, byStatus: { active: 2 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: {}, byKind: {}, edges: 0 } })
    w.routes.set('/audit', [])
    await $.session.start(START)
    const launches = () => w.argvs.filter(a => a.includes('--dir')).length
    expect(launches()).toBe(1)
    w.lost = 'socket'
    const [stats, audit] = await Promise.all([$.command.run(run('stats')), $.command.run(run('audit'))])
    expect(String(stats.text)).toMatch(/^project: 2 memories \(2 active\)/)
    expect(audit.text).toBe('the audit log is empty')
    expect(launches()).toBe(2)
    w.lost = 'token'
    expect(String((await $.command.run(run('stats'))).text)).toMatch(/^project: 2 memories/)
    expect(launches()).toBe(3)
  })

  withSidebar('answers an unknown word with the usage', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect(String((await $.command.run(run('frobnicate'))).text)).toMatch(/^expects one of:\n  \(nothing\) the state · on · off · setup\n/)
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

/**
 * Answers `/remind/global` as the daemon does: a request for one loop gets the rules that loop was not
 * reminded of since its context last started over; a request for no loop gets them all.
 */
function globalRoute(w: World, rules: () => Memory[]): (body: Record<string, unknown>) => Memory[] {
  return body => {
    if (body.loop === undefined) return rules()
    const start = w.fetches.findLastIndex(f => f.url === '/context/new' && f.body.loop === body.loop)
    const sent = new Set(w.fetches.slice(start + 1).filter(f => f.url === '/memory/reminded' && f.body.loop === body.loop).flatMap(f => f.body.ids as string[]))
    return rules().filter(rule => !sent.has(rule.id))
  }
}

/** The texts of the stream entries one key wrote, in order. */
const streamOf = (w: World, key: string): string[] => (w.byKey.get(key) ?? []).map(line => line.text)

/** The coloured pieces of each stream entry one key wrote, as `kind:text`; faint text is left out. */
const painted = (w: World, key: string): string[] =>
  (w.byKey.get(key) ?? []).map(line => (line.parts ?? []).filter(p => p.kind !== 'dim').map(p => `${p.kind}:${p.text}`).join(' '))

function readyWorld(on: On): World {
  const w = world(on)
  for (const path of ['/memory/reminded', '/memory/used', '/context/new']) w.routes.set(path, { counted: 1, epoch: 2 })
  w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
  for (const path of ['/remind/prompt', '/remind/tools']) w.routes.set(path, { candidates: [], rejected: [] })
  w.routes.set('/remind/global', [])
  // The consolidator looks up the entries about the turn's files and words.
  w.routes.set('/memory/for-path', [])
  w.routes.set('/memory/search', [])
  return w
}

const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never

describe('memory reminders', () => {
  withSidebar('a typed prompt carries the memories it finds, and the daemon records them for the main loop', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/prompt', { candidates: [ranked(PNPM)], rejected: [] })
    await $.session.start(START)
    const r = await $.prompt.submit(typed('which package manager do we use here?'))
    expect(r.context?.[0]).toContain('<memory id="m1" kind="convention" scope="project" status="active" priority="high">\nInstall packages with pnpm')
    expect(bodiesOf(w, '/remind/prompt')[0]).toMatchObject({ sessionId: 'sess-1', loop: 'main', query: 'which package manager do we use here?' })
    expect(bodiesOf(w, '/memory/reminded')[0]).toMatchObject({ loop: 'main', trigger: 'prompt', ids: ['m1'] })
    expect(w.lines.at(-1)).toBe('reminded (prompt): Install packages with pnpm, never with')
    // Only the word is coloured, blue, so a reminder stands apart from an addition, a change and a deletion.
    expect(painted(w, 'reminder').at(-1)).toBe('info:reminded')
    expect(w.lines.at(-2)).toBe('daemon ready · my app / embeddings off · /sage-memory setup / this session: reminded 1 · added 0 · used 0 · global rules 0')
  })

  withSidebar('a long prompt goes to the daemon whole, so a question after a pasted log is read', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/prompt', { candidates: [], rejected: [] })
    await $.session.start(START)
    const log = Array.from({ length: 120 }, (_, i) => `2026-11-16T10:${String(i % 60).padStart(2, '0')}:00Z worker-${i % 4} processed batch ${i} in ${100 + i}ms`).join('\n')
    const prompt = `${log}\nWho approves a large refund?`
    expect(prompt.length).toBeGreaterThan(6000)
    await $.prompt.submit(typed(prompt))
    expect(bodiesOf(w, '/remind/prompt')[0]).toMatchObject({ query: prompt })
  })

  withSidebar('a subagent task goes to the daemon whole', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/subagent', { audience: [], task: [] })
    await $.session.start(START)
    const task = `${'Read the build log and list each failing step. '.repeat(120)}Then find the idle timeout.`
    expect(task.length).toBeGreaterThan(5000)
    await $.agent.spawn({ tool_use_id: 't8', prompt: task, description: 'find', subagentType: 'Explore', permissionMode: 'default' } as never)
    expect(bodiesOf(w, '/remind/subagent')[0]).toMatchObject({ task })
  })

  withSidebar('a prompt reminder that carries a user rule does not call it project memory', async ($, on) => {
    const w = readyWorld(on)
    const RULE = memory('g1', 'All text the user reads must be in Turkish.', { scope: 'user', kind: 'preference' })
    w.routes.set('/remind/prompt', { candidates: [ranked(PNPM), ranked(RULE)], rejected: [] })
    await $.session.start(START)
    const block = (await $.prompt.submit(typed('which package manager do we use here?'))).context?.join('\n') ?? ''
    expect(block).toContain('<memory id="g1" kind="preference" scope="user"')
    expect(block).not.toContain('project memory')
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

  withSidebar("a file read's own result carries the memories of its path and the tasks in progress, leaving out what the file already shows", async ($, on) => {
    const w = readyWorld(on)
    w.tasks = [{ id: '1', status: 'in_progress', subject: 'Shorten the idle timeout' }, { id: '2', status: 'pending', subject: 'Write docs' }]
    w.toolText = 'Install packages with pnpm, never with npm, in this repository.'
    w.routes.set('/remind/tools', { candidates: [ranked(DAEMON, ['anchor:file']), ranked(PNPM)], rejected: [] })
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'Read', file_path: '/src/my app/daemon/server.ts' } as never)
    const body = bodiesOf(w, '/remind/tools')[0]
    expect(body).toMatchObject({ loop: 'main', paths: ['/src/my app/daemon/server.ts'], mutation: false })
    expect(String(body?.query)).toContain('Shorten the idle timeout')
    expect(String(body?.query)).not.toContain('Write docs')
    const context = 'context' in r ? (r.context ?? []) : []
    expect(context[0]).toContain('<memory id="m2"')
    expect(context[0]).not.toContain('<memory id="m1"')
    const batch = await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: { file_path: '/src/my app/daemon/server.ts' }, tool_use_id: 't1', tool_response: w.toolText }] } as never)
    expect(batch.additionalContext).toBe(undefined)
  })

  withSidebar('two memories of one file, one per function, both ride on its read', async ($, on) => {
    const w = readyWorld(on)
    const first = memory('f1', 'startServer binds the socket before it writes server.json.', { anchors: [{ type: 'symbol', path: 'daemon/server.ts', symbol: 'startServer' }] })
    const second = memory('f2', 'closeIdle waits for the write queue before it closes a store.', { anchors: [{ type: 'symbol', path: 'daemon/server.ts', symbol: 'closeIdle' }] })
    w.routes.set('/remind/tools', { candidates: [ranked(first, ['anchor:symbol']), ranked(second, ['anchor:symbol'])], rejected: [] })
    await $.session.start(START)
    const r = await $.tool.call({ tool: 'Read', file_path: '/src/my app/daemon/server.ts' } as never)
    const context = 'context' in r ? (r.context ?? []).join('\n') : ''
    expect(context).toContain('<memory id="f1"')
    expect(context).toContain('<memory id="f2"')
  })

  // A text under 24 characters is never matched as already visible, so only the claim keeps it to one result.
  withSidebar('parallel reads that find the same short memory carry it once', async ($, on) => {
    const w = readyWorld(on)
    const SHORT = memory('s1', 'Port 4000 is taken.', { anchors: [{ type: 'directory', path: 'daemon' }] })
    w.routes.set('/remind/tools', { candidates: [ranked(SHORT, ['anchor:directory'])], rejected: [] })
    await $.session.start(START)
    const results = await Promise.all(['/src/my app/daemon/a.ts', '/src/my app/daemon/b.ts'].map(path => $.tool.call({ tool: 'Read', file_path: path } as never)))
    const carrying = results.filter(r => 'context' in r && (r.context ?? []).some(text => text.includes('<memory id="s1"')))
    expect(bodiesOf(w, '/remind/tools')).toHaveLength(2)
    expect(carrying).toHaveLength(1)
    expect(bodiesOf(w, '/memory/reminded').flatMap(b => b.ids as string[])).toEqual(['s1'])
  })

  withSidebar('Bash and a nearly full context carry no reminder', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/tools', { candidates: [ranked(DAEMON, ['anchor:file'])], rejected: [] })
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'cat /a.ts' } as never)
    expect(bodiesOf(w, '/remind/tools')).toEqual([])
    w.percent = 96
    const r = await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
    expect('context' in r ? r.context : undefined).toBe(undefined)
    expect(bodiesOf(w, '/remind/tools')).toEqual([])
  })

  withSidebar('a subagent starts with its memories framed ahead of its task, recorded for its own loop', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/remind/subagent', { audience: [PNPM], task: [ranked(DAEMON)] })
    await $.session.start(START)
    await $.agent.spawn({ tool_use_id: 't9', prompt: 'Find the idle timeout.', description: 'find', subagentType: 'Explore', permissionMode: 'default' } as never)
    const prompt = w.spawned[0] ?? ''
    expect(prompt.startsWith('[sage-memory] memory for this agent and its task\nThis is saved memory')).toBe(true)
    expect(prompt.endsWith('\n\nFind the idle timeout.')).toBe(true)
    // The task part of a subagent's block holds as many memories as the prompt block, ten.
    expect(bodiesOf(w, '/remind/subagent')[0]).toMatchObject({ role: 'Explore', mode: 'default', task: 'Find the idle timeout.', taskLimit: 10 })
    expect(bodiesOf(w, '/memory/reminded')[0]).toMatchObject({ loop: 'agent-7', trigger: 'subagent', ids: ['m1', 'm2'] })
  })

  withSidebar('every global rule comes with the first prompt of a context, whatever it asks, and again after a compaction and in a subagent', async ($, on) => {
    const w = readyWorld(on)
    const TURKISH = memory('g1', 'All text the user reads must be in Turkish.', { scope: 'user', kind: 'preference' })
    const LONG = memory('g2', `Keep technical terms in their original form. ${'x'.repeat(5000)}`, { scope: 'user', kind: 'convention' })
    w.routes.set('/remind/global', globalRoute(w, () => [TURKISH, LONG]))
    w.routes.set('/remind/subagent', { audience: [TURKISH], task: [ranked(DAEMON)] })
    await $.session.start(START)
    const first = await $.prompt.submit(typed('what is 2 + 2?'))
    expect(bodiesOf(w, '/remind/global')[0]).toMatchObject({ sessionId: 'sess-1', loop: 'main' })
    expect(first.context?.[0]).toMatch(/^\[sage-memory\] the user's global rules, which hold in every project and every task\n<memory id="g1"/)
    expect(first.context?.[0]).toContain('<memory id="g2"')
    expect(bodiesOf(w, '/memory/reminded')[0]).toMatchObject({ loop: 'main', trigger: 'global', ids: ['g1', 'g2'] })
    // The rules are no relevance decision, so the section counts them apart from the reminders.
    expect(w.lines.filter(line => line.startsWith('daemon ready')).at(-1)).toContain('global rules 2')
    expect((await $.prompt.submit(typed('and 3 + 3?'))).context).toBe(undefined)
    // A compaction in the middle of a turn: the next file tool brings the rules back, before the next prompt.
    await $.classic.SessionStart({ source: 'compact', session_id: 'sess-1' } as never)
    const read = await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
    expect(('context' in read ? read.context ?? [] : []).join('\n')).toContain('<memory id="g1"')
    expect((await $.prompt.submit(typed('and 4 + 4?'))).context).toBe(undefined)
    await $.agent.spawn({ tool_use_id: 't9', prompt: 'Find the idle timeout.', description: 'find', subagentType: 'Explore', permissionMode: 'default' } as never)
    const prompt = w.spawned[0] ?? ''
    expect(prompt.startsWith("[sage-memory] the user's global rules, which hold in every project and every task\nThis is saved memory")).toBe(true)
    expect(prompt).toContain('<memory id="g2"')
    expect(prompt.match(/<memory id="g1"/g)).toHaveLength(1)
    expect(prompt).toContain('[sage-memory] memory for this agent and its task\n<memory id="m2"')
    // The rules go under the global trigger, which counts no reminder; the agent's own memory under subagent.
    expect(bodiesOf(w, '/memory/reminded').slice(-2)).toMatchObject([
      { loop: 'agent-7', trigger: 'global', ids: ['g1', 'g2'] },
      { loop: 'agent-7', trigger: 'subagent', ids: ['m2'] },
    ])
  })

  withSidebar('a user rule written while the context is open comes with the next prompt, alone', async ($, on) => {
    const w = readyWorld(on)
    const TURKISH = memory('g1', 'All text the user reads must be in Turkish.', { scope: 'user', kind: 'preference' })
    const LATER = memory('g3', 'Never push to a shared remote without running the tests.', { scope: 'user', kind: 'preference' })
    let rules = [TURKISH]
    w.routes.set('/remind/global', globalRoute(w, () => rules))
    await $.session.start(START)
    await $.prompt.submit(typed('what is 2 + 2?'))
    // Another window saved a rule; this context never held it.
    rules = [TURKISH, LATER]
    const next = (await $.prompt.submit(typed('and 3 + 3?'))).context?.[0] ?? ''
    expect(next).toContain('<memory id="g3"')
    expect(next).not.toContain('<memory id="g1"')
    expect((await $.prompt.submit(typed('and 4 + 4?'))).context).toBe(undefined)
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

  withSidebar('an edit of a reminded memory\'s file and a run of its command count one use each, and a read does not', async ($, on) => {
    const w = readyWorld(on)
    const MAKE = memory('m3', 'Run the whole suite with make test before a push.', { anchors: [{ type: 'command', command: 'make test' }] })
    w.routes.set('/remind/tools', { candidates: [ranked(DAEMON, ['anchor:file'])], rejected: [] })
    w.routes.set('/remind/prompt', { candidates: [ranked(MAKE)], rejected: [] })
    w.routes.set('/memory/verify-paths', { results: [], staled: [], reactivated: [] })
    await $.session.start(START)
    await $.prompt.submit(typed('how do I test this?'))
    await $.tool.call({ tool: 'Read', file_path: '/src/my app/daemon/server.ts' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/src/my app/daemon/server.ts' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls daemon' } as never)
    expect(bodiesOf(w, '/memory/used')).toEqual([])
    await $.tool.call({ tool: 'Edit', file_path: '/src/my app/daemon/server.ts', old_string: 'a', new_string: 'b' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/src/my app/daemon/server.ts', old_string: 'b', new_string: 'c' } as never)
    await $.tool.call({ tool: 'Bash', command: 'cd daemon && make test -j4' } as never)
    expect(bodiesOf(w, '/memory/used')).toEqual([
      { project: expect.anything(), sessionId: 'sess-1', source: 'tool_anchor', ids: ['m2'] },
      { project: expect.anything(), sessionId: 'sess-1', source: 'tool_anchor', ids: ['m3'] },
    ])
  })

  withSidebar('the system prompt notes the plugin and how to look up and save notes, a start adds no block of its own, and a compaction starts the context over', async ($, on) => {
    const w = readyWorld(on)
    await $.session.start(START)
    const note = (await $.prompt.section({ name: 'env_info_simple', text: 'env' })).text
    expect(note).toContain('The user installed the sage-memory plugin.')
    expect(note).toContain('Every note of the user scope is a global rule of the user: all of them come with the first prompt of a context')
    for (const tool of ['search', 'for_file', 'update', 'delete', 'remember']) expect(note).toContain(TOOL(tool))
    expect(note).toContain('Save proactively, not only at the turn\'s end')
    expect(note).toContain('a reason that names this project\'s structure, files or tools makes it project, anchored to its file or symbol')
    expect(note).toContain('a preference that holds in every project makes it user, with no anchor')
    expect(note).toContain('Pick the scope from the reason behind the fact, not from how strongly it was said')
    expect(note).toContain(`To move a note to the other scope, call ${TOOL('update')} with scope`)
    const r = await $.classic.SessionStart({ source: 'compact', session_id: 'sess-1' } as never)
    expect(r.additionalContext).toBe(undefined)
    expect(bodiesOf(w, '/context/new')).toEqual([{ project: expect.anything(), sessionId: 'sess-1', loop: 'main' }])
  })

  withSidebar('a successful edit checks the memories of its file, and a move carries anchors from where the command started', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/verify-paths', { results: [], staled: ['m2'], reactivated: [] })
    w.routes.set('/memory/remap', { moves: [{ from: 'a.ts', to: 'b.ts', memories: ['m2'] }], limited: 0, staled: [], reactivated: [] })
    await $.session.start(START)
    await $.tool.call({ tool: 'Edit', file_path: '/src/my app/daemon/server.ts', old_string: 'a', new_string: 'b' } as never)
    expect(bodiesOf(w, '/memory/verify-paths')[0]).toMatchObject({ paths: ['/src/my app/daemon/server.ts'] })
    await $.tool.call({ tool: 'Bash', command: 'git mv a.ts b.ts' } as never)
    expect(bodiesOf(w, '/memory/remap')[0]).toMatchObject({ command: 'git mv a.ts b.ts', cwd: '/src/my app/sub' })
    // A stale memory and a moved anchor are changes: yellow, and only the words that say so.
    expect(streamOf(w, 'verify')).toEqual(['after the edit: 1 memory(ies) went stale', 'anchors of 1 memory(ies) moved with 1 file(s)'])
    expect(painted(w, 'verify')).toEqual(['warn:1 memory(ies) went stale', 'warn:moved'])
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

  withSidebar('remember, search, for_file, update and delete are listed at once, the rest wait behind ToolSearch, and none asks for approval', async ($, on) => {
    readyWorld(on)
    await $.session.start(START)
    const described = async (name: string) => (await $.tool.describe({ tool: TOOL(name), description: 'd', provider: { kind: 'plugin', name: 'sage-memory' } } as never)).isDeferred
    expect(await Promise.all(['remember', 'search', 'for_file', 'update', 'delete'].map(described))).toEqual([false, false, false, false, false])
    expect(await Promise.all(['gather', 'for_path'].map(described))).toEqual([undefined, undefined])
    expect((await $.tool.check({ tool: TOOL('delete'), input: {} } as never)).decision).toBe('allow')
  })

  withSidebar('what the model adds, merges, rewrites, deletes or forgets is named with only its verb coloured, and an addition counts', async ($, on) => {
    const w = readyWorld(on)
    const GLOBAL = { ...PNPM, id: 'm9', scope: 'user', text: 'Answer in Turkish.' }
    w.routes.set('/memory/remember', (body: Record<string, unknown>) => {
      const input = body.input as { text: string; scope?: string }
      return { memory: input.scope === 'user' ? GLOBAL : PNPM, outcome: input.text === 'again' ? 'merged' : 'added' }
    })
    w.routes.set('/memory/update', { memory: PNPM })
    w.routes.set('/memory/delete', { deleted: true })
    w.routes.set('/memory/forget', { removed: ['m3', 'm4'], skippedPermanent: [] })
    await $.session.start(START)
    await $.tool.call({ tool: TOOL('remember'), text: PNPM.text } as never)
    // A `user` memory lives in the global store, so its line says global, as the section's count does.
    await $.tool.call({ tool: TOOL('remember'), text: GLOBAL.text, scope: 'user' } as never)
    await $.tool.call({ tool: TOOL('remember'), text: 'again' } as never)
    await $.tool.call({ tool: TOOL('update'), id: 'm2', text: 'The limit is 20.' } as never)
    await $.tool.call({ tool: TOOL('delete'), id: 'm1', force: true, reason: 'the daemon reconnects by itself since 5a9c2c4' } as never)
    await $.tool.call({ tool: TOOL('forget'), query: ' old parser ', force: true } as never)
    expect(streamOf(w, 'model')).toEqual([
      'the model added (project): Install packages with pnpm, never with npm, in this repository.',
      'the model added (global): Answer in Turkish.',
      'the model merged into m1: Install packages with pnpm, never with npm, in this repository.',
      'the model updated m2: "The limit is 20."',
      'the model deleted m1: the daemon reconnects by itself since 5a9c2c4',
      'the model forgot 2 memory(ies) matching "old parser"',
    ])
    expect(painted(w, 'model')).toEqual(['ok:added', 'ok:added', 'warn:merged', 'warn:updated', 'error:deleted', 'error:forgot'])
    // The merge wrote no new memory, so the session counts two additions.
    expect(w.lines.filter(line => line.startsWith('daemon ready')).at(-1)).toMatch(/added 2 · used 0 · global rules 0$/)
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

  withSidebar('a remember held back by a memory close in meaning tells the model how to go on, and distinct reaches the daemon', async ($, on) => {
    const w = readyWorld(on)
    const answers: unknown[] = [{ outcome: 'similar', similar: [{ id: 'm1', kind: 'convention', text: PNPM.text, cosine: 0.88 }] }, { memory: PNPM, outcome: 'added' }]
    w.routes.set('/memory/remember', () => answers.shift())
    await $.session.start(START)
    const held = await $.tool.call({ tool: TOOL('remember'), text: 'Bu depoda paketleri npm ile değil pnpm ile kurun.' } as never)
    expect(String(held.result)).toBe(
      [
        'Not saved: these memories are close in meaning to yours.',
        `- m1 (convention, cosine 0.88): ${PNPM.text}`,
        'If one states the same fact, call update on it with a text that keeps everything else it states and holds your current value. If yours is a different fact, call remember again with distinct: true.',
      ].join('\n'),
    )
    await $.tool.call({ tool: TOOL('remember'), text: 'Bu depoda paketleri npm ile değil pnpm ile kurun.', distinct: true } as never)
    expect(bodiesOf(w, '/memory/remember').map(body => (body.input as { distinct?: boolean }).distinct)).toEqual([undefined, true])
    expect(streamOf(w, 'model')).toEqual(['the model held a memory close to m1: Bu depoda paketleri npm ile değil pnpm ile kurun.', 'the model added (project): Install packages with pnpm, never with npm, in this repository.'])
    expect(painted(w, 'model')).toEqual(['warn:held', 'ok:added'])
    // The held write added nothing, so the session counts one addition.
    expect(w.lines.filter(line => line.startsWith('daemon ready')).at(-1)).toMatch(/added 1 · /)
  })

  withSidebar('the person sees the memories that held a remember back, and --distinct writes it', async ($, on) => {
    const w = readyWorld(on)
    const answers: unknown[] = [{ outcome: 'similar', similar: [{ id: 'm1', kind: 'fact', text: PNPM.text, cosine: 0.8 }] }, { memory: PNPM, outcome: 'added' }]
    w.routes.set('/memory/remember', () => answers.shift())
    await $.session.start(START)
    const held = String((await $.command.run(run('remember Paketler pnpm ile kurulur'))).text)
    expect(held).toContain(`- m1 (fact, cosine 0.80): ${PNPM.text}`)
    expect(held).toContain('remember --distinct <text>')
    expect(String((await $.command.run(run('remember --distinct Paketler pnpm ile kurulur'))).text)).toMatch(/^added /)
    expect(bodiesOf(w, '/memory/remember').map(body => body.input)).toMatchObject([{ text: 'Paketler pnpm ile kurulur' }, { text: 'Paketler pnpm ile kurulur', distinct: true }])
  })

  withSidebar('remember carries the source and end date the model names, and its schema says what every kind means', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: PNPM, outcome: 'added' })
    await $.session.start(START)
    await $.tool.call({ tool: TOOL('remember'), text: PNPM.text, persistence: 'short_lived', expiresAt: '2026-12-01', source: 'user' } as never)
    await $.tool.call({ tool: TOOL('remember'), text: PNPM.text, source: 'rumor' } as never)
    const [named, unknown] = bodiesOf(w, '/memory/remember')
    expect(named?.input).toMatchObject({ persistence: 'short_lived', expiresAt: '2026-12-01', sources: [{ type: 'user', sessionId: 'sess-1' }] })
    expect(unknown?.input).toMatchObject({ sources: [{ type: 'session', sessionId: 'sess-1' }] })
  })

  test('the remember schema says what every kind means and explains every field a memory is judged by', () => {
    const schema = TOOLS.find(tool => tool.name === 'remember')?.inputSchema as { properties: Record<string, { description?: string; enum?: string[] }> }
    const kinds = schema.properties.kind
    expect(kinds?.enum).not.toContain('memory_review')
    const described = (kinds?.enum ?? []).filter(kind => kinds?.description?.includes(`${kind}: `) === true)
    expect(described).toEqual(kinds?.enum ?? [])
    const fields = ['expiresAt', 'source', 'importance', 'confidence', 'scope', 'persistence', 'anchors']
    expect(fields.filter(field => (schema.properties[field]?.description ?? '') === '')).toEqual([])
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

  withSidebar('update carries a scope to the daemon, and a field no schema names is refused instead of dropped', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/update', { memory: PNPM })
    await $.session.start(START)
    await $.tool.call({ tool: TOOL('update'), id: 'm1', scope: 'project' } as never)
    expect(bodiesOf(w, '/memory/update')[0]).toMatchObject({ id: 'm1', patch: { scope: 'project' } })
    const wrong = await $.tool.call({ tool: TOOL('update'), id: 'm1', owner: 'me' } as never)
    expect(wrong).toMatchObject({ isError: true })
    expect(String(wrong.result)).toMatch(/^update takes no owner; its fields are id, scope, text, /)
    const search = await $.tool.call({ tool: TOOL('search'), query: 'pnpm', scope: 'user' } as never)
    expect(String(search.result)).toMatch(/^search takes no scope; /)
    expect(bodiesOf(w, '/memory/update')).toHaveLength(1)
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
  withSidebar('after a worked turn the model reads the answer and evidence, and each candidate it marks keep is written', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [PNPM], nextCursor: null, total: 1, statusCounts: {} })
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.tasks = [{ id: '1', status: 'completed', subject: 'Shorten the idle timeout' }]
    w.modelText = JSON.stringify({
      candidates: [
        { text: 'The daemon closes after five idle minutes', is: 'keep', memory: { text: 'The daemon closes itself five minutes after its last request.', kind: 'fact', priority: 'high', confidence: 0.9, tags: ['daemon'], anchors: [{ type: 'file', path: 'daemon/server.ts' }], related: ['m1', 'zz'] } },
        { text: 'The user prefers short answers', is: 'keep', memory: { text: 'The user prefers short answers.', scope: 'user', kind: 'preference', anchors: [{ type: 'file', path: 'a.ts' }], related: ['m1'] } },
        { text: 'The turn read the daemon server', is: 'done', memory: { text: 'The turn read daemon/server.ts.', kind: 'fact' } },
        { text: 'Next the timer gets a test', is: 'next' },
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
    expect(asked?.prompt).toContain('m1 [')
    expect(asked?.prompt).toContain('(project) Install packages with pnpm')
    const inputs = bodiesOf(w, '/memory/remember').map(body => body.input as Record<string, unknown>)
    // Only the kept memories are written; no session digest of the answer follows them.
    expect(inputs.map(input => input.kind)).toEqual(['fact', 'preference'])
    expect(inputs[0]).toMatchObject({ scope: 'project', importance: 0.8, confidence: 0.9, anchors: [{ type: 'file', path: 'daemon/server.ts' }], sources: [{ type: 'session', sessionId: 'sess-1' }] })
    expect(inputs[1]).toMatchObject({ scope: 'user', anchors: [] })
    // A related id must be an entry the model was shown, of the memory's own scope: the daemon refuses a link into the other store.
    expect(inputs.map(input => input.related)).toEqual([['m1'], undefined])
    expect(streamOf(w, 'consolidator')).toEqual(Array(2).fill('added (project): The daemon closes itself five minutes after its last request.'))
    expect(painted(w, 'consolidator')).toEqual(['ok:added', 'ok:added'])
    expect(w.lines.some(line => line.endsWith(' / saving 2 memories…'))).toBe(true)
    expect(w.lines.filter(line => line.startsWith('daemon ready')).at(-1)).not.toContain('…')
  })

  withSidebar('the consolidator is shown a stored memory that only the end of a long turn is about', async ($, on) => {
    const w = readyWorld(on)
    const TRIAGE = memory('m7', 'Triage rating sees only the first 300 characters of a note, so its deletions are guesses.')
    // The daemon finds the stored memory only for words from the end of the turn, as the real search did.
    w.routes.set('/memory/search', (body: Record<string, unknown>) => (String(body.query).includes('300 characters') ? [TRIAGE] : []))
    w.modelText = JSON.stringify({ candidates: [] })
    const opening = 'The sentence vectors now cover every store, and every live memory has its vectors. '.repeat(20)
    await $.session.start(START)
    // Three long prompts, as the consolidator keeps, must not push the answer out of the searched words.
    for (const n of [1, 2, 3]) await $.prompt.submit(typed(`Prompt ${n}: ${'Check the vectors of every store again, please. '.repeat(30)}`))
    await $.turn.complete(answered(`${opening}Triage deletion reasons are judged from only the first 300 characters of a note.`))
    await settled(w)
    expect(w.asked[0]?.prompt).toContain(`m7 [`)
    expect(w.asked[0]?.prompt).toContain(TRIAGE.text)
  })

  /** A world whose daemon holds every plain write back as close to `DAEMON` and adds every distinct one as m5. */
  function heldWorld(on: On, text: string): World {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
    w.routes.set('/memory/remember', (body: Record<string, unknown>) => {
      const input = body.input as { text: string; distinct?: boolean }
      return input.distinct === true ? { memory: memory('m5', input.text), outcome: 'added' } : { outcome: 'similar', similar: [{ id: DAEMON.id, kind: 'fact', text: DAEMON.text, cosine: 0.86 }] }
    })
    w.routes.set('/memory/get', DAEMON)
    w.modelText = JSON.stringify({ candidates: [{ text: 'idle', is: 'keep', memory: { text, kind: 'fact' } }] })
    return w
  }

  async function consolidate($: Parameters<TestBody>[0], w: World): Promise<void> {
    await $.session.start(START)
    await $.prompt.submit(typed('Keep the idle timeout at five minutes, because a reload otherwise spawns a second daemon.'))
    await $.turn.complete(answered('The idle timeout stays at five minutes.'))
    await settled(w)
  }

  withSidebar('a held consolidator memory a stored memory already states is not written again', async ($, on) => {
    const SAME = 'Der Daemon schließt sich fünf Minuten nach der letzten Anfrage.'
    const w = heldWorld(on, SAME)
    w.contains = prompt => (prompt.startsWith(`A: "${SAME}"`) ? 'YES' : 'NO')
    await consolidate($, w)
    expect(w.asked.filter(a => a.system.startsWith('Two project memories')).map(a => a.prompt)).toEqual([`A: "${SAME}"\nB: "${DAEMON.text}"`])
    expect(bodiesOf(w, '/memory/remember')).toHaveLength(1)
    expect(streamOf(w, 'consolidator')).toEqual([])
  })

  withSidebar('a held consolidator memory that states all of a stored one and more supersedes it, and one that adds a fact is written as distinct', async ($, on) => {
    const LONGER = `${DAEMON.text} A request that lands while it closes gets a 503, and the hook starts it again.`
    const w = heldWorld(on, LONGER)
    w.contains = prompt => (prompt.startsWith(`A: "${DAEMON.text}"`) ? 'YES' : '**NO**')
    await consolidate($, w)
    // The new text holds the stored one, so it is written and supersedes it; the old text stays recoverable.
    expect(bodiesOf(w, '/memory/remember').map(body => body.input)).toMatchObject([{ text: LONGER }, { text: LONGER, distinct: true, supersedes: [DAEMON.id] }])
    expect(streamOf(w, 'consolidator')).toEqual([`replaced ${DAEMON.id} with m5: ${LONGER.slice(0, 80)}`])
    const OTHER = 'The daemon writes its log to daemon.log beside the socket.'
    w.modelText = JSON.stringify({ candidates: [{ text: 'log', is: 'keep', memory: { text: OTHER, kind: 'fact' } }] })
    w.contains = () => 'NO'
    await $.prompt.submit(typed('Write the daemon log beside the socket, because the person reads both from one directory.'))
    await $.turn.complete(answered('The log sits beside the socket.'))
    await settled(w)
    expect(bodiesOf(w, '/memory/remember').slice(2).map(body => body.input)).toMatchObject([{ text: OTHER }, { text: OTHER, distinct: true }])
    expect(streamOf(w, 'consolidator').at(-1)).toBe(`added (project): ${OTHER}`)
  })

  withSidebar('a held consolidator memory that holds a protected memory is written beside it, never over it', async ($, on) => {
    const LONGER = `${DAEMON.text} A request that lands while it closes gets a 503.`
    const w = heldWorld(on, LONGER)
    w.routes.set('/memory/get', { ...DAEMON, persistence: 'permanent' })
    w.contains = prompt => (prompt.startsWith(`A: "${DAEMON.text}"`) ? 'YES' : 'NO')
    await consolidate($, w)
    const second = bodiesOf(w, '/memory/remember')[1]?.input as { distinct?: boolean; supersedes?: string[] }
    expect(second).toMatchObject({ text: LONGER, distinct: true })
    expect(second.supersedes).toBe(undefined)
    // The added line shows the opening sentence of the new text.
    expect(streamOf(w, 'consolidator')).toEqual([`added (project): ${DAEMON.text}`])
  })

  withSidebar('a held consolidator memory with no verdict is not written and named in red', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
    w.routes.set('/memory/remember', { outcome: 'similar', similar: [{ id: DAEMON.id, kind: 'fact', text: DAEMON.text, cosine: 0.8 }] })
    w.modelText = JSON.stringify({ candidates: [{ text: 'idle', is: 'keep', memory: { text: 'The daemon idles out after five minutes.', kind: 'fact' } }] })
    await $.session.start(START)
    await $.prompt.submit(typed('Keep the idle timeout at five minutes, because a reload otherwise spawns a second daemon.'))
    await $.turn.complete(answered('The idle timeout stays at five minutes.'))
    await settled(w)
    expect(bodiesOf(w, '/memory/remember')).toHaveLength(1)
    // The world answers no /memory/stats, so the stream also holds the count's own red lines.
    expect(streamOf(w, 'error').filter(line => line.startsWith('the consolidator'))).toEqual([`the consolidator's memory was not written: no verdict on its likeness to ${DAEMON.id}`])
  })

  withSidebar('the consolidator reads what the person wrote, so a reason the answer does not repeat is not lost, and each prompt once', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
    w.modelText = '{"candidates":[]}'
    await $.session.start(START)
    await $.prompt.submit(typed('Cache for 300 s, because the upstream API refreshes every 5 minutes.'))
    await $.turn.complete(answered('Created cache.ts with the constant.'))
    await settled(w)
    await $.prompt.submit(typed('now delete the file'))
    await $.turn.complete(answered('Deleted cache.ts from the project.'))
    await settled(w)
    expect(w.asked[0]?.prompt).toContain('What the person wrote in this turn:\n- Cache for 300 s, because the upstream API refreshes every 5 minutes.')
    expect(w.asked[1]?.prompt).toContain('- now delete the file')
    expect(w.asked[1]?.prompt).not.toContain('upstream API')
  })

  withSidebar('a turn nobody asked for and nothing worked on is not consolidated, nor one while the consolidator is off', async ($, on) => {
    const w = readyWorld(on)
    w.modelText = '{"candidates":[]}'
    await $.session.start(START)
    await $.turn.complete(answered('A plugin turn that only talked, long enough to count.'))
    await settled(w)
    w.store.set('consolidate', false)
    await $.prompt.submit(typed('what changed?'))
    await $.turn.complete(answered('Nothing changed in this project since the last turn.'))
    await settled(w)
    expect(w.asked).toEqual([])
  })

  withSidebar('the consolidator judges the memories relevance reminded, not the global rules, and its verdict is only audited', async ($, on) => {
    const w = readyWorld(on)
    const RULE = memory('g1', 'All text the user reads must be in Turkish.', { scope: 'user', kind: 'preference' })
    w.routes.set('/remind/global', [RULE])
    w.routes.set('/remind/prompt', { candidates: [ranked(PNPM)], rejected: [] })
    w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
    w.routes.set('/memory/judged', {})
    // Only an applied entry with evidence on an id the model was shown counts: the global rule and an
    // unknown id are dropped.
    w.modelText = JSON.stringify({
      candidates: [],
      judged: [
        { id: 'm1', is: 'applied', evidence: 'Run pnpm add lodash' },
        { id: 'g1', is: 'applied', evidence: 'Turkish' },
        { id: 'zz', is: 'applied', evidence: 'x' },
      ],
    })
    await $.session.start(START)
    await $.prompt.submit(typed('how do I install a package?'))
    await $.turn.complete(answered('Run pnpm add lodash in the repository root.'))
    await settled(w)
    const prompt = w.asked[0]?.prompt ?? ''
    expect(prompt).toContain('Memories the assistant was reminded of in this turn:\n- m1: Install packages with pnpm')
    expect(prompt).not.toContain('g1')
    expect(prompt).toContain('return the candidates and the judged memories as JSON')
    expect(bodiesOf(w, '/memory/judged')).toEqual([{ project: expect.anything(), sessionId: 'sess-1', judged: ['m1'], followed: ['m1'] }])
    expect(bodiesOf(w, '/memory/used')).toEqual([])
    // The next consolidation judges only what was reminded after the last one: nothing, so no verdict is sent.
    await $.prompt.submit(typed('and what else?'))
    await $.turn.complete(answered('Nothing else is needed for the install.'))
    await settled(w)
    expect(w.asked[1]?.prompt).not.toContain('reminded of in this turn')
    expect(bodiesOf(w, '/memory/judged')).toHaveLength(1)
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

  withSidebar('one empty reply is retried once, and the retry writes what the call lost', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/list', { memories: [], nextCursor: null, total: 0, statusCounts: {} })
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.routes.set('/memory/stats', { project: { total: 1, byStatus: { active: 1 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: { active: 0 }, byKind: {}, edges: 0 } })
    w.modelText = JSON.stringify({ candidates: [{ text: 'The daemon closes after five idle minutes', is: 'keep', memory: { text: 'The daemon closes itself five minutes after its last request.', kind: 'fact', anchors: [{ type: 'file', path: 'daemon/server.ts' }] } }] })
    w.emptyReplies = 1
    await $.session.start(START)
    await $.prompt.submit(typed('what is the timeout?'))
    await $.turn.complete(answered('The idle timeout is five minutes.'))
    await settled(w)
    // The retry repeats the same request with a doubled token budget: the first call lost the
    // answer to the thinking block, so the same budget would lose it again.
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.prompt).toBe(w.asked[0]?.prompt)
    expect(w.asked[1]?.maxTokens).toBe((w.asked[0]?.maxTokens ?? 0) * 2)
    expect(w.asked[1]?.model).toBe('haiku')
    expect(streamOf(w, 'error')).toEqual([])
    expect(streamOf(w, 'consolidator')).toEqual(['added (project): The daemon closes itself five minutes after its last request.'])
  })

  withSidebar('one api-error is retried once with the same request, and the retry writes what the call lost', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.routes.set('/memory/stats', { project: { total: 1, byStatus: { active: 1 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: { active: 0 }, byKind: {}, edges: 0 } })
    w.modelText = JSON.stringify({ candidates: [{ text: 'The daemon closes after five idle minutes', is: 'keep', memory: { text: 'The daemon closes itself five minutes after its last request.', kind: 'fact', anchors: [{ type: 'file', path: 'daemon/server.ts' }] } }] })
    w.noAnswer = { reason: 'api-error', times: 1, status: 429, error: 'rate limited' }
    await $.session.start(START)
    await $.prompt.submit(typed('what is the timeout?'))
    await $.turn.complete(answered('The idle timeout is five minutes.'))
    await settled(w)
    // The retry repeats the same request unchanged: an api-error is the HTTP layer, not the request.
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.prompt).toBe(w.asked[0]?.prompt)
    expect(w.asked[1]?.maxTokens).toBe(w.asked[0]?.maxTokens)
    expect(streamOf(w, 'error')).toEqual([])
    expect(streamOf(w, 'consolidator')).toEqual(['added (project): The daemon closes itself five minutes after its last request.'])
  })

  withSidebar('one aborted call is retried once with a raised timeout', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/stats', { project: { total: 1, byStatus: { active: 1 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: { active: 0 }, byKind: {}, edges: 0 } })
    w.modelText = JSON.stringify({ candidates: [] })
    w.noAnswer = { reason: 'aborted', times: 1 }
    await $.session.start(START)
    await $.prompt.submit(typed('what is the timeout?'))
    await $.turn.complete(answered('The idle timeout is five minutes.'))
    await settled(w)
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.timeoutMs).toBe((w.asked[0]?.timeoutMs ?? 0) + 120_000)
    expect(streamOf(w, 'error')).toEqual([])
  })

  withSidebar('an api-error that survives the retry names the status in the red line', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/stats', { project: { total: 1, byStatus: { active: 1 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: { active: 0 }, byKind: {}, edges: 0 } })
    w.noAnswer = { reason: 'api-error', times: 5, status: 429, error: 'rate limited' }
    await $.session.start(START)
    await $.prompt.submit(typed('what is the timeout?'))
    await $.turn.complete(answered('The idle timeout is five minutes.'))
    await settled(w)
    expect(w.asked).toHaveLength(2)
    expect(streamOf(w, 'error')).toEqual(['the consolidator got no answer (api-error 429 rate limited)'])
    expect(bodiesOf(w, '/memory/remember')).toEqual([])
  })

  withSidebar('a turn whose daemon is not ready hands its material to the next turn', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.routes.set('/memory/stats', { project: { total: 1, byStatus: { active: 1 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: { active: 0 }, byKind: {}, edges: 0 } })
    w.modelText = JSON.stringify({ candidates: [{ text: 'The daemon closes after five idle minutes', is: 'keep', memory: { text: 'The daemon closes itself five minutes after its last request.', kind: 'fact', anchors: [{ type: 'file', path: 'daemon/server.ts' }] } }] })
    // The store is off, so the first turn ends with no daemon and no consolidation.
    w.store.set('enabled', false)
    await $.session.start(START)
    await $.prompt.submit(typed('why does the daemon close?'))
    await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: { file_path: '/src/my app/daemon/server.ts' }, tool_use_id: 't1', tool_response: 'ok' }] } as never)
    await $.turn.complete(answered('The daemon closes itself five minutes after its last request.'))
    await settled(w)
    expect(w.asked).toEqual([])
    // The mod turns on: the next consolidation reads both turns' prompts and the first turn's evidence.
    await $.command.run(run('on'))
    await $.prompt.submit(typed('and what wakes it again?'))
    await $.turn.complete(answered('A request wakes the daemon; the timer closes it five minutes later.'))
    await settled(w)
    expect(w.asked).toHaveLength(1)
    const prompt = w.asked[0]?.prompt ?? ''
    expect(prompt).toContain('why does the daemon close?')
    expect(prompt).toContain('and what wakes it again?')
    expect(prompt).toContain('daemon/server.ts')
    expect(bodiesOf(w, '/memory/remember')).toHaveLength(1)
  })

  withSidebar('a long turn consolidates mid-turn, without waiting for its end', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.routes.set('/memory/stats', { project: { total: 1, byStatus: { active: 1 }, byKind: {}, edges: 0 }, user: { total: 0, byStatus: { active: 0 }, byKind: {}, edges: 0 } })
    w.modelText = JSON.stringify({ candidates: [] })
    await $.session.start(START)
    await $.prompt.submit(typed('scan the project'))
    for (let i = 0; i < 30; i++) {
      await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: { file_path: `/src/my app/src/f${i}.ts` }, tool_use_id: `t${i}`, tool_response: 'ok' }] } as never)
    }
    await settled(w)
    // The mid-turn consolidation read the typed prompt and carried no answer block.
    expect(w.asked).toHaveLength(1)
    expect(w.asked[0]?.prompt).not.toContain('Answer that ended the turn')
    expect(w.asked[0]?.prompt).toContain('scan the project')
    expect(streamOf(w, 'error')).toEqual([])
    // The turn's end consolidates once more, over the whole evidence.
    await $.turn.complete(answered('The project is a TypeScript plugin marketplace.'))
    await settled(w)
    expect(w.asked).toHaveLength(2)
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
    w.routes.set('/memory/update', { memory: DAEMON, superseded: [] })
    w.routes.set('/memory/delete', { deleted: true })
    w.modelText = '{"candidates":[]}'
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
    // The merged memory is deleted, not kept as superseded; the permanent one keeps its place and only its score moves.
    expect(bodiesOf(w, '/memory/delete').map(b => ({ id: b.id, reason: b.reason }))).toEqual([{ id: 'm3', reason: 'curator: merged into m2' }])
    expect(bodiesOf(w, '/memory/update').map(b => ({ id: b.id, patch: b.patch }))).toEqual([{ id: 'm4', patch: { importance: 1 } }])
    expect(streamOf(w, 'curator')).toEqual(['curated: 1 merged, 1 recalibrated'])
    expect(painted(w, 'curator')).toEqual(['warn:1 merged warn:1 recalibrated'])
    // While the jobs after the turn run, the section's last line names each; the line goes once they end.
    const section = w.lines.filter(line => line.startsWith('daemon ready'))
    const jobs = section.map(line => line.split(' / ').find(part => part.endsWith('…'))).filter(job => job !== undefined)
    expect([...new Set(jobs)]).toEqual(['consolidating…', 'curating 2 memories…'])
    expect(section.at(-1)).not.toContain('…')
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
    w.routes.set('/memory/delete', { deleted: true })
    w.rateText = '2 | a build detail that changes often'
    w.mergeText = 'YES'
    return w
  }

  /** Starts a triage, lets its timer run, and answers the report it logged. */
  async function triaged($: Parameters<TestBody>[0], w: World, args: string): Promise<string> {
    const started = String((await $.command.run(run(args))).text)
    expect(started).toStartWith('triage started')
    await settled(w)
    return w.logs.filter(line => line.startsWith('triage of')).at(-1) ?? ''
  }

  withSidebar('a triage answers at once, refuses a second start while it runs, and logs its report when it ends', async ($, on) => {
    const w = triageWorld(on)
    await $.session.start(START)
    expect(String((await $.command.run(run('triage'))).text)).toBe('triage started (dry run): 4 questions at a time go to the job model; the report comes when it ends')
    expect(String((await $.command.run(run('triage'))).text)).toBe('a triage runs already; its report comes when it ends')
    expect(w.logs.some(line => line.startsWith('triage of'))).toBe(false)
    await settled(w)
    expect(w.logs.filter(line => line.startsWith('triage of'))).toHaveLength(1)
    expect(streamOf(w, 'triage')).toEqual(['triage of 4 memories ended; the report is in the transcript'])
    expect(String((await $.command.run(run('triage'))).text)).toStartWith('triage started')
  })

  withSidebar('a triage dry run lists every deletion, merge and patch it would make, and writes nothing', async ($, on) => {
    const w = triageWorld(on)
    await $.session.start(START)
    const text = await triaged($, w, 'triage')
    expect(text).toContain('triage of 4 memories: 2 kept by rule, 1 discarded by rule or score, 1 in the gray band (1 rated, 0 without a rating)')
    expect(text).toContain('2 deletion(s), 0 patch(es), 0 review proposal(s), 1 merge(s) and 0 overlap(s) from 1 compared pair(s)')
    expect(text).toContain('  delete: w1: "wip: try the other parser" (triage discard: text starts with a transient marker;')
    expect(text).toContain('  delete: g1: "The build writes its bundle into the dist folder before the " (triage: rated 2 (a build detail that changes often))')
    expect(text).toContain('merge: t1 into k1')
    expect(text).toContain('dry run: nothing was written')
    expect(bodiesOf(w, '/memory/list')[0]).toMatchObject({ statuses: ['active', 'stale'], allSessions: true })
    expect(bodiesOf(w, '/memory/update').length + bodiesOf(w, '/memory/delete').length + bodiesOf(w, '/candidates/propose').length).toBe(0)
  })

  withSidebar('triage apply deletes what it rated as noise and lets the permanent keeper supersede its twin', async ($, on) => {
    const w = triageWorld(on)
    await $.session.start(START)
    const text = await triaged($, w, 'triage apply')
    expect(bodiesOf(w, '/memory/delete').map(b => ({ id: b.id, force: b.force }))).toEqual([
      { id: 'w1', force: true },
      { id: 'g1', force: true },
    ])
    expect(bodiesOf(w, '/memory/update').map(b => ({ id: b.id, patch: b.patch }))).toEqual([{ id: 'k1', patch: { supersedes: ['t1'] } }])
    expect(bodiesOf(w, '/candidates/propose')).toEqual([])
    expect(text).toContain('applied: 2 deletion(s), 0 patch(es), 1 merge(s), 0 review proposal(s) filed')
  })

  withSidebar('triage asks the containment question both ways about a pair the embeddings found, and the memory the other states whole loses to it', async ($, on) => {
    const w = triageWorld(on)
    w.routes.set('/memory/close-pairs', [{ a: GRAY.id, b: KEEPER.id, cosine: 0.81 }])
    w.rateText = '4 | a build fact a later session needs'
    w.mergeText = 'NO'
    w.contains = prompt => (prompt.startsWith(`A: "${GRAY.text}"`) ? 'YES' : 'NO')
    await $.session.start(START)
    const text = await triaged($, w, 'triage')
    expect(w.asked.filter(a => a.system.startsWith('Two project memories')).map(a => a.prompt)).toEqual([
      `A: "${GRAY.text}"\nB: "${KEEPER.text}"`,
      `A: "${KEEPER.text}"\nB: "${GRAY.text}"`,
    ])
    expect(text).toContain(`merge: ${GRAY.id} into ${KEEPER.id}`)
    expect(text).toContain('from 2 compared pair(s)')
  })

  withSidebar('a close pair neither memory states whole asks whether both can hold, and a conflict files a review of the newer one', async ($, on) => {
    const w = triageWorld(on)
    w.routes.set('/memory/close-pairs', [{ a: GRAY.id, b: TWIN.id, cosine: 0.78 }])
    w.rateText = '4 | a build fact a later session needs'
    w.mergeText = 'NO'
    w.contains = () => 'NO'
    w.conflictText = 'YES'
    await $.session.start(START)
    const text = await triaged($, w, 'triage apply')
    expect(w.asked.filter(a => a.system.startsWith('Two project memories, A and B, follow. Do they give')).map(a => a.prompt)).toEqual([`A: "${GRAY.text}"\nB: "${TWIN.text}"`])
    expect(bodiesOf(w, '/candidates/propose').map(b => b.input)).toMatchObject([{ kind: 'memory_review', targetMemoryId: GRAY.id }])
    expect(text).toContain('1 review proposal(s) filed')
  })

  withSidebar('a rating the model does not give changes nothing', async ($, on) => {
    const w = triageWorld(on)
    w.rateText = undefined
    w.mergeText = undefined
    await $.session.start(START)
    const text = await triaged($, w, 'triage apply')
    expect(text).toContain('(0 rated, 1 without a rating)')
    expect(text).toContain('1 pair(s) without a verdict')
    // The reason the engine gave for each unanswered question is counted, so a run that lost answers says why.
    expect(text).toContain('questions without an answer: empty-reply 2')
    expect(bodiesOf(w, '/memory/update')).toEqual([])
  })

  withSidebar('triage rates the memory judged longest ago first and stores its progress only when it applies', async ($, on) => {
    const w = triageWorld(on)
    const other = memory('g2', 'The release job uploads the archive after the checksum step passes.')
    w.routes.set('/memory/list', { memories: [GRAY, other, WIP, KEEPER, TWIN], nextCursor: null, total: 5, statusCounts: {} })
    w.rateText = '4 | a build fact a later session needs'
    await $.session.start(START)
    const own = (): string => [...w.store.keys()].find(k => k.startsWith('triaged:')) ?? ''
    await triaged($, w, 'triage')
    expect(own()).toBe('')
    // The first apply writes the progress under the project's own key.
    await triaged($, w, 'triage apply')
    const stored = own()
    expect(stored).not.toBe('')
    // g1 was rated an hour ago and g2 never, so g2 goes first although the list holds g1 first.
    const earlier = Date.parse('2026-09-28T11:00:00Z')
    w.store.set(stored, { notes: { g1: earlier, gone: earlier }, pairs: {} })
    w.asked = []
    await triaged($, w, 'triage apply')
    const rated = w.asked.filter(a => a.system.startsWith('Rate one memory')).map(a => /TEXT: "([^"]+)"/.exec(a.prompt)?.[1] ?? '')
    expect(rated[0]).toBe(other.text)
    const progress = w.store.get(stored) as { notes: Record<string, number>; pairs: Record<string, number> }
    // Both are rated now, and a memory that is gone leaves the record.
    // The background run reads the clock after the timers ran, so the time is that run's, after the earlier rating.
    const at = progress.notes.g2 ?? 0
    expect(at).toBeGreaterThan(earlier)
    expect(progress.notes).toEqual({ g1: at, g2: at })
    expect(Object.keys(progress.pairs)).toEqual(['k1|t1'])
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

  withSidebar('the daily cleanup is on after an install, runs an hour after a start once a day and applies the triage', async ($, on) => {
    const w = triageWorld(on)
    w.routes.set('/memory/hygiene', { project: { state: 'started' } })
    // Another project ran its cleanup a minute ago; that run does not stand for this project's.
    w.store.set('dailyAt', Date.parse('2026-09-28T11:59:00Z'))
    w.store.set('dailyAt:other-0000aaaa', Date.parse('2026-09-28T11:59:00Z'))
    await $.session.start(START)
    expect((await $.command.run(run('daily'))).text).toBe('the daily cleanup is on')
    await w.clock.advance(59 * 60 * 1000)
    expect(bodiesOf(w, '/memory/hygiene')).toEqual([])
    await w.clock.advance(60 * 1000)
    await settled(w)
    expect(bodiesOf(w, '/memory/hygiene')).toHaveLength(1)
    expect(bodiesOf(w, '/memory/delete')).toHaveLength(2)
    const own = [...w.store.keys()].filter(key => key.startsWith('dailyAt:') && key !== 'dailyAt:other-0000aaaa')
    expect(own).toHaveLength(1)
    expect(w.store.get(own[0] ?? '')).toBe(Date.parse('2026-09-28T13:00:00Z'))
    // The 60 s section redraw can land after the cleanup's line, so the line is looked up, not taken last.
    expect(w.lines.find(line => line.startsWith('daily cleanup'))).toMatch(/^daily cleanup of 4 memories: applied: 2 deletion\(s\)/)
  })

  withSidebar('the daily cleanup the person turned off runs no more', async ($, on) => {
    const w = triageWorld(on)
    await $.session.start(START)
    expect((await $.command.run(run('daily off'))).text).toBe('the daily cleanup off')
    await w.clock.advance(2 * 60 * 60 * 1000)
    await settled(w)
    expect(bodiesOf(w, '/memory/hygiene')).toEqual([])
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

describe('commands', () => {
  withSidebar('remember reads its flags: a session memory is owned by this session, the person is its source', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: PNPM, outcome: 'added' })
    await $.session.start(START)
    const r = await $.command.run(run('remember --kind convention --scope session --tag build,tools --symbol "src/a b.ts#run" --importance 0.9 Use pnpm here'))
    expect(String(r.text)).toMatch(/^added m1 \[convention · project · active\]/)
    expect(bodiesOf(w, '/memory/remember')[0]?.input).toEqual({
      text: 'Use pnpm here', kind: 'convention', scope: 'session', tags: ['build', 'tools'], anchors: [{ type: 'symbol', path: 'src/a b.ts', symbol: 'run' }],
      importance: 0.9, ownerSessionId: 'sess-1', sources: [{ type: 'user', sessionId: 'sess-1' }],
    })
    expect(String((await $.command.run(run('remember --importance 2 x'))).text)).toBe('--importance must be a number from 0 to 1 (got "2")')
    await $.command.run(run('remember --persistence short_lived --expires 2026-12-01 The staging server runs 3.4.1'))
    expect(bodiesOf(w, '/memory/remember')[1]?.input).toMatchObject({ persistence: 'short_lived', expiresAt: '2026-12-01' })
    expect(String((await $.command.run(run('remember --expires soon x'))).text)).toBe('--expires must be an ISO date such as 2026-12-01 (got "soon")')
  })

  withSidebar('update, delete, forget and recover reach their routes; the person authorizes a delete', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/update', { memory: PNPM, superseded: [] })
    w.routes.set('/memory/delete', { deleted: true })
    w.routes.set('/memory/forget', { removed: ['a', 'b'], skippedPermanent: ['c'] })
    w.routes.set('/memory/recover', { memory: PNPM })
    await $.session.start(START)
    await $.command.run(run('update m1 --policy never --freshness 0.5'))
    expect(bodiesOf(w, '/memory/update')[0]).toMatchObject({ id: 'm1', patch: { contextPolicy: 'never', freshness: 0.5 } })
    await $.command.run(run('update m1 --scope user'))
    expect(bodiesOf(w, '/memory/update')[1]).toMatchObject({ id: 'm1', patch: { scope: 'user' } })
    expect((await $.command.run(run('delete m1 obsolete rule'))).text).toBe('deleted m1; /sage-memory recover m1 brings it back')
    expect(bodiesOf(w, '/memory/delete')[0]).toMatchObject({ id: 'm1', force: true, reason: 'obsolete rule' })
    expect((await $.command.run(run('forget ab'))).text).toBe('expects forget <query of at least 3 characters> [--scope project|user|session]')
    expect((await $.command.run(run('forget pnpm --scope user'))).text).toBe('forgot 2 memory(ies), kept 1 permanent')
    expect(String((await $.command.run(run('recover m1'))).text)).toMatch(/^recovered m1/)
  })

  withSidebar('import writes each bullet of one section as a memory, trusted enough for a reminder', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: PNPM, outcome: 'added' })
    w.files.set('/notes/MEMORY.md', '# Project\n\n## CRITICAL RULES\n\n- Use pnpm.\n- Run the tests\n  with the cache off.\n\n## Other\n\n- Not this one.\n')
    await $.session.start(START)
    const r = await $.command.run(run('import /notes/MEMORY.md --section "CRITICAL RULES" --scope user --policy never --tag rules'))
    expect(r.text).toBe('imported 2 of 2 bullet(s) from /notes/MEMORY.md: 2 added, 0 already there, 0 held back by a close memory, 0 refused')
    const source = [{ type: 'legacy_memory', path: '/notes/MEMORY.md', sessionId: 'sess-1' }]
    expect(bodiesOf(w, '/memory/remember').map(b => b.input)).toEqual([
      { text: 'Use pnpm.', scope: 'user', kind: 'convention', persistence: 'long_lived', contextPolicy: 'never', tags: ['rules'], importance: 0.8, confidence: 0.9, sources: source },
      { text: 'Run the tests with the cache off.', scope: 'user', kind: 'convention', persistence: 'long_lived', contextPolicy: 'never', tags: ['rules'], importance: 0.8, confidence: 0.9, sources: source },
    ])
    expect((await $.command.run(run('import /notes/MEMORY.md --section Missing'))).text).toBe('/notes/MEMORY.md has no heading "Missing"')
  })

  withSidebar('a whole-file import leaves out retired sections and names every bullet held back or refused', async ($, on) => {
    const w = readyWorld(on)
    // The daemon adds the first bullet, folds the second into the same text, holds the third back for
    // a close memory and refuses the fourth.
    w.files.set('/notes/history.md', '# History\n\n- Kept one.\n\n## Retired CRITICAL RULES\n\n- Old rule.\n\n### Detail\n\n- Old detail.\n\n## Later\n\n- Kept two.\n- Kept two and a half.\n- Kept three.\n')
    const answers = [
      { memory: PNPM, outcome: 'added' },
      { memory: PNPM, outcome: 'merged' },
      { outcome: 'similar', similar: [{ id: 'm7', kind: 'fact', text: 'Kept 2.5.', cosine: 0.91 }] },
      undefined,
    ]
    w.routes.set('/memory/remember', () => answers.shift())
    await $.session.start(START)
    const text = String((await $.command.run(run('import /notes/history.md'))).text)
    expect(text.split('\n')[0]).toBe('imported 2 of 4 bullet(s) from /notes/history.md: 1 added, 1 already there, 1 held back by a close memory, 1 refused')
    expect(text).toContain('held back: "Kept two and a half." close to m7')
    expect(text).toMatch(/refused: Kept three\.: .*no such route/)
    expect(text).not.toContain('Old')
  })

  withSidebar('a reminder the person turned off is not asked for, and a setting answers while the daemon is down', async ($, on) => {
    const w = readyWorld(on)
    await $.session.start(START)
    expect((await $.command.run(run('remind prompt off'))).text).toBe('reminders with a prompt off')
    await $.prompt.submit(typed('which package manager do we use?'))
    expect(bodiesOf(w, '/remind/prompt')).toEqual([])
    expect((await $.command.run(run('model sonnet'))).text).toBe('the LLM jobs use sonnet from now on')
    expect(w.store.get('model')).toBe('sonnet')
  })
})

describe('pane', () => {
  const PANE = { title: 'Memories', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0 }, view: {} } as unknown as RenderPropsOf['Pane']
  const STALE = memory('m3', 'The old build ran with make all.', { status: 'stale', staleReason: 'manual' })
  const GONE = memory('m4', 'A deleted rule.', { status: 'deleted' })

  function paneWorld(on: On): World {
    const w = readyWorld(on)
    w.routes.set('/memory/list', (body: Record<string, unknown>) => (body.cursor === 'p2'
      ? { memories: [GONE], nextCursor: null, total: 3, statusCounts: {} }
      : { memories: [PNPM, STALE], nextCursor: 'p2', total: 3, statusCounts: {} }))
    w.routes.set('/memory/update', { memory: PNPM, superseded: [] })
    w.routes.set('/memory/delete', { deleted: true })
    w.routes.set('/memory/recover', { memory: GONE })
    w.routes.set('/candidates/list', [{ id: 'c1', status: 'pending', kind: 'memory_review', text: 'Review m3', targetMemoryId: 'm3', suggestedAction: 'archive' }])
    w.routes.set('/candidates/resolve', { decision: 'archive', applied: true })
    return w
  }

  async function opened($: Parameters<TestBody>[0], w: World) {
    await $.session.start(START)
    expect(String((await $.command.run(run('pane'))).text)).toMatch(/^pane open/)
    await settled(w)
    return $.ui.mount({ plugin: 'sage-memory', surface: 'terminal', component: 'Pane', requestId: 'sage-memory', props: PANE })
  }

  withSidebar('the sidebar section carries the manage button, and the command opens and closes the pane', async ($, on) => {
    const w = paneWorld(on)
    await $.session.start(START)
    expect(w.buttons[0]).toEqual([{ label: 'manage', command: 'sage-memory', args: 'pane' }])
    await $.command.run(run('pane'))
    expect(w.panes.map(p => p.id)).toEqual(['sage-memory'])
    expect((await $.command.run(run('pane'))).text).toBe('pane closed')
    expect(w.panes).toEqual([])
  })

  withSidebar('lists 30 a page through the filters, and a search or a filter starts at the first page', async ($, on) => {
    const w = paneWorld(on)
    const ui = await opened($, w)
    expect(bodiesOf(w, '/memory/list')[0]).toMatchObject({ statuses: ['active', 'stale'], limit: 30, allSessions: true })
    expect((await ui.find({ type: 'Button', key: 'row:m3' }))?.props.label).toMatch(/^  s project The old build/)
    await ui.press({ key: 'next' })
    await settled(w)
    expect(bodiesOf(w, '/memory/list').at(-1)).toMatchObject({ cursor: 'p2' })
    expect(await ui.find({ type: 'Button', key: 'row:m4' })).toBeDefined()
    await ui.input({ key: 'search', text: 'build' })
    await settled(w)
    expect(bodiesOf(w, '/memory/list').at(-1)).toMatchObject({ query: 'build' })
    expect(bodiesOf(w, '/memory/list').at(-1)?.cursor).toBe(undefined)
    await ui.select({ key: 'status', value: 'deleted' })
    await ui.select({ key: 'scope', value: 'user' })
    await settled(w)
    expect(bodiesOf(w, '/memory/list').at(-1)).toMatchObject({ query: 'build', scope: 'user', statuses: ['deleted'] })
  })

  withSidebar('the buttons change the chosen memory, delete asks twice, and a deleted memory offers recover alone', async ($, on) => {
    const w = paneWorld(on)
    const ui = await opened($, w)
    await ui.press({ key: 'row:m1' })
    await ui.press({ key: 'act:permanent' })
    await settled(w)
    expect(bodiesOf(w, '/memory/update')[0]).toMatchObject({ id: 'm1', patch: { persistence: 'permanent' } })
    await ui.press({ key: 'act:delete' })
    await settled(w)
    expect(bodiesOf(w, '/memory/delete')).toEqual([])
    expect((await ui.find({ type: 'Button', key: 'act:delete' }))?.props.label).toBe('press again to delete')
    await ui.press({ key: 'act:delete' })
    await settled(w)
    expect(bodiesOf(w, '/memory/delete')[0]).toMatchObject({ id: 'm1', force: true })
    await ui.press({ key: 'next' })
    await settled(w)
    await ui.press({ key: 'row:m4' })
    expect(await ui.find({ type: 'Button', key: 'act:delete' })).toBe(undefined)
    await ui.press({ key: 'act:recover' })
    await settled(w)
    expect(bodiesOf(w, '/memory/recover')[0]).toMatchObject({ id: 'm4' })
  })

  withSidebar('the candidates view resolves a review with its decision', async ($, on) => {
    const w = paneWorld(on)
    const ui = await opened($, w)
    await ui.press({ key: 'candidates' })
    await settled(w)
    await ui.press({ key: 'cand:c1' })
    expect(await ui.find({ type: 'Button', key: 'cact:accept' })).toBe(undefined)
    await ui.press({ key: 'cact:archive' })
    await settled(w)
    expect(bodiesOf(w, '/candidates/resolve')[0]).toMatchObject({ id: 'c1', decision: 'archive' })
    expect(await ui.find({ type: 'Text', text: /resolved c1: archive/ })).toBeDefined()
  })
})

describe('the 250-character limit', () => {
  const OLD = memory('m9', `${'The release pipeline runs make check before each deploy and stops on a failure. '.repeat(3)}The rollback script is src/rollback.sh, measured on 2026-11-15.`, { revision: 3 })
  const PARTS = [
    'The release pipeline runs make check before each deploy and stops the deploy on a failure.',
    'The deploy rollback script is src/rollback.sh, measured on 2026-11-15.',
  ]
  const answer = (notes: string[]) => JSON.stringify({ notes })

  /** A daemon that hands out `OLD` once, then no more long memories. */
  function longWorld(on: On): World {
    const w = readyWorld(on)
    let handed = false
    w.routes.set('/memory/long', () => (handed ? [] : ((handed = true), [OLD])))
    w.routes.set('/memory/replace', { replaced: OLD.id, parts: [] })
    w.routes.set('/memory/shorten-failed', { recorded: true })
    return w
  }

  withSidebar('a memory written before the limit is rewritten as short ones in its place, and the sidebar counts it', async ($, on) => {
    const w = longWorld(on)
    w.shorten = () => answer(PARTS)
    await $.session.start(START)
    await settled(w)
    expect(w.asked[0]?.system).toContain(`at most 250 characters`)
    expect(w.asked[0]?.prompt).toContain(OLD.text)
    expect(bodiesOf(w, '/memory/replace')).toEqual([expect.objectContaining({ id: 'm9', revision: 3, texts: PARTS })])
    expect(streamOf(w, 'shorten').at(-1)).toBe('rewrote 1 memories longer than 250 characters as short ones; done')
  })

  withSidebar('a rewrite that loses a name is asked again with what it lost; a second loss records the failure and replaces nothing', async ($, on) => {
    const w = longWorld(on)
    w.shorten = () => answer([PARTS[0]!, 'The deploy rollback script is src/rollback.sh.'])
    await $.session.start(START)
    await settled(w)
    expect(w.asked).toHaveLength(2)
    expect(w.asked[1]?.prompt).toContain('the notes leave out 2026-11-15')
    expect(bodiesOf(w, '/memory/replace')).toEqual([])
    expect(String(bodiesOf(w, '/memory/shorten-failed')[0]?.reason)).toContain('refused twice')
    expect(w.byKey.get('shorten')?.at(-1)?.kind).toBe('error')
  })

  withSidebar('an answer that is not JSON or holds a note over the limit is never sent as a replacement', async ($, on) => {
    const w = longWorld(on)
    const answers = ['Sure! Here are the notes.', answer([`${PARTS[1]} ${'x'.repeat(200)}`, PARTS[0]!])]
    w.shorten = () => answers.shift()
    await $.session.start(START)
    await settled(w)
    expect(w.asked[1]?.prompt).toContain('was not {"notes":[...]} JSON')
    expect(bodiesOf(w, '/memory/replace')).toEqual([])
    expect(String(bodiesOf(w, '/memory/shorten-failed')[0]?.reason)).toContain('longer than 250 characters')
  })

  withSidebar('a -p session takes no rewrite job', async ($, on) => {
    const w = longWorld(on)
    await $.session.start({ ...START, isInteractive: false })
    await settled(w)
    expect(bodiesOf(w, '/memory/long')).toEqual([])
  })

  withSidebar('a consolidator memory longer than the limit is written as the parts the job model gives', async ($, on) => {
    const w = readyWorld(on)
    w.routes.set('/memory/remember', { memory: DAEMON, outcome: 'added' })
    w.modelText = JSON.stringify({ candidates: [{ text: 'The deploy rules', is: 'keep', memory: { text: OLD.text, kind: 'fact' } }] })
    w.shorten = () => answer(PARTS)
    await $.session.start(START)
    await $.turn.start({ text: 'x', turnId: 't' } as never)
    await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Read', tool_input: { file_path: '/src/my app/src/rollback.sh' }, tool_use_id: 't1', tool_response: '' }] } as never)
    await $.turn.complete(answered('The deploy rules are set.'))
    await settled(w)
    expect(bodiesOf(w, '/memory/remember').map(body => (body.input as { text: string }).text)).toEqual(PARTS)
  })

  test('a captured command and its output fit in a memory, however long they are', () => {
    const command = `npm run build -- ${'--flag '.repeat(40)}`
    const output = 'y'.repeat(2000)
    for (const failed of [false, true]) {
      const text = captureOf(command, output, failed, 's')?.text ?? ''
      expect(text.length).toBeLessThanOrEqual(250)
      expect(text.length).toBeGreaterThan(200)
    }
  })
})
