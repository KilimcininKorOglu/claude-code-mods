import { describe, expect, test, tier } from 'claude-code/testing'
import {
  apply,
  appendTopic,
  buildPrompt,
  changeShort,
  changeText,
  contextText,
  LANGUAGE_NOTE,
  inspect,
  isProjectName,
  parseReply,
  projectNameFrom,
  repairSections,
  skeleton,
  topicFiles,
  validate,
  type Reply,
} from '../hooks/memory.ts'

tier('user')

const FILE = `# demo

## CRITICAL RULES

- Run \`make test\` before a commit.

## Architecture & Config Facts

- The API lives in \`api/\`.

## Active Warnings

- None yet.

## Topic Files

- None yet.
`

const reply = (r: Partial<Reply>): Reply => ({ ops: [], topics: [], ...r })

describe('projectNameFrom', () => {
  test('names the repository from its .git directory', async () => {
    expect(projectNameFrom('/src/app/.git\n', '/src/app', '/src/app/pkg')).toBe('app')
  })

  test('names the primary repository inside a worktree', async () => {
    expect(projectNameFrom('/src/app/.git/worktrees/fix-1', '/tmp/wt/fix-1', '/tmp/wt/fix-1')).toBe('app')
  })

  test('falls back to the top level, then to the working directory', async () => {
    expect(projectNameFrom('', '/src/other', '/src/other/x')).toBe('other')
    expect(projectNameFrom('', '', '/home/u/notes')).toBe('notes')
  })

  test('refuses a name that is not a safe directory name', async () => {
    expect(isProjectName('my-app.v2')).toBe(true)
    expect(isProjectName('..')).toBe(false)
    expect(isProjectName('a b')).toBe(false)
  })
})

describe('parseReply', () => {
  test('reads a bare object and one inside a code fence', async () => {
    const ok = parseReply('{"ops":[{"op":"remove","line":"- x"}]}')
    expect(ok).toEqual({ ok: true, reply: { ops: [{ op: 'remove', line: '- x' }], topics: [] } })
    const fenced = parseReply('```json\n{"ops":[],"topics":[]}\n```')
    expect(fenced.ok).toBe(true)
  })

  test('matches a section name without regard to case', async () => {
    const r = parseReply('{"ops":[{"op":"add","section":"critical rules","text":"- a"}]}')
    expect(r).toEqual({ ok: true, reply: { ops: [{ op: 'add', section: 'CRITICAL RULES', text: '- a' }], topics: [] } })
  })

  test('refuses text that is not JSON', async () => {
    expect(parseReply('Nothing new.')).toEqual({ ok: false, error: 'reply has no JSON object' })
    expect(parseReply('{ops: }').ok).toBe(false)
  })

  test('refuses an unknown section, a multi-line bullet and an unknown op', async () => {
    expect(parseReply('{"ops":[{"op":"add","section":"Misc","text":"- a"}]}').ok).toBe(false)
    expect(parseReply('{"ops":[{"op":"add","section":"Active Warnings","text":"- a\\n- b"}]}').ok).toBe(false)
    expect(parseReply('{"ops":[{"op":"move","line":"- a"}]}').ok).toBe(false)
  })

  test('refuses a topic file name that could reach another file', async () => {
    for (const file of ['../x.md', 'MEMORY.md', 'memory.md', 'notes.txt', 'a/b.md']) {
      expect(parseReply(`{"topics":[{"file":"${file}","append":"x"}]}`).ok, file).toBe(false)
    }
  })

})

