import { describe, expect, mock, test, tier, type MockClock } from 'claude-code/testing'
import type { On, SessionStartInput, TurnCompleteInput } from 'claude-code'

tier('user')

const DIR = '/Users/u/.cli-tweaks/memory/app'
const FILE = `${DIR}/MEMORY.md`
const OLD = `# app

## CRITICAL RULES

- Run \`make test\` before a commit.

## Architecture & Config Facts

## Active Warnings

## Topic Files
`
const session: SessionStartInput = { surface: null, isInteractive: false, cwd: '/src/app/pkg' }
const turn = (agentId?: string): TurnCompleteInput => ({
  answer: 'done',
  durationMs: 10,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  agentId,
})
const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 }

type World = {
  files: Map<string, string>
  replies: (string | null)[]
  prompts: string[]
  logs: string[]
  statuses: (string | undefined)[]
  clock: MockClock
}

function world(on: On, files: Record<string, string> = {}): World {
  const clock = mock.clock(on, { now: Date.parse('2026-09-18T12:00:00Z') })
  const w: World = { files: new Map(Object.entries(files)), replies: [], prompts: [], logs: [], statuses: [], clock }
  mock.env(on, { HOME: '/Users/u' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: e.argv.includes('--git-common-dir') ? '/src/app/.git\n' : '', stderr: '' },
  }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  // A fork takes one second of the mock clock, so a test can end turns while it runs.
  on('model.fork', async (_, e) => {
    w.prompts.push(e.prompt)
    await clock.sleep(1000)
    const text = w.replies.shift()
    return { value: text === undefined || text === null ? null : { text, usage } }
  })
  on('ui.log', (_, e) => {
    if (e.to !== 'debug') w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  return w
}

/** The save runs unawaited, so the test moves the clock past each fork before it looks. */
async function settled(w: World, statuses: number): Promise<void> {
  for (let i = 0; i < statuses; i++) await w.clock.advance(1000)
  expect(w.statuses.length, 'the save did not finish').toBeGreaterThanOrEqual(statuses)
}

describe('memory-save', () => {
  test('adds a rule to MEMORY.md and shows it on the status line and in the log', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push('{"ops":[{"op":"add","section":"CRITICAL RULES","text":"- Use pnpm."}],"topics":[]}')
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.get(FILE)).toContain('- Run `make test` before a commit.\n- Use pnpm.\n')
    expect(w.logs).toEqual(['MEMORY.md: 1 added'])
    expect(w.statuses.at(-1)).toMatch(/^\+1 · \d\d:\d\d$/)
    expect(w.statuses[0]).toMatch(/^saving… · \d\d:\d\d$/)
    expect(w.prompts[0]).toContain('<memory_file>\n# app')
  })

  test('creates the file from the skeleton when the project has no memory', async ($, on) => {
    const w = world(on)
    w.replies.push('{"ops":[{"op":"add","section":"Active Warnings","text":"- The build needs Go 1.23."}]}')
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.get(FILE)).toContain('## Active Warnings\n\n- The build needs Go 1.23.\n')
    expect(w.logs).toEqual(['MEMORY.md: created, 1 added'])
    expect(w.prompts[0]).toContain('MEMORY.md does not exist yet')
  })

  test('writes nothing and says so when nothing was learned', async ($, on) => {
    const w = world(on)
    w.replies.push('{"ops":[],"topics":[]}')
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.size).toBe(0)
    expect(w.logs).toEqual([])
    expect(w.statuses.at(-1)).toMatch(/^no change · /)
  })

  test('puts a file out of the template into it before the fork reads it, and keeps the old file', async ($, on) => {
    const legacy = '# app\n\n## CRITICAL RULES\n\n- Run `make test`.\n\n## Overview\n\n- Old fact.\n\n## Topic Files\n'
    const w = world(on, { [FILE]: legacy })
    w.replies.push('{"ops":[{"op":"add","section":"Active Warnings","text":"- New warning."}]}')
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.get(`${DIR}/MEMORY.pre-migration.md`)).toBe(legacy)
    expect(w.logs[0]).toBe('MEMORY.md: put into the four sections (old copy: MEMORY.pre-migration.md)')
    expect(w.prompts[0]).toContain('## Architecture & Config Facts\n\n### Unsorted: Overview\n\n- Old fact.\n\n## Active Warnings')
    expect(w.prompts[0]).toContain('MANDATORY SORT')
    expect(w.files.get(FILE)).toContain('## Active Warnings\n\n- New warning.\n\n## Topic Files')
    expect(w.statuses.at(-1)).toMatch(/^\+1 · /)
  })

  test('appends to a topic file and lists it', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push('{"topics":[{"file":"history.md","append":"- Moved the API."}]}')
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.get(`${DIR}/history.md`)).toBe('# app: history\n\n- Moved the API.\n')
    expect(w.files.get(FILE)).toContain('## Topic Files\n\n- `history.md`.\n')
  })

  test('leaves an unreadable reply to the next turn: no status line, one transcript line', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push('I saved it.')
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.get(FILE)).toBe(OLD)
    expect(w.statuses.at(-1)).toBeUndefined()
    expect(w.logs.at(-1)).toContain("this turn's reply was not read (reply has no JSON object); 2 output tokens")
  })

  test('keeps a reply that is not valid JSON, the last one only, so its cause can be read', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    const broken = '{"ops":[{"op":"add","section":"Active Warnings","text":"- A "quoted" word."}]}'
    w.replies.push('{"ops":[', broken)
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    await $.turn.complete(turn())
    await settled(w, 2)
    expect(w.files.get(`${DIR}/memory-save.failed-reply.txt`)).toBe(broken)
    expect(w.logs.at(-1)).toMatch(/this turn's reply was not read \(reply is not valid JSON \(.+\)\); 2 output tokens, kept in memory-save.failed-reply.txt/)
    expect(w.files.get(FILE)).toBe(OLD)
  })

  test('skips a misquoted line, saves the rest, and names the line to the next fork', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push(
      '{"ops":[{"op":"remove","line":"- **Run `make test` before a commit.**"},{"op":"add","section":"Active Warnings","text":"- New."}]}',
      '{"ops":[{"op":"remove","line":"- **Gone.**"}]}',
    )
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 2)
    expect(w.files.get(FILE)).toContain('- New.')
    expect(w.statuses.at(-1)).toMatch(/^\+1 1 skipped · /)
    expect(w.logs).toEqual(['MEMORY.md: 1 added; 1 skipped, not in the file: - **Run `make test` before a commit.**'])
    await $.turn.complete(turn())
    await settled(w, 4)
    expect(w.prompts[1]).toContain('MANDATORY EXACT COPY')
    expect(w.statuses.at(-1)).toMatch(/^no change, 1 skipped · /)
    expect(w.logs.at(-1)).toBe('MEMORY.md: no change; 1 skipped, not in the file: - **Gone.**')
  })

  test('shows the error when the fork gets no reply', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push(null)
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.statuses.at(-1)).toMatch(/^error: the fork got no reply/)
  })

  test('refuses a bullet over the character cap and keeps the file', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push(JSON.stringify({ ops: [{ op: 'add', section: 'Active Warnings', text: `- ${'x'.repeat(700)}` }] }))
    await $.session.start(session)
    await $.turn.complete(turn())
    await settled(w, 1)
    expect(w.files.get(FILE)).toBe(OLD)
    expect(w.statuses.at(-1)).toMatch(/^no change, 1 refused · /)
    expect(w.logs.at(-1)).toContain('bullet of 702 characters, the limit is 600')
  })

  test('does not save on a subagent turn or an API error turn', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    await $.session.start(session)
    await $.turn.complete(turn('a1'))
    await $.turn.complete({ ...turn(), reason: 'error' })
    await w.clock.settle()
    expect(w.prompts).toEqual([])
  })

  test('runs one save at a time and one more for a turn that ended during it', async ($, on) => {
    const w = world(on, { [FILE]: OLD })
    w.replies.push('{"ops":[{"op":"add","section":"CRITICAL RULES","text":"- One."}]}')
    w.replies.push('{"ops":[{"op":"add","section":"CRITICAL RULES","text":"- Two."}]}')
    await $.session.start(session)
    await $.turn.complete(turn())
    await $.turn.complete(turn())
    await $.turn.complete(turn())
    await settled(w, 2)
    expect(w.prompts).toHaveLength(2)
    expect(w.prompts[1]).toContain('- One.')
    expect(w.files.get(FILE)).toContain('- One.\n- Two.\n')
  })
})
