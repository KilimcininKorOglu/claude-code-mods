import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult, FilterTable } from '../hooks/filters/common.ts'
import { GO } from '../hooks/filters/go.ts'
import { PYTHON } from '../hooks/filters/python.ts'
import { RUST } from '../hooks/filters/rust.ts'
import { planFor } from '../hooks/pipeline.ts'

tier('user')

const TABLE: FilterTable = { ...RUST, ...GO, ...PYTHON }

function run(key: string, text: string, args: string[] = [], exitCode = 0): FilterResult {
  const filter = TABLE[key]
  if (filter === undefined) throw new Error(`no filter ${key}`)
  return filter.run({ args, text, exitCode })
}

const saving = (raw: string, out: string): number => Math.round((1 - out.length / raw.length) * 100)

// Captured from cargo 1.9x, go 1.2x, pytest 9, ruff and mypy in scratch projects (LC_ALL=C, no colour).
const WARNING = 'warning: unused variable: `unused`\n --> src/lib.rs:1:41\n  |\n1 | pub fn add(a: i32, b: i32) -> i32 { let unused = 1; a + b }\n  |                                         ^^^^^^ help: if this is intentional, prefix it with an underscore: `_unused`\n  |\n  = note: `#[warn(unused_variables)]` (part of `#[warn(unused)]`) on by default\n\n'
const WARNING_LINES = WARNING.trimEnd().split('\n')

const CARGO_BUILD = `   Compiling crate1 v0.1.0 (/tmp/crate1)\n${WARNING}warning: \`crate1\` (lib) generated 1 warning (run \`cargo fix --lib -p crate1\` to apply 1 suggestion)\n    Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 0.28s\n`

const CARGO_TEST_FAIL = `${WARNING}warning: \`crate1\` (lib) generated 1 warning (run \`cargo fix --lib -p crate1\` to apply 1 suggestion)\n   Compiling crate1 v0.1.0 (/tmp/crate1)\nwarning: \`crate1\` (lib test) generated 1 warning (1 duplicate)\n    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 0.20s\n     Running unittests src/lib.rs (target/debug/deps/crate1-1cd9cd7325bc710b)\n\nrunning 3 tests\ntest tests::slow ... ignored\ntest tests::adds ... ok\ntest tests::breaks ... FAILED\n\nfailures:\n\n---- tests::breaks stdout ----\n\nthread 'tests::breaks' (15278477) panicked at src/lib.rs:7:27:\nassertion \`left == right\` failed: math is off\n  left: 4\n right: 5\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n\n\nfailures:\n    tests::breaks\n\ntest result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\nerror: test failed, to rerun pass \`--lib\`\n`

const CARGO_TEST_PASS = `   Compiling crate1 v0.1.0 (/tmp/crate1)\n    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 0.12s\n     Running unittests src/lib.rs (target/debug/deps/crate1-1cd9cd7325bc710b)\n\nrunning 40 tests\n${Array.from({ length: 40 }, (_, i) => `test tests::case_${i} ... ok`).join('\n')}\n\ntest result: ok. 40 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n   Doc-tests crate1\n\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n`

describe('cargo', () => {
  test('a build keeps its warning block and ends with one counting line', () => {
    expect(run('cargo build', CARGO_BUILD).text).toBe([...WARNING_LINES, '', 'cargo build: 0 errors, 1 warning, 0.28s'].join('\n'))
    expect(run('cargo build', '   Compiling a v0.1.0\n   Compiling b v0.1.0\n    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.02s\n').text).toBe('cargo build: ok (2 crates compiled, 1.02s)')
  })

  test('a failing test run keeps the failure block and counts the rest', () => {
    const r = run('cargo test', CARGO_TEST_FAIL, [], 101)
    expect(r.text).toBe([
      ...WARNING_LINES,
      "---- tests::breaks stdout ----\n\nthread 'tests::breaks' (15278477) panicked at src/lib.rs:7:27:\nassertion `left == right` failed: math is off\n  left: 4\n right: 5\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace",
      '',
      'cargo test: 1 passed, 1 failed, 1 ignored (1 suite)',
    ].join('\n'))
  })

  test('a passing run is one line', () => {
    const r = run('cargo test', CARGO_TEST_PASS)
    expect(r.text).toBe('cargo test: 40 passed, 0 failed (2 suites)')
    expect(saving(CARGO_TEST_PASS, r.text)).toBeGreaterThanOrEqual(90)
  })

  test('a program run through cargo keeps its own lines, also one that starts like a cargo verb', () => {
    expect(run('cargo run', '   Compiling app v0.1.0\n    Finished `dev` profile target(s) in 0.1s\n     Running `target/debug/app`\nRunning the job\nFinished: 3 items\n').text).toBe('Running the job\nFinished: 3 items')
  })
})

