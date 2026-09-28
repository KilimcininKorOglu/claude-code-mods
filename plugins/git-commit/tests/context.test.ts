import { describe, expect, test, tier } from 'claude-code/testing'

import { parseStatus, readNumstat, stateBlock, styleLine } from '../hooks/context.ts'
import { styleOf } from '../hooks/message.ts'

tier('user')

describe('parseStatus', () => {
  test('sorts porcelain v1 -z entries, and skips a rename\'s source', async () => {
    const out = ['## main...origin/main [ahead 2]', 'M  staged.ts', ' M unstaged.ts', 'MM both.ts', 'R  new.ts', 'old.ts', '?? new file.md', 'UU conflict.ts', ''].join('\0')
    expect(parseStatus(out)).toEqual({
      branch: 'main...origin/main [ahead 2]',
      staged: ['staged.ts', 'both.ts', 'new.ts'],
      unstaged: ['unstaged.ts', 'both.ts'],
      untracked: ['new file.md'],
      conflicted: ['conflict.ts'],
    })
  })
})

describe('readNumstat', () => {
  test('sums the lines and keeps each path, a binary file and a path with a tab included', async () => {
    expect(readNumstat('3\t1\tsrc/a.ts\0-\t-\timg.png\x000\t2\tweird\tname\0')).toEqual({ names: ['src/a.ts', 'img.png', 'weird\tname'], lines: 6 })
    expect(readNumstat('')).toEqual({ names: [], lines: 0 })
  })
})

describe('stateBlock', () => {
  test('holds the branch, the lists, the options, the style and the subjects', async () => {
    const status = parseStatus(['## main', 'M  a.ts', ''].join('\0'))
    const subjects = ['feat(x): add a', 'fix: b', 'docs: c']
    const block = stateBlock(status, subjects, styleOf(subjects), new Set(['push']), ['staged .env is a secret file'])
    expect(block.includes('Branch: main')).toBe(true)
    expect(block.includes('Staged (1): a.ts')).toBe(true)
    expect(block.includes('Untracked: none')).toBe(true)
    expect(block.includes('Options this skill was opened with: --push')).toBe(true)
    expect(block.includes('Style: conventional commits (3 of the last 3 subjects), the description starts lowercase')).toBe(true)
    expect(block.includes('  fix: b')).toBe(true)
    expect(block.includes('  - staged .env is a secret file')).toBe(true)
  })

  test('cuts a long list and says how to see the rest', async () => {
    const status = parseStatus(['## main', ...Array.from({ length: 45 }, (_, i) => `?? f${i}`), ''].join('\0'))
    const block = stateBlock(status, [], styleOf([]), new Set(), [])
    expect(block.includes('Untracked (45): f0,')).toBe(true)
    expect(block.includes('and 5 more (run git status for the whole list)')).toBe(true)
  })
})

describe('styleLine', () => {
  test('names the skill\'s default where the log shows no style', async () => {
    expect(styleLine(styleOf([]))).toBe('Style: no commits yet; the skill\'s default is `type(scope): subject`')
    expect(styleLine(styleOf(['Add a', 'Fix b', 'Update c'])).startsWith('Style: 0 of the last 3 subjects are conventional')).toBe(true)
  })
})
