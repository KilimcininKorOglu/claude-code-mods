# bash-diet

A Claude Code Mod that shrinks each Bash result before the model reads it. Known commands (git, test runners, linters, compilers, package managers, containers, file listings and searches) go through a filter of their own; every other command gets a generic cleanup. When a filter leaves something out, the full output stays in a file the model can open.

## What it does

1. The mod hooks the Bash tool, runs the command, and reads its output before the model does: `stdout` and `stderr` of a success, and the error text of a failed exit. Subagent calls go through the same hook.
2. It reads the command the way a shell does. Variables and wrappers in front (`FOO=1`, `timeout 60`, `nice`, `env`, `sudo`) are peeled off. In a chain such as `cd app && cargo test`, the one command that prints is the one filtered. A pipeline is filtered when its last stage is `grep` or `rg`, or when only `cat`, `head` or a non-following `tail` come after the producer.
3. A filter keeps what a person reads the output for, and drops the rest:
   - A passing test run is its count line. A failing one keeps each failure with its message and the frames of your own code.
   - A build keeps its diagnostics, each once, errors first, and the verdict.
   - A listing, a search or a table keeps its rows up to a cap, and ends with a count of the rest.
   - Progress bars, download lines, spinners and colour codes go everywhere.
4. Some filters read a structured format better than the text one. For those, the mod adds a flag to the command: `go test -json`, `git log -10` when neither a count, a range nor a format is given, `pytest --tb=short -q`, `ruff check --output-format=json`, `jest --json`, `vitest --reporter=json`, `eslint -f json`, `rspec --format json`, `rubocop --format json`, `phpstan analyse --error-format=json --no-progress`. The flag is added only when the permission check reads the new command the same way as the one the model wrote, and never when the arguments already choose a format, in a pipeline, a chain, after `sudo` or with a redirect.
5. A filtered result that is not shorter than the output is dropped, and the model reads the output as it was. After an added flag the filtered result always stands, because the raw output is then a format the model did not ask for.
6. When a filter left lines out, or a failed run printed 500 characters or more, the full output is kept and the result ends with its path:

       [full output: /var/folders/.../bash-diet/3fa9c1b2d4e5.log]

   The file is the engine's own copy when the engine already cut the result, else one under `$TMPDIR/bash-diet/`. That directory keeps at most 200 files for 30 days.
7. A failed command stays an error with its exit code: the model reads `Exit code 1` and the filtered text as a tool error.
8. At the session's start, after `/clear` and after a compaction, the model reads one note: a condensed result is complete, the full output is at the named path, and `BASH_DIET_RAW=1 <command>` returns the exact bytes.
9. While the [sidebar](../sidebar) is open, the session's saving stands there under "Bash output". Without it, the status line carries it.

## Filters

| Family | Commands |
|---|---|
| git | `git status`, `diff`, `show`, `log`, `push`, `fetch`, `pull`, `commit`, `branch`, `stash`, `checkout`, `switch`, `restore`, `add`, `worktree`; `yadm`; `gh pr`, `issue`, `run`, `release`; `glab mr`, `issue` |
| Rust, Go, Python | `cargo build`, `check`, `clippy`, `doc`, `test`, `nextest`, `install`, `run`; `go test`, `build`, `vet`, `get`, `mod`, `install`; `golangci-lint`; `pytest`, `ruff`, `mypy`, `pip`, `uv`, `poetry` |
| JavaScript | `npm`, `pnpm`, `yarn`, `bun` installs and tests, `jest`, `vitest`, `playwright`, `tsc`, `eslint`, `prettier`, `next build`, `prisma`, `deno` |
| JVM, Ruby, PHP, .NET | `mvn`, `mvnd`, `gradle`, `gradlew`, `sbt`; `rake test`, `rails test`, `rspec`, `rubocop`, `bundle install`; `php -l`, `phpunit`, `pest`, `paratest`, `artisan test`, `phpstan analyse`; `dotnet build`, `test`, `format`, `publish`, `pack`, `restore` |
| Apple | `swift build`, `swift test`, `xcodebuild` |
| Files and system | `ls`, `find`, `grep`, `rg`, `tree`, `env` (credential values masked), `ps` |
| Containers and clouds | `docker ps`, `images`, `logs`, `build`, `pull`, `inspect`, `compose`; `kubectl` and `oc` get and logs; `helm list`; `aws`, `gcloud`; `terraform` and `tofu` plan and apply; `pulumi`; `curl`, `wget` |
| Built-in rules | `gcc`, `clang` and `cc`, `make`, `cmake`, `brew`, `rsync`, `df`, `du`, `ping`, `shellcheck` |

