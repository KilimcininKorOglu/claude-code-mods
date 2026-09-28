import { describe, expect, test, tier } from 'claude-code/testing'

import { gitCalls, heredocsOf, joinPath, splitCommand } from '../hooks/command.ts'

tier('user')

const HEREDOC_COMMIT = [
  'git add a.ts && git commit -m "$(cat <<\'EOF\'',
  'fix: stop reading "git push" in messages',
  '',
  '; git push --force',
  'EOF',
  ')"',
].join('\n')

describe('gitCalls', () => {
  test('lists every git call of a chain in order, with its subcommand and arguments', async () => {
    const calls = gitCalls('git add a.ts b.ts && git commit -m "fix: x" ; git push')
    expect(calls.map(c => c.sub)).toEqual(['add', 'commit', 'push'])
    expect(calls[0]?.args).toEqual(['a.ts', 'b.ts'])
    expect(calls[1]?.args).toEqual(['-m', 'fix: x'])
  })

  test('does not read a commit message as a command', async () => {
    expect(gitCalls(HEREDOC_COMMIT).map(c => c.sub)).toEqual(['add', 'commit'])
    expect(gitCalls('echo "then git push"')).toEqual([])
  })

  test('follows cd and -C to the directory each call runs in', async () => {
    const calls = gitCalls('cd plugins/x && git add a && git -C ../y status && cd /abs && git commit')
    expect(calls.map(c => c.where)).toEqual(['plugins/x', 'plugins/y', '/abs'])
  })

  test('marks the directory unknown when a cd or -C depends on the shell', async () => {
    expect(gitCalls('cd $D && git commit')[0]?.where).toBe(null)
    expect(gitCalls('cd ~/repo && git commit')[0]?.where).toBe(null)
    expect(gitCalls('git -C $W commit')[0]?.where).toBe(null)
  })

  test('keeps the environment, the -c settings and a wrapper out of the subcommand', async () => {
    const [call] = gitCalls('HUSKY=0 env A=1 git -c core.hooksPath=/dev/null -c user.name=x commit -m y')
    expect(call?.sub).toBe('commit')
    expect(call?.env).toEqual(['HUSKY=0', 'A=1'])
    expect(call?.configs).toEqual(['core.hooksPath=/dev/null', 'user.name=x'])
    expect(gitCalls('/usr/bin/git push')[0]?.sub).toBe('push')
  })
})

describe('heredocsOf', () => {
  test('returns each body with the line that opened it', async () => {
    const [doc] = heredocsOf(HEREDOC_COMMIT)
    expect(doc?.tag).toBe('EOF')
    expect(doc?.body).toBe('fix: stop reading "git push" in messages\n\n; git push --force')
    expect(doc?.opener.includes('$(cat')).toBe(true)
  })

  test('drops the leading tabs of a <<- body', async () => {
    expect(heredocsOf('cat <<-END\n\tone\n\t\ttwo\n\tEND')[0]?.body).toBe('one\ntwo')
  })
})

describe('splitCommand', () => {
  test('removes quotes and redirections', async () => {
    expect(splitCommand('git commit -m "a b" 2>&1 | tail -5')).toEqual([['git', 'commit', '-m', 'a b'], ['tail', '-5']])
    expect(splitCommand('git push &> out.log && git status 2> err <in')).toEqual([['git', 'push'], ['git', 'status']])
  })
})

describe('joinPath', () => {
  test('resolves . and .. against a base, relative or absolute', async () => {
    expect(joinPath('', 'a/./b')).toBe('a/b')
    expect(joinPath('a/b', '../c')).toBe('a/c')
    expect(joinPath('a', '../../c')).toBe('../c')
    expect(joinPath('/r/a', '../../..')).toBe('/')
    expect(joinPath('a', '/abs/x')).toBe('/abs/x')
    expect(joinPath('a', '')).toBe('a')
  })
})
