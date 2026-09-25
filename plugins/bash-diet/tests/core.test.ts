import { describe, expect, test, tier } from 'claude-code/testing'

import { read, withFlags } from '../hooks/command.ts'
import { cleanup } from '../hooks/filters/generic.ts'
import { capped, collapseRepeats, stripAnsi } from '../hooks/filters/common.ts'
import { failureOf, joined, persistedPathOf, planFor, replaces } from '../hooks/pipeline.ts'
import { hashOf, needsFile, staleFiles } from '../hooks/recall.ts'
import { classify } from '../hooks/rules.ts'
import { lex, parse } from '../hooks/shell.ts'
import { fmtTokens, isExcluded, patternError, sessionLine, sessionText } from '../hooks/text.ts'

tier('user')

const words = (command: string): string[] | undefined => {
  const r = read(command)
  return r.kind === 'target' ? r.target.words : undefined
}

describe('shell reading', () => {
  test('splits words, quotes and operators', () => {
    expect(lex(`git commit -m "fix: a \\"b\\"" && echo 'x y'`).tokens.map(t => t.text))
      .toEqual(['git', 'commit', '-m', 'fix: a "b"', '&&', 'echo', 'x y'])
    expect(lex('cargo test 2>&1 | tail -20').tokens.map(t => t.text)).toEqual(['cargo', 'test', '2>&', '1', '|', 'tail', '-20'])
    expect(lex('ls # a comment').tokens.map(t => t.text)).toEqual(['ls'])
    expect(lex('git \\\n  status').tokens.map(t => t.text)).toEqual(['git', 'status'])
  })

  test('a construct that hides where output comes from is opaque', () => {
    for (const cmd of ['echo $(date)', 'echo `date`', 'cat <<EOF\nx\nEOF', 'diff <(ls a) <(ls b)', '(cd a && ls)', 'make |& tee log', `echo "unclosed`, `echo "$(date)"`]) {
      expect(read(cmd).kind, cmd).toBe('opaque')
    }
    expect(read('git log > out.txt').kind).toBe('opaque')
    expect(read('git log 2> err.txt').kind).toBe('target')
    expect(read('git log > /dev/null').kind).toBe('target')
  })

  test('reads the command a chain or pipeline prints', () => {
    expect(words('cd app && cargo test')).toEqual(['cargo', 'test'])
    expect(words('FOO=1 timeout 60 nice -n 5 go test ./...')).toEqual(['go', 'test', './...'])
    expect(words('cargo test 2>&1 | tail -20')).toEqual(['cargo', 'test'])
    expect(words('git log | grep fix')).toEqual(['grep', 'fix'])
    expect(read('git status && git diff').kind).toBe('mixed')
    expect(read('ls | sort | uniq').kind).toBe('mixed')
    expect(read('cat app.log | tail -f').kind).toBe('mixed')
    expect(words('tail -f app.log | head')).toEqual(['tail', '-f', 'app.log'])
    expect(read('BASH_DIET_RAW=1 git diff').kind).toBe('raw')
    expect(read('BASH_DIET_RAW=0 git diff').kind).toBe('target')
    expect(parse('a; b &').segments.map(g => g.background)).toEqual([false, true])
  })

  test('a flag goes after the subcommand, and only where nothing else joins the command', () => {
    const r = read('go test ./... -run X')
    if (r.kind !== 'target') throw new Error(r.kind)
    expect(r.target.canAddFlags).toBe(true)
    expect(withFlags('go test ./... -run X', r.target, 1, ['-json'])).toBe('go test -json ./... -run X')
    for (const cmd of ['cd a && go test', 'go test | tail', 'sudo go test', 'go test 2>&1']) {
      const x = read(cmd)
      expect(x.kind === 'target' && x.target.canAddFlags, cmd).toBe(false)
    }
  })
})

describe('classify', () => {
  test('names the tool behind runners, paths and git options', () => {
    expect(classify(['npx', '--yes', 'tsc', '--noEmit'])).toMatchObject({ tool: 'tsc', sub: '', args: ['--noEmit'] })
    expect(classify(['python3', '-m', 'pytest', '-x'])).toMatchObject({ tool: 'pytest', args: ['-x'] })
    expect(classify(['/usr/bin/git', '-C', 'repo', '--no-pager', 'log', '-5'])).toMatchObject({ tool: 'git', sub: 'log', nameEnd: 4 })
    expect(classify(['./gradlew.bat', 'build'])).toMatchObject({ tool: 'gradlew', sub: 'build' })
    expect(classify(['php', 'artisan', 'test'])).toMatchObject({ tool: 'artisan', sub: 'test' })
    expect(classify(['pnpm', 'exec', 'vitest', 'run'])).toMatchObject({ tool: 'vitest', args: ['run'] })
    expect(classify(['pnpm', 'test'])).toMatchObject({ tool: 'pnpm', sub: 'test' })
    expect(classify(['cargo'])).toMatchObject({ tool: 'cargo', sub: '' })
  })
})

