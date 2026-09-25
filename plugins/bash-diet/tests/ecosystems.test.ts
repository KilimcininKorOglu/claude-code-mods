import { describe, expect, test, tier } from 'claude-code/testing'

import type { FilterResult, FilterTable } from '../hooks/filters/common.ts'
import { DOTNET } from '../hooks/filters/dotnet.ts'
import { filterFor } from '../hooks/filters/index.ts'
import { JVM } from '../hooks/filters/jvm.ts'
import { PHP } from '../hooks/filters/php.ts'
import { RUBY } from '../hooks/filters/ruby.ts'
import { read, withFlags } from '../hooks/command.ts'
import { planFor } from '../hooks/pipeline.ts'
import { classify } from '../hooks/rules.ts'

tier('user')

const TABLE: FilterTable = { ...JVM, ...RUBY, ...PHP, ...DOTNET }

function run(key: string, text: string, args: string[] = [], exitCode = 0): FilterResult {
  const filter = TABLE[key]
  if (filter === undefined) throw new Error(`no filter ${key}`)
  return filter.run({ args, text, exitCode })
}

/** The command as the mod runs it, with the flags its filter asks for. */
function flagged(cmd: string): string {
  const plan = planFor(cmd)
  const r = read(cmd)
  if (plan === undefined || r.kind !== 'target') throw new Error(`no plan for ${cmd}`)
  return withFlags(cmd, r.target, plan.nameEnd, plan.flags)
}

const saving = (raw: string, shown: string): number => Math.round((1 - shown.length / raw.length) * 100)

// Maven 3.9 with Surefire 3.5.5, one failing class among passing ones.
const MVN_TEST = `[INFO] Scanning for projects...
[INFO]
[INFO] ----------------------< commons-cli:commons-cli >-----------------------
[INFO] Building Apache Commons CLI 1.11.1-SNAPSHOT
[INFO]   from pom.xml
[INFO] --------------------------------[ jar ]---------------------------------
[INFO]
[INFO] --- surefire:3.5.5:test (default-test) @ commons-cli ---
[INFO]
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running org.apache.commons.cli.SolrCliTest
[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.005 s -- in org.apache.commons.cli.SolrCliTest
[INFO] Running org.apache.commons.cli.ParseTest
[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.033 s <<< FAILURE! -- in org.apache.commons.cli.ParseTest
[ERROR] org.apache.commons.cli.ParseTest.parsesValue -- Time elapsed: 0.025 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <expected> but was: <actual>
\tat org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)
\tat org.junit.jupiter.api.Assertions.assertEquals(Assertions.java:1145)
\tat org.apache.commons.cli.ParseTest.parsesValue(ParseTest.java:25)
\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)

[INFO] Running org.apache.commons.cli.PatternOptionBuilderTest
[WARNING] Tests run: 10, Failures: 0, Errors: 0, Skipped: 2, Time elapsed: 0.066 s -- in org.apache.commons.cli.PatternOptionBuilderTest
[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   ParseTest.parsesValue:25 expected: <expected> but was: <actual>
[INFO]
[ERROR] Tests run: 978, Failures: 1, Errors: 0, Skipped: 61
[INFO]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  01:05 min
[INFO] Finished at: 2026-05-21T14:57:09Z
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.5:test (default-test) on project commons-cli: There are test failures.
[ERROR]
[ERROR] Please refer to /w/target/surefire-reports for the individual test results.
[ERROR] -> [Help 1]
`

