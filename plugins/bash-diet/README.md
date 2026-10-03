# bash-diet

Most of what a Bash command prints is noise to the model: progress bars, a hundred passing test lines, the same warning twice, colour codes. All of it lands in the context and gets paid for on every later request. This mod trims each Bash result before the model reads it. Known commands (git, test runners, linters, compilers, package managers, containers, file listings and searches) go through a filter of their own, and everything else gets a generic cleanup. Whenever a filter leaves something out, the full output waits in a file the model can open.

## What it does

1. It hooks the Bash tool, runs the command, and reads the output before the model does: `stdout` and `stderr` of a success, the error text of a failed exit. Subagent calls go through the same hook.
2. It reads the command the way a shell does. Variables and wrappers in front (`FOO=1`, `timeout 60`, `nice`, `env`, `sudo`) are peeled off. In a chain like `cd app && cargo test`, the one command that prints is the one filtered. A pipeline is filtered when its last stage is `grep` or `rg`, or when only `cat`, `head` or a non-following `tail` come after the command that produces the output.
3. A filter keeps what you would read the output for and drops the rest:
   - A passing test run shrinks to its count line. A failing one keeps each failure with its message and the stack frames of your own code.
   - A build keeps its diagnostics, each once, errors first, and the verdict.
   - A listing, a search or a table keeps its rows up to a cap and ends with a count of the rest.
   - Progress bars, download lines, spinners and colour codes go everywhere.
4. For two commands it adds a flag that makes the output smaller: `git log -10` when no count, range or format is given, and `pytest --tb=short -q`. It never switches a tool to a bigger format such as JSON, because a failed command's text reaches the hook cut at 10,000 characters and a JSON report passes that limit long before the plain text does. When the model asks for JSON itself (`go test -json`, `jest --json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json`, `ruff check --output-format=json`), the filter reads that report. The flag is added only when the permission check reads the new command the same way as the one the model wrote. It is never added when the arguments already pick a format, in a pipeline or a chain, after `sudo`, or with a redirect.
5. A filtered result that saves less than 5% of the output, or fewer than 40 characters, is thrown away and the model reads the output as it was; your own rules follow the same bar. A smaller saving would only change what the model reads and count a shrink nobody gains from. Two cases always keep the filtered result:
   - An `env` or `printenv` listing with a credential value masked. No full output file is kept for it, because that file would hold the masked values; `BASH_DIET_RAW=1 env` gives them back.
   - Output after an added flag, because the raw output is then in a format the model did not ask for.

   Claude Code writes an output over 30,000 characters to a file and hands the model only a 2KB preview and the file's path. The mod filters that whole file, but the filtered result wins only when it is shorter than the preview, and the saving is counted against the preview too.
6. When a filter left lines out, or a failed run printed 500 characters or more, the full output is kept and the result ends with its path:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   The file is the engine's own copy when the engine already cut the result, otherwise one under `$TMPDIR/bash-diet/`. That directory keeps at most 200 files, for 30 days. A failed command's text reaches the hook already cut by Claude Code at 10,000 characters, and its middle is written nowhere. In that case the file holds only what arrived, and the line says so:

       [output cut by Claude Code at 10000 characters; the middle is lost: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]
7. A failed command stays an error with its exit code: the model reads `Exit code 1` and the filtered text as a tool error.
8. At the session's start, after `/clear` and after a compaction, the model reads one note: a condensed result is complete, the full output sits at the named path, and `BASH_DIET_RAW=1 <command>` returns the exact bytes.
9. Playwright MCP repeats the code of every browser call in its result, under `### Ran Playwright code`: the code the model wrote for `browser_run_code_unsafe` and `browser_evaluate`, and the code of each click or navigation. The mod takes that section out of every Playwright browser tool's result, always, with no setting. The page, the snapshot link, the console events and any error stay. In 30 days of this machine's transcripts that section was more than half of all Playwright result text, about 950,000 of 1.8 million characters. Setting `PLAYWRIGHT_MCP_CODEGEN` from the mod does not help, because the MCP server starts before the session start runs (measured on 2.1.283).
10. With the [sidebar](../sidebar) open, the session's saving stands there under "Bash output". Without it, the status line shows it.

## Filters

These are all the commands the mod has a filter of its own for. A command marked `*` gets the flag of item 4.

