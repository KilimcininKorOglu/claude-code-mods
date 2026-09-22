# commit-cadence

A Claude Code Mod that measures the working tree at the end of each turn and names what is still uncommitted, so finished work is committed as it lands instead of piling up for the end of a session.

## What it does

1. At the end of each main-loop turn the mod runs `git status --porcelain=v1 -z` in the directory the session started in and reads the paths it names, staged or not. Ignored files and the generated `.claude/` directory are left out.
2. A dirty tree is reported once per set of paths. A later turn that changed nothing says nothing, and a new or removed path reports again, so a long stretch of edits does not repeat the line.
3. The person reads the finding as one line in the [sidebar](../sidebar) stream, or as one transcript line while the sidebar is closed:

       commit-cadence: 2 uncommitted file(s): src/app.ts, src/new.ts

4. The next prompt carries a note only the model reads: what is uncommitted, and that each finished and verified piece belongs in its own commit now. The note is owed once per report, so one prompt carries it and the next does not.
5. A tree that went clean closes the finding with a green line: `the working tree is clean again`. The red entries written since the tree was last clean are cleared first, so a pane restore does not bring them back.
6. `/commit-cadence` measures on the spot and prints the setting and what the tree holds.

It stops nothing. The person decides what is worth a commit, and the model reads the note as a reminder, not as a gate.

## Command

    /commit-cadence            the setting and what the tree holds right now
    /commit-cadence on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install commit-cadence@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod for the finding lines. Without it the mod writes them to the transcript.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=commit-cadence}, turn.complete, prompt.submit
    ❯ ./register.ts calls: $.command.register, $.process.run (via readTree), $.session.cwd, $.sidebar.clear (via dropEntries), $.sidebar.set (via toPerson), $.store.get, $.store.set (via setEnabled), $.ui.log (via toPerson)

Reach L2, it runs a process.

    1. Reads:    the paths git status names in the session's own directory. It reads no file content, no prompt and no answer.
    2. Runs:     git status --porcelain=v1 -z, once per turn that ends and once per /commit-cadence
    3. Sends:    to the model, the count and the first six paths of the uncommitted files, with one sentence about committing them
    4. Persists: in $.store, the on/off setting; the reported paths live in memory and end with the session
    5. Hostile input: the only text drawn and sent is the paths git itself printed, cut to six names and a count

## Limits

- The tree is measured, not the authorship. A file you changed by hand counts exactly as one the model changed.
- The measure is the session's own directory. A repository somewhere else in the same session is not read.
- A subagent's turn is not measured; only the main loop's end is.
- A path that is only ignored is left out, and so is everything under `.claude/`, because that directory is generated.
- It names files, never hunks. A file that holds two unrelated changes reads as one path.
- Nothing is committed and nothing is stopped.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