describe('jvm', () => {
  test('mvn keeps the failing class with its project frames, the totals and the verdict', () => {
    const r = run('mvn', MVN_TEST, ['test'])
    expect(r.text).toBe([
      '[ERROR] Tests run: 1, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.033 s <<< FAILURE! -- in org.apache.commons.cli.ParseTest',
      '[ERROR] org.apache.commons.cli.ParseTest.parsesValue -- Time elapsed: 0.025 s <<< FAILURE!',
      'org.opentest4j.AssertionFailedError: expected: <expected> but was: <actual>',
      '\tat org.apache.commons.cli.ParseTest.parsesValue(ParseTest.java:25)',
      '[ERROR] Failures:',
      '[ERROR]   ParseTest.parsesValue:25 expected: <expected> but was: <actual>',
      '[ERROR] Tests run: 978, Failures: 1, Errors: 0, Skipped: 61',
      'BUILD FAILURE',
      'Total time:  01:05 min',
      '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.5.5:test (default-test) on project commons-cli: There are test failures.',
      '[ERROR] Please refer to /w/target/surefire-reports for the individual test results.',
    ].join('\n'))
    expect(saving(MVN_TEST, r.text)).toBeGreaterThanOrEqual(60)
  })

  test('mvn keeps a compile error with its javac notes, and leaves verbose and non-English runs whole', () => {
    const text = '[INFO] --- compiler:3.15.0:compile (default-compile) @ cli ---\n[ERROR] COMPILATION ERROR :\n[INFO] -------------------------------------------------------------\n[ERROR] src/main/java/a/B.java:[21,16] cannot find symbol\n  symbol:   variable bar\n  location: class a.B\n[INFO] 1 error\n[INFO] BUILD FAILURE\n'
    expect(run('mvn', text, ['compile']).text).toBe('[ERROR] COMPILATION ERROR :\n[ERROR] src/main/java/a/B.java:[21,16] cannot find symbol\n  symbol:   variable bar\n  location: class a.B\nBUILD FAILURE')
    expect(run('mvn', text, ['-X', 'compile']).text).toContain('[INFO] 1 error')
    expect(run('mvn', '[INFO] ÉCHEC DE LA CONSTRUCTION\n[INFO] Temps total : 1 s\n').text).toContain('ÉCHEC')
  })

  test('./mvnw and ./gradlew.bat read as their tools', () => {
    expect(classify(['./mvnw', 'clean', 'install'])?.tool).toBe('mvn')
    expect(filterFor({ tool: 'gradlew', sub: 'build', args: [], nameEnd: 1 })).toBe(JVM.gradlew)
  })

  test('gradle drops tasks with no work, passing tests and the help block', () => {
    const text = '> Configure project :app\n> Task :app:preBuild UP-TO-DATE\n> Task :app:compileDebugKotlin FAILED\n\nFAILURE: Build failed with an exception.\n\n* What went wrong:\nExecution failed for task \':app:compileDebugKotlin\'.\n> A failure occurred while executing org.jetbrains.kotlin.compilerRunner.GradleKotlinCompilerWork\n   > Compilation error. See log for more details\n\ne: /w/app/src/main/java/Main.kt: (42, 5): Unresolved reference: MyService\n\n* Try:\n> Run with --stacktrace option to get the stack trace.\n> Run with --scan to get full insights.\n\n* Get more help at https://help.gradle.org\n\nBUILD FAILED in 12s\n2 actionable tasks: 2 executed\n'
    expect(run('gradle', text, ['build']).text).toBe('> Task :app:compileDebugKotlin FAILED\n\nFAILURE: Build failed with an exception.\n\n* What went wrong:\nExecution failed for task \':app:compileDebugKotlin\'.\n> A failure occurred while executing org.jetbrains.kotlin.compilerRunner.GradleKotlinCompilerWork\n   > Compilation error. See log for more details\n\ne: /w/app/src/main/java/Main.kt: (42, 5): Unresolved reference: MyService\n\nBUILD FAILED in 12s')
    const tests = 'a.CalcTest > adds PASSED\na.CalcTest > subtracts FAILED\n    java.lang.AssertionError: expected:<3> but was:<-1>\n        at org.junit.Assert.fail(Assert.java:89)\n        at a.CalcTest.subtracts(CalcTest.kt:25)\n\n2 tests completed, 1 failed\n'
    expect(run('gradlew', tests, ['test']).text).toBe('a.CalcTest > subtracts FAILED\n    java.lang.AssertionError: expected:<3> but was:<-1>\n        at a.CalcTest.subtracts(CalcTest.kt:25)\n\n2 tests completed, 1 failed')
  })

  test('sbt keeps the failed tests under their suite, the errors and the counts', () => {
    const text = '[info] welcome to sbt 1.9.7 (Eclipse Adoptium Java 17.0.9)\n[info] loading project definition from /w/project\n[info] MyServiceSpec:\n[info] A MyService\n[info]   - should return default config\n[info]   - should reject invalid parameters *** FAILED ***\n[info]     Expected ServiceException to be thrown (MyServiceSpec.scala:45)\n[info]   - should retry\n[info] MyRepositorySpec:\n[info]   - should save entities\n[info] Run completed in 8 seconds, 442 milliseconds.\n[info] Total number of tests run: 4\n[info] Tests: succeeded 3, failed 1, canceled 0, ignored 0, pending 0\n[info] *** 1 TEST FAILED ***\n[error] Failed tests:\n[error]   com.example.MyServiceSpec\n[error] (Test / test) sbt.TestsFailedException: Tests unsuccessful\n'
    expect(run('sbt', text, ['test']).text).toBe('[info] MyServiceSpec:\n[info]   - should reject invalid parameters *** FAILED ***\n[info]     Expected ServiceException to be thrown (MyServiceSpec.scala:45)\n[info] Run completed in 8 seconds, 442 milliseconds.\n[info] Total number of tests run: 4\n[info] Tests: succeeded 3, failed 1, canceled 0, ignored 0, pending 0\n[info] *** 1 TEST FAILED ***\n[error] Failed tests:\n[error]   com.example.MyServiceSpec\n[error] (Test / test) sbt.TestsFailedException: Tests unsuccessful')
  })
})

