import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult } from '../hooks/filters/common.ts'
import { GH, markdownBody } from '../hooks/filters/gh.ts'
import { GIT } from '../hooks/filters/git.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

/** Runs a table entry the way the pipeline does. */
function run(key: string, text: string, args: string[] = [], exitCode = 0): FilterResult {
  const filter = GIT[key] ?? GH[key]
  if (filter === undefined) throw new Error(`no filter ${key}`)
  return filter.run({ args, text, exitCode })
}

const saving = (raw: string, out: string): number => Math.round((1 - out.length / raw.length) * 100)

// Captured from git 2.x with LC_ALL=C in a scratch repository.
const STATUS = 'On branch main\nChanges to be committed:\n  (use "git restore --staged <file>..." to unstage)\n\tnew file:   added.txt\n\tdeleted:    old.txt\n\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n\tmodified:   app.txt\n\tmodified:   log.txt\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tuntracked1.txt\n\tuntracked2.txt\n\n'

const DIFF = 'diff --git a/app.txt b/app.txt\nindex 8b2034d..4224f45 100644\n--- a/app.txt\n+++ b/app.txt\n@@ -3,7 +3,7 @@ line 2\n line 3\n line 4\n line 5\n-line 6\n+line six changed\n line 7\n line 8\n line 9\n@@ -38,7 +38,7 @@ line 37\n line 38\n line 39\n line 40\n-line 41\n+line forty-one changed\n line 42\n line 43\n line 44\ndiff --git a/log.txt b/log.txt\nindex eff967a..203534c 100644\n--- a/log.txt\n+++ b/log.txt\n@@ -10,3 +10,4 @@ c9\n c10\n c11\n c12\n+more\n'

const commitBlock = (hash: string, n: number): string =>
  `commit ${hash}\nAuthor: Ada Lovelace <a@b.c>\nDate:   Fri Sep 25 14:47:56 2026 +0300\n\n    fix: change number ${n}\n\n`

describe('git status', () => {
  test('the long format as the branch, each section, and one letter per file', () => {
    const r = run('git status', STATUS)
    expect(r.text).toBe('* main\nstaged:\n  A added.txt\n  D old.txt\nunstaged:\n  M app.txt\n  M log.txt\nuntracked:\n  untracked1.txt\n  untracked2.txt')
    expect(saving(STATUS, r.text)).toBeGreaterThanOrEqual(60)
  })

  test('tracking, a clean tree, an in-progress rebase and a detached HEAD', () => {
    expect(run('git status', "On branch main\nYour branch is ahead of 'origin/main' by 2 commits.\n  (use \"git push\" to publish your local commits)\n\nnothing to commit, working tree clean\n").text)
      .toBe('* main [ahead 2]\nclean, nothing to commit')
    expect(run('git status', "interactive rebase in progress; onto 1a2b3c4\nLast command done (1 command done):\n   pick 5d6e7f8 msg\nYou are currently rebasing branch 'feat' on '1a2b3c4'.\n  (fix conflicts and then run \"git rebase --continue\")\n\nUnmerged paths:\n  (use \"git add <file>...\" to mark resolution)\n\tboth modified:   a.ts\n\n").text)
      .toBe('rebase in progress\nconflicts:\n  UU a.ts')
    expect(run('git status', 'HEAD detached at 1a2b3c4\nnothing to commit, working tree clean\n').text).toBe('* HEAD detached at 1a2b3c4\nclean, nothing to commit')
  })

  test('a short or porcelain status is left to the cleanup', () => {
    expect(run('git status', ' M a.ts\n?? b.ts\n', ['-s']).text).toBe(' M a.ts\n?? b.ts')
  })
})

describe('git diff and show', () => {
  test('headers go, three lines of context stay before each change, and each file gets its count', () => {
    const r = run('git diff', DIFF)
    expect(r.text).toBe([
      'app.txt', '@@ -3,7 +3,7 @@ line 2', ' line 3', ' line 4', ' line 5', '-line 6', '+line six changed',
      '@@ -38,7 +38,7 @@ line 37', ' line 38', ' line 39', ' line 40', '-line 41', '+line forty-one changed', '  +2 -2',
      '', 'log.txt', '@@ -10,3 +10,4 @@ c9', ' c10', ' c11', ' c12', '+more', '  +1 -0',
    ].join('\n'))
    expect(r.elided).toBe(false)
  })

  test('a hunk over 100 changed lines is cut with a note, and the cut is marked for the full-output file', () => {
    const big = `diff --git a/f b/f\nnew file mode 100644\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,300 @@\n${Array.from({ length: 300 }, (_, i) => `+l${i}`).join('\n')}\n`
    const r = run('git diff', big)
    expect(r.text.split('\n').slice(0, 3)).toEqual(['f', '  (new file)', '@@ -0,0 +1,300 @@'])
    expect(r.text).toContain('  ... (200 additions left out)\n  +300 -0')
    expect(r.elided).toBe(true)
    expect(saving(big, r.text)).toBeGreaterThanOrEqual(60)
  })

  test('a stat or name listing is git\'s own compact form', () => {
    expect(run('git diff', ' a.ts | 2 +-\n 1 file changed\n', ['--stat']).text).toBe(' a.ts | 2 +-\n 1 file changed')
  })

  test('show keeps the commit header and condenses its diff', () => {
    const text = 'commit 6fd94ea\nAuthor: Ada <a@b.c>\nDate:   Fri Sep 25 14:47:55 2026 +0300\n\n    feat: x\n\ndiff --git a/o b/o\nindex 1..2 100644\n--- a/o\n+++ b/o\n@@ -1 +1 @@\n-a\n+b\n'
    expect(run('git show', text).text).toBe('commit 6fd94ea\nAuthor: Ada <a@b.c>\nDate:   Fri Sep 25 14:47:55 2026 +0300\n\n    feat: x\n\no\n@@ -1 +1 @@\n-a\n+b\n  +1 -1')
  })
})

