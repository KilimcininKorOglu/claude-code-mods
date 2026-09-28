# doc-drift-watch

The model deletes a file or renames a function, commits, and a README somewhere still points at `other.go:3`. Nobody notices until a reader follows the link. This mod catches it at the commit: after each `git commit` the model runs, it asks [ripwire](https://github.com/redhat-et/ripwire) which markdown anchors no longer hold, and adds the ones the commit broke to the commit's result.

## What it does

1. It watches the Bash tool. A command that runs `git commit` is checked, also `git -C <dir> commit` or with git's global flags in front, but not with `--dry-run`, `--help` or `-h`.
2. Before the command runs, it finds the repository root from the session's directory, the last `cd` before the commit and the commit's `git -C`, and runs `ripwire <root> --doc-drift --with-history` by argv.
3. After a successful commit it runs the same command again and compares the two runs. A stale anchor counts as the same one when its doc, kind, reason and reference match; the line number is left out, because an edit above it moves it.
4. Only the anchors the commit added are reported. The model reads this note right after the commit's result:

       doc-drift-watch: this commit made 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists. Update them in a follow-up commit, or tell the user why a line stays.

   At most 8 lines are named, the rest are counted.
5. At the same moment you get one line in the transcript, so you see what the model was told. It holds the stale lines alone, without the instruction:

       doc-drift-watch: 1 doc line(s) stale: README.md:7 points at other.go:3, a file that no longer exists

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. With the [sidebar](../sidebar) open, the lines go into its stream instead, one entry per doc, and the transcript stays clean. The `doc:line` part is faint, the stale reference red, and what now sits at a moved line yellow. Without the sidebar, the line lands in the transcript as above.
7. The finding then stays open, one per doc. At each main-loop turn's end the mod measures every open doc again with `ripwire <root> --doc-drift=<doc> --with-history`, a run narrowed to that one doc. A doc whose anchors all hold again is closed: its entry is cleared and a green line takes its place.

       doc-drift-watch: README.md: 1 doc line(s) hold again

   A doc that is gone closes the finding from the other side, and the line says so: `README.md is gone, and its 1 stale line(s) with it`. A doc that has fixed only some of its stale lines stays open, because partly fixed is not fixed. A later commit that makes more lines of an open doc stale adds them to that doc's finding; the lines it already held stay as long as the drift after the commit still reports them.
8. Whatever is left reaches the model as one note with your next prompt, one note per turn:

       doc-drift-watch: 1 doc(s) still hold stale lines: README.md (1). Update them.

An anchor that was already stale before the commit is not repeated, so an example path in a README does not come back on every commit. An anchor its author dated (ripwire `kind="dated-record"`) is not reported either, because it records what was true back then.

In the live check the model deleted a file that a README pointed at with `other.go:3`, read the note after the commit, and repeated it word for word. An older stale anchor in the same README was not in the note.

## The two modes

`note` is the default: the mod reports and stops nothing.

In `deny` mode a `git commit`, `git push` or `git merge` is stopped while a doc still holds a stale line. The mod measures each open doc again before it answers, so a doc the model fixed opens the gate by itself and no gate stays closed for good:

    doc-drift-watch: stopped: 1 doc(s) still hold stale lines: README.md (1). Update them and run the command again; there is no way around this gate.

A `git commit` answers for its own files alone: the mod reads the index (`git rev-parse --show-toplevel` and `git diff --cached --name-only -z`) and lets the commit run when it holds none of the open docs, with one line saying how many still stand. A `git commit -a`, a `-am` and a commit with a pathspec after `--` are not narrowed, because the index alone does not say what they commit. A `push` and a `merge` read no index, so every finding counts there.

There is no bypass and no one-time pass. The gate opens when the docs hold again, or when you set `/doc-drift-watch mode note`.

## Command

    /doc-drift-watch                  the status: on or off, the mode, and the docs still stale
    /doc-drift-watch on | off         on by default
    /doc-drift-watch mode note        report only, the default
    /doc-drift-watch mode deny        also stop git commit, push and merge while a doc is stale

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install doc-drift-watch@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install [ripwire](https://github.com/redhat-et/ripwire) and put it on PATH. Without it a commit writes `the docs were not checked: ...` as a yellow entry (a transcript line with the sidebar closed), once until a different error comes, and the commit runs as before.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=doc-drift-watch}, tool.call{tool=Bash}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.fs.read (via isGone), $.process.run (via driftNow, repoRoot, stagedPaths), $.session.cwd (via beforeCommit, stagedPaths), $.sidebar.clear (via closeOne), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand, setMode), $.ui.log (via gate, toPerson)

Reach L2: it runs processes.

    1. Reads:    the Bash command text, each open doc's own file; through ripwire, the repository's markdown, source and git history
    2. Runs:     git rev-parse, git diff --cached and ripwire --doc-drift, read-only, by argv: twice per commit, once per open doc at each turn's end and at a guarded command
    3. Sends:    a note to the model after the commit's result and at the next prompt, and one line to the transcript or the sidebar; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: the directory comes from the command text and reaches git only as the working directory, never through a shell; a doc path comes from ripwire's own output and reaches ripwire as one argv value

## Limits

- ripwire checks file:line references, backticked symbol names, `= N` constants and `[N]` array extents. Prose is not checked, and ripwire under-reports on purpose: a renamed symbol whose name still occurs elsewhere is not reported.
- ripwire runs twice per commit, and once per open doc at each turn's end. In this repository one whole-repository run took 0.1 to 0.2 s, and a narrowed one less.
- A turn's end measures only the open docs. A doc no commit touched that went stale some other way is found at the next commit, not at the turn's end.
- `--doc-drift=<doc>` filters by path substring, so a run narrowed to one doc also reads any doc whose path contains that one. The answer is filtered by the doc's own path afterwards.
- A commit through a script or an alias that hides `git commit` is not seen.
- A `cd` or `git -C` whose directory the shell expands first (`cd $D`, `cd ~/x`, a backquote) names no directory the mod can tell. That commit is not checked, and the yellow line names the word, for example `the commit's directory is not known: cd $D`. A single-quoted word stays literal.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
