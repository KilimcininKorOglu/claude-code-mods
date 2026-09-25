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
4. When the commit leaves that lockfile out, the mod first asks the lockfile's own package manager whether the lockfile still fits the manifest. It runs the check by argv in the lockfile's directory, with a 60 s limit:

   | Lockfile | Check | Behind when |
   |---|---|---|
   | `Cargo.lock` | `cargo metadata --locked --format-version 1 --manifest-path <manifest>` | `cannot update the lock file` |
   | `package-lock.json` | `npm ci --dry-run --ignore-scripts` | `are in sync` in the failure |
   | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile --lockfile-only --ignore-pnpmfile --ignore-scripts` | `don't match specifiers` |
   | `bun.lock`, `bun.lockb` | `bun install --frozen-lockfile --dry-run --ignore-scripts` | `lockfile had changes` |
   | `yarn.lock` (v1) | `yarn check` | `Lockfile does not contain pattern` |
   | `composer.lock` | `composer validate --no-check-all --no-check-publish --check-lock --no-plugins` | `lock file is not up to date` |
   | `go.sum` | `go mod tidy -diff` | the diff holds a `go.sum` hunk |
   | `uv.lock` | `uv lock --check` | `needs to be updated` |
   | `poetry.lock` | `poetry check --lock` | `changed significantly` |
   | `pdm.lock` | `pdm lock --check` | `satisfy the project requirements` |
   | `Pipfile.lock` | `pipenv verify` | `out-of-date` |
   | `Gemfile.lock` | `bundle lock --print` | the printed lockfile differs, platforms and the Bundler version aside |
   | `pubspec.lock` | `dart pub get --enforce-lockfile --dry-run` | `Unable to satisfy` |
   | `mix.lock` | `mix deps.get --check-locked`, with `MIX_DEPS_PATH` in `$TMPDIR/lockfile-sync` | `mix.lock is out of date` |

   Each check was measured to write nothing into the repository. A pass means the lockfile fits and no finding opens: a `features` change in `Cargo.toml` that pulls in no new crate opens nothing, and a `features = ["derive"]` that pulls in `serde_derive` does. A failure that says the lockfile is behind opens the finding. Any other answer proves nothing: the tool is not installed, it ran past the limit, it failed for another reason, the lockfile is a Yarn 2+ `yarn.lock`, or the manifest or the lockfile differs from `HEAD` in the working tree. The check reads the working tree and the finding speaks of the commit, so a lockfile written but left out of the commit would read as in step. A tool that did not start is logged once:

       lockfile-sync: cargo did not run: <reason>; the manifest's diff decides

   Then the mod reads the manifest's diff (`git show --unified=20 HEAD -- <manifest>`) and checks where the changed lines sit. Only a change that can change the lockfile counts:

   | Manifest | Counts | Does not count |
   |---|---|---|
   | `package.json`, `composer.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions`, `require`, `require-dev` and the like | `scripts`, `version`, other keys |
   | `Cargo.toml`, `pyproject.toml`, `Pipfile` | `[dependencies]`, `[dev-dependencies]`, `[target.*.dependencies]`, `[project]`, `[tool.poetry.dependencies]`, `[packages]` and the like | `[package]`, `[tool.ruff]`, other tables |
   | `go.mod` | `require`, `replace`, `exclude` lines and blocks | `go 1.22`, `module` |
   | `Gemfile` | `gem`, `source`, `gemspec`, `group` lines | comments |
   | `pubspec.yaml` | `dependencies`, `dev_dependencies`, `dependency_overrides` | other keys |
   | `mix.exs` | every change | |

   The section of a changed line is read from the whole manifest (`git show HEAD:<manifest>`), not from the diff's own 20 lines of context: a change 40 lines into a `package.json` never reaches the root `{` inside the hunk, and every root-level key would read as a dependency. A key or table the manifest itself does not place counts, so a file that cannot be read still gets the note.
5. The model reads this note after the commit's result:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum. Run the package manager's install so the lockfile matches, and commit it.

6. The same moment writes one line to the transcript, so you see what the model was told. The line holds the pairs alone, without the instruction:

       lockfile-sync: this commit changes package.json but not package-lock.json · go.mod but not go.sum

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those pairs go there instead, one line per pair, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

