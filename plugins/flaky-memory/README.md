# flaky-memory

A test fails, the model assumes its last change broke it and starts "fixing" code that was fine. Sometimes the test is simply flaky: on the very same code it passed an hour ago. This mod remembers which tests failed on which code. When a test fails that both passed and failed on the same code in the last 7 days, it adds a note to that Bash result, so the model runs the test again instead of changing code for a flaky test.

## What it does

Before a Bash command that runs tests, the mod takes a fingerprint of the working tree: `git rev-parse HEAD`, `git diff HEAD` and the names of the untracked files, hashed with 64-bit FNV-1a. After the command, it reads which tests the output names as passed or failed and stores one run per test with that fingerprint.

A test is flaky when one fingerprint holds both a pass and a failure of it. A failure after a code change is not flaky, because the fingerprint is different.

After the Bash result of a failed run, the model reads this note:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once. It may be flaky rather than broken by this change: run it again before you change code for it.

At the same moment you get one line, so you see what the model was told. It holds the finding alone, without the instruction:

    flaky-memory: go:TestFlip failed 2 of 3 runs in the last 7 days and both passed and failed on the same code once

With the [sidebar](../sidebar) open, that line goes into its stream instead, with `failed 2 of 3` in red and the explanation faint, and the transcript stays clean. When the window no longer holds a pass and a failure of that test on one tree, the entry goes away and a new one says so, with `is no longer flaky` in green:

    flaky-memory: no longer flaky
    go:TestFlip is no longer flaky: nothing in the last 7 days has it passing and failing on the same code

`/flaky-memory reset` takes the entry down without a closing line, because you asked for it. Without the sidebar, the line lands in the transcript as above.

### Test commands

A Bash command counts as a test command when it contains one of these: `go test`, `pytest`, `python -m pytest` (also `python3`), `jest`, `vitest`, `bun test`, `cargo test`, `cargo nextest`, `phpunit` (also `vendor/bin/phpunit`), `npm test`, `pnpm test`, `yarn test` (also with `run`), `bun run test`, `deno test`, `rspec`, `make test`, `mvn test`, `gradle test` (also `./gradlew test`), `dotnet test`. Other commands pass through untouched, and no git command runs for them.

### What the output must show

| Runner | Failed | Passed |
|---|---|---|
| go test | `--- FAIL: TestX` | `--- PASS: TestX` (with `-v`) |
| pytest | `FAILED path::test`, `ERROR path::test` | `path::test PASSED` (`-v`), `PASSED path::test` (`-rA`) |
| jest, vitest, bun | `✕`, `×`, `✗`, `(fail)` lines | `✓`, `√`, `(pass)` lines |
| cargo test | `test x ... FAILED` | `test x ... ok` |
| PHPUnit | `1) Class::method` | none |
| deno test | `name ... FAILED` | `name ... ok` |
| dotnet test | `Failed Name [12 ms]` | `Passed Name [1 ms]` |
| rspec | the `rspec path:line # name` rerun list | none |
| Maven surefire | `name(Class)  Time elapsed … <<< FAILURE!` | none |
| Gradle | `Class > test FAILED` | none |

A run that names no passing test still counts as a pass for the tests the same command failed in its last failing run, as long as it exits 0. That way `go test ./...` without `-v`, PHPUnit, rspec, Maven and Gradle work too: their failures are read, and their next run that exits 0 counts those tests as passed.

Only tests that failed within the window are stored, so a suite of thousands of passing tests stores nothing. Each test keeps at most 50 runs from the last 7 days.

## Command

    /flaky-memory                   the flaky tests of this repository, the most failing first
    /flaky-memory reset             forget the runs of this repository
    /flaky-memory reset <test id>   forget the runs of one test, for example go:TestFlip
    /flaky-memory on | off          record test runs or not (on by default); off keeps the stored runs

The repository is its git common directory, so the worktrees of one repository share their runs.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install flaky-memory@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code. The mod needs no key and no setting.
2. It starts recording at the first test run inside a git repository.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=flaky-memory}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via learn, runCommand), $.command.register, $.process.run (via git), $.session.cwd, $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.delete (via forget), $.store.get (via isEnabled, loadHistory), $.store.set (via forget, learn, runCommand), $.ui.log

Reach L2: it runs git.

    1. Reads:    the output of each Bash test command; the working tree through git
    2. Runs:     git rev-parse, git diff HEAD and git ls-files --others, read-only, by argv, before each test command
    3. Sends:    a note to the model after a failed run of a flaky test, and one line to you; nothing leaves the machine
    4. Persists: per repository, in $.store: each failed test's runs of the last 7 days (time, fingerprint, passed) and the tests each command failed last
    5. Hostile input: test output is untrusted text; it is matched against fixed line patterns, and a test name is only stored and echoed back, never run

## Limits

- Outside a git repository nothing is recorded.
- A diff over 4 MiB gets no fingerprint, and that run is not recorded.
- Only the names of untracked files go into the fingerprint, not their content. A change inside an untracked file does not change the fingerprint.
- State outside the tree (a database, a cache, a file under `/tmp`) is not in the fingerprint. A test that depends on it can look flaky.
- An interrupted run and a run sent to the background are not recorded, because their output is partial.
- The runner prefixes of the ids (`go:`, `pytest:`, `js:`, `cargo:`, `phpunit:`, `deno:`, `dotnet:`, `rspec:`, `maven:`, `gradle:`) keep two runners' test names apart. The go id carries no package name, so two packages with the same test name share one id.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
