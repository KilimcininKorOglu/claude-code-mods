# commit-cadence

A long session easily ends with twenty changed files and one giant commit, where the fix, the refactor and the experiment are all mixed up. This mod looks at the working tree at the end of every turn and tells you, and the model, what is still uncommitted, so finished work gets committed as it lands instead of piling up for the end.

## What it does

1. At the end of each main-loop turn it runs `git status --porcelain=v1 -z` in the directory the session started in and reads the paths it names, staged or not. Ignored files and untracked files under the generated `.claude/` directory are left out.
2. A dirty tree is reported once per set of paths. A later turn that changed nothing stays quiet, and a new or removed path reports again, so a long stretch of edits does not repeat the same line.
3. You read the finding as one red line in the [sidebar](../sidebar) stream, or as a transcript line while the sidebar is closed:

       commit-cadence: 2 uncommitted file(s): src/app.ts, src/new.ts

4. Your next prompt carries a note only the model reads: what is uncommitted, and that every finished and verified piece belongs in its own commit now. The note goes out once per report, so one prompt carries it and the next one does not.
5. When the tree is clean again, a green line closes the finding: `the working tree is clean again`. The red entries written since the tree was last clean are cleared first, so they do not come back when the pane restores its stream.
6. While a finding stands, it is kept in `$.store` per repository: its paths and the keys of its red entries. A module loaded again (`/reload-plugins`, an update, a restart) picks it up at session start. It can then still clear the red entries written before it, without reporting the same paths or sending the note again.
7. `/commit-cadence` measures on the spot and prints the setting and what the tree holds.

It stops nothing. You decide what is worth a commit, and the model reads the note as a reminder, not as a gate.

## Command

    /commit-cadence            the setting and what the tree holds right now (also /commit-cadence status)
    /commit-cadence on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install commit-cadence@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod if you want the findings there. Without it the lines go to the transcript.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=commit-cadence}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.process.run (via readTree), $.session.cwd, $.sidebar.clear (via dropEntries), $.sidebar.set (via toPerson), $.store.delete (via saveOpen), $.store.get (via loadOpen, readSettings), $.store.set (via saveOpen, setEnabled), $.ui.log (via toPerson)

Reach L2: it runs a process.

    1. Reads:    the paths git status names in the session's own directory. It reads no file content, no prompt and no answer.
    2. Runs:     git status --porcelain=v1 -z, once per turn that ends and once per /commit-cadence
    3. Sends:    to the model, the count and the first six paths of the uncommitted files, with one sentence about committing them
    4. Persists: in $.store, the on/off setting, and per repository the open finding (the uncommitted paths and the keys of their red entries) until the tree is clean
    5. Hostile input: the only text drawn and sent is the paths git itself printed, cut to six names and a count

## Limits

- It measures the tree, not who changed it. A file you edited by hand counts exactly like one the model edited.
- It measures the session's own directory. Another repository you work in during the same session is not read.
- Only the main loop's turn end is measured, not a subagent's.
- Ignored paths are left out, and so are untracked files under `.claude/`, because that directory is generated.
- It names files, never hunks. A file holding two unrelated changes shows up as one path.
- It commits nothing and stops nothing.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
