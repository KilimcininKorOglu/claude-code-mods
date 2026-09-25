import { describe, expect, test, tier } from 'claude-code/testing'

import { appendedNote, bodyOfFile, currentText, fitsArguments, rulePathsOf, skillFileOf } from '../hooks/restore.ts'

tier('user')

const SKILL = 'Base directory for this skill: /tmp/ctxprobe/skills/probe-skill\n\nPROBE-SKILL-BODY-START\nReply with the single word: skilled.\nPROBE-SKILL-BODY-END\n'
const COMMAND = 'PROBE-COMMAND-BODY: reply with the single word: commanded.\n'
const PATH = '/tmp/ctxprobe/skills/probe-skill/SKILL.md'

describe('restore', () => {
  test('a skill names its file in its first line, a command names none', () => {
    expect(skillFileOf(SKILL)).toBe(PATH)
    expect(skillFileOf(COMMAND)).toBe(undefined)
  })

  test('a file reads as the engine hands it: no frontmatter, a skill with its directory first', () => {
    const file = '---\nname: probe-skill\ndescription: x\n---\n\nPROBE-SKILL-BODY-START\nReply with the single word: skilled.\nPROBE-SKILL-BODY-END\n'
    expect(bodyOfFile(file, '/tmp/ctxprobe/skills/probe-skill')).toBe(SKILL)
    expect(bodyOfFile('---\ndescription: x\n---\n\n' + COMMAND)).toBe(COMMAND)
  })

  test('a file with no placeholder that reads as the engine\'s text leaves the call alone, whatever its time', () => {
    expect(currentText(SKILL, SKILL, PATH, true)).toBe(undefined)
  })

  test('a file with no placeholder that differs from the engine\'s text takes its place', () => {
    const changed = SKILL.replace('skilled', 'CHANGED')
    expect(currentText(SKILL, changed, PATH, false)).toBe(changed)
  })

  test('a call with arguments of a file with no placeholder keeps its arguments, changed or not', () => {
    // The engine adds the arguments after the file's text (measured on 2.1.280 with the no-ai skill).
    const called = `${SKILL}\n\nARGUMENTS: the README`
    expect(currentText(called, SKILL, PATH, true)).toBe(undefined)
    const changed = SKILL.replace('skilled', 'CHANGED')
    expect(currentText(called, changed, PATH, false)).toBe(`${changed}\n\nARGUMENTS: the README`)
  })

  test('a file with a positional or variable placeholder keeps the engine\'s filled text and adds its current text after it once written since the start', () => {
    const file = 'Review $1 in ${CLAUDE_PLUGIN_ROOT} and report.\n'
    expect(currentText('Review src/a.ts in /p and report.\n', file, PATH, false)).toBe(undefined)
    expect(currentText('Review src/a.ts in /p and report.\n', file, PATH, true)).toBe(`Review src/a.ts in /p and report.\n\n${appendedNote(PATH, file)}`)
  })

  test('a file whose only placeholder is $ARGUMENTS is read as a template, whatever its time', () => {
    const file = 'Review $ARGUMENTS and report.\n'
    // The engine loaded this very file after the session started (a plugin update, then a reload).
    expect(currentText('Review src/a.ts and report.\n', file, PATH, true)).toBe(undefined)
    expect(currentText('Review  and report.', file, PATH, true)).toBe(undefined)
    expect(currentText('Şimdi bana yeni fikirler üret.\n', '$ARGUMENTS\n', PATH, true)).toBe(undefined)
    // The file changed after the engine loaded it: the note follows, also with no write since the start.
    expect(currentText('Check src/a.ts and report.\n', file, PATH, false)).toBe(`Check src/a.ts and report.\n\n${appendedNote(PATH, file)}`)
    expect(fitsArguments('a (b) c*', 'a (b) $ARGUMENTS')).toBe(true)
    expect(fitsArguments('a b c', 'a (b) $ARGUMENTS')).toBe(false)
  })

  test('the rules files and the global CLAUDE.md of an instructions attachment are read from their Contents lines', () => {
    const text = 'Contents of /Users/u/.claude/CLAUDE.md (user\'s private global instructions for all projects):\n\nx\n\nContents of /Users/u/.claude/rules/context7.md (user\'s private global instructions for all projects):\n\ny\n\nContents of /work/CLAUDE.md (project instructions, checked into the codebase):\n\nw\n\nContents of /work/.claude/rules/db.md (project instructions, checked into the codebase):\n\nz'
    expect(rulePathsOf(text, '/Users/u/.claude/CLAUDE.md')).toEqual(['/Users/u/.claude/CLAUDE.md', '/Users/u/.claude/rules/context7.md', '/work/.claude/rules/db.md'])
  })
})
