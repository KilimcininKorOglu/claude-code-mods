import { describe, expect, test, tier } from 'claude-code/testing'
import {
  apply,
  appendTopic,
  buildPrompt,
  changeShort,
  changeText,
  contextText,
  inspect,
  isProjectName,
  parseReply,
  projectNameFrom,
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

  test('refuses a rewrite together with ops', async () => {
    const r = parseReply('{"rewrite":"x","ops":[{"op":"remove","line":"- a"}]}')
    expect(r).toEqual({ ok: false, error: 'rewrite and ops together' })
  })
})

describe('apply', () => {
  test('reports no change for an empty reply', async () => {
    expect(apply('demo', FILE, reply({}))).toEqual({ ok: true, changed: false })
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
    expect(r.changes).toEqual({ added: 2, removed: 0, replaced: 0, created: false, migrated: false })
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

  test('refuses an op whose line is not in the file', async () => {
    const r = apply('demo', FILE, reply({ ops: [{ op: 'remove', line: '- Not there.' }] }))
    expect(r).toEqual({ ok: false, error: 'remove: line not found: - Not there.' })
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

  test('allows a rewrite only for a file without CRITICAL RULES', async () => {
    const old = '# demo\n\n## Overview\n\n- Old fact.\n'
    const migrated = apply('demo', old, reply({ rewrite: skeleton('demo') }))
    if (!migrated.ok || !migrated.changed) throw new Error('expected a change')
    expect(migrated.changes.migrated).toBe(true)
    expect(apply('demo', FILE, reply({ rewrite: skeleton('demo') })).ok).toBe(false)
    expect(apply('demo', undefined, reply({ rewrite: skeleton('demo') })).ok).toBe(false)
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
    const p = buildPrompt('demo', FILE)
    expect(p).toContain('<memory_file>\n# demo')
    expect(p).toContain('{"ops": [...], "topics": [...]}')
    expect(p).not.toContain('MANDATORY MIGRATION')
  })

  test('asks for a rewrite of a file in the old format', async () => {
    const p = buildPrompt('demo', '# demo\n\n## Overview\n')
    expect(p).toContain('MANDATORY MIGRATION')
    expect(p).toContain('{"rewrite": "<the whole new MEMORY.md>"')
  })

  test('asks for an offload near the limit and names long bullets', async () => {
    const big = FILE.replace('- None yet.\n', `${'- x\n'.repeat(180)}- ${'w'.repeat(700)}\n`)
    const p = buildPrompt('demo', big)
    expect(p).toContain('MANDATORY OFFLOAD')
    expect(p).toContain('MANDATORY BULLET SPLIT')
    expect(inspect(big).longBullets).toHaveLength(1)
  })

  test('says so when the file does not exist', async () => {
    expect(buildPrompt('demo', undefined)).toContain('MEMORY.md does not exist yet')
  })
})

describe('session context', () => {
  test('carries the whole file under a project heading and no instruction to write it', async () => {
    const text = contextText('demo', '/m/demo', FILE, [])
    expect(text).toBe(`[PROJECT MEMORY: demo]\n${FILE.trim()}`)
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
    const changes = { added: 12, removed: 1, replaced: 0, created: false, migrated: false }
    const topics = [{ file: 'history.md', append: 'x' }]
    expect(changeText(changes, topics)).toBe('MEMORY.md: 12 added, 1 removed; appended to history.md')
    expect(changeShort(changes, topics)).toBe('+12 -1 topic: history')
  })

  test('changeShort names at most three topic files and counts the rest', async () => {
    const changes = { added: 0, removed: 0, replaced: 2, created: false, migrated: false }
    const topics = ['history.md', 'api.md', 'history.md', 'deploy.md', 'ci.md'].map(file => ({ file, append: 'x' }))
    expect(changeShort(changes, topics)).toBe('~2 topic: history, api, deploy +1')
  })
})
