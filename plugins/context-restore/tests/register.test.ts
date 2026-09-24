import { describe, expect, mock, test, tier, type Engine, type Plugin, type TestBody } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

tier('user')

/** sidebar as an inline plugin: it adds `$.sidebar`, whose calls the world answers. */
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}

const withSidebar = (name: string, body: TestBody) => test(name, { plugins: [SIDEBAR] }, body)

const T0 = 1_000_000
const SKILL_DIR = '/Users/u/.claude/skills/rules-skill'
const SKILL_FILE = `${SKILL_DIR}/SKILL.md`
/** The skill as the engine loaded it at the start and hands it at every call. */
const SKILL = `Base directory for this skill: ${SKILL_DIR}\n\n# Rules\n\nRule one.\n`
const COMMAND_FILE = '/Users/u/.claude/commands/review.md'
const RULES_FILE = '/Users/u/.claude/rules/db.md'

const run = (args: string): CommandRunInput => ({ command: 'context-restore', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

/** Files on disk with their last write, what the model was last handed, and what the person read. */
type World = { files: Map<string, { text: string; mtimeMs: number }>; calls: string[]; notes: string[][]; logs: string[]; bar: { open: boolean; lines: string[] } }

function world(on: On): World {
  const w: World = {
    files: new Map([
      [SKILL_FILE, { text: '---\nname: rules-skill\ndescription: x\n---\n\n# Rules\n\nRule one.\n', mtimeMs: T0 - 5 }],
      [COMMAND_FILE, { text: '---\ndescription: x\n---\n\nReview $ARGUMENTS and report.\n', mtimeMs: T0 - 5 }],
      [RULES_FILE, { text: 'Use parameters.', mtimeMs: T0 - 5 }],
    ]),
    calls: [],
    notes: [],
    logs: [],
    bar: { open: false, lines: [] },
  }
  mock.store(on, {})
  mock.env(on, { HOME: '/Users/u' })
  mock.clock(on, { now: T0 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.log', (_, e) => { w.logs.push(e.text); return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: w.files.get(e.path)?.mtimeMs ?? 0, isLink: false } }))
  on('fs.read', (_, e) => {
    const f = w.files.get(e.path)
    if (f === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: f.text }
  })
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => { w.notes.push([...(e.context ?? [])]); return { text: e.text } })
  return w
}

/** Answers `$.sidebar.set`; only a test that loads the sidebar plugin may seat it. */
function seatSidebar(on: On, w: World): void {
  on('sidebar.set', (_, e) => {
    const s = e as unknown as { lines: { text: string }[] }
    if (w.bar.open) w.bar.lines.push(...s.lines.map(l => l.text))
    return { value: w.bar.open }
  })
}

const started = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
const call = async ($: Engine, skill: string, text: string) => (await $.skill.prompt({ skill, text })).text
const prompt = ($: Engine, text = 'go') => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })

describe('context-restore', () => {
  test('a call whose file reads as the engine\'s copy keeps the engine\'s text', async ($, on) => {
    const w = world(on)
    await started($)
    expect(await call($, 'rules-skill', SKILL)).toBe(SKILL)
    expect(w.logs).toEqual([])
  })

  test('a call of a skill whose file changed on disk gets the current text in place of the engine\'s copy', async ($, on) => {
    const w = world(on)
    await started($)
    w.files.set(SKILL_FILE, { text: '---\nname: rules-skill\n---\n\n# Rules\n\nRule two.\n', mtimeMs: T0 + 10 })
    expect(await call($, 'rules-skill', SKILL)).toBe(`Base directory for this skill: ${SKILL_DIR}\n\n# Rules\n\nRule two.\n`)
    expect(w.logs).toEqual(['changed on disk, the call got the current text: rules-skill'])
    // Nothing reaches the model between calls: a changed skill waits for its next call.
    await prompt($)
    expect(w.notes.at(-1)).toEqual([])
  })

  test('a command with placeholders keeps its filled text and gets the current file text after it', async ($, on) => {
    const w = world(on)
    await started($)
    expect(await call($, 'review', 'Review src/a.ts and report.\n')).toBe('Review src/a.ts and report.\n')
    w.files.set(COMMAND_FILE, { text: '---\ndescription: x\n---\n\nReview $ARGUMENTS and list every risk.\n', mtimeMs: T0 + 10 })
    const text = await call($, 'review', 'Review src/a.ts and report.\n')
    expect(text.startsWith('Review src/a.ts and report.\n\ncontext-restore: /Users/u/.claude/commands/review.md changed on disk after this session loaded it.')).toBe(true)
    expect(text.endsWith('Review $ARGUMENTS and list every risk.\n')).toBe(true)
  })

  test('a built-in command with no file keeps the engine\'s text', async ($, on) => {
    world(on)
    await started($)
    expect(await call($, 'init', 'Please analyze this codebase.\n')).toBe('Please analyze this codebase.\n')
  })

  test('a rules file the session read and that changed on disk reaches the model once', async ($, on) => {
    const w = world(on)
    await started($)
    await $.prompt.attachment({ type: 'instructions', text: `Contents of ${RULES_FILE} (user's private global instructions for all projects):\n\nUse parameters.`, origin: { kind: 'engine' } })
    w.files.set(RULES_FILE, { text: 'Use parameters, never string concatenation.', mtimeMs: T0 + 10 })
    await prompt($)
    expect(w.notes.at(-1)?.[0]).toBe(`context-restore: db.md (${RULES_FILE}) changed on disk after this session read it. Its current text follows and replaces the earlier one; follow it from now on.\n\nUse parameters, never string concatenation.`)
    await prompt($)
    expect(w.notes.at(-1)).toEqual([])
    expect((await $.command.run(run(''))).text).toBe('on · every skill and command call is checked against its file, 1 rules file(s) watched · last: changed on disk, the new text went to the model: db.md')
  })

  test('the global CLAUDE.md that changed on disk reaches the model whole, and a project CLAUDE.md does not', async ($, on) => {
    const w = world(on)
    const global = '/Users/u/.claude/CLAUDE.md'
    const project = '/work/CLAUDE.md'
    w.files.set(global, { text: '# Rules\n\n- Answer in Turkish.', mtimeMs: T0 - 5 })
    w.files.set(project, { text: '# Project', mtimeMs: T0 - 5 })
    await started($)
    const attachment = `Contents of ${global} (user's private global instructions for all projects):\n\n# Rules\n\n- Answer in Turkish.\n\nContents of ${project} (project instructions, checked into the codebase):\n\n# Project`
    await $.prompt.attachment({ type: 'instructions', text: attachment, origin: { kind: 'engine' } })
    w.files.set(project, { text: '# Project, changed', mtimeMs: T0 + 10 })
    await prompt($)
    expect(w.notes.at(-1)).toEqual([])
    w.files.set(global, { text: '# Rules\n\n- Answer in Turkish.\n- Never use em dashes.', mtimeMs: T0 + 20 })
    await prompt($)
    expect(w.notes.at(-1)).toEqual([`context-restore: CLAUDE.md (${global}) changed on disk after this session read it. Its current text follows and replaces the earlier one; follow it from now on.\n\n# Rules\n\n- Answer in Turkish.\n- Never use em dashes.`])
    expect(w.logs).toEqual(['changed on disk, the new text went to the model: CLAUDE.md'])
    await prompt($)
    expect(w.notes.at(-1)).toEqual([])
  })

  test('off leaves the engine\'s text as it is', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('off'))).text).toBe('off: the engine\'s text stays as it is')
    w.files.set(SKILL_FILE, { text: '# Rules\n\nRule two.\n', mtimeMs: T0 + 10 })
    expect(await call($, 'rules-skill', SKILL)).toBe(SKILL)
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })

  withSidebar('an open sidebar takes the line and the transcript stays clean', async ($, on) => {
    const w = world(on)
    seatSidebar(on, w)
    w.bar.open = true
    await started($)
    w.files.set(SKILL_FILE, { text: '# Rules\n\nRule two.\n', mtimeMs: T0 + 10 })
    await call($, 'rules-skill', SKILL)
    expect(w.bar.lines).toEqual(['changed on disk, the call got the current text: rules-skill'])
    expect(w.logs).toEqual([])
  })
})