// Captured from `rake test` with Ruby 4.0 and minitest on this machine.
const RAKE = "Run options: --seed 60417\n\n# Running:\n\nF.....S.E......\n\nFinished in 0.000540s, 27777.7789 runs/s, 24074.0750 assertions/s.\n\n  1) Failure:\nCalcTest#test_add [test/calc_test.rb:4]:\nExpected: 4\n  Actual: 5\n\n  2) Error:\nCalcTest#test_boom:\nArgumentError: bad input\n    test/calc_test.rb:5:in 'CalcTest#test_boom'\n\n15 runs, 13 assertions, 1 failures, 1 errors, 1 skips\n\nYou have skipped tests. Run with --verbose for details.\nrake aborted!\nCommand failed with status (1)\n/opt/homebrew/lib/ruby/gems/4.0.0/gems/rake-13.3.1/lib/rake/testtask.rb:130:in 'block (3 levels) in Rake::TestTask#define'\n/opt/homebrew/lib/ruby/gems/4.0.0/gems/rake-13.3.1/lib/rake/application.rb:188:in 'Rake::Application#invoke_task'\n/opt/homebrew/lib/ruby/gems/4.0.0/gems/rake-13.3.1/exe/rake:27:in '<top (required)>'\nTasks: TOP => test\n(See full trace by running task with --trace)\n"

describe('ruby', () => {
  test('rake test keeps the failed tests, the count line and the abort, and drops the gem frames', () => {
    const r = run('rake test', RAKE)
    expect(r.text).toBe("  1) Failure:\nCalcTest#test_add [test/calc_test.rb:4]:\nExpected: 4\n  Actual: 5\n\n  2) Error:\nCalcTest#test_boom:\nArgumentError: bad input\n    test/calc_test.rb:5:in 'CalcTest#test_boom'\n\n15 runs, 13 assertions, 1 failures, 1 errors, 1 skips\n\nrake aborted!\nCommand failed with status (1)")
    expect(saving(RAKE, r.text)).toBeGreaterThanOrEqual(60)
    expect(run('ruby', 'hello\n').text).toBe('hello')
  })

  test('rspec asks for JSON and reports the failed examples with their first project frame', () => {
    expect(flagged('bundle exec rspec spec/models')).toBe('bundle exec rspec --format json spec/models')
    expect(flagged('rspec -f d')).toBe('rspec -f d')
    const report = JSON.stringify({
      version: '3.13.0',
      examples: [
        { full_description: 'User is valid', status: 'passed', file_path: './spec/models/user_spec.rb', line_number: 5, exception: null },
        { full_description: 'User saves to database', status: 'failed', file_path: './spec/models/user_spec.rb', line_number: 10, exception: { class: 'RSpec::Expectations::ExpectationNotMetError', message: '\nexpected true\n     got false', backtrace: ['/usr/lib/ruby/gems/3.3.0/gems/rspec-support-3.13.1/lib/rspec/support.rb:110:in `fail_with\'', "./spec/models/user_spec.rb:11:in `block (2 levels) in <top (required)>'"] } },
      ],
      summary: { example_count: 2, failure_count: 1 },
      summary_line: '2 examples, 1 failure',
    })
    expect(run('rspec', `Run options: exclude {:slow=>true}\n${report}`).text).toBe("1) User saves to database (./spec/models/user_spec.rb:10)\n   RSpec::Expectations::ExpectationNotMetError: expected true\n        got false\n   ./spec/models/user_spec.rb:11:in `block (2 levels) in <top (required)>'\nrspec: 2 examples, 1 failure")
  })

  test('rubocop groups offenses by cop, and says so when there are none', () => {
    const offense = (cop: string, message: string) => ({ severity: 'convention', message, cop_name: cop, location: { line: 1 } })
    const report = { metadata: {}, files: [{ path: 'app/a.rb', offenses: [offense('Layout/TrailingWhitespace', 'Trailing whitespace detected.'), offense('Style/StringLiterals', 'Prefer single quotes.')] }, { path: 'app/b.rb', offenses: [offense('Layout/TrailingWhitespace', 'Trailing whitespace detected.')] }], summary: { offense_count: 3, inspected_file_count: 2 } }
    expect(run('rubocop', JSON.stringify(report)).text).toBe('Layout/TrailingWhitespace (2): Trailing whitespace detected.\n  app/a.rb, app/b.rb\nStyle/StringLiterals (1): Prefer single quotes.\n  app/a.rb\nrubocop: 3 issues in 2 rules')
    expect(run('rubocop', JSON.stringify({ metadata: {}, files: [], summary: { offense_count: 0, inspected_file_count: 15 } })).text).toBe('rubocop: no offenses in 15 files')
  })

  test('bundle install keeps what it installed', () => {
    expect(run('bundle install', 'Fetching gem metadata from https://rubygems.org/.........\nResolving dependencies...\nUsing rake 13.3.1\nUsing minitest 5.25.5\nFetching json 2.10.2\nInstalling json 2.10.2 with native extensions\nBundle complete! 3 Gemfile dependencies, 3 gems now installed.\n').text)
      .toBe('Installing json 2.10.2 with native extensions\nBundle complete! 3 Gemfile dependencies, 3 gems now installed.')
  })
})

