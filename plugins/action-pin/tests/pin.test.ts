import { describe, expect, test, tier } from 'claude-code/testing'

import { commitUrl, denyText, doneLines, isGuarded, isWorkflow, logText, modeOf, noteText, openRefs, refOf, shownPath, sidebarLines, unpinnedUse, unpinnedUses } from '../hooks/pin.ts'

tier('user')

const SHA = 'a'.repeat(40)

describe('pin', () => {
  test('takes a workflow and a composite action, and no other yaml', async () => {
    expect(isWorkflow('/r/.github/workflows/ci.yml')).toBe(true)
    expect(isWorkflow('.github/workflows/release.yaml')).toBe(true)
    expect(isWorkflow('/r/.github/actions/setup/action.yml')).toBe(true)
    for (const p of ['docker-compose.yml', '/r/.github/dependabot.yml', '/r/src/workflows/ci.yml', '/r/.github/workflows/sub/ci.yml']) {
      expect(isWorkflow(p), p).toBe(false)
    }
  })

  test('reads a uses line and leaves a pinned, local or container one', async () => {
    expect(unpinnedUse('      - uses: actions/checkout@v4')).toEqual({ action: 'actions/checkout', ref: 'v4' })
    expect(unpinnedUse('    uses: "docker/build-push-action@master"')).toEqual({ action: 'docker/build-push-action', ref: 'master' })
    expect(unpinnedUse('    uses: owner/repo/sub/action@v1.2.3 # comment')).toEqual({ action: 'owner/repo/sub/action', ref: 'v1.2.3' })
    for (const line of [`  - uses: actions/checkout@${SHA}`, '  - uses: ./.github/actions/setup', '  - uses: docker://alpine:3.20', '  - run: npm test', '  - uses: actions/checkout']) {
      expect(unpinnedUse(line), line).toBe(undefined)
    }
  })

  test('takes only the added lines, each action once', async () => {
    const before = '  - uses: actions/checkout@v4\n'
    const after = '  - uses: actions/checkout@v4\n  - uses: actions/setup-node@v4\n  - uses: actions/setup-node@v4\n  - uses: actions/cache@main\n'
    expect(unpinnedUses(before, after)).toEqual([
      { action: 'actions/setup-node', ref: 'v4' },
      { action: 'actions/cache', ref: 'main' },
    ])
    expect(unpinnedUses(after, after)).toEqual([])
  })

  test('builds the commit URL from the repository, not the path inside it', async () => {
    expect(commitUrl('actions/checkout', 'v4')).toBe('https://api.github.com/repos/actions/checkout/commits/v4')
    expect(commitUrl('owner/repo/sub/action', 'v1.2.3')).toBe('https://api.github.com/repos/owner/repo/commits/v1.2.3')
  })

  test('the note names the SHA to write, and says so without one', async () => {
    const withSha = [{ action: 'actions/checkout', ref: 'v4', sha: SHA }]
    expect(noteText(withSha)).toContain(`actions/checkout@v4 → ${SHA}`)
    expect(noteText(withSha)).toContain(`for example: uses: actions/checkout@${SHA} # v4`)
    expect(logText('.github/workflows/ci.yml', withSha)).toBe(`.github/workflows/ci.yml uses actions by a moving ref: actions/checkout@v4 → ${SHA}`)
    expect(shownPath('/Users/u/app/.github/workflows/ci.yml', '/Users/u/app/')).toBe('.github/workflows/ci.yml')
    expect(shownPath('/tmp/ci.yml', '/Users/u/app')).toBe('/tmp/ci.yml')
    expect(shownPath('/tmp/ci.yml', undefined)).toBe('/tmp/ci.yml')
    expect(noteText([{ action: 'actions/checkout', ref: 'v4' }])).toContain('Pin each to the commit SHA of that tag')
  })

  test('the sidebar colours the moving ref red and the commit faint, the file red and the action default', () => {
    const lines = sidebarLines('.github/workflows/ci.yml', [{ action: 'actions/checkout', ref: 'v4', sha: SHA }, { action: 'actions/cache', ref: 'main' }])
    expect(lines).toEqual([
      { text: '.github/workflows/ci.yml', kind: 'error' },
      { text: `actions/checkout@v4 → ${SHA}`, parts: [{ text: 'actions/checkout' }, { text: '@v4', kind: 'error' }, { text: ` → ${SHA}`, kind: 'dim' }] },
      { text: 'actions/cache@main', parts: [{ text: 'actions/cache' }, { text: '@main', kind: 'error' }] },
    ])
    const many = Array.from({ length: 12 }, (_, i) => ({ action: `a/b${i}`, ref: 'v1' }))
    expect(sidebarLines('ci.yml', many).at(-1)).toEqual({ text: '2 more', kind: 'dim' })
    expect(doneLines('ci.yml', ['a/b@v1'])).toEqual([{ text: 'ci.yml', kind: 'ok' }, { text: 'a/b@v1', kind: 'ok' }])
  })

  test('the gate stops a commit, a push and a merge, and says why', () => {
    for (const command of ['git commit -m x', 'git push origin main', 'git merge main']) expect(isGuarded(command), command).toBe(true)
    for (const command of ['git status', 'git push --dry-run', 'git log']) expect(isGuarded(command), command).toBe(false)
    expect(modeOf('note')).toBe('note')
    expect(modeOf('')).toBe(undefined)
    expect(refOf({ action: 'actions/checkout', ref: 'v4', sha: SHA })).toBe('actions/checkout@v4')
    expect(openRefs(['a@1'], [{ action: 'a', ref: '1' }, { action: 'b', ref: '2' }])).toEqual(['a@1', 'b@2'])
    expect(denyText(['actions/checkout@v4'])).toBe(
      'stopped: 1 action(s) are used by a moving ref: actions/checkout@v4. Pin each to the commit SHA of that ref, with the ref as a trailing comment, then run the command again; there is no way around this gate.',
    )
  })
})
