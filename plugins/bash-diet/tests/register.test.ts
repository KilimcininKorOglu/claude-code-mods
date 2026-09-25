import { describe, expect, mock, test, tier, type Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

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
}

function world(on: On): World {
  const w: World = { stdout: '', stderr: '', exitCode: 0, files: new Map(), ran: [], logs: [], statuses: [], decisions: {} }
  mock.store(on, {})
  mock.env(on, { TMPDIR: `${TMP}/`, HOME: '/Users/u' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('ui.status', (_, e) => { w.statuses.push(e.text); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => { w.files.set(e.path, e.text); return { value: undefined } })
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
    expect(w.statuses.at(-1)).toMatch(/^1 result\(s\) shrunk · ~\d+ tokens saved \(\d+%\)$/)
    expect((await $.command.run(run(''))).text).toMatch(/^on · 1 result\(s\) shrunk/)
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
    expect([...w.files.keys()]).toEqual(['/Users/u/.claude/out.txt'])
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