describe('apply', () => {
  test('reports no change for an empty reply', async () => {
    expect(apply('demo', FILE, reply({}))).toEqual({ ok: true, changed: false, skipped: [] })
  })

  test('adds a bullet at the end of its section and replaces the placeholder', async () => {
    const r = apply('demo', FILE, reply({
      ops: [
        { op: 'add', section: 'CRITICAL RULES', text: 'Use pnpm.' },
        { op: 'add', section: 'Active Warnings', text: '- The cache is stale after a rebase.' },
      ],
    }))
    if (!r.ok || !r.changed) throw new Error('expected a change')
    expect(r.text).toContain('- Run `make test` before a commit.\n- Use pnpm.\n\n## Architecture')
    expect(r.text).toContain('## Active Warnings\n\n- The cache is stale after a rebase.\n\n## Topic Files')
    expect(r.text).not.toContain('## Active Warnings\n\n- None yet.')
    expect(r.changes).toEqual({ added: 2, removed: 0, replaced: 0, created: false, skipped: [] })
  })

  test('removes and replaces exact lines', async () => {
    const r = apply('demo', FILE, reply({
      ops: [
        { op: 'replace', line: '- Run `make test` before a commit.', text: '- Run `make check` before a commit.' },
        { op: 'remove', line: '- The API lives in `api/`.' },
      ],
    }))
    if (!r.ok || !r.changed) throw new Error('expected a change')
    expect(r.text).toContain('- Run `make check` before a commit.')
    expect(r.text).not.toContain('api/')
  })

  test('finds a plain paragraph line the fork names as a bullet, and only when one line matches', async () => {
    const withParagraph = FILE.replace('## Active Warnings', '`scripts/test_*.py` are probe scripts.\n\n## Active Warnings')
    const r = apply('demo', withParagraph, reply({ ops: [{ op: 'remove', line: '- `scripts/test_*.py` are probe scripts.' }] }))
    if (!r.ok || !r.changed) throw new Error(JSON.stringify(r))
    expect(r.text).not.toContain('probe scripts')
    const twice = `${withParagraph}\n- \`scripts/test_*.py\` are probe scripts.\n`
    expect(apply('demo', twice, reply({ ops: [{ op: 'remove', line: '* `scripts/test_*.py` are probe scripts.' }] }))).toEqual({
      ok: true,
      changed: false,
      skipped: ['* `scripts/test_*.py` are probe scripts.'],
    })
  })

  test('skips a remove or replace whose line is not in the file, applies the rest, and names it', async () => {
    const r = apply('demo', FILE, reply({
      ops: [
        { op: 'remove', line: '- **Run `make test` before a commit.**' },
        { op: 'add', section: 'Active Warnings', text: '- New warning.' },
      ],
    }))
    if (!r.ok || !r.changed) throw new Error(JSON.stringify(r))
    expect(r.text).toContain('- Run `make test` before a commit.')
    expect(r.text).toContain('- New warning.')
    expect(r.changes).toEqual({ added: 1, removed: 0, replaced: 0, created: false, skipped: ['- **Run `make test` before a commit.**'] })
    expect(changeText(r.changes, [])).toBe('MEMORY.md: 1 added; 1 skipped, not in the file: - **Run `make test` before a commit.**')
    expect(changeShort(r.changes, [])).toBe('+1 1 skipped')
  })

  test('names the skipped lines to the next fork and asks for an exact copy', async () => {
    const prompt = buildPrompt('demo', '/m/demo', FILE, ['- **Walk a backfill.**'])
    expect(prompt).toContain('MANDATORY EXACT COPY')
    expect(prompt).toContain('  - - **Walk a backfill.**')
    expect(buildPrompt('demo', '/m/demo', FILE)).not.toContain('MANDATORY EXACT COPY')
  })

  test('starts a missing file from the skeleton', async () => {
    const r = apply('demo', undefined, reply({ ops: [{ op: 'add', section: 'CRITICAL RULES', text: '- Use pnpm.' }] }))
    if (!r.ok || !r.changed) throw new Error('expected a change')
    expect(r.text).toBe(`${skeleton('demo').replace('## CRITICAL RULES\n', '## CRITICAL RULES\n\n- Use pnpm.\n')}`)
    expect(r.changes.created).toBe(true)
    expect(validate(r.text, r.newBullets)).toEqual([])
  })

  test('lists a new topic file under Topic Files once', async () => {
    const topics = [{ file: 'history.md', append: '- 2026-09-18: moved the API.' }]
    const r = apply('demo', FILE, reply({ topics }))
    if (!r.ok || !r.changed) throw new Error('expected a change')
    expect(r.text).toContain('## Topic Files\n\n- `history.md`.\n')
    if (!r.ok || !r.changed) return
    const again = apply('demo', r.text, reply({ topics }))
    if (!again.ok || !again.changed) throw new Error('expected a change')
    expect(again.text.split('history.md')).toHaveLength(2)
  })

})

