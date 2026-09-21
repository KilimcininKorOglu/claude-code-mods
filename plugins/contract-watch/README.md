# contract-watch

A Claude Code Mod that tells the model which callers to check after it changes a function signature. When an Edit changes the parameters of a function, the mod asks [ripwire](https://github.com/redhat-et/ripwire) who calls it and adds the callers to the Edit's result, before a build or a test finds them.

## What it does

1. The mod hooks the Edit tool. After a successful edit it compares the one-line function definitions in `old_string` and `new_string`: Go `func`, JS and TS functions, arrow functions and class methods, Python `def`, Rust `fn`, Java methods and PHP functions.
2. A function both strings define with other parameters is a changed signature. A body edit runs nothing.
3. For each changed signature it runs `ripwire <repo root> --edit-check=<file>:<name>` by argv. ripwire compares the definition with git HEAD and lists the callers.
4. When ripwire reports `status="contract-change"`, the model reads this note after the Edit's result:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; check each caller: main (main.go:5), other (main.go:9).

   A caller is named with the definition it sits in; at most 10 are named, the rest counted. When ripwire marks a caller `incompatible="1"`, every folded definition it sees disagrees with the new arity, and those callers come first, under their own sentence:

       contract-watch: parse changed from 1 to 2 parameter(s) since the last commit; these callers do not match the new arity: main (main.go:5). Other callers of that name, which the call graph binds by name and may belong to another type: other (lib.go:9). Check each.

   The second group matters in a codebase where several types define a method of one name: the call graph binds a call by its name, so `Messaging::sendAlert` reads the same as `SNMP_Monitor::sendAlert`. Neither group is dropped.
5. The same moment writes one line to the transcript, so you see what the model was told. The line holds the finding alone, without the instruction:

       contract-watch: parse changed from 1 to 2 parameter(s); do not match: main (main.go:5); same name: other (lib.go:9)

   The note and the line are separate channels: the model never reads the line, and you never read the note.
6. While the [sidebar](../sidebar) is open, that finding goes there instead, the change on the first line, the marked callers in red under it and the same-named ones faint after a `same name, may be another type` line, as an entry in its stream, and the transcript stays clean. The entry stays until newer ones push it off the pane. With the sidebar closed, or without that mod installed, the transcript line is written as above.

The note lists every caller, not only the ones ripwire proves incompatible: in a live check on Go, ripwire reported `incompatible="0"` while both callers still passed one argument (measured with ripwire on 2.1.278).

7. The mod holds every reported signature open and closes it itself, in both modes. At the next `git commit`, `git push` or `git merge` the model runs, and before that command runs, ripwire measures each open symbol again. A symbol no caller misses any more closes with a green line, and the sidebar entry of the finding is dropped:

       contract-watch: every caller matches parse again

   That line comes when the contract reads the same as the last commit again. When the contract still differs but no caller carries ripwire's `incompatible` mark any more, the closing line names that narrower measure instead, because a call graph that binds by name cannot prove every caller right:

       contract-watch: no caller of parse carries the mismatch mark any more

   The measurement runs before the command, not after it: `--edit-check` compares the working tree against git HEAD, so once a commit has landed there is nothing left to compare and every finding would read as closed.
8. A finding the model did not close is measured the same way at the end of each main-loop turn, and what is left reaches the model as one note with its next prompt. ripwire runs on this machine, once per open symbol:

       contract-watch: 1 changed signature(s) still leave a caller behind: parse changed from 1 to 2 parameter(s), 1 caller(s) do not match. Bring each caller to the new signature, or take the signature change back.

   One note per turn, not one per prompt. Without this the finding would be said once, at the edit, and then stand in the pane while the model forgot it. You read nothing new: the pane already carries the same finding.
9. In `deny` mode that same moment also stops the command while a changed signature leaves a caller behind. The gate takes a narrower measure than the note: only a check whose `incompatible` count is above zero holds it, the callers ripwire names by fixed-arity evidence. There is no bypass; only the person turns the gate off with `/contract-watch mode note`. `note` mode is the default and stops nothing.

In the live check the model read the note after its Edit and said that the two callers would not compile until they were updated.

## Command

    /contract-watch                 on or off, the mode, and the signatures that leave a caller behind
    /contract-watch on | off        on by default
    /contract-watch mode note       note only; the default
    /contract-watch mode deny       a commit, a push and a merge also stop while a caller does not match

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install contract-watch@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Install [ripwire](https://github.com/redhat-et/ripwire) and put it on PATH. Without it every changed signature logs `the callers were not checked: ...` once, and the edit runs as before.
2. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=contract-watch}, turn.complete, prompt.submit, tool.call{tool=Bash}, tool.call{tool=Edit}
    ❯ ./register.ts calls: $.command.register, $.process.run (via askRipwire, locate), $.sidebar.clear (via dropEntry), $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand, setMode), $.ui.log (via report, toPerson)

Reach L2, runs processes.

    1. Reads:    the old and new text of each Edit; the Bash command text; through ripwire, the repository's source and git HEAD
    2. Runs:     git rev-parse and ripwire --edit-check, read-only, by argv, after an edit that changed a signature, and once per open symbol before a git commit, push or merge and at each turn's end
    3. Sends:    a note to the model after the Edit's result, one more with the next prompt while a finding stands, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting and the mode
    5. Hostile input: a function name comes from the edited text and reaches ripwire as one argv item, never through a shell

## Limits

- Only a definition on one line is read. A signature whose parameters span several lines is not seen.
- A renamed function is not checked: the old name is gone, so ripwire has nothing to compare.
- The comparison is against git HEAD. A second signature edit of the same function before a commit repeats the note.
- Only the Edit tool is watched. A Write that replaces a whole file is not.
- Outside a git repository nothing runs.
- The gate follows ripwire's `incompatible` count, which is itself a floor: a caller ripwire cannot bind by name does not hold the gate. The note stays the wider measure.
- The `deny` mode has no bypass. When a finding cannot be fixed, the person turns the gate off with `/contract-watch mode note`.
- The gate reads the command text. A commit through a script or an alias that hides `git commit` is not stopped, and a finding is not measured again either, so it stays open until such a command runs.
- A finding is measured again only at a `git commit`, `git push` or `git merge`. A session that never runs one keeps the finding open.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
