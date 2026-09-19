# disk-janitor

A Claude Code Mod that measures the build artifacts of the session's repository, shows them on the status line once they pass 5 GB, and deletes the ones you pick in the `/janitor` pane. A data directory is never listed and never deleted.

## What it does

1. At session start, and after a turn when the last measurement is 10 minutes old, it runs `git ls-files --others --ignored --exclude-standard --directory` in the repository of the session's directory. Outside a git repository it does nothing.
2. It sorts each git-ignored directory by name and content:
   - **certain**: `node_modules` (with `.package-lock.json`, `.modules.yaml`, `.yarn-integrity` or `.yarn-state.yml` inside), `target` (with `CACHEDIR.TAG` or `.rustc_info.json`), `.venv` and `venv` (with `pyvenv.cfg`), `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.phpunit.cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.gradle`, `DerivedData`, `Pods`. A certain name without its marker file is unsure.
   - **unsure**: `dist`, `build`, `out`, `bin`, `obj`, `vendor`, `.cache`, `coverage`. Listed with `(unsure)`, never picked in advance.
   - **data**: `docker-data`, `data`, `training`, `dataset`, `datasets`, `models`, `uploads`, `media`, `storage`, `db`, `database`, `pgdata`, `volumes`, `backup`, `backups`, `dump`, `dumps`, `logs`, `git-clone`, `release`, `releases`, `artifacts`, `cache`. Never listed. The mod looks one level inside, and lists an artifact there (`training/.venv`), never the data directory itself.
   - Any other name is not listed.
3. It measures the listed directories with one `du -sk` call, by argv, in the background, so no prompt waits for it.
4. The status line shows the total from 5 GB on, and says so louder from 20 GB on:

       disk-janitor: artifacts 7.4 GB · /janitor
       disk-janitor: over 20 GB: artifacts 23.1 GB · /janitor

## The pane

`/janitor` opens the pane, and again closes it. It takes the keys; Esc closes it.

    /Users/you/app · 6.5 GB
    [x] node_modules  2.0 GB
    [x] target  4.0 GB
    [ ] dist  1 MB  (unsure)
    [x] data/venv  512 MB
    [ Delete selected (6.5 GB) ]
    kept, data: data

Enter on a row picks it or drops it. The first Enter on the delete button turns it into `Press again to delete 3 dir(s), 6.5 GB`; the second deletes. A pick is kept across later measurements.

Right before each deletion the mod checks the directory again: it must still be a directory and not a link, lie inside the repository (by its resolved path), still be git-ignored (`git check-ignore`), and still be of the class it was listed with. A directory that fails is skipped and named. The deletion is `rm -rf -- <absolute path>` by argv, no shell.

One transcript line then says what went and what stayed, the data directories by name:

    disk-janitor: deleted 1 dir(s), 3 MB: node_modules (3 MB) · kept, data: data

## Command

    /janitor                  open or close the pane
    /janitor list             the listed directories as text, for a surface without the pane
    /janitor rescan           measure again now
    /janitor delete <path>    delete one listed directory, the same checks as the pane

`delete` runs only for a command you typed at the prompt or through the bridge. A command a plugin runs is refused, so the model cannot delete.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install disk-janitor@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

Restart Claude Code. The mod needs no key and no setting. Start Claude Code inside a git repository; the first measurement runs at session start.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=janitor}, ui.render{component=Pane}, ui.close
    ❯ ./register.tsx calls: $.clock.now, $.command.register, $.fs.exists (via hasAnyMarker), $.fs.list (via insideData), $.fs.stat (via staleReason), $.process.run (via findArtifacts, measure, removeDir, repoRoot, staleReason), $.session.cwd (via refresh), $.ui.close (via openPane), $.ui.invalidate (via pressDelete, refresh, toggle), $.ui.log (via pressDelete, refreshInBackground), $.ui.open (via openPane), $.ui.panes (via openPane), $.ui.resolve, $.ui.status (via refresh)

Reach L2, runs processes and deletes directories.

    1. Reads:    the repository's git-ignored directory names; the marker files of a listed directory; the entries one level inside a data directory; the resolved path of a directory before its deletion
    2. Runs:     git rev-parse, git ls-files and git check-ignore, read-only; du -sk; rm -rf -- on a directory you picked twice in the pane or named with /janitor delete; all by argv, no shell
    3. Sends:    nothing; the /janitor output row is read by the model as any command output is
    4. Persists: nothing; the last measurement and your picks live in memory
    5. Hostile input: a directory name comes from git and the disk, never from the model; a deletion needs your key press or your typed command, and a path must pass every check again right before it

## Limits

- Only a directory git ignores is listed. A build output that is committed, or ignored nowhere, is not.
- A name outside the three lists is not listed, even when it is a build output.
- An ignored directory inside another ignored directory is not listed, unless the outer one is a data directory (one level only).
- `du` on a very large tree can take long. The measurement runs in the background with a 60-second limit; the pane shows `measuring…` until the first one ends.
- At most 500 directories are listed.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
