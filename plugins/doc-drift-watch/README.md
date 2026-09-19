# doc-drift-watch

A Claude Code Mod that tells the model which doc lines its commit made stale. After each `git commit` the model runs, the mod asks ripwire which markdown anchors no longer hold, and adds the ones the commit broke to the commit's result.

## What it does

1. The mod hooks the Bash tool. A command that runs `git commit` (also `git -C <dir> commit`, not `--dry-run` or `--help`) is checked.
2. Before the command runs, it finds the repository root from the session's directory, the last `cd` before the commit and the commit's `git -C`, and runs `ripwire <root> --doc-drift --with-history` by argv.
3. After a successful commit it runs the same command again and compares the two runs. A stale anchor is the same one when its doc, kind, reason and reference match; the line number is left out, because an edit above it moves it.
4. Only the anchors the commit added are reported. The model reads this note after the commit's result:

       doc-drift-watch: this commit made 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists. Update them in a follow-up commit, or tell the user why a line stays.

   At most 8 lines are named, the rest counted.

A stale anchor that was stale before the commit is not repeated, so an example path in a README does not come back on every commit. An anchor its author dated (ripwire `kind="dated-record"`) is not reported, because it records what was true then. The mod never stops a commit.

In the live check the model deleted a file that a README pointed at with `other.go:3`, read the note after the commit, and repeated it word for word. An older stale anchor in the same README was not in the note.

## Command

    /doc-drift-watch            on or off
    /doc-drift-watch on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install doc-drift-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install ripwire and put it on PATH. Without it each commit logs `the docs were not checked: ...` once, and the commit runs as before.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=doc-drift-watch}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.process.run (via driftNow, repoRoot), $.session.cwd (via beforeCommit), $.store.get (via isEnabled), $.store.set (via runCommand), $.ui.log (via report)

Reach L2, runs processes.

    1. Reads:    the Bash command text; through ripwire, the repository's markdown, source and git history
    2. Runs:     git rev-parse and ripwire --doc-drift, read-only, by argv, twice per commit
    3. Sends:    a note to the model after the commit's result; nothing leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the directory comes from the command text and reaches git only as the working directory, never through a shell

## Limits

- ripwire checks file:line references, backticked symbol names, `= N` constants and `[N]` array extents. Prose is not checked, and ripwire under-reports on purpose: a renamed symbol whose name still occurs elsewhere is not reported.
- ripwire runs twice per commit. In this repository one run took 0.1 to 0.2 s.
- A commit through a script or an alias that hides `git commit` is not seen.
- `cd ~/x` is not expanded: the root then comes from the session's directory.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
