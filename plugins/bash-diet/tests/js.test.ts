import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult } from '../hooks/filters/common.ts'
import { JS } from '../hooks/filters/js.ts'
import { planFor, runFilter } from '../hooks/pipeline.ts'

tier('user')

function run(key: string, text: string, args: string[] = [], exitCode = 0): FilterResult {
  const filter = JS[key]
  if (filter === undefined) throw new Error(`no filter ${key}`)
  return filter.run({ args, text, exitCode })
}

// Captured from npm 11, pnpm 10, bun 1.4, tsc 5.9, eslint 9, prettier 3, vitest 3 and jest 29 in a scratch project.
const NOTICE = 'npm notice run p@1.0.0 npx\n'

// Captured from mocha 11's spec reporter: twelve passing tests, one pending, two failures.
const MOCHA = `\n\n  math\n${Array.from({ length: 12 }, (_, i) => `    ✔ adds case ${i}\n`).join('')}    1) breaks on purpose\n    - is skipped\nconsole says hi\n\n  strings\n    ✔ trims\n    2) throws\n\n\n  13 passing (5ms)\n  1 pending\n  2 failing\n\n  1) math\n       breaks on purpose:\n\n      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n3000 !== 5\n\n      at Context.<anonymous> (file:///p/test/math.test.js:6:40)\n      at process.processImmediate (node:internal/timers:504:21)\n\n  2) strings\n       throws:\n     TypeError: boom from test\n      at Context.<anonymous> (file:///p/test/math.test.js:12:30)\n      at Runner.run (file:///p/node_modules/mocha/lib/runner.js:9:1)\n\n\n\n`

describe('mocha', () => {
  test('the passing tests go, the test\'s own output, the counts and each failure with its project frames stay', () => {
    const plan = planFor('npx mocha test')
    if (plan === undefined) throw new Error('no plan for mocha')
    expect(runFilter(plan, MOCHA, 2, false)).toEqual({
      text: 'console says hi\n  13 passing (5ms)\n  1 pending\n  2 failing\n\n  1) math\n       breaks on purpose:\n\n      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n3000 !== 5\n\n      at Context.<anonymous> (file:///p/test/math.test.js:6:40)\n\n  2) strings\n       throws:\n     TypeError: boom from test\n      at Context.<anonymous> (file:///p/test/math.test.js:12:30)',
      elided: true,
    })
    expect(run('mocha', '{"stats":{"passes":1}}\n', ['--reporter', 'json']).text).toBe('{"stats":{"passes":1}}')
  })

  // Captured from cypress 16.1 run headless over two specs, one with a failure; the boxes are cut to two rows.
  test('cypress run keeps each failed spec with its failures and the failed rows of the closing table', () => {
    const box = (rows: string[]): string => `  ┌──────┐\n${rows.map(r => `  │ ${r} │\n`).join('')}  └──────┘\n`
    const text = `It looks like this is your first time using Cypress: 16.1.0\n\n❯  Verifying Cypress can run /c/Cypress.app\n✔  Verified Cypress!       /c/Cypress.app\n\nOpening Cypress...\n\n====\n\n  (Run Starting)\n\n${box(['Cypress:        16.1.0', 'Specs:          2 found (math.cy.js, ok.cy.js)'])}\nWarning: The Electron browser is deprecated as a test browser and will be removed in a future version of Cypress.\n\nSwitch to Chrome or another installed browser to avoid a breaking change when you upgrade.\n\n────\n\n  Running:  math.cy.js                                                                      (1 of 2)\n\n\n  math\n    ✓ adds case 0 (21ms)\n    ✓ adds case 1 (5ms)\n    1) breaks on purpose\n\n\n  2 passing (132ms)\n  1 failing\n\n  1) math\n       breaks on purpose:\n\n      AssertionError: expected 4 to equal 5\n      at Context.eval (webpack://cy/./cypress/e2e/math.cy.js:3:49)\n\n\n  (Results)\n\n${box(['Tests:        3', 'Failing:      1'])}\n────\n\n  Running:  ok.cy.js                                                                        (2 of 2)\n\n\n  ok\n    ✓ passes (19ms)\n\n\n  1 passing (29ms)\n\n\n  (Results)\n\n${box(['Tests:        1', 'Failing:      0'])}\n====\n\n  (Run Finished)\n\n\n       Spec                                              Tests  Passing  Failing  Pending  Skipped  \n  ┌────┐\n  │ ✖  math.cy.js                               134ms        3        2        1        -        - │\n  ├────┤\n  │ ✔  ok.cy.js                                  31ms        1        1        -        -        - │\n  └────┘\n    ✖  1 of 2 failed (50%)                      165ms        4        3        1        -        -  \n`
    const plan = planFor('npx cypress run')
    if (plan === undefined) throw new Error('no plan for cypress')
    expect(runFilter(plan, text, 1, false)).toEqual({
      text: 'math.cy.js:\n  2 passing (132ms)\n  1 failing\n\n  1) math\n       breaks on purpose:\n\n      AssertionError: expected 4 to equal 5\n      at Context.eval (webpack://cy/./cypress/e2e/math.cy.js:3:49)\n\n✖  math.cy.js  134ms  3  2  1  -  -\n✖  1 of 2 failed (50%)  165ms  4  3  1  -  -',
      elided: true,
    })
    expect(run('cypress', 'Cypress 16.1.0\n', ['open']).text).toBe('Cypress 16.1.0')
  })
})

