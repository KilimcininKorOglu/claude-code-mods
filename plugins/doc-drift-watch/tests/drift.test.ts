import { describe, expect, test, tier } from 'claude-code/testing'

import { addedBy, commitDir, isCommit, noteText, parseDrift, sidebarLines } from '../hooks/drift.ts'

tier('user')

const OUTPUT = [
  '<!-- legend -->',
  '<doc-drift docs="2" drift="3"><history probed="1"/>',
  '<doc p="README.md" anchors="4" drift="2"><a k="file-line" l="12" c="1" why="missing-file" ref="old.go:5"/><a k="mention" l="30" c="4" why="deleted" ref="parseConfig" got="a1b2c3d 2026-09-01"/></doc>',
  '<doc p="docs/plan.md" anchors="1" drift="1"><a k="file-line" l="7" c="2" why="line-moved" ref="main.go:40" got="loadConfig"/></doc>',
  '<unchecked r="uncorroborated" n="1"/></doc-drift>',
].join('')

describe('drift', () => {
  test('knows a commit from a command that only asks about one', async () => {
    for (const c of ['git commit -m x', 'cd a && git add b.ts && git commit -m "y"', 'git -C sub commit -am z', 'git -c user.email=k@x commit -m w']) expect(isCommit(c), c).toBe(true)
    for (const c of ['git commit --dry-run', 'git commit --help', 'git log --grep commit', 'echo git-commit']) expect(isCommit(c), c).toBe(false)
  })

  test('finds the directory the commit runs in, before its own cd has run', async () => {
    expect(commitDir('git commit -m x', '/s')).toBe('/s')
    expect(commitDir('cd /tmp/demo && git add a && git commit -m x', '/s')).toBe('/tmp/demo')
    expect(commitDir('cd "sub dir" && git commit -m x && cd /elsewhere', '/s')).toBe('/s/sub dir')
    expect(commitDir('git -C ../other commit -m x', '/s')).toBe('/s/../other')
  })

  test('a directory the shell expands first is named, never joined as text', async () => {
    expect(() => commitDir('D=/tmp/x; cd $D && git commit -m x', '/s')).toThrow("the commit's directory is not known: cd $D")
    expect(() => commitDir('cd ~/work && git commit -m x', '/s')).toThrow("the commit's directory is not known: cd ~/work")
    expect(() => commitDir('git -C "$(pwd)/a" commit -m x', '/s')).toThrow('the commit\'s directory is not known: git -C "$(pwd)/a"')
    expect(commitDir("cd 'price$' && git commit -m x", '/s')).toBe('/s/price$')
  })

  test('reads each stale anchor under its doc', async () => {
    expect(parseDrift(OUTPUT)).toEqual([
      { doc: 'README.md', line: '12', kind: 'file-line', why: 'missing-file', ref: 'old.go:5' },
      { doc: 'README.md', line: '30', kind: 'mention', why: 'deleted', ref: 'parseConfig', got: 'a1b2c3d 2026-09-01' },
      { doc: 'docs/plan.md', line: '7', kind: 'file-line', why: 'line-moved', ref: 'main.go:40', got: 'loadConfig' },
    ])
    expect(parseDrift('<doc-drift docs="1" drift="0"></doc-drift>')).toEqual([])
    expect(parseDrift('<doc p="AUDIT.md"><a k="file-line" l="4" why="missing-file" ref="a.go:1" kind="dated-record" rec="line"/></doc>')).toEqual([])
  })

  test('reports only what the commit added, even when an edit above moved a stale line', async () => {
    const before = parseDrift('<doc p="README.md"><a k="file-line" l="20" why="missing-file" ref="sub/pay.ts:1"/></doc>')
    const after = parseDrift(OUTPUT.replace('</doc><doc p="docs', '<a k="file-line" l="22" why="missing-file" ref="sub/pay.ts:1"/></doc><doc p="docs'))
    const added = addedBy(before, after)
    expect(added.map(s => s.ref)).toEqual(['old.go:5', 'parseConfig', 'main.go:40'])
    expect(noteText(added)).toBe('doc-drift-watch: this commit made 3 doc line(s) stale: README.md:12 points at old.go:5, a file that no longer exists · README.md:30 names `parseConfig`, which a1b2c3d 2026-09-01 deleted · docs/plan.md:7 points at main.go:40, where loadConfig now sits. Update them in a follow-up commit, or tell the user why a line stays.')
  })

  test('a sidebar line keeps the place faint, the stale reference red and what sits there now yellow', async () => {
    const lines = sidebarLines(parseDrift(OUTPUT))
    expect(lines[2]).toEqual({
      text: 'docs/plan.md:7 points at main.go:40, where loadConfig now sits',
      parts: [
        { text: 'docs/plan.md:7 ', kind: 'dim' },
        { text: 'points at ' },
        { text: 'main.go:40', kind: 'error' },
        { text: ', where ' },
        { text: 'loadConfig', kind: 'warn' },
        { text: ' now sits' },
      ],
    })
    const many = Array.from({ length: 10 }, (_, i) => ({ doc: 'a.md', line: String(i), kind: 'file-line', why: 'past-eof', ref: `x.go:${i}` }))
    expect(sidebarLines(many).at(-1)).toEqual({ text: 'and 2 more', kind: 'dim' })
  })
})