describe('filter plumbing', () => {
  test('the generic cleanup drops escapes and redraws and folds repeats, keeping every line of content', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m \u001b]0;title\u0007ok')).toBe('red ok')
    expect(cleanup('a\r\n10%\r50%\rdone\nx\nx\nx\n\n\n\nb\n').text).toBe('a\ndone\nx (×3)\n\nb')
    expect(collapseRepeats(['a', 'b', 'b'])).toEqual(['a', 'b (×2)'])
    expect(capped(['1', '2', '3'], 2)).toEqual({ lines: ['1', '2', '… +1 more'], elided: true })
  })

  test('a plan: left alone, generic, or a command no table names', () => {
    expect(planFor('BASH_DIET_RAW=1 ls')).toBe(undefined)
    expect(planFor('echo $(ls)')).toBe(undefined)
    expect(planFor('git status && git diff')?.family).toBe('other')
    expect(planFor('./weird-tool --x')?.family).toBe('other')
  })

  test('reads failures, persisted output, and when the filtered text replaces the raw one', () => {
    expect(failureOf('Exit code 3\nboom')).toEqual({ exitCode: 3, output: 'boom' })
    expect(failureOf('Command timed out')).toBe(undefined)
    expect(persistedPathOf('<persisted-output>\nOutput too large (1KB). Full output saved to: /t/a.txt\nPreview')).toBe('/t/a.txt')
    expect(joined('out\n', 'err')).toBe('out\nerr')
    expect(joined('', 'err')).toBe('err')
    expect(replaces('abc', 'abcd', false)).toBe(false)
    expect(replaces('abc', 'abcd', true)).toBe(true)
    // The recorded case: one character of 3626 left out is no saving worth a changed result.
    const raw = 'x'.repeat(3626)
    expect(replaces(raw, raw.slice(1), false)).toBe(false)
    // Both bars must hold: 40 characters of 3626 is under 5%, 180 of 3626 is over it.
    expect(replaces(raw, raw.slice(40), false)).toBe(false)
    expect(replaces(raw, raw.slice(182), false)).toBe(true)
    // 39 characters of 100 is over 5% and under 40 characters.
    expect(replaces('y'.repeat(100), 'y'.repeat(61), false)).toBe(false)
    expect(replaces('y'.repeat(100), 'y'.repeat(60), false)).toBe(true)
  })

  test('keeps a file for a cut or long failed output, named by a stable hash', async () => {
    expect(needsFile(true, 0, 10)).toBe(true)
    expect(needsFile(false, 1, 499)).toBe(false)
    expect(needsFile(false, 1, 500)).toBe(true)
    expect(needsFile(false, 0, 10_000)).toBe(false)
    const h = await hashOf('ls', 'a')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(await hashOf('ls', 'a')).toBe(h)
    const day = 24 * 60 * 60 * 1000
    expect(staleFiles([{ name: 'new', mtimeMs: 40 * day }, { name: 'old', mtimeMs: 1 * day }], 40 * day)).toEqual(['old'])
  })

  test('texts: tokens, gain and excludes', () => {
    expect(fmtTokens(830)).toBe('830')
    expect(fmtTokens(12_400)).toBe('12k')
    expect(fmtTokens(1_500)).toBe('1.5k')
    expect(sessionText(0, 0, 0)).toBe('no Bash result shrunk yet')
    expect(sessionText(2, 4000, 1000)).toBe('2 result(s) shrunk · 4.0k → 1.0k chars (−75%) · ~750 tokens estimated')
    // The sidebar line colours the share taken out green and the estimate faint, and reads as the status text.
    expect(sessionLine(0, 0, 0)).toEqual({ text: 'no Bash result shrunk yet', kind: 'dim' })
    expect(sessionLine(2, 4000, 1000)).toEqual({
      text: sessionText(2, 4000, 1000),
      parts: [{ text: '2 result(s) shrunk · 4.0k → 1.0k chars ' }, { text: '(−75%)', kind: 'ok' }, { text: ' · ' }, { text: '~750 tokens estimated', kind: 'dim' }],
    })
    expect(isExcluded(['npm'], ['npm', 'test'])).toBe(true)
    expect(isExcluded(['npm'], ['npmx'])).toBe(false)
    expect(isExcluded(['^git (log|diff)'], ['git', 'diff'])).toBe(true)
    expect(patternError('^(')).toContain('not a valid regex')
    expect(patternError('')).toBe('expects a command prefix or a ^regex')
  })
})
