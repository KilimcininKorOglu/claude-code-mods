# lockfile-sync

A Claude Code Mod that tells the model when a commit changes the dependencies of a manifest but not its lockfile. After each `git commit` the model runs, the mod adds the manifests whose lockfile the commit left out to the commit's result. The commit is never stopped.

## What it does

1. The mod hooks the Bash tool. A command that runs `git commit` (also `git -C <dir> commit`, not `--dry-run` or `--help`) is checked.
2. Before the command runs, it finds the repository root from the session's directory, the last `cd` before the commit and the commit's `git -C`, and records `HEAD`.
3. After a successful command that moved `HEAD`, it lists the commit's added and modified files with `git show --name-status HEAD`, and pairs each manifest with its lockfile:

   | Manifest | Lockfile |
   |---|---|
   | `package.json` | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb` |
   | `composer.json` | `composer.lock` |
   | `Cargo.toml` | `Cargo.lock` |
   | `go.mod` | `go.sum` |
   | `pyproject.toml` | `poetry.lock`, `uv.lock`, `pdm.lock` |
   | `Pipfile` | `Pipfile.lock` |
   | `Gemfile` | `Gemfile.lock` |
   | `pubspec.yaml` | `pubspec.lock` |
   | `mix.exs` | `mix.lock` |

   The lockfile is the first one on disk from the manifest's directory up to the repository root, so a workspace package pairs with the root lockfile. A manifest without a lockfile on disk is left alone: the project does not keep one.
4. When the commit leaves that lockfile out, the mod reads the manifest's diff (`git show --unified=20 HEAD -- <manifest>`) and checks where the changed lines sit. Only a change that can change the lockfile counts:

   | Manifest | Counts | Does not count |
   |---|---|---|
   | `package.json`, `composer.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `require`, `require-dev` and the like | `scripts`, `version`, other keys |
   | `Cargo.toml`, `pyproject.toml`, `Pipfile` | `[dependencies]`, `[dev-dependencies]`, `[target.*.dependencies]`, `[project]`, `[tool.poetry.dependencies]`, `[packages]` and the like | `[package]`, `[tool.ruff]`, other tables |
   | `go.mod` | `require`, `replace`, `exclude` lines and blocks | `go 1.22`, `module` |
   | `Gemfile` | `gem`, `source`, `gemspec`, `group` lines | comments |
   | `pubspec.yaml` | `dependencies`, `dev_dependencies`, `dependency_overrides` | other keys |
   | `mix.exs` | every change | |

   A key or table outside the 20 lines of context counts, so an unknown section still gets the note.
5. The model reads this note after the commit's result:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.

6. The same moment writes one line to the transcript, so you see what the model was told. The line holds the pairs alone, without the instruction:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those pairs go there instead, one line per pair, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

7. A finding stays open until the lockfile catches up. When a later commit changes every lockfile the finding named, its sidebar entry is cleared and a new entry takes its place:

       lockfile-sync: a later commit brought the lockfiles along: package-lock.json

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: it committed the lockfile itself, so a note would only repeat what it just did.

A git error is logged once, and the commit's result stays as it was.

In the live check the model raised a `package.json` dependency, committed only that file, and quoted the note word for word.

## Command

    /lockfile-sync            on or off
    /lockfile-sync on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install lockfile-sync@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=lockfile-sync}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.fs.exists (via lockOnDisk), $.process.run (via git), $.session.cwd (via beforeCommit), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via report, toPerson)

Reach L2, runs processes.

    1. Reads:    the Bash command text; whether lockfiles exist in the repository; through git, the commit's file list and manifest diffs
    2. Runs:     git rev-parse and git show, read-only, by argv, four times per commit plus one per manifest without its lockfile
    3. Sends:    a note to the model after the commit's result, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the directory comes from the command text and reaches git only as the working directory, never through a shell; manifest paths reach git as one argv entry after --

## Limits

- The mod compares file names and diff sections. It does not check that the lockfile's content matches the manifest.
- Two lockfiles of one manager in one directory (a `yarn.lock` beside a `package-lock.json`) pair with the first in the table.
- A commit through a script or an alias that hides `git commit` is not seen. `cd ~/x` is not expanded.
- A merge commit's combined diff is not read.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
