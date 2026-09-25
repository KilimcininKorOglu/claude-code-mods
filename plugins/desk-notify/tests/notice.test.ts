import { describe, expect, test, tier } from 'claude-code/testing'

import { argvFor, escapeApplescript, escapePowershell, failNotice, platformOf, projectNameOf, settingOf, summarize } from '../hooks/notice.ts'

tier('user')

describe('notice', () => {
  test('reads the platform from the Windows variable first, then from uname', async () => {
    expect(platformOf('Windows_NT', undefined)).toBe('windows')
    expect(platformOf(undefined, 'Darwin\n')).toBe('darwin')
    expect(platformOf(undefined, 'Linux')).toBe('linux')
    expect(platformOf(undefined, 'FreeBSD')).toBe(undefined)
    expect(platformOf(undefined, undefined)).toBe(undefined)
  })

  test('escapes a quote and a backslash, so a project name cannot end the script', async () => {
    expect(escapeApplescript('a"b\\c')).toBe('a\\"b\\\\c')
    expect(escapePowershell("it's")).toBe("it''s")
    const argv = argvFor('darwin', { title: 't', message: 'x" & do shell script "rm', subtitle: 's' })
    expect(argv[2]).toBe('display notification "x\\" & do shell script \\"rm" with title "t" subtitle "s"')
  })

  test('summarizes the first line with a text, without its markdown marks, cut at 60 characters', async () => {
    expect(summarize('\n## - **API Error: overloaded**\nmore')).toBe('API Error: overloaded**')
    expect(summarize('a  b\tc')).toBe('a b c')
    expect(summarize('x'.repeat(70))).toBe(`${'x'.repeat(59)}…`)
    expect(summarize(undefined)).toBe('')
    expect(failNotice('app', undefined, 'last words').message).toBe('app: last words')
    expect(failNotice('app', '', '').message).toBe('app')
  })

  test('names the primary repository of a worktree, else the git root, else the directory', async () => {
    expect(projectNameOf('/r/app/.git', '/r/app', '/r/app/sub')).toBe('app')
    expect(projectNameOf('/r/app/.git/worktrees/fix', '/r/fix', '/r/fix')).toBe('app')
    expect(projectNameOf('/r/bare.git', '/r/bare', '/r/bare')).toBe('bare')
    expect(projectNameOf('', '', '/tmp/probe/')).toBe('probe')
  })

  test('reads an event and its setting, and refuses anything else', async () => {
    expect(settingOf('plan off')).toEqual({ event: 'plan', on: false })
    expect(settingOf(' stop on ')).toEqual({ event: 'stop', on: true })
    for (const bad of ['plan', 'ask yes', 'all off', 'ask on now']) expect(settingOf(bad), bad).toBe(undefined)
  })
})