describe('php', () => {
  // Captured from PHP 8.6 on this machine.
  test('php -l writes each syntax error once and counts the files that passed', () => {
    const bad = 'PHP Parse error:  syntax error, unexpected token "{", expecting variable in ../bad.php on line 2\n\nParse error: syntax error, unexpected token "{", expecting variable in ../bad.php on line 2\nErrors parsing ../bad.php\n'
    expect(run('php', bad, ['-l', '../bad.php']).text).toBe('Parse error: syntax error, unexpected token "{", expecting variable in ../bad.php on line 2\nphp -l: 0 files without syntax errors, 1 error')
    expect(run('php', 'No syntax errors detected in ../good.php\n', ['-l', '../good.php']).text).toBe('php -l: 1 file without syntax errors')
  })

  test('phpunit keeps the failures and the result, and drops the header and the progress rows', () => {
    const text = 'PHPUnit 10.5.0 by Sebastian Bergmann and contributors.\n\nRuntime:       PHP 8.2.27\nConfiguration: /w/phpunit.xml\n\n.F................................................  50 / 60 ( 83%)\n..........                                          60 / 60 (100%)\n\nTime: 00:01:23.456, Memory: 48.00 MB\n\nThere was 1 failure:\n\n1) App\\Tests\\UserTest::testEmailValidation\nFailed asserting that false is true.\n\n/w/tests/UserTest.php:38\n/w/vendor/phpunit/phpunit/src/Framework/TestCase.php:1210\n\nFAILURES!\nTests: 60, Assertions: 140, Failures: 1.\n'
    expect(run('phpunit', text).text).toBe('There was 1 failure:\n\n1) App\\Tests\\UserTest::testEmailValidation\nFailed asserting that false is true.\n\n/w/tests/UserTest.php:38\n\nFAILURES!\nTests: 60, Assertions: 140, Failures: 1.')
    expect(run('pest', '\n  PASS  Tests\\Unit\\ExampleTest\n  ✓ that true is true  0.01s\n\n  Tests:    1 passed (1 assertions)\n  Duration: 0.12s\n').text).toBe('  Tests:    1 passed (1 assertions)')
  })

  test('phpstan asks for JSON and groups the errors by file with their lines', () => {
    expect(flagged('vendor/bin/phpstan analyse src')).toBe('vendor/bin/phpstan analyse --error-format=json --no-progress src')
    const report = { totals: { errors: 0, file_errors: 3 }, files: { '/var/www/app/Models/User.php': { errors: 2, messages: [{ message: 'Property User::$id (int) does not accept null.', line: 15, identifier: 'property.nonObject' }, { message: 'Method User::find() has no return type specified.', line: 45, identifier: 'missingType.return' }] }, '/var/www/app/Http/Kernel.php': { errors: 1, messages: [{ message: 'Variable $user might not be defined.', line: 56, identifier: 'variable.undefined' }] } }, errors: [] }
    expect(run('phpstan analyse', JSON.stringify(report, null, 2)).text).toBe('Models/User.php (2):\n  15 Property User::$id (int) does not accept null. [property.nonObject]\n  45 Method User::find() has no return type specified. [missingType.return]\nHttp/Kernel.php (1):\n  56 Variable $user might not be defined. [variable.undefined]\nphpstan: 3 errors in 2 files under /var/www/app/')
    expect(run('phpstan analyse', JSON.stringify({ totals: { errors: 0, file_errors: 0 }, files: {}, errors: [] })).text).toBe('phpstan: no errors')
  })
})