describe('git log', () => {
  test('the default format as one line per commit, the body cut to three lines without trailers', () => {
    const text = `${commitBlock('12364e4e433b97e35bca29f5aecd65a49e9cbb5a', 12)}commit 6fd94ea33e65f6377884dbdc41328c00870a8ad1 (HEAD -> main, origin/main)\nAuthor: Ada Lovelace <a@b.c>\nDate:   Fri Sep 25 14:47:55 2026 +0300\n\n    feat: initial import\n    \n    a\n    b\n    c\n    d\n    \n    Signed-off-by: Ada Lovelace <a@b.c>\n`
    expect(run('git log', text).text).toBe([
      '12364e4 fix: change number 12 (2026-09-25) <Ada Lovelace>',
      '6fd94ea (HEAD -> main, origin/main) feat: initial import (2026-09-25) <Ada Lovelace>',
      '  a', '  b', '  c', '  [+1 lines]',
    ].join('\n'))
  })

  test('a bare log asks for ten commits and says so when it got them; a bounded one asks nothing', () => {
    expect(GIT['git log']?.flags?.([])).toEqual(['-10'])
    for (const args of [['-5'], ['-n', '3'], ['--oneline'], ['main..feat'], ['--since=1.week']]) expect(GIT['git log']?.flags?.(args), args.join(' ')).toBe(undefined)
    const ten = Array.from({ length: 10 }, (_, i) => commitBlock(`${i}abcdef0123456789`, i)).join('')
    const r = run('git log', ten, ['-10'])
    expect(r.text.split('\n')).toHaveLength(11)
    expect(r.text.endsWith('(the 10 newest commits; pass -n <count> for more)')).toBe(true)
    // Measured 48% on these one-line commits: the saving is the author, date and blank lines alone.
    expect(saving(ten, r.text)).toBeGreaterThanOrEqual(45)
  })

  test('the plan puts -10 after `log` and nowhere when the command is a pipeline', () => {
    expect(planFor('git log')?.flags).toEqual(['-10'])
    expect(planFor('git -C repo log')?.nameEnd).toBe(3)
    expect(planFor('git log | head')?.flags).toEqual([])
  })
})

