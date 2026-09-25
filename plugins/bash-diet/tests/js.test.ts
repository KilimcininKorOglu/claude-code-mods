import { describe, expect, test, tier } from 'claude-code/testing'

import { withFlags, read } from '../hooks/command.ts'
import type { FilterResult } from '../hooks/filters/common.ts'
import { JS } from '../hooks/filters/js.ts'
import { planFor } from '../hooks/pipeline.ts'

tier('user')

function run(key: string, text: string, args: string[] = [], exitCode = 0): FilterResult {
  const filter = JS[key]
  if (filter === undefined) throw new Error(`no filter ${key}`)
  return filter.run({ args, text, exitCode })
}

// Captured from npm 11, pnpm 10, bun 1.4, tsc 5.9, eslint 9, prettier 3, vitest 3 and jest 29 in a scratch project.
const NOTICE = 'npm notice run p@1.0.0 npx\n'

describe('package managers', () => {
  test('npm: notices, the script header and deprecations go', () => {
    expect(run('npm run', 'npm notice run p@1.0.0 hello\nnpm notice run echo hello from script\nhello from script\n').text).toBe('hello from script')
    expect(run('npm run', '\n> p@1.0.0 build\n> tsc -p .\n\n').text).toBe('ok')
    const install = 'npm warn deprecated eslint@9.39.5: This version is no longer supported.\nnpm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory.\n\nadded 383 packages in 19s\n\n84 packages are looking for funding\n  run `npm fund` for details\n'
    expect(run('npm install', install).text).toBe('added 383 packages in 19s\n(2 deprecation warnings)')
  })

  test('pnpm and bun installs drop progress; lists stay as rows', () => {
    expect(run('pnpm', 'Progress: resolved 1, reused 0, downloaded 0, added 0\nPackages: +2\n++\nProgress: resolved 2, reused 2, downloaded 0, added 2, done\n\ndevDependencies:\n+ is-odd 3.0.1\n\nDone in 637ms using pnpm v10.28.2\n', ['add', '-D', 'is-odd']).text)
      .toBe('devDependencies:\n+ is-odd 3.0.1\nDone in 637ms using pnpm v10.28.2')
    expect(run('pnpm', 'Legend: production dependency, optional only, dev only\n\nb@1.0.0 /tmp/b\n\ndevDependencies:\nis-odd 3.0.1\n', ['list']).text).toBe('b@1.0.0 /tmp/b\ndevDependencies:\nis-odd 3.0.1')
    expect(run('bun install', 'bun install v1.4.0 (34cbb9a40)\n[286.86ms] migrated lockfile from pnpm-lock.yaml\nSaved lockfile\n\n1 package installed [293.00ms]\n').text)
      .toBe('bun install v1.4.0 (34cbb9a40)\nSaved lockfile\n1 package installed [293.00ms]')
  })
})

const VITEST_TEXT = ` RUN  v3.2.7 /tmp/p\n\n ❯ test/v.test.ts (3 tests | 1 failed) 6ms\n   ✓ adds 1ms\n   × breaks 5ms\n     → expected { a: 1 } to deeply equal { a: 2 }\n   ✓ more 0ms\n\n⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  test/v.test.ts > breaks\nAssertionError: expected { a: 1 } to deeply equal { a: 2 }\n\n Test Files  1 failed (1)\n      Tests  1 failed | 2 passed (3)\n   Start at  14:56:49\n   Duration  342ms (transform 27ms, setup 0ms)\n`

const report = (failure: string) => JSON.stringify({
  numTotalTestSuites: 1, numPassedTests: 2, numFailedTests: 1, numPendingTests: 0,
  testResults: [{
    name: '/tmp/p/test/v.test.ts', status: 'failed', message: '',
    assertionResults: [
      { fullName: 'adds', status: 'passed', title: 'adds', failureMessages: [] },
      { fullName: 'breaks', status: 'failed', title: 'breaks', failureMessages: [failure] },
      { fullName: 'more', status: 'passed', title: 'more', failureMessages: [] },
    ],
  }],
})

const VITEST_FAILURE = 'AssertionError: expected { a: 1 } to deeply equal { a: 2 }\n    at /tmp/p/test/v.test.ts:3:39\n    at file:///tmp/p/node_modules/@vitest/runner/dist/chunk-hooks.js:155:11\n    at new Promise (<anonymous>)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)'

