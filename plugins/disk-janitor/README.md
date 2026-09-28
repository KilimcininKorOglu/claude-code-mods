# disk-janitor

Build tools never clean up after themselves: `node_modules`, Rust's `target` and Python's `.venv` grow quietly until the disk is full. This mod measures the build artifacts of the session's repository, shows the total once it passes 5 GB, and deletes the directories you pick in the `/disk-janitor` pane. A data directory is never listed and never deleted.

## What it does

1. At session start, every 60 s in an interactive session, and after a turn once the last measurement is 10 minutes old, it runs `git ls-files --others --ignored --exclude-standard --directory -z` in the repository of the session's directory. That directory is the one the session started in, read once at the start, because a Bash `cd` moves the session's own directory and would point the measurement at another repository. Outside a git repository it does nothing. The 60 s measurement shows a build or a deletion made in another window while this session is idle. It waits while the pane's delete button is armed, because a measurement disarms the button, and it is skipped while the last measurement still runs.
2. It sorts each git-ignored directory by its name and content:
   - **certain**: `node_modules` (with `.package-lock.json`, `.modules.yaml`, `.yarn-integrity` or `.yarn-state.yml` inside), `target` (with `CACHEDIR.TAG` or `.rustc_info.json`), `.venv` and `venv` (with `pyvenv.cfg`), `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.phpunit.cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.gradle`, `DerivedData`, `Pods`. A certain name without its marker file counts as unsure.
   - **unsure**: `dist`, `build`, `out`, `bin`, `obj`, `vendor`, `.cache`, `coverage`. Listed with `(unsure)` and never picked in advance.
   - **data**: `docker-data`, `data`, `training`, `dataset`, `datasets`, `models`, `uploads`, `media`, `storage`, `db`, `database`, `pgdata`, `volumes`, `backup`, `backups`, `dump`, `dumps`, `logs`, `git-clone`, `release`, `releases`, `artifacts`, `cache`. Never listed. The mod looks one level inside and lists an artifact there (`training/.venv`), never the data directory itself.
   - Any other name is not listed.
3. It measures the listed directories with one `du -sk` call, by argv, in the background, so no prompt waits for it.
4. The status line shows the total from 5 GB on, and more loudly from 20 GB on:

       disk-janitor: artifacts 7.4 GB · /disk-janitor
       disk-janitor: over 20 GB: artifacts 23.1 GB · /disk-janitor

   With the [sidebar](../sidebar) open, that line goes there instead as a `build artifacts` section that stays for the session, and the status line stays clear. Only the size is coloured, yellow from 5 GB and red from 20 GB, and `· /disk-janitor` is faint; below 5 GB the section goes away. A second, faint line holds the last deletion: what went in green, `N skipped` in yellow, `N failed` in red. A `clean up` button opens the pane:

       disk-janitor: build artifacts
       artifacts 7.4 GB · /disk-janitor
       deleted 2 dir(s), 2.5 GB
       [ clean up ]

   The button runs `/disk-janitor`, which opens the pane (and closes it if it is open). It deletes nothing by itself: the picks and the two presses stay in the pane.

   Without the sidebar, the status line is drawn as above.

## The pane

`/disk-janitor` opens the pane, and running it again closes it. The pane takes the keys, and Esc closes it.

    /Users/you/app · 6.5 GB
    [x] node_modules  2.0 GB
    [x] target  4.0 GB
    [ ] dist  1 MB  (unsure)
    [x] data/venv  512 MB
    [ Delete selected (6.5 GB) ]
    kept, data: data

Enter on a row picks it or drops it. The first Enter on the delete button turns it into `Press again to delete 3 dir(s), 6.5 GB`; the second one deletes. Your picks are kept across later measurements.

Right before each deletion the mod checks the directory again: it must still be a directory and not a link, lie inside the repository (by its resolved path), still be git-ignored (`git check-ignore`), and still be of the class it was listed with. A directory that fails a check is skipped and named. The deletion is `rm -rf -- <absolute path>` by argv, without a shell.

One transcript line then says what went and what stayed, naming the data directories:

    disk-janitor: deleted 1 dir(s), 3 MB: node_modules (3 MB) · kept, data: data

## Command

    /disk-janitor                  open or close the pane
    /disk-janitor list             the listed directories as text, for a surface without the pane
    /disk-janitor rescan           measure again now
    /disk-janitor delete <path>    delete one listed directory, with the same checks as the pane

`delete` runs only for a command you typed at the prompt or through the bridge. A command a plugin runs is refused, so the model cannot delete anything.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install disk-janitor@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code. The mod needs no key and no setting.
2. Start Claude Code inside a git repository; the first measurement runs at session start.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.284:

    ❯ ./register.tsx hooks: session.start, turn.complete, command.run{command=disk-janitor}, ui.render{component=Pane}, ui.close
    ❯ ./register.tsx calls: $.clock.every, $.clock.now, $.command.register, $.fs.exists (via hasAnyMarker), $.fs.list (via insideData), $.fs.stat (via staleReason), $.process.run (via findArtifacts, measure, removeDir, repoRoot, staleReason), $.session.cwd (via refresh), $.sidebar.clear (via toSidebar), $.sidebar.isOpen (via toSidebar), $.sidebar.set (via toSidebar), $.ui.close (via openPane), $.ui.invalidate (via pressDelete, refresh, toggle), $.ui.log (via pressDelete, refreshInBackground), $.ui.open (via openPane), $.ui.panes (via openPane), $.ui.resolve, $.ui.status (via showTotal)

Reach L2: it runs processes and deletes directories.

    1. Reads:    the repository's git-ignored directory names; the marker files of a listed directory; the entries one level inside a data directory; the resolved path of a directory before its deletion
    2. Runs:     git rev-parse, git ls-files and git check-ignore, read-only; du -sk; rm -rf -- on a directory you picked twice in the pane or named with /disk-janitor delete; all by argv, no shell
    3. Sends:    nothing; the /disk-janitor output row is read by the model as any command output is
    4. Persists: nothing; the last measurement and your picks live in memory
    5. Hostile input: a directory name comes from git and the disk, never from the model; a deletion needs your key press or your typed command, and a path must pass every check again right before it

## Limits

- Only directories git ignores are listed. A build output that is committed, or ignored nowhere, is not.
- A name outside the three lists is not listed, even when it is a build output.
- An ignored directory inside another ignored directory is not listed, unless the outer one is a data directory (one level only).
- `du` on a very large tree can take a while. The measurement runs in the background with a 60-second limit, and the pane shows `measuring…` until the first one ends. An interactive session runs it every 60 s, so a repository with hundreds of thousands of files under its artifact directories reads them that often (measured: `du -sk` over the 42 git-ignored directories of this mod's repository, 231 MB, took 0.14 s).
- At most 500 directories are listed.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