`cat`, `head` and `tail` of a file are never filtered: the model asked for those exact lines.

## Your own rules

A command no filter knows can get a rule. Rules live in two files:

- `~/.claude/bash-diet/filters.json`, for every project. It runs as it is.
- `<repository>/.bash-diet/filters.json`, for one project. It runs only after `/bash-diet trust`, and it stops again when its content changes, because a file that came with a cloned repository could hide output from the model.

A rule of yours comes before the mod's own filter for the same command. The steps run in this order, each one optional:

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
- `strip_lines_matching` drops the lines it matches. `keep_lines_matching` keeps only those. A rule takes one of the two.
- `match_output` answers with `message` alone when the whole output matches `pattern` and does not match `unless`.
- `head_lines` and `tail_lines` keep both ends with a count between. `max_lines` then caps the lines.

A file with a mistake keeps its good rules, and one transcript line names every mistake. `/bash-diet filters` lists both files, their rules and the built-in rules.

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

- `gain` reads the records in `~/.claude/bash-diet/gain/`, one file per session and day, kept for 90 days. A token is estimated as four characters.
- `cost` prices the tokens kept out of the context at the model's list prices of September 2026: once at the cache write rate, and again at the cache read rate for each later request.
- `discover` and `learn` read this project's transcripts of the last 30 days by default. `discover all` reads every project's; it answers at once, and its report follows as a transcript line.
- `learn` counts only a single command that failed on an unknown flag, a missing command, a missing argument or a syntax error, followed within three calls by a similar command that worked. `learn write` writes the pairs to `.claude/rules/cli-corrections.md` in the repository, which the model reads in later sessions. A command that may carry a credential is never written.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install bash-diet@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. When you use another tool that rewrites Bash commands for the same purpose, turn it off, so each output is filtered once.
3. To keep a project's own rules, write `.bash-diet/filters.json` and run `/bash-diet trust` in that project.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.282:

    ❯ ./register.ts hooks: session.start, classic.SessionStart, command.run{command=bash-diet}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.clock.now (via gainCommand, pruneGain, pruneRecall, recordGain, transcriptsOf), $.command.register, $.env.get (via locate, recallDir), $.fs.exists (via gainFiles, refreshFile, transcriptDirs), $.fs.list (via gainFiles, pruneRecall, transcriptDirs, transcriptsOf), $.fs.read (via gainCommand, refreshFile, wholeText), $.fs.stat (via pruneRecall, refreshFile, transcriptsOf), $.fs.write (via keepFull, recordGain, writeLearned), $.process.run (via locate, pruneGain, pruneRecall, recallDir, recordGain, writeLearned), $.process.spawn (via callsIn), $.session.id, $.session.model (via costCommand), $.session.root (via locate), $.session.usage (via costCommand), $.sidebar.set (via showGain), $.store.get, $.store.set (via setEnabled, setExcludes, setTrusted), $.tool.check (via withPlanFlags), $.ui.log (via activeRules, discoverAll, refreshFile, report), $.ui.status (via showGain)

Reach L2, writes files and runs processes.

    1. Reads:    each Bash command and its output; the two filters.json files; this session's model, spend and id; the transcripts under ~/.claude/projects for discover and learn
    2. Runs:     the model's own Bash command, with a format flag added when the permission check allows it; git rev-parse, mkdir, rm (of its own files only) and cat (of transcripts)
    3. Sends:    the filtered result to the model in place of the output; nothing leaves the machine
    4. Persists: full outputs in $TMPDIR/bash-diet (200 files, 30 days); saving records in ~/.claude/bash-diet/gain (90 days); .claude/rules/cli-corrections.md on learn write; in $.store, on/off, the excludes and the trusted rule file hashes
    5. Hostile input: a command's output only passes through regexes and JSON.parse, and is never run; a project rule file runs only after /bash-diet trust and only while its SHA-256 matches; env values of credential-like names are masked

## Limits

- A filter reads the output's known shape. A tool that changes its output format can make a filter keep less than it should; the full output file and `BASH_DIET_RAW=1` are the ways back.
- A backgrounded command (`run_in_background`) is not filtered: its result is a task id.
- A command inside `$(...)`, a heredoc, a process substitution, or with its output redirected to a file is not filtered.
- A chain of several printing commands gets only the generic cleanup (colour codes, carriage-return redraws, repeated lines).
- `output-flood` measures the result it sees. Whether that is the filtered one depends on the order the engine runs the two mods' hooks in.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
