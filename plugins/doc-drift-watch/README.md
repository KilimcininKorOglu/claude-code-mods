# doc-drift-watch

A Claude Code Mod that tells the model which doc lines its commit made stale. After each `git commit` the model runs, the mod asks [ripwire](https://github.com/redhat-et/ripwire) which markdown anchors no longer hold, and adds the ones the commit broke to the commit's result.

## What it does

1. The mod hooks the Bash tool. A command that runs `git commit` (also `git -C <dir> commit`, not `--dry-run` or `--help`) is checked.
2. Before the command runs, it finds the repository root from the session's directory, the last `cd` before the commit and the commit's `git -C`, and runs `ripwire <root> --doc-drift --with-history` by argv.
3. After a successful commit it runs the same command again and compares the two runs. A stale anchor is the same one when its doc, kind, reason and reference match; the line number is left out, because an edit above it moves it.
4. Only the anchors the commit added are reported. The model reads this note after the commit's result:

       doc-drift-watch: this commit made 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists. Update them in a follow-up commit, or tell the user why a line stays.

   At most 8 lines are named, the rest counted.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the stale lines alone, without the instruction:

       doc-drift-watch: 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, those lines go there instead, one entry per doc, as an entry in its stream: the `doc:line` faint, the stale reference red, and what now sits at a moved line yellow, and the transcript stays clean. With the sidebar closed, or without that mod installed, the transcript line is written as above.
7. The finding then stays open, one per doc. At each main-loop turn's end the mod measures each open doc again with `ripwire <root> --doc-drift=<doc> --with-history`, a run narrowed to that one doc. A doc whose anchors all hold again is closed: the entry is cleared and one green line takes its place.

       doc-drift-watch: README.md: 1 doc line(s) hold again

   A doc that is gone closes the finding from the other side, and the line says so: `README.md is gone, and its 1 stale line(s) with it`. A doc that holds some of its stale lines still stays open, because a part fixed is not fixed. A later commit that makes more lines of an open doc stale adds them to that doc's finding; the lines it already held stay while the drift after the commit still reports them.
8. What is left reaches the model as one note with the next prompt, one note per turn:

       doc-drift-watch: 1 doc(s) still hold stale lines: README.md (1). Update them.

A stale anchor that was stale before the commit is not repeated, so an example path in a README does not come back on every commit. An anchor its author dated (ripwire `kind="dated-record"`) is not reported, because it records what was true then.

In the live check the model deleted a file that a README pointed at with `other.go:3`, read the note after the commit, and repeated it word for word. An older stale anchor in the same README was not in the note.

## The two modes

`note` is the default: the mod reports and stops nothing.

In `deny` mode a `git commit`, `git push` or `git merge` is stopped while a doc still holds a stale line. The mod measures each open doc again before it answers, so a doc the model fixed opens the gate itself and no gate holds for good:

    doc-drift-watch: stopped: 1 doc(s) still hold stale lines: README.md (1). Update them and run the command again; there is no way around this gate.

A `git commit` answers for its own files alone: the mod reads the index (`git rev-parse --show-toplevel` and `git diff --cached --name-only -z`) and lets the commit run when it holds none of the open docs, with one line saying how many still stand. A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed, because the index alone does not say what they commit. A `push` and a `merge` read no index, so every finding stands there.

There is no bypass and no one-time pass. The gate opens when the docs hold again, or when you set `/doc-drift-watch mode note`.

## Command

    /doc-drift-watch                  the status: on or off, the mode, and the docs still stale
    /doc-drift-watch on | off         on by default
    /doc-drift-watch mode note        report only, the default
    /doc-drift-watch mode deny        also stop git commit, push and merge while a doc is stale

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install doc-drift-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install [ripwire](https://github.com/redhat-et/ripwire) and put it on PATH. Without it each commit logs `the docs were not checked: ...` once, and the commit runs as before.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=doc-drift-watch}, tool.call{tool=Bash}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.fs.read (via isGone), $.process.run (via driftNow, repoRoot, stagedPaths), $.session.cwd (via beforeCommit, stagedPaths), $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via gate, toPerson)

Reach L2, runs processes.

    1. Reads:    the Bash command text, each open doc's own file; through ripwire, the repository's markdown, source and git history
    2. Runs:     git rev-parse, git diff --cached and ripwire --doc-drift, read-only, by argv: twice per commit, once per open doc at each turn's end and at a guarded command
    3. Sends:    a note to the model after the commit's result and at the next prompt, and one line to the transcript or the sidebar; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: the directory comes from the command text and reaches git only as the working directory, never through a shell; a doc path comes from ripwire's own output and reaches ripwire as one argv value

## Limits

- ripwire checks file:line references, backticked symbol names, `= N` constants and `[N]` array extents. Prose is not checked, and ripwire under-reports on purpose: a renamed symbol whose name still occurs elsewhere is not reported.
- ripwire runs twice per commit, and once per open doc at each turn's end. In this repository one whole-repository run took 0.1 to 0.2 s, and a narrowed one less.
- A turn's end measures the open docs alone. A doc a commit did not touch and that went stale another way is found at the next commit, not at the turn's end.
- `--doc-drift=<doc>` filters by path substring, so a run narrowed to one doc also reads a doc whose path holds that one. The answer is filtered by the doc's own path afterwards.
- A commit through a script or an alias that hides `git commit` is not seen.
- `cd ~/x` is not expanded: the root then comes from the session's directory.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