const ev = (o: object): string => JSON.stringify(o)
const GO_JSON = [
  ev({ Action: 'start', Package: 'example.com/m/a' }),
  ev({ Action: 'start', Package: 'example.com/m/b' }),
  ev({ Action: 'run', Package: 'example.com/m/b', Test: 'TestGood' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Test: 'TestGood', Output: '=== RUN   TestGood\n' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Test: 'TestGood', Output: '--- PASS: TestGood (0.00s)\n' }),
  ev({ Action: 'pass', Package: 'example.com/m/b', Test: 'TestGood', Elapsed: 0 }),
  ev({ Action: 'run', Package: 'example.com/m/b', Test: 'TestBad' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Test: 'TestBad', Output: '=== RUN   TestBad\n' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Test: 'TestBad', Output: '    b_test.go:4: setup done\n' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Test: 'TestBad', Output: '    b_test.go:4: want 3, got 4\n' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Test: 'TestBad', Output: '--- FAIL: TestBad (0.00s)\n' }),
  ev({ Action: 'fail', Package: 'example.com/m/b', Test: 'TestBad', Elapsed: 0 }),
  ev({ Action: 'output', Package: 'example.com/m/b', Output: 'FAIL\n' }),
  ev({ Action: 'run', Package: 'example.com/m/a', Test: 'TestOne' }),
  ev({ Action: 'output', Package: 'example.com/m/a', Test: 'TestOne', Output: '=== RUN   TestOne\n' }),
  ev({ Action: 'output', Package: 'example.com/m/a', Test: 'TestOne', Output: '--- PASS: TestOne (0.00s)\n' }),
  ev({ Action: 'pass', Package: 'example.com/m/a', Test: 'TestOne', Elapsed: 0 }),
  ev({ Action: 'output', Package: 'example.com/m/a', Output: 'PASS\n' }),
  ev({ Action: 'output', Package: 'example.com/m/b', Output: 'FAIL\texample.com/m/b\t0.007s\n' }),
  ev({ Action: 'fail', Package: 'example.com/m/b', Elapsed: 0.007 }),
  ev({ Action: 'output', Package: 'example.com/m/a', Output: 'ok  \texample.com/m/a\t0.007s\n' }),
  ev({ Action: 'pass', Package: 'example.com/m/a', Elapsed: 0.01 }),
].join('\n')

describe('go', () => {
  test('go test asks for -json and reads it as the failed tests and one count', () => {
    expect(planFor('go test ./...')?.flags).toEqual(['-json'])
    expect(GO['go test']?.flags?.(['-json'])).toBe(undefined)
    const r = run('go test', GO_JSON, ['./...', '-json'], 1)
    expect(r.text).toBe('FAIL example.com/m/b (0.007s): 1 failed, 1 passed\n      b_test.go:4: setup done\n      b_test.go:4: want 3, got 4\n  --- FAIL: TestBad (0.00s)\ngo test: 2 passed, 1 failed in 2 packages')
    expect(saving(GO_JSON, r.text)).toBeGreaterThanOrEqual(80)
  })

  test('a build error outside the stream stays, and the text format collapses ok packages', () => {
    expect(run('go test', '# example.com/m/c\nc/c.go:3:1: syntax error\n' + ev({ Action: 'fail', Package: 'example.com/m/c', Elapsed: 0 }), ['-json'], 1).text)
      .toBe('# example.com/m/c\nc/c.go:3:1: syntax error\nFAIL example.com/m/c (0s): 0 failed, 0 passed\ngo test: 0 passed, 0 failed in 1 package')
    expect(run('go test', 'ok  \texample.com/m/a\t0.007s\n--- FAIL: TestBad (0.00s)\n    b_test.go:4: want 3, got 4\nFAIL\nFAIL\texample.com/m/b\t0.006s\nFAIL\n').text)
      .toBe('--- FAIL: TestBad (0.00s)\n    b_test.go:4: want 3, got 4\nFAIL\nFAIL\texample.com/m/b\t0.006s\nFAIL\n1 package ok')
  })

  test('golangci-lint issues without their source frames, counted per linter', () => {
    const text = 'a.go:3:2: Error return value is not checked (errcheck)\n\tos.Remove("x")\n\t^\nb.go:9:1: func `unused` is unused (unused)\nc.go:1:1: exported x (errcheck)\n3 issues:\n'
    expect(run('golangci-lint run', text).text).toBe('a.go:3:2: Error return value is not checked (errcheck)\nb.go:9:1: func `unused` is unused (unused)\nc.go:1:1: exported x (errcheck)\n3 issues: errcheck 2, unused 1')
  })
})

const PYTEST_DEFAULT = '============================= test session starts ==============================\nplatform darwin -- Python 3.14.7, pytest-9.0.2, pluggy-1.6.0\nrootdir: /tmp/py\nplugins: anyio-4.12.1\ncollected 3 items\n\ntest_x.py .FF                                                            [100%]\n\n=================================== FAILURES ===================================\n___________________________________ test_bad ___________________________________\n\n    def test_bad():\n        x = {"a": 1}\n>       assert x["a"] == 2\nE       assert 1 == 2\n\ntest_x.py:6: AssertionError\n___________________________________ test_err ___________________________________\n\n    def test_err():\n>       raise ValueError("boom")\nE       ValueError: boom\n\ntest_x.py:9: ValueError\n=========================== short test summary info ============================\nFAILED test_x.py::test_bad - assert 1 == 2\nFAILED test_x.py::test_err - ValueError: boom\n========================= 2 failed, 1 passed in 0.02s ==========================\n'