describe('repairSections', () => {
  test('adds a missing section, puts the sections in order and merges a repeated one', async () => {
    const broken = '# demo\n\n## Topic Files\n\n- `a.md`.\n\n## CRITICAL RULES\n\n- One.\n\n## critical rules\n\n- Two.\n'
    expect(repairSections('demo', broken)).toBe(
      '# demo\n\n## CRITICAL RULES\n\n- One.\n\n- Two.\n\n## Architecture & Config Facts\n\n- None yet.\n\n## Active Warnings\n\n- None yet.\n\n## Topic Files\n\n- `a.md`.\n',
    )
  })

  test('keeps a section outside the template as an unsorted part of Architecture & Config Facts', async () => {
    const r = repairSections('demo', '# demo\n\n## Architecture & Config Facts\n\n- Fact.\n\n## Overview\n\n### Sub\n- Old.\n')
    expect(r).toContain('## Architecture & Config Facts\n\n- Fact.\n\n### Unsorted: Overview\n\n### Sub\n- Old.\n\n## Active Warnings')
  })

  test('asks the fork to sort the unsorted parts, and only when there are some', async () => {
    const r = repairSections('demo', `${FILE}\n## Overview\n\n- Old.\n`)
    expect(buildPrompt('demo', '/m/demo', r)).toContain("MANDATORY SORT: the mod moved sections outside the template under these headings: ### Unsorted: Overview.")
    expect(buildPrompt('demo', '/m/demo', FILE)).not.toContain('MANDATORY SORT')
  })

  test('the fork can remove an unsorted heading once its bullets moved', async () => {
    const r = repairSections('demo', `${FILE}\n## Overview\n\n- Old.\n`)
    const sorted = apply('demo', r, reply({
      ops: [
        { op: 'remove', line: '- Old.' },
        { op: 'add', section: 'Active Warnings', text: '- Old.' },
        { op: 'remove', line: '### Unsorted: Overview' },
      ],
    }))
    if (!sorted.ok || !sorted.changed) throw new Error('expected a change')
    expect(sorted.text).not.toContain('Unsorted')
    expect(validate(sorted.text, sorted.newBullets)).toEqual([])
  })

  test('gives a file without a title the project title, and every result passes the section check', async () => {
    for (const text of ['', '- stray\n', FILE, `${FILE}\n## Notes\n\n- n\n`, '## Active Warnings\n\n- w\n']) {
      const r = repairSections('demo', text)
      expect(inspect(r).inFormat, text).toBe(true)
      expect(validate(r, [])).toEqual([])
    }
    expect(repairSections('demo', '## Topic Files\n')).toMatch(/^# demo\n\n## CRITICAL RULES/)
  })
})

describe('validate', () => {
  test('accepts the four sections in order', async () => {
    expect(validate(FILE, [])).toEqual([])
  })

  test('refuses missing, extra or reordered sections', async () => {
    expect(validate('# x\n\n## CRITICAL RULES\n', [])).toHaveLength(1)
    expect(validate(`${FILE}\n## Notes\n`, [])).toHaveLength(1)
    const swapped = FILE.replace('## Active Warnings', '## TMP').replace('## Architecture & Config Facts', '## Active Warnings').replace('## TMP', '## Architecture & Config Facts')
    expect(validate(swapped, [])).toHaveLength(1)
  })

  test('refuses a file at the line or character limit and a long new bullet', async () => {
    const lines = `${FILE}${'- x\n'.repeat(200)}`
    expect(validate(lines, [])[0]).toContain('lines, the limit is under 200')
    const chars = FILE.replace('- None yet.\n', `- ${'y'.repeat(50_000)}\n`)
    expect(validate(chars, []).join()).toContain('characters, the limit is under 50000')
    expect(validate(FILE, [`- ${'z'.repeat(600)}`])).toEqual(['1 new bullet(s) over 600 characters'])
  })
})

describe('buildPrompt', () => {
  test('carries the current file and the reply format', async () => {
    const p = buildPrompt('demo', '/m/demo', FILE)
    expect(p).toContain('<memory_file>\n# demo')
    expect(p).toContain('{"ops": [...], "topics": [...]}')
  })

  test('asks for an offload near the limit and names long bullets', async () => {
    const big = FILE.replace('- None yet.\n', `${'- x\n'.repeat(180)}- ${'w'.repeat(700)}\n`)
    const p = buildPrompt('demo', '/m/demo', big)
    expect(p).toContain('MANDATORY OFFLOAD')
    expect(p).toContain('MANDATORY BULLET SPLIT')
    expect(inspect(big).longBullets).toHaveLength(1)
  })

  test("carries the user's classic hook rules word for word, without the stop wording", async () => {
    const p = buildPrompt('demo', '/m/demo', FILE)
    expect(p).toContain('you MUST record it in /m/demo/MEMORY.md in imperative mood')
    expect(p).toContain('Enforce this at WRITE time, not merely as an afterthought.')
    expect(p).toContain('Do NOT cram multiple ideas into one long line to dodge the line cap — the character cap catches that.')
    expect(p).toContain('4. Write in English ONLY. Rules 4 to 8 apply to MEMORY.md and to every topic file alike.')
    expect(p).not.toMatch(/before stopping|just stop|this same session|THIS session/)
    expect(p).not.toContain('MANDATORY MIGRATION')
    expect(buildPrompt('demo', '/m/demo', FILE.replace('## CRITICAL RULES', '## Rules'))).toContain('MANDATORY MIGRATION: MEMORY.md is MISSING')
    const fresh = buildPrompt('demo', '/m/demo', undefined)
    expect(fresh).toContain('You MUST create /m/demo/MEMORY.md following the template below')
    expect(fresh).toContain('MEMORY.md MUST use exactly these four sections, in this order:')
  })

  test('says so when the file does not exist', async () => {
    expect(buildPrompt('demo', '/m/demo', undefined)).toContain('MEMORY.md does not exist yet')
  })
})

describe('session context', () => {
  test('carries the reply language rule and the whole file under a project heading, and no instruction to write it', async () => {
    const text = contextText('demo', '/m/demo', FILE, [])
    expect(text).toBe(`[PROJECT MEMORY: demo]\n${LANGUAGE_NOTE}\n\n${FILE.trim()}`)
    expect(LANGUAGE_NOTE).toContain('also at the end of a long turn')
    expect(text).not.toMatch(/write|save/i)
  })

  test('names the topic files and their directory', async () => {
    expect(contextText('demo', '/m/demo', FILE, ['history.md', 'api.md'])).toEndWith('\n\nTopic files in /m/demo: history.md, api.md')
  })

  test('topicFiles keeps other markdown files, sorted, without MEMORY.md and the migration backup', async () => {
    const names = ['MEMORY.md', 'history.md', 'MEMORY.pre-migration.md', 'notes.txt', 'api.md']
    expect(topicFiles(names)).toEqual(['api.md', 'history.md'])
  })
})

describe('texts', () => {
  test('appendTopic titles a new file and appends to an old one', async () => {
    expect(appendTopic('demo', 'history.md', undefined, '- a')).toBe('# demo: history\n\n- a\n')
    expect(appendTopic('demo', 'history.md', '# t\n\n- a\n', '- b')).toBe('# t\n\n- a\n\n- b\n')
  })

  test('changeText and changeShort name every change', async () => {
    const changes = { added: 12, removed: 1, replaced: 0, created: false, skipped: [] }
    const topics = [{ file: 'history.md', append: 'x' }]
    expect(changeText(changes, topics)).toBe('MEMORY.md: 12 added, 1 removed; appended to history.md')
    expect(changeShort(changes, topics)).toBe('+12 -1 topic: history')
  })

  test('changeShort names at most three topic files and counts the rest', async () => {
    const changes = { added: 0, removed: 0, replaced: 2, created: false, skipped: [] }
    const topics = ['history.md', 'api.md', 'history.md', 'deploy.md', 'ci.md'].map(file => ({ file, append: 'x' }))
    expect(changeShort(changes, topics)).toBe('~2 topic: history, api, deploy +1')
  })
})