| Family | Commands |
|---|---|
| git | `git status`, `git diff`, `git show`, `git log`\*, `git push`, `git fetch`, `git pull`, `git commit`, `git branch`, `git stash`, `git checkout`, `git switch`, `git restore`, `git add`, `git worktree`, `git tag` (a list keeps ten tags at each end and the count), `git remote -v`; `yadm status`, `yadm diff`, `yadm log`\* |
| GitHub, GitLab | `gh pr`, `gh issue`, `gh run`, `gh release`; `glab mr`, `glab issue` |
| Rust | `cargo build`, `cargo check`, `cargo clippy`, `cargo doc`, `cargo run`, `cargo test`, `cargo nextest`, `cargo install`; `cargo fmt` and `rustfmt` (a check reads as each file with the lines it would add and remove) |
| Go | `go test`, `go build`, `go vet`, `go get`, `go mod`, `go install`; `golangci-lint`, `golangci-lint run`; `gofmt -l` and `-d`, `go fmt` |
| Python | `pytest`\*; `ruff`, `ruff check`, `ruff format`; `mypy`; `flake8` and `pylint` (grouped by rule); `black`; `pip` and `pip3`: `list`, `install`, `uninstall`, `sync`, `download` and every other subcommand; `uv pip`, `uv sync`, `uv add`, `uv lock`; `poetry install`, `poetry add`, `poetry update` |
| JavaScript | `npm install`, `npm i`, `npm ci`, `npm ls`, `npm list`, `npm outdated`, `npm test`, `npm run`, `npm run-script`, `npm exec` and every other `npm` subcommand; `pnpm install`, `pnpm i`, `pnpm add`, `pnpm remove`, `pnpm rm`, `pnpm update`, `pnpm up`, `pnpm list`, `pnpm ls`, `pnpm outdated`, `pnpm why` and every other `pnpm` subcommand; `yarn install`, `yarn add`; `bun install`, `bun add`, `bun remove`, `bun test`; `deno test`, `deno lint`, `deno check`; `jest`, `vitest`, `mocha`, `cypress run`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`; `webpack`, `webpack-cli`, `vite`, `rollup`, `esbuild` (the emitted files as their count and the largest three) |
| JVM | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt` |
| Ruby | `rake test`, `rails test`, `ruby` (a minitest file), `rspec`, `rubocop`, `bundle install`, `bundle update` |
| PHP | `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`, `phpstan analyze` |
| .NET | `dotnet build`, `dotnet test`, `dotnet format`, `dotnet publish`, `dotnet pack`, `dotnet restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Files and system | `ls`, and `ls -R` as one line per directory; `cp`, `mv`, `rm`, `ln` with `-v` (every error, the first five paths and the count), also as `gcp`, `gmv`, `grm`, `gln`; `find`, `grep`, `egrep`, `rg`, `ast-grep`, `tree`, `env` and `printenv` (credential values masked), `ps` |
| Containers | `docker ps`, `docker images`, `docker image ls`, `docker logs`, `docker build`, `docker pull`, `docker inspect`, `docker compose` (`ps`, `logs` and the rest); `kubectl get`, `kubectl logs`, `kubectl describe`; `oc get`, `oc logs`; `helm list` |
| Clouds and network | `aws` (`aws s3 ls` as a capped list, the rest as JSON), `gcloud`; `terraform plan`, `terraform apply`, `tofu plan`, `tofu apply`; `pulumi`; `curl`, `wget` |
| make | `make`, `gmake`: make's directory lines and the compiler source excerpts go, and the line each runner writes for a passing test (`go test -v`, `cargo test`, `pytest -v`, `vitest --reporter=verbose`, `claude plugin test`) reads as one count; every failure, summary and other line stays |
| Built-in rules | `gcc`, `g++`, `cc`, `c++`, `clang`, `clang++` (also with a version suffix such as `gcc-14`); `cmake`, `cmake --build`; `brew install`, `upgrade`, `reinstall`, `update`, `tap`, `bundle`; `rsync`; `df`; `du`; `ping`, `ping6`; `shellcheck` |

- A command started through a runner counts as the command it starts: `npx`, `bunx`, `pnpx`, `pnpm exec` and `dlx`, `npm exec` and `x`, `uv run`, `poetry run`, `pipenv run`, `bundle exec`, `python -m`, `python3 -m`, `php artisan`. An absolute path (`/usr/bin/git`) counts as its base name, and `git -C <dir>` as `git`.
- Every other command gets the generic cleanup: colour codes, carriage-return redraws and repeated lines go.
- `cat`, `head` and `tail` of a file are never filtered, because the model asked for exactly those lines.

## Measured saving

Measured on Claude Code 2.1.282 with Claude Opus 5.5 and bash-diet 0.1.2. The sample repository holds Go, Rust, Node, Python, Gradle, .NET, Swift, Ruby, PHP and C projects, each with one failing test or build error. A headless session ran the same 35 commands in order: git, builds, tests, linters, package lists, file listings and searches, `docker ps` and `images`, `env`, `ps`, `df`, `du`. It ran three times with the mod and three times without it, and the figures are the medians of the three runs.

| | Without the mod | With the mod | Saving |
|---|---|---|---|
| Characters of the 35 Bash results | 79,555 | 33,366 | 58% |
| Context tokens the 35 results added | 38,277 | 20,653 | 46% |
| Context at the session's end | 107,946 | 90,557 | 16% |
| Input tokens over all requests | 2,856,172 | 2,512,370 | 12% |
| Session cost | $1.00 | $0.78 | 21% |

- A result's tokens are how much the context grew from the request that ran the command to the next one, minus that request's output tokens. That count includes about 100 tokens for the call itself, which no filter can shrink.
- The session's own prompt, tools and instructions are the same in both runs, so the saving over the whole session is smaller than the saving on the results.

The context tokens of the 35 results, by family. Each figure is the sum of the family's per-command medians.

| Family | Commands run | Without the mod | With the mod | Saving |
|---|---|---|---|---|
| git | `git status`, `git diff`, `git log`, `git branch -a`, `git show --stat` | 1,598 | 890 | 44% |
| Go | `go build`, `go vet`, `go test` | 308 | 226 | 27% |
| Rust | `cargo build`, `cargo clippy`, `cargo test` | 1,682 | 923 | 45% |
| Node | `npm install`, `npx tsc`, `npx vitest run`, `npm ls` | 1,191 | 1,012 | 15% |
| Python | `pytest`, `python3 -m pip list` | 1,635 | 1,287 | 21% |
| Gradle | `gradle build`, `gradle test` | 757 | 540 | 29% |
| .NET | `dotnet build`, `dotnet test` | 1,221 | 697 | 43% |
| Swift | `swift build`, `swift test` | 1,443 | 915 | 37% |
| Ruby | `rake test` | 1,092 | 206 | 81% |
| PHP | `php -l` | 112 | 103 | 8% |
| C | `make` | 281 | 273 | 3% |
| Files | `ls -la`, `find -name`, `grep -rn` | 6,974 | 2,384 | 66% |
| Containers | `docker ps -a`, `docker images` | 10,423 | 2,270 | 78% |
| System | `env`, `ps aux`, `df -h`, `du -sh` | 9,560 | 8,927 | 7% |
| Total | 35 commands | 38,277 | 20,653 | 46% |

- The smallest savings are on `env` (the filter only masks credential values), `php -l`, `make` and `go vet`: their output is already a few lines, and most of their count is the call's own 100 tokens.

The filters added after that session were measured with one run each in a scratch project, in characters of the result:

| Command | Without the mod | With the mod | Saving |
|---|---|---|---|
| `flake8` | 2,091 | 775 | 63% |
| `pylint` | 2,898 | 1,049 | 64% |
| `gofmt -d` | 328 | 56 | 83% |
| `black --check --diff` | 1,104 | 286 | 74% |
| `webpack` | 779 | 117 | 85% |
| `vite build` (a parse error) | 1,562 | 291 | 81% |
| `esbuild` (a parse error) | 1,044 | 109 | 90% |
| `rollup` (a parse error) | 1,554 | 178 | 89% |
| `mocha` | 897 | 455 | 49% |
| `cypress run` | 5,517 | 327 | 94% |
| `make check` of this mod (lint, typecheck, validate, 129 tests) | 15,131 | 1,684 | 89% |
| `make test` running `go test -v` | 563 | 307 | 45% |
| `make test` running `pytest -v` | 1,382 | 928 | 33% |

## Your own rules

A command no filter knows can get a rule of yours. Rules live in two files:

- `~/.claude/bash-diet/filters.json`, for every project. It runs as it is.
- `<repository>/.bash-diet/filters.json`, for one project. It runs only after `/bash-diet trust`, and it stops again when its content changes, because a file that came with a cloned repository could hide output from the model.

Your rule comes before the mod's own filter for the same command. The steps run in this order, and each one is optional:

```json
{
  "filters": {
    "deploy": {
      "description": "the deploy script: only the steps and the result",
      "match_command": "^\\./scripts/deploy\\.sh( |$)",
      "strip_ansi": true,
      "replace": [{ "pattern": "\\d+ms", "replacement": "Nms" }],
      "match_output": [{ "pattern": "nothing to deploy", "message": "deploy: nothing to do", "unless": "(?i)error" }],
      "keep_lines_matching": ["^(step|error|done)"],
      "truncate_lines_at": 200,
      "head_lines": 20,
      "tail_lines": 10,
      "max_lines": 40,
      "on_empty": "deploy: done"
    }
  }
}
```

- `match_command` is a JavaScript regex over the command's words, after variables and wrappers. A leading `(?i)` ignores case.
- `strip_lines_matching` drops the lines it matches, `keep_lines_matching` keeps only those. A rule takes one of the two.
- `match_output` answers with `message` alone when the whole output matches `pattern` and does not match `unless`.
- `head_lines` and `tail_lines` keep both ends with a count between them. `max_lines` then caps the lines.

A file with a mistake still keeps its good rules, and one transcript line names every mistake. `/bash-diet filters` lists both files, their rules and the built-in rules.

## Command

    /bash-diet                               on or off, the excludes, and this session's saving
    /bash-diet on | off                      on by default
    /bash-diet exclude <prefix | ^regex>     that command runs unfiltered; excludes lists them, include takes one back
    /bash-diet filters                       the rule files, their rules, the built-in rules
    /bash-diet trust | untrust               lets this repository's .bash-diet/filters.json run, or stops it
    /bash-diet gain                          the saving of the last 90 days, the families that saved most
    /bash-diet gain project | daily | graph | history
    /bash-diet cost                          this session's spend, and what the tokens kept out would have cost
    /bash-diet discover [days] [all]         the output the model read in earlier sessions, by filter, and the commands no filter reads
    /bash-diet learn [days] [write]          commands that failed on a CLI mistake and the form that worked after them

- `gain` reads the records in `~/.claude/bash-diet/gain/`, one file per session and day, kept for 90 days. Each report gives the measured characters before and after. The token figure is an estimate at four characters per token; `history` and `graph` give characters only.
- `cost` prices the tokens kept out of the context at the model's list prices of September 2026: once at the cache write rate, and again at the cache read rate for each later request.
- `discover` and `learn` read this project's transcripts of the last 30 days by default. `discover all` reads every project's; it answers at once, and its report follows as a transcript line.
- `learn` counts only a single command that failed on an unknown flag, a missing command, a missing argument or a syntax error, followed within three calls by a similar command that worked. `learn write` writes the pairs to `.claude/rules/cli-corrections.md` in the repository, which the model reads in later sessions. A command that may carry a credential is never written.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bash-diet@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.
2. If you use another tool that rewrites Bash commands for the same purpose, turn it off, so each output is filtered once.
3. To keep a project's own rules, write `.bash-diet/filters.json` and run `/bash-diet trust` in that project.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=bash-diet}, tool.call{tool=Bash}, tool.call{tool=?}
    ❯ ./register.ts calls: $.clock.now (via gainCommand, pruneGain, pruneRecall, recordGain, transcriptsOf), $.command.register, $.env.get (via locate, recallDir), $.fs.exists (via gainFiles, refreshFile, transcriptDirs), $.fs.list (via gainFiles, pruneRecall, transcriptDirs, transcriptsOf), $.fs.read (via gainCommand, refreshFile, seedGain, wholeText), $.fs.stat (via pruneRecall, refreshFile, transcriptsOf), $.fs.write (via keepFull, recordGain, writeLearned), $.process.run (via locate, pruneGain, pruneRecall, recallDir, recordGain, writeLearned), $.process.spawn (via callsIn), $.session.id, $.session.model (via costCommand), $.session.root (via locate), $.session.usage (via costCommand), $.sidebar.set (via showGain), $.store.get (via readSettings), $.store.set (via setEnabled, setExcludes, setTrusted), $.tool.check (via withPlanFlags), $.ui.log (via activeRules, discoverAll, refreshFile, report), $.ui.status (via showGain)

Reach L2: it writes files and runs processes.

    1. Reads:    each Bash command and its output; the result of each Playwright MCP browser tool; the two filters.json files; this session's model, spend and id; the transcripts under ~/.claude/projects for discover and learn
    2. Runs:     the model's own Bash command, with a flag that shortens its output added when the permission check allows it; git rev-parse, mkdir, rm (of its own files only) and cat (of transcripts)
    3. Sends:    the filtered result to the model in place of the output, and each Playwright result without its code echo; nothing leaves the machine
    4. Persists: full outputs in $TMPDIR/bash-diet (200 files, 30 days); saving records in ~/.claude/bash-diet/gain (90 days); .claude/rules/cli-corrections.md on learn write; in $.store, on/off, the excludes and the trusted rule file hashes
    5. Hostile input: a command's output only passes through regexes and JSON.parse, and is never run; a project rule file runs only after /bash-diet trust and only while its SHA-256 matches; env values of credential-like names are masked

## Limits

- A filter reads the output's known shape. A tool that changes its output format can make a filter keep less than it should; the full output file and `BASH_DIET_RAW=1` are your way back.
- The middle of a failed command's output over 10,000 characters is dropped by Claude Code before the mod ever sees it. The mod cannot bring it back; it only tells you it was cut.
- A backgrounded command (`run_in_background`) is not filtered, because its result is a task id.
- A command inside `$(...)`, a heredoc or a process substitution, or one whose output is redirected to a file, is not filtered.
- A chain of several printing commands gets only the generic cleanup (colour codes, carriage-return redraws, repeated lines).
- `output-flood` 0.3.0 and later measure the filtered result, whichever order the two mods load in. An older `output-flood` loaded after bash-diet measures the output before the filter, and its note names a size the model never read.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