describe('git remote and write operations', () => {
  test('push: progress goes and the ref move reads as one line', () => {
    const net = 'Enumerating objects: 5, done.\nCounting objects: 100% (5/5), done.\nDelta compression using up to 10 threads\nCompressing objects: 100% (3/3), done.\nWriting objects: 100% (3/3), 310 bytes | 310.00 KiB/s, done.\nTotal 3 (delta 2), reused 0 (delta 0), pack-reused 0\nremote: Resolving deltas: 100% (2/2), completed with 2 local objects.\nTo github.com:o/r.git\n   b001266..4c8824c  main -> main\n'
    expect(run('git push', net).text).toBe('ok push main (b001266..4c8824c)')
    expect(saving(net, run('git push', net).text)).toBeGreaterThanOrEqual(60)
    expect(run('git push', 'Everything up-to-date\n').text).toBe('ok push (up to date)')
    expect(run('git push', "To /r.git\n * [new branch]      main -> main\nbranch 'main' set up to track 'origin/main'.\n").text)
      .toBe("ok push main ([new branch])\nbranch 'main' set up to track 'origin/main'.")
    const rejected = 'To github.com:o/r.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\n'
    expect(run('git push', rejected, [], 1).text).toContain('error: failed to push some refs')
  })

  test('pull and fetch', () => {
    expect(run('git pull', 'From /r\n   926d49f..6a6cd6b  main       -> origin/main\nUpdating 926d49f..6a6cd6b\nFast-forward\n app.txt | 1 +\n log.txt | 1 +\n 2 files changed, 2 insertions(+)\n').text)
      .toBe('ok pull 2 files changed, 2 insertions(+) (926d49f..6a6cd6b)')
    expect(run('git pull', 'Already up to date.\n').text).toBe('ok pull (up to date)')
    expect(run('git fetch', 'From /r\n * [new branch]      feat-a     -> origin/feat-a\n * [new branch]      feat-b     -> origin/feat-b\n').text)
      .toBe('ok fetch origin/feat-a ([new branch]), origin/feat-b ([new branch])')
  })

  test('commit, branch, stash and checkout', () => {
    expect(run('git commit', '[main 8ec0d66] feat: add w\n 1 file changed, 1 insertion(+)\n').text).toBe('ok 8ec0d66 main: feat: add w\n  1 file changed, 1 insertion(+)')
    expect(run('git commit', 'On branch main\nnothing to commit, working tree clean\n', [], 1).text).toBe('On branch main\nnothing to commit, working tree clean')
    expect(run('git branch', '* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/feat-a\n  remotes/origin/feat-b\n  remotes/origin/main\n', ['-a']).text)
      .toBe('* main\n  remote-only (2):\n    feat-a\n    feat-b')
    expect(run('git stash', 'stash@{0}: WIP on main: 6a6cd6b z\nstash@{1}: On feat: 1a2b3c4 try\n', ['list']).text).toBe('stash@{0}: main: z\nstash@{1}: feat: try')
    expect(run('git checkout', "Switched to branch 'feat-a'\nYour branch is up to date with 'origin/feat-a'.\n").text).toBe("Switched to branch 'feat-a'")
  })

  // A repository on this machine lists 128 tags, sorted by name: v1.4.0 ... v2.0.97.
  test('a long tag list keeps both ends and the count through the plan; a tag written is left alone', () => {
    const tags = Array.from({ length: 128 }, (_, i) => `v2.0.${i}`)
    const plan = planFor('git tag -l')
    if (plan === undefined) throw new Error('no plan for git tag')
    const r = runFilter(plan, `${tags.join('\n')}\n`, 0, false)
    expect(r.text).toBe([...tags.slice(0, 10), '… +108 tags', ...tags.slice(-10), '128 tags'].join('\n'))
    expect(r.elided).toBe(true)
    expect(run('git tag', 'v1\nv2\n').text).toBe('v1\nv2')
    expect(run('git tag', 'fatal: tag \'v1\' already exists\n', ['v1']).text).toBe("fatal: tag 'v1' already exists")
    expect(run('git tag', `${tags.join('\n')}\n`, ['--contains', 'abc123']).elided).toBe(true)
  })

  // Captured from `git remote -v` in a repository with two remotes; the host names are made up.
  test('git remote -v writes a remote once when it fetches and pushes to the same URL', () => {
    const text = 'mirror\tssh://git@git.example.org/k/app.git (fetch)\nmirror\tssh://git@git.example.org/k/app.git (push)\norigin\thttps://github.com/k/app.git (fetch)\norigin\tssh://git@github.com/k/app.git (push)\n'
    expect(planFor('git remote -v')?.family).toBe('git remote')
    expect(run('git remote', text, ['-v']).text).toBe('mirror  ssh://git@git.example.org/k/app.git\norigin  https://github.com/k/app.git (fetch)\norigin  ssh://git@github.com/k/app.git (push)')
    expect(run('git remote', 'mirror\norigin\n').text).toBe('mirror\norigin')
  })
})

describe('gh', () => {
  test('pr list rows as `#n title [branch] state`, capped at 20', () => {
    const rows = Array.from({ length: 25 }, (_, i) => `${i + 1}\tFix thing ${i + 1}\tfix-${i + 1}\tOPEN\t2026-09-20T10:00:00Z`).join('\n')
    const r = run('gh pr', rows, ['list'])
    expect(r.text.split('\n')[0]).toBe('#1 Fix thing 1 [fix-1] OPEN')
    expect(r.text.split('\n').at(-1)).toBe('… +5 more')
    expect(r.elided).toBe(true)
  })

  test('pr view keeps the fields that say something and a body without its noise', () => {
    const text = 'title:\tAdd a mod\nstate:\tOPEN\nauthor:\tkerem\nlabels:\t\nassignees:\t\nreviewers:\t\nprojects:\t\nmilestone:\t\nnumber:\t42\nurl:\thttps://github.com/o/r/pull/42\nadditions:\t10\ndeletions:\t2\nauto-merge:\tdisabled\n--\n<!-- template -->\n[![ci](https://x/b.svg)](https://x)\n\n## Summary\n\nDoes a thing.\n\n---\n\n```\n<!-- kept -->\n```\n'
    expect(run('gh pr', text, ['view', '42']).text).toBe('title: Add a mod\nstate: OPEN\nauthor: kerem\nnumber: 42\nurl: https://github.com/o/r/pull/42\nadditions: 10\ndeletions: 2\n\n## Summary\n\nDoes a thing.\n\n```\n<!-- kept -->\n```')
  })

  test('checks as a count and the failing ones by name; --json is left alone', () => {
    expect(run('gh pr', 'build\tpass\t1m\thttps://x/1\nlint\tfail\t20s\thttps://x/2\ntest\tpending\t0\thttps://x/3\n', ['checks']).text)
      .toBe('1 passed, 1 failing, 1 pending\n  ✗ lint https://x/2\n  … test')
    expect(run('gh pr', '[{"number":1}]\n', ['list', '--json', 'number']).text).toBe('[{"number":1}]')
    expect(markdownBody(['![img](a.png)', 'text', '', '', '***'])).toEqual(['text', ''])
  })
})
