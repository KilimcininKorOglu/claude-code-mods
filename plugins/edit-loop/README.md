# edit-loop

A Claude Code Mod that tells the model when it has edited the same file five times in one turn, so it re-reads the root cause instead of trying again. Nothing is stopped.

## What it does

1. The mod hooks the Edit, Write and NotebookEdit tools. Each successful call counts one edit of its file. A denied or failed call is not counted.
2. The count is kept per loop and file: the main loop and each subagent count apart. A new turn starts every count at zero.
3. The fifth edit of one file in a turn gets this note after its result:

       edit-loop: this turn edited hooks/a.ts 5 times. Stop editing it, re-read the code path and state the root cause before the next edit.

   The path is relative to the session's directory when the file is inside it. The note comes once per file and turn; the sixth and later edits get none.
4. The same moment writes one line to the transcript, so you see what the model was told. The line holds the finding alone, without the instruction:

       edit-loop: 5th edit of hooks/a.ts in this turn

   The note and the line are separate channels: the model never reads the line, and you never read the note.

In the live check the model edited one file six times in one turn. It read the note after the fifth edit, re-read the file, stated why the edits were intended, and quoted the note word for word. The other five edits had no note.

## Command

    /edit-loop            on or off
    /edit-loop on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install edit-loop@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=edit-loop}, turn.start, tool.call{tool=Edit}, tool.call{tool=Write}, tool.call{tool=NotebookEdit}
    ❯ ./register.ts calls: $.command.register, $.session.cwd (via afterEdit), $.store.get, $.store.set (via runCommand), $.ui.log (via afterEdit)

Reach L0, remembers.

    1. Reads:    the file path of each Edit, Write and NotebookEdit call; the session's directory
    2. Runs:     nothing
    3. Sends:    a note to the model after the fifth edit of one file in a turn, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting; the counts live in memory for one turn
    5. Hostile input: the path is only compared and printed in the note, never opened

## Limits

- An edit through Bash (`sed -i`, a heredoc, a script) is not counted.
- Five edits of one file can be intended, for example a long file written in parts. The note asks for a reason, it stops nothing.
- The count follows the path as the tool call names it, so one file under two spellings (a link, `..`) counts twice.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
