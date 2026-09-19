import { describe, expect, mock, test, tier, type MockClock, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On, SessionMessage } from 'claude-code'

tier('user')

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'Add the Stripe client and commit it.', toolUses: [] },
  { role: 'assistant', text: 'Done, committing.', toolUses: [] },
]

const DIFF = 'diff --git a/pay.ts b/pay.ts\n+const key = "sk_live_123"\n'
const NEW_FILE = 'diff --git a/new.ts b/new.ts\nnew file mode 100644\n+export const x = 1\n'

const run = (args: string): CommandRunInput => ({
  command: 'gemini-review', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const reply = (findings: unknown[]) =>
  JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ findings }) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 12_400, candidatesTokenCount: 300 },
  })

const BLOCKER = { severity: 'blocker', file: 'pay.ts', line: 1, message: 'A live Stripe key is in the code.' }
const MINOR = { severity: 'minor', file: 'pay.ts', message: 'Name the constant.' }

type World = {
  clock: MockClock
  store: Map<string, unknown>
  git: { argv: readonly string[]; cwd: string | undefined }[]
  requests: { url: string; body: string }[]
  replies: { status: number; text: string }[]
  commits: string[]
  toasts: string[]
  logs: string[]
  reads: number
  enrolled: string[]
}

/** What gemini-core holds for this mod. */
type Core = { key?: string; tier?: 'free' | 'paid'; model?: string; thinking?: 'minimal' | 'low' | 'medium' | 'high' }

/** gemini-core as an inline plugin: it adds `$.gemini`, whose calls the hooks of `seatCore` answer. */
const CORE: Plugin = {
  name: 'gemini-core',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), gemini: { enroll: stub, settings: stub, request: stub, read: stub, configure: stub } }))
  },
}

/** A test with gemini-core loaded beside the plugin. */
const it = (name: string, body: TestBody) => test(name, { plugins: [CORE] }, body)

/** gemini-core's reading of a response, as far as these tests need it (gemini-core's tests cover the rest). */
function coreRead(e: { status: number; ok: boolean; text: string; attempt: number }) {
  const delay = [1000, 2000, 3000][e.attempt - 1]
  if (e.status === 503 && delay !== undefined) return { retryInMs: delay }
  const value = JSON.parse(e.text)
  if (!e.ok) return { error: `Gemini HTTP ${e.status}: ${value.error.message}` }
  const usage = value.usageMetadata
  return { answer: { text: value.candidates[0].content.parts[0].text, inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, finishReason: 'STOP' } }
}

/** gemini-core, seated beneath the plugin: `$.gemini` answered from `core`. */
function seatCore(on: On, core: Core, enrolled: string[]): void {
  const tierOf = core.tier ?? 'free'
  const model = core.model ?? 'gemini-3.8-flash'
  const thinking = core.thinking === undefined ? {} : { thinking: core.thinking }
  on('gemini.enroll', (_, e) => { enrolled.push(`${e.consumer} ${e.defaultModel}`); return { value: undefined } })
  on('gemini.settings', () => ({ value: { hasKey: core.key !== undefined, tier: tierOf, model, ...thinking } }))
  on('gemini.request', (_, e) => {
    if (core.key === undefined) return { value: { error: 'no Gemini key: set GEMINI_API_KEY or the gemini-core apiKey option' } }
    const body = core.thinking === undefined ? e.body : { ...e.body, generationConfig: { ...(e.body.generationConfig as object), thinkingConfig: { thinkingLevel: core.thinking } } }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    return { value: { http: { url, init: { method: 'POST' as const, headers: { 'x-goog-api-key': core.key }, body: JSON.stringify(body) } }, model, tier: tierOf } }
  })
  on('gemini.read', (_, e) => ({ value: coreRead(e) }))
}

type Repo = { hasHead?: boolean; staged?: string; untracked?: string[] }

/** The git answers of a repository: the index diff, HEAD and new files. */
function gitAnswer(repo: Repo, argv: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '' })
  if (argv[1] === 'rev-parse') return out('', repo.hasHead === false ? 1 : 0)
  if (argv[1] === 'ls-files') return out((repo.untracked ?? []).join('\n'))
  if (argv.includes('--no-index')) return out(NEW_FILE, 1)
  if (argv.includes('--cached')) return out(repo.staged ?? DIFF)
  return out('')
}

