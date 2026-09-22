import { describe, expect, test, tier } from 'claude-code/testing'

import { bodyOfFile, rebuild, rulePathsOf, sectionsOf, skillFileOf } from '../hooks/restore.ts'

tier('user')

const LEAD = 'The following skills were invoked EARLIER in this session (before the conversation was compacted), not on the current turn.\n\nIMPORTANT: Do NOT re-execute these skills.\n\n'
const SKILL = 'Base directory for this skill: /tmp/ctxprobe/skills/probe-skill\n\nPROBE-SKILL-BODY-START\nReply with the single word: skilled.\nPROBE-SKILL-BODY-END\n'
const COMMAND = 'PROBE-COMMAND-BODY: reply with the single word: commanded.\n'
const CUT = '\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'

/** The attachment as the engine wrote it on 2.1.280 (measured), with the skill's body cut. */
const ATTACHMENT = `${LEAD}### Skill: ctxprobe:probe-cmd\nPath: plugin:ctxprobe:probe-cmd\n\n${COMMAND}\n\n---\n\n### Skill: ctxprobe:probe-skill\nPath: plugin:ctxprobe:probe-skill\n\nBase directory for this skill: /tmp/ctxprobe/skills/probe-skill\n\nPROBE-SKILL-BODY-START${CUT}\n`

describe('restore', () => {
  test('reads each section of the attachment, with its name, source and body', () => {
    const parsed = sectionsOf(ATTACHMENT)
    expect(parsed.lead).toBe(LEAD)
    expect(parsed.sections.map(s => [s.name, s.path])).toEqual([['ctxprobe:probe-cmd', 'plugin:ctxprobe:probe-cmd'], ['ctxprobe:probe-skill', 'plugin:ctxprobe:probe-skill']])
    expect(parsed.sections[0]?.body).toBe(COMMAND)
    expect(parsed.sections[1]?.body).toContain('truncated for compaction')
  })

  test('puts the full text in place of a cut body and leaves every other section as it was', () => {
    const { text, changed } = rebuild(sectionsOf(ATTACHMENT), new Map([['ctxprobe:probe-skill', SKILL], ['ctxprobe:probe-cmd', COMMAND]]))
    expect(changed).toEqual(['ctxprobe:probe-skill'])
    expect(text).not.toContain('truncated for compaction')
    expect(text).toContain('PROBE-SKILL-BODY-END')
    expect(text.startsWith(`${LEAD}### Skill: ctxprobe:probe-cmd\nPath: plugin:ctxprobe:probe-cmd\n\n${COMMAND}\n\n---\n\n`)).toBe(true)
  })

  test('a section it knows no text of stays as the engine wrote it', () => {
    const { text, changed } = rebuild(sectionsOf(ATTACHMENT), new Map())
    expect(changed).toEqual([])
    expect(text).toBe(ATTACHMENT)
  })

  test('a skill names its file in its first line, a command names none', () => {
    expect(skillFileOf(SKILL)).toBe('/tmp/ctxprobe/skills/probe-skill/SKILL.md')
    expect(skillFileOf(COMMAND)).toBe(undefined)
  })

  test('a file reads as the engine hands it: no frontmatter, a skill with its directory first', () => {
    const file = '---\nname: probe-skill\ndescription: x\n---\n\nPROBE-SKILL-BODY-START\nReply with the single word: skilled.\nPROBE-SKILL-BODY-END\n'
    expect(bodyOfFile(file, '/tmp/ctxprobe/skills/probe-skill')).toBe(SKILL)
    expect(bodyOfFile('---\ndescription: x\n---\n\n' + COMMAND)).toBe(COMMAND)
  })

  test('the rules files of an instructions attachment are read from their Contents lines', () => {
    const text = 'Contents of /Users/u/.claude/CLAUDE.md (user\'s private global instructions for all projects):\n\nx\n\nContents of /Users/u/.claude/rules/context7.md (user\'s private global instructions for all projects):\n\ny\n\nContents of /work/.claude/rules/db.md (project instructions, checked into the codebase):\n\nz'
    expect(rulePathsOf(text)).toEqual(['/Users/u/.claude/rules/context7.md', '/work/.claude/rules/db.md'])
  })
})
