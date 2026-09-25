import { describe, expect, test, tier } from 'claude-code/testing'

import { correctionsOf, discoverText, finish, learnFile, learnText, scan, scannerOf, type BashCall } from '../hooks/history.ts'
import { callRows } from './transcript.ts'

tier('user')

const call = (command: string, output: string, exitCode?: number, session = 's1'): BashCall => ({ session, command, output, exitCode })

describe('transcript scan', () => {
  test('a call and its result pair up across pieces cut mid-line; other tools and hook refusals are read right', () => {
    const rows = [
      ...callRows('a', 'git status', 'On branch main\n'),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ tool_use_id: 'r', type: 'tool_result', content: 'file text' }] } }),
      ...callRows('b', 'cargo tset', 'Exit code 101\nerror: no such command: `tset`', true),
      ...callRows('c', 'cat /x', 'PreToolUse:Bash hook error: blocked', true),
    ].join('\n')
    const s = scannerOf('s1')
    for (let i = 0; i < rows.length; i += 37) scan(s, rows.slice(i, i + 37))
    const calls = finish(s)
    expect(calls).toEqual([
      call('git status', 'On branch main\n'),
      call('cargo tset', 'Exit code 101\nerror: no such command: `tset`', 101),
      call('cat /x', 'PreToolUse:Bash hook error: blocked'),
    ])
    expect(s.bad).toBe(0)
  })

  test('a result given as text parts is read whole', () => {
    const s = scannerOf('s1')
    scan(s, `${JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls' } }] } })}\n`)
    scan(s, JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'a.ts' }, { type: 'image' }] }] } }))
    expect(finish(s)).toEqual([call('ls', 'a.ts\n')])
  })
})

describe('discover', () => {
  test('the output is grouped by filter, and the commands no filter reads come first', () => {
    const calls = [
      call('node -e "big"', 'x'.repeat(4000)),
      call('node -e "small"', 'x'.repeat(400)),
      call('git status', 'x'.repeat(800)),
      call('cd a && npm test && cargo test', 'x'.repeat(40)),
      call('BASH_DIET_RAW=1 git diff', 'x'.repeat(80)),
      call('cat > f <<EOF\nx\nEOF', ''),
    ]
    expect(discoverText(calls, 2, 30)).toBe([
      '6 Bash calls in 2 session(s) of the last 30 days; the model read ~1.3k tokens of their output',
      'no filter reads these (a rule in .bash-diet/filters.json can):',
      '  node  2 calls  ~1.1k tokens',
      'a filter reads these:',
      '  git status  1 call  ~200 tokens',
      'chains of several commands (the generic cleanup reads them):',
      '  chain  1 call  ~10 tokens',
      'left alone (substitution, heredoc or a redirect to a file):',
      '  opaque  1 call  ~0 tokens',
      'left raw on purpose (BASH_DIET_RAW=1):',
      '  raw  1 call  ~20 tokens',
    ].join('\n'))
    expect(discoverText([], 0, 7)).toBe('no Bash call in 0 session(s) of the last 7 days')
  })
})

describe('learn', () => {
  test('a failed command with a CLI mistake and the similar one that worked after it make a correction', () => {
    const calls = [
      call('git log --onelin -5', 'Exit code 128\nfatal: unrecognized argument: --onelin', 128),
      call('ls', 'a'),
      call('git log --oneline -5', 'abc fix'),
      call('git log --onelin -5', 'Exit code 128\nfatal: unrecognized argument: --onelin', 128),
      call('git log --oneline -5', 'abc fix'),
    ]
    expect(correctionsOf(calls)).toEqual([{ wrong: 'git log --onelin -5', right: 'git log --oneline -5', kind: 'unknown flag', count: 2 }])
    expect(learnText(correctionsOf(calls), 1, 30)).toBe('1 corrected command(s) in 1 session(s) of the last 30 days:\n- `git log --onelin -5` failed (unknown flag); `git log --oneline -5` worked (2 times).')
    expect(learnFile(correctionsOf(calls))).toBe('# CLI corrections\n\nCommands that failed in earlier sessions of this project, and the form that worked after them. Use the form that worked.\n\n- `git log --onelin -5` failed (unknown flag); `git log --oneline -5` worked (2 times).\n')
  })

  test('a chain, a wrong path, a credential, another session, a test failure and a far fix make none', () => {
    const flag = (cmd: string, session = 's1') => call(cmd, 'Exit code 2\nerror: unknown option --x', 2, session)
    const calls = [
      flag('cd a && make --x'), call('cd a && make', 'ok'),
      call('cat src/a.ts', 'Exit code 1\ncat: src/a.ts: No such file or directory', 1), call('cat lib/a.ts', 'ok'),
      flag('curl --x -H "Authorization: Bearer abc" u'), call('curl -H "Authorization: Bearer abc" u', 'ok'),
      flag('tar --x a', 's1'), call('tar a', 'ok', undefined, 's2'),
      call('cargo test', 'Exit code 101\ntest result: FAILED', 101), call('cargo test --lib', 'ok'),
      flag('rg --x a'), call('ls', ''), call('ls', ''), call('ls', ''), call('rg a', 'ok'),
    ]
    expect(correctionsOf(calls)).toEqual([])
    expect(learnText([], 3, 30)).toBe('no corrected command in 3 session(s) of the last 30 days')
  })
})
