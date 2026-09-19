import { describe, expect, test, tier } from 'claude-code/testing'

import { fingerprintOf, fnv1a, MAX_DIFF_CHARS } from '../hooks/fingerprint.ts'
import { isTestCommand, parseOutput } from '../hooks/parse.ts'

tier('user')

describe('isTestCommand', () => {
  test('knows the supported runners, also behind cd, npm, make and a vendor path', async () => {
    for (const c of ['go test ./...', 'cd api && pytest -x', 'python3 -m pytest tests', 'npx jest', 'npx vitest run', 'bun test', 'cargo test -q', 'vendor/bin/phpunit', 'npm test', 'pnpm run test', 'make test']) {
      expect(isTestCommand(c), c).toBe(true)
    }
    for (const c of ['go build ./...', 'git commit -m "test"', 'ls tests/', 'echo pytest-cov', 'make testdata']) {
      expect(isTestCommand(c), c).toBe(false)
    }
  })
})

describe('parseOutput', () => {
  test('go test', async () => {
    const out = '=== RUN   TestA\n--- PASS: TestA (0.00s)\n=== RUN   TestB\n    b_test.go:9: boom\n--- FAIL: TestB (0.01s)\n    --- FAIL: TestB/sub (0.00s)\nFAIL\nFAIL\texample.com/x\t0.2s'
    expect(parseOutput(out)).toEqual({ passed: ['go:TestA'], failed: ['go:TestB', 'go:TestB/sub'] })
  })

  test('pytest, with the -v and -rA forms', async () => {
    const out = 'tests/test_a.py::test_ok PASSED    [ 50%]\ntests/test_a.py::test_bad FAILED  [100%]\n=== short test summary info ===\nPASSED tests/test_b.py::test_x\nFAILED tests/test_a.py::test_bad - assert 1 == 2\nERROR tests/test_c.py::test_setup'
    expect(parseOutput(out)).toEqual({
      passed: ['pytest:tests/test_a.py::test_ok', 'pytest:tests/test_b.py::test_x'],
      failed: ['pytest:tests/test_a.py::test_bad', 'pytest:tests/test_c.py::test_setup'],
    })
  })

  test('jest, vitest and bun, without durations and file summaries', async () => {
    const out = [
      '  ✓ adds numbers (3 ms)',
      '  ✕ divides by zero (12 ms)',
      ' ✓ src/a.test.ts (3 tests) 5ms',
      ' × src/b.test.ts > parser > reads a date 4ms',
      '(pass) cache > keeps a value [0.12ms]',
      '(fail) cache > expires [1.50ms]',
    ].join('\n')
    expect(parseOutput(out)).toEqual({
      passed: ['js:adds numbers', 'js:cache > keeps a value'],
      failed: ['js:divides by zero', 'js:src/b.test.ts > parser > reads a date', 'js:cache > expires'],
    })
  })

  test('cargo test and PHPUnit', async () => {
    const out = 'test parse::reads ... ok\ntest parse::fails ... FAILED\n\nThere was 1 failure:\n\n1) App\\Tests\\UserTest::testCreate\nFailed asserting that false is true.'
    expect(parseOutput(out)).toEqual({ passed: ['cargo:parse::reads'], failed: ['cargo:parse::fails', 'phpunit:App\\Tests\\UserTest::testCreate'] })
  })

  test('a test named both ways counts as failed, and text with no test names nothing', async () => {
    expect(parseOutput('--- PASS: TestA\n--- FAIL: TestA')).toEqual({ passed: [], failed: ['go:TestA'] })
    expect(parseOutput('ok  \texample.com/x\t0.2s')).toEqual({ passed: [], failed: [] })
  })
})

describe('fingerprint', () => {
  test('the same tree gives the same fingerprint, any change another one', async () => {
    const a = fingerprintOf({ head: 'abc\n', diff: '+x', untracked: 'new.go\n' })
    expect(a).toBe(fingerprintOf({ head: 'abc', diff: '+x', untracked: 'new.go\n' }))
    expect(a).not.toBe(fingerprintOf({ head: 'abc', diff: '+y', untracked: 'new.go\n' }))
    expect(a).not.toBe(fingerprintOf({ head: 'abd', diff: '+x', untracked: 'new.go\n' }))
    expect(fnv1a('')).toBe('cbf29ce484222325')
    expect(fnv1a('a')).toBe('af63dc4c8601ec8c')
  })

  test('a diff over the limit gives none', async () => {
    expect(fingerprintOf({ head: 'abc', diff: 'x'.repeat(MAX_DIFF_CHARS + 1), untracked: '' })).toBe(undefined)
  })
})
