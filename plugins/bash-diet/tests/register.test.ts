import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'
import { callRows } from './transcript.ts'

tier('user')

const TMP = '/Users/u/tmp'
const DIR = `${TMP}/bash-diet`

/** The Bash output the world answers with, and what the mod wrote, ran and showed. */
type World = {
  stdout: string
  stderr: string
  exitCode: number
  persisted?: string
  files: Map<string, string>
  ran: string[]
  logs: string[]
  statuses: (string | undefined)[]
  decisions: Record<string, 'allow' | 'ask' | 'deny'>
  /** Each file's modification time; a write moves it on. */
  mtimes: Map<string, number>
  /** Whether the session start ran to its end and registered the command. */
  registered: boolean
  now: number
}

function world(on: On): World {
  const w: World = { stdout: '', stderr: '', exitCode: 0, files: new Map(), ran: [], logs: [], statuses: [], decisions: {}, mtimes: new Map(), registered: false, now: new Date(2026, 8, 25, 14, 30).getTime() }
  mock.store(on, {})
  mock.env(on, { TMPDIR: `${TMP}/`, HOME: '/Users/u' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => { w.registered = true; return { value: { command: e.name } } })
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('session.root', () => ({ value: '/Users/u/app' }))
  on('clock.now', () => ({ value: w.now }))
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} as never, rateLimits: [], cost: { usd: 1.5 } } }))
  on('fs.list', (_, e) => ({ value: childrenOf(w, e.path) }))
  on('process.spawn', async function* (_, e) {
    const text = w.files.get(e.argv[1] ?? '')
    if (e.argv[0] === 'cat' && text !== undefined && text !== '') yield { stream: 'stdout' as const, text }
    return { value: { code: text === undefined ? 1 : 0, signal: null } }
  })
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('--show-toplevel') ? '/Users/u/app\n' : '', stderr: '' } }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) || [...w.files.keys()].some(k => k.startsWith(`${e.path}/`)) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: w.files.get(e.path)?.length ?? 0, mtimeMs: w.mtimes.get(e.path) ?? 1, isLink: false } }))
  on('fs.write', (_, e) => { put(w, e.path, e.text); return { value: undefined } })
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('tool.check', (_, e) => ({ decision: w.decisions[(e.input as { command: string }).command] ?? 'allow' }))
  on('classic.SessionStart', () => ({}))
  // A non-zero exit is an error result whose text is `Exit code N` and the output, as the engine answers.
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    w.ran.push(e.command)
    if (w.exitCode !== 0) {
      const text = `Exit code ${w.exitCode}\n${w.stdout}`
      return { result: `Error: ${text}`, text, isError: true } as never
    }
    const result = { stdout: w.stdout, stderr: w.stderr, interrupted: false, ...(w.persisted === undefined ? {} : { persistedOutputPath: w.persisted }) }
    return { result, text: w.stdout } as never
  })
  return w
}

/** The entries right under a directory of the world's files: a file, or a directory holding more. */
function childrenOf(w: World, dir: string): { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }[] {
  const names = new Map<string, 'file' | 'dir'>()
  for (const k of w.files.keys()) {
    if (!k.startsWith(`${dir}/`)) continue
    const rest = k.slice(dir.length + 1)
    names.set(rest.split('/')[0] ?? rest, rest.includes('/') ? 'dir' : 'file')
  }
  return [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: w.mtimes.get(`${dir}/${name}`) ?? 1, isLink: false }))
}

/** Writes a file as the person would, moving its modification time on. */
function put(w: World, path: string, text: string): void {
  w.files.set(path, text)
  w.mtimes.set(path, (w.mtimes.get(path) ?? 1) + 1)
}

const PROJECT_RULES = '/Users/u/app/.bash-diet/filters.json'
const GLOBAL_RULES = '/Users/u/.claude/bash-diet/filters.json'

/** A rule file that keeps only the lines holding `keep` from the output of commands starting with `pattern`. */
const ruleFile = (pattern: string, keep: string) => JSON.stringify({ filters: { mine: { match_command: pattern, keep_lines_matching: [keep] } } })

const run = (args: string): CommandRunInput => ({
  command: 'bash-diet', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
})

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

const started = ($: Engine) => $.session.start({ surface: null, isInteractive: true, cwd: '/Users/u/app' })

const stdoutOf = (r: { result?: unknown }) => (r.result as { stdout: string }).stdout

/** Output the generic cleanup shrinks: escapes and a repeated line. */
const NOISY = `\u001b[32mstep\u001b[0m\n${'retrying\n'.repeat(40)}done\n`

