import { describe, expect, test, tier } from 'claude-code/testing'

import { argvFor, escapeApplescript, failNotice, platformOf, projectNameOf, settingOf, summarize, utf16Base64 } from '../hooks/notice.ts'

tier('user')

/** Decodes what powershell.exe -EncodedCommand reads: base64 of UTF-16LE, written apart from the encoder. */
function fromUtf16Base64(s: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bits = [...s.replace(/=+$/, '')].map(c => alphabet.indexOf(c).toString(2).padStart(6, '0')).join('')
  const bytes = (bits.match(/.{8}/g) ?? []).map(b => parseInt(b, 2))
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8))
  return out
}

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
    const argv = argvFor('darwin', { title: 't', message: 'x" & do shell script "rm', subtitle: 's' })
    expect(argv[2]).toBe('display notification "x\\" & do shell script \\"rm" with title "t" subtitle "s"')
  })

  test('base64 of UTF-16LE matches the standard encoding, padding and non-ASCII text included', async () => {
    expect(utf16Base64('')).toBe('')
    expect(utf16Base64('a')).toBe('YQA=')
    expect(utf16Base64('ab')).toBe('YQBiAA==')
    expect(utf16Base64('abc')).toBe('YQBiAGMA')
    // "ü" U+00FC and "’" U+2019 as their UTF-16LE bytes FC 00 and 19 20.
    expect(utf16Base64('ü’')).toBe('/AAZIA==')
  })

  test('on Windows no notification text reaches the script as text, whichever quote it holds', async () => {
    const message = "x’); Start-Process calc; ('‘‚‛' `$(whoami)"
    const argv = argvFor('windows', { title: "it's", message, subtitle: 's' })
    expect(argv.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(argv[4]).toMatch(/^[A-Za-z0-9+/]+=*$/)
    const script = fromUtf16Base64(argv[4] ?? '')
    expect(script).not.toContain('Start-Process')
    expect(script).not.toContain("it's")
    expect(script).toContain(`CreateTextNode([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${utf16Base64(`s - ${message}`)}')))`)
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
