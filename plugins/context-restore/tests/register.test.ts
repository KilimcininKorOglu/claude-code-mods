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

const SKILL_DIR = '/Users/u/.claude/skills/rules-skill'
const SKILL_FILE = `${SKILL_DIR}/SKILL.md`
const SKILL = `Base directory for this skill: ${SKILL_DIR}\n\n# Rules\n\nRule one.\nRule two.\nRule three.\n`
const RULES_FILE = '/Users/u/.claude/rules/db.md'
const LEAD = 'The following skills were invoked EARLIER in this session (before the conversation was compacted), not on the current turn.\n\n'
const CUT = `Base directory for this skill: ${SKILL_DIR}\n\n# Rules\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]\n`

/** The attachment after a compaction: the skill cut, and a built-in command with no file. */
const INVOKED = `${LEAD}### Skill: rules-skill\nPath: userSettings:rules-skill\n\n${CUT}\n\n---\n\n### Skill: init\nPath: builtin:init\n\nPlease analyze this codebase.\n`

const run = (args: string): CommandRunInput => ({ command: 'context-restore', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

/** Files on disk with their last write, what the model was last handed, and what the person read. */
type World = { files: Map<string, { text: string; mtimeMs: number }>; attachments: string[]; notes: string[][]; logs: string[]; bar: { open: boolean; lines: string[] } }

function world(on: On): World {
  const w: World = {
    files: new Map([[SKILL_FILE, { text: '---\nname: rules-skill\ndescription: x\n---\n\n# Rules\n\nRule one.\nRule two.\nRule three.\n', mtimeMs: 1 }], [RULES_FILE, { text: 'Use parameters.', mtimeMs: 1 }]]),
    attachments: [],
    notes: [],
    logs: [],
    bar: { open: false, lines: [] },
  }
  mock.store(on, {})
  mock.env(on, { HOME: '/Users/u' })
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
  on('prompt.attachment', (_, e) => { w.attachments.push(e.text); return { text: e.text } })
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
const invoked = ($: Engine) => $.prompt.attachment({ type: 'invoked_skills', text: INVOKED, origin: { kind: 'engine' } })
const prompt = ($: Engine, text = 'go') => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })

describe('context-restore', () => {
  test('a skill the session used gets its full text back after a compaction cut it', async ($, on) => {
    const w = world(on)
    await started($)
    await $.skill.prompt({ skill: 'rules-skill', text: SKILL })
    await invoked($)
    expect(w.attachments.at(-1)).toContain('Rule three.')
    expect(w.attachments.at(-1)).not.toContain('truncated for compaction')
    // A built-in command has no file and no record: its body stays as the engine wrote it.
    expect(w.attachments.at(-1)).toContain('### Skill: init\nPath: builtin:init\n\nPlease analyze this codebase.\n')
    expect(w.logs).toEqual(['restored after compaction: rules-skill'])
  })

  test('a resumed session with no record of the skill reads its file', async ($, on) => {
    const w = world(on)
    await started($)
    await invoked($)
    expect(w.attachments.at(-1)).toContain(`${LEAD}### Skill: rules-skill\nPath: userSettings:rules-skill\n\n${SKILL.trimEnd()}\n\n---\n\n`)
  })

  test('a skill file changed on disk reaches the model once, with its new text', async ($, on) => {
    const w = world(on)
    await started($)
    await $.skill.prompt({ skill: 'rules-skill', text: SKILL })
    await prompt($)
    expect(w.notes.at(-1)).toEqual([])
    w.files.set(SKILL_FILE, { text: '---\nname: rules-skill\n---\n\n# Rules\n\nRule four.\n', mtimeMs: 2 })
    await prompt($)
    expect(w.notes.at(-1)).toEqual([`context-restore: rules-skill (${SKILL_FILE}) changed on disk after this session read it. Its current text follows and replaces the earlier one; follow it from now on.\n\nBase directory for this skill: ${SKILL_DIR}\n\n# Rules\n\nRule four.\n`])
    expect(w.logs).toEqual(['changed on disk, the new text went to the model: rules-skill'])
    await prompt($)
    expect(w.notes.at(-1)).toEqual([])
  })

  test('a rules file the session read and that changed on disk reaches the model', async ($, on) => {
    const w = world(on)
    await started($)
    await $.prompt.attachment({ type: 'instructions', text: `Contents of ${RULES_FILE} (user's private global instructions for all projects):\n\nUse parameters.`, origin: { kind: 'engine' } })
    w.files.set(RULES_FILE, { text: 'Use parameters, never string concatenation.', mtimeMs: 5 })
    await prompt($)
    expect(w.notes.at(-1)?.[0]).toBe(`context-restore: db.md (${RULES_FILE}) changed on disk after this session read it. Its current text follows and replaces the earlier one; follow it from now on.\n\nUse parameters, never string concatenation.`)
    expect((await $.command.run(run(''))).text).toBe('on · 0 skill(s) and command(s), 1 rules file(s) watched · last: changed on disk, the new text went to the model: db.md')
  })

  test('off leaves the engine\'s text as it is', async ($, on) => {
    const w = world(on)
    await started($)
    expect((await $.command.run(run('off'))).text).toBe('off: the engine\'s text stays as it is')
    await $.skill.prompt({ skill: 'rules-skill', text: SKILL })
    await invoked($)
    expect(w.attachments.at(-1)).toBe(INVOKED)
    expect((await $.command.run(run('x'))).text).toBe('expects nothing (the status), on or off')
  })

  withSidebar('an open sidebar takes the line and the transcript stays clean', async ($, on) => {
    const w = world(on)
    seatSidebar(on, w)
    w.bar.open = true
    await started($)
    await $.skill.prompt({ skill: 'rules-skill', text: SKILL })
    await invoked($)
    expect(w.bar.lines).toEqual(['restored after compaction: rules-skill'])
    expect(w.logs).toEqual([])
  })
})