describe('bash-diet', () => {
  test('an unknown command is cleaned up and the gain is shown', async ($, on) => {
    const w = world(on)
    await started($)
    w.stdout = NOISY
    const r = await bash($, './build.sh')
    expect(stdoutOf(r)).toBe('step\nretrying (×40)\ndone')
    expect(w.statuses.at(-1)).toMatch(/^1 result\(s\) shrunk · \d+ → \d+ chars \(−\d+%\) · ~\d+ tokens estimated$/)
    expect((await $.command.run(run(''))).text).toMatch(/^on · 1 result\(s\) shrunk/)
    expect(w.logs).toEqual([])
    expect(w.registered).toBe(true)
  })

  test('output a filter cannot shrink comes back as it was', async ($, on) => {
    const w = world(on)
    await started($)
    w.stdout = 'a\nb\n'
    const r = await bash($, './build.sh')
    expect(stdoutOf(r)).toBe('a\nb\n')
    expect((await $.command.run(run(''))).text).toBe('on · no Bash result shrunk yet')
  })

  test('the raw variable, an opaque command, off and an exclude leave the output alone', async ($, on) => {
    const w = world(on)
    await started($)
    w.stdout = NOISY
    expect(stdoutOf(await bash($, 'BASH_DIET_RAW=1 ./build.sh'))).toBe(NOISY)
    expect(stdoutOf(await bash($, 'echo $(./build.sh)'))).toBe(NOISY)
    expect((await $.command.run(run('exclude ./build.sh'))).text).toBe('excluded: ./build.sh runs unfiltered')
    expect(stdoutOf(await bash($, './build.sh --all'))).toBe(NOISY)
    expect((await $.command.run(run('excludes'))).text).toBe('./build.sh')
    expect((await $.command.run(run('include ./build.sh'))).text).toBe('included: ./build.sh is filtered again')
    expect((await $.command.run(run('off'))).text).toBe('off: Bash results reach the model as they are')
    expect(stdoutOf(await bash($, './build.sh'))).toBe(NOISY)
    expect((await $.command.run(run('exclude ^('))).text).toContain('not a valid regex')
    expect((await $.command.run(run('what'))).text).toContain('expects nothing')
  })

  test('a failed run stays an error with its exit code, and its full output is kept in a file', async ($, on) => {
    const w = world(on)
    await started($)
    w.exitCode = 2
    w.stdout = `${'x'.repeat(600)}\n${'again\n'.repeat(30)}`
    const r = await bash($, './build.sh')
    expect(r.deny).toMatch(new RegExp(`^Exit code 2\\n${'x'.repeat(600)}\\nagain \\(×30\\)\\n\\[full output: ${DIR}/[0-9a-f]{12}\\.log\\]$`))
    const path = /\[full output: (.+)\]/.exec(r.deny ?? '')?.[1] ?? ''
    expect(w.files.get(path)).toBe(w.stdout)
  })

  test('a failed run the engine cut at 10000 characters says the middle is lost, and names the file of what arrived', async ($, on) => {
    const w = world(on)
    await started($)
    w.exitCode = 1
    w.stdout = `${'again\n'.repeat(900)}\n... [9554 characters truncated] ...\n\n${'again\n'.repeat(700)}FAIL\n`
    const r = await bash($, './build.sh')
    expect(r.deny).toMatch(new RegExp(`\\n\\[output cut by Claude Code at 10000 characters; the middle is lost: ${DIR}/[0-9a-f]{12}\\.log\\]$`))
    expect(r.deny).not.toContain('[full output:')
  })

  test('a result the engine cut is read whole from its file, and that file is the one named', async ($, on) => {
    const w = world(on)
    await started($)
    const full = `head\n${'same\n'.repeat(5000)}tail\n`
    w.files.set('/Users/u/.claude/out.txt', full)
    w.stdout = full.slice(0, 300)
    w.persisted = '/Users/u/.claude/out.txt'
    const r = await bash($, './build.sh')
    expect(stdoutOf(r)).toBe('head\nsame (×5000)\ntail')
    expect((r.result as Record<string, unknown>).persistedOutputPath).toBe(undefined)
    expect([...w.files.keys()].filter(k => k.startsWith(DIR))).toEqual([])
  })

  test('a masked env stands whatever it saves, and keeps no file of the values it masked', async ($, on) => {
    const w = world(on)
    await started($)
    // Masking saves 8 characters here, under the least a filter must save; the masked text still stands.
    w.stdout = 'A=1\nGEMINI_API_KEY=AIzaSyExample\n'
    expect(stdoutOf(await bash($, 'env'))).toBe('A=1\nGEMINI_API_KEY=***')
    expect([...w.files.keys()].filter(k => k.startsWith(DIR))).toEqual([])
  })

  test('a result the engine kept in a file stays its preview when the filtered text is not shorter than it', async ($, on) => {
    const w = world(on)
    await started($)
    // The cleanup drops the colour codes, so the filter shrinks the file, yet leaves far more than the preview.
    const full = Array.from({ length: 3000 }, (_, i) => `\u001b[32mrow ${i}\u001b[0m`).join('\n')
    w.files.set('/Users/u/.claude/out.txt', full)
    w.stdout = '<persisted-output>\nOutput too large. Full output saved to: /Users/u/.claude/out.txt\n\nPreview (first 2KB):\nrow 0\n...\n</persisted-output>'
    w.persisted = '/Users/u/.claude/out.txt'
    const r = await bash($, './build.sh')
    expect(stdoutOf(r)).toBe(w.stdout)
    expect((r.result as Record<string, unknown>).persistedOutputPath).toBe('/Users/u/.claude/out.txt')
    expect((await $.command.run(run(''))).text).toBe('on · no Bash result shrunk yet')
  })

  test('a project rule runs only while its file is trusted, and a change takes the trust back', async ($, on) => {
    const w = world(on)
    await started($)
    put(w, PROJECT_RULES, ruleFile('^./build.sh', 'ok'))
    // Each kind of line is long enough that keeping one kind saves more than the least a filter must save.
    const [n1, o1, n2, o2] = ['noise 1', 'ok one', 'noise 2', 'ok two'].map(l => `${l} ${'.'.repeat(40)}`)
    w.stdout = `${n1}\n${o1}\n${n2}\n${o2}\n`
    expect(stdoutOf(await bash($, './build.sh'))).toBe(w.stdout)
    expect(w.logs).toEqual(['.bash-diet/filters.json: 1 filter rule(s) are not trusted and do not run; /bash-diet trust runs them'])
    expect((await $.command.run(run('trust'))).text).toMatch(/^trusted: 1 rule\(s\) of \.bash-diet\/filters\.json run until the file changes \(sha256 [0-9a-f]{12}\)$/)
    expect(stdoutOf(await bash($, './build.sh'))).toBe(`${o1}\n${o2}`)
    put(w, PROJECT_RULES, ruleFile('^./build.sh', 'noise'))
    expect(stdoutOf(await bash($, './build.sh'))).toBe(w.stdout)
    expect(w.logs).toHaveLength(2)
    await $.command.run(run('trust'))
    expect(stdoutOf(await bash($, './build.sh'))).toBe(`${n1}\n${n2}`)
    expect((await $.command.run(run('untrust'))).text).toBe('untrusted: .bash-diet/filters.json does not run')
    expect(stdoutOf(await bash($, './build.sh'))).toBe(w.stdout)
  })

  test('a global rule runs untrusted and comes before the mod\'s own filter; a broken file says why', async ($, on) => {
    const w = world(on)
    await started($)
    put(w, GLOBAL_RULES, ruleFile('^git status', 'modified'))
    w.stdout = 'On branch main\nChanges not staged for commit:\n\tmodified:   a.ts\n\tmodified:   b.ts\n'
    expect(stdoutOf(await bash($, 'git status'))).toBe('\tmodified:   a.ts\n\tmodified:   b.ts')
    expect((await $.command.run(run('filters'))).text).toMatch(/^project: \.bash-diet\/filters\.json \(none\)\nglobal: ~\/\.claude\/bash-diet\/filters\.json: mine\nbuilt-in: cc, cmake-build, /)
    put(w, GLOBAL_RULES, '{ "filters": { "bad": { "match_command": "^x", "max_lines": -1, "colour": true } } }')
    await bash($, 'git status')
    expect(w.logs).toEqual(['~/.claude/bash-diet/filters.json: bad: max_lines expects a whole number above 0; bad: unknown field colour'])
    expect((await $.command.run(run('trust'))).text).toBe('there is no .bash-diet/filters.json in this repository')
  })

  test('each shrunk result is recorded in the day\'s file, and gain and cost report over the records', async ($, on) => {
    const w = world(on)
    await started($)
    const GAIN = '/Users/u/.claude/bash-diet/gain'
    put(w, `${GAIN}/2026-09-24-s0.jsonl`, `${JSON.stringify({ at: new Date(2026, 8, 24, 9).getTime(), project: 'lib', family: 'cargo test', raw: 40_000, shown: 400 })}\nnot a record\n`)
    w.stdout = NOISY
    await bash($, './build.sh')
    const day = JSON.parse(w.files.get(`${GAIN}/2026-09-25-s1.jsonl`) ?? '{}') as Record<string, unknown>
    expect(day).toEqual({ at: w.now, project: 'app', family: 'other', raw: NOISY.length, shown: 'step\nretrying (×40)\ndone'.length })
    const summary = (await $.command.run(run('gain'))).text
    expect(summary).toMatch(/^since 2026-09-24: 2 results · [\d.]+k → \d+ chars \(−\d+%\) · ~[\d.]+k tokens estimated\ntop commands:\n  cargo test  1 result · 40k → 400 chars \(−99%\) · ~9\.9k tokens estimated\n  other       1 result/)
    expect(summary).toMatch(/\(1 unreadable line\(s\) in \/Users\/u\/\.claude\/bash-diet\/gain left out\)$/)
    expect((await $.command.run(run('gain project'))).text).toMatch(/^lib  1 result · 40k → 400 chars \(−99%\) · ~9\.9k tokens estimated\napp  1 result/)
    expect(((await $.command.run(run('gain history'))).text ?? '').split('\n')[0] ?? '').toMatch(/^09-25 14:30  other  \d+ → \d+ chars \(−\d+%\)  app$/)
    expect((await $.command.run(run('gain weekly'))).text).toBe('gain expects nothing, project, daily, graph or history')
    expect((await $.command.run(run('cost'))).text).toMatch(/^this session \(claude-opus-5-5\): \$1\.50 so far\n~\d+ tokens kept out of the context: \$0\.\d{4} saved on the cache write/)
  })

  test('a module loaded again keeps the session\'s earlier records and goes on counting from them', async ($, on) => {
    const w = world(on)
    const file = '/Users/u/.claude/bash-diet/gain/2026-09-25-s1.jsonl'
    const before = JSON.stringify({ at: w.now - 60_000, project: 'app', family: 'git status', raw: 400, shown: 100 })
    put(w, file, before)
    await started($)
    expect((await $.command.run(run(''))).text).toBe('on · 1 result(s) shrunk · 400 → 100 chars (−75%) · ~75 tokens estimated')
    w.stdout = NOISY
    await bash($, './build.sh')
    expect((w.files.get(file) ?? '').split('\n')).toEqual([before, expect.stringContaining('"family":"other"')])
    expect(w.statuses.at(-1)).toMatch(/^2 result\(s\) shrunk/)
    expect(w.logs).toEqual([])
  })

  test('discover and learn read this project\'s transcripts, and learn write leaves a rules file', async ($, on) => {
    const w = world(on)
    await started($)
    const dir = '/Users/u/.claude/projects/-Users-u-app'
    w.now = 40 * 24 * 60 * 60 * 1000
    put(w, `${dir}/s1.jsonl`, '')
    w.mtimes.set(`${dir}/s1.jsonl`, w.now)
    put(w, `${dir}/s0.jsonl`, [
      ...callRows('a', 'git log --onelin -5', 'Exit code 128\nfatal: unrecognized argument: --onelin', true),
      ...callRows('b', 'git log --oneline -5', 'abc fix'),
      ...callRows('c', 'node -e 1', 'x'.repeat(400)),
    ].join('\n'))
    w.mtimes.set(`${dir}/s0.jsonl`, w.now - 60_000)
    put(w, '/Users/u/.claude/projects/-Users-u-other/s9.jsonl', callRows('d', 'ls', 'a').join('\n'))
    w.mtimes.set('/Users/u/.claude/projects/-Users-u-other/s9.jsonl', w.now)
    expect((await $.command.run(run('discover'))).text).toMatch(/^3 Bash calls in 2 session\(s\) of the last 30 days; .*\nno filter reads these .*\n  node  1 call  ~100 tokens/)
    expect((await $.command.run(run('learn'))).text).toBe('1 corrected command(s) in 2 session(s) of the last 30 days:\n- `git log --onelin -5` failed (unknown flag); `git log --oneline -5` worked.')
    expect((await $.command.run(run('learn write'))).text).toBe('wrote 1 correction(s) to .claude/rules/cli-corrections.md')
    expect(w.files.get('/Users/u/app/.claude/rules/cli-corrections.md')).toContain('`git log --oneline -5` worked.')
    expect((await $.command.run(run('learn 0'))).text).toBe('learn expects a number of days from 1 to 365')
    expect((await $.command.run(run('discover all'))).text).toBe('reading 3 transcript(s) of every project from the last 30 days; the report follows as a log line')
  })

  test('the note on the filter reaches the model at the session start while on', async ($, on) => {
    world(on)
    await started($)
    const r = await $.classic.SessionStart({ source: 'startup' } as never) as { additionalContext?: string[] }
    expect(r.additionalContext?.[0]).toContain('BASH_DIET_RAW=1')
    await $.command.run(run('off'))
    const off = await $.classic.SessionStart({ source: 'clear' } as never) as { additionalContext?: string[] }
    expect(off.additionalContext).toBe(undefined)
  })
})
