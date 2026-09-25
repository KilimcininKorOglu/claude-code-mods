import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult } from '../hooks/filters/common.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

function planned(command: string, text: string, exitCode = 2): FilterResult {
  const plan = planFor(command)
  if (plan === undefined) throw new Error(`no plan for ${command}`)
  return runFilter(plan, text, exitCode, false)
}

// Captured from `make test` in scratch projects of six passing tests and one failing test, each recipe
// running the runner named in its first line; the project paths are shortened.
const GO = 'go test -v ./...\n=== RUN   TestBad\n    bad_test.go:3: want 2, got 3\n--- FAIL: TestBad (0.00s)\n=== RUN   TestOk1\n    ok1_test.go:3: fine\n--- PASS: TestOk1 (0.00s)\n=== RUN   TestOk2\n    ok2_test.go:3: fine\n--- PASS: TestOk2 (0.00s)\n=== RUN   TestOk3\n    ok3_test.go:3: fine\n--- PASS: TestOk3 (0.00s)\n=== RUN   TestOk4\n    ok4_test.go:3: fine\n--- PASS: TestOk4 (0.00s)\n=== RUN   TestOk5\n    ok5_test.go:3: fine\n--- PASS: TestOk5 (0.00s)\n=== RUN   TestOk6\n    ok6_test.go:3: fine\n--- PASS: TestOk6 (0.00s)\nFAIL\nFAIL\texample.com/m\t0.015s\nFAIL\nmake: *** [test] Error 1\n'
const CARGO = 'cargo test\n   Compiling m v0.1.0 (/p/rs)\n    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.30s\n     Running unittests src/lib.rs (target/debug/deps/m-60aab5edee32ab1c)\n\nrunning 7 tests\ntest t::ok1 ... ok\ntest t::ok2 ... ok\ntest t::bad ... FAILED\ntest t::ok3 ... ok\ntest t::ok4 ... ok\ntest t::ok5 ... ok\ntest t::ok6 ... ok\n\nfailures:\n\n---- t::bad stdout ----\n\nthread \'t::bad\' (18827814) panicked at src/lib.rs:9:18:\nassertion `left == right` failed\n  left: 1\n right: 2\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n\n\nfailures:\n    t::bad\n\ntest result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\nerror: test failed, to rerun pass `--lib`\nmake: *** [test] Error 101\n'
const PYTEST = 'pytest -v\n============================= test session starts ==============================\nplatform darwin -- Python 3.14.7, pytest-9.0.2, pluggy-1.6.0 -- /opt/homebrew/opt/python@3.14/bin/python3.14\ncachedir: .pytest_cache\nrootdir: /p/py\nplugins: anyio-4.12.1\ncollecting ... collected 7 items\n\ntest_m.py::test_ok1 PASSED                                               [ 14%]\ntest_m.py::test_ok2 PASSED                                               [ 28%]\ntest_m.py::test_ok3 PASSED                                               [ 42%]\ntest_m.py::test_ok4 PASSED                                               [ 57%]\ntest_m.py::test_ok5 PASSED                                               [ 71%]\ntest_m.py::test_ok6 PASSED                                               [ 85%]\ntest_m.py::test_bad FAILED                                               [100%]\n\n=================================== FAILURES ===================================\n___________________________________ test_bad ___________________________________\n\n>   def test_bad(): assert 1 == 2\n                    ^^^^^^^^^^^^^\nE   assert 1 == 2\n\ntest_m.py:7: AssertionError\n=========================== short test summary info ============================\nFAILED test_m.py::test_bad - assert 1 == 2\n========================= 1 failed, 6 passed in 0.04s ==========================\nmake: *** [test] Error 1\n'
const VITEST = 'npx vitest run --reporter=verbose v.test.mjs\n\n RUN  v5.0.2 /p/js\n\n ✓ v.test.mjs > ok 1 1ms\n ✓ v.test.mjs > ok 2 0ms\n ✓ v.test.mjs > ok 3 0ms\n ✓ v.test.mjs > ok 4 0ms\n ✓ v.test.mjs > ok 5 0ms\n ✓ v.test.mjs > ok 6 0ms\n × v.test.mjs > bad 4ms\n   → expected 1 to be 2 // Object.is equality\n\n FAIL  v.test.mjs > bad\nAssertionError: expected 1 to be 2 // Object.is equality\n\n Test Files  1 failed (1)\n      Tests  1 failed | 6 passed (7)\n\nmake: *** [vitest] Error 1\n'
// Captured from `make test` in this mod's own directory with one test failing, cut to that test's file.
const PLUGIN_TEST = "claude plugin test .\n\ntests/register.test.ts:\n(pass) bash-diet > an unknown command is cleaned up and the gain is shown [145.24ms]\n(pass) bash-diet > output a filter cannot shrink comes back as it was [81.96ms]\n(pass) bash-diet > the raw variable, an opaque command, off and an exclude leave the output alone [78.78ms]\n(fail) bash-diet > a global rule runs untrusted and comes before the mod's own filter; a broken file says why [63.96ms]\n  AssertionError: expect(received).toMatch()\n  \n  Expected: /^project: \\.bash-diet\\/filters\\.json \\(none\\)\\nglobal: ~\\/\\.claude\\/bash-diet\\/filters\\.json: mine\\nbuilt-in: cc, make, /\n  Received: \"project: .bash-diet/filters.json (none)\\nglobal: ~/.claude/bash-diet/filters.json: mine\\nbuilt-in: cc, cmake-build, cmake, brew, rsync, df, du, ping, shellcheck\"\n\n 127 pass\n 1 fail\nRan 128 tests across 14 files. [1.68s]\nmake: *** [test] Error 1\n"

