import { describe, expect, mock, test, tier, type MockClock } from 'claude-code/testing'
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
function world(on: On, opts: { key?: string; store?: [string, unknown][]; repo?: Repo } = {}): World {
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
  }
  on('env.get', (_, e) => ({ value: e.name === 'GEMINI_API_KEY' ? opts.key : undefined }))
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
  test('stops a commit with a blocker and tells the model what to fix and how to skip', async ($, on) => {
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

  test('lets a commit with minor notes run and adds the notes after its result', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 200, text: reply([MINOR]) })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.commits).toEqual(['git commit -m x'])
    expect(r.result).toBe('ran')
    expect(r.context).toEqual([expect.stringContaining('let this commit run with 1 minor note(s):\n- pay.ts: Name the constant.')])
  })

  test('an empty change asks Gemini nothing and adds nothing', async ($, on) => {
    const w = world(on, { key: 'KEY', repo: { staged: '' } })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.requests).toEqual([])
    expect(r).toEqual({ result: 'ran' })
    expect(w.commits).toHaveLength(1)
  })

  test('reads what the same command stages, new files whole, in the directory it names', async ($, on) => {
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

  test('a Gemini error, a missing key or a git error lets the commit run with a warning', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    w.replies.push({ status: 429, text: JSON.stringify({ error: { message: 'Resource has been exhausted' } }) })
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.commits).toHaveLength(1)
    expect(r.context).toEqual(['gemini-review could not review this commit and let it run: Gemini HTTP 429: Resource has been exhausted'])
    expect(w.logs).toEqual(['commit ran without a review: Gemini HTTP 429: Resource has been exhausted'])
  })

  test('without a key the commit runs, the model is told, and nothing is sent', async ($, on) => {
    const w = world(on)
    const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.commits).toHaveLength(1)
    expect(r.context?.[0]).toContain('no Gemini key')
    expect(w.requests).toEqual([])
    expect(w.git).toEqual([])
  })

  test('asks again after a 503, and lets the commit run after the fourth', async ($, on) => {
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

  test('the skip prefix, a subagent, a command that is no commit, and off', async ($, on) => {
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

  test('the command stores the settings and shows the status with the last review', async ($, on) => {
    const w = world(on, { key: 'KEY' })
    await $.session.start({ surface: null, isInteractive: false, cwd: '/src/app' })
    expect((await $.command.run(run('model gemini-3.5-flash'))).text).toBe('model gemini-3.5-flash')
    expect((await $.command.run(run('paid'))).text).toBe('paid tier')
    w.replies.push({ status: 200, text: reply([]) })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(w.requests[0]?.url).toContain('/models/gemini-3.5-flash:generateContent')
    expect(w.toasts[0]).not.toContain('free tier')
    expect((await $.command.run(run(''))).text).toBe('on · gemini-3.5-flash · paid tier · key set\nlast: reviewed 1 file(s) · 0 blocker, 0 minor · 12k in, 300 out')
    expect((await $.command.run(run('reset'))).text).toBe('settings reset to the plugin options')
    expect([...w.store.keys()]).toEqual([])
  })
})