// Beneath the plugin: a store, a transcript, a git repository, Gemini from a script, and Bash itself.
function world(on: On, opts: Core & { store?: [string, unknown][]; repo?: Repo } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: Date.parse('2026-09-19T10:00:00Z') }),
    store: new Map(opts.store ?? []),
    git: [],
    requests: [],
    replies: [],
    commits: [],
    toasts: [],
    logs: [],
    reads: 0,
    enrolled: [],
  }
  seatCore(on, opts, w.enrolled)
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_, e) => { w.store.delete(e.key); return { value: undefined } })
  on('session.messages', () => { w.reads++; return { value: MESSAGES } })
  on('session.cwd', () => ({ value: '/src/app' }))
  on('process.run', (_, e) => {
    w.git.push({ argv: e.argv, cwd: e.init?.cwd })
    return { value: gitAnswer(opts.repo ?? {}, e.argv) }
  })
  on('http.fetch', (_, e) => {
    w.requests.push({ url: e.url, body: String(e.init?.body ?? '') })
    const r = w.replies.shift() ?? { status: 500, text: '{}' }
    return { value: { status: r.status, ok: r.status < 300, headers: {}, text: r.text } }
  })
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    w.commits.push(e.command)
    return { result: 'ran' }
  })
  return w
}

const reviewText = (w: World) => JSON.parse(w.requests[0]?.body ?? '{}').contents[0].parts[0].text as string

