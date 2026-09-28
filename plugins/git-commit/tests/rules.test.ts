import { describe, expect, test, tier } from 'claude-code/testing'

import { gitCalls } from '../hooks/command.ts'
import { addArgs, commitArgs, pushArgs } from '../hooks/gitargs.ts'
import { addFlagFindings, argumentsOf, blanketReason, commitFlagFindings, denyText, hookSkipFindings, ignoreHits, ignoredFindings, noteText, optionsOf, pushFindings, spreadFindings, typedSkill } from '../hooks/rules.ts'
import type { Finding } from '../hooks/finding.ts'

tier('user')

const shorts = (findings: readonly Finding[]) => findings.map(f => f.short)
const none = new Set<string>()

describe('the skill options', () => {
  test('reads them from skill args, the engine\'s ARGUMENTS line and a typed prompt', async () => {
    expect([...optionsOf('--push --amend please')]).toEqual(['amend', 'push'])
    expect(argumentsOf('# Commit\n\nbody\n\nARGUMENTS: --push deneme')).toBe('--push deneme')
    expect(argumentsOf('# Commit\n\nbody')).toBe('')
    expect([...(typedSkill('/git-commit:commit --no-verify') ?? [])]).toEqual(['no-verify'])
    expect([...(typedSkill('/git-commit:commit') ?? [])]).toEqual([])
    expect(typedSkill('/git-commit mode note')).toBe(undefined)
    expect(typedSkill('commit this please')).toBe(undefined)
  })
})

describe('commitFlagFindings', () => {
  test('stops a commit the skill did not open', async () => {
    expect(shorts(commitFlagFindings(commitArgs(['-m', 'x']), undefined))).toEqual(['skill not opened'])
  })

  test('lets the gated flags through only with the skill option that opens them', async () => {
    const c = commitArgs(['--amend', '--no-verify', '-a', '-m', 'x'])
    expect(shorts(commitFlagFindings(c, none))).toEqual(['--no-verify', '--amend', 'commit -a'])
    expect(shorts(commitFlagFindings(c, new Set(['amend', 'no-verify', 'modified'])))).toEqual([])
  })

  test('always stops the flags the skill never uses', async () => {
    const c = commitArgs(['--allow-empty', '-p', '-m', 'x'])
    expect(shorts(commitFlagFindings(c, new Set(['all', 'amend'])))).toEqual(['--allow-empty', 'commit -p'])
  })
})

describe('addFlagFindings', () => {
  test('passes explicit paths and stops blanket or interactive staging', async () => {
    expect(addFlagFindings(addArgs(['src/a.ts', 'README.md']), none)).toEqual([])
    expect(shorts(addFlagFindings(addArgs(['.']), none))).toEqual(['git add .'])
    expect(shorts(addFlagFindings(addArgs(['-A']), none))).toEqual(['add -A'])
    expect(shorts(addFlagFindings(addArgs(['-u']), none))).toEqual(['add -u'])
    expect(shorts(addFlagFindings(addArgs(['src/*.ts', 'lib/']), none))).toEqual(['git add src/*.ts', 'git add lib/'])
    expect(shorts(addFlagFindings(addArgs(['-p', 'a.ts']), none))).toEqual(['add -p'])
  })

  test('lets --all and --modified open the blanket forms they stand for', async () => {
    expect(addFlagFindings(addArgs(['-A']), new Set(['all']))).toEqual([])
    expect(addFlagFindings(addArgs(['.']), new Set(['all']))).toEqual([])
    expect(addFlagFindings(addArgs(['-u']), new Set(['modified']))).toEqual([])
    expect(shorts(addFlagFindings(addArgs(['-A']), new Set(['modified'])))).toEqual(['add -A'])
  })

  test('says why an operand is a blanket', async () => {
    expect(blanketReason(':/')).toBe('is a pathspec that reaches past the named files')
    expect(blanketReason('..')).toBe('names a whole directory tree')
    expect(blanketReason('a.ts')).toBe(undefined)
  })
})

describe('hookSkipFindings', () => {
  test('stops -c core.hooksPath always and a hook runner variable without --no-verify', async () => {
    const [viaConfig] = gitCalls('git -c core.hooksPath=/dev/null commit -m x')
    const [viaEnv] = gitCalls('HUSKY=0 git commit -m x')
    expect(viaConfig === undefined ? [] : shorts(hookSkipFindings(viaConfig, new Set(['no-verify'])))).toEqual(['-c core.hooksPath'])
    expect(viaEnv === undefined ? [] : shorts(hookSkipFindings(viaEnv, none))).toEqual(['HUSKY=0 skips hooks'])
    expect(viaEnv === undefined ? [] : hookSkipFindings(viaEnv, new Set(['no-verify']))).toEqual([])
  })
})

describe('ignoreHits', () => {
  test('reads check-ignore -v -z and keeps a negated pattern out', async () => {
    const out = '.gitignore\x001\x00secret.txt\x00secret.txt\x00.gitignore\x003\x00!keep.log\x00keep.log\x00/home/u/.gitignore_global\x005\x00CLAUDE.md\x00CLAUDE.md\x00'
    expect(ignoreHits(out)).toEqual([
      { path: 'secret.txt', source: '.gitignore', line: '1', pattern: 'secret.txt' },
      { path: 'CLAUDE.md', source: '/home/u/.gitignore_global', line: '5', pattern: 'CLAUDE.md' },
    ])
  })

  test('names the ignore file and line in the finding', async () => {
    const [f] = ignoredFindings([{ path: 'CLAUDE.md', source: '/home/u/.gitignore_global', line: '5', pattern: 'CLAUDE.md' }], 'commit')
    expect(f?.text.includes('/home/u/.gitignore_global:5')).toBe(true)
    expect(f?.level).toBe('deny')
  })
})

describe('pushFindings', () => {
  test('lets a push through only when it was asked for', async () => {
    expect(shorts(pushFindings(pushArgs(['origin', 'main']), false, none))).toEqual(['push not asked'])
    expect(pushFindings(pushArgs([]), true, none)).toEqual([])
    expect(pushFindings(pushArgs(['--dry-run']), false, none)).toEqual([])
    expect(shorts(pushFindings(pushArgs(['--no-verify']), true, none))).toEqual(['push --no-verify'])
  })
})

describe('spreadFindings', () => {
  test('notes a commit across modules and not one inside a module with root files', async () => {
    expect(spreadFindings(['plugins/a/hooks/x.ts', 'plugins/a/README.md', 'README.md', '.claude-plugin/marketplace.json'])).toEqual([])
    expect(shorts(spreadFindings(['plugins/a/x.ts', 'plugins/b/y.ts']))).toEqual(['2 areas in one commit'])
  })
})

describe('the texts', () => {
  test('the deny text lists each rule and ends at the gate sentence', async () => {
    const text = denyText(commitFlagFindings(commitArgs(['-m', 'x']), undefined))
    expect(text.startsWith('stopped before it ran, because it breaks the git-commit:commit skill:\n- ')).toBe(true)
    expect(text.endsWith('There is no way around this gate.')).toBe(true)
  })

  test('the note text separates rule breaks the note mode let run from notes', async () => {
    const text = noteText([...commitFlagFindings(commitArgs(['-m', 'x']), undefined), ...spreadFindings(['a/b/c', 'd/e/f'])])
    expect(text.includes('(the mode is note, so it ran)')).toBe(true)
    expect(text.includes('git-commit notes on this command:')).toBe(true)
  })
})
