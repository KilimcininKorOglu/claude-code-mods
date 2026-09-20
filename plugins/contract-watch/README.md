# contract-watch

A Claude Code Mod that tells the model which callers to check after it changes a function signature. When an Edit changes the parameters of a function, the mod asks ripwire who calls it and adds the callers to the Edit's result, before a build or a test finds them.

## What it does

1. The mod hooks the Edit tool. After a successful edit it compares the one-line function definitions in `old_string` and `new_string`: Go `func`, JS and TS functions, arrow functions and class methods, Python `def`, Rust `fn`, Java methods and PHP functions.
2. A function both strings define with other parameters is a changed signature. A body edit runs nothing.
3. For each changed signature it runs `ripwire <repo root> --edit-check=<file>:<name>` by argv. ripwire compares the definition with git HEAD and lists the callers.
4. When ripwire reports `status="contract-change"`, the model reads this note after the Edit's result:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (main.go:5), other (main.go:9).

   A caller is named with the definition it sits in; at most 10 are named, the rest counted.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the finding alone, without the instruction:

       contract-watch: parse changed from 1 to 2 parameter(s); callers: main (main.go:5), other (main.go:9)

   The note and the line are separate channels: the model never reads the line, and you never read the note.

The note lists every caller, not only the ones ripwire proves incompatible: in a live check on Go, ripwire reported `incompatible="0"` while both callers still passed one argument (measured with ripwire on 2.1.278).

In the live check the model read the note after its Edit and said that the two callers would not compile until they were updated.

## Command

    /contract-watch            on or off
    /contract-watch on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install contract-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install ripwire and put it on PATH. Without it every changed signature logs `the callers were not checked: ...` once, and the edit runs as before.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=contract-watch}, tool.call{tool=Edit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via checkOne, locate), $.store.get (via isEnabled), $.store.set (via runCommand), $.ui.log (via checkOne, report)

Reach L2, runs processes.

    1. Reads:    the old and new text of each Edit; through ripwire, the repository's source and git HEAD
    2. Runs:     git rev-parse and ripwire --edit-check, read-only, by argv, only after an edit that changed a signature
    3. Sends:    a note to the model after the Edit's result, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: a function name comes from the edited text and reaches ripwire as one argv item, never through a shell

## Limits

- Only a definition on one line is read. A signature whose parameters span several lines is not seen.
- A renamed function is not checked: the old name is gone, so ripwire has nothing to compare.
- The comparison is against git HEAD. A second signature edit of the same function before a commit repeats the note.
- Only the Edit tool is watched. A Write that replaces a whole file is not.
- Outside a git repository nothing runs.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