describe('test runners', () => {
  test('a JSON report reads as each failure with its first own stack frame, and one count', () => {
    const r = run('vitest', `${NOTICE}${report(VITEST_FAILURE)}`, ['run', '--reporter=json'], 1)
    expect(r.text).toBe('FAIL /tmp/p/test/v.test.ts > breaks\n  AssertionError: expected { a: 1 } to deeply equal { a: 2 }\n  at /tmp/p/test/v.test.ts:3:39\nvitest: 2 passed, 1 failed (1 file)')
  })

  test('the text report keeps failures and the counts', () => {
    const r = run('vitest', VITEST_TEXT, ['run'], 1)
    expect(r.text).not.toContain('✓ adds')
    expect(r.text).toContain('× breaks 5ms')
    expect(r.text).toContain('Tests  1 failed | 2 passed (3)')
    expect(r.text).not.toContain('Duration')
    expect(run('bun test', 'bun test v1.4.0 (34cbb9a40)\n\nx.test.ts:\nerror: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1\n\n(pass) ok [0.20ms]\n(fail) bad [4.14ms]\n\n 1 pass\n 1 fail\n', [], 1).text)
      .toBe('x.test.ts:\nerror: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1\n\n(fail) bad [4.14ms]\n\n 1 pass\n 1 fail')
  })

  test('vitest gets its reporter after `run`, jest gets --json, and neither in watch mode', () => {
    const cmd = 'npx vitest run test/v.test.ts'
    const plan = planFor(cmd)
    const r = read(cmd)
    if (plan === undefined || r.kind !== 'target') throw new Error('no plan')
    expect(withFlags(cmd, r.target, plan.nameEnd, plan.flags)).toBe('npx vitest run test/v.test.ts --reporter=json')
    expect(planFor('npx vitest')?.flags).toEqual([])
    expect(planFor('npx jest')?.flags).toEqual(['--json'])
    expect(planFor('npx jest --watch')?.flags).toEqual([])
  })
})

describe('compilers and linters', () => {
  test('tsc errors grouped by file', () => {
    const text = `${NOTICE}src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/a.ts(2,19): error TS7006: Parameter 'x' implicitly has an 'any' type.\nsrc/b.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.\n`
    expect(run('tsc', text, [], 2).text).toBe("src/a.ts\n  (1,14) TS2322: Type 'string' is not assignable to type 'number'.\n  (2,19) TS7006: Parameter 'x' implicitly has an 'any' type.\nsrc/b.ts\n  (1,7) TS2322: Type 'number' is not assignable to type 'string'.\ntsc: 3 errors in 2 files")
  })

  test('eslint grouped by rule, from JSON and from the stylish text', () => {
    const json = `${NOTICE}${JSON.stringify([{ filePath: '/p/src/c.js', messages: [
      { ruleId: 'no-unused-vars', message: "'unused' is assigned a value but never used." },
      { ruleId: 'no-undef', message: "'undefinedThing' is not defined." },
      { ruleId: 'no-unused-vars', message: "'other' is assigned a value but never used." },
    ] }])}`
    const expected = "no-unused-vars (2): 'unused' is assigned a value but never used.\n  /p/src/c.js\nno-undef (1): 'undefinedThing' is not defined.\n  /p/src/c.js\neslint: 3 issues in 2 rules"
    expect(run('eslint', json, ['-f', 'json'], 1).text).toBe(expected)
    const stylish = "\n/p/src/c.js\n  1:7  error  'unused' is assigned a value but never used.  no-unused-vars\n  2:1  error  'undefinedThing' is not defined.              no-undef\n  3:7  error  'other' is assigned a value but never used.   no-unused-vars\n\n✖ 3 problems (3 errors, 0 warnings)\n"
    expect(run('eslint', stylish, [], 1).text).toBe(expected)
    expect(run('eslint', '', [], 0).text).toBe('eslint: no issues')
  })

  test('prettier --check as the list of files it would change', () => {
    expect(run('prettier', `${NOTICE}Checking formatting...\n[warn] src/a.ts\n[warn] src/d.js\n[warn] Code style issues found in 2 files. Run Prettier with --write to fix.\n`, ['--check', 'src'], 1).text)
      .toBe('prettier: 2 files need formatting\n  src/a.ts\n  src/d.js')
  })
})
