import { describe, expect, test, tier } from 'claude-code/testing'

import { combinedText, diffCommands, fileCount, findCommit, newFileDiff, splitCommand, stripHeredocs } from '../hooks/commit.ts'

tier('user')

const plain = { skip: false, tracked: false, untracked: false, paths: [], only: [], before: [] }

describe('findCommit', () => {
  test('finds a plain commit and what it records', async () => {
    expect(findCommit('git commit -m "fix: the parser"')).toEqual(plain)
    expect(findCommit('git commit -am "wip"')).toEqual({ ...plain, tracked: true })
    expect(findCommit('git commit --all -m x')).toEqual({ ...plain, tracked: true })
    expect(findCommit('git commit -m x src/a.ts -- b.ts')).toEqual({ ...plain, only: ['src/a.ts', 'b.ts'] })
  })

  test('reads what the same command stages before the commit', async () => {
    expect(findCommit('git add src/a.ts "docs/b c.md" && git commit -m x')).toEqual({ ...plain, paths: ['src/a.ts', 'docs/b c.md'] })
    expect(findCommit('git add -A && git commit -m x')).toEqual({ ...plain, tracked: true, untracked: true })
    expect(findCommit('git add -u; git commit -m x')).toEqual({ ...plain, tracked: true })
    expect(findCommit('git add . && git commit -m x')).toEqual({ ...plain, paths: ['.'] })
  })

  test('reads the directory, the skip prefix and a redirection', async () => {
    expect(findCommit('cd plugins/x && git commit -m y')).toEqual({ ...plain, cwd: 'plugins/x' })
    expect(findCommit('git -C /repo commit -m y')).toEqual({ ...plain, cwd: '/repo' })
    expect(findCommit('GEMINI_REVIEW_SKIP=1 git commit -m y')).toEqual({ ...plain, skip: true })
    expect(findCommit('git commit -m y 2>&1 | tail -5')).toEqual(plain)
  })

  test('does not read a commit message as a command', async () => {
    const heredoc = [
      'git add a.ts && git commit -m "$(cat <<\'EOF\'',
      'fix: stop reading "git commit" in messages',
      '',
      '; git commit --all',
      'EOF',
      ')"',
    ].join('\n')
    expect(findCommit(heredoc)).toEqual({ ...plain, paths: ['a.ts'] })
    expect(findCommit('echo "then git commit -a"')).toBe(undefined)
  })

  test('names the commands before the commit other than cd and git add, and none after it', async () => {
    expect(findCommit("echo '// v2' >> math.ts && git commit -am 'docs: v2'")?.before).toEqual(['echo'])
    expect(findCommit('npm test && git status && git add -A && git commit -m x')?.before).toEqual(['npm', 'git status'])
    expect(findCommit('cd sub && git -C .. add a.ts && git commit -m x && git push')?.before).toEqual([])
    expect(combinedText(['sed', 'sed', 'git status'])).toContain('it runs `sed`, `git status` before git commit')
  })

  test('a command that records nothing is no commit', async () => {
    for (const command of ['git log --oneline -3', 'git commit --help', 'git commit --dry-run -m x', 'git status', 'ls -la']) {
      expect(findCommit(command), command).toBe(undefined)
    }
  })
})

describe('splitCommand', () => {
  test('splits on the operators outside quotes and keeps quoted words whole', async () => {
    expect(splitCommand(`a 'b && c' && d "e;f" | g\nh`)).toEqual([['a', 'b && c'], ['d', 'e;f'], ['g'], ['h']])
    expect(stripHeredocs('x <<EOF\nbody\nEOF\ny')).toBe('x <<EOF\ny')
  })
})

describe('diffCommands', () => {
  const git = ['git', 'diff', '--no-color', '--no-ext-diff']

  test('the index, with a path the command stages read from the working tree instead', async () => {
    expect(diffCommands(plain, true)).toEqual({ diffs: [[...git, '--cached']] })
    expect(diffCommands({ ...plain, tracked: true }, true)).toEqual({ diffs: [[...git, 'HEAD', '--', ':/']] })
    // The index still holds the older a.ts until `git add` runs, so a.ts is left out of `--cached`.
    expect(diffCommands({ ...plain, paths: ['a.ts'] }, true)).toEqual({
      diffs: [[...git, '--cached', '--', ':/', ':(exclude)a.ts'], [...git, 'HEAD', '--', 'a.ts']],
      untracked: ['git', 'ls-files', '--others', '--exclude-standard', '--', 'a.ts'],
    })
    expect(diffCommands({ ...plain, tracked: true, untracked: true }, true).untracked).toEqual(['git', 'ls-files', '--others', '--exclude-standard'])
  })

  test('a commit pathspec records only those paths, from the working tree', async () => {
    expect(diffCommands({ ...plain, only: ['a.ts'] }, true)).toEqual({ diffs: [[...git, 'HEAD', '--', 'a.ts']] })
  })

  test('without a HEAD the working tree is read over the index', async () => {
    expect(diffCommands({ ...plain, tracked: true }, false).diffs).toEqual([[...git, '--cached', '--', ':/'], [...git, '--', ':/']])
    expect(diffCommands({ ...plain, paths: ['a.ts'] }, false).diffs).toEqual([[...git, '--cached'], [...git, '--', 'a.ts']])
    expect(newFileDiff('n.ts')).toEqual([...git, '--no-index', '--', '/dev/null', 'n.ts'])
    expect(fileCount('diff --git a/x b/x\n+1\ndiff --git a/y b/y\n')).toBe(2)
  })
})