const PYTEST_Q = '.FF                                                                      [100%]\n=================================== FAILURES ===================================\n___________________________________ test_bad ___________________________________\ntest_x.py:6: in test_bad\n    assert x["a"] == 2\nE   assert 1 == 2\n___________________________________ test_err ___________________________________\ntest_x.py:9: in test_err\n    raise ValueError("boom")\nE   ValueError: boom\n=========================== short test summary info ============================\nFAILED test_x.py::test_bad - assert 1 == 2\nFAILED test_x.py::test_err - ValueError: boom\n2 failed, 1 passed in 0.01s\n'

describe('python', () => {
  test('pytest keeps failures and the summary, drops the header and progress, in both formats', () => {
    const d = run('pytest', PYTEST_DEFAULT, [], 1)
    expect(d.text.split('\n')[0]).toBe('== FAILURES ==')
    expect(d.text).toContain('E       assert 1 == 2')
    expect(d.text).not.toContain('platform darwin')
    expect(d.text.endsWith('pytest: 2 failed, 1 passed in 0.02s')).toBe(true)
    expect(run('pytest', PYTEST_Q, ['--tb=short', '-q'], 1).text).toBe('== FAILURES ==\n___________________________________ test_bad ___________________________________\ntest_x.py:6: in test_bad\n    assert x["a"] == 2\nE   assert 1 == 2\n___________________________________ test_err ___________________________________\ntest_x.py:9: in test_err\n    raise ValueError("boom")\nE   ValueError: boom\n== short test summary info ==\nFAILED test_x.py::test_bad - assert 1 == 2\nFAILED test_x.py::test_err - ValueError: boom\npytest: 2 failed, 1 passed in 0.01s')
    expect(run('pytest', '........                                        [100%]\n8 passed in 0.01s\n').text).toBe('pytest: 8 passed in 0.01s')
    expect(planFor('python3 -m pytest tests/')?.flags).toEqual(['--tb=short', '-q'])
    expect(planFor('pytest -v')?.flags).toEqual([])
  })

  test('ruff groups issues by rule, from JSON and from the full text format', () => {
    const json = JSON.stringify([
      { code: 'F401', message: '`os` imported but unused', filename: '/p/bad.py' },
      { code: 'F401', message: '`sys` imported but unused', filename: '/p/bad.py' },
      { code: 'F821', message: 'Undefined name `undefined_name`', filename: '/p/bad.py' },
    ], null, 2)
    expect(run('ruff check', json, ['--output-format=json'], 1).text).toBe('F401 (2): `os` imported but unused\n  /p/bad.py\nF821 (1): Undefined name `undefined_name`\n  /p/bad.py\nruff: 3 issues in 2 rules')
    const full = 'F401 [*] `os` imported but unused\n --> bad.py:1:8\n  |\n1 | import os, sys\n  |        ^^\n\nF821 Undefined name `undefined_name`\n --> bad.py:4:12\n  |\n\nFound 2 errors.\n'
    expect(run('ruff check', full, [], 1).text).toBe('F401 (1): `os` imported but unused\n  bad.py\nF821 (1): Undefined name `undefined_name`\n  bad.py\nruff: 2 issues in 2 rules')
    expect(run('ruff check', 'All checks passed!\n').text).toBe('ruff: no issues')
  })

  test('mypy groups by error code; pip list and install drop the noise', () => {
    expect(run('mypy', 'typed.py:2: error: Incompatible return value type (got "int", expected "str")  [return-value]\ntyped.py:3: error: Incompatible types in assignment (expression has type "str", variable has type "int")  [assignment]\nFound 2 errors in 1 file (checked 1 source file)\n', [], 1).text)
      .toBe('return-value (1): Incompatible return value type (got "int", expected "str")\n  typed.py\nassignment (1): Incompatible types in assignment (expression has type "str", variable has type "int")\n  typed.py\nmypy: 2 issues in 2 rules')
    expect(run('pip', 'Package            Version\n------------------ -------\nanyio              4.12.1\npytest             9.0.2\n', ['list']).text).toBe('2 packages:\nanyio 4.12.1\npytest 9.0.2')
    expect(run('pip', 'Collecting rich\n  Downloading rich-15.0.0-py3-none-any.whl (240 kB)\n     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 240.0/240.0 kB 2.1 MB/s eta 0:00:00\nRequirement already satisfied: pygments in ./venv (2.19.2)\nInstalling collected packages: rich\nSuccessfully installed rich-15.0.0\n', ['install', 'rich']).text)
      .toBe('Successfully installed rich-15.0.0')
  })
})