// Captured from `dotnet test` and `dotnet build` with .NET 10 and xUnit on this machine; the project directory is shortened to /w.
const DOTNET_TEST = "  Determining projects to restore...\n  All projects are up-to-date for restore.\n/w/Smoke/Warn.cs(2,98): warning CS8602: Dereference of a possibly null reference. [/w/Smoke/Smoke.csproj]\n  Smoke -> /w/Smoke/bin/Debug/net10.0/Smoke.dll\nTest run for /w/Smoke/bin/Debug/net10.0/Smoke.dll (.NETCoreApp,Version=v10.0)\nA total of 1 test files matched the specified pattern.\n[xUnit.net 00:00:00.13]     Smoke.UnitTest1.Test3 [FAIL]\n  Failed Smoke.UnitTest1.Test3 [6 ms]\n  Error Message:\n   Assert.Contains() Failure: Sub-string not found\nString:    \"abc\"\nNot found: \"x\"\n  Stack Trace:\n     at Smoke.UnitTest1.Test3() in /w/Smoke/UnitTest1.cs:line 20\n   at System.Reflection.MethodBaseInvoker.InterpretedInvoke_Method(Object obj, IntPtr* args)\n   at System.Reflection.MethodBaseInvoker.InvokeWithNoArgs(Object obj, BindingFlags invokeAttr)\n\nFailed!  - Failed:     1, Passed:     2, Skipped:     0, Total:     3, Duration: 29 ms - Smoke.dll (net10.0)\n"
const DOTNET_BUILD = "  Determining projects to restore...\n  All projects are up-to-date for restore.\n/w/Smoke/Bad.cs(2,44): error CS0029: Cannot implicitly convert type 'string' to 'int' [/w/Smoke/Smoke.csproj]\n/w/Smoke/Warn.cs(2,98): warning CS8602: Dereference of a possibly null reference. [/w/Smoke/Smoke.csproj]\n/w/Smoke/Warn.cs(2,43): warning CS0219: The variable 'unused' is assigned but its value is never used [/w/Smoke/Smoke.csproj]\n\nBuild FAILED.\n\n/w/Smoke/Warn.cs(2,98): warning CS8602: Dereference of a possibly null reference. [/w/Smoke/Smoke.csproj]\n/w/Smoke/Warn.cs(2,43): warning CS0219: The variable 'unused' is assigned but its value is never used [/w/Smoke/Smoke.csproj]\n/w/Smoke/Bad.cs(2,44): error CS0029: Cannot implicitly convert type 'string' to 'int' [/w/Smoke/Smoke.csproj]\n    2 Warning(s)\n    1 Error(s)\n\nTime Elapsed 00:00:00.72\n"

describe('dotnet', () => {
  test('dotnet build writes each diagnostic once, errors first, and one result line', () => {
    const r = run('dotnet build', DOTNET_BUILD, [], 1)
    expect(r.text).toBe("/w/Smoke/Bad.cs(2,44): error CS0029: Cannot implicitly convert type 'string' to 'int'\n/w/Smoke/Warn.cs(2,98): warning CS8602: Dereference of a possibly null reference.\n/w/Smoke/Warn.cs(2,43): warning CS0219: The variable 'unused' is assigned but its value is never used\nbuild failed: 1 error, 2 warnings")
    expect(saving(DOTNET_BUILD, r.text)).toBeGreaterThanOrEqual(60)
  })

  test('dotnet test keeps the failed test, its message and project frame, and the result', () => {
    expect(run('dotnet test', DOTNET_TEST, [], 1).text).toBe("/w/Smoke/Warn.cs(2,98): warning CS8602: Dereference of a possibly null reference.\n  Failed Smoke.UnitTest1.Test3 [6 ms]\n  Error Message:\n   Assert.Contains() Failure: Sub-string not found\nString: \"abc\"\nNot found: \"x\"\n  Stack Trace:\n     at Smoke.UnitTest1.Test3() in /w/Smoke/UnitTest1.cs:line 20\nFailed!  - Failed: 1, Passed: 2, Skipped: 0, Total: 3, Duration: 29 ms - Smoke.dll (net10.0)")
  })
})