describe('gemini-review', () => {
  it('stops a commit with a blocker and tells the model what to fix and how to skip', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply([BLOCKER, MINOR]) })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: pay"' })
    expect(w.commits).toEqual([])
    expect(r.deny).toContain('- pay.ts:1: A live Stripe key is in the code.')
    expect(r.deny).toContain('GEMINI_REVIEW_SKIP=1 git commit ...')
    expect(reviewText(w)).toContain('#1 user: Add the Stripe client and commit it.')
    expect(reviewText(w)).toContain('+const key = "sk_live_123"')
    expect(w.toasts).toEqual(['reviewed 1 file(s) · 1 blocker, 1 minor · 12k in, 300 out · sent to Gemini free tier'])
    expect(w.logs).toEqual(['commit stopped: reviewed 1 file(s) · 1 blocker, 1 minor · 12k in, 300 out'])
  })

  it('lets a commit with minor notes run and adds the notes after its result', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply([MINOR]) })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.commits).toEqual(['git commit -m x'])
    expect(r.result).toBe('ran')
    expect(r.context).toEqual([expect.stringContaining('let this commit run with 1 minor note(s):\n- pay.ts: Name the constant.')])
  })

  it('an empty change asks Gemini nothing and adds nothing', async ($, on) => {
    const w = world(on, { key: 'KEY', repo: { staged: '' } })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.requests).toEqual([])
    expect(r).toEqual({ result: 'ran' })
    expect(w.commits).toHaveLength(1)
  })

  it('reads what the same command stages, new files whole, in the directory it names', async ($, on) => {
    const w = world(on, { key: 'KEY', repo: { untracked: ['new.ts'] } })
    w.replies.push({ status: 200, text: reply([]) })
    const r = await $.tool.call({ tool: 'Bash', command: 'cd sub && git add new.ts && git commit -m x' })
    expect(r).toEqual({ result: 'ran', context: ['gemini-review: Gemini reviewed the 2 file(s) of this commit and found nothing to report.'] })
    expect(w.git.map(g => g.cwd)).toEqual(Array(w.git.length).fill('/src/app/sub'))
    expect(w.git.map(g => g.argv.join(' '))).toEqual([
      'git rev-parse --verify --quiet HEAD',
      'git diff --no-color --no-ext-diff --cached -- :/ :(exclude)new.ts',
      'git diff --no-color --no-ext-diff HEAD -- new.ts',
      'git ls-files --others --exclude-standard -- new.ts',
      'git diff --no-color --no-ext-diff --no-index -- /dev/null new.ts',
    ])
    expect(reviewText(w)).toContain('+export const x = 1')
    expect(w.toasts[0]).toContain('reviewed 2 file(s)')
  })

  it('a Gemini error, a missing key or a git error lets the commit run with a warning', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.commits).toHaveLength(1)
    expect(r.context).toEqual(['gemini-review could not review this commit and let it run: Gemini HTTP 429: Resource has been exhausted'])
    expect(w.logs).toEqual(['commit ran without a review: Gemini HTTP 429: Resource has been exhausted'])
  })

  it('without a key the commit runs, the model is told, and nothing is sent', async ($, on) => {
    const w = world(on)
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.commits).toHaveLength(1)
    expect(r.context?.[0]).toContain('no Gemini key')
    expect(w.requests).toEqual([])
    expect(w.git).toEqual([])
  })

  it('asks again after a 503, and lets the commit run after the fourth', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    const busy = { status: 503, text: JSON.stringify({ error: { message: 'high demand' } }) }
    w.replies.push(busy, { status: 200, text: reply([BLOCKER]) })
    const first = $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    await w.clock.advance(1000)
    expect((await first).deny).toContain('A live Stripe key')
    expect(w.requests).toHaveLength(2)
    w.replies.push(busy, busy, busy, busy)
    const second = $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    for (const ms of [1000, 2000, 3000]) await w.clock.advance(ms)
    expect((await second).context?.[0]).toContain('Gemini HTTP 503: high demand')
    expect(w.requests).toHaveLength(6)
    expect(w.commits).toHaveLength(1)
  })

  it('stops a commit that follows other commands in one call before anything runs, so the model commits alone', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    const r = await $.tool.call({ tool: 'Bash', command: "echo '// v2' >> math.ts && git commit -am 'docs: v2'" })
    expect(r.deny).toContain('it runs `echo` before git commit')
    expect(r.deny).toContain('git commit (with cd and git add if needed) in a Bash call of its own')
    expect(w.git).toEqual([])
    expect(w.commits).toHaveLength(0)
    expect(w.requests).toEqual([])
  })

  it('the skip prefix, a subagent, a command that is no commit, and off', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    expect(await $.tool.call({ tool: 'Bash', command: 'GEMINI_REVIEW_SKIP=1 git commit -m x' })).toEqual({ result: 'ran' })
    expect(w.logs).toEqual(['commit ran without a review: the model used GEMINI_REVIEW_SKIP=1'])
    expect(await $.tool.call({ tool: 'Bash', command: 'git log --oneline -3' })).toEqual({ result: 'ran' })
    expect(w.git).toEqual([])
    w.replies.push({ status: 200, text: reply([]) })
    // The test engine passes `agentId` on as a subagent's call carries it; the type drops it.
    const subagent = { tool: 'Bash' as const, command: 'git commit -m x', agentId: 'a1' }
    await $.tool.call(subagent)
    expect(w.reads).toBe(0)
    expect(reviewText(w)).toContain('The conversation is not available')
    w.store.set('enabled', false)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.requests).toHaveLength(1)
    expect(w.commits).toHaveLength(4)
  })

  it('enrolls with gemini-core, and sends with the model, thinking level and tier it holds', async ($, on) => {
    const w = world(on, { key: 'KEY', model: 'gemini-3.5-flash', thinking: 'low', tier: 'paid' })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/src/app' })
    expect(w.enrolled).toEqual(['gemini-review gemini-3.8-flash'])
    w.replies.push({ status: 200, text: reply([]) })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.requests[0]?.url).toContain('/models/gemini-3.5-flash:generateContent')
    expect(JSON.parse(w.requests[0]?.body ?? '{}').generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(w.toasts[0]).not.toContain('free tier')
    expect((await $.command.run(run(''))).text).toBe('on · gemini-3.5-flash · thinking low · paid tier · key set\nlast: reviewed 1 file(s) · 0 blocker, 0 minor · 12k in, 300 out')
  })

  it('the command turns the review on and off, and names /gemini-core for the rest', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    expect((await $.command.run(run('off'))).text).toBe('off: commits run without a review')
    expect((await $.command.run(run(''))).text).toBe('off · gemini-3.8-flash · thinking model default · free tier · key set')
    expect((await $.command.run(run('reset'))).text).toBe('on: back to the default')
    expect([...w.store.keys()]).toEqual([])
    expect((await $.command.run(run('paid'))).text).toBe('expects on, off, or reset; /gemini-core sets the model, the thinking level and the tier')
  })
})