describe('make', () => {
  test('passing test lines of every runner are counted, and each failure and summary stays', () => {
    const cargo = planned('make test', CARGO)
    expect(cargo.text).toBe(CARGO.replace(/test t::ok[1-6] \.\.\. ok\n/g, '').replace('test t::bad ... FAILED', '… 6 passing tests left out\ntest t::bad ... FAILED').replace(/\n\n\n/g, '\n\n').trimEnd())
    expect(cargo.elided).toBe(true)
    for (const [text, failure] of [[GO, '--- FAIL: TestBad (0.00s)'], [PYTEST, 'FAILED test_m.py::test_bad - assert 1 == 2'], [VITEST, ' × v.test.mjs > bad 4ms'], [PLUGIN_TEST, 'Received: "project: .bash-diet/filters.json (none)']] as const) {
      const r = planned('make test', text).text
      expect(r).toContain(failure)
      expect(r).toContain(text === PLUGIN_TEST ? '… 3 passing tests left out' : '… 6 passing tests left out')
      expect(r).not.toMatch(/--- PASS|=== RUN|\.\.\. ok$|PASSED {2}|✓ v\.test|\(pass\)/m)
    }
  })

  test('a test file header over passing tests alone goes, and one over a failure stays', () => {
    const text = 'claude plugin test .\n\ntests/a.test.ts:\n(pass) a > one [1.00ms]\n(pass) a > two [0.50ms]\n\ntests/b.test.ts:\n(pass) b > one [0.40ms]\n(fail) b > two [0.30ms]\n  Expected: 1\n  Received: 2\n\ntests/c.test.ts:\n(pass) c > one [0.20ms]\n\n 4 pass\n 1 fail\nRan 5 tests across 3 files. [0.10s]\nmake: *** [test] Error 1\n'
    expect(planned('make test', text).text).toBe('claude plugin test .\n\n… 4 passing tests left out\n\ntests/b.test.ts:\n(fail) b > two [0.30ms]\n  Expected: 1\n  Received: 2\n\n 4 pass\n 1 fail\nRan 5 tests across 3 files. [0.10s]\nmake: *** [test] Error 1')
  })

  test('go test -v keeps what a passing test logged, and the count stands where the first pass stood', () => {
    const lines = planned('make test', GO).text.split('\n')
    expect(lines.slice(0, 5)).toEqual(['go test -v ./...', '    bad_test.go:3: want 2, got 3', '--- FAIL: TestBad (0.00s)', '    ok1_test.go:3: fine', '… 6 passing tests left out'])
    expect(lines).toContain('    ok6_test.go:3: fine')
  })

  test('make\'s own directory lines and the compiler excerpts go; a build with no tests loses nothing else', () => {
    expect(planned('gmake -C lib', "gmake[1]: Entering directory '/p/lib'\nbuilding a\ngcc -c bad.c\nbad.c:1:32: error: use of undeclared identifier 'y'\n    1 | int main(void) { int x; return y; }\n      |                                ^\n1 error generated.\ngmake[1]: *** [a] Error 1\ngmake[1]: Leaving directory '/p/lib'\n")).toEqual({ text: "building a\ngcc -c bad.c\nbad.c:1:32: error: use of undeclared identifier 'y'\n1 error generated.\ngmake[1]: *** [a] Error 1", elided: false })
    const vite = 'npx vite build\nvite v8.3.1 building client environment for production...\ntransforming...\n✓ 11 modules transformed.\nrendering chunks...\ndist/index.html                0.09 kB │ gzip: 0.10 kB\n\n✓ built in 38ms\n'
    expect(planned('make build', vite, 0)).toEqual({ text: vite.trimEnd(), elided: false })
    expect(planFor('make check')?.family).toBe('make')
  })
})