describe('package managers', () => {
  test('npm: notices, the script header and deprecations go', () => {
    expect(run('npm run', 'npm notice run p@1.0.0 hello\nnpm notice run echo hello from script\nhello from script\n').text).toBe('hello from script')
    expect(run('npm run', '\n> p@1.0.0 build\n> tsc -p .\n\n').text).toBe('ok')
    const install = 'npm warn deprecated eslint@9.39.5: This version is no longer supported.\nnpm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory.\n\nadded 383 packages in 19s\n\n84 packages are looking for funding\n  run `npm fund` for details\n'
    expect(run('npm install', install).text).toBe('added 383 packages in 19s\n(2 deprecation warnings)')
  })

  test('pnpm and bun installs drop progress; lists stay as rows', () => {
    // Through the plan, as the hook runs it: the subcommand is classified apart from the arguments.
    const planned = (cmd: string, text: string): string => {
      const plan = planFor(cmd)
      if (plan === undefined) throw new Error(`no plan for ${cmd}`)
      return runFilter(plan, text, 0, false).text
    }
    expect(planned('pnpm add -D is-odd', 'Progress: resolved 1, reused 0, downloaded 0, added 0\nPackages: +2\n++\nProgress: resolved 2, reused 2, downloaded 0, added 2, done\n\ndevDependencies:\n+ is-odd 3.0.1\n\nDone in 637ms using pnpm v10.28.2\n'))
      .toBe('devDependencies:\n+ is-odd 3.0.1\nDone in 637ms using pnpm v10.28.2')
    expect(planned('pnpm list', 'Legend: production dependency, optional only, dev only\n\nb@1.0.0 /tmp/b\n\ndevDependencies:\nis-odd 3.0.1\n')).toBe('b@1.0.0 /tmp/b\ndevDependencies:\nis-odd 3.0.1')
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
    expect(run('jest', 'Tests:       1 failed, 15 passed, 16 total\nSnapshots:   0 total\nTime:        0.235 s\n', [], 1).text).toBe('Tests:       1 failed, 15 passed, 16 total')
    expect(run('bun test', 'bun test v1.4.0 (34cbb9a40)\n\nx.test.ts:\nerror: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1\n\n(pass) ok [0.20ms]\n(fail) bad [4.14ms]\n\n 1 pass\n 1 fail\n', [], 1).text)
      .toBe('x.test.ts:\nerror: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1\n\n(fail) bad [4.14ms]\n\n 1 pass\n 1 fail')
  })

  test('vitest, jest and eslint run as written: a JSON report is larger, and a failed run is cut at 10,000 characters', () => {
    for (const cmd of ['npx vitest run test/v.test.ts', 'npx jest', 'npx eslint src']) expect(planFor(cmd)?.flags, cmd).toEqual([])
  })

  test('the default reports of jest 30 and vitest 2 keep the failure with its code frame and the counts', () => {
    const jest = `${NOTICE}npm notice run 'jest'\nFAIL src/math.test.js\n  ● add › adds wrong\n\n    expect(received).toBe(expected) // Object.is equality\n\n    Expected: 5\n    Received: 4\n\n      2 | describe('add', () => {\n    > 4 |   test('adds wrong', () => expect(add(2, 2)).toBe(5))\n        |                                              ^\n\n      at Object.toBe (src/math.test.js:4:46)\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 15 passed, 16 total\nSnapshots:   0 total\nTime:        0.235 s\nRan all test suites.\n`
    expect(run('jest', jest, [], 1).text).toBe("FAIL src/math.test.js\n  ● add › adds wrong\n\n    expect(received).toBe(expected) // Object.is equality\n\n    Expected: 5\n    Received: 4\n\n      2 | describe('add', () => {\n    > 4 |   test('adds wrong', () => expect(add(2, 2)).toBe(5))\n        |                                              ^\n\n      at Object.toBe (src/math.test.js:4:46)\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 15 passed, 16 total")
    const vitest = `${NOTICE}\n RUN  v2.1.9 /w/node\n\n ❯ src/math.test.ts (16 tests | 1 failed) 6ms\n   × add > adds negatives 4ms\n     → expected -5 to be -6 // Object.is equality\n\n⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  src/math.test.ts > add > adds negatives\nAssertionError: expected -5 to be -6 // Object.is equality\n\n Test Files  1 failed (1)\n      Tests  1 failed | 15 passed (16)\n   Start at  16:43:21\n   Duration  432ms (transform 51ms, setup 0ms)\n`
    const v = run('vitest', vitest, ['run'], 1).text
    expect(v).toContain(' FAIL  src/math.test.ts > add > adds negatives\nAssertionError: expected -5 to be -6')
    expect(v).not.toMatch(/RUN|Start at|Duration/)
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