7. Each commit that leaves a lockfile out opens its own finding, with its own sidebar entry keyed by its manifests. A later commit adds its finding beside the open ones and never writes over one; a pair an open finding already names is not opened twice. Every finding closes on its own measure.

   A finding is never a remembered answer. Each measure, after every later commit and before a guarded git command, asks git and the package manager again, so it closes three ways:

   - the lockfile was written: a later commit changed it, or `git status --porcelain` shows it changed in the working tree;
   - the package manager reads the lockfile as in step with the manifest (the check of step 4);
   - the check proves nothing and the manifest asks for no lockfile change any more: `git log -1 -- <lockfile>` names the commit that last wrote the lockfile, and the manifest's diff against that commit touches no dependency. A change that was reverted reads this way. A lockfile the package manager reads as behind stays open whatever the diff says.

   The entry is cleared and a new one says which of the three it was:

       lockfile-sync: a later change brought the lockfiles along: package-lock.json
       lockfile-sync: cargo reads Cargo.lock as in step with Cargo.toml
       lockfile-sync: the dependencies match the lockfile again: package.json

   With the sidebar closed the same text is one transcript line. The model reads nothing of this: the finding closed by its own work, so a note would only repeat what it just did.

8. A finding the model did not close is measured again at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt:

       lockfile-sync: 1 lockfile(s) are still behind their manifest: package-lock.json behind package.json. Run the package manager's install so the lockfile is written, or take the dependency change back.

   One note per turn, not one per prompt. Without this the finding would be said once, at the commit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.

9. In `deny` mode the mod also stops `git commit`, `git push` and `git merge` while a lockfile is behind. Before it stops one it runs both measures, so a lockfile the package manager just wrote, and a dependency change that was taken back, each open the gate themselves. A `git commit` answers for its own files alone: the mod reads the index (`git diff --cached --name-only`) and lets the commit run when it holds none of the open manifests, with one line to you naming how many still stand. A `push` and a `merge` hold no index to read, so every pair stands there. There is no bypass; only the person turns the gate off with `/lockfile-sync mode note`. `note` mode is the default and stops nothing.

A git error is logged once, and the commit's result stays as it was.

In the live check the model raised a `package.json` dependency, committed only that file, and quoted the note word for word.

## Command

    /lockfile-sync                 on or off, the mode, and the lockfiles still behind
    /lockfile-sync on | off        on by default
    /lockfile-sync mode note       note only; the default
    /lockfile-sync mode deny       a commit, a push and a merge also stop while a lockfile is behind

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install lockfile-sync@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.282:

    ❯ ./register.ts hooks: session.start, command.run{command=lockfile-sync}, turn.complete, prompt.submit, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.env.get (via tmpDir), $.fs.exists (via lockOnDisk), $.fs.read (via treeText), $.process.run (via git, lockVerdict), $.session.cwd (via beforeCommit), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via denyFor, toPerson, toolFailed)

Reach L3, runs processes that reach the network.

    1. Reads:    the Bash command text; whether lockfiles exist in the repository; each open finding's manifest and lockfile in the working tree; through git, the commit's file list, manifest diffs and each manifest at HEAD; TMPDIR
    2. Runs:     git rev-parse, git show, git status, git log and git diff, read-only, by argv; and the lockfile's package manager check of step 4, once per manifest without its lockfile at a commit and once per open pair at each measure, also at the turn's end
    3. Sends:    a note to the model after the commit's result, one more with the next prompt while a finding stands, and one line to the transcript; the package manager may ask its registry for the package metadata it resolves against
    4. Persists: in $.store, the on/off setting and the mode; the package managers keep their own caches, and mix fetches into $TMPDIR/lockfile-sync/mix-deps
    5. Hostile input: the directory comes from the command text and reaches git and the package manager only as the working directory, never through a shell; manifest paths reach them as one argv entry. The check runs code the project holds: a Gemfile is Ruby and a mix.exs is Elixir, and both are evaluated. npm, pnpm and bun run with --ignore-scripts, pnpm with --ignore-pnpmfile, and composer with --no-plugins, so their project scripts and plugins do not run

## Limits

- Where the package manager check proves nothing, the mod compares file names and diff sections alone, and does not check that the lockfile's content matches the manifest.
- The verdict is the package manager's own: `npm ci` does not compare the root package's `version`, and `yarn check` reads a lockfile that still lists a removed dependency as in step.
- A Yarn 2+ `yarn.lock` has no check here: `yarn install --immutable` links `node_modules` into the project, and `--mode=update-lockfile` does not combine with `--immutable`.
- While a finding stands, its check runs again at every main-loop turn's end, up to 60 s per pair.
- A lockfile no commit ever wrote has nothing to compare the manifest against, so only the first measure can close its finding.
- Two lockfiles of one manager in one directory (a `yarn.lock` beside a `package-lock.json`) pair with the first in the table.
- A commit through a script or an alias that hides `git commit` is not seen. `cd ~/x` is not expanded.
- A merge commit's combined diff is not read.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/lockfile-sync mode note`.
- The gate reads any change to the lockfile in the working tree as the fix; it does not check what that change holds.
- A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed to the index, because they commit files the index does not hold yet. Every open pair stands for those.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
